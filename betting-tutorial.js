/* ===========================================================================
   ScoreOcs8 — Betting Tutorial + Pick Explainer (self-mounting)
   ---------------------------------------------------------------------------
   Include once per page:  <script src="/betting-tutorial.js" defer></script>
   On load it:
     1. injects the themed styles + the two modal shells,
     2. defines window.BettingTutorial and window.PickExplainer,
     3. overrides window.openPickHelp so every existing "What does this pick
        mean?" button uses the new explainer,
     4. adds a "How betting markets work" link to the page footer.
   Open the tutorial:  BettingTutorial.open('1x2')   // or handicap|overunder|moneyline
   Open the explainer: PickExplainer.open({ team:'France', pick:'home'|'draw'|'away' })
   =========================================================================== */
(function () {
  if (window.__betting_tutorial_mounted) return;
  window.__betting_tutorial_mounted = true;

  /* ---- CONFIG (currency / example stake + teams) ---- */
  var CONFIG = { currency: 'RM', stake: 100, homeTeam: 'Barcelona', awayTeam: 'Real Madrid' };
  var S = CONFIG.stake, C = CONFIG.currency;

  /* ---- THEME: scoreocs8 palette (orange accent, site fonts) ---- */
  var CSS = `
  :root{
    --bt-bg:#0f1620; --bt-bg-head:#141e2a; --bt-bg-card:#0f1620; --bt-bg-soft:#1a2533;
    --bt-border:rgba(255,255,255,.10); --bt-text:#e8edf5; --bt-text-dim:#8a9ab5;
    --bt-blue:#f97316; --bt-blue-deep:#c75808; --bt-blue-band:#3b6fc4; --bt-blue-band2:#2f4a7d;
    --bt-red:#ff4757; --bt-red-band:#c0432f; --bt-gold:#f5a623;
    --bt-win-bg:rgba(0,229,160,.10); --bt-win-text:#00e5a0;
    --bt-loss-bg:#16202c; --bt-loss-text:#c3ccdd; --bt-note:#ff7a6b; --bt-radius:14px;
    --bt-font:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    --bt-head-font:'Rajdhani','Outfit',sans-serif;
    --pe-orange:#f97316; --pe-win:#00e5a0; --pe-lose:#ff4757;
  }
  .bt-overlay{position:fixed;inset:0;background:rgba(4,7,13,.78);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(6px);}
  .bt-overlay.is-open{display:flex;}
  .bt-modal{background:var(--bt-bg);width:100%;max-width:600px;max-height:88vh;border:1px solid var(--bt-border);border-radius:var(--bt-radius);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);color:var(--bt-text);font-family:var(--bt-font);}
  .bt-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--bt-bg-head);border-bottom:1px solid var(--bt-border);}
  .bt-head h2{margin:0;font-size:19px;font-weight:700;font-family:var(--bt-head-font);letter-spacing:.03em;text-transform:uppercase;}
  .bt-x{background:none;border:0;color:var(--bt-text-dim);font-size:24px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px;}
  .bt-x:hover{color:#fff;background:rgba(255,255,255,.06);}
  .bt-tabs{display:flex;gap:22px;padding:0 20px;background:var(--bt-bg-head);border-bottom:1px solid var(--bt-border);}
  .bt-tab{background:none;border:0;color:var(--bt-text-dim);font-size:14px;font-weight:700;font-family:var(--bt-head-font);letter-spacing:.03em;padding:13px 2px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}
  .bt-tab.active{color:var(--bt-blue);border-bottom-color:var(--bt-blue);}
  .bt-body{padding:18px 20px 22px;overflow-y:auto;}
  .bt-body::-webkit-scrollbar{width:8px;}
  .bt-body::-webkit-scrollbar-thumb{background:#2b3645;border-radius:8px;}
  .bt-intro h3{margin:0 0 6px;font-size:19px;font-weight:700;font-family:var(--bt-head-font);}
  .bt-intro p{margin:0 0 16px;font-size:13.5px;line-height:1.55;color:var(--bt-text-dim);}
  .bt-lines{display:flex;gap:10px;margin-bottom:16px;}
  .bt-line-pill{flex:1;background:var(--bt-bg-soft);border:1px solid var(--bt-border);color:var(--bt-text-dim);border-radius:20px;padding:9px 0;font-size:14px;font-weight:700;cursor:pointer;text-align:center;}
  .bt-line-pill.active{background:linear-gradient(180deg,var(--bt-blue),var(--bt-blue-deep));color:#fff;border-color:transparent;}
  .bt-band-title{background:linear-gradient(180deg,var(--bt-blue-band),var(--bt-blue-band2));text-align:center;font-size:14px;font-weight:700;color:#fff;padding:9px;border-radius:8px 8px 0 0;}
  .bt-odds{background:var(--bt-bg-card);border:1px solid var(--bt-border);border-top:0;border-radius:0 0 8px 8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
  .bt-odds .teams span{display:block;font-size:13px;line-height:1.7;}
  .bt-odds .teams small{color:var(--bt-text-dim);}
  .bt-odds .vals{text-align:right;}
  .bt-odds .vals .lbl{color:var(--bt-blue);font-size:12px;}
  .bt-odds .vals .o{font-size:20px;font-weight:700;display:inline-block;margin-left:8px;}
  .bt-note{font-size:12px;line-height:1.5;margin-bottom:16px;}
  .bt-note b{color:var(--bt-text);}
  .bt-note span{color:var(--bt-note);}
  .bt-card{border:1px solid var(--bt-border);border-radius:10px;overflow:hidden;margin-bottom:14px;background:var(--bt-bg-card);}
  .bt-score{position:relative;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#2f4a7d,#274071);padding:14px 0;text-align:center;}
  .bt-score .home,.bt-score .away{position:absolute;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;color:#fff;padding:3px 12px;border-radius:12px;}
  .bt-score .home{left:16px;background:rgba(59,111,196,.9);}
  .bt-score .away{right:16px;background:var(--bt-red);}
  .bt-score .sc{font-size:13px;color:#cdd8ee;line-height:1.2;}
  .bt-score .sc b{display:block;font-size:20px;color:#fff;}
  .bt-total{display:block;text-align:center;background:var(--bt-gold);color:#1a1205;font-size:11px;font-weight:700;padding:3px;}
  .bt-outcomes{display:grid;gap:1px;background:var(--bt-border);}
  .bt-outcomes.cols-2{grid-template-columns:1fr 1fr;}
  .bt-outcomes.cols-3{grid-template-columns:1fr 1fr 1fr;}
  .bt-out{padding:12px 10px;text-align:center;background:var(--bt-loss-bg);}
  .bt-out.win{background:var(--bt-win-bg);}
  .bt-out .pick{font-size:12px;color:var(--bt-text-dim);margin-bottom:4px;line-height:1.4;}
  .bt-out .res{font-size:13px;font-weight:700;color:var(--bt-loss-text);line-height:1.45;}
  .bt-out.win .res{color:var(--bt-win-text);}
  .bt-out .amt{font-size:11px;color:var(--bt-text-dim);margin-top:6px;line-height:1.5;border-top:1px solid var(--bt-border);padding-top:6px;}
  #pick-explainer-modal-v2 .bt-modal{max-width:440px;}
  .pe-body{padding:20px;}
  .pe-lead{font-size:13.5px;line-height:1.6;color:var(--bt-text);margin:0 0 16px;}
  .pe-lead b{font-weight:700;}
  .pe-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--bt-border);border-radius:10px;overflow:hidden;font-size:13px;}
  .pe-table th{background:var(--bt-bg-soft);color:var(--bt-text-dim);font-weight:600;text-align:left;padding:11px 14px;font-size:12px;}
  .pe-table td{padding:12px 14px;border-top:1px solid var(--bt-border);}
  .pe-out{font-weight:700;}
  .pe-out.win{color:var(--pe-win);}
  .pe-out.lose{color:var(--pe-lose);}
  .pe-note{font-size:11.5px;line-height:1.55;color:var(--bt-text-dim);margin:16px 0 18px;}
  .pe-close{width:100%;background:var(--pe-orange);color:#fff;border:0;border-radius:9px;padding:14px;font-size:15px;font-weight:700;font-family:var(--bt-head-font);letter-spacing:.04em;cursor:pointer;}
  .pe-close:hover{filter:brightness(1.06);}
  .bt-foot-link{color:var(--pe-orange);cursor:pointer;text-decoration:none;}
  .bt-foot-link:hover{text-decoration:underline;}
  @media (max-width:480px){ .bt-tabs{gap:14px;overflow-x:auto;} .bt-tab{white-space:nowrap;} .bt-odds .o{font-size:18px;} }
  @media (prefers-reduced-motion:no-preference){ .bt-overlay.is-open .bt-modal{animation:btpop .18s ease;} @keyframes btpop{from{transform:translateY(8px);opacity:.4}to{transform:none;opacity:1}} }
  `;

  /* ---- TUTORIAL DATA (markets, lines, scenarios) ---- */
  var TUTORIAL_DATA = {
    handicap: {
      label: 'Handicap',
      intro: { title: 'Handicap in points', text: '"Add the handicap" (set by the sportsbook) to the underdog\'s score. The team with the higher adjusted score wins the payout.' },
      lines: [
        { id:'0.5', pill:'0.5', banner:'0.5 point (half point handicap)',
          odds:{ favTag:'(-0.5)', fav:'2.20', undTag:'(+0.5)', und:'1.80' },
          note:'Bet the full amount on the "0.5 point" handicap. Use '+C+S+' for an example.',
          cols:['Bet on the favorite','Bet on the underdog'],
          scenarios:[
            { score:'3-2', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] },
            { score:'2-2', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] }
          ] },
        { id:'0.75', pill:'0.75', banner:'0.75 point (split handicap)',
          odds:{ favTag:'(-0.75)', fav:'2.20', undTag:'(+0.75)', und:'1.80' },
          note:'Split into two halves — half on the "0.5" line, half on the "1" line. Use '+C+S+' for an example.',
          cols:['Bet on the favorite','Bet on the underdog'],
          scenarios:[
            { score:'3-1', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] },
            { score:'3-2', outs:[ {state:'win',res:['Half win (-0.5)','Half draw (-1)'],amt:['Won '+C+S+'×0.5×2.20=110','Refund '+C+S+'×0.5=50']},{state:'loss',res:['Half loss (+0.5)','Half draw (+1)'],amt:['Lost '+C+S+'×0.5=50','Refund '+C+S+'×0.5=50']} ] },
            { score:'2-2', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] }
          ] },
        { id:'1', pill:'1', banner:'1 point (one point handicap)',
          odds:{ favTag:'(-1)', fav:'2.20', undTag:'(+1)', und:'1.80' },
          note:'Bet the full amount on the "1 point" handicap. A win by exactly 1 goal is a draw (stake returned). Use '+C+S+' for an example.',
          cols:['Bet on the favorite','Bet on the underdog'],
          scenarios:[
            { score:'3-1', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] },
            { score:'2-1', outs:[ {state:'draw',res:'Draw',amt:'Return the stake '+C+S},{state:'draw',res:'Draw',amt:'Return the stake '+C+S} ] },
            { score:'2-2', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] }
          ] }
      ]
    },
    overunder: {
      label: 'Over/Under',
      intro: { title: 'Over / Under (total goals)', text: 'Predict whether the combined goals of both teams finish over or under the line set by the sportsbook.' },
      lines: [
        { id:'2', pill:'2', banner:'2 points (two point line)',
          odds:{ favTag:'Over (2)', fav:'2.20', undTag:'Under (2)', und:'1.80', oddsAsOU:true },
          note:'Bet the full amount on "Over 2" or "Under 2". A total of exactly 2 is a draw (stake returned). Use '+C+S+' for an example.',
          cols:['Bet on Over 2','Bet on Under 2'],
          scenarios:[
            { score:'1-0', total:'Total goals 1', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] },
            { score:'1-1', total:'Total goals 2', outs:[ {state:'draw',res:'Draw',amt:'Return the stake '+C+S},{state:'draw',res:'Draw',amt:'Return the stake '+C+S} ] },
            { score:'2-1', total:'Total goals 3', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] }
          ] },
        { id:'2.25', pill:'2.25', banner:'2.25 points (split line)',
          odds:{ favTag:'Over (2.25)', fav:'2.20', undTag:'Under (2.25)', und:'1.80', oddsAsOU:true },
          note:'Split into two halves — half on the "2" line, half on the "2.5" line. Use '+C+S+' for an example.',
          cols:['Bet on Over 2.25','Bet on Under 2.25'],
          scenarios:[
            { score:'2-1', total:'Total goals 3', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] },
            { score:'1-1', total:'Total goals 2', outs:[ {state:'loss',res:['Half loss (over 2.5)','Half draw (over 2)'],amt:['Lost '+C+S+'×0.5=50','Refund '+C+S+'×0.5=50']},{state:'win',res:['Half win (under 2.5)','Half draw (under 2)'],amt:['Won '+C+S+'×0.5×1.80=90','Refund '+C+S+'×0.5=50']} ] },
            { score:'1-0', total:'Total goals 1', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] }
          ] },
        { id:'2.5', pill:'2.5', banner:'2.5 points (half line)',
          odds:{ favTag:'Over (2.5)', fav:'2.20', undTag:'Under (2.5)', und:'1.80', oddsAsOU:true },
          note:'Bet the full amount on "Over 2.5" or "Under 2.5". No draw is possible. Use '+C+S+' for an example.',
          cols:['Bet on Over 2.5','Bet on Under 2.5'],
          scenarios:[
            { score:'2-1', total:'Total goals 3', outs:[ {state:'win',res:'All win',amt:C+S+'×2.20=220'},{state:'loss',res:'All loss',amt:''+C+S} ] },
            { score:'1-1', total:'Total goals 2', outs:[ {state:'loss',res:'All loss',amt:''+C+S},{state:'win',res:'All win',amt:C+S+'×1.80=180'} ] }
          ] }
      ]
    },
    '1x2': {
      label: '1X2',
      intro: { title: '1X2 — Match Winner', text: 'Compare the final score directly. Pick Home win (1), Draw (X), or Away win (2). This is the market ScoreOcs8 predictions use.' },
      lines: [
        { id:'main', pill:null, banner:'Match result & win / loss', odds:null, note:null,
          cols:['Bet on home team','Bet on draw','Bet on away team'],
          scenarios:[
            { score:'3-2', outs:[ {state:'win',res:'All win'},{state:'loss',res:'All loss'},{state:'loss',res:'All loss'} ] },
            { score:'1-2', outs:[ {state:'loss',res:'All loss'},{state:'loss',res:'All loss'},{state:'win',res:'All win'} ] },
            { score:'2-2', outs:[ {state:'loss',res:'All loss'},{state:'win',res:'All win'},{state:'loss',res:'All loss'} ] }
          ] }
      ]
    },
    moneyline: {
      label: 'Moneyline',
      intro: { title: 'Moneyline — Win / Loss', text: 'Compare the final score directly. Pick the winning team. A draw returns your stake.' },
      lines: [
        { id:'main', pill:null, banner:'Match result & win / loss', odds:null, note:null,
          cols:['Bet on home team','Bet on away team'],
          scenarios:[
            { score:'3-2', outs:[ {state:'win',res:'All win'},{state:'loss',res:'All loss'} ] },
            { score:'1-2', outs:[ {state:'loss',res:'All loss'},{state:'win',res:'All win'} ] },
            { score:'2-2', outs:[ {state:'draw',res:'Draw',amt:'Return the stake'},{state:'draw',res:'Draw',amt:'Return the stake'} ] }
          ] }
      ]
    }
  };

  /* ---- mount styles + modal shells ---- */
  function mount() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="bt-overlay" id="betting-tutorial-modal-v2"><div class="bt-modal" role="dialog" aria-modal="true" aria-label="Betting tutorial">' +
        '<div class="bt-head"><h2>Betting Tutorial</h2><button class="bt-x" aria-label="Close" data-bt-close>&times;</button></div>' +
        '<div class="bt-tabs" id="bt-tabs-v2"></div><div class="bt-body" id="bt-body-v2"></div>' +
      '</div></div>' +
      '<div class="bt-overlay" id="pick-explainer-modal-v2"><div class="bt-modal" role="dialog" aria-modal="true" aria-label="What does this pick mean">' +
        '<div class="bt-head"><h2>What does this pick mean?</h2><button class="bt-x" aria-label="Close" data-pe-close>&times;</button></div>' +
        '<div class="pe-body" id="pe-body-v2"></div>' +
      '</div></div>';
    document.body.appendChild(wrap);
  }

  var asLines = function (v) { return Array.isArray(v) ? v : [v]; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]; }); };

  /* ---- BettingTutorial ---- */
  var BettingTutorial = (function () {
    var overlay, tabsEl, bodyEl, activeTab = 'handicap', lineState = {};
    function renderTabs() {
      tabsEl.innerHTML = Object.keys(TUTORIAL_DATA).map(function (key) {
        return '<button class="bt-tab ' + (key === activeTab ? 'active' : '') + '" data-tab="' + key + '">' + TUTORIAL_DATA[key].label + '</button>';
      }).join('');
      tabsEl.querySelectorAll('.bt-tab').forEach(function (b) { b.onclick = function () { activeTab = b.dataset.tab; renderTabs(); renderBody(); }; });
    }
    function renderBody() {
      var m = TUTORIAL_DATA[activeTab];
      var lineId = lineState[activeTab] || m.lines[0].id;
      var line = m.lines.find(function (l) { return l.id === lineId; }) || m.lines[0];
      var html = '<div class="bt-intro"><h3>' + m.intro.title + '</h3><p>' + m.intro.text + '</p></div>';
      if (m.lines.length > 1 && m.lines[0].pill !== null) {
        html += '<div class="bt-lines">' + m.lines.map(function (l) {
          return '<button class="bt-line-pill ' + (l.id === line.id ? 'active' : '') + '" data-line="' + l.id + '">' + l.pill + '</button>';
        }).join('') + '</div>';
      }
      html += '<div class="bt-band-title">' + line.banner + '</div>';
      if (line.odds) {
        var o = line.odds;
        var teamBlock = o.oddsAsOU
          ? '<span>' + CONFIG.homeTeam + ' <small>(Home)</small></span><span>' + CONFIG.awayTeam + ' <small>(Away)</small></span>'
          : '<span>' + CONFIG.homeTeam + ' <small>(favorite)</small></span><span>' + CONFIG.awayTeam + ' <small>(underdog)</small></span>';
        html += '<div class="bt-odds"><div class="teams">' + teamBlock + '</div><div class="vals">' +
          '<div><span class="lbl">' + o.favTag + '</span><span class="o">' + o.fav + '</span></div>' +
          '<div><span class="lbl">' + o.undTag + '</span><span class="o">' + o.und + '</span></div></div></div>';
      } else { html += '<div style="height:14px"></div>'; }
      if (line.note) { html += '<p class="bt-note"><b>How the stake settles:</b> <span>' + line.note + '</span></p>'; }
      var nCols = line.cols.length;
      line.scenarios.forEach(function (sc) {
        html += '<div class="bt-card"><div class="bt-score"><span class="home">' + CONFIG.homeTeam + '</span><div class="sc">Score<b>' + sc.score + '</b></div><span class="away">' + CONFIG.awayTeam + '</span></div>';
        if (sc.total) html += '<span class="bt-total">' + sc.total + '</span>';
        html += '<div class="bt-outcomes cols-' + nCols + '">';
        sc.outs.forEach(function (out, i) {
          var res = asLines(out.res).map(function (t) { return '<div>' + t + '</div>'; }).join('');
          var amt = out.amt ? '<div class="amt">' + asLines(out.amt).map(function (t) { return '<div>' + t + '</div>'; }).join('') + '</div>' : '';
          html += '<div class="bt-out ' + (out.state === 'win' ? 'win' : '') + '"><div class="pick">' + line.cols[i] + '</div><div class="res">' + res + '</div>' + amt + '</div>';
        });
        html += '</div></div>';
      });
      bodyEl.innerHTML = html;
      bodyEl.scrollTop = 0;
      bodyEl.querySelectorAll('.bt-line-pill').forEach(function (p) { p.onclick = function () { lineState[activeTab] = p.dataset.line; renderBody(); }; });
    }
    function open(tab) {
      overlay = overlay || document.getElementById('betting-tutorial-modal-v2');
      tabsEl = document.getElementById('bt-tabs-v2'); bodyEl = document.getElementById('bt-body-v2');
      if (tab) activeTab = tab;
      renderTabs(); renderBody();
      overlay.classList.add('is-open'); document.body.style.overflow = 'hidden';
    }
    function close() { if (overlay) { overlay.classList.remove('is-open'); document.body.style.overflow = ''; } }
    return { open: open, close: close };
  })();

  /* ---- PickExplainer (replaces the old openPickHelp) ---- */
  var PickExplainer = (function () {
    var overlay, body;
    function build(opts) {
      opts = opts || {};
      var team = opts.team || 'the team', pick = opts.pick || 'home';
      var map = {
        home: { lead: '<b>' + esc(team) + ' win</b> means the pick wins if ' + esc(team) + ' has more goals at full-time. This is the 1X2 result market: Home win, Draw, or Away win.',
                rows: [[esc(team) + ' win','2 - 1','WIN'],['Draw','1 - 1','LOSE'],[esc(team) + ' lose','0 - 1','LOSE']] },
        draw: { lead: '<b>Draw</b> means the pick wins only if the match is level at full-time. This is the 1X2 result market: Home win, Draw, or Away win.',
                rows: [['Draw','1 - 1','WIN'],[esc(team) + ' win','2 - 1','LOSE'],[esc(team) + ' lose','0 - 1','LOSE']] },
        away: { lead: '<b>' + esc(team) + ' win</b> means the pick wins if ' + esc(team) + ' has more goals at full-time. This is the 1X2 result market: Home win, Draw, or Away win.',
                rows: [[esc(team) + ' win','1 - 2','WIN'],['Draw','1 - 1','LOSE'],[esc(team) + ' lose','2 - 0','LOSE']] }
      };
      var data = map[pick] || map.home;
      var rows = data.rows.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="pe-out ' + (r[2] === 'WIN' ? 'win' : 'lose') + '">' + r[2] + '</td></tr>';
      }).join('');
      body.innerHTML =
        '<p class="pe-lead">' + data.lead + '</p>' +
        '<table class="pe-table"><thead><tr><th>Result</th><th>Example</th><th>Outcome</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="pe-note">Beginner note: this is an explanation of the prediction market, not a guarantee. Always treat predictions as information, not certainty.</p>' +
        '<button class="pe-close" data-pe-close>Close</button>';
    }
    function open(opts) {
      overlay = overlay || document.getElementById('pick-explainer-modal-v2');
      body = document.getElementById('pe-body-v2');
      build(opts);
      overlay.classList.add('is-open'); document.body.style.overflow = 'hidden';
    }
    function close() { if (overlay) { overlay.classList.remove('is-open'); document.body.style.overflow = ''; } }
    return { open: open, close: close };
  })();

  /* normalize a free-text pick label (team name / 'Draw' / 1X2) to a side */
  function normalizePick(rawPick, home, away) {
    var v = String(rawPick == null ? '' : rawPick).trim().toLowerCase();
    if (v.indexOf('draw') >= 0 || v === 'x' || v === 'tie') return { team: home, pick: 'draw' };
    if (away && v.indexOf(String(away).toLowerCase()) >= 0) return { team: away, pick: 'away' };
    if (v === '2' || v === 'a' || v === 'away') return { team: away || home, pick: 'away' };
    return { team: home, pick: 'home' };
  }

  function injectFooterLink() {
    var foot = document.querySelector('footer');
    if (!foot || foot.querySelector('.bt-foot-link')) return;
    var ul = foot.querySelector('.fcol ul') || foot.querySelector('ul');
    if (ul) {
      var li = document.createElement('li');
      li.innerHTML = '<a href="#" class="bt-foot-link">How betting markets work</a>';
      li.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); BettingTutorial.open('1x2'); });
      ul.appendChild(li);
    } else {
      var div = document.createElement('div');
      div.style.cssText = 'text-align:center;padding-top:14px;font-size:13px;';
      div.innerHTML = '<a href="#" class="bt-foot-link">📘 How betting markets work</a>';
      div.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); BettingTutorial.open('1x2'); });
      foot.appendChild(div);
    }
  }

  function init() {
    mount();
    window.BettingTutorial = BettingTutorial;
    window.PickExplainer = PickExplainer;
    // Replace the legacy pick-help everywhere it's wired (homepage et al.)
    window.openPickHelp = function (home, away, pickLabel) {
      PickExplainer.open(normalizePick(pickLabel, home, away));
    };
    // delegated close (X buttons + Close button) + overlay click + Esc
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-bt-close]')) BettingTutorial.close();
      if (e.target.closest('[data-pe-close]')) PickExplainer.close();
      if (e.target.id === 'betting-tutorial-modal-v2') BettingTutorial.close();
      if (e.target.id === 'pick-explainer-modal-v2') PickExplainer.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { BettingTutorial.close(); PickExplainer.close(); }
    });
    injectFooterLink();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
