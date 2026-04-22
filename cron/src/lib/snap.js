// Stash PNG bytes in KV and return a public URL suitable for platforms
// (IG / Threads) that require image_url instead of raw bytes.

const SITE_URL = 'https://scoreocs8.pages.dev';

// Generate a URL-safe random id using Web Crypto (available in Workers).
function randId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function saveSnap(env, pngBytes, ttlSeconds = 24 * 3600) {
  const id = randId();
  await env.CACHE.put(`snap:${id}`, pngBytes, { expirationTtl: ttlSeconds });
  return {
    id,
    url: `${SITE_URL}/snap?id=${id}`,
  };
}
