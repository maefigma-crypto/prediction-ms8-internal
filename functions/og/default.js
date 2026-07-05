// GET /og/default — generic branded OG card (1200x630) used as default
// og:image / twitter:image for the homepage, blog, login, and other
// non-match pages. Pure SVG, no deps, cached 1y immutable.

export async function onRequestGet() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="g1" cx="20%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="80%" cy="80%" r="70%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ff8a3a"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#070a16"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <g font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="900" letter-spacing="-2">
    <text x="80" y="280" font-size="124" fill="url(#brand)">ScoreOcs8</text>
  </g>
  <text x="80" y="370" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="700" font-size="46" fill="#eef1f8" letter-spacing="-0.5">Daily Soccer Predictions</text>
  <text x="80" y="430" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="700" font-size="46" fill="#f97316" letter-spacing="-0.5">Malaysia · Updated Daily (MYT)</text>
  <g font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="22" fill="#9aa5bd" letter-spacing="2">
    <text x="80" y="510">EPL · UCL · LA LIGA · SERIE A · BUNDESLIGA · LIGUE 1</text>
  </g>
  <g transform="translate(80,540)">
    <rect width="180" height="46" rx="23" fill="#f97316"/>
    <text x="90" y="30" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="2">PRO PICKS DAILY</text>
  </g>
  <text x="80" y="615" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="18" fill="#5a6680" letter-spacing="3">SCOREOCS8.COM</text>
</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
