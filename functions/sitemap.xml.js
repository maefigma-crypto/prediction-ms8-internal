import { listPosts, listKvContent, getSettings, SITE_URL, escXml } from './_repo.js';

const slugify = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);

export async function onRequestGet({ env, request }) {
  const origin = new URL(request.url).origin;
  const [githubPosts, kvPosts, settings, fixtures, wcSchedule, highlights] = await Promise.all([
    listPosts(env),
    listKvContent(env, 30),
    getSettings(env),
    fetch(origin + '/api/fixtures').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(origin + '/api/wc-schedule').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(origin + '/api/highlights?limit=12').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  const posts = [...kvPosts, ...githubPosts];

  // Static pages carry no lastmod — stamping "today" on every page every day
  // teaches crawlers to ignore lastmod entirely. Dynamic URLs below use real
  // fixture/post dates, which stay trustworthy this way.
  const urls = [
    { loc: `${SITE_URL}/`,                                priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE_URL}/about.html`,                      priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/schedule`,                        priority: '0.8', changefreq: 'weekly' },
    { loc: `${SITE_URL}/blog/`,                           priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/`,                    priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/premier-league/`,     priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/champions-league/`,   priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/la-liga/`,            priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/serie-a/`,            priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/bundesliga/`,         priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/ligue-1/`,            priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE_URL}/predictions/fifa-world-cup/`,     priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/worldcup-markets/`,               priority: '0.9', changefreq: 'daily' },
  ];

  // Dynamic per-match pages: /match/<id>-<home>-vs-<away>/
  const seenMatchIds = new Set();
  for (const lg of (fixtures?.leagues || [])) {
    for (const fx of [...(lg.next || []), ...(lg.today || []), ...(lg.last || [])]) {
      const id = fx?.fixture?.id;
      if (!id || seenMatchIds.has(id)) continue;
      seenMatchIds.add(id);
      const home = fx?.teams?.home?.name || '';
      const away = fx?.teams?.away?.name || '';
      const slug = slugify(`${home}-vs-${away}`);
      const path = slug ? `/match/${id}-${slug}/` : `/match/${id}/`;
      urls.push({
        loc: SITE_URL + path,
        priority: '0.7',
        changefreq: 'daily',
        lastmod: (fx?.fixture?.date || new Date().toISOString()).slice(0, 10),
      });
    }
  }

  // All World Cup fixtures (the /api/fixtures buckets above only cover the
  // next/last ~30; wc-schedule has every match), so every WC match page is
  // discoverable — the bulk of the long-tail during the tournament.
  for (const m of (wcSchedule?.matches || [])) {
    const id = m?.fixture_id;
    if (!id || seenMatchIds.has(id)) continue;
    seenMatchIds.add(id);
    const slug = slugify(`${m.home?.name || ''}-vs-${m.away?.name || ''}`);
    const path = slug ? `/match/${id}-${slug}/` : `/match/${id}/`;
    urls.push({
      loc: SITE_URL + path,
      priority: '0.7',
      changefreq: 'daily',
      lastmod: (m.date || new Date().toISOString()).slice(0, 10),
    });
  }

  // Dynamic highlight pages: /highlights/<id>-<home>-vs-<away>/
  const seenHighlightIds = new Set();
  for (const h of (highlights?.highlights || [])) {
    const id = h?.fixture_id;
    if (!id || seenHighlightIds.has(id)) continue;
    seenHighlightIds.add(id);
    const slug = slugify(`${h.home || ''}-vs-${h.away || ''}`);
    const path = slug ? `/highlights/${id}-${slug}/` : `/highlights/${id}/`;
    urls.push({
      loc: SITE_URL + path,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: (h.kickoff_iso || new Date().toISOString()).slice(0, 10),
    });
  }

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
