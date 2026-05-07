// POST /api/auth/logout — destroys the current session and clears the cookie.

import { getCookie, destroySession, clearCookieHeader, audit, json } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const token = getCookie(request);
  if (token) await destroySession(env, token);
  await audit(env, request, null, 'logout', {});
  return json({ ok: true }, { headers: { 'set-cookie': clearCookieHeader() } });
}
