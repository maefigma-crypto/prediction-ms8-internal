// ScoreOcs8 — /daily/ screenshot-ready predictions page.
//
// Purpose: renders a clean 1080×1920 portrait HTML card that the posting
// cron screenshots daily and fans out to Telegram / X / Threads / IG / WA.
//
// Data flow:
//   1. Read content:YYYY-MM-DD from KV (written by cron/src/index.js) to
//      get the 3 featured fixtures for today.
//   2. For each fixture, read prediction:<fixture_id> from KV (written by
//      /api/predictions?fixture_id=X) to get the AI pick + confidence.
//   3. Render a pure-HTML page with inline CSS (no JS) so the page is
//      fully painted on first byte — screenshot tools capture it cleanly.
//
// Not indexed (noindex + robots disallow via /robots.txt).

const LEAGUE_EMOJI = {
  39: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',   // Premier League
  2: '⭐',                                // Champions League
  1: '🏆',                                // FIFA World Cup
  278: '🇲🇾',                             // Malaysia Super League
  140: '🇪🇸',                             // La Liga
  78: '🇩🇪',                              // Bundesliga
  135: '🇮🇹',                             // Serie A
  61: '🇫🇷',                              // Ligue 1
};

function esc(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]));
}

function todayMYT() {
  // en-CA gives YYYY-MM-DD format; timeZone scopes to Kuala Lumpur.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDisplayDate(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).toUpperCase();
}

function fmtKickoff(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--';
  }
}

// Fetch the AI pick for one fixture from KV. Falls back to a placeholder if
// the prediction hasn't been generated/cached yet.
async function getPick(env, fixtureId) {
  try {
    const hit = await env.CACHE.get(`prediction:${fixtureId}`, 'json');
    if (!hit) return null;
    return {
      label: hit.pickLabel || hit.pick || 'Analysing',
      confidence: hit.confidence != null ? `${hit.confidence}%` : '—',
      risk: hit.risk || '',
    };
  } catch {
    return null;
  }
}

// Best-effort accuracy lookup. Key shape is agnostic for now — tracker is
// wired up in a later step. If nothing is set we show "launching soon".
async function getWeeklyAccuracy(env) {
  try {
    const raw = await env.CACHE.get('accuracy:week:current');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.total) return null;
    return {
      hits: data.hits,
      total: data.total,
      pct: Math.round((data.hits / data.total) * 100),
    };
  } catch {
    return null;
  }
}

