// /favicon.svg — inline ScoreOcs8 badge. Served with 1y cache.
// A physical favicon.ico/.png at repo root would override this — use whichever
// you prefer. This function is the default.

export async function onRequestGet() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#f97316"/>
  <text x="32" y="45" fill="#ffffff" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="900" font-size="34" text-anchor="middle" letter-spacing="-1">S8</text>
</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
