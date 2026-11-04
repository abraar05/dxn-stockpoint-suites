/**
 * Application bootstrap: routing, chrome, theme, search palette and sync wiring.
 */

import { $, esc, money } from './util.js';
import { icon, hydrateIcons, toast, openModal, closeModal, statusBadge, initials } from './ui.js';
import api, { ApiError, hasBase, getBase, setBase, detectBase } from './api.js';
import * as store from './store.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPos } from './views/pos.js';
import { renderOrders } from './views/orders.js';
import { renderInventory } from './views/inventory.js';
import { renderCustomers } from './views/customers.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { openCart, closeCart, isCartOpen, renderCartDrawer, openHeldSales } from './views/cart.js';
import { renderAccount, renderTrack, openCustomerAuth } from './views/account.js';

const ROUTES = {
  dashboard: { render: renderDashboard, title: 'Dashboard', kicker: 'Workspace' },
  pos: { render: renderPos, title: 'Point of sale', kicker: 'Sell' },
  catalog: { render: renderPos, title: 'Point of sale', kicker: 'Sell' }, // legacy hash
  orders: { render: renderOrders, title: 'Orders', kicker: 'History' },
  inventory: { render: renderInventory, title: 'Inventory', kicker: 'Manage' },
  customers: { render: renderCustomers, title: 'Customers', kicker: 'Manage' },
  reports: { render: renderReports, title: 'Reports', kicker: 'Insights' },
  settings: { render: renderSettings, title: 'Settings', kicker: 'System' },
  account: { render: renderAccount, title: 'My account', kicker: 'Customer' },
  track: { render: renderTrack, title: 'Track order', kicker: 'Customer' },
};

let lastKey = '';
let lastPushSeen = 0;
let booted = false;

function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const route = raw.split('?')[0].split('/')[0];
  return ROUTES[route] ? route : 'dashboard';
}

// ── Theme ───────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  store.setTheme(theme);
  const button = $('#themeBtn');
  if (button) button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 19);
  const more = $('#moreTheme');
  if (more) more.innerHTML = `${icon(theme === 'dark' ? 'sun' : 'moon', 21)}<span>${theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>`;
}

function toggleTheme() {
  applyTheme(store.state.theme === 'dark' ? 'light' : 'dark');
}

// ── Chrome ──────────────────────────────────────────────────────────────────

function updateChrome() {
  const { settings, syncState, rev, outbox } = store.state;
  const route = currentRoute();
  const meta = ROUTES[route];

  const brandName = $('#brandName');
  if (brandName) {
    brandName.textContent = (settings.branch_name || 'Mohammadpur Stock Point').split(' ')[0] || 'Shop';
  }
  document.title = `${settings.branch_name || 'Mohammadpur Stock Point'} — ${meta.title}`;

  $('#pageTitle').textContent = meta.title;
  $('#pageKicker').textContent = meta.kicker;

  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.route === route);
  });

  const pill = $('#syncPill');
  if (pill) {
    pill.dataset.state = syncState === 'error' ? 'offline' : syncState;
    $('#syncText').textContent = syncLabel(syncState);
    pill.title = hasBase()
      ? `Revision ${int(store.state.rev)} · click to sync now`
      : 'Not connected — open Settings to connect';
  }

  const badge = $('#cartCount');
  const count = store.cartCount();
  if (badge) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  const bar = $('#offlineBar');
  if (bar) bar.classList.toggle('is-visible', !navigator.onLine || syncState === 'offline');
  const offlineText = $('#offlineText');
  if (offlineText) {
    offlineText.textContent = 'Offline — sales are saved on this device and will sync when the connection returns.';
  }

  const sidebarStatus = $('#sidebarStatus');
  if (sidebarStatus) {
    sidebarStatus.dataset.state = syncState === 'error' ? 'offline' : syncState;
    const title = $('#sidebarStatusTitle');
    const text = $('#sidebarStatusText');
    if (title) title.textContent = hasBase() ? (syncState === 'online' ? 'Connected' : syncLabel(syncState)) : 'Local mode';
    if (text) {
      text.textContent = hasBase()
        ? `Revision ${int(rev)} · ${outbox.length ? `${outbox.length} queued` : 'all synced'}`
        : 'Sales stay on this device until you connect a server';
    }
  }

  const navCount = $('#navOrderCount');
  if (navCount) {
    const pending = store.pendingCount() + store.failedCount();
    navCount.textContent = String(pending);
    navCount.hidden = pending === 0;
  }

  const initials = $('#avatarInitials');
  if (initials) initials.textContent = store.state.isAdmin ? 'AD' : (store.state.isCustomer && store.state.customer?.name ? store.state.customer.name.charAt(0).toUpperCase() : 'MS');
  const adminDot = $('#adminDot');
  if (adminDot) adminDot.hidden = !store.state.isAdmin;

  const footerSync = $('#footerSync');
  if (footerSync) footerSync.textContent = hasBase() ? `Live · rev ${int(rev)}` : 'Local mode';

  if (isCartOpen()) renderCartDrawer();
}

