# Mohammadpur Stock Point v3.1.1 🛒

An offline-first point of sale for a DXN distributor stockpoint — **one API,
three run paths, two clients that stay in sync**: a web PWA and a native
Android app. Sell with no internet, sync the moment you have it.

| | |
|---|---|
| 🌐 Web app (live) | https://abraar05.github.io/dxn-stockpoint-suites/ |
| 📱 Android APK | https://github.com/abraar05/dxn-stockpoint-suites/releases/tag/v3.1.1 |
| 🖥️ Repo | https://github.com/abraar05/dxn-stockpoint-suites |
| 🔒 Privacy | docs/privacy.html on any deployment |

```
        ┌────────────────────────────┐
        │  Shop server (pick one)    │   single source of truth
        │  node server/index.js      │   revision counter on every row
        │  api/  (PHP 8 + MySQL)     │
        └─────────────┬──────────────┘
                      │  GET /api/v1/sync?since=<rev>
        ┌─────────────┴──────────────┐
        │                            │
┌───────▼─────────┐        ┌─────────▼────────┐
│  Web (PWA)      │        │  Android         │
│  docs/          │        │  android/        │
│  localStorage   │        │  Room/JSON cache │
│  + outbox       │        │  + outbox        │
└─────────────────┘        └──────────────────┘
```

- **One write path.** A sale made on the phone appears on the shop laptop within
  seconds — both clients read the same revision feed.
- **Every row carries `rev`.** Clients store the highest revision they have seen
  and ask only for what changed — cheap on mobile data.
- **Orders are idempotent.** Each sale carries a `client_uuid`; replaying a
  queued order after a dropped connection can never double-book a sale.
- **Stock is enforced on the server.** Two cashiers selling the last unit
  produce one sale and one clear `409 insufficient_stock` — unless the request
  explicitly passes `allow_oversell: 1` (stock then goes negative, a backorder).
- **Nothing is lost offline.** Sales queue in an outbox that survives a refresh
  and retries automatically when the connection returns.

## Quick start (local, everything included)

Requires Node 18+ (no npm packages, no build step).

```bash
npm start          # API + web app on http://127.0.0.1:4173, opens the browser
```

The web app auto-detects a same-origin API — no configuration screen needed on
first run. Sign in with the shop PIN **2468** to unlock orders, history and
admin tools.

Other commands:

| Command | What it does |
|---|---|
| `npm run serve` | Start the server without opening a browser |
| `npm run dev` | Start with auto-reload on server file changes |
| `npm run reset` | Wipe local data (server/data/db.json) and reseed |
| `npm run demo` | Start with demo demo catalogue reseed |
| `npm test` | 13 API contract tests against a live in-process server |
| `npm run check` | Static checks: import graph, sw.js precache, manifest references |

Data lives in `server/data/db.json` (gitignored). The optional admin key —
for machine-to-machine auth via `X-Api-Key` — defaults to
`local-dev-admin-key-change-me`; change it in `server/index.js` or the
`DXN_ADMIN_KEY` environment variable before exposing the server.

## Repository layout

| Path | What it is |
|---|---|
| `server/` | Zero-dependency Node HTTP server: the full API + PWA file host + JSON persistence (`server/lib/db.js` is a mini DB engine with revision tracking) |
| `api/` | PHP 8 + MySQL flavour of the same API — drop-in on shared hosting |
| `docs/` | The web app (ES modules, no build step) + PWA manifest & service worker |
| `android/DXNStockpoint/` | Kotlin + Jetpack Compose app |
| `tests/` | `api.test.mjs` — the contract the web and Android clients depend on |
| `scripts/` | Android toolchain provisioning, PHP contract verifiers, static checks |
| `.github/workflows/` | Pages deploy, InfinityFree FTP deploy, APK/AAB build |

> `backend/` is the retired v1 Node/SQLite server, kept for reference only.

## The web app (docs/)

A installable PWA built from plain ES modules and one stylesheet — no framework,
no build step, fully functional offline from the service-worker cache.

