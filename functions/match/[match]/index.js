// Per-match landing page: /match/<fixture-id>-<home>-vs-<away>/
// Server-rendered, indexable, glass-styled. Pulls data from /api/match-detail
// and /api/predictions to assemble a full preview with H2H + pro pick + meta.
//
// SEO model: each fixture gets its own canonical URL ranking for queries like
// "<home> vs <away> prediction" and "<home> vs <away> head to head".

const SITE = 'https://scoreocs8.pages.dev';

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
  const [detail, pickRaw] = await Promise.all([
    fetchJson(origin, `/api/match-detail?fixture_id=${fixtureId}`),
    context.env.CACHE?.get(`prediction:${fixtureId}`, 'json').catch(() => null),
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

  const expectedSlug = slugify(`${home}-vs-${away}`);
  const canonicalSlug = expectedSlug ? `${fixtureId}-${expectedSlug}` : `${fixtureId}`;
  const canonical = `${SITE}/match/${canonicalSlug}/`;

  // 301 to canonical when the slug is wrong/missing — keeps duplicate-content
  // safe and forwards crawlers to the right URL.
  if (slug !== canonicalSlug && fx?.teams?.home?.name) {
    return new Response('', { status: 301, headers: { location: `/match/${canonicalSlug}/` } });
  }

  const pickLabel = pickRaw?.pickLabel || pickRaw?.pick || 'Pro analysis pending';
  const confidence = pickRaw?.confidence != null ? pickRaw.confidence + '%' : '—';
  const reason = pickRaw?.reason || pickRaw?.analysis || '';

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
    return `<tr><td>${esc(date)}</td><td><div class="h2h-matchline">${logoImg(row.home_logo, row.home)}<span>${esc(row.home)} ${esc(row.score_home)}-${esc(row.score_away)} ${esc(row.away)}</span>${logoImg(row.away_logo, row.away)}</div></td><td>${esc(row.league || '')}</td><td><span class="h2h-result ${outcome.cls}">${esc(outcome.label)}</span></td></tr>`;
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
.teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px;margin-bottom:22px;}
.team{text-align:center;}
.team img{width:80px;height:80px;object-fit:contain;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);padding:8px;}
.team .nm{font-family:var(--ff);font-size:20px;font-weight:600;margin-top:10px;}
.vsbox{font-family:var(--ff);font-size:36px;font-weight:700;color:var(--text3);}
.pick-card{padding:20px 22px;border-radius:16px;background:linear-gradient(135deg,rgba(249,115,22,0.18),rgba(249,115,22,0.04));border:1px solid rgba(249,115,22,0.32);box-shadow:inset 0 1px 0 rgba(255,255,255,0.10),0 0 30px rgba(249,115,22,0.18);}
.pick-card .label{font-family:var(--fm);font-size:10px;color:var(--text3);letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px;}
.pick-card .pick{font-family:var(--ff);font-size:26px;font-weight:700;color:var(--accent);letter-spacing:.04em;}
.pick-card .conf{font-family:var(--ff);font-size:18px;font-weight:700;color:var(--green);}
.pick-row{display:flex;justify-content:space-between;align-items:center;gap:16px;}
.pick-reason{margin-top:14px;font-size:14px;color:var(--text2);line-height:1.7;border-top:1px solid rgba(249,115,22,0.20);padding-top:12px;}
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
  .team img{width:60px;height:60px;}
  .team .nm{font-size:16px;}
  .vsbox{font-size:24px;}
  .pick-card .pick{font-size:22px;}
  .h2h-summary{grid-template-columns:1fr;}
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

    <div class="teams">
      <div class="team">
        ${homeLogo ? `<img src="${esc(homeLogo)}" alt="${esc(home)} logo" loading="eager">` : '<div class="team-fallback">⚽</div>'}
        <div class="nm">${esc(home)}</div>
      </div>
      <div class="vsbox">VS</div>
      <div class="team">
        ${awayLogo ? `<img src="${esc(awayLogo)}" alt="${esc(away)} logo" loading="eager">` : '<div class="team-fallback">⚽</div>'}
        <div class="nm">${esc(away)}</div>
      </div>
    </div>

    <div class="pick-card">
      <div class="pick-row">
        <div>
          <div class="label">Pro Pick</div>
          <div class="pick">${esc(pickLabel)}</div>
        </div>
        <div style="text-align:right;">
          <div class="label">Confidence</div>
          <div class="conf">${esc(confidence)}</div>
        </div>
      </div>
      ${reason ? `<div class="pick-reason">${esc(reason)}</div>` : ''}
    </div>
  </article>

  <section class="section">
    <h2>Head-to-head <small>· last ${h2h.length || 0} meetings</small></h2>
    <div class="h2h-summary">
      <div class="h2h-stat"><strong>${esc(summary.homeWins ?? 0)}</strong><span>${esc(home)} wins</span></div>
      <div class="h2h-stat"><strong>${esc(summary.draws ?? 0)}</strong><span>Draws</span></div>
      <div class="h2h-stat"><strong>${esc(summary.awayWins ?? 0)}</strong><span>${esc(away)} wins</span></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Match</th><th>Competition</th><th>Outcome</th></tr></thead>
      <tbody>${h2hRowsRich}</tbody>
    </table>
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
    <a class="cta-btn" href="/register.html">Open OCS8</a>
  </div>

  <p style="font-size:12px;color:var(--text3);text-align:center;margin-top:30px;">ScoreOcs8 predictions are informational only — not a guarantee. 18+ only.</p>
</div>

</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, must-revalidate',
    },
  });
}
