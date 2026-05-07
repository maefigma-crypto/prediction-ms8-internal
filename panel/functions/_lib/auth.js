// OCS-super-panel — auth + session library.
//
// Cloudflare Workers don't have native Argon2id, so we use PBKDF2-SHA256
// with 600,000 iterations (OWASP 2024 minimum). For the threat model of a
// 1-3 admin panel behind Cloudflare Access, this is more than sufficient.
//
// Session tokens are 32 random bytes, given to the browser as an opaque
// __Host-prefixed cookie. The token is hashed (SHA-256) before being used
// as a KV key, so a KV dump can't be replayed as live sessions.

const PBKDF2_ITERATIONS = 600000;
const SALT_BYTES        = 16;
const KEY_BYTES         = 32;
const SESSION_TTL_SEC   = 24 * 60 * 60;          // 24h absolute
const SESSION_IDLE_SEC  = 60 * 60;               // 1h sliding idle
const COOKIE_NAME       = '__Host-OcsSession';

// ─── Encoding helpers ────────────────────────────────────────────────────
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = s => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};

// Constant-time string compare (avoid timing attacks on session lookups).
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Password hashing (PBKDF2-SHA256) ────────────────────────────────────
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key  = await deriveKey(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(key)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = parseInt(parts[1], 10);
  const salt  = b64urlDecode(parts[2]);
  const want  = parts[3];
  const key   = await deriveKey(password, salt, iters);
  return timingSafeEqual(b64url(key), want);
}

async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey, KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

// ─── Session tokens ──────────────────────────────────────────────────────
export async function createSession(env, user, request) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const session = {
    user_id: user.id || user.username,
    username: user.username,
    role: user.role || 'admin',
    created_at: now,
    last_active: now,
    expires_at: now + SESSION_TTL_SEC * 1000,
    ip: request.headers.get('cf-connecting-ip') || '',
    ua: request.headers.get('user-agent') || '',
    must_change_password: !!user.must_change_password,
  };
  await env.CACHE.put(`session:${tokenHash}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SEC,
  });
  return { token, session };
}

export async function readSession(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const raw = await env.CACHE.get(`session:${tokenHash}`);
  if (!raw) return null;
  let s; try { s = JSON.parse(raw); } catch { return null; }
  const now = Date.now();
  if (s.expires_at && s.expires_at < now) return null;
  if (s.last_active && (now - s.last_active) > SESSION_IDLE_SEC * 1000) return null;
  // Sliding idle refresh.
  s.last_active = now;
  await env.CACHE.put(`session:${tokenHash}`, JSON.stringify(s), {
    expirationTtl: SESSION_TTL_SEC,
  });
  return s;
}

export async function destroySession(env, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.CACHE.delete(`session:${tokenHash}`);
}

export async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Cookie helpers ──────────────────────────────────────────────────────
export function getCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get('cookie') || '';
  const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

export function setCookieHeader(token, maxAge = SESSION_TTL_SEC) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// ─── Admin user ─────────────────────────────────────────────────────────
// Lazy seed on first hit: if no admin exists, create one with the seed
// password. The user MUST change it on first login.
export const SEED_USERNAME = 'admin';
export const SEED_PASSWORD = 'admin123';

export async function getOrSeedAdmin(env) {
  const key = `auth:user:${SEED_USERNAME}`;
  const existing = await env.CACHE.get(key);
  if (existing) {
    try { return JSON.parse(existing); } catch { /* fallthrough — re-seed */ }
  }
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const user = {
    id: SEED_USERNAME,
    username: SEED_USERNAME,
    role: 'admin',
    password_hash: passwordHash,
    must_change_password: true,
    created_at: Date.now(),
  };
  await env.CACHE.put(key, JSON.stringify(user));
  return user;
}

export async function getUser(env, username) {
  const raw = await env.CACHE.get(`auth:user:${username}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function saveUser(env, user) {
  await env.CACHE.put(`auth:user:${user.username}`, JSON.stringify(user));
}

// ─── Rate limiting (login bruteforce protection) ─────────────────────────
const RL_WINDOW_SEC = 15 * 60;
const RL_MAX        = 5;

export async function checkRateLimit(env, key) {
  const k = `rl:login:${key}`;
  const raw = await env.CACHE.get(k);
  let count = 0;
  if (raw) { try { count = JSON.parse(raw).c || 0; } catch {} }
  if (count >= RL_MAX) return { allowed: false, remaining: 0, retryAfter: RL_WINDOW_SEC };
  return { allowed: true, remaining: RL_MAX - count - 1, count };
}

export async function recordRateLimitHit(env, key) {
  const k = `rl:login:${key}`;
  const raw = await env.CACHE.get(k);
  let count = 0;
  if (raw) { try { count = JSON.parse(raw).c || 0; } catch {} }
  await env.CACHE.put(k, JSON.stringify({ c: count + 1 }), { expirationTtl: RL_WINDOW_SEC });
}

export async function clearRateLimit(env, key) {
  await env.CACHE.delete(`rl:login:${key}`);
}

// ─── Audit log ──────────────────────────────────────────────────────────
export async function audit(env, request, session, action, meta = {}) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(8)));
  const now = Date.now();
  const entry = {
    id,
    ts: now,
    action,
    user: session?.username || 'anonymous',
    ip: request.headers.get('cf-connecting-ip') || '',
    ua: request.headers.get('user-agent') || '',
    country: request.headers.get('cf-ipcountry') || '',
    meta,
  };
  // Time-prefixed key so we can scan recent-first via list({prefix}).
  // Inverse timestamp = far future minus now → newest entries have the
  // smallest key, so list() returns them first.
  const inv = String(9_999_999_999_999 - now).padStart(13, '0');
  await env.CACHE.put(`audit:${inv}:${id}`, JSON.stringify(entry), {
    expirationTtl: 90 * 24 * 3600,                // 90-day retention
  });
}

// ─── JSON response helpers ──────────────────────────────────────────────
export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function unauthorized(reason = 'unauthorized') {
  return json({ error: reason }, { status: 401 });
}
