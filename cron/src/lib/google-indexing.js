// Google Indexing API — ask Google to (re)crawl updated URLs fast.
//
// Complements IndexNow (Bing/Yandex). Signs a service-account JWT with the
// Web Crypto API, exchanges it for an access token, then POSTs each URL to
// urlNotifications:publish.
//
// One-time setup:
//   1. Google Cloud Console → create a Service Account → enable the
//      "Indexing API" for the project.
//   2. Create a JSON key for that service account.
//   3. Google Search Console → your property → Settings → Users and
//      permissions → add the service account's client_email as an *Owner*.
//   4. Set Worker secrets (wrangler secret put ...):
//        GOOGLE_SA_EMAIL = the service account client_email
//        GOOGLE_SA_KEY   = the private_key PEM (literal \n or real newlines ok)
//
// Note: Google officially scopes this API to JobPosting / BroadcastEvent
// pages. It accepts other URLs but treat it as best-effort — keep the sitemap
// + IndexNow as the primary discovery path.

function b64urlFromString(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromBytes(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem) {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const email = env.GOOGLE_SA_EMAIL;
  const key = env.GOOGLE_SA_KEY;
  if (!email || !key) throw new Error('GOOGLE_SA_EMAIL / GOOGLE_SA_KEY not set');

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlFromString(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const data = `${header}.${claim}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(data),
  );
  const jwt = `${data}.${b64urlFromBytes(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('no access_token in token response');
  return json.access_token;
}

// Publish up to 100 URLs to the Indexing API. type: URL_UPDATED | URL_DELETED.
export async function googleIndexUrls(env, urls = [], type = 'URL_UPDATED') {
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) {
    return { status: 'skipped', reason: 'google indexing not configured (set GOOGLE_SA_EMAIL / GOOGLE_SA_KEY)' };
  }
  const list = [...new Set((urls || []).filter(Boolean))].slice(0, 100);
  if (!list.length) return { status: 'skipped', reason: 'no urls' };

  let token;
  try { token = await getAccessToken(env); }
  catch (e) { return { status: 'error', stage: 'token', error: String(e.message || e) }; }

  const results = [];
  for (const url of list) {
    try {
      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url, type }),
      });
      results.push({ url, status: res.status, ...(res.ok ? {} : { body: (await res.text().catch(() => '')).slice(0, 160) }) });
    } catch (e) {
      results.push({ url, error: String(e.message || e) });
    }
  }
  const ok = results.filter(r => r.status === 200).length;
  return { status: 'ok', submitted: list.length, ok, results };
}
