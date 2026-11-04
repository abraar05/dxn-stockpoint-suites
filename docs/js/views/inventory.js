/**
 * Inventory: stock levels, movements and product management for the shop.
 */

import { esc, money, num, int, downloadFile } from '../util.js';
import { icon, emptyState, toast, confirmAction, stockBadge } from '../ui.js';
import api, { hasBase } from '../api.js';
import * as store from '../store.js';
import { openProductForm, openStockForm } from './product-form.js';

const filters = { q: '', category: 'ALL', lowOnly: false };

function rowHtml(product) {
  const currency = store.currency();
  const photo = store.imageFor(product);
  const admin = store.state.isAdmin;
  const active = Number(product.is_active ?? 1) === 1;
  return `
    <tr data-id="${product.id}" style="${active ? '' : 'opacity:.55'}">
      <td>
        <div class="row" style="gap:9px;flex-wrap:nowrap">
          ${photo
            ? `<img class="admin-thumb" src="${esc(photo)}" alt="" loading="lazy" onerror="this.remove()">`
            : '<img class="admin-thumb" src="icons/logo-mark-96.png" alt="">'}
          <div style="min-width:0">
            <div style="font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(product.name)}${active ? '' : ' <span class="badge badge--muted">Archived</span>'}</div>
            <div class="mono" style="color:var(--faint)">${esc(product.sku)}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px">${esc(product.category || 'General')}</td>
      <td style="white-space:nowrap">
        <div style="font-weight:700">${money(product.retail_price, currency)}</div>
        <div class="mono" style="color:var(--faint)">member ${money(product.member_price, currency)}</div>
      </td>
      <td class="mono" style="text-align:right">${num(product.pv_points).toFixed(0)}</td>
      <td style="text-align:right;white-space:nowrap">
        <div style="font-weight:800">${int(product.stock_qty)}</div>
        <div>${stockBadge(product)}</div>
      </td>
      <td>
        <div class="td-actions">
          ${admin && hasBase() ? `
            <button class="btn btn--sm btn--ghost" type="button" data-stock="${product.id}" title="Stock movement">${icon('truck', 14)}</button>
            <button class="btn btn--sm btn--ghost" type="button" data-edit="${product.id}" title="Edit">${icon('edit', 14)}</button>
            ${active
              ? `<button class="btn btn--sm btn--danger" type="button" data-archive="${product.id}" title="Archive">${icon('trash', 14)}</button>`
              : `<button class="btn btn--sm btn--ghost" type="button" data-restore="${product.id}" title="Restore">${icon('refresh', 14)}</button>`}
          ` : '<span style="font-size:11px;color:var(--faint)">read-only</span>'}
        </div>
      </td>
    </tr>
  `;
}

