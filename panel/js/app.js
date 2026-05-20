// OCS Super Panel — single-page client.
// Hash-based routing, dependency-free, talks to /api/* on the same origin.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: {
      'accept': 'application/json',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { res, data };
};

const fmtTs = ts => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
));

// ─── View switching ─────────────────────────────────────────────────────
function showView(id) {
  $$('.view').forEach(v => v.classList.toggle('view-active', v.id === id));
}
function showRoute(name) {
  $$('.route').forEach(r => r.classList.toggle('route-active', r.dataset.view === name));
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  // Close mobile sidebar after navigation
  $('#sidebar')?.classList.remove('open');
}

// ─── Auth bootstrap ─────────────────────────────────────────────────────
async function bootstrap() {
  const { res, data } = await api('/api/auth/me');
  if (res.ok && data?.authenticated) {
    if (data.user.must_change_password) {
      showView('view-change-password');
      return;
    }
    enterApp(data.user);
  } else {
    showView('view-login');
  }
}

function enterApp(user) {
  $('#who').textContent = `${user.username} · ${user.role}`;
  $('#s-username').textContent = user.username;
  $('#s-role').textContent = user.role;
  showView('view-app');
  // Default route
  const initial = (location.hash || '#dashboard').replace('#', '') || 'dashboard';
  navigate(initial);
}

function navigate(name) {
  if (!['dashboard', 'compose', 'subscribers', 'history', 'audit', 'settings'].includes(name)) name = 'dashboard';
  if (location.hash.replace('#', '') !== name) location.hash = name;
  showRoute(name);
  if (name === 'dashboard')   loadDashboard();
  if (name === 'subscribers') loadSubscribers();
  if (name === 'history')     loadHistory();
  if (name === 'audit')       loadAudit();
}

window.addEventListener('hashchange', () => {
  const route = location.hash.replace('#', '') || 'dashboard';
  if ($('#view-app').classList.contains('view-active')) navigate(route);
});

// ─── Login form ─────────────────────────────────────────────────────────
$('#login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-submit');
  const err = $('#login-error');
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';

  const { res, data } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: $('#login-username').value,
      password: $('#login-password').value,
    }),
  });

  btn.disabled = false; btn.textContent = 'Sign in →';

  if (!res.ok) {
    const msg = data?.error === 'rate-limited'
      ? `Too many attempts. Try again in ${Math.ceil((data.retry_after || 900) / 60)} min.`
      : data?.error === 'bad-credentials'
        ? 'Invalid username or password.'
        : (data?.error || 'Login failed.');
    err.textContent = msg;
    return;
  }
  if (data.user.must_change_password) {
    showView('view-change-password');
    return;
  }
  enterApp(data.user);
});

// ─── Change password form ───────────────────────────────────────────────
$('#cp-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#cp-error'); err.textContent = '';
  const cur = $('#cp-current').value;
  const next = $('#cp-new').value;
  const conf = $('#cp-confirm').value;
  if (next !== conf) { err.textContent = 'New passwords do not match.'; return; }

  const { res, data } = await api('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: cur, new_password: next }),
  });
  if (!res.ok) {
    err.textContent = data?.detail || data?.error || 'Failed.';
    return;
  }
  // Force re-login with new password
  showView('view-login');
  $('#login-error').textContent = 'Password updated — please sign in again.';
});

// ─── Logout ─────────────────────────────────────────────────────────────
$('#logout')?.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.hash = '';
  showView('view-login');
});

$('#burger')?.addEventListener('click', () => {
  $('#sidebar')?.classList.toggle('open');
});
$$('.nav-item').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  navigate(a.dataset.route);
}));

