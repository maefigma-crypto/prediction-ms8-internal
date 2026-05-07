// GET /api/auth/me — returns the current session's user info, or 401 if not
// signed in. Used by the panel's JS on every page load to decide what UI
// to show.

import { getCookie, readSession, json } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const token = getCookie(request);
  const session = await readSession(env, token);
  if (!session) return json({ authenticated: false }, { status: 401 });
  return json({
    authenticated: true,
    user: {
      username: session.username,
      role: session.role,
      must_change_password: !!session.must_change_password,
    },
    expires_at: session.expires_at,
  });
}
