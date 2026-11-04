/**
 * Dashboard: today at a glance plus shortcuts to everything a shop does daily.
 * Works from the offline cache on day one; live data arrives with the first sync.
 */

import { esc, money, int, round2, num, compact, relTime, toDate } from '../util.js';
import { icon, emptyState, hydrateIcons, statusBadge, initials } from '../ui.js';
import * as store from '../store.js';
import { openCustomerAuth } from './account.js';

export function renderDashboard(root) {
  const currency = store.currency();
  const now = new Date();
  const isToday = (value) => {
    const date = toDate(value);
    return Boolean(date && date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate());
  };

  const orders = store.state.orders;
  const todayOrders = orders.filter((o) => isToday(o.created_at) && o.status !== 'CANCELLED');
  const revenueToday = todayOrders.reduce((sum, o) => sum + num(o.total_amount), 0);
  const pvToday = todayOrders.reduce((sum, o) => sum + num(o.total_pv), 0);

  const products = store.state.products;
  const lowStock = store.activeProducts().filter((p) => store.stockLevel(p) !== 'ok');
  const outOfStock = lowStock.filter((p) => num(p.stock_qty) <= 0);

  // Last-7-day revenue chart
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const dayOrders = orders.filter((o) => String(o.created_at || '').slice(0, 10) === key && o.status !== 'CANCELLED');
    days.push({
      key,
      label: day.toLocaleDateString(undefined, { weekday: 'short' }),
      revenue: dayOrders.reduce((sum, o) => sum + num(o.total_amount), 0),
      count: dayOrders.length,
    });
  }
  const maxRevenue = Math.max(...days.map((d) => d.revenue), 1);

  const monthOrders = orders.filter((o) => {
    const date = toDate(o.created_at);
    return Boolean(date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear());
  });
  const revenueMonth = monthOrders.reduce((sum, o) => sum + num(o.total_amount), 0);

  const recent = orders.slice(0, 6);
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const shopName = esc(store.state.settings.branch_name || 'Mohammadpur Stock Point');
  const connected = hasBase();

  root.innerHTML = `
    ${connected ? '' : `
      <div class="card card--pad" style="margin-bottom:18px;border-color:color-mix(in srgb,var(--warning) 40%,transparent);background:var(--warning-soft)">
        <div class="row" style="align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="min-width:0">
            <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700;margin-bottom:4px">Local mode — not connected to a shop server</h3>
            <p style="font-size:13px;color:var(--muted);line-height:1.55">
              You are browsing the built-in catalogue. Sales still save on this device and queue for sync.
              To go live for customers anywhere, point this app at your own shop server (Docker image included) in
              <a href="#/settings" style="color:var(--primary);font-weight:700">Settings → Shop server</a>.
            </p>
          </div>
          <a class="btn btn--primary" href="#/settings">Connect server</a>
        </div>
      </div>
    `}

    <section class="hero-card">
      <div class="hero-card__kicker">${greeting} · ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1 class="hero-card__title">${shopName}</h1>
      <p class="hero-card__sub">
        ${store.state.isAdmin
          ? 'Everything in your shop today — sales, stock and orders. Works fully offline.'
          : 'You are browsing as a viewer. Sign in with the shop PIN for history and admin tools.'}
      </p>
      <div class="hero-card__grid">
        <div class="hero-metric">
          <div class="hero-metric__label">Sales today</div>
          <div class="hero-metric__value">${money(revenueToday, currency)}</div>
          <div class="hero-metric__hint">${int(todayOrders.length)} order(s) · ${round2(pvToday).toFixed(0)} PV</div>
        </div>
        <div class="hero-metric">
          <div class="hero-metric__label">This month</div>
          <div class="hero-metric__value">${compact(revenueMonth, currency)}</div>
          <div class="hero-metric__hint">${int(monthOrders.length)} orders in ${now.toLocaleDateString(undefined, { month: 'long' })}</div>
        </div>
        <div class="hero-metric">
          <div class="hero-metric__label">Stock alerts</div>
          <div class="hero-metric__value">${int(lowStock.length)}</div>
          <div class="hero-metric__hint">${int(outOfStock.length)} out · ${int(lowStock.length - outOfStock.length)} low</div>
        </div>
        <div class="hero-metric">
          <div class="hero-metric__label">Catalogue</div>
          <div class="hero-metric__value">${int(products.length)}</div>
          <div class="hero-metric__hint">${int(store.state.customers.length)} customers</div>
        </div>
      </div>
    </section>

    <div class="section-head">
      <div>
        <h2>Quick actions</h2>
        <p>One tap to start the things you do most.</p>
      </div>
    </div>
    <div class="row mb-4" style="gap:10px">
      <a class="btn btn--primary btn--lg" href="#/pos">${icon('cart', 17)} Start a sale</a>
      <a class="btn btn--ghost btn--lg" href="#/inventory">${icon('box', 17)} Take stock</a>
      <a class="btn btn--ghost btn--lg" href="#/orders">${icon('receipt', 17)} Review orders</a>
      <a class="btn btn--ghost btn--lg" href="#/reports">${icon('chart', 17)} Reports</a>
    </div>

    <div class="split mb-4">
      <div class="card chart-card">
        <div class="section-head" style="margin-bottom:6px">
          <div><h2 style="font-size:16px">Last 7 days</h2><p>Revenue by day, including today.</p></div>
          <a class="btn btn--sm btn--ghost" href="#/reports">Full reports</a>
        </div>
        ${revenue7Chart(days, maxRevenue, currency)}
      </div>

      <div class="card card--pad">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">Restock soon</h2><p>Low or out of stock.</p></div>
          <a class="btn btn--sm btn--ghost" href="#/inventory">Inventory</a>
        </div>
        ${lowStock.length ? `
          <div class="list">
            ${lowStock.slice(0, 6).map((p) => `
              <div class="list__row">
                <div class="list__main">
                  <div class="list__title">${esc(p.name)}</div>
                  <div class="list__sub">${esc(p.sku)}</div>
                </div>
                <span class="badge ${num(p.stock_qty) <= 0 ? 'badge--danger' : 'badge--warn'}">
                  ${num(p.stock_qty) <= 0 ? 'Out' : `${int(p.stock_qty)} left`}
                </span>
              </div>
            `).join('')}
          </div>
        ` : emptyState('Stock looks healthy', 'No products are below their alert level.', 'check')}
      </div>
    </div>

    <div class="card card--pad">
      <div class="section-head" style="margin-bottom:10px">
        <div><h2 style="font-size:16px">Recent orders</h2><p>Newest first across web and Android.</p></div>
        <a class="btn btn--sm btn--ghost" href="#/orders">All orders</a>
      </div>
      ${recent.length ? `
        <div class="list">
          ${recent.map((o) => `
            <div class="list__row">
              <span class="customer-avatar" style="width:38px;height:38px;font-size:13px">${initials(o.customer_name)}</span>
              <div class="list__main">
                <div class="list__title">${esc(o.order_number)} — ${esc(o.customer_name)}</div>
                <div class="list__sub">${relTime(o.created_at)} · ${int((o.items || []).reduce((s, i) => s + num(i.quantity), 0))} unit(s)</div>
              </div>
              <strong style="font-size:13px;white-space:nowrap">${money(o.total_amount, currency)}</strong>
              ${statusBadge(o.status)}
            </div>
          `).join('')}
        </div>
      ` : emptyState(
        'No orders yet',
        `Sell your first order from the POS — it stays safe on this device even without internet.`,
        'receipt',
      )}
    </div>

    ${store.state.isAdmin ? '' : `
      <div class="card card--pad mt-4" style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div>
          <h3 style="font-family:var(--font-display);font-size:15px;font-weight:700">Viewer mode</h3>
          <p style="font-size:13px;color:var(--muted);margin-top:4px">Sales are saved locally and queue up for sync. Sign in with the shop PIN to see history and admin tools.</p>
        </div>
        <button class="btn btn--primary" type="button" data-signin>${icon('user', 16)} Shop sign-in</button>
        <button class="btn btn--ghost" type="button" data-custsignin>${icon('userPlus', 16)} Customer sign-in</button>
      </div>
    `}
  `;

  hydrateIcons(root);
  root.querySelector('[data-signin]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dxn:login'));
  });
  root.querySelector('[data-custsignin]')?.addEventListener('click', () => {
    openCustomerAuth('login');
  });
}

function revenue7Chart(days, maxRevenue, currency) {
  return `
    <div class="chart">
      ${days.map((day) => {
        const heightPct = Math.round((day.revenue / maxRevenue) * 100);
        return `
          <div class="chart__col">
            <div class="chart__val">${day.revenue > 0 ? compact(day.revenue) : ''}</div>
            <div class="chart__bar" data-tip="${day.revenue > 0 ? money(day.revenue, currency) : 'No sales'}"
              style="height:${Math.max(2, heightPct)}%;${day.key === localTodayKey() ? 'background:linear-gradient(180deg,var(--accent-2),var(--accent))' : ''}"></div>
            <div class="chart__day">${day.label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function localTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