// Load the 3 featured fixtures for today. Prefer MYT date, fall back to UTC
// in the 00:00-08:00 MYT window where cron's UTC date is still yesterday.
async function loadFeatured(env, dateOverride) {
  const keys = dateOverride
    ? [`content:${dateOverride}`]
    : [`content:${todayMYT()}`, `content:${todayUTC()}`];
  for (const k of keys) {
    const content = await env.CACHE.get(k, 'json');
    if (!content) continue;
    const list = [];
    if (content.top?.fixture) list.push(content.top.fixture);
    if (Array.isArray(content.previews)) {
      for (const p of content.previews) {
        if (p.fixture) list.push(p.fixture);
      }
    }
    if (list.length) return { fixtures: list.slice(0, 3), sourceKey: k };
  }
  return { fixtures: [], sourceKey: null };
}

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const dateOverride = url.searchParams.get('date');
  const debug = url.searchParams.get('debug') === '1';

  const displayDate = dateOverride || todayMYT();
  const { fixtures, sourceKey } = await loadFeatured(env, dateOverride);

  // Hydrate each fixture with its cached AI pick.
  const picks = await Promise.all(
    fixtures.map(async fx => ({ fx, pick: await getPick(env, fx.fixture?.id) }))
  );

  const accuracy = await getWeeklyAccuracy(env);

  const html = renderHtml({
    displayDate,
    picks,
    accuracy,
    debug: debug ? { sourceKey, count: picks.length } : null,
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short edge cache so rapid screenshot retries hit cache but daily
      // content refreshes within 5 min of cron generation.
      'cache-control': 'public, max-age=300, must-revalidate',
      // Never index this page — it's a screenshot target, not a landing page.
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function renderPickRow({ fx, pick }) {
  const league = fx.league?.name || '';
  const flag = LEAGUE_EMOJI[fx.league?.id] || '⚽';
  const home = fx.teams?.home?.name || 'Home';
  const away = fx.teams?.away?.name || 'Away';
  const homeLogo = fx.teams?.home?.logo || '';
  const awayLogo = fx.teams?.away?.logo || '';
  const time = fmtKickoff(fx.fixture?.date);
  const pickLabel = pick?.label || 'AI analysing';
  const pickConf = pick?.confidence || '—';

  return `
    <div class="pick">
      <div class="ph">
        <span class="pl">${flag} ${esc(league)}</span>
        <span class="pt">${esc(time)} MYT</span>
      </div>
      <div class="pm">
        <div class="tm">
          ${homeLogo ? `<img class="tl" src="${esc(homeLogo)}" alt="" loading="eager">` : '<div class="tl tlf">⚽</div>'}
          <div class="tn">${esc(home)}</div>
        </div>
        <div class="vs">VS</div>
        <div class="tm tm-r">
          ${awayLogo ? `<img class="tl" src="${esc(awayLogo)}" alt="" loading="eager">` : '<div class="tl tlf">⚽</div>'}
          <div class="tn">${esc(away)}</div>
        </div>
      </div>
      <div class="pa">
        <div class="pal">⚡ AI PICK · 推介</div>
        <div class="pav">${esc(pickLabel)}</div>
        <div class="pac">Confidence · 胜率: <b>${esc(pickConf)}</b></div>
      </div>
    </div>`;
}

function renderHtml({ displayDate, picks, accuracy, debug }) {
  const pickRows = picks.length
    ? picks.map(renderPickRow).join('')
    : `<div class="empty">
         <div class="el">Today's picks are being generated</div>
         <div class="es">今日推介即将上线 · Check back at 10:00 MYT</div>
       </div>`;

  const accBlock = accuracy
    ? `<div class="acc">
         <div class="acl">📊 Accuracy this week · 本周准确率</div>
         <div class="acv">${accuracy.hits} / ${accuracy.total} correct · ${accuracy.pct}%</div>
       </div>`
    : `<div class="acc">
         <div class="acl">📊 Weekly accuracy tracker · 本周准确率追踪</div>
         <div class="acv">Launching soon · 即将上线</div>
       </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ScoreOcs8 · Today's Predictions · 今日足球精选预测</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --accent:#F97316;--accent2:#EA580C;
    --bg:#080B10;--bg2:#0F1620;--card:#131821;--card2:#0C1119;
    --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.14);
    --text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8;
    --green:#00E5A0;
    --ff:'Oswald',system-ui,sans-serif;
    --fm:'Rajdhani',sans-serif;
    --fb:'Inter',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1920px;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--fb);-webkit-font-smoothing:antialiased;}
  body::before{
    content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
    background:
      radial-gradient(circle at 15% 10%,rgba(249,115,22,0.10) 0%,transparent 45%),
      radial-gradient(circle at 85% 90%,rgba(0,229,160,0.05) 0%,transparent 45%);
  }
  .card{
    position:relative;z-index:1;width:1080px;height:1920px;padding:70px 64px;
    display:flex;flex-direction:column;gap:34px;
  }

  /* Brand row */
  .brand{display:flex;justify-content:space-between;align-items:center;}
  .logo{font-family:var(--ff);font-size:58px;font-weight:700;letter-spacing:.05em;color:var(--text);}
  .logo span{color:var(--accent);}
  .date{font-family:var(--fm);font-size:26px;font-weight:600;color:var(--text3);letter-spacing:.12em;}

  /* Hero */
  .hero{margin-top:6px;}
  .eyebrow{font-family:var(--ff);font-size:74px;font-weight:700;letter-spacing:.015em;color:var(--text);text-transform:uppercase;line-height:1;}
  .eyebrow .hl{color:var(--accent);}
  .subtitle{font-family:var(--fb);font-size:30px;font-weight:500;color:var(--text2);margin-top:14px;letter-spacing:.02em;}

  /* Pick list */
  .picks{display:flex;flex-direction:column;gap:22px;flex:1;min-height:0;}
  .pick{
    background:linear-gradient(180deg,var(--card) 0%,var(--card2) 100%);
    border:1px solid var(--border);border-left:5px solid var(--accent);
    border-radius:10px;padding:26px 30px;
  }
  .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}
  .pl{font-family:var(--fm);font-size:22px;font-weight:700;color:var(--text2);letter-spacing:.06em;text-transform:uppercase;}
  .pt{font-family:var(--fm);font-size:20px;font-weight:600;color:var(--text3);letter-spacing:.04em;}

  .pm{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:20px;}
  .tm{display:flex;align-items:center;gap:16px;flex:1;min-width:0;}
  .tm-r{flex-direction:row-reverse;text-align:right;}
  .tl{width:70px;height:70px;object-fit:contain;border-radius:50%;background:rgba(255,255,255,0.06);padding:6px;flex-shrink:0;}
  .tlf{display:flex;align-items:center;justify-content:center;font-size:32px;}
  .tn{font-family:var(--ff);font-size:30px;font-weight:700;color:var(--text);letter-spacing:.015em;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .vs{font-family:var(--ff);font-size:26px;font-weight:500;color:var(--text3);padding:0 4px;letter-spacing:.08em;}

  .pa{
    background:rgba(249,115,22,0.10);border:1px solid rgba(249,115,22,0.28);
    border-radius:6px;padding:14px 20px;
    display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  }
  .pal{font-family:var(--fm);font-size:18px;font-weight:700;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;flex-shrink:0;}
  .pav{font-family:var(--ff);font-size:26px;font-weight:700;color:var(--text);letter-spacing:.02em;flex:1;text-align:center;min-width:150px;}
  .pac{font-family:var(--fb);font-size:17px;font-weight:500;color:var(--text2);flex-shrink:0;}
  .pac b{font-weight:700;color:var(--accent);}

  /* Accuracy */
  .acc{
    background:linear-gradient(180deg,rgba(0,229,160,0.10) 0%,rgba(0,229,160,0.02) 100%);
    border:1px solid rgba(0,229,160,0.26);border-radius:10px;padding:26px 32px;
  }
  .acl{font-family:var(--fm);font-size:22px;font-weight:700;color:var(--green);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;}
  .acv{font-family:var(--ff);font-size:36px;font-weight:700;color:var(--text);letter-spacing:.015em;}

  /* Footer */
  .foot{text-align:center;padding-top:18px;border-top:1px solid var(--border);}
  .fw{font-family:var(--ff);font-size:30px;font-weight:700;color:var(--accent);letter-spacing:.05em;}
  .fd{font-family:var(--fm);font-size:20px;font-weight:500;color:var(--text3);margin-top:4px;letter-spacing:.04em;}

  /* Empty state */
  .empty{
    flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:linear-gradient(180deg,var(--card) 0%,var(--card2) 100%);
    border:1px solid var(--border);border-radius:10px;padding:80px 40px;
  }
  .el{font-family:var(--ff);font-size:38px;font-weight:700;color:var(--text);letter-spacing:.02em;text-align:center;}
  .es{font-family:var(--fb);font-size:22px;color:var(--text3);margin-top:12px;text-align:center;}

  ${debug ? '.dbg{position:fixed;bottom:8px;left:8px;font-family:monospace;font-size:11px;color:var(--text3);opacity:.6;z-index:100;}' : ''}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="logo">Score<span>Ocs8</span></div>
      <div class="date">${esc(fmtDisplayDate(displayDate))} · MYT</div>
    </div>

    <div class="hero">
      <div class="eyebrow">Today's Top <span class="hl">AI Picks</span></div>
      <div class="subtitle">今日足球精选推介 · Powered by ScoreOcs8 AI</div>
    </div>

    <div class="picks">${pickRows}</div>

    ${accBlock}

    <div class="foot">
      <div class="fw">scoreocs8.pages.dev</div>
      <div class="fd">Updated daily · 每日更新 · Asia/Kuala_Lumpur</div>
    </div>
  </div>
  ${debug ? `<div class="dbg">source=${esc(debug.sourceKey || 'none')} · picks=${debug.count}</div>` : ''}
</body>
</html>`;
}
