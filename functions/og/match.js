// GET /og/match?home=...&away=...&league=...&date=...&tag=...
// Renders a branded ScoreOcs8 match image as SVG (1200x630).
// This is cheap enough for daily KV/blog posts: no image API, no deps, no WASM.

function escXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function fmtMyt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const time = d.toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${date} - ${time} MYT`;
  } catch {
    return '';
  }
}

function fitSize(text, maxLen, base, min) {
  const len = String(text).length;
  if (len <= maxLen) return base;
  return Math.max(min, Math.round(base * (maxLen / len)));
}

function shortTeam(name) {
  const text = String(name || '').trim();
  return text.length > 24 ? `${text.slice(0, 21)}...` : text;
}

function stableNumber(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function displayScore(url, home, away) {
  const score = String(url.searchParams.get('score') || '').trim();
  if (/^\d+\s*[-–]\s*\d+$/.test(score)) return score.replace(/[–]/g, '-').replace(/\s*-\s*/, ' - ');
  const n = stableNumber(`${home}|${away}|${url.searchParams.get('date') || ''}`);
  return `${1 + (n % 3)} - ${Math.floor(n / 7) % 3}`;
}

function displayConfidence(url, home, away) {
  const raw = parseInt(url.searchParams.get('confidence') || '', 10);
  if (Number.isFinite(raw)) return Math.max(50, Math.min(92, raw));
  return 64 + (stableNumber(`${home}|${away}|confidence`) % 18);
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const home = shortTeam(url.searchParams.get('home') || 'Home Team');
  const away = shortTeam(url.searchParams.get('away') || 'Away Team');
  const league = (url.searchParams.get('league') || 'ScoreOcs8 Pro Analysis').toUpperCase();
  const dateStr = fmtMyt(url.searchParams.get('date'));
  const tag = (url.searchParams.get('tag') || 'PRO PICK').toUpperCase();
  const score = displayScore(url, home, away);
  const confidence = displayConfidence(url, home, away);
  const confidenceWidth = Math.round(170 * (confidence / 100));

  const homeSize = fitSize(home, 18, 48, 30);
  const awaySize = fitSize(away, 18, 48, 30);
  const leagueWidth = Math.min(560, Math.max(210, league.length * 10 + 34));
  const tagWidth = Math.min(260, Math.max(138, tag.length * 9 + 38));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#05070b"/>
      <stop offset="48%" stop-color="#0c121b"/>
      <stop offset="100%" stop-color="#102119"/>
    </linearGradient>
    <radialGradient id="pitch" cx="70%" cy="48%" r="58%">
      <stop offset="0%" stop-color="rgba(0,229,160,0.26)"/>
      <stop offset="48%" stop-color="rgba(249,115,22,0.10)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="orange" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#ff9f1a"/>
    </linearGradient>
    <linearGradient id="teal" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00e5a0"/>
      <stop offset="100%" stop-color="#3d8fff"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
    <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
      <path d="M42 0H0V42" fill="none" stroke="rgba(249,115,22,0.045)" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <ellipse cx="820" cy="315" rx="520" ry="300" fill="url(#pitch)"/>

  <path d="M0 520 C240 475 420 540 620 500 C820 460 980 480 1200 420 L1200 630 L0 630 Z" fill="rgba(0,229,160,0.08)"/>
  <path d="M730 145 H1120 V500 H730 Z" fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.08)"/>
  <path d="M860 145 V500 M730 245 H1120 M730 395 H1120" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>

  <rect x="0" y="0" width="1200" height="6" fill="url(#orange)"/>
  <rect x="58" y="54" width="${leagueWidth}" height="40" rx="6" fill="rgba(249,115,22,0.12)" stroke="rgba(249,115,22,0.38)"/>
  <text x="76" y="80" font-family="'DM Mono','Menlo',monospace" font-size="16" fill="#f97316" letter-spacing="2">${escXml(league)}</text>
  <rect x="${1082 - tagWidth}" y="54" width="${tagWidth}" height="40" rx="6" fill="rgba(0,229,160,0.10)" stroke="rgba(0,229,160,0.34)"/>
  <text x="${1066}" y="80" font-family="'DM Mono','Menlo',monospace" font-size="15" fill="#00e5a0" text-anchor="end" letter-spacing="2">${escXml(tag)}</text>

  <text x="60" y="174" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="38" fill="#ffffff" font-weight="700" letter-spacing="1">Score<tspan fill="#f97316">Ocs8</tspan></text>
  <text x="60" y="216" font-family="'DM Mono','Menlo',monospace" font-size="13" fill="#8a9ab5" letter-spacing="3">BIG MATCH PRO ANALYSIS</text>

  <g filter="url(#shadow)">
    <rect x="60" y="260" width="485" height="190" rx="18" fill="rgba(15,22,32,0.88)" stroke="rgba(255,255,255,0.12)"/>
    <text x="95" y="326" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="${homeSize}" fill="#ffffff" font-weight="700">${escXml(home)}</text>
    <rect x="95" y="352" width="86" height="50" rx="25" fill="url(#orange)"/>
    <text x="138" y="386" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="30" fill="#ffffff" text-anchor="middle" font-weight="800">VS</text>
    <text x="205" y="390" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="${awaySize}" fill="#ffffff" font-weight="700">${escXml(away)}</text>
    <text x="95" y="425" font-family="'DM Mono','Menlo',monospace" font-size="15" fill="#8a9ab5">${escXml(dateStr || 'SEE SCOREOCS8 FOR DETAILS')}</text>
  </g>

  <g filter="url(#shadow)">
    <rect x="625" y="250" width="245" height="132" rx="14" fill="rgba(15,22,32,0.84)" stroke="rgba(249,115,22,0.42)"/>
    <text x="650" y="292" font-family="'DM Mono','Menlo',monospace" font-size="14" fill="#f97316" letter-spacing="2">PRO PICK</text>
    <rect x="650" y="318" width="170" height="12" rx="6" fill="rgba(255,255,255,0.10)"/>
    <rect x="650" y="318" width="${confidenceWidth}" height="12" rx="6" fill="url(#orange)"/>
    <text x="650" y="358" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="24" fill="#ffffff" font-weight="700">Confidence ${confidence}%</text>
  </g>

  <g filter="url(#shadow)">
    <rect x="905" y="180" width="220" height="150" rx="14" fill="rgba(15,22,32,0.84)" stroke="rgba(0,229,160,0.36)"/>
    <text x="930" y="220" font-family="'DM Mono','Menlo',monospace" font-size="13" fill="#00e5a0" letter-spacing="2">LIVE SCORE</text>
    <text x="930" y="282" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="56" fill="#ffffff" font-weight="800">${escXml(score)}</text>
    <text x="930" y="310" font-family="'DM Mono','Menlo',monospace" font-size="13" fill="#8a9ab5">78:45</text>
  </g>

  <g filter="url(#shadow)">
    <rect x="720" y="420" width="360" height="86" rx="14" fill="rgba(15,22,32,0.84)" stroke="rgba(255,255,255,0.12)"/>
    <text x="750" y="455" font-family="'DM Mono','Menlo',monospace" font-size="13" fill="#8a9ab5" letter-spacing="2">RESULTS PROOF</text>
    <text x="750" y="490" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="22" fill="#00e5a0" font-weight="700">WON</text>
    <text x="835" y="490" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="22" fill="#f5a623" font-weight="700">DRAW</text>
    <text x="930" y="490" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="22" fill="#ff4757" font-weight="700">LOST</text>
  </g>

  <rect x="60" y="540" width="500" height="46" rx="8" fill="rgba(249,115,22,0.10)" stroke="rgba(249,115,22,0.30)"/>
  <text x="84" y="570" font-family="'Rajdhani','Helvetica Neue',system-ui,sans-serif" font-size="20" fill="#ffffff" font-weight="700" letter-spacing="2">JOIN TELEGRAM TO UNLOCK FULL PICKS</text>
  <text x="790" y="570" font-family="'DM Mono','Menlo',monospace" font-size="13" fill="#4a5a72" letter-spacing="2">PRO ANALYSIS - LIVE SCORES - H2H - LINEUPS</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}