function int(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function syncLabel(state) {
  const map = { syncing: 'Syncing', online: 'Live', pending: 'Sending', offline: 'Offline', error: 'Sync error', local: 'Local mode', idle: 'Ready' };
  return map[state] || 'Ready';
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render({ force = false } = {}) {
  const root = $('#view');
  if (!root) return;
  const route = currentRoute();
  const meta = ROUTES[route];

  const cartKey = `${store.state.cart.map((line) => `${line.productId}x${line.qty}`).join(',')}|${store.state.sale.payment_method}`;
  const key = [
    route,
    store.state.isAdmin,
    store.state.tier,
    store.state.theme,
    store.state.products.length,
    store.state.orders.length,
    store.state.customers.length,
    store.state.outbox.length,
    store.state.held.length,
    cartKey,
  ].join('|');
  if (!force && key === lastKey) {
    updateChrome();
    return;
  }
  lastKey = key;

  const active = document.activeElement;
  const focusId = active && root.contains(active) ? active.id : null;
  const caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;

  try {
    meta.render(root);
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="card card--pad"><h2 style="font-size:16px;font-weight:800;margin-bottom:6px">Something went wrong</h2>
      <p style="font-size:13px;color:var(--muted)">${esc(error.message)}</p></div>`;
  }

  hydrateIcons(root);
  updateChrome();

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ }
      }
    }
  }
}

function scheduleRender() {
  if (scheduleRender.pending) return;
  scheduleRender.pending = true;
  const paint = () => {
    scheduleRender.pending = false;
    render();
  };
  // Hidden tabs never fire animation frames; fall back to a timer so a POS
  // left in the background still repaints when data arrives.
  if (!document.hidden) {
    requestAnimationFrame(paint);
  } else {
    setTimeout(paint, 16);
  }
}

// ── Sidebar, sheet & overlay ────────────────────────────────────────────────

function showOverlay() {
  const overlay = $('#overlay');
  if (overlay) {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }
}
function hideOverlaySoon() {
  const overlay = $('#overlay');
  if (!overlay) return;
  const anyOpen = $('#sidebar')?.classList.contains('is-open')
    || $('#moreSheet')?.classList.contains('is-open')
    || isCartOpen();
  if (anyOpen) return;
  overlay.classList.remove('is-open');
  setTimeout(() => { overlay.hidden = true; }, 220);
}

function openSidebar() {
  $('#sidebar')?.classList.add('is-open');
  showOverlay();
}
function closeSidebar() {
  $('#sidebar')?.classList.remove('is-open');
  hideOverlaySoon();
}

function openMore() {
  $('#moreSheet')?.classList.add('is-open');
  showOverlay();
}
function closeMore() {
  $('#moreSheet')?.classList.remove('is-open');
  hideOverlaySoon();
}

// ── Account & login ─────────────────────────────────────────────────────────

function openAccount() {
  const { isAdmin, isCustomer, customer, settings } = store.state;
  if (isCustomer && customer) {
    location.hash = '#/account';
    return;
  }
  openModal({
    title: isAdmin ? 'Shop account' : 'Account',
    body: `
      <img class="about-logo" src="icons/logo-full.png" alt="Mohammadpur Stock Point" width="120" height="120">
      <div class="list">
        <div class="list__row">
          <div class="list__main">
            <div class="list__title">${esc(settings.branch_name || 'Mohammadpur Stock Point')}</div>
            <div class="list__sub">${isAdmin ? 'Admin unlocked on this device' : 'Browsing as a viewer'}</div>
          </div>
          <span class="badge badge--${isAdmin ? 'ok' : 'muted'}">${isAdmin ? 'Admin' : 'Viewer'}</span>
        </div>
        <div class="list__row">
          <div class="list__main">
            <div class="list__title">Shop server</div>
            <div class="list__sub">${hasBase() ? esc(getBase()) : 'Not connected'}</div>
          </div>
          <a class="btn btn--sm btn--ghost" href="#/settings">Change</a>
        </div>
        <div class="list__row">
          <div class="list__main">
            <div class="list__title">Offline cache</div>
            <div class="list__sub">${store.state.products.length} products · ${store.state.orders.length} orders</div>
          </div>
          <span class="badge badge--muted">${store.pendingCount() + store.failedCount()} queued</span>
        </div>
      </div>
    `,
    footer: isAdmin
      ? `<button class="btn btn--ghost" type="button" data-close>Close</button>
         <button class="btn btn--danger" type="button" data-signout>${icon('logout', 16)} Sign out</button>`
      : `<button class="btn btn--ghost" type="button" data-close>Close</button>
         <button class="btn btn--primary" type="button" data-signin>${icon('user', 16)} Shop sign-in</button>
         <button class="btn btn--ghost" type="button" data-custsignin>${icon('userPlus', 16)} Customer sign-in</button>`,
    onMount(panel, close) {
      panel.querySelector('[data-signin]')?.addEventListener('click', () => { close(); openLogin(); });
      panel.querySelector('[data-custsignin]')?.addEventListener('click', () => { close(); openCustomerAuth('login'); });
      panel.querySelector('[data-signout]')?.addEventListener('click', () => {
        store.setAdmin(false);
        close();
        toast('Signed out.');
        render({ force: true });
      });
    },
  });
}

function openLogin() {
  if (!hasBase()) {
    openModal({
      title: 'Connect the shop server first',
      body: `
        <p style="font-size:13.5px;line-height:1.7;color:var(--muted)">
          The admin panel signs in against your own API. Add the address once — the Android app uses
          the same one — and the PIN will work on every device. Or run <code>npm start</code> locally.
        </p>
      `,
      footer: `
        <button class="btn btn--ghost" type="button" data-close>Later</button>
        <button class="btn btn--primary" type="button" data-go-settings>${icon('settings', 16)} Open settings</button>
      `,
      onMount(panel, close) {
        panel.querySelector('[data-go-settings]').addEventListener('click', () => {
          close();
          location.hash = '#/settings';
        });
      },
    });
    return;
  }

  openModal({
    title: 'Shop sign-in',
    body: `
      <img class="about-logo" src="icons/logo-full.png" alt="Mohammadpur Stock Point" width="120" height="120">
      <form id="loginForm" autocomplete="off">
        <label class="field"><span>Shop PIN</span>
          <input class="input" id="pinInput" type="password" inputmode="numeric" autocomplete="current-password"
            placeholder="••••" required minlength="4" style="font-size:20px;letter-spacing:8px;text-align:center"></label>
        <p style="font-size:12px;color:var(--muted);text-align:center">${esc(getBase() || '')}</p>
      </form>
    `,
    footer: `
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <button class="btn btn--primary" type="submit" form="loginForm" id="loginBtn">${icon('user', 16)} Unlock</button>
    `,
    onMount(panel) {
      const form = panel.querySelector('#loginForm');
      const button = panel.querySelector('#loginBtn');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const pin = panel.querySelector('#pinInput').value.trim();
        if (!pin) return;
        button.disabled = true;
        button.innerHTML = '<span class="spinner"></span> Checking…';
        try {
          await api.login(pin);
          store.setAdmin(true);
          await store.verifySession();
          store.syncNow();
          closeModal();
          toast('Welcome back — admin unlocked.', 'ok');
          render({ force: true });
        } catch (error) {
          const message = error instanceof ApiError
            ? (error.status === 401 ? 'Wrong PIN. Try again.' : error.message)
            : 'Could not sign in.';
          toast(message, 'error');
          button.disabled = false;
          button.innerHTML = `${icon('user', 16)} Unlock`;
          panel.querySelector('#pinInput').select();
        }
      });
    },
  });
}

// ── Global search palette ───────────────────────────────────────────────────

function openSearch() {
  openModal({
    title: 'Search everything',
    body: `
      <div class="search-wrap" style="margin-bottom:14px">
        <input class="input input--search" id="globalSearchInput" type="search" autocomplete="off"
          placeholder="Products, orders, customers, pages…">
      </div>
      <div id="globalSearchResults"></div>
    `,
    footer: `<button class="btn btn--ghost" type="button" data-close>Close</button>`,
    onMount(panel) {
      hydrateIcons(panel);
      const input = panel.querySelector('#globalSearchInput');
      const results = panel.querySelector('#globalSearchResults');
      const paint = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
          results.innerHTML = `<p style="font-size:13px;color:var(--muted)">Type to search the catalogue, orders and customers.</p>`;
          return;
        }

        const pages = [
          ['Dashboard', '#/dashboard', 'home'], ['Point of sale', '#/pos', 'store'],
          ['Orders', '#/orders', 'receipt'], ['Inventory', '#/inventory', 'box'],
          ['Customers', '#/customers', 'users'], ['Reports', '#/reports', 'chart'],
          ['Settings', '#/settings', 'settings'],
        ].filter(([name]) => name.toLowerCase().includes(q));

        const products = store.activeProducts()
          .filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q))
          .slice(0, 6);
        const orders = store.state.orders
          .filter((o) => `${o.order_number} ${o.customer_name}`.toLowerCase().includes(q))
          .slice(0, 5);
        const customers = store.state.customers
          .filter((c) => `${c.name} ${c.phone || ''} ${c.dxn_member_id || ''}`.toLowerCase().includes(q))
          .slice(0, 5);

        const sections = [];
        if (pages.length) {
          sections.push(section('Pages', pages.map(([name, href, ic]) => `
            <a href="${href}" class="search-row" data-close style="text-decoration:none;color:inherit">
              <span class="search-row__icon">${icon(ic, 18)}</span>
              <div class="list__main"><div class="list__title">${esc(name)}</div></div>
              ${icon('arrowRight', 15)}
            </a>`).join('')));
        }
        if (products.length) {
          sections.push(section('Products', products.map((p) => `
            <button class="search-row" type="button" data-product="${p.id}" style="width:100%;text-align:left">
              <img class="list__thumb" src="${esc(store.imageFor(p) || 'icons/logo-mark-96.png')}" alt="">
              <div class="list__main">
                <div class="list__title">${esc(p.name)}</div>
                <div class="list__sub">${esc(p.sku)} · ${esc(p.category || 'General')}</div>
              </div>
              <span class="badge badge--info">${money(store.unitPrice(p), store.currency())}</span>
            </button>`).join('')));
        }
        if (orders.length) {
          sections.push(section('Orders', orders.map((o) => `
            <a href="#/orders" class="search-row" data-close style="text-decoration:none;color:inherit">
              <span class="search-row__icon">${icon('receipt', 18)}</span>
              <div class="list__main">
                <div class="list__title">${esc(o.order_number)}</div>
                <div class="list__sub">${esc(o.customer_name)} · ${money(o.total_amount, store.currency())}</div>
              </div>
              ${statusBadge(o.status)}
            </a>`).join('')));
        }
        if (customers.length) {
          sections.push(section('Customers', customers.map((c) => `
            <a href="#/customers" class="search-row" data-close style="text-decoration:none;color:inherit">
              <span class="customer-avatar" style="width:32px;height:32px;font-size:12px">${initials(c.name)}</span>
              <div class="list__main">
                <div class="list__title">${esc(c.name)}</div>
                <div class="list__sub">${esc(c.phone || c.dxn_member_id || '—')}</div>
              </div>
            </a>`).join('')));
        }

        results.innerHTML = sections.length
          ? sections.join('')
          : `<div class="empty" style="padding:24px 0"><p>No matches for “${esc(q)}”.</p></div>`;
        hydrateIcons(results);

        results.querySelectorAll('[data-product]').forEach((btn) => {
          btn.addEventListener('click', () => {
            closeModal();
            location.hash = '#/pos';
            setTimeout(() => window.dispatchEvent(new CustomEvent('dxn:open-product', { detail: Number(btn.dataset.product) })), 150);
          });
        });
      };
      input.addEventListener('input', paint);
      paint();
      setTimeout(() => input.focus(), 60);
    },
  });
}

function section(title, html) {
  return `<div style="margin-bottom:14px"><p class="eyebrow" style="margin-bottom:8px">${title}</p><div class="list">${html}</div></div>`;
}

// ── Help & onboarding ───────────────────────────────────────────────────────

function openHelp() {
  openModal({
    title: 'Quick guide',
    body: `
      <div class="list">
        <div class="list__row"><div class="list__main"><div class="list__title">Start selling</div><div class="list__sub">Open Point of sale, tap Add on any product, then save the sale. Works offline.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">Hold a sale</div><div class="list__sub">Use Hold in the cart to park a sale and free the till for the next customer.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">Member pricing</div><div class="list__sub">Toggle Member pricing in the POS for DXN members — PV follows the sale.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">Stock</div><div class="list__sub">Adjust stock from Inventory; every delivery, sale and count is logged.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">Sync</div><div class="list__sub">Connect your shop server in Settings. Web and Android share one API.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">Shortcuts</div><div class="list__sub"><kbd>Ctrl</kbd>+<kbd>K</kbd> search · <kbd>F2</kbd> sell · <kbd>Esc</kbd> close · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> dark mode</div></div></div>
      </div>
    `,
    footer: `<button class="btn btn--primary" type="button" data-close>Got it</button>`,
  });
}

function maybeOnboard() {
  try {
    if (localStorage.getItem('dxn.onboarded.v3')) return;
  } catch { /* ignore */ }
  openModal({
    title: 'Welcome to Stockpoint',
    body: `
      <img class="about-logo" src="icons/logo-full.png" alt="Mohammadpur Stock Point" width="120" height="120">
      <p style="font-size:14px;color:var(--muted);line-height:1.65;margin-bottom:14px">
        Your point of sale is ready. Start selling right away with the catalogue on this device —
        every sale is saved locally. Connect the shop server later to share data with the Android
        app and other devices.
      </p>
      <div class="list">
        <div class="list__row"><div class="list__main"><div class="list__title">1. Sell</div><div class="list__sub">Open Point of sale and tap Add on any product.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">2. Stock</div><div class="list__sub">Adjust quantities in Inventory and watch low-stock alerts.</div></div></div>
        <div class="list__row"><div class="list__main"><div class="list__title">3. Connect</div><div class="list__sub">Paste your API address in Settings when you are ready.</div></div></div>
      </div>
    `,
    footer: `
      <button class="btn btn--ghost" type="button" data-tour>Explore the POS</button>
      <button class="btn btn--primary" type="button" data-close>Start selling</button>
    `,
    onMount(panel, close) {
      panel.querySelector('[data-tour]')?.addEventListener('click', () => {
        close();
        location.hash = '#/pos';
      });
    },
  });
  try { localStorage.setItem('dxn.onboarded.v3', '1'); } catch { /* ignore */ }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function wireChrome() {
  $('#menuBtn')?.addEventListener('click', openSidebar);
  $('#sidebarClose')?.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-close-more]').forEach((el) => el.addEventListener('click', closeMore));
  document.querySelector('.more-sheet')?.addEventListener('click', (event) => {
    if (event.target.classList.contains('more-sheet')) closeMore();
  });

  $('#cartBtn')?.addEventListener('click', () => {
    if (isCartOpen()) closeCart();
    else openCart();
  });
  $('#cartClose')?.addEventListener('click', closeCart);
  $('#overlay')?.addEventListener('click', () => {
    closeCart();
    closeSidebar();
    closeMore();
  });

  $('#accountBtn')?.addEventListener('click', openAccount);
  $('#themeBtn')?.addEventListener('click', toggleTheme);
  $('#moreBtn')?.addEventListener('click', openMore);
  $('#moreClose')?.addEventListener('click', closeMore);
  $('#moreTheme')?.addEventListener('click', () => { toggleTheme(); closeMore(); });
  $('#moreAccount')?.addEventListener('click', () => { closeMore(); openAccount(); });
  document.querySelectorAll('[data-help]').forEach((btn) => btn.addEventListener('click', () => { closeMore(); openHelp(); }));

  $('#globalSearchBtn')?.addEventListener('click', openSearch);
  $('#syncPill')?.addEventListener('click', () => {
    if (!hasBase()) {
      location.hash = '#/settings';
      toast('Add your API address to go live.');
      return;
    }
    store.syncNow();
    toast('Syncing with the shop server…');
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      location.hash = '#/pos';
      return;
    }
    if (event.key === 'Escape') {
      if (isCartOpen()) closeCart();
      else if ($('#sidebar')?.classList.contains('is-open')) closeSidebar();
      else if ($('#moreSheet')?.classList.contains('is-open')) closeMore();
      else if (document.getElementById('modal')?.classList.contains('is-open')) closeModal();
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      toggleTheme();
    }
  });

  window.addEventListener('dxn:login', openLogin);
  window.addEventListener('hashchange', () => {
    render({ force: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
    closeMore();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__dxnInstallPrompt = event;
  });

  window.addEventListener('online', () => {
    if (hasBase()) toast('Back online — syncing.', 'ok');
  });
  window.addEventListener('offline', () => {
    toast('Offline. Sales will be queued on this device.', 'error');
  });

  store.subscribe(() => {
    if (store.state.lastPush !== lastPushSeen) {
      lastPushSeen = store.state.lastPush;
      if (lastPushSeen) toast('Sale synced to every device.', 'ok');
    }
    scheduleRender();
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  if (booted) return;
  booted = true;

  store.hydrate();

  // index.html sets the dataset before paint; adopt it as the app state.
  const initialTheme = document.documentElement.dataset.theme;
  if (initialTheme === 'dark' || initialTheme === 'light') {
    if (store.state.theme !== initialTheme) {
      try { localStorage.setItem('dxn.theme.v3', initialTheme); } catch { /* ignore */ }
      store.state.theme = initialTheme;
    }
  }
  applyTheme(store.state.theme);
  hydrateIcons(document);
  wireChrome();

  const detected = await detectBase();
  if (detected.ok) store.state.connected = true;

  store.startSyncLoop();
  render({ force: true });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* no SW on plain http */ });
    });
  }

  try {
    if (!localStorage.getItem('dxn.onboarded.v3') && store.state.products.length) {
      setTimeout(maybeOnboard, 700);
    }
  } catch { /* ignore */ }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Escape hatch for console debugging / cross-view hooks.
window.dxn = { openLogin, openAccount, openHelp, openSearch, openCart, closeCart, openHeldSales, openCustomerAuth };
export { openLogin, openAccount, openHelp };
