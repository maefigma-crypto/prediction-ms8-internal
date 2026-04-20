const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const TRIAL_DURATION_MS = 2 * 24 * 3600 * 1000;
const OAUTH_STATE_TTL = 600;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(id) {
  return `sid=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearCookie() {
  return 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(keyData, msg) {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(msg) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return new Uint8Array(hash);
}

async function upsertUser(env, provider, providerId, profile) {
  const key = `user:${provider}:${providerId}`;
  const existing = await env.CACHE.get(key, 'json');
  if (existing) {
    const merged = { ...existing, ...profile, lastLoginAt: Date.now() };
    await env.CACHE.put(key, JSON.stringify(merged));
    return merged;
  }
  const now = Date.now();
  const user = {
    id: `${provider}:${providerId}`,
    provider,
    providerId: String(providerId),
    email: profile.email || null,
    name: profile.name || null,
    avatar: profile.avatar || null,
    createdAt: now,
    trialEndsAt: now + TRIAL_DURATION_MS,
    paid: false,
    lastLoginAt: now,
  };
  await env.CACHE.put(key, JSON.stringify(user));
  return user;
}

async function createSession(env, userKey) {
  const id = randomHex(16);
  const session = { id, userKey, createdAt: Date.now() };
  await env.CACHE.put(`session:${id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return id;
}

async function readSession(env, request) {
  const sid = getCookie(request, 'sid');
  if (!sid) return null;
  const session = await env.CACHE.get(`session:${sid}`, 'json');
  if (!session) return null;
  const user = await env.CACHE.get(session.userKey, 'json');
  if (!user) return null;
  return { session, user };
}

function publicUser(user) {
  const now = Date.now();
  const onTrial = !user.paid && now < user.trialEndsAt;
  return {
    id: user.id,
    provider: user.provider,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    paid: user.paid,
    onTrial,
    trialEndsAt: user.trialEndsAt,
    hasAccess: user.paid || onTrial,
  };
}

async function handleGoogleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'GOOGLE_CLIENT_ID not set' }, 500);
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const state = randomHex(12);
  await env.CACHE.put(`oauth-state:${state}`, '1', { expirationTtl: OAUTH_STATE_TTL });
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('prompt', 'select_account');
  return Response.redirect(authUrl.toString(), 302);
}

async function handleGoogleCallback(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: 'Google OAuth not configured' }, 500);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return json({ error: 'missing code or state' }, 400);

  const stateValid = await env.CACHE.get(`oauth-state:${state}`);
  if (!stateValid) return json({ error: 'invalid or expired state' }, 400);
  await env.CACHE.delete(`oauth-state:${state}`);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return json({ error: 'token exchange failed', detail: await tokenRes.text() }, 502);
  const tokens = await tokenRes.json();

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) return json({ error: 'userinfo failed' }, 502);
  const gUser = await userRes.json();

  const user = await upsertUser(env, 'google', gUser.sub, {
    email: gUser.email,
    name: gUser.name,
    avatar: gUser.picture,
  });
  const sid = await createSession(env, `user:google:${gUser.sub}`);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': sessionCookie(sid),
    },
  });
}

async function handleTelegramLogin(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN not set' }, 500);
  const data = await request.json().catch(() => null);
  if (!data || !data.hash || !data.id) return json({ error: 'invalid telegram payload' }, 400);

  const { hash, ...fields } = data;
  const dataCheckString = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secretKey = await sha256(env.TELEGRAM_BOT_TOKEN);
  const expected = await hmacSha256Hex(secretKey, dataCheckString);
  if (expected !== hash) return json({ error: 'hash mismatch' }, 401);

  const age = Math.floor(Date.now() / 1000) - parseInt(fields.auth_date, 10);
  if (age > 86400) return json({ error: 'auth_date too old' }, 401);

  const user = await upsertUser(env, 'telegram', fields.id, {
    name: [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.username || null,
    avatar: fields.photo_url || null,
    email: null,
  });
  const sid = await createSession(env, `user:telegram:${fields.id}`);

  return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(sid) });
}

async function handleMe(request, env) {
  const s = await readSession(env, request);
  if (!s) return json({ authenticated: false }, 200);
  return json({ authenticated: true, user: publicUser(s.user) });
}

async function handleLogout(request, env) {
  const sid = getCookie(request, 'sid');
  if (sid) await env.CACHE.delete(`session:${sid}`);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = Array.isArray(params.action) ? params.action.join('/') : (params.action || '');
  const method = request.method;

  try {
    if (method === 'GET' && action === 'google/start') return handleGoogleStart(request, env);
    if (method === 'GET' && action === 'google/callback') return handleGoogleCallback(request, env);
    if (method === 'POST' && action === 'telegram') return handleTelegramLogin(request, env);
    if (method === 'GET' && action === 'me') return handleMe(request, env);
    if (method === 'POST' && action === 'logout') return handleLogout(request, env);
    return json({ error: 'not found', action, method }, 404);
  } catch (err) {
    return json({ error: 'internal', detail: String(err.message || err) }, 500);
  }
}
