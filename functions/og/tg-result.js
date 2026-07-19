// GET /og/tg-result
// Branded full-time result card optimized for Telegram (1280x720, 16:9).
// Rasterized to PNG by Cloudflare Browser Rendering before posting.
//
// Params:
//   home        team name (required)
//   away        team name (required)
//   league      league name
//   score       "home-away" (e.g., "2-1")
//   date        ISO datetime — rendered as MYT date
//   home_logo   optional team logo URL
//   away_logo   optional team logo URL
//   pick_was    "correct" | "wrong" | "pending" (optional)

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

function teamInitials(name) {
  const t = String(name || '').trim();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function fmtMytDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return ''; }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const home = shortTeam(url.searchParams.get('home') || 'Home');
  const away = shortTeam(url.searchParams.get('away') || 'Away');
  const league = (url.searchParams.get('league') || 'Football').toUpperCase();
  const rawScore = String(url.searchParams.get('score') || '0-0').replace(/\s+/g, '');
  const [homeScore, awayScore] = rawScore.split('-').concat(['0', '0']).slice(0, 2);
  const dateStr = fmtMytDate(url.searchParams.get('date'));
  const homeLogo = url.searchParams.get('home_logo') || '';
  const awayLogo = url.searchParams.get('away_logo') || '';
  const pickWas = String(url.searchParams.get('pick_was') || '').toLowerCase();

  const homeSize = fitSize(home, 14, 36, 22);
  const awaySize = fitSize(away, 14, 36, 22);
  const leagueSize = fitSize(league, 32, 22, 14);

  const homeMark = homeLogo
    ? `<image href="${escXml(homeLogo)}" x="146" y="312" width="156" height="156" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="224" y="412" font-family="system-ui,-apple-system,sans-serif" font-size="62" font-weight="900" fill="#ffffff" text-anchor="middle" opacity=".85">${escXml(teamInitials(home))}</text>`;
  const awayMark = awayLogo
    ? `<image href="${escXml(awayLogo)}" x="978" y="312" width="156" height="156" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="1056" y="412" font-family="system-ui,-apple-system,sans-serif" font-size="62" font-weight="900" fill="#ffffff" text-anchor="middle" opacity=".85">${escXml(teamInitials(away))}</text>`;

  // Pick-was badge — only if a meaningful value passed
  let pickBadge = '';
  if (pickWas === 'correct' || pickWas === 'wrong' || pickWas === 'pending') {
    const color = pickWas === 'correct' ? '#00e5a0'
                : pickWas === 'wrong'   ? '#ff5252'
                                        : 'rgba(255,255,255,.55)';
    const label = pickWas === 'correct' ? 'AI PICK CORRECT ✓'
                : pickWas === 'wrong'   ? 'AI PICK MISSED ✗'
                                        : 'AI PICK PENDING';
    const badgeWidth = label.length * 13 + 60;
    const badgeX = 640 - badgeWidth / 2;
    pickBadge = `
  <g>
    <rect x="${badgeX}" y="595" width="${badgeWidth}" height="56" rx="28" fill="rgba(255,255,255,.04)" stroke="${color}" stroke-width="1.5" stroke-opacity=".55"/>
    <text x="640" y="630" font-family="Menlo,monospace" font-size="16" fill="${color}" text-anchor="middle" letter-spacing="3">${escXml(label)}</text>
  </g>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#060914"/>
      <stop offset="50%" stop-color="#0e1626"/>
      <stop offset="100%" stop-color="#1d0f08"/>
    </linearGradient>
    <radialGradient id="glow1" cx="22%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#00e5a0" stop-opacity=".10"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="78%" cy="62%" r="55%">
      <stop offset="0%" stop-color="#ff7a1a" stop-opacity=".12"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#ffffff"/>
      <stop offset="56%" stop-color="#ffb21f"/>
      <stop offset="100%" stop-color="#ff7a1a"/>
    </linearGradient>
    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ffb21f"/>
    </linearGradient>
    <linearGradient id="teamRing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,.12)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,.02)"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="rgba(255,255,255,.025)" stroke-width="1"/>
    </pattern>
    <filter id="softshadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000" flood-opacity=".45"/>
    </filter>
  </defs>

  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#grid)"/>
  <rect width="1280" height="720" fill="url(#glow1)"/>
  <rect width="1280" height="720" fill="url(#glow2)"/>

  <!-- corner accent -->
  <path d="M0 64 L80 0 H164 L0 164 Z" fill="#ff7a1a" opacity=".55"/>
  <path d="M1280 656 L1200 720 H1116 L1280 556 Z" fill="#00e5a0" opacity=".42"/>

  <!-- header -->
  <text x="60" y="84" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="40" font-weight="900" fill="url(#brand)" letter-spacing="-.5">ScoreOCS8</text>
  <text x="1220" y="84" font-family="Menlo,monospace" font-size="13" fill="#00e5a0" text-anchor="end" letter-spacing="4">FULL TIME · HIGHLIGHTS</text>

  <line x1="60" y1="118" x2="1220" y2="118" stroke="rgba(255,255,255,.06)" stroke-width="1"/>

  <!-- league + date -->
  <text x="640" y="186" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${leagueSize}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="6">${escXml(league)}</text>
  <text x="640" y="222" font-family="Menlo,monospace" font-size="15" fill="rgba(255,255,255,.55)" text-anchor="middle" letter-spacing="2">${escXml(dateStr)}</text>

  <!-- team rings -->
  <circle cx="224" cy="390" r="100" fill="url(#teamRing)" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
  <circle cx="1056" cy="390" r="100" fill="url(#teamRing)" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
  ${homeMark}
  ${awayMark}

  <!-- score in middle, dominant -->
  <text x="640" y="408" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="132" font-weight="900" fill="url(#scoreGrad)" text-anchor="middle" letter-spacing="-2">${escXml(homeScore)} <tspan fill="rgba(255,255,255,.35)">·</tspan> ${escXml(awayScore)}</text>
  <text x="640" y="452" font-family="Menlo,monospace" font-size="13" fill="rgba(255,255,255,.45)" text-anchor="middle" letter-spacing="6">FULL TIME</text>

  <!-- team names -->
  <text x="224" y="540" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${homeSize}" font-weight="800" fill="#ffffff" text-anchor="middle">${escXml(home)}</text>
  <text x="1056" y="540" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${awaySize}" font-weight="800" fill="#ffffff" text-anchor="middle">${escXml(away)}</text>

  ${pickBadge}

  <!-- footer -->
  <text x="60" y="694" font-family="Menlo,monospace" font-size="12" fill="rgba(255,255,255,.4)" letter-spacing="2">18+ · VIRTUAL CURRENCY · FOR ENTERTAINMENT</text>
  <text x="1220" y="694" font-family="Menlo,monospace" font-size="13" fill="rgba(255,122,26,.65)" text-anchor="end" letter-spacing="3">SCOREOCS8.COM</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
