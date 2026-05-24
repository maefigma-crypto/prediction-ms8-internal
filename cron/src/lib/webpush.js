// Web Push (RFC 8291, aes128gcm content encoding) + VAPID auth (RFC 8292).
// Pure Web Crypto API — no Node libraries, runs in Cloudflare Workers.
//
// Public API:
//   sendPush(env, subscription, payloadObj)
//     → { status: 'ok' | 'gone' | 'error', code, error? }
//   broadcastPush(env, payloadObj)
//     → { sent, removed, errors, total, results? }
//
// Required env:
//   env.VAPID_PRIVATE_KEY  (base64url-encoded 32-byte secret)
//   env.VAPID_PUBLIC_KEY   (optional; falls back to the hard-coded public key)
//   env.VAPID_SUBJECT      (optional; e.g. mailto:admin@scoreocs8.com)
//
// Subscription shape (as captured by /api/push/subscribe):
//   { endpoint: string, keys: { p256dh: string, auth: string }, ... }

const ENC = new TextEncoder();

// Fallback public key — matches the one served by /api/push/config so existing
// subscriptions stay valid even if the env var isn't set.
const FALLBACK_PUB = 'BB4VbycFeH5MKGIrIuEX7AzzFih61rEdvEN7x3Mvo8Sn4GvwZrXk24nsGyGUy3MiEDKSBFMvZhnbpAwmqUNy-b4';

// --- Base64URL helpers ------------------------------------------------------

function b64uEncode(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(str) {
  const pad = '='.repeat((4 - str.length % 4) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// --- VAPID JWT signing (ES256) ----------------------------------------------

// Web Crypto can't import a raw 32-byte EC private key directly — it needs the
// matching public x/y. We derive x/y from the well-known VAPID public key.
async function importVapidEcdsa(privB64u, pubB64u) {
  const pub = b64uDecode(pubB64u);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('vapid-public-key-bad');
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: privB64u,
  };
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
}

async function signVapidJwt(privateKey, audience, subject) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // 12h validity
    sub: subject,
  };
  const headerB64 = b64uEncode(ENC.encode(JSON.stringify(header)));
  const payloadB64 = b64uEncode(ENC.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    ENC.encode(signingInput)
  );
  return `${signingInput}.${b64uEncode(sig)}`;
}

// --- ECDH + HKDF + payload encryption (RFC 8291 aes128gcm) ------------------

async function importClientEcdhPub(p256dhB64u) {
  const pub = b64uDecode(p256dhB64u);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('client-pub-bad');
  return crypto.subtle.importKey(
    'raw', pub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
}

async function generateEcdhKeypair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveBits']
  );
}

async function exportEcdhPub(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return new Uint8Array(raw); // uncompressed: 0x04 || X(32) || Y(32) = 65 bytes
}

async function deriveSharedSecret(serverPriv, clientPub) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPub },
    serverPriv,
    256
  );
  return new Uint8Array(bits);
}

