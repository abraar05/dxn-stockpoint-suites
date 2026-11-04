/**
 * Point of sale: catalogue grid, member pricing, one-tap add, cart panel.
 * Search stays local — the cache is already on the device.
 */

import { esc, money, int, num, round2 } from '../util.js';
import { icon, emptyState, openModal, toast, stockBadge, hydrateIcons } from '../ui.js';
import * as store from '../store.js';
import { renderCartPanel, openHeldSales } from './cart.js';

const filters = { q: '', category: 'ALL' };
let gridBound = false;

export function openProductView(product) {
  const currency = store.currency();
  const photo = store.imageFor(product);
  return openModal({
    title: product.name,
    body: `
      <div class="product-view">
        <div class="product-view__media">
          ${photo
            ? `<img src="${esc(photo)}" alt="${esc(product.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'product__placeholder',innerHTML:'<img src=&quot;icons/logo-mark-96.png&quot; alt=&quot;&quot;><span>DXN product</span>'}))">`
            : `<div class="product__placeholder"><img src="icons/logo-mark-96.png" alt=""><span>DXN product</span></div>`}
        </div>
        <div class="product-view__meta">
          <div>
            <div class="product-view__name">${esc(product.name)}</div>
            <div class="product-view__sku">${esc(product.sku)} · ${esc(product.category || 'General')}</div>
          </div>
          <p class="product-view__desc">${esc(product.description || 'No description recorded for this product yet.')}</p>
          <div class="product-view__prices">
            <div class="product-view__price"><span>Retail</span><strong>${money(product.retail_price, currency)}</strong></div>
            <div class="product-view__price"><span>Member</span><strong>${money(product.member_price, currency)}</strong></div>
            <div class="product-view__price"><span>PV points</span><strong>${num(product.pv_points).toFixed(0)}</strong></div>
          </div>
          <div class="product__stock">${stockBadge(product)}<span style="margin-left:6px">${num(product.stock_qty) > 0 ? `${int(product.stock_qty)} unit(s) on the shelf` : 'Backorder required'}</span></div>
          ${store.state.tier === 'member' ? `<p class="kicker">Member pricing is active in the cart</p>` : ''}
        </div>
      </div>
      <div class="row mt-3" style="align-items:flex-end">
        <label class="field" style="margin-bottom:0;max-width:140px"><span>Quantity</span>
          <input class="input pvQty" type="number" min="1" step="1" value="1"></label>
        <button class="btn btn--primary pvAdd" type="button" ${num(product.stock_qty) <= 0 ? 'disabled' : ''}>
          ${icon('cart', 16)} Add to cart
        </button>
      </div>
    `,
    footer: `<button class="btn btn--ghost" type="button" data-close>Close</button>`,
    onMount(panel) {
      panel.querySelector('.pvAdd')?.addEventListener('click', () => {
        const qty = Math.max(1, Math.round(num(panel.querySelector('.pvQty').value, 1)));
        const result = store.addToCart(product.id, qty);
        if (!result.ok) {
          toast(result.message, 'error');
          return;
        }
        toast(`${product.name} × ${qty} added.`, 'ok');
      });
    },
  });
}

