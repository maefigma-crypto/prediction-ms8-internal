const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const TRIAL_DURATION_MS = 2 * 24 * 3600 * 1000;
const OAUTH_STATE_TTL = 600;

const TG_OIDC_DISCOVERY = 'https://oauth.telegram.org/.well-known/openid-configuration';
const TG_FALLBACK = {
  authorization_endpoint: 'https://oauth.telegram.org/auth',
  token_endpoint: 'https://oauth.telegram.org/token',
  userinfo_endpoint: null,
};

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

/* ── Classic widget hash verification (POST /api/auth/telegram) ── */
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

/* ── OAuth 2.0 / OIDC flow (GET /api/auth/telegram/start + /callback) ── */
async function getTgOidc(env) {
  const cached = await env.CACHE.get('oidc:telegram:v2', 'json');
  if (cached) return cached;
  try {
    const res = await fetch(TG_OIDC_DISCOVERY);
    if (res.ok) {
      const doc = await res.json();
      const endpoints = {
        authorization_endpoint: doc.authorization_endpoint || TG_FALLBACK.authorization_endpoint,
        token_endpoint: doc.token_endpoint || TG_FALLBACK.token_endpoint,
        userinfo_endpoint: doc.userinfo_endpoint || null,
      };
      await env.CACHE.put('oidc:telegram:v2', JSON.stringify(endpoints), { expirationTtl: 3600 });
      return endpoints;
    }
  } catch (_) { /* use fallback */ }
  return TG_FALLBACK;
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

async function handleTelegramOauthStart(request, env) {
  if (!env.TELEGRAM_CLIENT_ID) return json({ error: 'TELEGRAM_CLIENT_ID not set' }, 500);
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/telegram/callback`;
  const state = randomHex(16);
  await env.CACHE.put(`oauth-state:tg:${state}`, '1', { expirationTtl: OAUTH_STATE_TTL });

  const { authorization_endpoint } = await getTgOidc(env);
  const authUrl = new URL(authorization_endpoint);
  authUrl.searchParams.set('client_id', env.TELEGRAM_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('state', state);
  return Response.redirect(authUrl.toString(), 302);
}

async function handleTelegramOauthCallback(request, env) {
  if (!env.TELEGRAM_CLIENT_ID || !env.TELEGRAM_CLIENT_SECRET) {
    return json({ error: 'Telegram OAuth not configured' }, 500);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (err) return json({ error: 'telegram rejected', detail: err, description: url.searchParams.get('error_description') }, 400);
  if (!code || !state) return json({ error: 'missing code or state' }, 400);

  const stateValid = await env.CACHE.get(`oauth-state:tg:${state}`);
  if (!stateValid) return json({ error: 'invalid or expired state' }, 400);
  await env.CACHE.delete(`oauth-state:tg:${state}`);

  const { token_endpoint, userinfo_endpoint } = await getTgOidc(env);
  const redirectUri = `${url.origin}/api/auth/telegram/callback`;

  const tokenRes = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.TELEGRAM_CLIENT_ID,
      client_secret: env.TELEGRAM_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) {
    return json({ error: 'token exchange failed', status: tokenRes.status, detail: await tokenRes.text().catch(() => '') }, 502);
  }
  const tokens = await tokenRes.json();

  let profile = null;
  if (userinfo_endpoint && tokens.access_token) {
    const userRes = await fetch(userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (userRes.ok) profile = await userRes.json();
  }
  if (!profile && tokens.id_token) profile = decodeJwtPayload(tokens.id_token);
  if (!profile) return json({ error: 'no user profile in token response', tokens }, 502);

  const tgId = profile.sub || profile.id || profile.user_id;
  if (!tgId) return json({ error: 'profile missing subject', profile }, 502);

  const user = await upsertUser(env, 'telegram', tgId, {
    name: profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.preferred_username || null,
    avatar: profile.picture || null,
    email: profile.email || null,
  });
  const sid = await createSession(env, `user:telegram:${tgId}`);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': sessionCookie(sid),
    },
  });
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
    // Classic widget (hash-verified): primary, guaranteed to work.
    if (method === 'POST' && action === 'telegram') return handleTelegramLogin(request, env);
    // OAuth 2.0 / OIDC: alternative, for when Telegram rolls out reliably.
    if (method === 'GET' && action === 'telegram/start') return handleTelegramOauthStart(request, env);
    if (method === 'GET' && action === 'telegram/callback') return handleTelegramOauthCallback(request, env);
    if (method === 'GET' && action === 'me') return handleMe(request, env);
    if (method === 'POST' && action === 'logout') return handleLogout(request, env);
    return json({ error: 'not found', action, method }, 404);
  } catch (err) {
    return json({ error: 'internal', detail: String(err.message || err) }, 500);
  }
}
