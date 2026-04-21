const EMOJI = { UCL: '⭐', EPL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', WC: '🏆', MSL: '🇲🇾', BWF: '🏸' };

function excerptOf(content) {
  // Prefer the purpose-built SEO meta_description, else strip markdown and clip body.
  if (content?.meta_description) return content.meta_description;
  const body = (content?.body_en || '').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
  return body.length > 140 ? body.slice(0, 140) + '…' : body;
}

export async function onRequest({ env }) {
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
