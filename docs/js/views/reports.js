/**
 * Reports: sales analytics computed from the cached order history, with a CSV
 * export for the accountant.
 */

import { esc, money, int, num, round2, compact, downloadFile, toDate } from '../util.js';
import { icon, emptyState, toast } from '../ui.js';
import * as store from '../store.js';

let rangeDays = 7;

const RANGES = [
  ['7d', 7, '7 days'],
  ['30d', 30, '30 days'],
  ['90d', 90, '90 days'],
  ['all', -1, 'All time'],
];

export function renderReports(root) {
  if (!store.state.isAdmin) {
    root.innerHTML = `
      <div class="card card--pad" style="max-width:520px;margin:40px auto;text-align:center">
        <div style="display:grid;place-items:center;margin-bottom:12px;color:var(--primary)">${icon('chart', 34)}</div>
        <h2 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin-bottom:6px">Reports are for the shop</h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
          Sign in with the shop PIN to view revenue, PV and bestsellers.
        </p>
        <button class="btn btn--primary btn--block" type="button" data-signin>${icon('user', 16)} Sign in with PIN</button>
      </div>
    `;
    root.querySelector('[data-signin]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dxn:login'));
    });
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Reports</h2>
        <p>Computed on this device from the synced order history.</p>
      </div>
      <div class="section-head__actions">
        <button class="btn btn--ghost" type="button" id="repExport">${icon('download', 16)} Export CSV</button>
      </div>
    </div>

    <div class="chips mb-3" id="repRanges">
      ${RANGES.map(([key, days, label]) => `
        <button class="chip ${rangeDays === days ? 'is-active' : ''}" data-range="${days}" type="button">${label}</button>
      `).join('')}
    </div>

    <div id="repBody"></div>
  `;

  const body = root.querySelector('#repBody');
  const paint = () => { body.innerHTML = bodyHtml(); };
  paint();

  root.querySelectorAll('[data-range]').forEach((chip) => {
    chip.addEventListener('click', () => {
      rangeDays = Number(chip.dataset.range);
      root.querySelectorAll('[data-range]').forEach((c) => c.classList.toggle('is-active', c === chip));
      paint();
    });
  });
}

function selectedOrders() {
  const now = new Date();
  return store.state.orders.filter((o) => {
    if (o.status === 'CANCELLED') return false;
    if (rangeDays < 0) return true;
    const date = toDate(o.created_at);
    if (!date) return false;
    return (now - date) <= rangeDays * 86400000;
  });
}

function bodyHtml() {
  const currency = store.currency();
  const orders = selectedOrders();
  const revenue = orders.reduce((sum, o) => sum + num(o.total_amount), 0);
  const pv = orders.reduce((sum, o) => sum + num(o.total_pv), 0);
  const avg = orders.length ? revenue / orders.length : 0;

  // Products
  const productMap = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const key = item.product_sku || item.name;
      const row = productMap.get(key) || { name: item.name, qty: 0, revenue: 0, pv: 0 };
      row.qty += num(item.quantity);
      row.revenue += num(item.line_total ?? item.unit_price * item.quantity);
      row.pv += num(item.unit_pv ?? 0) * num(item.quantity);
      productMap.set(key, row);
    }
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  // Payment mix
  const payMap = new Map();
  for (const order of orders) {
    const key = order.payment_method || 'CASH';
    payMap.set(key, num(payMap.get(key) || 0) + num(order.total_amount));
  }
  const payments = [...payMap.entries()].sort((a, b) => b[1] - a[1]);

  // Chart buckets
  const buckets = rangeDays > 0
    ? buildDayBuckets(orders, rangeDays)
    : buildMonthBuckets(orders);
  const maxRevenue = Math.max(...buckets.map((b) => b.revenue), 1);

  return `
    <div class="stat-grid mb-4">
      <div class="stat-card">
        <div class="stat-card__label">Revenue</div>
        <div class="stat-card__value stat-card--primary">${money(revenue, currency)}</div>
        <div class="stat-card__hint">${int(orders.length)} order(s) in range</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Average order</div>
        <div class="stat-card__value">${money(avg, currency)}</div>
        <div class="stat-card__hint">Across ${int(orders.length)} orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">PV generated</div>
        <div class="stat-card__value stat-card--accent">${round2(pv).toFixed(0)}</div>
        <div class="stat-card__hint">Members earn PV on every sale</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Units sold</div>
        <div class="stat-card__value">${int(topProducts.reduce((sum, p) => sum + p.qty, 0)) || totalUnits(orders)}</div>
        <div class="stat-card__hint">Line items across the range</div>
      </div>
    </div>

    <div class="card chart-card mb-4">
      <div class="section-head" style="margin-bottom:6px">
        <div><h2 style="font-size:16px">Revenue over time</h2><p>Hover a bar for the exact total.</p></div>
      </div>
      ${orders.length ? `
        <div class="chart" style="height:150px">
          ${buckets.map((bucket) => {
            const heightPct = Math.round((bucket.revenue / maxRevenue) * 100);
            return `
              <div class="chart__col">
                <div class="chart__val">${bucket.revenue > 0 ? compact(bucket.revenue) : ''}</div>
                <div class="chart__bar" data-tip="${bucket.label}: ${money(bucket.revenue, currency)}"
                  style="height:${Math.max(2, heightPct)}%"></div>
                <div class="chart__day">${bucket.short}</div>
              </div>
            `;
          }).join('')}
        </div>` : emptyState('No sales in this range', 'Change the range above, or sell something first.', 'chart')}
    </div>

    <div class="split">
      <div class="card card--pad">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">Bestsellers</h2><p>Ranked by revenue.</p></div>
        </div>
        ${topProducts.length ? `
          <div class="table-wrap">
            <table style="min-width:0">
              <thead><tr><th>Product</th><th style="text-align:right">Qty</th>
                <th style="text-align:right">Revenue</th><th style="text-align:right">PV</th></tr></thead>
              <tbody>
                ${topProducts.map((p) => `
                  <tr>
                    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</td>
                    <td style="text-align:right">${int(p.qty)}</td>
                    <td style="text-align:right;font-weight:700">${money(p.revenue, currency)}</td>
                    <td style="text-align:right" class="mono">${num(p.pv).toFixed(0)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>` : emptyState('No product sales yet', 'Bestsellers fill in as orders come in.', 'trendUp')}
      </div>

      <div class="card card--pad">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">Payment mix</h2><p>How customers pay you.</p></div>
        </div>
        ${payments.length ? `
          <div class="list">
            ${payments.map(([method, amount]) => `
              <div class="list__row">
                <span class="badge badge--info">${esc(method)}</span>
                <div class="list__main"><div class="list__title">${money(amount, currency)}</div></div>
                <span class="mono" style="color:var(--muted);font-size:12px">${revenue > 0 ? Math.round((amount / revenue) * 100) : 0}%</span>
              </div>
            `).join('')}
          </div>` : emptyState('Nothing to show', 'Payments break down once sales exist in the range.', 'wallet')}
      </div>
    </div>
  `;
}

function totalUnits(orders) {
  return orders.reduce((sum, o) => sum + (o.items || []).reduce((s, i) => s + num(i.quantity), 0), 0);
}

function buildDayBuckets(orders, days) {
  const now = new Date();
  const bucketCount = Math.min(days, 8);
  const size = days / bucketCount;
  const buckets = [];
  for (let i = bucketCount - 1; i >= 0; i -= 1) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.round((bucketCount - 1 - i) * size));
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - Math.round(size) + 1);
    const startKey = isoWeekless(start);
    const endKey = isoWeekless(end);
    const mine = orders.filter((o) => {
      const key = String(o.created_at || '').slice(0, 10);
      return key >= startKey && key <= endKey;
    });
    buckets.push({
      label: startKey === endKey ? startKey : `${fmtShort(startKey)}–${fmtShort(endKey)}`,
      short: end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      revenue: mine.reduce((sum, o) => sum + num(o.total_amount), 0),
    });
  }
  return buckets;
}

function buildMonthBuckets(orders) {
  const monthMap = new Map();
  for (const order of orders) {
    const key = String(order.created_at || '').slice(0, 7);
    if (!key) continue;
    monthMap.set(key, num(monthMap.get(key) || 0) + num(order.total_amount));
  }
  const keys = [...monthMap.keys()].sort();
  const recent = keys.slice(-12);
  const parse = (key) => new Date(`${key}-02T00:00:00Z`);
  return recent.map((key) => {
    const date = parse(key);
    return {
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      short: date.toLocaleDateString(undefined, { month: 'short' }),
      revenue: monthMap.get(key),
    };
  });
}

function isoWeekless(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fmtShort(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
