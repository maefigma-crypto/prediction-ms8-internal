# OCS Super Panel

Multi-site Web Push broadcast control center.

**Live URL (target):** `ocs-super-panel.pages.dev`

**Source location:** the `panel/` subdirectory of `maefigma-crypto/prediction-ms8-internal`. The main public site (`scoreocs8.pages.dev`) blocks `/panel/*` via `_redirects` so this code is never served from the public domain.

## Architecture

```
panel/
├── index.html                       Single-page shell — login + dashboard
├── css/panel.css                    Dark glass UI matching ScoreOcs8 brand
├── js/app.js                        Hash routing + fetch helpers + views
├── manifest.webmanifest             PWA install (panel itself is installable)
├── sw.js                            Offline shell service worker
├── robots.txt                       Disallow: /
├── _headers                         Strict CSP, noindex, no-cache HTML
├── _redirects                       SPA fallback to index.html
└── functions/
    ├── _middleware.js               Auth gate for /api/*
    ├── _lib/
    │   ├── auth.js                  PBKDF2, sessions, audit, rate-limit
    │   └── webpush.js               VAPID JWT + aes128gcm payload encryption
    ├── icons/[size].js              Generates PWA icons
    └── api/
        ├── health.js                Public uptime check
        ├── auth/
        │   ├── login.js             POST username/password → session cookie
        │   ├── logout.js            POST destroys session
        │   ├── me.js                GET current session
        │   └── change-password.js   POST current_password + new_password
        ├── subscribers/
        │   ├── stats.js             GET totals + 24h/7d growth + country
        │   └── list.js              GET paginated subscriber list
        ├── broadcast/
        │   ├── send.js              POST title+body+url → fan-out push
        │   ├── preview.js           POST returns sanitised payload
        │   └── history.js           GET past broadcasts
        └── audit/
            └── log.js               GET audit entries newest-first
```

## Deploy (one-time setup)

1. **Cloudflare Pages dashboard** → Create new project → Connect to Git → pick `maefigma-crypto/prediction-ms8-internal`
2. **Project name:** `ocs-super-panel`
3. **Build settings:**
   - Framework preset: None
   - Build command: *(leave blank)*
   - Build output directory: `/`
   - **Root directory: `panel`** ← this is what makes it deploy only the panel folder
4. **Environment variables:**
   ```
   VAPID_PUBLIC_KEY  = (from prediction-ms8-internal/_vapid_keys.txt)
   VAPID_PRIVATE_KEY = (from prediction-ms8-internal/_vapid_keys.txt — keep secret!)
   VAPID_SUBJECT     = mailto:Maefigma@gmail.com
   SESSION_SECRET    = XNoqJYJFQjs_IXf2SqS7c32TCSVyT-hNPwOTebAayrw
   ```
5. **KV binding:**
   - Settings → Functions → KV namespace bindings
   - Variable name: `CACHE`
   - KV namespace: pick the SAME namespace ScoreOcs8 uses (so the panel can read `push:scoreocs8:*` subscribers)
6. **Deploy** — first build creates the live panel.
7. **Cloudflare Access (Zero Trust)** — Cloudflare dashboard → Zero Trust → Access → Applications → Add application → Self-hosted → application domain `ocs-super-panel.pages.dev` → policy: require Google login or email OTP for `Maefigma@gmail.com`.

## First sign-in

The first `/api/auth/login` request lazily seeds an admin user with:

- **Username:** `admin`
- **Password:** `admin123`

After this you'll be **forced to set a strong password** (12+ chars, must contain a digit and a non-letter symbol). The seed credentials become invalid the moment you change.

## Security model

- **PBKDF2-SHA256** with 600,000 iterations (OWASP 2024) — Argon2id isn't natively in Web Crypto, this is the strongest available alternative
- **HttpOnly + Secure + SameSite=Strict** session cookies, `__Host-` prefixed
- **Session token** is a 32-byte random; KV stores its SHA-256 hash so a KV dump can't be replayed
- **Sliding 1-hour idle, 24-hour absolute** session timeout
- **Rate limit:** 5 failed login attempts per 15 min per IP, then 429
- **CSRF:** SameSite=Strict + Origin/Referer header check on state-changing methods
- **Audit log** — every login, broadcast, password change recorded for 90 days
- **Cloudflare Access** layered in front of everything — zero-trust auth before any panel code runs
- **noindex/nofollow** on every response (X-Robots-Tag header + meta)
- **Strict CSP** — `default-src 'self'`, no inline scripts, no eval

## Operating

### Send a broadcast
1. Sign in
2. **Compose** → pick site, write title (≤80 chars) + body (≤240 chars) + click URL
3. Click **Dry-run** to count subscribers
4. Click **Send broadcast** → confirms → fan-out begins
5. Result shows sent / failed / gone counts; gone subscribers are auto-deleted from KV

### Add another site (e.g. Mega RTP)
1. The new site implements the same PWA pattern as ScoreOcs8 — service worker + manifest + push subscription form that POSTs to a `/api/push/subscribe` endpoint storing under `push:<site>:*`
2. In the panel codebase, add the new site to the `SITES` array in `subscribers/stats.js`, `subscribers/list.js`, `broadcast/send.js`
3. Add an `<option>` to the `#c-site` select in `index.html`
4. Add a card to the dashboard view in `app.js`
5. Push, Cloudflare auto-redeploys

### Cost
- **$0 incremental** on top of the existing $5/month Cloudflare Workers Paid plan that covers KV.

## Splitting into its own repo (later)

When you want full repo separation:

```bash
git subtree split --prefix=panel -b panel-only
git push <new-empty-OCS-super-panel-repo> panel-only:main
```

Then in Cloudflare Pages, swap the source repo to the new one and remove the `panel/` block on the public site's `_redirects`.
