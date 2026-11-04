/**
 * Customers: everyone the shop has ever served, merged from the API directory
 * and the order cache — searchable, WhatsApp-ready.
 */

import { esc, money, num, int, relTime, digits, downloadFile, toDate } from '../util.js';
import { icon, emptyState, openModal, toast, closeModal, initials, avatarColor } from '../ui.js';
import * as store from '../store.js';

let query = '';

/** Server rows plus derived knowledge from cached orders. */
function buildDirectory() {
  const map = new Map();

  const upsert = (name, phone, memberId, patch) => {
    const key = phone || String(name || '').trim().toLowerCase();
    if (!key) return;
    const row = map.get(key) || { name, phone, dxn_member_id: '', orders: 0, spend: 0, pv: 0, last: null };
    map.set(key, {
      ...row,
      ...patch,
      name: name || row.name || 'Customer',
      phone: phone || row.phone,
      dxn_member_id: memberId || row.dxn_member_id,
      orders: row.orders,
      spend: row.spend,
      pv: row.pv,
      last: row.last,
    });
  };

  for (const c of store.state.customers) {
    upsert(c.name, c.phone || '', c.dxn_member_id || '', {});
  }

  const currencySpends = [];
  for (const o of store.state.orders) {
    if (o.status === 'CANCELLED') continue;
    currencySpends.push(o);
  }

  for (const o of currencySpends) {
    const key = o.customer_phone || String(o.customer_name || '').trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key) || { name: 'Customer', phone: '', dxn_member_id: '', orders: 0, spend: 0, pv: 0, last: null };
    const created = toDate(o.created_at);
    existing.name = existing.name !== 'Customer' ? existing.name : o.customer_name;
    existing.phone = existing.phone || o.customer_phone || '';
    existing.dxn_member_id = existing.dxn_member_id || o.dxn_member_id || '';
    existing.orders += 1;
    existing.spend = num(existing.spend) + num(o.total_amount);
    existing.pv = num(existing.pv) + num(o.total_pv);
    if (created && (!existing.last || created > existing.last)) existing.last = created;
    map.set(key, existing);
  }

  return [...map.values()]
    .filter((c) => c.orders > 0 || c.phone)
    .sort((a, b) => b.orders - a.orders || b.spend - a.spend);
}

function cardHtml(customer, currency) {
  const color = avatarColor(customer.name);
  return `
    <div class="card card--pad" data-customer-id="${esc(customer.phone || customer.name)}">
      <div class="customer-card" style="background:transparent;border:0;padding:0">
        <div class="customer-avatar" style="background:${esc(color)};color:#fff">${esc(initials(customer.name))}</div>
        <div style="min-width:0;flex:1">
          <div class="customer-card__name" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(customer.name)}</div>
          <div class="mono" style="font-size:11.5px;color:var(--faint)">${esc(customer.phone || '—')}${customer.dxn_member_id ? ` · ${esc(customer.dxn_member_id)}` : ''}</div>
        </div>
      </div>
      <div class="stat-grid mt-2" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div>
          <div class="eyebrow" style="font-size:9.5px">Orders</div>
          <div style="font-weight:700;font-size:15px">${int(customer.orders)}</div>
        </div>
        <div>
          <div class="eyebrow" style="font-size:9.5px">Spent</div>
          <div style="font-weight:700;font-size:15px">${money(customer.spend, currency)}</div>
        </div>
        <div>
          <div class="eyebrow" style="font-size:9.5px">PV</div>
          <div style="font-weight:700;font-size:15px">${num(customer.pv).toFixed(0)}</div>
        </div>
      </div>
      ${customer.last ? `<p style="font-size:11.5px;color:var(--muted);margin-top:10px">Last order ${relTime(customer.last)}</p>` : ''}
      <div class="row mt-2" style="gap:8px">
        <button class="btn btn--sm btn--ghost" type="button" data-view="${esc(customer.phone || customer.name)}">${icon('receipt', 14)} History</button>
        ${customer.phone ? `
          <button class="btn btn--sm btn--wa" type="button" data-wa="${esc(customer.phone)}">${icon('whatsapp', 14)} WhatsApp</button>
        ` : ''}
      </div>
    </div>
  `;
}

