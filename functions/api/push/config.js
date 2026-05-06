// GET /api/push/config — returns the VAPID public key + site metadata so
// the PWA can call PushManager.subscribe({ applicationServerKey }).
//
// The public key is safe to expose. The matching private key lives in the
// Cloudflare env (VAPID_PRIVATE_KEY) and is only read by the broadcast
// sender — never reaches the browser.

const VAPID_PUBLIC = 'BB4VbycFeH5MKGIrIuEX7AzzFih61rEdvEN7x3Mvo8Sn4GvwZrXk24nsGyGUy3MiEDKSBFMvZhnbpAwmqUNy-b4';

export async function onRequestGet({ env }) {
  const pub = env.VAPID_PUBLIC_KEY || VAPID_PUBLIC;
  return new Response(JSON.stringify({
    vapidPublicKey: pub,
    site: 'scoreocs8',
    enabled: true,
  }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