// ─── Dashboard ─────────────────────────────────────────────────────────
async function loadDashboard() {
  const wrap = $('#site-cards');
  wrap.innerHTML = '<div class="card glass loading-card">Loading sites…</div>';
  const { res, data } = await api('/api/subscribers/stats?site=scoreocs8');
  if (!res.ok) {
    wrap.innerHTML = `<div class="card glass loading-card">Could not load (${data?.error || res.status})</div>`;
    return;
  }
  wrap.innerHTML = renderSiteCard({
    slug: 'scoreocs8',
    name: 'ScoreOcs8',
    host: 'scoreocs8.com',
    flag: 'S8',
    stats: data,
  });
}
function renderSiteCard(s) {
  const top = Object.entries(s.stats.by_country || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `
    <div class="card glass site-card">
      <div class="site-head">
        <div class="site-flag">${esc(s.flag)}</div>
        <div>
          <div class="site-name">${esc(s.name)}</div>
          <div class="site-host">${esc(s.host)}</div>
        </div>
      </div>
      <div class="site-stats">
        <div class="site-stat"><strong>${s.stats.total ?? 0}</strong><span>Total subs</span></div>
        <div class="site-stat"><strong>${s.stats.last_24h ?? 0}</strong><span>24h</span></div>
        <div class="site-stat"><strong>${s.stats.last_7d ?? 0}</strong><span>7 day</span></div>
      </div>
      <div class="muted small" style="margin-bottom:14px;">
        Top countries: ${top.length ? top.map(([c, n]) => `${esc(c) || '??'} (${n})`).join(' · ') : '—'}
      </div>
      <div class="site-actions">
        <button class="btn-ghost" onclick="location.hash='#compose'">Compose</button>
        <button class="btn-ghost" onclick="location.hash='#subscribers'">Subscribers</button>
      </div>
    </div>`;
}

// ─── Compose ───────────────────────────────────────────────────────────
function bindCompose() {
  const t = $('#c-title'), b = $('#c-body'), u = $('#c-url');
  const update = () => {
    $('#p-title').textContent = t.value || 'Title preview';
    $('#p-body').textContent  = b.value || 'Body preview will appear here as you type.';
    $('#p-url').textContent   = u.value || '/';
    $('#c-title-count').textContent = `${t.value.length} / 80`;
    $('#c-body-count').textContent  = `${b.value.length} / 240`;
  };
  [t, b, u].forEach(el => el.addEventListener('input', update));
  update();

  $('#c-dryrun').addEventListener('click', async () => {
    const status = $('#c-status'); status.textContent = 'Counting subscribers…';
    const { res, data } = await api('/api/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        site: $('#c-site').value,
        title: t.value, body: b.value, url: u.value,
        dry_run: true,
      }),
    });
    if (!res.ok) { status.textContent = data?.error || 'Failed.'; return; }
    status.textContent = `Would send to ${data.target_count} subscriber(s).`;
  });

  $('#compose-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!confirm(`Send broadcast to all subscribers? This cannot be undone.`)) return;
    const status = $('#c-status'), btn = $('#c-send');
    btn.disabled = true; status.textContent = 'Sending…';
    const { res, data } = await api('/api/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({
        site: $('#c-site').value,
        title: t.value, body: b.value, url: u.value,
      }),
    });
    btn.disabled = false;
    if (!res.ok) { status.textContent = `Error: ${data?.error || res.status}`; return; }
    status.textContent = `✓ Sent to ${data.sent} / ${data.target} (failed: ${data.failed}, gone: ${data.gone}).`;
    t.value = ''; b.value = ''; update();
  });
}
bindCompose();

// ─── Subscribers ───────────────────────────────────────────────────────
async function loadSubscribers() {
  const wrap = $('#subs-table-wrap');
  wrap.textContent = 'Loading subscribers…';
  const { res, data } = await api('/api/subscribers/list?site=scoreocs8&limit=100');
  if (!res.ok) { wrap.textContent = `Error: ${data?.error || res.status}`; return; }
  if (!data.rows.length) { wrap.innerHTML = '<div class="muted">No subscribers yet.</div>'; return; }
  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr><th>ID</th><th>Country</th><th>Lang</th><th>Source</th><th>Subscribed</th></tr></thead>
      <tbody>${data.rows.map(r => `
        <tr>
          <td class="col-mono">${esc(r.id.slice(0, 12))}…</td>
          <td>${esc(r.country) || '—'}</td>
          <td>${esc(r.lang)}</td>
          <td class="col-mono">${esc(r.source) || '—'}</td>
          <td>${fmtTs(r.createdAt)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// ─── History ───────────────────────────────────────────────────────────
async function loadHistory() {
  const wrap = $('#hist-wrap');
  wrap.textContent = 'Loading history…';
  const { res, data } = await api('/api/broadcast/history?limit=30');
  if (!res.ok) { wrap.textContent = `Error: ${data?.error || res.status}`; return; }
  if (!data.rows.length) { wrap.innerHTML = '<div class="muted">No broadcasts sent yet.</div>'; return; }
  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Sent</th><th>Site</th><th>Title</th><th>Sent / Target</th><th>Failed</th><th>Gone</th><th>By</th></tr></thead>
      <tbody>${data.rows.map(r => `
        <tr>
          <td>${fmtTs(r.sent_at)}</td>
          <td>${esc(r.site)}</td>
          <td>${esc(r.payload?.title || '')}</td>
          <td><span class="badge success">${r.sent} / ${r.target}</span></td>
          <td>${r.failed ? `<span class="badge error">${r.failed}</span>` : 0}</td>
          <td>${r.gone || 0}</td>
          <td class="col-mono">${esc(r.sent_by)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// ─── Audit ─────────────────────────────────────────────────────────────
async function loadAudit() {
  const wrap = $('#audit-wrap');
  wrap.textContent = 'Loading audit log…';
  const { res, data } = await api('/api/audit/log?limit=100');
  if (!res.ok) { wrap.textContent = `Error: ${data?.error || res.status}`; return; }
  if (!data.rows.length) { wrap.innerHTML = '<div class="muted">No audit entries yet.</div>'; return; }
  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr><th>When</th><th>Action</th><th>User</th><th>IP</th><th>Country</th><th>Detail</th></tr></thead>
      <tbody>${data.rows.map(r => `
        <tr>
          <td>${fmtTs(r.ts)}</td>
          <td><span class="badge">${esc(r.action)}</span></td>
          <td>${esc(r.user)}</td>
          <td class="col-mono">${esc(r.ip)}</td>
          <td>${esc(r.country)}</td>
          <td class="col-mono small">${esc(JSON.stringify(r.meta || {}))}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// ─── Settings ──────────────────────────────────────────────────────────
$('#s-change-password')?.addEventListener('click', () => {
  showView('view-change-password');
});

// Boot
bootstrap();