function listHtml(products) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Product</th><th>Category</th><th>Price</th>
          <th style="text-align:right">PV</th><th style="text-align:right">On hand</th><th></th>
        </tr></thead>
        <tbody>${products.map(rowHtml).join('')}</tbody>
      </table>
    </div>
  `;
}

function matches(product) {
  if (filters.lowOnly && store.stockLevel(product) === 'ok') return false;
  if (filters.category !== 'ALL' && product.category !== filters.category) return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(q);
}

export function renderInventory(root) {
  const products = store.state.products;
  const categories = store.categories();
  const lowCount = store.activeProducts().filter((p) => store.stockLevel(p) !== 'ok').length;

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Inventory</h2>
        <p>${int(store.activeProducts().length)} active products · ${int(lowCount)} need restocking · shop value on the Analyze tab in Reports.</p>
      </div>
      <div class="section-head__actions">
        <button class="btn btn--ghost" type="button" id="invExport">${icon('download', 16)} CSV</button>
        ${store.state.isAdmin && hasBase() ? `
          <button class="btn btn--primary" type="button" id="invAdd">${icon('plus', 16)} Add product</button>
        ` : ''}
      </div>
    </div>

    <div class="row mb-3">
      <div class="search-wrap">
        <input class="input input--search" id="invSearch" type="search" autocomplete="off"
          placeholder="Search name, SKU or category…" value="${esc(filters.q)}">
      </div>
    </div>
    <div class="chips mb-3">
      <button class="chip ${filters.category === 'ALL' ? 'is-active' : ''}" data-cat="ALL" type="button">All</button>
      ${categories.map((c) => `<button class="chip ${filters.category === c ? 'is-active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('')}
      <button class="chip ${filters.lowOnly ? 'is-active' : ''}" data-low type="button">⚠ Low &amp; out of stock</button>
    </div>

    <div id="invList">${products.length ? listHtml(products.filter(matches)) : emptyState('No products yet', 'Add your first product to build the catalogue.', 'box')}</div>

    ${store.state.isAdmin && hasBase() ? `
      <div class="card card--pad mt-4" id="movementsCard">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">Recent stock movements</h2><p>Every delivery, sale and correction is logged.</p></div>
          <button class="btn btn--sm btn--ghost" type="button" id="movRefresh">${icon('refresh', 14)} Refresh</button>
        </div>
        <div id="movBody"><p style="font-size:12.5px;color:var(--muted)">Loading movements…</p></div>
      </div>
    ` : ''}
  `;

  const list = root.querySelector('#invList');
  const paint = () => {
    const visible = store.state.products.filter(matches);
    list.innerHTML = visible.length ? listHtml(visible) : emptyState(
      store.state.products.length ? 'Nothing matches these filters' : 'No products yet',
      store.state.products.length ? 'Clear the search or category chips.' : 'Add your first product to build the catalogue.',
      'box',
    );
  };

  root.querySelector('#invSearch')?.addEventListener('input', (event) => {
    filters.q = event.target.value;
    paint();
  });

  root.querySelectorAll('[data-cat]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filters.category = chip.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('is-active', c === chip));
      paint();
    });
  });

  root.querySelector('[data-low]')?.addEventListener('click', () => {
    filters.lowOnly = !filters.lowOnly;
    root.querySelector('[data-low]').classList.toggle('is-active', filters.lowOnly);
    paint();
  });

  root.querySelector('#invAdd')?.addEventListener('click', () => openProductForm(null));

  root.querySelector('#invExport')?.addEventListener('click', () => {
    const rows = [['SKU', 'Name', 'Category', 'Retail', 'Member', 'PV', 'On hand', 'Low at', 'Stock level']];
    for (const p of store.state.products) {
      rows.push([
        p.sku, p.name, p.category || 'General',
        num(p.retail_price).toFixed(2), num(p.member_price).toFixed(2), num(p.pv_points).toFixed(0),
        num(p.stock_qty).toFixed(0), num(p.low_stock_at).toFixed(0),
        num(p.stock_qty) <= 0 ? 'OUT' : store.stockLevel(p) === 'low' ? 'LOW' : 'OK',
      ]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`dxn-inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    toast('Inventory CSV downloaded.');
  });

  root.querySelectorAll('[data-stock]').forEach((btn) => {
    btn.addEventListener('click', () => openStockForm(store.productById(btn.dataset.stock)));
  });
  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openProductForm(store.productById(btn.dataset.edit)));
  });

  root.querySelectorAll('[data-archive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const product = store.productById(btn.dataset.archive);
      if (!product) return;
      const ok = await confirmAction({
        title: 'Archive this product?',
        message: `${product.name} disappears from the POS but its history stays intact. You can restore it any time.`,
        confirmLabel: 'Archive',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.archiveProduct(product.id);
        store.syncNow({ quiet: true });
        toast('Product archived.', 'ok');
      } catch (error) {
        toast(error.message || 'Could not archive the product.', 'error');
      }
    });
  });

  root.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const product = store.productById(btn.dataset.restore);
      if (!product) return;
      try {
        await api.restoreProduct(product.id);
        store.syncNow({ quiet: true });
        toast('Product restored.', 'ok');
      } catch (error) {
        toast(error.message || 'Could not restore the product.', 'error');
      }
    });
  });

  if (store.state.isAdmin && hasBase()) loadMovements(root);
}

async function loadMovements(root) {
  const body = root.querySelector('#movBody');
  if (!body) return;
  try {
    const result = await api.movements(24);
    const items = result?.movements || [];
    body.innerHTML = items.length ? `
      <div class="list">
        ${items.map((m) => `
          <div class="list__row">
            <span class="badge ${m.quantity >= 0 ? 'badge--ok' : 'badge--warn'}">${m.quantity >= 0 ? '+' : ''}${int(m.quantity)}</span>
            <div class="list__main">
              <div class="list__title">${esc(m.reason || 'movement')} — ${esc(m.product_name || m.product_sku || `#${m.product_id}`)}</div>
              <div class="list__sub">${esc(m.branch || '')} · balance ${int(m.balance_after)} · order ${esc(m.order_number || '—')}</div>
            </div>
            <span class="mono" style="color:var(--faint);font-size:11px">${esc(String(m.created_at || '').slice(0, 10))}</span>
          </div>
        `).join('')}
      </div>
    ` : emptyState('No movements yet', 'Movements appear as sales, deliveries and stock takes happen.', 'truck');
  } catch (error) {
    body.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">${esc(error.message || 'Could not load movements.')}</p>`;
  }

  root.querySelector('#movRefresh')?.addEventListener('click', () => loadMovements(root));
}
