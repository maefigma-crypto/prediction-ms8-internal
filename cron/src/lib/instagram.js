// Instagram Graph API adapter (Meta).
//
// Two-step flow: create a media container from a public image URL, then
// publish that container. IG does NOT accept raw bytes — that's why the
// orchestrator saves the screenshot via saveSnap() first and passes the
// resulting public URL here.
//
// Required secrets:
//   IG_USER_ID        Instagram Business Account ID (18-digit numeric)
//   IG_ACCESS_TOKEN   long-lived Page access token with instagram_content_publish
//                     + instagram_basic + pages_show_list scopes
//
// Setup:
// 1. IG account → switch to Business profile
// 2. Link to a Facebook Page
// 3. developers.facebook.com → create app → add Instagram Graph API product
// 4. Tools → Graph API Explorer → select page → generate long-lived token
// 5. Use /me/accounts to find the Page ID → /{page}?fields=instagram_business_account
//    to find the IG_USER_ID

const GRAPH = 'https://graph.facebook.com/v21.0';

async function createContainer(env, { imageUrl, caption }) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption: caption || '',
    access_token: env.IG_ACCESS_TOKEN,
  });
  const res = await fetch(`${GRAPH}/${env.IG_USER_ID}/media?${params}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`IG create container ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

async function publishContainer(env, creationId) {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: env.IG_ACCESS_TOKEN,
  });
  const res = await fetch(`${GRAPH}/${env.IG_USER_ID}/media_publish?${params}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`IG publish ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

function assertCreds(env) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) {
    throw new Error('IG_USER_ID and IG_ACCESS_TOKEN must be set');
  }
}

export async function postPhoto(env, { imageUrl, caption }) {
  assertCreds(env);
  const creationId = await createContainer(env, { imageUrl, caption });
  // IG needs a brief moment to fetch + validate the image. Poll very briefly.
  // Usually ready within 2-3 sec. If not ready, publish will 400 — we retry
  // once after a short delay.
  try {
    const mediaId = await publishContainer(env, creationId);
    return { mediaId, creationId };
  } catch (e) {
    await new Promise(r => setTimeout(r, 3000));
    const mediaId = await publishContainer(env, creationId);
    return { mediaId, creationId, retried: true };
  }
}
