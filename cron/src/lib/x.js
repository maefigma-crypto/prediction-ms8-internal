// X (Twitter) adapter — media upload + tweet create with OAuth 1.0a.
//
// X's free tier still requires OAuth 1.0a for v1.1 media upload (the only
// free media-upload endpoint). We sign requests with HMAC-SHA1 via the
// Web Crypto API which is available natively in Cloudflare Workers.
//
// Required secrets:
//   X_API_KEY            (a.k.a. Consumer Key)
//   X_API_KEY_SECRET     (a.k.a. Consumer Secret)
//   X_ACCESS_TOKEN
//   X_ACCESS_TOKEN_SECRET
//
// Free tier limits: 500 tweets/month = ~16/day. We post 1/day + a few
// result cards = well under. Upgrade to Basic ($100/mo) for 3k/mo if
// you need more headroom later.

const MEDIA_UPLOAD = 'https://upload.twitter.com/1.1/media/upload.json';
const TWEETS_V2 = 'https://api.twitter.com/2/tweets';

// RFC 3986 percent-encode (stricter than encodeURIComponent — includes ! ' ( ) *).
function pctEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmacSha1Base64(keyStr, msgStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
  // btoa needs a binary string
  let bin = '';
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Build the OAuth 1.0a Authorization header for a given request.
// `extraParams` is the map of form-encoded body params (for url-encoded POSTs)
// OR an empty object for multipart POSTs (the oauth_ params go into signature,
// the file body does not).
async function buildAuthHeader(env, method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // Include query string params from the URL in the signature base
  const u = new URL(url);
  const queryParams = {};
  for (const [k, v] of u.searchParams.entries()) queryParams[k] = v;

  const allParams = { ...oauthParams, ...queryParams, ...extraParams };
  const paramStr = Object.keys(allParams).sort()
    .map(k => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join('&');

  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const sigBase = `${method.toUpperCase()}&${pctEncode(baseUrl)}&${pctEncode(paramStr)}`;
  const sigKey = `${pctEncode(env.X_API_KEY_SECRET)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1Base64(sigKey, sigBase);

  const authParams = { ...oauthParams, oauth_signature: signature };
  return 'OAuth ' + Object.keys(authParams).sort()
    .map(k => `${pctEncode(k)}="${pctEncode(authParams[k])}"`)
    .join(', ');
}

// Upload raw bytes to v1.1 media/upload (simple upload; works for < 5MB PNG).
async function uploadMedia(env, pngBytes) {
  const auth = await buildAuthHeader(env, 'POST', MEDIA_UPLOAD, {});

  const form = new FormData();
  form.append('media', new Blob([pngBytes], { type: 'image/png' }), 'snap.png');

  const res = await fetch(MEDIA_UPLOAD, {
    method: 'POST',
    headers: { Authorization: auth },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.media_id_string) {
    throw new Error(`X media upload ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.media_id_string;
}

// Create a tweet. OAuth 1.0a is still required for the v2 endpoint on the
// free tier when attaching media. Body is JSON so no form params go in sig.
async function createTweet(env, { text, mediaId }) {
  const auth = await buildAuthHeader(env, 'POST', TWEETS_V2, {});
  const body = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };

  const res = await fetch(TWEETS_V2, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X create tweet ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.data;
}

function assertCreds(env) {
  const need = ['X_API_KEY', 'X_API_KEY_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) throw new Error(`X secrets missing: ${missing.join(', ')}`);
}

// Public API: post a photo + caption to X.
export async function postPhoto(env, { photoBytes, text }) {
  assertCreds(env);
  const mediaId = await uploadMedia(env, photoBytes);
  const tweet = await createTweet(env, { text, mediaId });
  return { tweetId: tweet.id, text: tweet.text, mediaId };
}

// Text-only fallback (cheaper on API usage). Good for result recap posts
// where the image would repeat the previous daily post.
export async function postText(env, { text }) {
  assertCreds(env);
  const tweet = await createTweet(env, { text });
  return { tweetId: tweet.id, text: tweet.text };
}
