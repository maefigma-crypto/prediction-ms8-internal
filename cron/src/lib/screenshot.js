// Cloudflare Browser Rendering REST API wrapper.
//
// We use the REST endpoint (not the binding) so this worker stays a single
// JS file with zero npm dependencies. The REST API needs:
//   env.CF_ACCOUNT_ID   - your CF account id (dashboard URL)
//   env.CF_API_TOKEN    - API token with "Browser Rendering" edit scope
//
// Free tier: 10 mins of browser time/day on Workers Paid plan. One screenshot
// takes ~2s so that's ~300 screenshots/day. We need 1-5/day. Plenty.

const CF_API = 'https://api.cloudflare.com/client/v4';

export async function screenshot(env, {
  url,
  viewport = { width: 1080, height: 1920 },
  waitUntil = 'networkidle0',
  timeoutMs = 30000,
}) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set');
  }

  const res = await fetch(
    `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/screenshot`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        viewport,
        gotoOptions: { waitUntil, timeout: timeoutMs },
        screenshotOptions: { type: 'png', fullPage: false, omitBackground: false },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Browser Rendering ${res.status}: ${body.slice(0, 400)}`);
  }

  // Response body is the raw PNG bytes.
  return res.arrayBuffer();
}
