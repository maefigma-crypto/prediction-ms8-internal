// GET /og/tg-prediction
// Branded match-preview card optimized for Telegram (1280x720, 16:9).
// Rasterized to PNG by Cloudflare Browser Rendering before posting.
//
// Params:
//   home        team name (required)
//   away        team name (required)
//   league      league name
//   date        ISO datetime — rendered as MYT
//   tag         pick label (e.g., HOME, DRAW, AWAY, or team name)
//   confidence  integer 0-100
//   home_logo   optional team logo URL (API-Football CDN)
//   away_logo   optional team logo URL

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

function fmtMytDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric', month: 'short',
    });
    const time = d.toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return `${date} · ${time} MYT`;
  } catch { return ''; }
}

// From "h-a" + pick side, derive Main/2nd/Alt scorelines + a goals line.
function scorePack(cs, pickSide) {
  const m = String(cs || '').match(/(\d+)\s*[-–:]\s*(\d+)/);
  if (!m) return null;
  const h = +m[1], a = +m[2], total = h + a, pk = String(pickSide || '').toUpperCase();
  const set = []; const push = s => { if (s && !set.includes(s)) set.push(s); };
  push(`${h}-${a}`);
  if (pk === 'AWAY') { push(`${Math.max(h - 1, 0)}-${a}`); push('1-1'); push(`${h}-${a + 1}`); }
  else if (pk === 'DRAW') { push('1-1'); push('2-2'); push('0-0'); }
  else { push(`${h}-${Math.max(a - 1, 0)}`); push('1-1'); push(`${h + 1}-${a}`); }
  return { scores: set.slice(0, 3), goalsLine: total <= 3 ? 'UNDER 3.5' : 'OVER 3.5', totalRange: `${Math.max(1, total - 1)}-${total}` };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const home = shortTeam(url.searchParams.get('home') || 'Home');
  const away = shortTeam(url.searchParams.get('away') || 'Away');
  const league = (url.searchParams.get('league') || 'Football').toUpperCase();
  const dateStr = fmtMytDateTime(url.searchParams.get('date'));
  // Empty default — caller MUST pass an actual pick label. If missing we
  // render a plain "PRO PICK" badge instead of "PRO PICK: PRO PICK".
  const tag = (url.searchParams.get('tag') || '').toUpperCase();
  const conf = parseInt(url.searchParams.get('confidence') || '', 10);
  const confStr = Number.isFinite(conf) && conf > 0 ? `${conf}%` : '';
  const homeLogo = url.searchParams.get('home_logo') || '';
  const awayLogo = url.searchParams.get('away_logo') || '';
  const score = (url.searchParams.get('score') || '').trim();
  const risk = (url.searchParams.get('risk') || '').trim().toUpperCase();
  const riskWord = risk === 'LOW' ? 'LOWER RISK' : risk === 'HIGH' ? 'HIGHER RISK' : risk === 'MEDIUM' ? 'MEDIUM RISK' : '';
  const pickSide = (url.searchParams.get('pick') || '').toUpperCase();
  const sp = scorePack(score, pickSide);
  const scoreLabels = ['MAIN', '2ND', 'ALT'];
  const sBoxW = 168, sGap = 18, sStartX = 640 - (3 * sBoxW + 2 * sGap) / 2;
  const scoreBoxes = sp ? sp.scores.map((s, i) => {
    const bx = sStartX + i * (sBoxW + sGap), main = i === 0;
    return `<g>
      <rect x="${bx}" y="614" width="${sBoxW}" height="62" rx="12" fill="${main ? 'rgba(255,138,60,.16)' : 'rgba(255,255,255,.04)'}" stroke="${main ? 'rgba(255,138,60,.6)' : 'rgba(255,255,255,.12)'}" stroke-width="${main ? 2 : 1}"/>
      <text x="${bx + sBoxW / 2}" y="636" font-family="Menlo,monospace" font-size="11" fill="${main ? '#ff8a3c' : 'rgba(255,255,255,.5)'}" text-anchor="middle" letter-spacing="2">${scoreLabels[i]}</text>
      <text x="${bx + sBoxW / 2}" y="666" font-family="system-ui,-apple-system,sans-serif" font-size="28" font-weight="800" fill="${main ? '#ffb890' : '#ffffff'}" text-anchor="middle">${escXml(s)}</text>
    </g>`;
  }).join('') : '';
  const goalsLineText = sp ? `GOALS O/U ${sp.goalsLine}  ·  LIKELY TOTAL ${sp.totalRange}${riskWord ? `  ·  ${riskWord}` : ''}` : (score ? `PREDICTED SCORE ${score}${riskWord ? `  ·  ${riskWord}` : ''}` : '');

  const homeSize = fitSize(home, 14, 38, 22);
  const awaySize = fitSize(away, 14, 38, 22);
  const leagueSize = fitSize(league, 32, 22, 14);

  // Team mark: real logo if URL given, otherwise initials in a soft circle
  const homeMark = homeLogo
    ? `<image href="${escXml(homeLogo)}" x="270" y="312" width="156" height="156" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="348" y="412" font-family="system-ui,-apple-system,sans-serif" font-size="62" font-weight="900" fill="#ffffff" text-anchor="middle" opacity=".85">${escXml(teamInitials(home))}</text>`;
  const awayMark = awayLogo
    ? `<image href="${escXml(awayLogo)}" x="854" y="312" width="156" height="156" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="932" y="412" font-family="system-ui,-apple-system,sans-serif" font-size="62" font-weight="900" fill="#ffffff" text-anchor="middle" opacity=".85">${escXml(teamInitials(away))}</text>`;

  // Pick badge width — auto-fit based on content length.
  // When tag is empty (no real pick), render just "PRO PICK" instead of
  // the broken "PRO PICK: PRO PICK" that came from the old default.
  let pickLabelFull;
  if (tag) {
    pickLabelFull = confStr ? `PRO PICK: ${tag}  •  ${confStr}` : `PRO PICK: ${tag}`;
  } else {
    pickLabelFull = confStr ? `PRO PICK  •  ${confStr}` : `PRO PICK`;
  }
  const pickWidth = Math.max(480, pickLabelFull.length * 13 + 80);
  const pickX = 640 - pickWidth / 2;

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
  <text x="1220" y="84" font-family="Menlo,monospace" font-size="13" fill="#ff7a1a" text-anchor="end" letter-spacing="4">AI MATCH PREDICTION</text>

  <!-- thin divider -->
  <line x1="60" y1="118" x2="1220" y2="118" stroke="rgba(255,255,255,.06)" stroke-width="1"/>

  <!-- league + kickoff -->
  <text x="640" y="186" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${leagueSize}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="6">${escXml(league)}</text>
  <text x="640" y="222" font-family="Menlo,monospace" font-size="15" fill="rgba(255,255,255,.55)" text-anchor="middle" letter-spacing="2">${escXml(dateStr)}</text>

  <!-- team logo rings -->
  <circle cx="348" cy="390" r="100" fill="url(#teamRing)" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
  <circle cx="932" cy="390" r="100" fill="url(#teamRing)" stroke="rgba(255,255,255,.10)" stroke-width="2"/>
  ${homeMark}
  ${awayMark}

  <!-- team names -->
  <text x="348" y="524" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${homeSize}" font-weight="800" fill="#ffffff" text-anchor="middle">${escXml(home)}</text>
  <text x="932" y="524" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${awaySize}" font-weight="800" fill="#ffffff" text-anchor="middle">${escXml(away)}</text>

  <!-- VS marker -->
  <circle cx="640" cy="390" r="50" fill="#0e1626" stroke="rgba(255,122,26,.7)" stroke-width="2"/>
  <text x="640" y="406" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="34" font-weight="900" fill="#ff8a3c" text-anchor="middle" letter-spacing="2">VS</text>

  <!-- pick badge -->
  <g filter="url(#softshadow)">
    <rect x="${pickX}" y="548" width="${pickWidth}" height="52" rx="26" fill="rgba(255,138,60,.10)" stroke="rgba(255,138,60,.5)" stroke-width="2"/>
    <text x="640" y="582" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="22" font-weight="700" fill="#ff8a3c" text-anchor="middle" letter-spacing="3">${escXml(pickLabelFull)}</text>
  </g>

  <!-- correct-score options (Main / 2nd / Alt) -->
  ${scoreBoxes}
  ${goalsLineText ? `<text x="640" y="698" font-family="Menlo,monospace" font-size="13" fill="rgba(255,255,255,.6)" text-anchor="middle" letter-spacing="2">${escXml(goalsLineText)}</text>` : ''}

  <!-- footer brand -->
  <text x="60" y="714" font-family="Menlo,monospace" font-size="12" fill="rgba(255,255,255,.4)" letter-spacing="2">18+ · VIRTUAL CURRENCY · FOR ENTERTAINMENT</text>
  <text x="1220" y="714" font-family="Menlo,monospace" font-size="13" fill="rgba(255,122,26,.65)" text-anchor="end" letter-spacing="3">SCOREOCS8.COM</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
