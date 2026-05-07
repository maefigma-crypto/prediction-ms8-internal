// POST /api/auth/change-password
// Body: { current_password, new_password }
//
// Required after the first-time login when must_change_password=true.
// Enforces a minimum of 12 characters with at least one digit and one
// non-letter — modest, OWASP-aligned policy.

import {
  getCookie, readSession, getUser, saveUser,
  verifyPassword, hashPassword,
  destroySession, audit, json, unauthorized,
} from '../../_lib/auth.js';

function policyCheck(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'too-short (min 12 chars)';
  if (!/\d/.test(pw)) return 'must-contain-digit';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'must-contain-symbol';
  if (/^(.)\1+$/.test(pw)) return 'too-repetitive';
  return null;
}

export async function onRequestPost({ request, env }) {
  const token = getCookie(request);
  const session = await readSession(env, token);
  if (!session) return unauthorized();

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid-json' }, { status: 400 }); }

  const current = String(body?.current_password || '');
  const next    = String(body?.new_password || '');

  if (!current || !next) return json({ error: 'missing-fields' }, { status: 400 });

  const policyErr = policyCheck(next);
  if (policyErr) return json({ error: 'weak-password', detail: policyErr }, { status: 400 });

  const user = await getUser(env, session.username);
  if (!user) return unauthorized('user-missing');
  const ok = await verifyPassword(current, user.password_hash);
  if (!ok) return json({ error: 'wrong-current-password' }, { status: 401 });

  user.password_hash         = await hashPassword(next);
  user.must_change_password  = false;
  user.password_changed_at   = Date.now();
  await saveUser(env, user);

  // Invalidate the current session so the user logs back in with the new pw.
  await destroySession(env, token);

  await audit(env, request, session, 'password.changed', {});
  return json({ ok: true }, {
    headers: {
      'set-cookie': '__Host-OcsSession=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    },
  });
}
