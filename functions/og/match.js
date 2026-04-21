// GET /og/match?home=...&away=...&league=...&date=...&risk=...
// Renders a branded ScoreOcs8 match card as SVG (1200x630, OG-card size).
// Cheap: no deps, no WASM, no image fetches — pure string template.

function escXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function fmtMyt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} · ${time} MYT`;
  } catch {
    return '';
  }
}

// Shrink font size when text is too long to fit inside the card safely.
function fitSize(text, maxLen, base, min) {
  const len = String(text).length;
  if (len <= maxLen) return base;
  const scaled = Math.max(min, Math.round(base * (maxLen / len)));
  return scaled;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const home = url.searchParams.get('home') || 'Home Team';
  const away = url.searchParams.get('away') || 'Away Team';
  const league = (url.searchParams.get('league') || 'ScoreOcs8 AI Prediction').toUpperCase();
  const dateStr = fmtMyt(url.searchParams.get('date'));
  const tag = (url.searchParams.get('tag') || 'AI PICK').toUpperCase();

  const homeSize = fitSize(home, 16, 62, 38);
  const awaySize = fitSize(away, 16, 62, 38);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080b10"/>
      <stop offset="100%" stop-color="#141e2a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="rgba(249,115,22,0.15)"/>
      <stop offset="100%" stop-color="rgba(249,115,22,0)"/>
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(249,115,22,0.045)" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background layers -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <ellipse cx="600" cy="315" rx="500" ry="260" fill="url(#glow)"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="1200" height="5" fill="#f97316"/>

  <!-- League tag (top-left) -->
  <rect x="60" y="50" width="${Math.max(160, league.length * 11 + 24)}" height="34" rx="4" fill="rgba(249,115,22,0.12)" stroke="rgba(249,115,22,0.35)" stroke-width="1"/>
  <text x="${60 + 12}" y="73" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="16" fill="#f97316" letter-spacing="3" font-weight="600">${escXml(league)}</text>

  <!-- Tag (top-right) — with inline SVG bolt so emoji support isn't required -->
  <rect x="${1140 - Math.max(150, tag.length * 10 + 44)}" y="50" width="${Math.max(150, tag.length * 10 + 44)}" height="34" rx="4" fill="rgba(245,166,35,0.12)" stroke="rgba(245,166,35,0.35)" stroke-width="1"/>
  <path d="M ${1140 - Math.max(150, tag.length * 10 + 44) + 14} 60 L ${1140 - Math.max(150, tag.length * 10 + 44) + 10} 70 L ${1140 - Math.max(150, tag.length * 10 + 44) + 17} 70 L ${1140 - Math.max(150, tag.length * 10 + 44) + 13} 80 L ${1140 - Math.max(150, tag.length * 10 + 44) + 22} 68 L ${1140 - Math.max(150, tag.length * 10 + 44) + 15} 68 Z" fill="#f5a623"/>
  <text x="${1140 - 12}" y="73" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="15" fill="#f5a623" letter-spacing="2.5" font-weight="700" text-anchor="end">${escXml(tag)}</text>

  <!-- Teams stack -->
  <text x="600" y="${280 - (homeSize > 50 ? 0 : 10)}" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="${homeSize}" fill="#ffffff" text-anchor="middle" font-weight="700" letter-spacing="1">${escXml(home)}</text>

  <!-- VS pill -->
  <circle cx="600" cy="335" r="36" fill="#f97316"/>
  <text x="600" y="348" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="28" fill="#ffffff" text-anchor="middle" font-weight="700" letter-spacing="2">VS</text>

  <text x="600" y="${400 + (awaySize > 50 ? 15 : 0)}" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="${awaySize}" fill="#ffffff" text-anchor="middle" font-weight="700" letter-spacing="1">${escXml(away)}</text>

  <!-- Date strip -->
  <rect x="300" y="470" width="600" height="1" fill="rgba(255,255,255,0.1)"/>
  <text x="600" y="510" font-family="'DM Mono','Menlo','monospace'" font-size="20" fill="#8a9ab5" text-anchor="middle" letter-spacing="3">${escXml(dateStr || 'SEE SCOREOCS8 FOR DETAILS')}</text>

  <!-- Branding row -->
  <text x="60" y="580" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="34" fill="#ffffff" font-weight="700" letter-spacing="1">Score<tspan fill="#f97316">Ocs8</tspan></text>
  <text x="60" y="602" font-family="'DM Mono','Menlo','monospace'" font-size="12" fill="#4a5a72" letter-spacing="2">AI SPORTS PREDICTIONS</text>

  <rect x="1040" y="562" width="100" height="32" rx="4" fill="#f97316"/>
  <path d="M 1054 570 L 1048 582 L 1058 582 L 1052 594 L 1064 578 L 1054 578 Z" fill="#ffffff"/>
  <text x="1106" y="584" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="14" fill="#ffffff" text-anchor="middle" font-weight="700" letter-spacing="2">PICK</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}
