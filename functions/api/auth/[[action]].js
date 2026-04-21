const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const TRIAL_DURATION_MS = 2 * 24 * 3600 * 1000;

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
    if (method === 'POST' && action === 'telegram') return handleTelegramLogin(request, env);
    if (method === 'GET' && action === 'me') return handleMe(request, env);
    if (method === 'POST' && action === 'logout') return handleLogout(request, env);
    return json({ error: 'not found', action, method }, 404);
  } catch (err) {
    return json({ error: 'internal', detail: String(err.message || err) }, 500);
  }
}
