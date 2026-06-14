// GET /wc-card/  — screenshot-ready "Today at the World Cup" digest card.
//
// Renders a 1080×1350 portrait card (OCS8 × ScoreOCS8 branded) with a
// group's fixtures + live standings, pulled from the same public APIs the
// site uses. The posting cron screenshots this and sends it to Telegram.
//
// Query params:
//   group   group letter (A–L). Default: the group with the next kickoff.
//   date    YYYY-MM-DD (MYT) to feature. Default: today MYT (else next match day).
//   type    'digest' (default) — reserved for future card variants.
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

function fmtDayLabel(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short',
    });
  } catch { return ''; }
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

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const wantGroup = (url.searchParams.get('group') || '').toUpperCase().replace(/[^A-L]/g, '');
  const wantDate = url.searchParams.get('date') || '';

  const [sched, standings] = await Promise.all([
    getJSON(`${SITE}/api/wc-schedule`),
    getJSON(`${SITE}/api/standings?league=1&season=2026`),
  ]);

  const matches = sched?.matches || [];
  const groups = standings?.response?.[0]?.league?.standings || [];

  // Build a team→group map from standings so we don't depend on the
  // wc-schedule group join (which can be momentarily empty after an
  // API blip). Falls back to the match's own group field if present.
  const teamGroup = {};
  for (const g of groups) {
    for (const row of g) {
      if (row?.team?.id) teamGroup[row.team.id] = (row.group || '').replace(/^Group\s*/i, '').toUpperCase();
    }
  }
  const groupOfMatch = m => {
    const byTeam = teamGroup[m.home?.id] || teamGroup[m.away?.id] || '';
    return (byTeam || (m.group || '').replace(/^Group\s*/i, '').toUpperCase());
  };

  // Pick which group to feature: explicit param wins; else the group of the
  // next upcoming match (or, if none upcoming, the most recent).
  let group = wantGroup;
  if (!group) {
    const now = Date.now();
    const upcoming = matches
      .filter(m => groupOfMatch(m) && new Date(m.date).getTime() >= now - 2 * 3600 * 1000)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    group = groupOfMatch(upcoming[0] || matches.find(m => groupOfMatch(m)) || {}) || 'A';
  }
  group = String(group).replace(/^Group\s*/i, '').toUpperCase();

  // Fixtures for this group on the target day (default today, else that
  // group's next match day so the card is never empty between rounds).
  const groupMatches = matches.filter(m => groupOfMatch(m) === group);
  let dayKey = wantDate || todayMYT();
  if (!groupMatches.some(m => mytDateKey(m.date) === dayKey)) {
    const now = Date.now();
    const nextUp = groupMatches.filter(m => new Date(m.date).getTime() >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    dayKey = nextUp ? mytDateKey(nextUp.date) : (groupMatches.length ? mytDateKey(groupMatches[groupMatches.length - 1].date) : dayKey);
  }
  const dayMatches = groupMatches
    .filter(m => mytDateKey(m.date) === dayKey)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 3);

  // Standings rows for this group.
  const table = (groups.find(g => (g?.[0]?.group || '').replace(/^Group\s*/i, '').toUpperCase() === group) || [])
    .slice(0, 4);

  const fixtureRows = dayMatches.map(m => {
    const ft = ['FT', 'AET', 'PEN'].includes(m.status);
    const live = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(m.status);
    const right = ft || live
      ? `<div class="fx-score">${m.goals?.home ?? 0}<span>-</span>${m.goals?.away ?? 0}</div><div class="fx-when ${live ? 'live' : ''}">${live ? "LIVE " + (m.elapsed || '') + "'" : 'FT'}</div>`
      : `<div class="fx-time">${esc(fmtKickoff(m.date))}</div><div class="fx-when">${esc(fmtDayLabel(m.date))} · MYT</div>`;
    const logo = (u, alt) => u
      ? `<img src="${esc(u)}" alt="">`
      : `<span class="fx-ph">${esc((alt || '?').slice(0, 1))}</span>`;
    return `<div class="fx">
      <div class="fx-team">${logo(m.home?.logo, m.home?.name)}<span>${esc(m.home?.name || 'TBD')}</span></div>
      <div class="fx-mid">${right}</div>
      <div class="fx-team away"><span>${esc(m.away?.name || 'TBD')}</span>${logo(m.away?.logo, m.away?.name)}</div>
    </div>`;
  }).join('') || `<div class="fx-empty">Fixtures for Group ${esc(group)} coming up — full schedule on scoreocs8.com</div>`;

  const tableRows = table.map((t, i) => {
    const gd = t.goalsDiff ?? 0;
    return `<tr${i < 2 ? ' class="qual"' : ''}>
      <td class="t-rank">${i + 1}</td>
      <td class="t-team">${t.team?.logo ? `<img src="${esc(t.team.logo)}" alt="">` : ''}<span>${esc(t.team?.name || '')}</span></td>
      <td>${t.all?.played ?? 0}</td>
      <td>${gd >= 0 ? '+' : ''}${gd}</td>
      <td class="t-pts">${t.points ?? 0}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="t-empty">Standings update after the first matches kick off</td></tr>`;

  // Title adapts: once every fixture shown is finished it's a results card,
  // otherwise it's a fixtures card (live/upcoming).
  const ftShown = dayMatches.filter(m => ['FT', 'AET', 'PEN'].includes(m.status)).length;
  const resultsMode = dayMatches.length > 0 && ftShown === dayMatches.length;
  const subtitle = resultsMode ? 'Results &amp; Standing' : 'Fixtures &amp; Standing';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>WC Card · Group ${esc(group)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Outfit:wght@400;500;600;700;800&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1350px;}
  body{font-family:'Outfit',sans-serif;color:#eef3fb;background:#05070f;overflow:hidden;position:relative;}
  /* stadium-style backdrop */
  .bg{position:absolute;inset:0;background:
      radial-gradient(120% 60% at 50% -8%, rgba(60,143,255,.30), transparent 60%),
      radial-gradient(90% 50% at 12% 4%, rgba(0,229,160,.10), transparent 55%),
      radial-gradient(90% 50% at 88% 4%, rgba(249,115,22,.12), transparent 55%),
      linear-gradient(180deg,#0a1430 0%,#070b1c 46%,#05070f 100%);}
  .bg::before{content:'';position:absolute;inset:0;
      background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
      background-size:54px 54px;mask-image:linear-gradient(180deg,rgba(0,0,0,.9),transparent 40%);}
  .lights{position:absolute;top:0;left:0;right:0;height:120px;display:flex;justify-content:space-around;align-items:flex-start;opacity:.55;}
  .lights i{width:6px;height:64px;background:linear-gradient(180deg,#cfe4ff,transparent);filter:blur(3px);transform:rotate(8deg);}
  .lights i:nth-child(even){transform:rotate(-8deg);height:80px;}
  .wrap{position:relative;padding:52px 56px;height:100%;display:flex;flex-direction:column;}
  /* header */
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:30px;}
  .brand{display:flex;align-items:center;gap:14px;font-family:'Rajdhani';font-weight:700;font-size:30px;letter-spacing:.04em;}
  .brand .o{color:#fff;}.brand .x{color:#7d8aa6;font-size:22px;}
  .brand .s{color:#fff;}.brand .s b{color:#f97316;}
  .datepill{font-family:'DM Mono';font-size:18px;color:#cfe0ff;background:rgba(61,143,255,.16);border:1px solid rgba(61,143,255,.4);padding:8px 18px;border-radius:999px;}
  /* title block */
  .title{text-align:center;margin:8px 0 26px;}
  .title .t1{font-family:'Rajdhani';font-weight:700;font-size:64px;line-height:.96;letter-spacing:.02em;}
  .title .t2{font-family:'Outfit';font-weight:600;font-size:30px;color:#9fb2d4;margin-top:2px;letter-spacing:.02em;}
  .grouptag{display:inline-block;margin-top:16px;font-family:'Rajdhani';font-weight:700;font-size:30px;letter-spacing:.16em;color:#3d8fff;text-transform:uppercase;}
  .grouptag::before,.grouptag::after{content:'';display:inline-block;width:46px;height:2px;background:linear-gradient(90deg,transparent,#3d8fff);vertical-align:middle;margin:0 14px;}
  .grouptag::after{background:linear-gradient(90deg,#3d8fff,transparent);}
  /* fixtures */
  .fixtures{display:flex;flex-direction:column;gap:14px;}
  .fx{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px 24px;backdrop-filter:blur(6px);}
  .fx-team{display:flex;align-items:center;gap:14px;min-width:0;}
  .fx-team.away{justify-content:flex-end;}
  .fx-team img{width:54px;height:54px;border-radius:50%;object-fit:contain;background:rgba(255,255,255,.08);flex:none;}
  .fx-ph{width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:24px;flex:none;}
  .fx-team span{font-weight:700;font-size:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .fx-mid{text-align:center;min-width:140px;}
  .fx-time{font-family:'Rajdhani';font-weight:700;font-size:34px;line-height:1;}
  .fx-score{font-family:'Rajdhani';font-weight:700;font-size:36px;line-height:1;}
  .fx-score span{color:#7d8aa6;margin:0 8px;}
  .fx-when{font-family:'DM Mono';font-size:14px;color:#8a9ab5;margin-top:6px;letter-spacing:.04em;}
  .fx-when.live{color:#ff4757;}
  .fx-empty{text-align:center;color:#8a9ab5;font-size:22px;padding:40px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:18px;}
  /* standings */
  /* center the fixtures + standings as one block so a 1-fixture day
     doesn't leave a big void in the middle of the card */
  .content{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:22px;min-height:0;}
  .tablebox{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:10px 24px 16px;backdrop-filter:blur(6px);}
  table{width:100%;border-collapse:collapse;}
  thead th{font-family:'DM Mono';font-size:15px;color:#8a9ab5;letter-spacing:.10em;text-transform:uppercase;text-align:center;padding:14px 6px 10px;font-weight:500;}
  thead th.h-team{text-align:left;}
  tbody td{font-size:26px;font-weight:600;text-align:center;padding:13px 6px;border-top:1px solid rgba(255,255,255,.07);}
  td.t-rank{color:#9fb2d4;width:56px;}
  td.t-team{text-align:left;}
  td.t-team span{vertical-align:middle;font-weight:700;}
  td.t-team img{width:36px;height:36px;border-radius:50%;object-fit:contain;background:rgba(255,255,255,.08);vertical-align:middle;margin-right:12px;}
  td.t-pts{color:#fff;font-weight:800;}
  tr.qual td.t-rank{color:#00e5a0;}
  tr.qual td.t-rank::before{content:'▲ ';font-size:14px;}
  td.t-empty{color:#8a9ab5;font-size:20px;font-weight:500;padding:30px;border:none;}
  /* footer */
  .foot{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:24px;font-family:'Rajdhani';font-weight:700;font-size:22px;letter-spacing:.04em;color:#cfe0ff;}
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
      <div class="datepill">${esc(fmtDayLabel(dayKey + 'T12:00:00Z') || dayKey)}</div>
    </div>
    <div class="title">
      <div class="t1">2026 WORLD CUP</div>
      <div class="t2">${subtitle}</div>
      <div class="grouptag">Group ${esc(group)}</div>
    </div>
    <div class="content">
      <div class="fixtures">${fixtureRows}</div>
      <div class="tablebox">
        <table>
          <thead><tr><th>#</th><th class="h-team">Team</th><th>PL</th><th>GD</th><th>PTS</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
    <div class="foot"><span class="o" style="color:#fff;font-family:'Rajdhani';">OCS8</span> ✕ <span style="color:#fff;">Score<b>OCS8</b></span><span class="dot"></span><span class="tag">Advanced Prediction · Big Win · scoreocs8.com</span></div>
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
