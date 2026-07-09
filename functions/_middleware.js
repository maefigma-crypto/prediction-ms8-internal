import { getSettings, getRedirects, SITE_URL } from './_repo.js';

function escAttr(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
}

/* HTMLRewriter handler: injects a minimal WebSite JSON-LD on every HTML
 * page so the isPartOf: { @id: ".../#website" } reference used by per-page
 * WebPage/SportsEvent schema actually resolves on-page. Without this Google
 * falls back to other site-name signals (and on a Pages-hosted site has
 * been observed labelling search results "Cloudflare"). */
class WebSiteSchemaInjector {
  constructor() { this.done = false; }
  element(element) {
    if (this.done) return;
    this.done = true;
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: 'ScoreOcs8',
      alternateName: 'ScoreOcs8 Predictions',
      inLanguage: 'en-MY',
      publisher: { '@id': `${SITE_URL}/#organisation` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    };
    element.append(
      `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`,
      { html: true }
    );
  }
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

    // NO hreflang for the ?lang= variants: they serve identical HTML (the
    // language switch is client-side JS), so hreflang here contradicts the
    // canonical and made Google index /?lang=bm as the representative page.
    // Real hreflang returns if/when /ms/ pages with server-rendered Malay
    // content exist.

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

  // 0a. /panel and /panel/* → opaque 404 on the customer domain.
  // panel/ source lives in this repo so the standalone admin Pages project
  // (ocs-super-panel) can build from it. That means the static panel files
  // would otherwise be reachable at scoreocs8.com/panel/* too, which is
  // both a duplicate of the standalone admin URL AND a security tell —
  // a 301 to the admin origin advertises where the admin lives to anyone
  // probing the customer domain (`/admin`, `/panel`, `/login` wordlists).
  // A plain 404 keeps the admin location opaque.
  if (url.pathname === '/panel' || url.pathname.startsWith('/panel/')) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // 0b. scoreocs8.pages.dev (and its per-deployment URLs) → scoreocs8.com.
  // SEO consolidation: customer-facing traffic flows through the custom
  // domain so Google attributes link equity correctly.
  // IMPORTANT — only redirect scoreocs8's OWN .pages.dev variants. Other
  // Cloudflare Pages projects on this account (e.g. ocs-super-panel.pages.dev)
  // deploy from this same repo and would otherwise pick up this middleware
  // and 301 themselves out of existence. Match strictly on the scoreocs8
  // project hostname.
  const isScoreOcs8PagesDev =
    url.hostname === 'scoreocs8.pages.dev' ||
    url.hostname.endsWith('.scoreocs8.pages.dev');
  if (isScoreOcs8PagesDev && url.searchParams.get('preview') !== '1') {
    return Response.redirect(`https://scoreocs8.com${url.pathname}${url.search}`, 301);
  }

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

  // 3. Skip non-HTML (API, assets, og images, sitemap.xml, robots.txt).
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;

  // 4. WebSite schema goes on EVERY HTML page so the per-page JSON-LD
  // (SportsEvent, VideoObject, etc.) can reference isPartOf: #website
  // and have that resolve on-page. Cheap — one HTMLRewriter on('head').
  const rewriter = new HTMLRewriter()
    .on('head', new WebSiteSchemaInjector());

  // 5. Homepage gets the heavier injection (favicon, GA, hreflang,
  // organisation_schema from settings). Other pages skip this — they
  // produce their own per-page schema in their handlers.
  const isHomepage = url.pathname === '/' || url.pathname === '/index.html';
  if (isHomepage) {
    const settings = await getSettings(env);
    rewriter.on('head', new HomepageHeadInjector(settings));
  }

  return rewriter.transform(response);
}
