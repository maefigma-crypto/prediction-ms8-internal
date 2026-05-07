// OCS-super-panel — middleware that runs before EVERY function call.
// Enforces session auth on /api/* except whitelisted public auth routes.
//
// Static HTML pages are served by Pages directly and don't pass through
// here — the JS in those pages calls /api/auth/me to decide what UI to show.

import { getCookie, readSession, unauthorized, json } from './_lib/auth.js';

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/health',
]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Only gate API routes — static assets are handled outside Functions.
  if (!url.pathname.startsWith('/api/')) return next();

  // Public routes don't require session.
  if (PUBLIC_PATHS.has(url.pathname)) return next();

  // Verify session.
  const token = getCookie(request);
  const session = await readSession(env, token);
  if (!session) return unauthorized('session-required');

  // Block force-change-password users from doing anything except changing
  // their password.
  if (session.must_change_password && url.pathname !== '/api/auth/change-password') {
    return json({ error: 'must-change-password' }, { status: 403 });
  }

  // CSRF: require Origin/Referer to match same origin for state-changing
  // methods. SameSite=Strict already protects but this is belt-and-suspenders.
  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    if (origin && !origin.startsWith(url.origin)) {
      return json({ error: 'csrf-origin-mismatch' }, { status: 403 });
    }
  }

  // Stash the session on the context so handlers can read session.username.
  context.data = { ...(context.data || {}), session };
  return next();
}
