// Public image host for cron-generated screenshots.
//
// IG Graph API and Threads API both require the image to be fetched from
// a public HTTPS URL (they don't accept raw bytes). This endpoint serves
// PNGs that the cron worker stashed in KV under snap:<id> for 24h.
//
// Usage: GET /snap?id=<uuid>  → returns the PNG with correct content-type

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    return new Response('bad id', { status: 400 });
  }

  const bytes = await env.CACHE.get(`snap:${id}`, 'arrayBuffer');
  if (!bytes) return new Response('not found or expired', { status: 404 });

  return new Response(bytes, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, immutable',
      'x-robots-tag': 'noindex, nofollow',
      'access-control-allow-origin': '*',
    },
  });
}
