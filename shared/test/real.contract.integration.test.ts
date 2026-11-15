// The shared contract suite against the real client on the local Supabase stack.
// Requires `npx supabase start`. The database persists between runs; every name and email is random.
//
// Observed local Supabase Auth behavior (supabase-js 2.119.0, CLI 3.1.0, confirmations off):
// - Sign-up with an already registered email (any letter case) returns an error, not an
//   obfuscated fake user: AuthApiError, status 422, code 'user_already_exists'. The client
//   still treats "no session" or empty user.identities as EMAIL_TAKEN in case that changes.
// - Auth matches emails case-insensitively (GoTrue stores them lowercased), so the client
//   passes the email through unchanged.
// - onAuthStateChange sequence for subscribe -> signUp -> signOut:
//   INITIAL_SESSION(null), SIGNED_IN(session), SIGNED_OUT(null).
import { describeClientContract } from './contract-suite';
import { realFactory } from './real-factory';

describeClientContract('real', realFactory('rc'));
