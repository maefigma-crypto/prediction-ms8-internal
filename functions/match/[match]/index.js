// Per-match landing page: /match/<fixture-id>-<home>-vs-<away>/
// Server-rendered, indexable, glass-styled. Pulls data from /api/match-detail
// and /api/predictions to assemble a full preview with H2H + pro pick + meta.
//
// SEO model: each fixture gets its own canonical URL ranking for queries like
// "<home> vs <away> prediction" and "<home> vs <away> head to head".

const SITE = 'https://scoreocs8.com';

const LEAGUE_FLAG = { 39:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', 2:'⭐', 1:'🏆', 140:'🇪🇸', 78:'🇩🇪', 135:'🇮🇹', 61:'🇫🇷' };
const LEAGUE_NAME = { 39:'Premier League', 2:'UEFA Champions League', 1:'FIFA World Cup', 140:'La Liga', 78:'Bundesliga', 135:'Serie A', 61:'Ligue 1' };
const LEAGUE_SLUG = { 39:'premier-league', 2:'champions-league', 1:'fifa-world-cup', 140:'la-liga', 78:'bundesliga', 135:'serie-a', 61:'ligue-1' };

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
const escJson = s => String(s ?? '').replace(/[\\"]/g, c => '\\' + c).replace(/\n/g, '\\n');
const slugify = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);

function fmtMyt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', { timeZone:'Asia/Kuala_Lumpur', day:'numeric', month:'short', year:'numeric' });
    const time = d.toLocaleTimeString('en-GB', { timeZone:'Asia/Kuala_Lumpur', hour:'2-digit', minute:'2-digit', hour12:false });
    return `${date} · ${time} MYT`;
  } catch { return ''; }
}

function fmtIsoDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toISOString(); } catch { return ''; }
}