function matches(customer) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${customer.name} ${customer.phone || ''} ${customer.dxn_member_id || ''}`.toLowerCase().includes(q);
}

export function renderCustomers(root) {
  const currency = store.currency();
  const directory = buildDirectory();

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Customers</h2>
        <p>${int(directory.length)} customer(s) known to this shop. History grows automatically as orders sync.</p>
      </div>
      <div class="section-head__actions">
        <button class="btn btn--ghost" type="button" id="custExport" ${directory.length ? '' : 'disabled'}>${icon('download', 16)} CSV</button>
      </div>
    </div>

    <div class="row mb-3">
      <div class="search-wrap">
        <input class="input input--search" id="custSearch" type="search" autocomplete="off"
          placeholder="Search name, phone or member ID…" value="${esc(query)}">
      </div>
    </div>

    <div id="custGrid">
      ${directory.length
        ? `<div class="product-grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${directory.filter(matches).map((c) => cardHtml(c, currency)).join('')}</div>`
        : emptyState(
          'No customers yet',
          'Customers appear here after your first sales. Try the POS.',
          'users',
        )}
    </div>
  `;

  const grid = root.querySelector('#custGrid');
  const paint = () => {
    const visible = directory.filter(matches);
    grid.innerHTML = visible.length
      ? `<div class="product-grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${visible.map((c) => cardHtml(c, currency)).join('')}</div>`
      : emptyState('No customers match', 'Try a different name, phone or member ID.', 'users');
    bind(grid);
  };

  root.querySelector('#custSearch')?.addEventListener('input', (event) => {
    query = event.target.value;
    paint();
  });

  function bind(scope = grid) {
    scope.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const customer = directory.find((c) => (c.phone || c.name) === btn.dataset.view);
        if (customer) openCustomerDetail(customer, currency);
      });
    });
    scope.querySelectorAll('[data-wa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const customer = directory.find((c) => c.phone === btn.dataset.wa);
        window.open(
          `https://wa.me/${digits(btn.dataset.wa)}?text=${encodeURIComponent(
            `Hello${customer ? ` ${customer.name}` : ''}! This is ${store.state.settings.branch_name || 'Mohammadpur Stock Point'}. How can we help you today?`,
          )}`,
          '_blank', 'noopener',
        );
      });
    });
  }

  bind(grid);

  root.querySelector('#custExport')?.addEventListener('click', () => {
    const rows = [['Name', 'Phone', 'Member ID', 'Orders', 'Spent', 'PV', 'Last order']];
    for (const c of directory) {
      rows.push([
        c.name, c.phone || '', c.dxn_member_id || '',
        c.orders, num(c.spend).toFixed(2), num(c.pv).toFixed(0),
        c.last ? c.last.toISOString() : '',
      ]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`dxn-customers-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    toast('Customer CSV downloaded.');
  });
}

export function openCustomerDetail(customer, currency = store.currency()) {
  const orders = store.state.orders
    .filter((o) => (String(o.customer_name) === String(customer.name)
      || (customer.phone && String(o.customer_phone) === String(customer.phone)) || false))
    .slice(0, 60);

  openModal({
    title: customer.name,
    body: `
      <div class="customer-card mb-3">
        <div class="customer-avatar" style="background:${esc(avatarColor(customer.name))};color:#fff">${esc(initials(customer.name))}</div>
        <div>
          <div style="font-weight:700">${esc(customer.name)}</div>
          <div class="mono" style="font-size:12px;color:var(--muted)">${esc(customer.phone || 'no phone')}${customer.dxn_member_id ? ` · member ${esc(customer.dxn_member_id)}` : ''}</div>
        </div>
      </div>
      <div class="stat-grid mb-3" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card" style="padding:12px 14px"><div class="stat-card__label">Orders</div><div class="stat-card__value" style="font-size:20px">${int(customer.orders)}</div></div>
        <div class="stat-card" style="padding:12px 14px"><div class="stat-card__label">Spent</div><div class="stat-card__value" style="font-size:20px">${money(customer.spend, currency)}</div></div>
        <div class="stat-card" style="padding:12px 14px"><div class="stat-card__label">PV</div><div class="stat-card__value" style="font-size:20px">${num(customer.pv).toFixed(0)}</div></div>
      </div>
      ${orders.length ? `
        <p class="eyebrow mb-1">Recent orders</p>
        <div class="table-wrap">
          <table style="min-width:0">
            <thead><tr><th>Order</th><th>Status</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>
              ${orders.map((o) => `
                <tr><td><span class="mono">${esc(o.order_number)}</span><br><span style="font-size:11px;color:var(--faint)">${esc(relTime(o.created_at))}</span></td>
                <td>${esc(o.status)}</td>
                <td style="text-align:right">${money(o.total_amount, currency)}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p style="font-size:13px;color:var(--muted)">No history synced to this device yet.</p>'}
    `,
    footer: [
      '<button class="btn btn--ghost" type="button" data-close>Close</button>',
      customer.phone
        ? `<button class="btn btn--wa" type="button" data-call>${icon('whatsapp', 16)} WhatsApp</button>`
        : '',
    ].filter(Boolean).join(''),
    onMount(panel, close) {
      panel.querySelector('[data-call]')?.addEventListener('click', () => {
        close();
        window.open(`https://wa.me/${digits(customer.phone)}`, '_blank', 'noopener');
      });
    },
  });
}
