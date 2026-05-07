function escXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function fitSize(text, maxLen, base, min) {
  const len = String(text || '').length;
  if (len <= maxLen) return base;
  return Math.max(min, Math.round(base * (maxLen / len)));
}

function shortTeam(name) {
  const text = String(name || '').trim();
  return text.length > 22 ? `${text.slice(0, 19)}...` : text;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const home = shortTeam(url.searchParams.get('home') || 'Home');
  const away = shortTeam(url.searchParams.get('away') || 'Away');
  const league = (url.searchParams.get('league') || 'Football').toUpperCase();
  const score = String(url.searchParams.get('score') || '0-0').replace(/\s*-\s*/, ' - ');
  const date = fmtDate(url.searchParams.get('date'));
  const homeSize = fitSize(home, 16, 42, 24);
  const awaySize = fitSize(away, 16, 42, 24);
  const homeLogo = url.searchParams.get('home_logo') || '';
  const awayLogo = url.searchParams.get('away_logo') || '';
  const homeMark = homeLogo
    ? `<image href="${escXml(homeLogo)}" x="214" y="268" width="152" height="152" preserveAspectRatio="xMidYMid meet"/>`
    : `<circle cx="290" cy="344" r="76" fill="#101824" opacity=".08"/>`;
  const awayMark = awayLogo
    ? `<image href="${escXml(awayLogo)}" x="834" y="268" width="152" height="152" preserveAspectRatio="xMidYMid meet"/>`
    : `<circle cx="910" cy="344" r="76" fill="#101824" opacity=".08"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#05070b"/>
      <stop offset="52%" stop-color="#101824"/>
      <stop offset="100%" stop-color="#2b130b"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="64%">
      <stop offset="0%" stop-color="#f97316" stop-opacity=".22"/>
      <stop offset="54%" stop-color="#00e5a0" stop-opacity=".08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="54%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ffb21f"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
    <pattern id="grid" width="46" height="46" patternUnits="userSpaceOnUse">
      <path d="M46 0H0V46" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="1"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity=".48"/>
    </filter>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#grid)"/>
  <rect width="1200" height="675" fill="url(#glow)"/>
  <path d="M0 100 L92 0 H252 L0 252 Z" fill="#f97316" opacity=".78"/>
  <path d="M1200 575 L1108 675 H948 L1200 423 Z" fill="#f97316" opacity=".82"/>

  <text x="60" y="88" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="42" font-weight="900" fill="url(#brand)" letter-spacing="-1">ScoreOCS8</text>
  <text x="60" y="125" font-family="Menlo,monospace" font-size="14" fill="#f97316" letter-spacing="4">FULL TIME HIGHLIGHTS</text>
  <text x="1140" y="88" font-family="Menlo,monospace" font-size="16" fill="#8a9ab5" text-anchor="end" letter-spacing="2">${escXml(league)}</text>

  <g filter="url(#shadow)">
    <rect x="105" y="176" width="990" height="360" rx="28" fill="rgba(255,255,255,.965)"/>
    <path d="M105 176 H1095 V236 H105 Z" fill="rgba(249,115,22,.10)"/>
    <path d="M105 476 H1095 V536 H105 Z" fill="rgba(249,115,22,.08)"/>
    <circle cx="290" cy="344" r="92" fill="#101824" opacity=".055"/>
    <circle cx="910" cy="344" r="92" fill="#101824" opacity=".055"/>
    ${homeMark}
    ${awayMark}
    <text x="290" y="455" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${homeSize}" font-weight="900" fill="#101824" text-anchor="middle">${escXml(home)}</text>
    <text x="910" y="455" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${awaySize}" font-weight="900" fill="#101824" text-anchor="middle">${escXml(away)}</text>
    <text x="600" y="342" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="112" font-weight="900" fill="#b31616" text-anchor="middle">${escXml(score)}</text>
    <text x="600" y="412" font-family="Menlo,monospace" font-size="18" fill="#7b2330" text-anchor="middle" letter-spacing="8">FULL TIME</text>
  </g>

  <text x="60" y="610" font-family="Menlo,monospace" font-size="16" fill="#8a9ab5">${escXml(date)}</text>
  <text x="1140" y="610" font-family="Menlo,monospace" font-size="16" fill="#f97316" text-anchor="end" letter-spacing="3">SCOREOCS8.PAGES.DEV</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    },
  });
}
