function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}

export async function onRequestGet({ env, params, request }) {
  const url = new URL(request.url);
  const lang = ['en', 'bm', 'zh'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
  const fixtureId = params.fixture_id;
  if (!fixtureId) return json({ error: 'fixture_id required' }, 400);

  // Match previews are written by the cron worker as:
  //   content:YYYY-MM-DD (top+previews bundle) — legacy
  //   preview:YYYY-MM-DD:<fixtureId>:<lang> — per-fixture per-lang (target schema)
  // Try the per-fixture per-lang key first; fall back to scanning today's bundle.
  const today = new Date().toISOString().slice(0, 10);
  const direct = await env.CACHE.get(`preview:${today}:${fixtureId}:${lang}`, 'json');
  if (direct) return json({ date: today, fixtureId, lang, preview: direct, source: 'direct' });

  const bundle = await env.CACHE.get(`content:${today}`, 'json');
  if (bundle) {
    const pick = [bundle.top, ...(bundle.previews || [])].find(p => p && String(p.fixture?.fixture?.id) === String(fixtureId));
    if (pick) return json({ date: today, fixtureId, lang, preview: pick.content, source: 'bundle' });
  }
  return json({ error: 'no preview generated for this fixture today', fixtureId }, 404);
}
