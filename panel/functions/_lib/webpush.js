// Web Push send for Cloudflare Workers — pure Web Crypto, no deps.
//
// Implements:
//   - VAPID JWT (ES256) signing per push endpoint origin (RFC 8292)
//   - Payload encryption (aes128gcm content-encoding, RFC 8291)
//   - HTTP send to the subscriber's push endpoint
//
// References:
//   RFC 8291 — Message Encryption for Web Push
//   RFC 8292 — VAPID for Web Push
//   RFC 8030 — Generic Event Delivery Using HTTP Push
//
// Security: payload is end-to-end encrypted between this Worker and the
// subscriber's browser. The push provider (FCM / Mozilla / Apple) sees only
// ciphertext.

// ─── base64url helpers ──────────────────────────────────────────────────
const b64urlEncode = bytes => {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = s => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};
const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};

// ─── VAPID JWT (ES256) ──────────────────────────────────────────────────
//
// VAPID requires us to assert "I'm the same server that owns this public
// key" by signing a JWT addressed to the audience (the push endpoint origin).
// The push endpoint validates the signature using the VAPID public key we
// also send in the Authorization header.

async function importVapidPrivateKey(privateKeyB64Url, publicKeyB64Url) {
  // The keys we generated earlier are raw EC scalars / uncompressed points.
  // Web Crypto wants JWK format — extract X, Y from the public point.
  const pubBytes = b64urlDecode(publicKeyB64Url);            // 65 bytes: 0x04 || X(32) || Y(32)
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('vapid public key must be 65-byte uncompressed P-256');
  }
  const x = b64urlEncode(pubBytes.slice(1, 33));
  const y = b64urlEncode(pubBytes.slice(33, 65));
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64Url,
    x, y,
    ext: false,
  };
  return crypto.subtle.importKey('jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
}

async function signVapidJwt(privateKey, audience, subject) {
  const header  = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,         // 12h TTL
    sub: subject,
  })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  // Web Crypto returns IEEE P1363 (r||s) which is what JWT ES256 needs.
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ─── Payload encryption (aes128gcm, RFC 8291) ────────────────────────────

async function hkdf(salt, ikm, info, length) {
  const baseKey = await crypto.subtle.importKey(
    'raw', ikm, { name: 'HKDF' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey, length * 8
  );
  return new Uint8Array(bits);
}

async function ecdhSharedSecret(serverPriv, subscriberPubBytes) {
  const subPubX = subscriberPubBytes.slice(1, 33);
  const subPubY = subscriberPubBytes.slice(33, 65);
  const subPubKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(subPubX), y: b64urlEncode(subPubY),
    ext: true,
  }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subPubKey }, serverPriv, 256
  );
  return new Uint8Array(bits);
}

async function encryptPayload(plaintext, subscriberP256dhB64, subscriberAuthB64) {
  // Generate ephemeral server keypair for this single message.
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveBits']
  );
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));   // 65 bytes
  const subPub  = b64urlDecode(subscriberP256dhB64);          // 65 bytes
  const subAuth = b64urlDecode(subscriberAuthB64);            // 16 bytes

  const sharedSecret = await ecdhSharedSecret(ephemeral.privateKey, subPub);

  // PRK_key derivation (RFC 8291 §3.3).
  const keyInfo = concat(
    new TextEncoder().encode('WebPush: info\0'),
    subPub,
    ephemeralRaw,
  );
  const ikmForCek = await hkdf(subAuth, sharedSecret, keyInfo, 32);

  // Salt + content encryption key + nonce.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo  = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  // RFC 8188 spec: HKDF info has a trailing 0x01 byte for the first (only) block.
  const cek   = await hkdf(salt, ikmForCek, concat(cekInfo, new Uint8Array([0x01])),  16);
  const nonce = await hkdf(salt, ikmForCek, concat(nonceInfo, new Uint8Array([0x01])), 12);

  // Pad: plaintext || 0x02 (single record, not last) — wait, for single
  // record we use 0x02 as the record delimiter. For ONE record, RFC 8291
  // says append 0x02 for the last block.
  const padded = concat(plaintext, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(0) },
    aesKey, padded
  ));

  // Header: salt(16) || rs(4 BE) || idlen(1) || keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);    // record size = 4096
  const idlen = new Uint8Array([ephemeralRaw.length]);  // 65
  const body = concat(salt, rs, idlen, ephemeralRaw, ciphertext);

  return body;
}

// ─── Public sender ───────────────────────────────────────────────────────
//
// payload: object that will be JSON.stringify'd and encrypted, e.g.
//   { title, body, url, tag }
//
// Returns: { status, ok, gone (true if 410, subscriber should be deleted) }

export async function sendPush(env, subscription, payload) {
  const vapidPub  = env.VAPID_PUBLIC_KEY  || env.VAPID_PUBLIC;
  const vapidPriv = env.VAPID_PRIVATE_KEY || env.VAPID_PRIVATE;
  const vapidSub  = env.VAPID_SUBJECT     || 'mailto:admin@scoreocs8.com';
  if (!vapidPub || !vapidPriv) throw new Error('VAPID keys not configured');

  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;

  // VAPID JWT signed for THIS audience. Browsers reject mismatches.
  const privKey = await importVapidPrivateKey(vapidPriv, vapidPub);
  const jwt = await signVapidJwt(privKey, audience, vapidSub);

  // Encrypt the payload to the subscriber.
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const body = await encryptPayload(json, subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'authorization': `vapid t=${jwt}, k=${vapidPub}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      'ttl': '86400',                                   // 24h
    },
    body,
  });

  return {
    status: res.status,
    ok: res.ok,
    gone: res.status === 410 || res.status === 404,
  };
}
