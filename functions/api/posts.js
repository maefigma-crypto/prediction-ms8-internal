const EMOJI = { UCL: '⭐', EPL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', WC: '🏆', MSL: '🇲🇾', BWF: '🏸' };

function excerptOf(content) {
  if (content?.meta_description) return content.meta_description;
  const body = (content?.body_en || '').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
  return body.length > 140 ? body.slice(0, 140) + '…' : body;
}

function ogImageUrl(origin, fx, kind) {
  const p = new URLSearchParams();
  if (fx.teams?.home?.name) p.set('home', fx.teams.home.name);
  if (fx.teams?.away?.name) p.set('away', fx.teams.away.name);
  p.set('league', fx.league?.name || '');
  p.set('date', fx.fixture?.date || '');
  p.set('tag', kind === 'top' ? 'MATCH OF THE DAY' : 'AI PICK');
  return `${origin}/og/match?${p.toString()}`;
}

export async function onRequest({ env, request }) {
  const origin = new URL(request.url).origin;
  const posts = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const raw = await env.CACHE.get(`content:${d}`);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const fmtDate = new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
      if (data.top) {
        const fx = data.top.fixture, c = data.top.content;
        posts.push({
          slug: `daily-${d}-top`,
          title: c.title_en,
          excerpt: excerptOf(c),
          category_label: fx.league?.name || '',
          emoji: EMOJI[fx._leagueKey] || '📝',
          og_image: ogImageUrl(origin, fx, 'top'),
          date: fmtDate,
        });
      }
      for (let idx = 0; idx < (data.previews || []).length; idx++) {
        const p = data.previews[idx];
        const fx = p.fixture, c = p.content;
        posts.push({
          slug: `daily-${d}-p${idx + 1}`,
          title: c.title_en,
          excerpt: excerptOf(c),
          category_label: fx.league?.name || '',
          emoji: EMOJI[fx._leagueKey] || '📝',
          og_image: ogImageUrl(origin, fx, 'preview'),
          date: fmtDate,
        });
      }
    } catch (_) { /* skip malformed day */ }
    if (posts.length >= 6) break;
  }
  return new Response(JSON.stringify(posts), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' },
  });
}
