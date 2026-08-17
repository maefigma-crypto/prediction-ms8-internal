// GET /blog/feed.xml — RSS 2.0 feed of blog posts (GitHub + daily KV posts).
// Feed readers, Telegram RSS bots and aggregators pick up new posts from
// here, which also earns crawl hits shortly after each post goes live.
import { listPosts, listKvContent, SITE_URL, escXml } from '../_repo.js';

const MAX_ITEMS = 30;

export async function onRequestGet({ env }) {
  const [githubPosts, kvPosts] = await Promise.all([
    listPosts(env),
    listKvContent(env, 30),
  ]);

  const posts = [...kvPosts, ...githubPosts]
    .filter(p => !String(p.meta.meta_robots || '').startsWith('noindex'))
    .sort((a, b) => new Date(b.meta.date || 0) - new Date(a.meta.date || 0))
    .slice(0, MAX_ITEMS);

  const items = posts.map(p => {
    const link = p.meta.canonical_url || `${SITE_URL}/blog/${p.slug}/`;
    const desc = p.meta.meta_description || p.meta.excerpt || '';
    const pubDate = p.meta.date ? new Date(p.meta.date).toUTCString() : '';
    return `    <item>
      <title>${escXml(p.meta.title || p.slug)}</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="true">${escXml(link)}</guid>${pubDate ? `\n      <pubDate>${pubDate}</pubDate>` : ''}${desc ? `\n      <description>${escXml(desc)}</description>` : ''}${p.meta.category ? `\n      <category>${escXml(p.meta.category)}</category>` : ''}
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ScoreOcs8 Blog | Soccer Predictions Malaysia</title>
    <link>${SITE_URL}/blog/</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Daily football match previews, predictions and league analysis for EPL, UCL, La Liga, Serie A, Bundesliga and Ligue 1, in MYT.</description>
    <language>en-my</language>
${items.join('\n')}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
