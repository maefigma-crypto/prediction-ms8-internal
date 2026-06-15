// GET /wc-card/  — screenshot-ready "Today at the World Cup" digest card.
//
// Renders a 1080×1350 portrait card (OCS8 × ScoreOCS8 branded) listing
// every World Cup match on a given day — across all groups — with live
// scores / kickoff times in MYT. The posting cron screenshots this and
// sends it to Telegram. One card per day, always accurate to that day
// (a single-group card couldn't represent a 4-match, multi-group day).
//
// Query params:
//   date    YYYY-MM-DD (MYT) to feature. Default: today MYT, else the next
//           day that has matches (so it's never empty between match days).
//
// Pure server-rendered HTML with inline CSS, no client JS, so the page is
// fully painted on first byte for a clean screenshot.

const SITE = 'https://scoreocs8.com';

function esc(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]));
}

function todayMYT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function mytDateKey(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); }
  catch { return ''; }
}

function fmtDayLabel(key) {
  try {
    // key is YYYY-MM-DD (MYT) — anchor at noon UTC so the weekday is stable.
    return new Date(key + 'T12:00:00Z').toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short',
    });
  } catch { return key; }
}

function fmtKickoff(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return '--:--'; }
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 60 } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const FINISHED = new Set(['FT', 'AET', 'PEN']);
const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const wantDate = url.searchParams.get('date') || '';

  const [sched, standings] = await Promise.all([
    getJSON(`${SITE}/api/wc-schedule`),
    getJSON(`${SITE}/api/standings?league=1&season=2026`),
  ]);

  const matches = sched?.matches || [];
  const groups = standings?.response?.[0]?.league?.standings || [];

  // Team→group from standings, lettered groups only. API-Football returns a
  // junk "Group Stage" bucket mixing teams together — skip it so group tags
  // stay correct.
  const teamGroup = {};
  for (const g of groups) {
    const label = g?.[0]?.group || '';
    if (!/^Group\s+[A-L]$/i.test(label)) continue;
    const letter = label.replace(/^Group\s*/i, '').toUpperCase();
    for (const row of g) if (row?.team?.id) teamGroup[row.team.id] = letter;
  }
  const groupTag = m =>
    teamGroup[m.home?.id] || teamGroup[m.away?.id] ||
    (m.group || '').replace(/^Group\s*/i, '').toUpperCase().replace(/^STAGE$/, '');

  // Target day: requested, else today MYT, else the next day that has matches.
  const today = todayMYT();
  let dayKey = wantDate || today;
  const onDay = k => matches.filter(m => mytDateKey(m.date) === k);
  if (!onDay(dayKey).length) {
    const now = Date.now();
    const next = matches
      .filter(m => new Date(m.date).getTime() >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    if (next) dayKey = mytDateKey(next.date);
  }
  const isToday = dayKey === today;
  const dayMatches = onDay(dayKey)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 6);

  // Next match day after this one — shown as a small teaser line.
  const laterKeys = [...new Set(matches.map(m => mytDateKey(m.date)))]
    .filter(k => k > dayKey).sort();
  const nextDayKey = laterKeys[0] || '';

  const rows = dayMatches.map(m => {
    const ft = FINISHED.has(m.status);
    const live = LIVE.has(m.status);
    const tag = groupTag(m);
    const right = ft || live
      ? `<div class="m-score">${m.goals?.home ?? 0}<span>-</span>${m.goals?.away ?? 0}</div>
         <div class="m-state ${live ? 'live' : ''}">${live ? 'LIVE ' + (m.elapsed || '') + "'" : 'FT'}</div>`
      : `<div class="m-time">${esc(fmtKickoff(m.date))}</div><div class="m-state">MYT</div>`;
    const logo = (u, nm) => u
      ? `<img src="${esc(u)}" alt="">`
      : `<span class="m-ph">${esc((nm || '?').slice(0, 1))}</span>`;
    return `<div class="m">
      ${tag ? `<div class="m-grp">GROUP ${esc(tag)}</div>` : '<div class="m-grp"></div>'}
      <div class="m-row">
        <div class="m-team">${logo(m.home?.logo, m.home?.name)}<span>${esc(m.home?.name || 'TBD')}</span></div>
        <div class="m-mid">${right}</div>
        <div class="m-team away"><span>${esc(m.away?.name || 'TBD')}</span>${logo(m.away?.logo, m.away?.name)}</div>
      </div>
    </div>`;
  }).join('') || `<div class="m-empty">No World Cup matches scheduled — full fixture list on scoreocs8.com</div>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>WC Card · ${esc(dayKey)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Outfit:wght@400;500;600;700;800&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1350px;}
  body{font-family:'Outfit',sans-serif;color:#eef3fb;background:#05070f;overflow:hidden;position:relative;}
  .bg{position:absolute;inset:0;background:
      radial-gradient(120% 60% at 50% -8%, rgba(60,143,255,.30), transparent 60%),
      radial-gradient(90% 50% at 12% 4%, rgba(0,229,160,.10), transparent 55%),
      radial-gradient(90% 50% at 88% 4%, rgba(249,115,22,.12), transparent 55%),
      linear-gradient(180deg,#0a1430 0%,#070b1c 46%,#05070f 100%);}
  .bg::before{content:'';position:absolute;inset:0;
      background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
      background-size:54px 54px;mask-image:linear-gradient(180deg,rgba(0,0,0,.9),transparent 42%);}
  .lights{position:absolute;top:0;left:0;right:0;height:120px;display:flex;justify-content:space-around;align-items:flex-start;opacity:.5;}
  .lights i{width:6px;height:64px;background:linear-gradient(180deg,#cfe4ff,transparent);filter:blur(3px);transform:rotate(8deg);}
  .lights i:nth-child(even){transform:rotate(-8deg);height:80px;}
  .wrap{position:relative;padding:54px 56px;height:100%;display:flex;flex-direction:column;}
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px;}
  .brand{display:flex;align-items:center;gap:14px;font-family:'Rajdhani';font-weight:700;font-size:30px;letter-spacing:.04em;}
  .brand .o{color:#fff;}.brand .x{color:#7d8aa6;font-size:22px;}
  .brand .s{color:#fff;}.brand .s b{color:#f97316;}
  .datepill{font-family:'DM Mono';font-size:19px;color:#cfe0ff;background:rgba(61,143,255,.16);border:1px solid rgba(61,143,255,.4);padding:9px 20px;border-radius:999px;}
  .title{text-align:center;margin:6px 0 30px;}
  .title .t1{font-family:'Rajdhani';font-weight:700;font-size:62px;line-height:.96;letter-spacing:.02em;}
  .title .t2{font-family:'Outfit';font-weight:600;font-size:26px;color:#9fb2d4;margin-top:6px;letter-spacing:.06em;text-transform:uppercase;}
  .matches{display:flex;flex-direction:column;gap:16px;flex:1;}
  .m{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 24px 18px;backdrop-filter:blur(6px);}
  .m-grp{font-family:'DM Mono';font-size:13px;letter-spacing:.12em;color:#6f86b8;height:18px;margin-bottom:6px;}
  .m-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;}
  .m-team{display:flex;align-items:center;gap:15px;min-width:0;}
  .m-team.away{justify-content:flex-end;}
  .m-team img{width:58px;height:58px;border-radius:50%;object-fit:contain;background:rgba(255,255,255,.08);flex:none;}
  .m-ph{width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;flex:none;}
  .m-team span{font-weight:700;font-size:29px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .m-mid{text-align:center;min-width:150px;}
  .m-time{font-family:'Rajdhani';font-weight:700;font-size:36px;line-height:1;}
  .m-score{font-family:'Rajdhani';font-weight:700;font-size:40px;line-height:1;}
  .m-score span{color:#7d8aa6;margin:0 10px;}
  .m-state{font-family:'DM Mono';font-size:14px;color:#8a9ab5;margin-top:6px;letter-spacing:.08em;}
  .m-state.live{color:#ff4757;}
  .m-empty{text-align:center;color:#8a9ab5;font-size:24px;padding:60px 30px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:18px;}
  .nextline{text-align:center;font-family:'DM Mono';font-size:16px;color:#6f86b8;margin-top:18px;letter-spacing:.04em;}
  .foot{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:22px;font-family:'Rajdhani';font-weight:700;font-size:22px;letter-spacing:.04em;color:#cfe0ff;}
  .foot .dot{width:6px;height:6px;border-radius:50%;background:#f97316;}
  .foot b{color:#f97316;}
  .foot .tag{color:#8a9ab5;font-weight:600;font-size:18px;font-family:'Outfit';}
</style></head>
<body>
  <div class="bg"></div>
  <div class="lights"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="wrap">
    <div class="head">
      <div class="brand"><span class="o">OCS8</span><span class="x">✕</span><span class="s">Score<b>OCS8</b></span></div>
      <div class="datepill">${esc(fmtDayLabel(dayKey))}</div>
    </div>
    <div class="title">
      <div class="t1">${isToday ? 'TODAY AT THE WORLD CUP' : 'WORLD CUP · MATCH DAY'}</div>
      <div class="t2">2026 FIFA World Cup · ${esc(dayMatches.length)} match${dayMatches.length === 1 ? '' : 'es'}</div>
    </div>
    <div class="matches">${rows}</div>
    ${nextDayKey ? `<div class="nextline">Next match day · ${esc(fmtDayLabel(nextDayKey))} — full schedule on scoreocs8.com</div>` : ''}
    <div class="foot"><span style="color:#fff;font-family:'Rajdhani';">OCS8</span> ✕ <span style="color:#fff;">Score<b>OCS8</b></span><span class="dot"></span><span class="tag">Advanced Prediction · Big Win · scoreocs8.com</span></div>
  </div>
</body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=120',
      'x-robots-tag': 'noindex',
    },
  });
}
