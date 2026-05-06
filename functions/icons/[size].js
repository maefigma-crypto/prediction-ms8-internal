// PWA icon endpoint: /icons/icon-192.png, /icons/icon-512.png, /icons/icon-maskable-512.png
// Returns a branded ScoreOcs8 SVG card sized to spec. SVG is fine — manifest
// accepts SVG icons and Chrome/iOS rasterise them at install time.

export async function onRequestGet({ params }) {
  const slug = String(params.size || '');
  const m = slug.match(/^icon-(?:maskable-)?(\d+)\.png$/);
  const size = m ? parseInt(m[1], 10) : 512;
  const maskable = slug.includes('maskable');

  // Maskable icons need a "safe zone" — the inner 80% must contain the brand
  // mark, the outer 10% padding can be cropped by the OS into circles, squircles, etc.
  const padding = maskable ? size * 0.18 : 0;
  const inner = size - padding * 2;
  const cornerRadius = maskable ? 0 : size * 0.22;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="30%" cy="25%" r="80%">
      <stop offset="0%" stop-color="#1a1024"/>
      <stop offset="60%" stop-color="#070a16"/>
      <stop offset="100%" stop-color="#020308"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="55%" r="55%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ff8a3a"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  ${maskable
    ? `<rect width="${size}" height="${size}" fill="#070a16"/>`
    : `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="url(#bg)"/>`}
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${maskable ? size * 0.22 : 0}" fill="url(#bg)"/>
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${maskable ? size * 0.22 : 0}" fill="url(#glow)"/>
  <text x="${size / 2}" y="${size / 2 + size * 0.18}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="900" font-size="${size * 0.52}" fill="url(#brand)" text-anchor="middle" letter-spacing="-${size * 0.02}">S8</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
