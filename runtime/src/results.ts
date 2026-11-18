import type { FinishedRound } from '../../shared/world';

/** Delays after the 1st, 2nd and 3rd failed attempt; every later failure waits RETRY_FOREVER_MS (spec §7.3). */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
export const RETRY_FOREVER_MS = 600_000;
/** `persistenceStatus: "failed"` once failures have lasted this long. Retries never stop. */
export const FAILED_AFTER_MS = 3_600_000;
/**
 * The alarm is never armed closer than this. A due row whose attempt is still in flight is
 * skipped by `alarm()`; without this floor the re-armed alarm would fire again at once.
 */
export const MIN_ALARM_DELAY_MS = 1_000;

const TABLE = 'pending_results';

interface Row extends Record<string, SqlStorageValue> {
  session_id: string;
  round: string;
  attempts: number;
  first_failed_at: number | null;
  next_attempt_at: number;
  failed_reported: number;
}

/**
 * Results waiting to be saved, kept in the World object's SQLite storage so they survive
 * restarts (spec §7.3). One row per session; the row is deleted once Supabase has the result.
 * Methods are synchronous SQL; only `rearm` touches the (single) alarm.
 */
export class PendingResults {
  constructor(
    private readonly sql: SqlStorage,
    private readonly setAlarm: (at: number) => Promise<void>,
    private readonly now: () => number,
    private readonly deleteAlarm: () => Promise<void>,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      round TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER,
      next_attempt_at INTEGER NOT NULL,
      failed_reported INTEGER NOT NULL DEFAULT 0
    )`);
  }

  /**
   * Durable insert, made before `game.finished` is flushed. The caller attempts the save at
   * once; `next_attempt_at` is the first retry in case that attempt is lost to a restart.
   */
  add(r: FinishedRound): void {
    this.sql.exec(
      `INSERT INTO ${TABLE} (session_id, round, next_attempt_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO NOTHING`,
      r.sessionId,
      JSON.stringify(r),
      this.now() + RETRY_DELAYS_MS[0]!,
    );
  }

  /** Rows whose next attempt is due now. */
  due(): FinishedRound[] {
    return this.sql
      .exec<Row>(`SELECT * FROM ${TABLE} WHERE next_attempt_at <= ? ORDER BY next_attempt_at`, this.now())
      .toArray()
      .map((row) => JSON.parse(row.round) as FinishedRound);
  }

  markSaved(sessionId: string): void {
    this.sql.exec(`DELETE FROM ${TABLE} WHERE session_id = ?`, sessionId);
  }

  /**
   * Schedules the next attempt. `failedStatusReached` is true exactly once per session: on
   * the first failure at least FAILED_AFTER_MS after the first failure.
   */
  markFailed(sessionId: string): { failedStatusReached: boolean } {
    const row = this.sql.exec<Row>(`SELECT * FROM ${TABLE} WHERE session_id = ?`, sessionId).toArray()[0];
    if (!row) return { failedStatusReached: false };
    const now = this.now();
    const failures = row.attempts + 1;
    const firstFailedAt = row.first_failed_at ?? now;
    const delay = RETRY_DELAYS_MS[failures - 1] ?? RETRY_FOREVER_MS;
    const reached = row.failed_reported === 0 && now - firstFailedAt >= FAILED_AFTER_MS;
    this.sql.exec(
      `UPDATE ${TABLE} SET attempts = ?, first_failed_at = ?, next_attempt_at = ?, failed_reported = ?
       WHERE session_id = ?`,
      failures,
      firstFailedAt,
      now + delay,
      reached || row.failed_reported === 1 ? 1 : 0,
      sessionId,
    );
    return { failedStatusReached: reached };
  }

  /** Earliest `next_attempt_at`, or null when nothing is pending. */
  nextAlarmAt(): number | null {
    const row = this.sql.exec<{ at: number | null }>(`SELECT MIN(next_attempt_at) AS at FROM ${TABLE}`).one();
    return row.at ?? null;
  }

  /** Arms the alarm for the earliest pending row (never sooner than MIN_ALARM_DELAY_MS), or deletes it. */
  async rearm(): Promise<void> {
    const at = this.nextAlarmAt();
    if (at === null) await this.deleteAlarm();
    else await this.setAlarm(Math.max(at, this.now() + MIN_ALARM_DELAY_MS));
  }
}