| Screen | What you can do |
|---|---|
| **Shop / storefront** | Customer-facing catalogue, cart, checkout — works as viewer or signed-in customer |
| **My account** | Customer sign-in/sign-up, profile, order history, live order tracking |
| **Track order** | Public tracking by order number + phone (packaging → dispatch → delivery) |
| **Dashboard** | Today's sales, month-to-date, 7-day revenue chart, low-stock watch, recent orders, quick actions |
| **Point of sale** | Product grid with category chips, SKU/Enter fast-add, retail ↔ member pricing, sticky cart panel, hold/resume sales |
| **Orders** | History with status chips, receipt modal, status changes, SteadFast shipping, CSV export, queued-sale recovery *(admin for history)* |
| **Inventory** | Stock levels, movements ledger, product create/edit/archive, CSV export *(admin write)* |
| **Customers** | Auto-built directory with order counts, spend and PV, WhatsApp deep links *(admin)* |
| **Reports** | Revenue by range (7/30/90/all), bestsellers, payment mix, CSV export *(admin)* |
| **Settings** | Server + SteadFast credentials, shop profile (5 tabs), PIN management, device backup/reset, about |

Extras: global search palette (`Ctrl+K`), `F2` jumps to the POS,
`Ctrl+Shift+D` toggles dark mode, light/dark theme follows the system, first-run
onboarding tour, and a cart drawer that works from any screen.

Keyboard & pixel: the shell caches every module in `sw.js`, so the POS opens on
a plane. Selling queues in the outbox on-device and syncs later.

## Using the API

`GET /api/v1/health` · `/config` · `/products` · `/products/{id}` · `/stock/movements`
`POST /api/v1/auth/login` · `/products` · `/stock/update` · `/stock/adjust` · `/orders`
`PUT /api/v1/products/{id}` · `/settings` · `PATCH` same
`POST /api/v1/orders/{id}/status` · `GET` `/orders` · `/orders/{id}` · `/orders/{id}/receipt`
`GET /api/v1/dashboard` · `/reports/sales` · `/settings` · `/sync` · `/sync/status`
`POST/GET /api/v1/courier/*` (SteadFast settings, shipment, status, webhook)

Auth is either `X-Api-Key: <admin_key>` (machines) or
`Authorization: Bearer <token>` from `POST /auth/login` with the shop PIN.
Orders, customers, reports, dashboard and settings writes are admin-only;
the product list is public for the in-store sign.

Run the contract tests any time:

```bash
npm test
```

## Master suite

Open `docs/suite.html` (or the deployed `…/suite.html`) for the unified
**DXN Suite** shell — one rail combining:

- **Stockpoint** — the live POS, embedded and synced to the shop server (real
  app, not a demo)
- **Flow** — orders, courier partners, dispatch, live tracking, fulfillment
- **Intelligence** — control tower, NDR/COD, automation, analytics, SLA, team
- **PV Planner** — month-end target optimizer reading live stock

The Stockpoint workspace loads the real app (`./index.html`) so sales, stock
and orders stay live-synced with the backend.

## Deploy for real

Full walkthrough in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The short version:

1. **Single PC / shop LAN** — run `start-lan.cmd` (or `npm start`) on the shop
   machine; the web app opens at `http://localhost:4173` and every phone on the
   same Wi-Fi reaches the same server at `http://<shop-pc-ip>:4173` (Windows
   asks for firewall permission once on first start). Android: Settings →
   paste `http://<shop-pc-ip>:4173` → Save — both clients now share one live
   catalogue, order history and stock ledger.
2. **Docker / any host** — `docker build -t dxn-stockpoint .` then
   `docker run -p 4173:4173 --env-file .env dxn-stockpoint`. Works on any VPS,
   Render, Fly.io, Railway, Azure Container Apps, etc. Copy `.env.example` to
   `.env` and set `DXN_PIN` + `DXN_ADMIN_KEY` (production mode refuses the
   defaults). Point the web app and Android app at the public HTTPS URL.
3. **Multi-device over the internet (PHP)** — upload `api/` to any PHP 8 host,
   fill `api/config/config.php`, open `…/api/public/install.php?key=<key>` once,
   then point both apps at that origin.
4. **Web app hosting** — `docs/` is publishable anywhere static (GitHub Pages via
   the included workflow). One address powers both clients.
5. **Android** — `scripts/provision-android.ps1` (one-off) then
   `scripts/build-android.ps1`; the APK/AAB lands in GitHub Releases.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sync pill says *Offline* | Open Settings → *Test connection*; wrong origin or server not running |
| Orders missing after a sale | Check the green queued-sale card on Orders — retry or discard after a stock fix |
| Wrong prices at the till | Toggle *Member pricing* on the POS screen; per-order `is_member` is respected server-side too |
| PIN not accepted | Confirm the server was installed with that PIN; change it from Settings → Access |

## Licence

Private project for DXN stockpoint operations.
