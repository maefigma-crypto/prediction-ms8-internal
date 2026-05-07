// Panel icons: /icons/icon-192.png, /icons/icon-512.png,
// /icons/icon-maskable-512.png, /icons/favicon.svg.
//
// Returns SVG (browsers rasterise it for the manifest). The "panel" icon
// is a deeper purple than ScoreOcs8's orange so the two PWAs are visually
// distinguishable on the home screen.

export async function onRequestGet({ params }) {
  const slug = String(params.size || '');
  if (slug === 'favicon.svg') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#070a16"/>
  <circle cx="32" cy="32" r="22" fill="#f97316" opacity="0.18"/>
  <text x="32" y="42" fill="#f97316" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="900" font-size="28" text-anchor="middle" letter-spacing="-1">OCS</text>
</svg>`;
    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const m = slug.match(/^icon-(?:maskable-)?(\d+)\.png$/);
  const size = m ? parseInt(m[1], 10) : 512;
  const maskable = slug.includes('maskable');
  const padding = maskable ? size * 0.18 : 0;
  const inner = size - padding * 2;
  const cornerRadius = maskable ? 0 : size * 0.22;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="30%" cy="25%" r="80%">
      <stop offset="0%" stop-color="#1a1024"/>
      <stop offset="100%" stop-color="#02030a"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff8a3a"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  ${maskable
    ? `<rect width="${size}" height="${size}" fill="#070a16"/>`
    : `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="url(#bg)"/>`}
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${maskable ? size * 0.22 : 0}" fill="url(#bg)"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.30}" fill="url(#brand)" opacity="0.25"/>
  <text x="${size / 2}" y="${size / 2 + size * 0.13}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-weight="900" font-size="${size * 0.34}" fill="url(#brand)" text-anchor="middle" letter-spacing="-${size * 0.02}">OCS</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
