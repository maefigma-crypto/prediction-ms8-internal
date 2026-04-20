const STATE_TTL = 600;
const GH_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';

function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleStart(request, env) {
  if (!env.GITHUB_OAUTH_CLIENT_ID) {
    return new Response('GITHUB_OAUTH_CLIENT_ID not set on Pages env', { status: 500 });
  }
  const url = new URL(request.url);
  const state = randomHex(16);
  await env.CACHE.put(`oauth-gh:${state}`, '1', { expirationTtl: STATE_TTL });

  const redirectUri = `${url.origin}/api/oauth/callback`;
  const authUrl = new URL(GH_AUTHORIZE);
  authUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', url.searchParams.get('scope') || 'public_repo,user:email');
  authUrl.searchParams.set('state', state);
  return Response.redirect(authUrl.toString(), 302);
}

function postMessagePage({ success, content }) {
  const payload = success
    ? `authorization:github:success:${JSON.stringify(content)}`
    : `authorization:github:error:${JSON.stringify(content)}`;
  return new Response(`<!doctype html>
<html><body>
<p style="font-family:system-ui;padding:2rem;color:#333">Finalising sign-in…</p>
<script>
(function() {
  var msg = ${JSON.stringify(payload)};
  var parent = window.opener || window.parent;
  var done = false;
  function receive(e) {
    if (done) return;
    if (e.data !== 'github') return;
    done = true;
    window.removeEventListener('message', receive, false);
    clearInterval(poke);
    parent.postMessage(msg, '*');
    setTimeout(function() { try { window.close(); } catch (_) {} }, 200);
  }
  window.addEventListener('message', receive, false);
  var poke = setInterval(function() {
    if (done) { clearInterval(poke); return; }
    parent.postMessage('authorizing:github', '*');
  }, 250);
  parent.postMessage('authorizing:github', '*');
  setTimeout(function() { if (!done) { clearInterval(poke); document.body.innerHTML = '<p style=\"font-family:system-ui;padding:2rem\">Sign-in timed out. Close this window and try again.</p>'; } }, 20000);
})();
</script>
</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return postMessagePage({ success: false, content: { message: 'missing code/state' } });
  }
  const seen = await env.CACHE.get(`oauth-gh:${state}`);
  if (!seen) {
    return postMessagePage({ success: false, content: { message: 'invalid or expired state' } });
  }
  await env.CACHE.delete(`oauth-gh:${state}`);

  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
    return postMessagePage({ success: false, content: { message: 'server not configured' } });
  }

  const tokenRes = await fetch(GH_TOKEN, {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenRes.ok) {
    return postMessagePage({ success: false, content: { message: `token exchange ${tokenRes.status}` } });
  }
  const data = await tokenRes.json().catch(() => ({}));
  if (!data.access_token) {
    return postMessagePage({ success: false, content: { message: data.error || 'no access_token' } });
  }
  return postMessagePage({
    success: true,
    content: { provider: 'github', token: data.access_token },
  });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const action = Array.isArray(params.action) ? params.action.join('/') : (params.action || '');
  try {
    if (action === '' || action === 'start' || action === 'auth') return handleStart(request, env);
    if (action === 'callback') return handleCallback(request, env);
    return new Response('not found', { status: 404 });
  } catch (err) {
    return postMessagePage({ success: false, content: { message: String(err.message || err) } });
  }
}
