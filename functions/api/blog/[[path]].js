import { listPosts, listKvContent, getPostBySlug } from '../../_repo.js';

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

function publicPost(p, lang = 'en') {
  const m = p.meta;
  const titleByLang = { en: m.title, bm: m.title_bm || m.title, zh: m.title_zh || m.title };
  const bodyByLang = { en: p.body, bm: m.summary_bm || p.body, zh: m.summary_zh || p.body };
  return {
    slug: p.slug,
    title: titleByLang[lang] || m.title,
    date: m.date || '',
    category: m.category || '',
    league: m.league || '',
    excerpt: m.excerpt || '',
    featured_image: m.featured_image || '',
    seo_title: m.seo_title || '',
    meta_description: m.meta_description || '',
    og_image: m.og_image || m.featured_image || '',
    url: `/blog/${p.slug}/`,
    lang,
    body: bodyByLang[lang] || p.body,
  };
}

export async function onRequestGet({ env, params, request }) {
  const url = new URL(request.url);
  const lang = ['en', 'bm', 'zh'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');

  if (!path || path === 'list') {
    const [githubPosts, kvPosts] = await Promise.all([
      listPosts(env),
      listKvContent(env, 30),
    ]);
    const merged = [...kvPosts, ...githubPosts]
      .sort((a, b) => new Date(b.meta.date || 0) - new Date(a.meta.date || 0));
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10));
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const league = url.searchParams.get('league');
    const category = url.searchParams.get('category');
    let filtered = merged;
    if (league) filtered = filtered.filter(p => (p.meta.league || '') === league);
    if (category) filtered = filtered.filter(p => (p.meta.category || '') === category);
    const total = filtered.length;
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit).map(p => {
      const pub = publicPost(p, lang);
      delete pub.body;
      return pub;
    });
    return json({ total, page, limit, pages: Math.ceil(total / limit) || 1, posts: slice });
  }

  if (path === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    const [githubPosts, kvPosts] = await Promise.all([listPosts(env), listKvContent(env, 3)]);
    const all = [...kvPosts, ...githubPosts];
    const todaysPost = all.find(p => String(p.meta.date || '').slice(0, 10) === today);
    return json({ date: today, post: todaysPost ? publicPost(todaysPost, lang) : null });
  }

  // /api/blog/<slug>
  const slug = path;
  const post = await getPostBySlug(env, slug);
  if (!post) return json({ error: 'not found', slug }, 404);
  return json(publicPost(post, lang));
}
