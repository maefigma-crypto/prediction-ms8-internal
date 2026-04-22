import { getSettings } from './_repo.js';

export async function onRequestGet({ env }) {
  const settings = await getSettings(env);
  const body = settings.robots_txt || `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /daily/\nSitemap: https://scoreocs8.pages.dev/sitemap.xml`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
