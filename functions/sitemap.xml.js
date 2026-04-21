import { listPosts, listKvContent, getSettings, SITE_URL, escXml } from './_repo.js';

export async function onRequestGet({ env }) {
  const [githubPosts, kvPosts, settings] = await Promise.all([
    listPosts(env),
    listKvContent(env, 30),
    getSettings(env),
  ]);
  const posts = [...kvPosts, ...githubPosts];

  const urls = [
    { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE_URL}/blog/`, priority: '0.9', changefreq: 'daily' },
  ];

  for (const p of posts) {
    if (p.meta.include_in_sitemap === false) continue;
    if (String(p.meta.meta_robots || '').startsWith('noindex')) continue;
    urls.push({
      loc: p.meta.canonical_url || `${SITE_URL}/blog/${p.slug}/`,
      priority: String(p.meta.sitemap_priority || '0.5'),
      changefreq: 'weekly',
      lastmod: (p.meta.date || new Date().toISOString()).slice(0, 10),
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${escXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${escXml(u.lastmod)}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
