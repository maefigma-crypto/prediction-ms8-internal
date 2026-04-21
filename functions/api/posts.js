export async function onRequest({ env }) {
  const posts = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const raw = await env.CACHE.get(`content:${d}`);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const emojiMap = { UCL: '⭐', EPL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', WC: '🏆', MSL: '🇲🇾', BWF: '🏸' };
      if (data.top) {
        const fx = data.top.fixture;
        const c = data.top.content;
        posts.push({
          slug: `daily-${d}-top`,
          title: c.title_en,
          excerpt: (c.body_en || '').replace(/[#*`]/g, '').slice(0, 120) + '...',
          category_label: fx.league?.name || '',
          emoji: emojiMap[fx._leagueKey] || '📝',
          date: new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }),
        });
      }
      for (let idx = 0; idx < (data.previews || []).length; idx++) {
        const p = data.previews[idx];
        const fx = p.fixture;
        const c = p.content;
        posts.push({
          slug: `daily-${d}-p${idx + 1}`,
          title: c.title_en,
          excerpt: (c.body_en || '').replace(/[#*`]/g, '').slice(0, 120) + '...',
          category_label: fx.league?.name || '',
          emoji: emojiMap[fx._leagueKey] || '📝',
          date: new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }),
        });
      }
    } catch (_) { /* skip malformed day */ }
    if (posts.length >= 6) break;
  }
  return new Response(JSON.stringify(posts), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' },
  });
}
