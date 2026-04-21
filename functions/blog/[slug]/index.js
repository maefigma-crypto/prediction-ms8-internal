import { getPostBySlug, getSettings, SITE_URL, escHtml } from '../../_repo.js';

export async function onRequestGet({ params, request, env }) {
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const [post, settings] = await Promise.all([getPostBySlug(env, slug), getSettings(env)]);
  if (!post) return notFound(slug, settings);
  return renderPost(post, settings, new URL(request.url));
}

function notFound(slug, settings) {
  return new Response(shell({
    title: `Not Found | ${settings.site_name || 'ScoreOcs8'}`,
    description: 'Post not found',
    robots: 'noindex, nofollow',
    canonical: `${SITE_URL}/blog/`,
    body: `<div class="wrap"><h1 style="font-family:var(--ff);font-size:32px;margin-bottom:1rem;">Post not found</h1><p style="color:var(--text2);">No blog post matches <code>${escHtml(slug)}</code>. <a href="/blog/" style="color:var(--accent);">Back to blog</a>.</p></div>`,
  }), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function renderPost(post, settings, url) {
  const lang = url.searchParams.get('lang') === 'bm' ? 'bm' : url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  const m = post.meta;

  const titleByLang = { en: m.title, bm: m.title_bm || m.title, zh: m.title_zh || m.title };
  const title = titleByLang[lang] || m.title;
  // Body is always English — SEO focus is EN and it saves token budget. Title still localised
  // so BM/中文 listings and share cards feel native.
  const contentSource = post.body;

  const seoTitle = m.seo_title || title;
  const metaDesc = m.meta_description || m.excerpt || settings.default_meta_description || '';
  const canonical = m.canonical_url || `${SITE_URL}/blog/${post.slug}/`;
  const ogImage = m.og_image || m.featured_image || settings.default_og_image || '';
  const ogTitle = m.og_title || seoTitle;
  const ogDesc = m.og_description || metaDesc;
  const ogType = m.og_type || 'article';
  const twitterCard = m.twitter_card || 'summary_large_image';
  const twitterHandle = m.twitter_handle || '';
  const robots = m.meta_robots || 'index, follow';
  const dateIso = m.date ? new Date(m.date).toISOString() : '';
  const dateHuman = m.date ? new Date(m.date).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  const articleSchema = m.schema_type === 'Article' ? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: seoTitle,
    description: metaDesc,
    image: ogImage || undefined,
    datePublished: dateIso,
    dateModified: dateIso,
    author: { '@type': 'Organization', name: settings.site_name || 'ScoreOcs8' },
    publisher: { '@type': 'Organization', name: settings.site_name || 'ScoreOcs8' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  } : null;

  const faqSchema = (m.schema_type === 'FAQPage' && Array.isArray(m.faq_items) && m.faq_items.length) ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: m.faq_items.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  } : null;

  // BreadcrumbList — helps Google render path as structured breadcrumb in SERPs.
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog/` },
      { '@type': 'ListItem', position: 3, name: title },
    ],
  };

  // SportsEvent — for cron-generated match previews, lets Google surface the
  // fixture as a sports event with start date, teams, venue.
  const sportsSchema = (m.sports_home_name && m.sports_away_name && m.sports_start_date) ? {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${m.sports_home_name} vs ${m.sports_away_name}`,
    startDate: m.sports_start_date,
    sport: m.sports_sport || 'Football',
    homeTeam: { '@type': 'SportsTeam', name: m.sports_home_name },
    awayTeam: { '@type': 'SportsTeam', name: m.sports_away_name },
    location: m.sports_venue ? { '@type': 'Place', name: m.sports_venue } : undefined,
    organizer: m.sports_league ? { '@type': 'SportsOrganization', name: m.sports_league } : undefined,
  } : null;

  const orgSchema = safeParseJson(settings.organisation_schema);

  const schemaBlocks = [articleSchema, faqSchema, breadcrumbSchema, sportsSchema, orgSchema].filter(Boolean)
    .map(s => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`).join('\n');

  // hreflang alternates — tells Google which URL serves which language variant.
  const hreflangTags = `
<link rel="alternate" hreflang="en" href="${canonical}">
<link rel="alternate" hreflang="ms" href="${canonical.replace(/\/$/, '/')}?lang=bm">
<link rel="alternate" hreflang="zh" href="${canonical.replace(/\/$/, '/')}?lang=zh">
<link rel="alternate" hreflang="x-default" href="${canonical}">`.trim();

  const bodyHtml = `
<div class="wrap post">
  <a class="back" href="/blog/">← All posts</a>
  ${m.featured_image ? `<img src="${escHtml(m.featured_image)}" alt="${escHtml(m.og_image_alt || title)}" style="width:100%;height:auto;border-radius:8px;margin-bottom:1.5rem;">` : ''}
  <div class="cat">${escHtml(m.category || '')}${m.league && m.league !== 'General' ? ' · ' + escHtml(m.league) : ''}</div>
  <h1 class="ptitle">${escHtml(title)}</h1>
  <div class="pmeta">
    <span>${escHtml(dateHuman)}</span>
    <div class="langs">
      <a href="?lang=en"${lang === 'en' ? ' class="active"' : ''}>EN</a>
      <a href="?lang=bm"${lang === 'bm' ? ' class="active"' : ''}>BM</a>
      <a href="?lang=zh"${lang === 'zh' ? ' class="active"' : ''}>中文</a>
    </div>
  </div>
  <div id="pbody" class="pbody"></div>
  <textarea id="raw" style="display:none">${escHtml(contentSource)}</textarea>
  <div class="tg-cta">
    <div><strong>Free daily picks on Telegram</strong><br><span style="font-size:13px;color:var(--text2);">Auto-posted before every match. No spam.</span></div>
    <a href="https://t.me/livebad" target="_blank" rel="noopener" class="tg-btn">Join @livebad</a>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
(function(){
  var raw = document.getElementById('raw').value;
  var out = document.getElementById('pbody');
  if (window.marked) out.innerHTML = marked.parse(raw);
  else out.innerHTML = '<pre>'+raw.replace(/[&<>]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</pre>';
})();
</script>`;

  return new Response(shell({
    title: `${seoTitle} | ${settings.site_name || 'ScoreOcs8'}`,
    description: metaDesc,
    canonical,
    robots,
    ogTitle, ogDesc, ogImage, ogType, ogImageAlt: m.og_image_alt || title,
    twitterCard, twitterHandle,
    schemaBlocks,
    hreflangTags,
    gaId: settings.google_analytics_id,
    searchConsoleVerify: settings.search_console_verify,
    body: bodyHtml,
  }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

function safeParseJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function shell(opts) {
  const {
    title, description, canonical, robots = 'index, follow',
    ogTitle, ogDesc, ogImage, ogType = 'article', ogImageAlt,
    twitterCard = 'summary_large_image', twitterHandle,
    schemaBlocks = '', hreflangTags = '', gaId, searchConsoleVerify,
    body,
  } = opts;
  const esc = escHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || '')}">
<meta name="robots" content="${esc(robots)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${hreflangTags}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${searchConsoleVerify ? `<meta name="google-site-verification" content="${esc(searchConsoleVerify)}">` : ''}
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(ogDesc || description || '')}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:url" content="${esc(canonical || '')}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
${ogImage && ogImageAlt ? `<meta property="og:image:alt" content="${esc(ogImageAlt)}">` : ''}
<meta name="twitter:card" content="${esc(twitterCard)}">
${twitterHandle ? `<meta name="twitter:site" content="${esc(twitterHandle)}">` : ''}
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#080b10;--bg2:#0d1117;--card:#0f1620;--card2:#141e2a;--border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.12);--accent:#f97316;--accent2:#ea6a0a;--green:#00e5a0;--red:#ff4757;--blue:#3d8fff;--amber:#f5a623;--text:#e8edf5;--text2:#8a9ab5;--text3:#4a5a72;--ff:'Rajdhani',sans-serif;--fb:'Outfit',sans-serif;--fm:'DM Mono',monospace;}
*{margin:0;padding:0;box-sizing:border-box;}html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:var(--fb);font-size:15px;line-height:1.7;min-height:100vh;}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(249,115,22,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(249,115,22,0.012) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0;}
nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;height:62px;background:rgba(8,11,16,0.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);}
.nav-logo{font-family:var(--ff);font-size:22px;font-weight:700;letter-spacing:0.06em;color:var(--text);text-decoration:none;}
.nav-logo .hl{color:var(--accent);}
.nav-links{display:flex;gap:2px;list-style:none;}
.nav-links a{font-size:13px;font-weight:500;color:var(--text2);text-decoration:none;padding:6px 11px;border-radius:4px;transition:color .2s,background .2s;}
.nav-links a:hover,.nav-links a.active{color:var(--accent);background:rgba(249,115,22,0.07);}
.wrap{max-width:780px;margin:0 auto;padding:3rem 2rem 4rem;position:relative;z-index:1;}
.back{display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:13px;text-decoration:none;margin-bottom:1.5rem;}
.back:hover{color:var(--accent);}
.cat{font-family:var(--fm);font-size:11px;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem;}
.ptitle{font-family:var(--ff);font-size:36px;font-weight:700;letter-spacing:.02em;line-height:1.15;margin-bottom:.75rem;}
.pmeta{display:flex;justify-content:space-between;align-items:center;font-family:var(--fm);font-size:12px;color:var(--text3);margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border);}
.langs{display:flex;gap:4px;}
.langs a{padding:4px 10px;border:1px solid var(--border);border-radius:4px;color:var(--text2);text-decoration:none;transition:all .2s;}
.langs a:hover{border-color:var(--accent);color:var(--accent);}
.langs a.active{background:var(--accent);color:#fff;border-color:var(--accent);}
.pbody{font-size:16px;line-height:1.8;color:var(--text);}
.pbody h1,.pbody h2,.pbody h3{font-family:var(--ff);letter-spacing:.02em;margin:2rem 0 1rem;}
.pbody h2{font-size:26px;}.pbody h3{font-size:20px;color:var(--accent);}
.pbody p{margin:1rem 0;}
.pbody a{color:var(--accent);text-decoration:underline;}
.pbody ul,.pbody ol{margin:1rem 0 1rem 2rem;}
.pbody li{margin:.4rem 0;}
.pbody code{background:var(--card2);padding:2px 6px;border-radius:3px;font-family:var(--fm);font-size:.9em;}
.pbody pre{background:var(--card2);padding:1rem;border-radius:6px;overflow-x:auto;margin:1rem 0;}
.pbody blockquote{border-left:3px solid var(--accent);padding-left:1rem;color:var(--text2);margin:1rem 0;}
.pbody img{max-width:100%;height:auto;border-radius:6px;margin:1rem 0;}
.tg-cta{margin-top:3rem;padding:1.5rem;background:var(--card);border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;}
.tg-btn{background:var(--accent);color:#fff;font-family:var(--ff);font-weight:700;letter-spacing:.05em;padding:10px 22px;border-radius:4px;text-decoration:none;font-size:14px;}
.tg-btn:hover{background:var(--accent2);}
footer{border-top:1px solid var(--border);padding:2rem;text-align:center;color:var(--text3);font-size:12px;position:relative;z-index:1;}
footer a{color:var(--text2);text-decoration:none;margin:0 .5rem;}
</style>
${gaId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(gaId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(gaId)}');</script>` : ''}
${schemaBlocks}
</head>
<body>
<nav>
  <a href="/" class="nav-logo">Score<span class="hl">Ocs8</span></a>
  <ul class="nav-links">
    <li><a href="/">🏠 Home</a></li>
    <li><a href="/#predictions">📊 Predictions</a></li>
    <li><a href="/blog/">📝 Blog</a></li>
    <li><a href="/#faq">❓ FAQ</a></li>
  </ul>
</nav>
${body}
<footer>© 2025 ScoreOcs8 · <a href="/">Home</a> · <a href="/blog/">Blog</a></footer>
</body>
</html>`;
}
