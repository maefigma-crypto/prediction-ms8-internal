const DEFAULT_API_BASE = 'https://67864891qp14api.238968.com';
const DEFAULT_PARTNER_URL = 'https://pp88fs.ocs8winwinwin.shop/';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pkcs7Pad(bytes) {
  const remainder = bytes.length % 16;
  const pad = remainder === 0 ? 16 : 16 - remainder;
  const padded = new Uint8Array(bytes.length + pad);
  padded.set(bytes);
  padded.fill(pad, bytes.length);
  return padded;
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function encryptPassword(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const rawKey = await sha256Bytes(secret);
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const padded = pkcs7Pad(new TextEncoder().encode(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, padded));
  return bytesToBase64(concatBytes(iv, encrypted));
}

function cleanText(value) {
  return String(value || '').trim();
}

function isMobile(request) {
  return /android|iphone|ipad|mobile/i.test(request.headers.get('user-agent') || '');
}

function readSourceUrl(request, body) {
  return cleanText(body.url) || request.headers.get('referer') || request.headers.get('origin') || '';
}

function partnerTrackingUrl(env, aff, affcampaign) {
  const base = env.OCS8_PARTNER_URL || DEFAULT_PARTNER_URL;
  const url = new URL(base);
  url.searchParams.set('country', 'MY');
  url.searchParams.set('lang', 'en');
  if (affcampaign) url.searchParams.set('affcampaign', affcampaign);
  if (aff) url.searchParams.set('aff', aff);
  return url.toString();
}

async function handlePost({ request, env }) {
  const secret = env.OCS8_REQ_SIGN_KEY || env.REQ_SIGN_KEY;
  if (!secret) return json({ success: false, message: ['OCS8 register API key is not configured.'] }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ success: false, message: ['Invalid JSON body.'] }, 400);

  const username = cleanText(body.username).toLowerCase();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirm_password || body.confirmPassword || '');
  const phoneNumber = cleanText(body.phone_number || body.phoneNumber);

  if (!/^(?=.*[a-z])[a-z0-9]{6,16}$/.test(username)) {
    return json({ success: false, message: ['Username must be 6-16 letters/numbers and include at least one letter.'] }, 422);
  }
  if (password.length < 6 || password !== confirmPassword) {
    return json({ success: false, message: ['Passwords must match and be at least 6 characters.'] }, 422);
  }
  if (!/^(0|60|0060|\+60)1[0-9]{8,9}$/.test(phoneNumber)) {
    return json({ success: false, message: ['Please enter a valid Malaysia phone number.'] }, 422);
  }

  const sourceUrl = readSourceUrl(request, body);
  let sourceAff = '';
  let sourceCampaign = '';
  try {
    const parsed = new URL(sourceUrl);
    sourceAff = parsed.searchParams.get('aff') || parsed.searchParams.get('ref') || parsed.searchParams.get('referral') || '';
    sourceCampaign = parsed.searchParams.get('affcampaign') || parsed.searchParams.get('campaign') || '';
  } catch (_) {
    // Source attribution is optional.
  }

  const bodyAff = cleanText(body.aff || body.ref || body.referral || sourceAff).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const bodyCampaign = cleanText(body.affcampaign || body.campaign || sourceCampaign).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const landingUrl = partnerTrackingUrl(env, bodyAff, bodyCampaign);
  const payload = {
    username,
    country_code: 'MY',
    phone_number: phoneNumber,
    password: await encryptPassword(password, secret),
    confirm_password: await encryptPassword(confirmPassword, secret),
    url: landingUrl,
    affcampaign: null,
  };

  if (bodyAff) payload.aff = bodyAff;
  if (bodyCampaign) payload.affcampaign = bodyCampaign;

  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSha256Hex(secret, rawBody + timestamp);
  const apiBase = (env.OCS8_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');

  const upstream = await fetch(`${apiBase}/api/member/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Site-Prefix': env.OCS8_SITE_PREFIX || 'OCS',
      'X-Country-Code': 'MY',
      'X-Language-Code': 'EN',
      'X-Device-Type': isMobile(request) ? 'Mobile' : 'Desktop',
      'X-Session-ID': body.session_id || crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Referrer': landingUrl,
      'X-User-Agent': request.headers.get('user-agent') || '',
      'fingerprint-id': cleanText(body.fingerprint_id),
      'Referer': landingUrl,
    },
    body: rawBody,
  });

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { success: false, message: [text || 'Register API returned an invalid response.'] };
  }
  return json(data, upstream.status);
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'POST') return handlePost(context);
  return json({ success: false, message: ['Method not allowed.'] }, 405);
}
