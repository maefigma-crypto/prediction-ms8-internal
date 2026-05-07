// GET /api/health — public, used by uptime checks. Doesn't reveal env state.
import { json } from '../_lib/auth.js';
export async function onRequestGet({ env }) {
  return json({ ok: true, ts: Date.now(), kv: !!env.CACHE });
}