function productCard(product) {
  const currency = store.currency();
  const tier = store.state.tier;
  const out = num(product.stock_qty) <= 0;
  const level = store.stockLevel(product);
  const photo = store.imageFor(product);
  const mainPrice = tier === 'member' ? product.member_price : product.retail_price;
  const altPrice = tier === 'member' ? product.retail_price : product.member_price;
  return `
    <article class="product ${out ? 'is-out' : ''}" data-id="${product.id}">
      <div class="product__top">
        <span class="product__cat">${esc(product.category || 'General')}</span>
        <span class="product__pv">${num(product.pv_points).toFixed(0)} PV</span>
      </div>
      <div class="product__media">
        ${photo
          ? `<img class="product__img" src="${esc(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
          : `<div class="product__placeholder"><img src="icons/logo-mark-96.png" alt=""><span>DXN product</span></div>`}
      </div>
      <div>
        <div class="product__name">${esc(product.name)}</div>
        <div class="product__sku">${esc(product.sku)}</div>
        <div class="product__stock"><span class="stock-dot ${level === 'ok' ? '' : level}"></span>
          ${out ? 'Out of stock' : level === 'low' ? `Only ${int(product.stock_qty)} left` : `${int(product.stock_qty)} in stock`}
        </div>
      </div>
      <div class="product__foot">
        <div class="price">${money(mainPrice, currency)}${tier === 'retail' && num(altPrice) ? `<small>member ${money(altPrice, currency)}</small>` : ''}</div>
        <div class="row" style="gap:6px">
          <button class="btn btn--sm btn--ghost" type="button" data-quickview="${product.id}" aria-label="View ${esc(product.name)}">
            ${icon('eye', 15)}
          </button>
          <button class="btn btn--sm btn--primary" type="button" data-add="${product.id}" ${out ? 'disabled' : ''} aria-label="Add ${esc(product.name)} to cart">
            ${icon('plus', 15)} Add
          </button>
        </div>
      </div>
    </article>
  `;
}

function matches(product) {
  if (filters.category !== 'ALL' && product.category !== filters.category) return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(q);
}

export function renderPos(root) {
  const products = store.activeProducts();
  const categories = store.categories();
  const heldCount = store.state.held.length;

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Sell</h2>
        <p><span id="posCount">${int(products.length)}</span> products · prices switch with the tier below.</p>
      </div>
      <div class="section-head__actions">
        <div class="chips" style="max-width:280px">
          <button class="chip ${store.state.tier === 'retail' ? 'is-active' : ''}" data-tier="retail" type="button">Retail pricing</button>
          <button class="chip ${store.state.tier === 'member' ? 'is-active' : ''}" data-tier="member" type="button">Member pricing</button>
        </div>
      </div>
    </div>

    <div class="pos-layout">
      <div>
        <div class="row mb-3">
          <div class="search-wrap">
            <input class="input input--search" id="posSearch" type="search" autocomplete="off"
              placeholder="Search or type a SKU and press Enter…">
          </div>
          <button class="btn btn--ghost" type="button" data-held>${icon('clock', 16)} Held${heldCount ? ` (${heldCount})` : ''}</button>
        </div>
        <div class="chips mb-3" id="posCats">
          <button class="chip ${filters.category === 'ALL' ? 'is-active' : ''}" data-cat="ALL" type="button">All</button>
          ${categories.map((c) => `<button class="chip ${filters.category === c ? 'is-active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('')}
        </div>
        ${products.length ? `
          <div class="product-grid" id="posGrid"></div>
        ` : emptyState('No active products', 'Add products from Inventory to start selling.', 'box')}
      </div>

      <div class="pos-layout__cart" data-cart-panel></div>
    </div>
  `;

  renderCartPanel(root.querySelector('[data-cart-panel]'));
  const grid = root.querySelector('#posGrid');
  const countEl = root.querySelector('#posCount');

  const paint = () => {
    const list = products.filter(matches);
    if (countEl) countEl.textContent = String(list.length);
    grid.innerHTML = list.length
      ? list.map(productCard).join('')
      : emptyState('Nothing matches', 'Try a different search term or category.', 'search');
    // Do not hydrate icons here on every keystroke — the grid uses inline svg.
  };

  bindGrid(grid);
  paint();

  const search = root.querySelector('#posSearch');

  // barcode / bulk-entry: exact SKU hit jumps straight into the cart
  search?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const q = filters.q.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => String(p.sku).toLowerCase() === q);
    const hit = exact || products.find((p) => String(p.name).toLowerCase() === q);
    if (!hit) return;
    search.value = '';
    filters.q = '';
    if (num(hit.stock_qty) <= 0) {
      toast(`${hit.name} is out of stock.`, 'error');
      paint();
      return;
    }
    store.addToCart(hit.id, 1);
    toast(`${hit.name} added to the cart.`, 'ok');
  });

  search?.addEventListener('input', () => {
    filters.q = search.value;
    paint();
  });

  root.querySelectorAll('[data-cat]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filters.category = chip.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('is-active', c === chip));
      paint();
    });
  });

  root.querySelectorAll('[data-tier]').forEach((chip) => {
    chip.addEventListener('click', () => {
      store.setTier(chip.dataset.tier);
      toast(chip.dataset.tier === 'member' ? 'Member pricing active.' : 'Retail pricing active.');
    });
  });

  root.querySelectorAll('[data-held]').forEach((btn) => {
    btn.addEventListener('click', openHeldSales);
  });
}

/** Delegated clicks so grid repaints never lose handlers. */
function bindGrid(grid) {
  if (gridBound) return;
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-add], [data-quickview]');
    if (!target) return;
    if (!grid || !grid.contains(event.target)) return;
    const id = Number(target.dataset.add || target.dataset.quickview);
    const product = store.productById(id);
    if (!product) return;
    if (target.hasAttribute('data-quickview')) {
      openProductView(product);
      return;
    }
    const result = store.addToCart(product.id, 1);
    if (!result.ok) toast(result.message, 'error');
  });
  gridBound = true;
}

// Quick-view deep link from the global search palette.
window.addEventListener('dxn:open-product', (event) => {
  const id = Number(event.detail);
  const product = store.productById(id);
  if (product) openProductView(product);
});
