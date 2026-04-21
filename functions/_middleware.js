import { getSettings, getRedirects, SITE_URL } from './_repo.js';

function escAttr(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
}

/* HTMLRewriter handler: injects site-wide head tags into the homepage.
 * Runs ONLY on '/' or '/index.html' HTML responses so the cost is zero
 * for all API/SSR/static-asset traffic. */
class HomepageHeadInjector {
  constructor(settings) { this.settings = settings; this.done = false; }
  element(element) {
    if (this.done) return;
    this.done = true;
    const s = this.settings || {};
    const parts = [];

    // Favicon — prefer uploaded value from settings, else inline SVG route.
    if (s.favicon) {
      parts.push(`<link rel="icon" href="${escAttr(s.favicon)}">`);
    } else {
      parts.push(`<link rel="icon" type="image/svg+xml" href="/favicon.svg">`);
    }

    // Google Search Console domain verification.
    if (s.search_console_verify) {
      parts.push(`<meta name="google-site-verification" content="${escAttr(s.search_console_verify)}">`);
    }

    // Google Analytics 4.
    if (s.google_analytics_id) {
      const id = escAttr(s.google_analytics_id);
      parts.push(
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`,
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`
      );
    }

    // hreflang alternates — homepage has 3 language variants via ?lang=.
    parts.push(
      `<link rel="alternate" hreflang="en" href="${SITE_URL}/">`,
      `<link rel="alternate" hreflang="ms" href="${SITE_URL}/?lang=bm">`,
      `<link rel="alternate" hreflang="zh" href="${SITE_URL}/?lang=zh">`,
      `<link rel="alternate" hreflang="x-default" href="${SITE_URL}/">`
    );

    // Organisation + WebSite JSON-LD (single source of truth from settings).
    if (s.organisation_schema) {
      try {
        const parsed = JSON.parse(s.organisation_schema);
        parts.push(
          `<script type="application/ld+json">${JSON.stringify(parsed).replace(/</g, '\\u003c')}</script>`
        );
      } catch { /* malformed JSON in settings — skip */ }
    }

    element.append(parts.join('\n'), { html: true });
  }
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 1. 301 / 302 redirect handler (hot path — early return so it's fast).
  // Only match literal pathnames. Redirect manager in _data/redirects.json.
  const redirects = await getRedirects(env);
  for (const r of (redirects.redirects || [])) {
    if (!r.from_url || !r.to_url) continue;
    if (url.pathname === r.from_url) {
      const status = r.type === '302' ? 302 : 301;
      const target = r.to_url.startsWith('http') ? r.to_url : new URL(r.to_url, url.origin).toString();
      return Response.redirect(target, status);
    }
  }

  // 2. Let the downstream handler produce a response.
  const response = await next();

  // 3. Only rewrite the homepage HTML. Every other path (blog SSR, API,
  // assets, og/match, sitemap) is left untouched.
  const isHomepage = url.pathname === '/' || url.pathname === '/index.html';
  const ct = response.headers.get('content-type') || '';
  if (!isHomepage || !ct.includes('text/html')) return response;

  const settings = await getSettings(env);
  return new HTMLRewriter()
    .on('head', new HomepageHeadInjector(settings))
    .transform(response);
}