async function fetchJson(origin, path) {
  try {
    const r = await fetch(origin + path, { headers: { accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function onRequest(context) {
  const slug = String(context.params.match || '');
  const m = slug.match(/^(\d+)/);
  if (!m) return new Response('Match not found', { status: 404 });
  const fixtureId = parseInt(m[1], 10);

  const origin = new URL(context.request.url).origin;
  const [detail, pickRaw, posts] = await Promise.all([
    fetchJson(origin, `/api/match-detail?fixture_id=${fixtureId}`),
    fetchJson(origin, `/api/predictions?fixture_id=${fixtureId}`),
    fetchJson(origin, `/api/posts`),
  ]);

  const fx = detail?.fixture || {};
  const home = fx?.teams?.home?.name || 'Home';
  const away = fx?.teams?.away?.name || 'Away';
  const homeId = fx?.teams?.home?.id;
  const awayId = fx?.teams?.away?.id;
  const homeLogo = fx?.teams?.home?.logo || '';
  const awayLogo = fx?.teams?.away?.logo || '';
  const leagueId = fx?.league?.id;
  const leagueName = LEAGUE_NAME[leagueId] || fx?.league?.name || 'Major Soccer League';
  const leagueFlag = LEAGUE_FLAG[leagueId] || '⚽';
  const leagueSlug = LEAGUE_SLUG[leagueId] || '';
  const kickoff = fmtMyt(fx?.fixture?.date);
  const startIso = fmtIsoDate(fx?.fixture?.date);
  const venue = fx?.fixture?.venue?.name || '';
  const venueCity = fx?.fixture?.venue?.city || '';

  // Scoreboard state — derived from API-Football status codes.
  // Finished: FT/AET/PEN. Live: 1H/2H/HT/ET/BT/P/LIVE (elapsed minute may be set).
  // Not started: NS/TBD. Anything else falls back to the long status text.
  const statusShort = fx?.fixture?.status?.short || '';
  const statusLong = fx?.fixture?.status?.long || '';
  const elapsed = fx?.fixture?.status?.elapsed;
  const homeScore = fx?.goals?.home;
  const awayScore = fx?.goals?.away;
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);
  const hasScore = homeScore != null && awayScore != null;
  let stateLabel, stateSub, stateCls;
  const shortDate = fx?.fixture?.date
    ? new Date(fx.fixture.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' })
    : '';
  if (FINISHED.has(statusShort)) {
    stateLabel = 'Final';
    stateSub = statusShort === 'FT' ? shortDate : `${statusShort} · ${shortDate}`;
    stateCls = 'final';
  } else if (LIVE.has(statusShort)) {
    stateLabel = 'Live';
    stateSub = elapsed != null ? `${elapsed}'` : (statusLong || statusShort);
    stateCls = 'live';
  } else if (statusShort === 'NS' || statusShort === 'TBD' || !statusShort) {
    stateLabel = 'Kickoff';
    stateSub = shortDate || 'TBD';
    stateCls = 'upcoming';
  } else {
    stateLabel = statusShort;
    stateSub = statusLong || shortDate;
    stateCls = 'other';
  }
  const showScore = hasScore && (FINISHED.has(statusShort) || LIVE.has(statusShort));
  const homeScoreDisplay = showScore ? homeScore : '–';
  const awayScoreDisplay = showScore ? awayScore : '–';

  // Team W-D-L records from league standings. Knockout comps (UCL, FIFA WC)
  // have no league table — skip the fetch to avoid wasted API hits.
  const KNOCKOUT_LEAGUES = new Set([1, 2]);
  let homeRecord = null, awayRecord = null;
  if (leagueId && homeId && awayId && !KNOCKOUT_LEAGUES.has(leagueId)) {
    const season = fx?.league?.season || '2025';
    const standings = await fetchJson(origin, `/api/standings?league=${leagueId}&season=${season}`);
    const rows = (standings?.response?.[0]?.league?.standings || []).flat();
    const fmt = id => {
      const r = rows.find(x => x?.team?.id === id);
      if (!r) return null;
      const w = r.all?.win ?? 0, d = r.all?.draw ?? 0, l = r.all?.lose ?? 0;
      return `${w}-${d}-${l}`;
    };
    homeRecord = fmt(homeId);
    awayRecord = fmt(awayId);
  }

  // Match Timeline — events from API-Football mapped to icon/side/minute.
  const rawEvents = Array.isArray(detail?.events) ? detail.events : [];
  const eventIcon = (type, detail) => {
    const t = String(type || '').toLowerCase();
    const d = String(detail || '').toLowerCase();
    if (t === 'goal') {
      if (d.includes('own')) return { sym: '⚽', cls: 'own', label: 'Own goal' };
      if (d.includes('penalty') && !d.includes('missed')) return { sym: '⚽', cls: 'pen', label: 'Penalty' };
      if (d.includes('missed')) return { sym: '✗', cls: 'miss', label: 'Missed penalty' };
      return { sym: '⚽', cls: 'goal', label: 'Goal' };
    }
    if (t === 'card') {
      if (d.includes('red')) return { sym: '🟥', cls: 'red', label: 'Red card' };
      if (d.includes('second yellow')) return { sym: '🟨🟥', cls: 'red', label: 'Second yellow' };
      return { sym: '🟨', cls: 'yellow', label: 'Yellow card' };
    }
    if (t === 'subst') return { sym: '🔄', cls: 'sub', label: 'Substitution' };
    if (t === 'var') return { sym: '📺', cls: 'var', label: 'VAR' };
    return { sym: '•', cls: 'other', label: type || 'Event' };
  };
  const timelineEvents = rawEvents
    .filter(e => e.minute != null && e.team_id)
    .map(e => {
      const fullMin = (e.minute || 0) + (e.extra || 0);
      const pct = Math.max(0, Math.min(100, (fullMin / 95) * 100));
      const ic = eventIcon(e.type, e.detail);
      const minLabel = e.extra ? `${e.minute}+${e.extra}'` : `${e.minute}'`;
      return {
        side: e.team_id === homeId ? 'home' : 'away',
        pct, minLabel, sym: ic.sym, cls: ic.cls, label: ic.label,
        player: e.player || '', assist: e.assist || '',
      };
    })
    .sort((a, b) => parseInt(a.minLabel) - parseInt(b.minLabel));

  // Formation pitch — both teams positioned by API-Football grid coords.
  // Each player has grid "row:col" where row 1 is GK, higher rows are more
  // attacking. We translate per-side: home on left half attacking right;
  // away mirrored. Players within each row are distributed evenly along
  // the vertical axis so any formation (4-2-3-1, 3-5-2, etc.) looks right.
  const lineups = detail?.lineups || { home: null, away: null };
  const hasLineups = !!(lineups.home?.startXI?.length || lineups.away?.startXI?.length);
  function buildPositions(side, startXI) {
    if (!startXI?.length) return [];
    const byRow = {};
    for (const p of startXI) {
      const [r, c] = String(p.grid || '1:1').split(':').map(n => parseInt(n, 10) || 1);
      if (!byRow[r]) byRow[r] = [];
      byRow[r].push({ ...p, _row: r, _col: c });
    }
    const sortedRows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
    const maxRow = sortedRows[sortedRows.length - 1] || 1;
    const out = [];
    for (const r of sortedRows) {
      const players = byRow[r].sort((a, b) => a._col - b._col);
      const count = players.length;
      const xFrac = (r - 1) / Math.max(1, maxRow - 1);
      // Home: GK at left (x≈6%), forwards near center (x≈46%).
      // Away: GK at right (x≈94%), forwards near center (x≈54%).
      const x = side === 'home' ? 6 + xFrac * 40 : 94 - xFrac * 40;
      for (let i = 0; i < count; i++) {
        const y = 10 + ((i + 0.5) / count) * 80;
        out.push({ ...players[i], _x: x, _y: y });
      }
    }
    return out;
  }
  const homePositions = buildPositions('home', lineups.home?.startXI);
  const awayPositions = buildPositions('away', lineups.away?.startXI);

  // Game leaders — top scorer / assister / cards per team for the match.
  // Backend already aggregated; we just decide whether the section has
  // anything worth showing.
  const leaders = detail?.leaders || { goals: {}, assists: {}, cards: {} };
  const hasAnyLeader = ['goals', 'assists', 'cards'].some(k =>
    (leaders[k]?.home || leaders[k]?.away)
  );
  const leaderCols = [
    { key: 'goals', label: 'Goals', stat: 'goals', statLabel: 'GLS' },
    { key: 'assists', label: 'Assists', stat: 'assists', statLabel: 'AST' },
    { key: 'cards', label: 'Cards', stat: null, statLabel: '' },
  ];
  const leaderCard = (p, side) => {
    if (!p) return '<div class="gl-empty">—</div>';
    const teamLogo = side === 'home' ? homeLogo : awayLogo;
    return `<div class="gl-card gl-${side}">
      ${teamLogo ? `<img class="gl-tlogo" src="${esc(teamLogo)}" alt="" loading="lazy">` : ''}
      ${p.photo ? `<img class="gl-photo" src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="gl-photo-fb" aria-hidden="true">⚽</div>'}
      <div class="gl-body">
        <div class="gl-name">${esc(p.name)}</div>
        <div class="gl-pos">${esc(p.position || '')}${p.number != null ? ` · #${esc(p.number)}` : ''}</div>
      </div>
    </div>`;
  };
  const leaderStats = (p, key) => {
    if (!p) return '';
    const goals = `<span><strong>${esc(p.goals)}</strong>GLS</span>`;
    const assists = `<span><strong>${esc(p.assists)}</strong>AST</span>`;
    const shots = `<span><strong>${esc(p.shots)}</strong>SH</span>`;
    const shotsOn = `<span><strong>${esc(p.shotsOn)}</strong>SHOG</span>`;
    const minutes = `<span><strong>${esc(p.minutes)}</strong>MIN</span>`;
    const yellow = `<span><strong>${esc(p.yellow)}</strong>YC</span>`;
    const red = `<span><strong>${esc(p.red)}</strong>RC</span>`;
    if (key === 'goals') return `<div class="gl-stats">${goals}${shots}${shotsOn}${minutes}</div>`;
    if (key === 'assists') return `<div class="gl-stats">${assists}${shots}${minutes}</div>`;
    if (key === 'cards') return `<div class="gl-stats">${red}${yellow}${minutes}</div>`;
    return '';
  };

  const expectedSlug = slugify(`${home}-vs-${away}`);
  const canonicalSlug = expectedSlug ? `${fixtureId}-${expectedSlug}` : `${fixtureId}`;
  const canonical = `${SITE}/match/${canonicalSlug}/`;

  // 301 to canonical when the slug is wrong/missing — keeps duplicate-content
  // safe and forwards crawlers to the right URL.
  if (slug !== canonicalSlug && fx?.teams?.home?.name) {
    return new Response('', { status: 301, headers: { location: `/match/${canonicalSlug}/` } });
  }

  const pickLabel = pickRaw?.pickLabel || pickRaw?.pick || 'Preview coming up';
  const confidence = pickRaw?.confidence != null ? pickRaw.confidence + '%' : '—';
  const reason = pickRaw?.reason || pickRaw?.analysis || '';
  // Label honestly: premium AI pick vs the data-driven form preview.
  const pickKindLabel = pickRaw?.source === 'ai' ? 'Pro Pick' : 'Form Pick';
  // Predicted correct score (e.g. "2-1" = home-away), rendered with team names.
  const csRaw = String(pickRaw?.correctScore || '').match(/(\d+)\s*[-–:]\s*(\d+)/);
  const predScore = csRaw ? { h: csRaw[1], a: csRaw[2] } : null;

  // Extra prediction markets derived from the projected score + 1X2
  // probabilities, so "See more" reveals more than a single line.
  const probs = (pickRaw?.probabilities && pickRaw.probabilities.home != null) ? pickRaw.probabilities : null;
  const pH = predScore ? Number(predScore.h) : null;
  const pA = predScore ? Number(predScore.a) : null;
  const totalGoals = (pH != null && pA != null) ? pH + pA : null;
  const ouPick = totalGoals != null ? (totalGoals >= 3 ? 'Over 2.5' : 'Under 2.5') : null;
  const bttsPick = (pH != null && pA != null) ? (pH > 0 && pA > 0 ? 'Yes' : 'No') : null;
  let dcPick = null;
  if (probs) {
    const least = [['home', probs.home], ['draw', probs.draw], ['away', probs.away]].sort((a, b) => a[1] - b[1])[0][0];
    dcPick = least === 'away' ? `${home} or Draw` : least === 'home' ? `Draw or ${away}` : `${home} or ${away}`;
  }
  // One-line "why", weaving the markets into the form reasoning.
  const whyExtra = totalGoals != null
    ? ` The projected ${pH}–${pA} scoreline points to ${ouPick} total goals and both teams to score: ${bttsPick}.`
    : '';
  const hasMore = !!(predScore || probs);

  // Result outcome: once the match is final, show whether the pick landed.
  let verdict = null;
  if (FINISHED.has(statusShort) && hasScore) {
    const actual = homeScore > awayScore ? 'HOME' : homeScore < awayScore ? 'AWAY' : 'DRAW';
    let pk = String(pickRaw?.pick || '').toUpperCase();
    if (!['HOME', 'AWAY', 'DRAW'].includes(pk)) {
      const pl = String(pickRaw?.pickLabel || '').toLowerCase();
      pk = pl === home.toLowerCase() ? 'HOME' : pl === away.toLowerCase() ? 'AWAY' : pl.includes('draw') ? 'DRAW' : '';
    }
    if (pk) {
      const exact = predScore && Number(predScore.h) === homeScore && Number(predScore.a) === awayScore;
      verdict = { correct: pk === actual, exact, scoreline: `${homeScore}-${awayScore}` };
    }
  }

  // Related blog posts that mention either team (when any exist).
  const relatedPosts = Array.isArray(posts)
    ? posts.filter(p => {
        const hay = `${p?.title || ''} ${p?.excerpt || ''}`.toLowerCase();
        return [home, away].some(t => t && hay.includes(String(t).toLowerCase()));
      }).slice(0, 3)
    : [];

  // Head-to-head & summary
  const summary = detail?.summary || {};
  const h2h = detail?.h2h || [];
  const stats = detail?.statistics || [];
  const hStat = stats.find(x => x.team?.id === fx?.teams?.home?.id) || stats[0];
  const aStat = stats.find(x => x.team?.id === fx?.teams?.away?.id) || stats[1];

  const title = `${home} vs ${away} Prediction — ${leagueName} | ScoreOcs8`;
  const description = `${home} vs ${away} ${leagueName} prediction, head-to-head record, pro pick (${pickLabel}) and live stats from ScoreOcs8 — Malaysia online casino soccer prediction site. Kickoff ${kickoff || 'TBD'}.`;
  const ogImage = `${SITE}/og/match?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}&league=${encodeURIComponent(leagueName)}&date=${encodeURIComponent(fx?.fixture?.date || '')}`;

  // Schema.org SportsEvent JSON-LD with all the structured fields Google likes.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        "@id": canonical + "#event",
        "name": `${home} vs ${away}`,
        "description": description,
        "startDate": startIso,
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "sport": "Soccer",
        "competitor": [
          { "@type": "SportsTeam", "name": home, ...(homeLogo && { logo: homeLogo }) },
          { "@type": "SportsTeam", "name": away, ...(awayLogo && { logo: awayLogo }) }
        ],
        "superEvent": { "@type": "SportsEvent", "name": leagueName },
        ...(venue && {
          location: {
            "@type": "Place",
            "name": venue,
            ...(venueCity && { address: { "@type": "PostalAddress", "addressLocality": venueCity } })
          }
        })
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
          ...(leagueSlug ? [{ "@type": "ListItem", "position": 2, "name": leagueName, "item": `${SITE}/predictions/${leagueSlug}/` }] : []),
          { "@type": "ListItem", "position": leagueSlug ? 3 : 2, "name": `${home} vs ${away}`, "item": canonical }
        ]
      },
      {
        "@type": "WebPage",
        "@id": canonical + "#webpage",
        "url": canonical,
        "name": title,
        "description": description,
        "isPartOf": { "@id": `${SITE}/#website` },
        "primaryImageOfPage": ogImage,
        "inLanguage": "en-MY"
      }
    ]
  };

  const h2hRows = h2h.map(m => {
    const date = m.date ? new Date(m.date).toLocaleDateString('en-GB', { timeZone:'Asia/Kuala_Lumpur', day:'2-digit', month:'short', year:'numeric' }) : '';
    return `<tr><td>${esc(date)}</td><td>${esc(m.home)} ${esc(m.score_home)}–${esc(m.score_away)} ${esc(m.away)}</td><td>${esc(m.league || '')}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text3)">No head-to-head record available yet.</td></tr>';

  const logoImg = (src, name) => src ? `<img class="h2h-logo" src="${esc(src)}" alt="${esc(name)} logo" loading="lazy">` : '';
  const h2hOutcome = row => {
    const hs = Number(row.score_home), as = Number(row.score_away);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) return { label: 'Pending', cls: 'draw' };
    if (hs === as) return { label: 'Draw', cls: 'draw' };
    const winnerId = hs > as ? row.home_id : row.away_id;
    const label = winnerId === homeId ? `${home} win` : winnerId === awayId ? `${away} win` : `${hs > as ? row.home : row.away} win`;
    return { label, cls: winnerId === homeId ? 'win' : 'loss' };
  };
  const h2hRowsRich = h2h.map(row => {
    const date = row.date ? new Date(row.date).toLocaleDateString('en-GB', { timeZone:'Asia/Kuala_Lumpur', day:'2-digit', month:'short', year:'numeric' }) : '';
    const outcome = h2hOutcome(row);
    return `<tr><td>${esc(date)}</td><td><div class="h2h-matchline">${logoImg(row.home_logo, row.home)}<span>${esc(row.home)} ${esc(row.score_home)}-${esc(row.score_away)} ${esc(row.away)}</span>${logoImg(row.away_logo, row.away)}</div></td><td class="hide-mobile">${esc(row.league || '')}</td><td><span class="h2h-result ${outcome.cls}">${esc(outcome.label)}</span></td></tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text3)">No head-to-head record available yet.</td></tr>';

  const statRow = (label) => {
    const get = side => {
      const row = (side?.statistics || []).find(s => String(s.type||'').toLowerCase() === label.toLowerCase());
      return row?.value ?? '—';
    };
    return `<tr><td>${esc(get(hStat))}</td><th>${esc(label)}</th><td>${esc(get(aStat))}</td></tr>`;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">
<meta http-equiv="content-language" content="en-MY">

<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/logo.png">
<meta name="theme-color" content="#070a16">

<meta property="og:site_name" content="ScoreOcs8">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="en_MY">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@scoreocs8">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#070a16;--text:#eef1f8;--text2:#9aa5bd;--text3:#5a6680;--accent:#f97316;--green:#00e5a0;--red:#ff4757;--ff:'Rajdhani',sans-serif;--fb:'Outfit',sans-serif;--fm:'DM Mono',monospace;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#050811;color:var(--text);font-family:var(--fb);font-size:15px;line-height:1.7;min-height:100vh;}
body::before{content:'';position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(ellipse 900px 700px at 12% 8%,rgba(249,115,22,0.20),transparent 60%),radial-gradient(ellipse 800px 600px at 88% 22%,rgba(249,115,22,0.12),transparent 60%),linear-gradient(180deg,#050811 0%,#0a0e1c 45%,#070a16 100%);}
.gnav{position:fixed;top:18px;left:16px;right:16px;max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 14px;background:rgba(15,20,32,0.55);border:1px solid rgba(255,255,255,0.10);border-radius:999px;backdrop-filter:blur(22px) saturate(160%);box-shadow:0 10px 36px rgba(0,0,0,0.50),inset 0 1px 0 rgba(255,255,255,0.10);z-index:200;}
.gnav a{color:var(--text);text-decoration:none;font-weight:600;}
.gnav-logo img{height:28px;width:auto;display:block;}
.gnav-cta{padding:9px 22px;border-radius:999px;background:linear-gradient(180deg,#ff9c4a 0%,#f97316 50%,#c75808 100%);color:#fff !important;font-family:var(--ff);font-weight:700;letter-spacing:.06em;font-size:13px;text-transform:uppercase;box-shadow:0 6px 18px rgba(249,115,22,0.45),inset 0 1px 0 rgba(255,255,255,0.40);}
.wrap{max-width:980px;margin:0 auto;padding:120px 24px 60px;}
.crumb{font-family:var(--fm);font-size:11px;color:var(--text3);margin-bottom:14px;letter-spacing:.04em;}
.crumb a{color:var(--text3);text-decoration:none;}
.crumb a:hover{color:var(--accent);}
.crumb span{color:var(--accent);}
.hero{padding:28px;border-radius:24px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);backdrop-filter:blur(22px);box-shadow:0 24px 70px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.10);position:relative;overflow:hidden;margin-bottom:24px;}
.hero::before{content:'';position:absolute;top:0;left:8%;right:8%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent);}
.league-pill{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(249,115,22,0.10);border:1px solid rgba(249,115,22,0.30);color:var(--accent);font-family:var(--fm);font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:12px;}
h1{font-family:var(--ff);font-size:42px;font-weight:700;line-height:1.05;letter-spacing:.01em;text-transform:uppercase;margin-bottom:14px;}
h1 .vs{color:var(--text3);margin:0 14px;font-weight:500;}
.kickoff{font-family:var(--fm);font-size:13px;color:var(--text2);letter-spacing:.04em;margin-bottom:24px;}
.scoreboard{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px;margin-bottom:22px;padding:18px 8px;border-radius:16px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);}
.sb-team{display:flex;align-items:center;gap:14px;min-width:0;}
.sb-team.sb-home{justify-content:flex-end;text-align:right;}
.sb-team.sb-away{justify-content:flex-start;text-align:left;}
.sb-crest{width:64px;height:64px;object-fit:contain;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);padding:6px;flex-shrink:0;}
.sb-meta{min-width:0;}
.sb-name{font-family:var(--ff);font-size:20px;font-weight:600;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-record{font-family:var(--fm);font-size:11px;color:var(--text3);letter-spacing:.06em;margin-top:3px;}
.sb-center{display:grid;grid-template-columns:auto auto auto;align-items:center;gap:14px;padding:0 6px;}
.sb-score{font-family:var(--ff);font-size:48px;font-weight:700;line-height:1;color:var(--text);letter-spacing:.02em;min-width:48px;text-align:center;}
.sb-score.sb-pending{color:var(--text3);font-size:36px;}
.sb-state{text-align:center;font-family:var(--fm);}
.sb-state-label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text2);font-weight:600;}
.sb-state-sub{font-size:12px;color:var(--text3);margin-top:4px;letter-spacing:.04em;}
.sb-state.live .sb-state-label{color:var(--green);}
.sb-state.live .sb-state-label::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:6px;vertical-align:middle;box-shadow:0 0 8px var(--green);animation:sb-pulse 1.5s ease-in-out infinite;}
.sb-state.final .sb-state-label{color:var(--accent);}
@keyframes sb-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.tl-wrap{display:flex;align-items:stretch;gap:14px;overflow-x:auto;padding:8px 4px 4px;-webkit-overflow-scrolling:touch;}
.tl-crests{display:flex;flex-direction:column;justify-content:space-between;width:34px;flex-shrink:0;padding:6px 0;}
.tl-crests img{width:30px;height:30px;object-fit:contain;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);padding:3px;}
.tl-track{position:relative;flex:1;min-width:520px;min-height:118px;}
.tl-line{position:absolute;top:50%;left:0;right:42px;height:2px;background:linear-gradient(90deg,rgba(0,229,160,.10),rgba(0,229,160,.55),rgba(0,229,160,.10));transform:translateY(-1px);}
.tl-event{position:absolute;transform:translateX(-50%);text-align:center;width:36px;}
.tl-event.tl-home{top:6px;}
.tl-event.tl-away{bottom:6px;}
.tl-min{font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.04em;margin-top:2px;}
.tl-event.tl-away .tl-min{margin-top:0;margin-bottom:2px;order:-1;display:block;}
.tl-icon{font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);}
.tl-icon.red{background:rgba(255,71,87,.16);border-color:rgba(255,71,87,.40);}
.tl-icon.yellow{background:rgba(245,166,35,.14);border-color:rgba(245,166,35,.34);}
.tl-icon.own{background:rgba(255,71,87,.10);border-color:rgba(255,71,87,.30);}
.tl-icon.pen{background:rgba(0,229,160,.10);border-color:rgba(0,229,160,.30);}
.tl-ft{position:absolute;top:50%;right:0;transform:translateY(-50%);padding:5px 9px;border-radius:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);font-family:var(--fm);font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:var(--text2);}
.gl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
.gl-col{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 14px 12px;display:flex;flex-direction:column;gap:10px;}
.gl-col-h{font-family:var(--ff);font-size:13px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--accent);}
.gl-card{position:relative;display:grid;grid-template-columns:48px 1fr;align-items:center;gap:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);}
.gl-tlogo{position:absolute;top:6px;right:6px;width:18px;height:18px;object-fit:contain;opacity:.85;}
.gl-photo{width:48px;height:48px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);}
.gl-photo-fb{width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:20px;}
.gl-body{min-width:0;}
.gl-name{font-family:var(--ff);font-size:15px;font-weight:700;color:var(--text);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gl-pos{font-family:var(--fm);font-size:11px;color:var(--text3);letter-spacing:.04em;margin-top:3px;}
.gl-stats{display:flex;justify-content:flex-start;gap:14px;padding:0 4px 2px;margin-top:-4px;}
.gl-stats span{font-family:var(--fm);font-size:10px;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;display:inline-flex;flex-direction:column;align-items:center;gap:1px;}
.gl-stats strong{font-family:var(--ff);font-size:14px;font-weight:700;color:var(--text);letter-spacing:0;}
.gl-empty{padding:10px;border-radius:10px;background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.10);text-align:center;font-family:var(--fm);font-size:11px;color:var(--text3);letter-spacing:.04em;}
.fp-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;font-family:var(--ff);}
.fp-team{display:flex;align-items:center;gap:10px;min-width:0;}
.fp-team.fp-away{flex-direction:row-reverse;text-align:right;}
.fp-team img{width:32px;height:32px;object-fit:contain;}
.fp-team-name{font-size:16px;font-weight:700;color:var(--text);}
.fp-formation{font-family:var(--fm);font-size:11px;color:var(--accent);letter-spacing:.10em;}
.fp-wrap{position:relative;width:100%;min-height:420px;overflow:hidden;border-radius:14px;border:1px solid rgba(0,229,160,.18);background:
  linear-gradient(90deg,rgba(0,229,160,.06) 0%,rgba(0,229,160,.10) 50%,rgba(0,229,160,.06) 100%),
  repeating-linear-gradient(90deg,rgba(0,0,0,.10) 0,rgba(0,0,0,.10) 36px,transparent 36px,transparent 72px),
  linear-gradient(180deg,#0f2415 0%,#163521 50%,#0f2415 100%);
}
.fp-wrap::before{content:'';position:absolute;top:50%;left:50%;width:120px;height:120px;border:2px solid rgba(255,255,255,.20);border-radius:50%;transform:translate(-50%,-50%);}
.fp-wrap::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(255,255,255,.18);}
.fp-box{position:absolute;top:50%;width:90px;height:200px;border:2px solid rgba(255,255,255,.18);transform:translateY(-50%);}
.fp-box.fp-box-l{left:0;border-left:none;}
.fp-box.fp-box-r{right:0;border-right:none;}
.fp-jersey{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:4px;width:62px;z-index:2;}
.fp-jersey-shirt{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--ff);font-size:14px;font-weight:800;color:#fff;border:2px solid rgba(255,255,255,.30);box-shadow:0 4px 10px rgba(0,0,0,.40);}
.fp-jersey.home .fp-jersey-shirt{background:linear-gradient(135deg,#4f7cf7,#2c4fc4);}
.fp-jersey.away .fp-jersey-shirt{background:linear-gradient(135deg,#ff5f5f,#c43030);}
.fp-jersey-name{font-family:var(--ff);font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.85);text-align:center;line-height:1.15;max-width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.fp-bench{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;}
.fp-bench-col h3{font-family:var(--ff);font-size:13px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
.fp-bench-col h3 small{display:block;font-family:var(--fm);font-size:10px;font-weight:400;color:var(--text3);letter-spacing:.04em;margin-top:2px;text-transform:none;}
.fp-bench-list{display:flex;flex-direction:column;gap:6px;}
.fp-bench-list li{display:flex;align-items:center;gap:10px;font-family:var(--fb);font-size:13px;color:var(--text2);list-style:none;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);}
.fp-bench-num{font-family:var(--fm);font-size:11px;color:var(--text3);min-width:22px;text-align:center;}
.pick-card{padding:20px 22px;border-radius:16px;background:linear-gradient(135deg,rgba(249,115,22,0.18),rgba(249,115,22,0.04));border:1px solid rgba(249,115,22,0.32);box-shadow:inset 0 1px 0 rgba(255,255,255,0.10),0 0 30px rgba(249,115,22,0.18);}
.pick-card .label{font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px;}
.pick-card .pick{font-family:var(--ff);font-size:26px;font-weight:700;color:var(--accent);letter-spacing:.04em;}
.pick-card .conf{font-family:var(--ff);font-size:18px;font-weight:700;color:var(--green);}
.pick-row{display:flex;justify-content:space-between;align-items:center;gap:16px;}
.pick-reason{margin-top:14px;font-size:14px;color:var(--text2);line-height:1.7;border-top:1px solid rgba(249,115,22,0.20);padding-top:12px;}
.pick-verdict{margin-top:14px;padding:11px 14px;border-radius:10px;font-family:var(--ff);font-size:15px;font-weight:700;letter-spacing:.02em;}
.pick-verdict.won{background:rgba(0,229,160,.12);border:1px solid rgba(0,229,160,.35);color:#00e5a0;}
.pick-verdict.lost{background:rgba(255,71,87,.10);border:1px solid rgba(255,71,87,.30);color:#ff6b78;}
.pred-more{margin-top:14px;border-top:1px solid rgba(249,115,22,0.20);padding-top:12px;}
.pred-more summary{font-family:var(--ff);font-size:14px;font-weight:700;color:var(--accent);cursor:pointer;letter-spacing:.03em;list-style:none;}
.pred-more summary::-webkit-details-marker{display:none;}
.pred-more[open] summary{margin-bottom:12px;}
.pred-more-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.pred-more-grid div{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:9px 12px;}
.pred-more-grid span{display:block;font-family:var(--fm);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:3px;}
.pred-more-grid strong{font-family:var(--ff);font-size:15px;font-weight:700;color:var(--text);}
.pred-more-why{margin-top:12px;font-size:13.5px;color:var(--text2);line-height:1.7;}
@media(max-width:560px){.pred-more-grid{grid-template-columns:1fr;}}
.section{padding:24px;border-radius:18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);backdrop-filter:blur(18px);box-shadow:0 14px 40px rgba(0,0,0,0.32),inset 0 1px 0 rgba(255,255,255,0.08);margin-bottom:18px;position:relative;}
.section h2{font-family:var(--ff);font-size:22px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:14px;}
.section h2 small{font-family:var(--fm);font-size:11px;font-weight:400;letter-spacing:.10em;color:var(--text3);text-transform:uppercase;margin-left:8px;}
.h2h-summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;}
.h2h-stat{padding:14px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);text-align:center;}
.h2h-stat strong{font-family:var(--ff);font-size:30px;color:var(--accent);display:block;line-height:1;}
.h2h-stat span{font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.10em;text-transform:uppercase;display:block;margin-top:6px;}
.h2h-matchline{display:flex;align-items:center;gap:8px;font-family:var(--ff);font-weight:700;color:var(--text);}
.h2h-logo{width:28px;height:28px;object-fit:contain;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);padding:3px;flex-shrink:0;}
.h2h-result{display:inline-flex;align-items:center;justify-content:center;padding:4px 9px;border-radius:999px;font-family:var(--fm);font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;}
.h2h-result.win{color:var(--green);background:rgba(0,229,160,.10);border:1px solid rgba(0,229,160,.24);}
.h2h-result.loss{color:var(--red);background:rgba(255,71,87,.10);border:1px solid rgba(255,71,87,.24);}
.h2h-result.draw{color:var(--amber);background:rgba(245,166,35,.10);border:1px solid rgba(245,166,35,.24);}
.table-scroll{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}
.table-scroll table{min-width:520px;}
table{width:100%;border-collapse:collapse;font-size:14px;}
table td,table th{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:left;}
table th{font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.10em;text-transform:uppercase;font-weight:500;}
table.stats{table-layout:fixed;}
table.stats td{text-align:center;font-family:var(--ff);font-weight:700;}
table.stats td:nth-child(2){font-family:var(--fm);font-size:11px;font-weight:500;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;}
.cta{margin:30px 0;padding:24px;border-radius:18px;background:linear-gradient(135deg,rgba(249,115,22,0.10),rgba(255,255,255,0.04));border:1px solid rgba(249,115,22,0.28);text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.40),0 0 40px rgba(249,115,22,0.18);}
.cta h3{font-family:var(--ff);font-size:24px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;}
.cta p{color:var(--text2);font-size:14px;margin-bottom:18px;}
.cta-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:14px;background:linear-gradient(180deg,#ff9c4a,#f97316,#c75808);color:#fff;text-decoration:none;font-family:var(--ff);font-weight:700;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 8px 22px rgba(249,115,22,0.45),inset 0 1px 0 rgba(255,255,255,0.40);}
@media(max-width:600px){
  .wrap{padding:100px 14px 40px;}
  h1{font-size:30px;}
  h1 .vs{display:block;margin:8px 0;}
  .scoreboard{gap:8px;padding:14px 4px;}
  .sb-team{gap:8px;}
  .sb-crest{width:44px;height:44px;padding:4px;}
  .sb-name{font-size:14px;}
  .sb-center{gap:8px;padding:0 2px;}
  .sb-score{font-size:34px;min-width:34px;}
  .sb-score.sb-pending{font-size:26px;}
  .sb-state-label{font-size:10px;letter-spacing:.10em;}
  .sb-state-sub{font-size:11px;}
  .pick-card .pick{font-size:22px;}
  .h2h-summary{grid-template-columns:1fr;}
  .hide-mobile{display:none !important;}
  .table-scroll table{min-width:360px;}
  .h2h-matchline{flex-wrap:wrap;gap:6px;font-size:13px;}
  .tl-track{min-width:480px;}
  .tl-event{width:32px;}
  .tl-icon{width:22px;height:22px;font-size:14px;}
  .gl-grid{grid-template-columns:1fr;}
  .gl-stats span{font-size:9px;}
  .gl-stats strong{font-size:13px;}
  .fp-wrap{min-height:360px;}
  .fp-jersey{width:48px;}
  .fp-jersey-shirt{width:28px;height:28px;font-size:12px;}
  .fp-jersey-name{font-size:9px;max-width:60px;}
  .fp-bench{grid-template-columns:1fr;}
  .h2h-logo{width:22px;height:22px;}
}
</style>
</head>
<body>

<nav class="gnav">
  <a href="/" class="gnav-logo"><img src="/logo.png" alt="ScoreOcs8"></a>
  <a href="/" class="gnav-cta">Home</a>
</nav>

<div class="wrap">
  <div class="crumb">
    <a href="/">Home</a> ›
    ${leagueSlug ? `<a href="/predictions/${esc(leagueSlug)}/">${esc(leagueName)}</a> › ` : ''}
    <span>${esc(home)} vs ${esc(away)}</span>
  </div>

  <article class="hero">
    <span class="league-pill">${leagueFlag} ${esc(leagueName)}</span>
    <h1>${esc(home)}<span class="vs">vs</span>${esc(away)}</h1>
    <div class="kickoff">⏰ Kickoff: ${esc(kickoff || 'TBD')}${venue ? ` · 🏟 ${esc(venue)}${venueCity ? ', ' + esc(venueCity) : ''}` : ''}</div>

    <div class="scoreboard" role="group" aria-label="${esc(home)} ${showScore ? homeScore + '-' + awayScore : 'vs'} ${esc(away)}, ${esc(stateLabel)}">
      <div class="sb-team sb-home">
        <div class="sb-meta"><div class="sb-name">${esc(home)}</div>${homeRecord ? `<div class="sb-record">${esc(homeRecord)}</div>` : ''}</div>
        ${homeLogo ? `<img class="sb-crest" src="${esc(homeLogo)}" alt="${esc(home)} crest" loading="eager">` : '<div class="sb-crest" aria-hidden="true">⚽</div>'}
      </div>
      <div class="sb-center">
        <div class="sb-score${showScore ? '' : ' sb-pending'}">${esc(homeScoreDisplay)}</div>
        <div class="sb-state ${stateCls}">
          <div class="sb-state-label">${esc(stateLabel)}</div>
          <div class="sb-state-sub">${esc(stateSub)}</div>
        </div>
        <div class="sb-score${showScore ? '' : ' sb-pending'}">${esc(awayScoreDisplay)}</div>
      </div>
      <div class="sb-team sb-away">
        ${awayLogo ? `<img class="sb-crest" src="${esc(awayLogo)}" alt="${esc(away)} crest" loading="eager">` : '<div class="sb-crest" aria-hidden="true">⚽</div>'}
        <div class="sb-meta"><div class="sb-name">${esc(away)}</div>${awayRecord ? `<div class="sb-record">${esc(awayRecord)}</div>` : ''}</div>
      </div>
    </div>

    <div class="pick-card">
      <div class="pick-row">
        <div>
          <div class="label">${pickKindLabel}</div>
          <div class="pick">${esc(pickLabel)}</div>
        </div>
        <div style="text-align:right;">
          <div class="label">Confidence</div>
          <div class="conf">${esc(confidence)}</div>
        </div>
      </div>
      ${verdict ? `<div class="pick-verdict ${verdict.correct ? 'won' : 'lost'}">
        ${verdict.correct ? '✅ Prediction correct' : '❌ Prediction missed'} · Final ${esc(verdict.scoreline)}${verdict.exact ? ' · exact score 🎯' : ''}
      </div>` : ''}
      ${predScore ? `<div class="pick-score" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">
        <span class="label">Predicted score</span>
        <span style="font-family:var(--ff);font-weight:700;font-size:16px;">${esc(home)} <span style="color:var(--accent);">${esc(predScore.h)}–${esc(predScore.a)}</span> ${esc(away)}</span>
      </div>` : ''}
      ${reason ? `<div class="pick-reason">${esc(reason)}</div>` : ''}
      ${hasMore ? `<details class="pred-more">
        <summary>See more prediction &amp; why →</summary>
        <div class="pred-more-grid">
          <div><span>Match result</span><strong>${esc(pickLabel)}</strong></div>
          ${predScore ? `<div><span>Predicted score</span><strong>${esc(home)} ${esc(predScore.h)}–${esc(predScore.a)} ${esc(away)}</strong></div>` : ''}
          ${ouPick ? `<div><span>Total goals</span><strong>${esc(ouPick)}</strong></div>` : ''}
          ${bttsPick ? `<div><span>Both teams to score</span><strong>${esc(bttsPick)}</strong></div>` : ''}
          ${dcPick ? `<div><span>Double chance</span><strong>${esc(dcPick)}</strong></div>` : ''}
          ${probs ? `<div><span>Win probability</span><strong>${esc(home)} ${probs.home}% · Draw ${probs.draw}% · ${esc(away)} ${probs.away}%</strong></div>` : ''}
        </div>
        <p class="pred-more-why"><b>Why:</b> ${esc(reason)}${esc(whyExtra)} This is a form-and-data projection, not a guaranteed result.</p>
      </details>` : ''}
    </div>
  </article>

  ${relatedPosts.length ? `
  <section class="section">
    <h2>Related reading <small>· ${esc(home)} &amp; ${esc(away)}</small></h2>
    <div style="display:grid;gap:10px;">
      ${relatedPosts.map(p => `<a href="/blog/${esc(p.slug)}/?lang=en" style="display:block;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);text-decoration:none;color:var(--text);">
        <div style="font-family:var(--ff);font-weight:700;font-size:17px;line-height:1.3;">${esc(p.title)}</div>
        <div style="font-family:var(--fm);font-size:11px;color:var(--text3);margin-top:5px;">${esc(p.category_label || 'Blog')}${p.date ? ` · ${esc(p.date)}` : ''} · Read →</div>
      </a>`).join('')}
    </div>
  </section>` : ''}

  ${timelineEvents.length ? `
  <section class="section">
    <h2>Match Timeline <small>· ${timelineEvents.length} event${timelineEvents.length === 1 ? '' : 's'}</small></h2>
    <div class="tl-wrap">
      <div class="tl-crests">
        ${homeLogo ? `<img src="${esc(homeLogo)}" alt="${esc(home)} crest" loading="lazy">` : '<span aria-hidden="true">⚽</span>'}
        ${awayLogo ? `<img src="${esc(awayLogo)}" alt="${esc(away)} crest" loading="lazy">` : '<span aria-hidden="true">⚽</span>'}
      </div>
      <div class="tl-track" role="list" aria-label="Match events timeline">
        <div class="tl-line" aria-hidden="true"></div>
        ${timelineEvents.map(e => `<div class="tl-event tl-${e.side}" style="left:${e.pct.toFixed(2)}%" role="listitem" title="${esc(e.minLabel)} — ${esc(e.label)}${e.player ? ' · ' + esc(e.player) : ''}${e.assist ? ' (assist: ' + esc(e.assist) + ')' : ''}"><span class="tl-icon ${e.cls}" aria-hidden="true">${e.sym}</span><span class="tl-min">${esc(e.minLabel)}</span></div>`).join('')}
        ${FINISHED.has(statusShort) ? `<div class="tl-ft" aria-label="Full time">${esc(statusShort)}</div>` : ''}
      </div>
    </div>
  </section>` : ''}

  ${hasLineups ? `
  <section class="section">
    <h2>Formation <small>· starting XI on the pitch</small></h2>
    <div class="fp-head">
      <div class="fp-team fp-home">
        ${homeLogo ? `<img src="${esc(homeLogo)}" alt="${esc(home)} crest">` : ''}
        <div>
          <div class="fp-team-name">${esc(lineups.home?.team_name || home)}</div>
          <div class="fp-formation">${esc(lineups.home?.formation || '')}</div>
        </div>
      </div>
      <div class="fp-team fp-away">
        ${awayLogo ? `<img src="${esc(awayLogo)}" alt="${esc(away)} crest">` : ''}
        <div>
          <div class="fp-team-name">${esc(lineups.away?.team_name || away)}</div>
          <div class="fp-formation">${esc(lineups.away?.formation || '')}</div>
        </div>
      </div>
    </div>
    <div class="fp-wrap" role="img" aria-label="${esc(home)} vs ${esc(away)} formation pitch">
      <div class="fp-box fp-box-l" aria-hidden="true"></div>
      <div class="fp-box fp-box-r" aria-hidden="true"></div>
      ${homePositions.map(p => `<div class="fp-jersey home" style="left:${p._x.toFixed(2)}%;top:${p._y.toFixed(2)}%" title="${esc(p.name)}${p.pos ? ' · ' + esc(p.pos) : ''}"><div class="fp-jersey-shirt">${esc(p.number ?? '')}</div><div class="fp-jersey-name">${esc(p.name.split(' ').pop() || p.name)}</div></div>`).join('')}
      ${awayPositions.map(p => `<div class="fp-jersey away" style="left:${p._x.toFixed(2)}%;top:${p._y.toFixed(2)}%" title="${esc(p.name)}${p.pos ? ' · ' + esc(p.pos) : ''}"><div class="fp-jersey-shirt">${esc(p.number ?? '')}</div><div class="fp-jersey-name">${esc(p.name.split(' ').pop() || p.name)}</div></div>`).join('')}
    </div>
    ${(lineups.home?.substitutes?.length || lineups.away?.substitutes?.length) ? `
    <div class="fp-bench">
      <div class="fp-bench-col">
        <h3>${esc(home)} bench${lineups.home?.coach ? ` <small>Coach · ${esc(lineups.home.coach)}</small>` : ''}</h3>
        <ul class="fp-bench-list">${(lineups.home?.substitutes || []).map(s => `<li><span class="fp-bench-num">${esc(s.number ?? '')}</span>${esc(s.name)}${s.pos ? ` · ${esc(s.pos)}` : ''}</li>`).join('')}</ul>
      </div>
      <div class="fp-bench-col">
        <h3>${esc(away)} bench${lineups.away?.coach ? ` <small>Coach · ${esc(lineups.away.coach)}</small>` : ''}</h3>
        <ul class="fp-bench-list">${(lineups.away?.substitutes || []).map(s => `<li><span class="fp-bench-num">${esc(s.number ?? '')}</span>${esc(s.name)}${s.pos ? ` · ${esc(s.pos)}` : ''}</li>`).join('')}</ul>
      </div>
    </div>` : ''}
  </section>` : ''}

  ${hasAnyLeader ? `
  <section class="section">
    <h2>Game leaders <small>· top performers per team</small></h2>
    <div class="gl-grid">
      ${leaderCols.map(col => {
        const homeP = leaders[col.key]?.home;
        const awayP = leaders[col.key]?.away;
        if (!homeP && !awayP) return '';
        return `<div class="gl-col">
          <div class="gl-col-h">${esc(col.label)}</div>
          ${leaderCard(homeP, 'home')}
          ${leaderStats(homeP, col.key)}
          ${leaderCard(awayP, 'away')}
          ${leaderStats(awayP, col.key)}
        </div>`;
      }).join('')}
    </div>
  </section>` : ''}

  <section class="section">
    <h2>Head-to-head <small>· last ${h2h.length || 0} meetings</small></h2>
    <div class="h2h-summary">
      <div class="h2h-stat"><strong>${esc(summary.homeWins ?? 0)}</strong><span>${esc(home)} wins</span></div>
      <div class="h2h-stat"><strong>${esc(summary.draws ?? 0)}</strong><span>Draws</span></div>
      <div class="h2h-stat"><strong>${esc(summary.awayWins ?? 0)}</strong><span>${esc(away)} wins</span></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Date</th><th>Match</th><th class="hide-mobile">Competition</th><th>Outcome</th></tr></thead>
        <tbody>${h2hRowsRich}</tbody>
      </table>
    </div>
  </section>

  ${stats.length ? `
  <section class="section">
    <h2>Match statistics <small>· live in-game data</small></h2>
    <table class="stats">
      <thead><tr><th style="text-align:center">${esc(home)}</th><th style="text-align:center">Stat</th><th style="text-align:center">${esc(away)}</th></tr></thead>
      <tbody>
        ${['Total Shots','Shots on Goal','Ball Possession','Corner Kicks','Fouls','Yellow Cards','Red Cards'].map(statRow).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <div class="cta">
    <h3>Bet on this prediction</h3>
    <p>Open the official OCS8 money-site domain to register, login, and place this pick.</p>
    <a class="cta-btn" href="https://ocs8my.com/signup?ref=OCSFMZ6HVI" target="_blank" rel="noopener">Open OCS8</a>
    <button type="button" onclick="window.BettingTutorial && window.BettingTutorial.open('1x2')" style="margin-top:12px;background:transparent;color:var(--accent);border:1px solid rgba(249,115,22,.4);border-radius:8px;padding:10px 18px;font-family:var(--ff,'Rajdhani',sans-serif);font-size:14px;font-weight:700;letter-spacing:.04em;cursor:pointer;">📘 See how betting markets settle →</button>
  </div>

  <p style="font-size:12px;color:var(--text3);text-align:center;margin-top:30px;">ScoreOcs8 predictions are informational only — not a guarantee. 18+ only.</p>
</div>
<script src="/betting-tutorial.js" defer></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, must-revalidate',
    },
  });
}
