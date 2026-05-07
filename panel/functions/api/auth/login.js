// POST /api/auth/login
// Body: { username, password }
//
// On success: sets HttpOnly session cookie, returns user info.
// On failure: returns 401, increments per-IP and per-username rate-limit counters.
// Rate limit: 5 failed attempts per 15 minutes per IP, then locked out.

import {
  getOrSeedAdmin, getUser, verifyPassword,
  createSession, setCookieHeader,
  checkRateLimit, recordRateLimitHit, clearRateLimit,
  audit, json, unauthorized,
} from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.CACHE) return json({ error: 'kv-not-bound' }, { status: 500 });

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // Rate-limit per IP first — protects against credential-stuffing scanners.
  const rl = await checkRateLimit(env, ip);
  if (!rl.allowed) {
    return json({ error: 'rate-limited', retry_after: rl.retryAfter }, {
      status: 429,
      headers: { 'retry-after': String(rl.retryAfter) },
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid-json' }, { status: 400 }); }

  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!username || !password) {
    await recordRateLimitHit(env, ip);
    return json({ error: 'missing-fields' }, { status: 400 });
  }

  // Lazy-seed the initial admin on first ever login attempt.
  await getOrSeedAdmin(env);

  const user = await getUser(env, username);
  // Always run verifyPassword even on no-such-user, to keep response time
  // constant and avoid a username-enumeration oracle.
  const dummy = '$pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(password, user?.password_hash || dummy);

  if (!user || !ok) {
    await recordRateLimitHit(env, ip);
    await audit(env, request, null, 'login.failed', { username });
    return unauthorized('bad-credentials');
  }

  await clearRateLimit(env, ip);
  const { token } = await createSession(env, user, request);
  await audit(env, request, { username: user.username }, 'login.success', {});

  return json({
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      must_change_password: !!user.must_change_password,
    },
  }, {
    headers: { 'set-cookie': setCookieHeader(token) },
  });
}
