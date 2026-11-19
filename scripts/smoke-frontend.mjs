// Smoke test for a deployed frontend (the Vercel preview). Not part of `npm test`.
// Usage: SMOKE_BASE_URL=https://<deployment>.vercel.app node scripts/smoke-frontend.mjs
// If Vercel Deployment Protection is on, also set VERCEL_AUTOMATION_BYPASS_SECRET.

const base = process.env.SMOKE_BASE_URL;
if (!base) {
  console.error('SMOKE_BASE_URL is required.');
  process.exit(1);
}

const headers = {};
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

async function get(path) {
  const res = await fetch(new URL(path, base), { headers, redirect: 'follow' });
  if (res.status === 401) {
    throw new Error(`${path}: HTTP 401. Deployment Protection is probably on; see doc/checklists/vercel-smoke-test.md.`);
  }
  if (res.status !== 200) throw new Error(`${path}: expected HTTP 200, got ${res.status}`);
  return res.text();
}

const html = await get('/');
if (!html.includes('<title>Portal Playhouse</title>')) {
  throw new Error('/: page loaded but the Portal Playhouse title is missing');
}
await get('/app.js');
await get('/styles.css');

console.log(`Smoke test passed for ${base}`);