async function hkdf(salt, ikm, info, lengthBytes) {
  const base = await crypto.subtle.importKey(
    'raw', ikm, { name: 'HKDF' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    base,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

// Encrypt a single-record aes128gcm Web Push body. Returns the full HTTP body
// bytes (16-byte salt + 4-byte rs + 1-byte idlen + 65-byte server-pub + ciphertext).
async function encryptAes128gcm(payload, clientP256dhB64u, clientAuthB64u) {
  const clientPub = await importClientEcdhPub(clientP256dhB64u);
  const auth = b64uDecode(clientAuthB64u); // 16 bytes
  const server = await generateEcdhKeypair();
  const serverPubRaw = await exportEcdhPub(server.publicKey);
  const sharedSecret = await deriveSharedSecret(server.privateKey, clientPub);

  // PRK_key: HKDF(salt=auth, IKM=sharedSecret,
  //               info="WebPush: info\0" || clientPub || serverPub, L=32)
  const clientPubRaw = b64uDecode(clientP256dhB64u);
  const keyInfo = concat(
    ENC.encode('WebPush: info\0'),
    clientPubRaw,
    serverPubRaw
  );
  const prkKey = await hkdf(auth, sharedSecret, keyInfo, 32);

  // Content-encoding salt — fresh random 16 bytes per message.
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // CEK = HKDF(salt=salt, IKM=prkKey, info="Content-Encoding: aes128gcm\0", L=16)
  const cek = await hkdf(salt, prkKey, ENC.encode('Content-Encoding: aes128gcm\0'), 16);
  // Nonce = HKDF(salt=salt, IKM=prkKey, info="Content-Encoding: nonce\0", L=12)
  const nonce = await hkdf(salt, prkKey, ENC.encode('Content-Encoding: nonce\0'), 12);

  // Plaintext for single (last) record: payload || 0x02 delimiter.
  const plaintext = concat(
    payload instanceof Uint8Array ? payload : ENC.encode(payload),
    new Uint8Array([0x02])
  );

  const cekKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cekKey, plaintext
  ));

  // aes128gcm content-encoding header (RFC 8188):
  //   salt(16) | rs(4 BE) | idlen(1) | keyid(idlen)
  // For Web Push the keyid IS the server's uncompressed ECDH public key.
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + serverPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = serverPubRaw.length;
  header.set(serverPubRaw, 21);

  return concat(header, ciphertext);
}

// --- Public API -------------------------------------------------------------

// Send a single push. payloadObj is JSON-stringified (sw.js parses with .json()).
// Returns { status, code?, error? }.
//   status: 'ok'    → delivered (201/200)
//   status: 'gone'  → subscription removed by browser (404/410); caller should
//                     delete from KV
//   status: 'error' → transient failure; caller can retry next tick
export async function sendPush(env, sub, payloadObj) {
  if (!env.VAPID_PRIVATE_KEY) {
    return { status: 'error', error: 'no-vapid-private-key' };
  }
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { status: 'error', error: 'invalid-subscription' };
  }

  const pub = env.VAPID_PUBLIC_KEY || FALLBACK_PUB;
  const subject = env.VAPID_SUBJECT || 'mailto:admin@scoreocs8.com';

  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const vapidKey = await importVapidEcdsa(env.VAPID_PRIVATE_KEY, pub);
    const jwt = await signVapidJwt(vapidKey, audience, subject);

    const body = await encryptAes128gcm(
      ENC.encode(JSON.stringify(payloadObj)),
      sub.keys.p256dh, sub.keys.auth
    );

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400', // 24h — push services drop messages older than this
        'Authorization': `vapid t=${jwt}, k=${pub}`,
      },
      body,
    });

    if (res.status === 201 || res.status === 200) {
      return { status: 'ok', code: res.status };
    }
    if (res.status === 404 || res.status === 410) {
      return { status: 'gone', code: res.status };
    }
    let errText = '';
    try { errText = (await res.text()).slice(0, 200); } catch {}
    return { status: 'error', code: res.status, error: errText || `http-${res.status}` };
  } catch (e) {
    return { status: 'error', error: String(e?.message || e) };
  }
}

// Broadcast to every subscriber under push:scoreocs8:*.
// Sends in parallel (Promise.allSettled) — Workers handle many concurrent
// fetches fine. Cleans up 410/404 entries from KV.
export async function broadcastPush(env, payloadObj) {
  const report = { total: 0, sent: 0, removed: 0, errors: 0 };
  if (!env.CACHE) {
    return { ...report, status: 'skipped', reason: 'no kv' };
  }
  if (!env.VAPID_PRIVATE_KEY) {
    return { ...report, status: 'skipped', reason: 'no vapid private key' };
  }

  // Page through KV; each list returns up to 1000 keys.
  const subs = [];
  let cursor;
  for (;;) {
    const page = await env.CACHE.list({ prefix: 'push:scoreocs8:', cursor });
    for (const k of page.keys) subs.push(k.name);
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  report.total = subs.length;
  if (!subs.length) return { ...report, status: 'ok', reason: 'no subscribers' };

  // Load + send in parallel.
  const work = subs.map(async key => {
    let sub;
    try { sub = JSON.parse(await env.CACHE.get(key) || 'null'); } catch { sub = null; }
    if (!sub) return { key, result: { status: 'error', error: 'bad-record' } };
    const result = await sendPush(env, sub, payloadObj);
    if (result.status === 'gone') {
      await env.CACHE.delete(key);
    }
    return { key, result };
  });
  const settled = await Promise.allSettled(work);

  for (const s of settled) {
    if (s.status !== 'fulfilled') { report.errors += 1; continue; }
    const r = s.value.result;
    if (r.status === 'ok') report.sent += 1;
    else if (r.status === 'gone') report.removed += 1;
    else report.errors += 1;
  }
  return { ...report, status: 'ok' };
}
