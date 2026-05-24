// ScoreOcs8 PWA bootstrap — service worker registration, install prompt
// and notification opt-in flow. Loaded by every page; renders glass-styled
// cards anchored to the bottom of the viewport.
(() => {
  if (!('serviceWorker' in navigator)) return;

  // ─── Service worker registration ───────────────────────────────────────
  let swReady;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    swReady = reg;
  }).catch(() => {});

  // ─── Helpers ───────────────────────────────────────────────────────────
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const urlB64ToUint8 = s => {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  };

  // ─── Glass card factory ────────────────────────────────────────────────
  function showCard(html, opts = {}) {
    const id = opts.id || 'pwa-card';
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    el.innerHTML = html;
    el.style.cssText = `
      position:fixed; left:12px; right:12px; bottom:14px; z-index:400;
      max-width:520px; margin:0 auto;
      background:rgba(20,28,44,0.85); border:1px solid rgba(255,255,255,0.12);
      border-radius:18px; padding:16px 18px;
      backdrop-filter:blur(22px) saturate(170%);
      -webkit-backdrop-filter:blur(22px) saturate(170%);
      box-shadow:0 24px 60px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.10);
      color:#eef1f8; font-family:'Outfit',sans-serif; font-size:14px;
      animation:pwa-slide .3s ease;
    `;
    document.body.appendChild(el);
    if (!document.getElementById('pwa-anim')) {
      const s = document.createElement('style');
      s.id = 'pwa-anim';
      s.textContent = '@keyframes pwa-slide{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}';
      document.head.appendChild(s);
    }
    return el;
  }
  function hideCard(id = 'pwa-card') {
    document.getElementById(id)?.remove();
  }

  // ─── 1. Install prompt (Android Chrome) ────────────────────────────────
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    if (isStandalone() || ls.get('pwa-install-dismissed')) return;
    setTimeout(() => maybeShowInstall(), 8000); // 8s after page load
  });
  window.addEventListener('appinstalled', () => {
    ls.set('pwa-installed', '1');
    hideCard('pwa-card');
    setTimeout(() => maybeAskNotifications('installed'), 1500);
  });

  function maybeShowInstall() {
    if (!deferredInstall || isStandalone() || ls.get('pwa-install-dismissed')) return;
    showCard(`
      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div style="font-size:28px;line-height:1">📲</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;">Install ScoreOcs8</div>
          <div style="color:#9aa5bd;font-size:12.5px;line-height:1.55;margin-bottom:10px;">Get pre-match alerts, daily picks at 09:00 MYT, and 1-tap home-screen access — no app store, free forever.</div>
          <div style="display:flex;gap:8px;">
            <button id="pwa-install-yes" style="flex:1;padding:10px 14px;border:none;border-radius:10px;background:linear-gradient(180deg,#ff9c4a,#f97316,#c75808);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 16px rgba(249,115,22,.45),inset 0 1px 0 rgba(255,255,255,.4);">Install</button>
            <button id="pwa-install-no" style="padding:10px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;background:rgba(255,255,255,0.04);color:#9aa5bd;font-family:Outfit,sans-serif;font-size:12px;cursor:pointer;">Not now</button>
          </div>
        </div>
      </div>`, { id: 'pwa-card' });

    document.getElementById('pwa-install-yes').onclick = async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferredInstall = null;
      hideCard();
      if (outcome === 'dismissed') ls.set('pwa-install-dismissed', String(Date.now()));
    };
    document.getElementById('pwa-install-no').onclick = () => {
      ls.set('pwa-install-dismissed', String(Date.now()));
      hideCard();
    };
  }

  // ─── 2. iOS install hint (no native prompt available) ──────────────────
  function maybeShowIosHint() {
    if (!isIOS || isStandalone() || ls.get('pwa-ios-dismissed')) return;
    // Only show on the 2nd visit so we're not annoying on first impression.
    const visits = parseInt(ls.get('pwa-visits') || '0', 10) + 1;
    ls.set('pwa-visits', String(visits));
    if (visits < 2) return;
    setTimeout(() => {
      showCard(`
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="font-size:28px">🍎</div>
          <div style="flex:1;min-width:0;">
            <div style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;">Add to Home Screen</div>
            <div style="color:#9aa5bd;font-size:12.5px;line-height:1.55;margin-bottom:8px;">Tap <b style="color:#eef1f8;">Share</b> ⤴ at the bottom, then <b style="color:#eef1f8;">Add to Home Screen</b>. Free pre-match alerts, daily picks before kickoff.</div>
            <button id="pwa-ios-no" style="padding:8px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;background:rgba(255,255,255,0.04);color:#9aa5bd;font-family:Outfit,sans-serif;font-size:12px;cursor:pointer;">Got it</button>
          </div>
        </div>`, { id: 'pwa-card' });
      document.getElementById('pwa-ios-no').onclick = () => {
        ls.set('pwa-ios-dismissed', String(Date.now()));
        hideCard();
      };
    }, 6000);
  }

  // ─── 3. Notification opt-in card (with value-props) ────────────────────
  async function maybeAskNotifications(trigger = 'visit') {
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted') { return; } // already done
    if (Notification.permission === 'denied') return;       // user said no in OS, can't reprompt
    if (ls.get('push-asked')) return;

    // Only on 2nd+ visit OR right after install.
    const visits = parseInt(ls.get('push-visits') || '0', 10) + 1;
    ls.set('push-visits', String(visits));
    if (trigger !== 'installed' && visits < 2) return;

    showCard(`
      <div>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="font-size:28px;flex-shrink:0;">🔔</div>
          <div style="flex:1;min-width:0;">
            <div style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;">Get free pick alerts</div>
            <ul style="list-style:none;padding:0;margin:0 0 12px;display:flex;flex-direction:column;gap:5px;">
              <li style="display:flex;gap:8px;font-size:12.5px;color:#9aa5bd;"><span style="color:#f97316;">●</span> Daily pro picks at 09:00 MYT</li>
              <li style="display:flex;gap:8px;font-size:12.5px;color:#9aa5bd;"><span style="color:#f97316;">●</span> Pre-kickoff reminder for top match</li>
              <li style="display:flex;gap:8px;font-size:12.5px;color:#9aa5bd;"><span style="color:#f97316;">●</span> Win confirmation when our pick wins</li>
              <li style="display:flex;gap:8px;font-size:12.5px;color:#9aa5bd;"><span style="color:#f97316;">●</span> Free forever, 1-tap unsubscribe</li>
            </ul>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="pwa-push-yes" style="flex:1;padding:11px 14px;border:none;border-radius:10px;background:linear-gradient(180deg,#ff9c4a,#f97316,#c75808);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 16px rgba(249,115,22,.45),inset 0 1px 0 rgba(255,255,255,.4);">Allow</button>
          <button id="pwa-push-no" style="padding:11px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;background:rgba(255,255,255,0.04);color:#9aa5bd;font-family:Outfit,sans-serif;font-size:12px;cursor:pointer;">Maybe later</button>
        </div>
      </div>`, { id: 'pwa-card' });

    document.getElementById('pwa-push-yes').onclick = async () => {
      ls.set('push-asked', String(Date.now()));
      hideCard();
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
        await subscribePush();
        // Friendly confirmation ping
        showCard(`<div style="display:flex;gap:10px;align-items:center;"><div style="font-size:22px;">✅</div><div><b style="font-family:Rajdhani,sans-serif;font-size:14px;letter-spacing:.04em;">All set!</b><br><span style="color:#9aa5bd;font-size:12px;">You'll get our top picks before kickoff.</span></div></div>`, { id: 'pwa-card' });
        setTimeout(() => hideCard(), 3500);
      } catch (e) {
        console.warn('push subscribe failed', e);
      }
    };
    document.getElementById('pwa-push-no').onclick = () => {
      ls.set('push-asked', String(Date.now()));
      hideCard();
    };
  }

  async function subscribePush() {
    const reg = swReady || await navigator.serviceWorker.ready;
    const cfg = await fetch('/api/push/config').then(r => r.json()).catch(() => null);
    if (!cfg?.vapidPublicKey) throw new Error('vapid-config-missing');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey),
    });
    const subJson = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...subJson,
        lang: document.documentElement.lang || 'en',
        source: location.pathname,
      }),
    }).catch(() => {});
    ls.set('push-subscribed', '1');
    return sub;
  }

  async function unsubscribePush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      ls.set('push-subscribed', '');
    } catch {}
  }

  // ─── 4. Public API for the drawer toggle ───────────────────────────────
  window.OcsPWA = {
    isInstalled: isStandalone,
    notificationStatus: () => 'Notification' in window ? Notification.permission : 'unsupported',
    askNotifications: () => maybeAskNotifications('manual'),
    enable: subscribePush,
    disable: unsubscribePush,
  };

  // ─── Boot ──────────────────────────────────────────────────────────────
  if (isIOS) maybeShowIosHint();
  // After 25s on page, gently ask about notifications if the user is engaged.
  setTimeout(() => maybeAskNotifications('visit'), 25000);
})();
