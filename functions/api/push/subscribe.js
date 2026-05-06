// POST /api/push/subscribe — store a Web Push subscription in KV.
//
// Body: the JSON-serialised PushSubscription from the browser:
//   { endpoint, keys: { p256dh, auth }, expirationTime?, lang?, source? }
//
// Stored under push:scoreocs8:<endpointHash> so the future broadcast worker
// can iterate them with env.CACHE.list({ prefix: 'push:scoreocs8:' }).

async function hashEndpoint(endpoint) {
  const buf = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function onRequestPost({ request, env }) {
  if (!env.CACHE) {
    return new Response(JSON.stringify({ error: 'kv-not-bound' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid-json' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ error: 'missing-fields' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const id = await hashEndpoint(endpoint);
  const record = {
    site: 'scoreocs8',
    endpoint,
    keys: { p256dh, auth },
    lang: String(body.lang || 'en'),
    source: String(body.source || ''),
    userAgent: request.headers.get('user-agent') || '',
    country: request.headers.get('cf-ipcountry') || '',
    createdAt: Date.now(),
    active: true,
  };

  await env.CACHE.put(`push:scoreocs8:${id}`, JSON.stringify(record));
  return new Response(JSON.stringify({ ok: true, id }), {
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestDelete({ request, env }) {
  if (!env.CACHE) return new Response('', { status: 500 });
  let body;
  try { body = await request.json(); } catch { return new Response('', { status: 400 }); }
  if (!body?.endpoint) return new Response('', { status: 400 });
  const id = await hashEndpoint(body.endpoint);
  await env.CACHE.delete(`push:scoreocs8:${id}`);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
