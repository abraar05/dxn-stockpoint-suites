/**
 * Cart: the topbar drawer and the sticky POS panel share one renderer.
 *
 * Checkout never talks to the network directly — the sale goes to the outbox,
 * which survives a refresh and retries until the server confirms it.
 */

import { esc, money, round2, digits, int, num } from '../util.js';
import { icon, emptyState, openModal, closeModal, toast, receiptText, orderMessage, waLink, printReceipt } from '../ui.js';
import * as store from '../store.js';
import { hasBase } from '../api.js';

const PAYMENTS = ['CASH', 'BKASH', 'NAGAD', 'CARD', 'BANK TRANSFER', 'WALLET'];

// ── Rendering ───────────────────────────────────────────────────────────────

function lineRow(line) {
  const currency = store.currency();
  const atMax = line.qty >= line.available;
  const photo = store.imageFor(line.product);
  return `
    <div class="cart-row" data-line="${line.productId}">
      ${photo ? `<img class="cart-row__thumb" src="${esc(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
      <div class="cart-row__main">
        <div class="cart-row__name">${esc(line.product.name)}</div>
        <div class="cart-row__meta">${money(line.price, currency)} each · ${line.linePv ? `${round2(line.linePv).toFixed(0)} PV` : 'no PV'}</div>
      </div>
      <div class="stepper">
        <button type="button" data-dec="${line.productId}" aria-label="Decrease">${icon('minus', 14)}</button>
        <span>${int(line.qty)}</span>
        <button type="button" data-inc="${line.productId}" aria-label="Increase" ${atMax ? 'disabled' : ''}>${icon('plus', 14)}</button>
      </div>
      <div style="text-align:right;min-width:74px">
        <div style="font-size:13px;font-weight:800">${money(line.lineTotal, currency)}</div>
        <button type="button" data-remove="${line.productId}" class="cart-row__remove">remove</button>
      </div>
    </div>
  `;
}

function bodyMarkup(totals) {
  const currency = store.currency();
  const { sale } = store.state;
  const customer = store.state.isCustomer ? store.state.customer : null;
  const defaultName = customer ? customer.name : sale.customer_name;
  const defaultPhone = customer ? (customer.phone || sale.customer_phone) : sale.customer_phone;
  const defaultMember = customer ? (customer.dxn_member_id || sale.dxn_member_id) : sale.dxn_member_id;
  return `
    ${totals.lines.map(lineRow).join('')}

    <div class="card card--pad" style="margin-top:6px;padding:16px">
      <div class="section-head" style="margin-bottom:10px">
        <div><h2 style="font-size:14px">Customer</h2></div>
        <button class="btn btn--sm btn--ghost" type="button" data-fill-walkin>Walk-in</button>
      </div>

      <label class="field"><span>Name</span>
        <input class="input cartName" value="${esc(defaultName)}" placeholder="Walk-in customer" maxlength="160"></label>

      <div class="form-2">
        <label class="field"><span>Phone</span>
          <input class="input cartPhone" inputmode="tel" value="${esc(defaultPhone)}" placeholder="01XXXXXXXXX" maxlength="40"></label>
        <label class="field"><span>DXN member ID</span>
          <input class="input cartMember" value="${esc(defaultMember)}" placeholder="Optional" maxlength="40"></label>
      </div>

      <div class="form-2">
        <label class="field"><span>Payment</span>
          <select class="select cartPayment">
            ${PAYMENTS.map((method) => `<option value="${method}" ${sale.payment_method === method ? 'selected' : ''}>${method}</option>`).join('')}
          </select></label>
        <label class="field"><span>Discount (${esc(currency)})</span>
          <input class="input cartDiscount" type="number" min="0" step="0.01" value="${Number(sale.discount) || ''}" placeholder="0.00"></label>
      </div>

      <label class="field" style="margin-bottom:0"><span>Note</span>
        <input class="input cartNote" value="${esc(sale.note)}" placeholder="Delivery instructions, etc." maxlength="200"></label>
    </div>
  `;
}

function footMarkup(totals) {
  const currency = store.currency();
  return `
    <div class="totals">
      <div class="totals__row"><span>${int(totals.units)} item(s)</span><strong>${money(totals.subtotal, currency)}</strong></div>
      <div class="totals__row" data-discount-row ${totals.discount > 0 ? '' : 'hidden'}>
        <span>Discount</span><strong>-<span data-discount>${money(totals.discount, currency)}</span></strong>
      </div>
      <div class="totals__row totals__row--grand"><span>Total</span><strong data-grand>${money(totals.total, currency)}</strong></div>
      <div class="totals__row"><span>PV points</span><strong data-pv>${round2(totals.pv).toFixed(2)}</strong></div>
    </div>
    <button class="btn btn--primary btn--block" type="button" data-checkout>
      ${icon('check', 16)} Save sale${totals.total > 0 ? ` · ${money(totals.total, currency)}` : ''}
    </button>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn--ghost" type="button" data-hold>${icon('clock', 16)} Hold</button>
      <button class="btn btn--ghost" type="button" data-held>
        ${icon('list', 16)} Held${store.state.held.length ? ` (${store.state.held.length})` : ''}
      </button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn--ghost" type="button" data-clear>Clear</button>
      <button class="btn btn--wa" type="button" data-quote>${icon('whatsapp', 16)} Quote</button>
    </div>
  `;
}

/** Fills one cart body+foot pair (used by the drawer and the POS panel). */
export function renderCartInto(body, foot) {
  if (!body || !foot) return;
  const totals = store.cartTotals();

  if (!totals.lines.length) {
    body.innerHTML = emptyState('The cart is empty', 'Tap Add on any product to start a sale.', 'cart');
    foot.innerHTML = `
      <button class="btn btn--ghost btn--block" type="button" data-close-cart>Keep browsing</button>
      ${store.state.held.length
        ? `<button class="btn btn--soft btn--block" type="button" data-held>${icon('clock', 16)} Resume a held sale (${store.state.held.length})</button>`
        : ''}
    `;
    foot.querySelector('[data-held]')?.addEventListener('click', openHeldSales);
    foot.querySelector('[data-close-cart]')?.addEventListener('click', () => closeCart());
    return;
  }

  body.innerHTML = bodyMarkup(totals);
  foot.innerHTML = footMarkup(totals);
  bindBody(body);
  bindFoot(foot);
}

export function renderCartDrawer() {
  renderCartInto(document.getElementById('cartBody'), document.getElementById('cartFoot'));
}

/** Renders the sticky cart panel used by the POS screen. */
export function renderCartPanel(host) {
  if (!host) return;
  host.innerHTML = `
    <div class="cart-panel" data-cart-panel>
      <div class="cart-panel__head">
        <div>
          <span class="eyebrow">Current sale · ${store.state.tier === 'member' ? 'member' : 'retail'} price</span>
          <h3>Your cart</h3>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn btn--sm btn--ghost" type="button" data-help>${icon('help', 15)} Help</button>
        </div>
      </div>
      <div class="cart-panel__body" data-cart-body></div>
      <div class="cart-panel__foot" data-cart-foot></div>
    </div>
  `;
  renderCartInto(host.querySelector('[data-cart-body]'), host.querySelector('[data-cart-foot]'));
}

/** Live totals refresh without a full re-render (keeps typing focus). */
function refreshTotals() {
  const totals = store.cartTotals();
  const currency = store.currency();
  for (const foot of document.querySelectorAll('[data-cart-foot], #cartFoot')) {
    const grand = foot.querySelector('[data-grand]');
    if (grand) grand.textContent = money(totals.total, currency);
    const pv = foot.querySelector('[data-pv]');
    if (pv) pv.textContent = round2(totals.pv).toFixed(2);
    const disc = foot.querySelector('[data-discount]');
    if (disc) disc.textContent = money(totals.discount, currency);
    const discRow = foot.querySelector('[data-discount-row]');
    if (discRow) discRow.hidden = !(totals.discount > 0);
    const checkout = foot.querySelector('[data-checkout]');
    if (checkout) {
      checkout.disabled = false;
      checkout.innerHTML = `${icon('check', 16)} Save sale${totals.total > 0 ? ` · ${money(totals.total, currency)}` : ''}`;
    }
  }
  // The empty-cart state needs a repaint once the first item lands.
  for (const foot of document.querySelectorAll('[data-cart-foot], #cartFoot')) {
    if (!totals.lines.length && !foot.querySelector('[data-checkout]') && !foot.querySelector('[data-close-cart]')) {
      // fall through: app-level render will rebuild on the next notify
    }
  }
}

// ── Binding ─────────────────────────────────────────────────────────────────

function bindBody(body) {
  body.querySelectorAll('[data-inc]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.inc);
      const result = store.addToCart(id, 1);
      if (!result.ok) toast(result.message, 'error');
    });
  });

  body.querySelectorAll('[data-dec]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.dec);
      const line = store.state.cart.find((l) => Number(l.productId) === id);
      if (line) store.setQty(id, line.qty - 1);
    });
  });

  body.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => store.removeFromCart(Number(button.dataset.remove)));
  });

  // Text fields write straight to the store but must not steal focus, so we
  // persist quietly and refresh only the totals.
  const onField = (field, key, transform = (v) => v) => {
    if (!field) return;
    const apply = () => {
      store.state.sale[key] = transform(field.value);
      store.persistCart();
      refreshTotals();
    };
    field.addEventListener('input', apply);
    field.addEventListener('change', apply);
  };

  onField(body.querySelector('.cartName'), 'customer_name');
  onField(body.querySelector('.cartPhone'), 'customer_phone', (v) => v.trim());
  onField(body.querySelector('.cartMember'), 'dxn_member_id', (v) => v.trim().toUpperCase());
  onField(body.querySelector('.cartPayment'), 'payment_method');
  onField(body.querySelector('.cartNote'), 'note');
  onField(body.querySelector('.cartDiscount'), 'discount', (v) => Math.max(0, num(v)));

  body.querySelector('[data-fill-walkin]')?.addEventListener('click', () => {
    store.state.sale.customer_name = 'Walk-in customer';
    store.state.sale.customer_phone = '';
    store.state.sale.dxn_member_id = '';
    store.persistCart();
    const input = body.querySelector('.cartName');
    if (input) input.value = 'Walk-in customer';
    const phone = body.querySelector('.cartPhone');
    if (phone) phone.value = '';
    const member = body.querySelector('.cartMember');
    if (member) member.value = '';
  });
}

function bindFoot(foot) {
  foot.querySelector('[data-checkout]')?.addEventListener('click', () => checkout(foot));
  foot.querySelector('[data-clear]')?.addEventListener('click', () => {
    store.clearCart();
    toast('Cart cleared.');
  });
  foot.querySelector('[data-hold]')?.addEventListener('click', () => openHoldPrompt());
  foot.querySelector('[data-held]')?.addEventListener('click', () => openHeldSales());
  foot.querySelector('[data-close-cart]')?.addEventListener('click', () => closeCart());
  foot.querySelector('[data-quote]')?.addEventListener('click', () => {
    const totals = store.cartTotals();
    if (!totals.lines.length) return;
    const currency = store.currency();
    const lines = [
      `*${store.state.settings.branch_name || 'Mohammadpur Stock Point'}* — quotation`,
      '',
      ...totals.lines.map((l) => `• ${l.product.name} × ${int(l.qty)} — ${money(l.lineTotal, currency)}`),
      '',
      `*Total: ${money(totals.total, currency)}*`,
      `PV: ${round2(totals.pv).toFixed(2)}`,
    ];
    window.open(waLink(store.state.settings.whatsapp_number, lines.join('\n')), '_blank', 'noopener');
  });
}

// ── Checkout ────────────────────────────────────────────────────────────────

async function checkout(originFoot) {
  const totals = store.cartTotals();
  if (!totals.lines.length) {
    toast('The cart is empty.', 'error');
    return;
  }

  // Fail fast with a friendly message; the server enforces the same rule.
  const short = totals.lines.find((line) => line.qty > line.available);
  if (short) {
    toast(`Not enough stock for ${short.product.name} (${short.available} left).`, 'error');
    return;
  }

  const button = originFoot?.querySelector('[data-checkout]');
  button?.setAttribute('disabled', '');
  if (button) button.innerHTML = '<span class="spinner"></span> Saving…';

  const result = store.enqueueOrder();
  button?.removeAttribute('disabled');

  if (!result.ok) {
    if (button) button.innerHTML = `${icon('check', 16)} Save sale`;
    toast(result.message, 'error');
    return;
  }

  if (button) button.innerHTML = `${icon('check', 16)} Save sale`;
  const item = store.state.outbox[store.state.outbox.length - 1];
  closeCart();
  toast(hasBase() ? 'Sale saved — syncing to every device.' : 'Sale saved on this device.', 'ok');
  openSaleSlip(item);
}

function openHoldPrompt() {
  if (!store.state.cart.length) {
    toast('The cart is empty.', 'error');
    return;
  }
  const totals = store.cartTotals();
  openModal({
    title: 'Hold this sale',
    body: `
      <p style="font-size:13.5px;color:var(--muted);line-height:1.65">
        Park ${int(totals.units)} item(s) worth <strong>${money(totals.total, store.currency())}</strong> and free the
        till for the next customer. You can resume it any time from <strong>Held sales</strong>.
      </p>
      <label class="field mt-2" style="margin-bottom:0"><span>Name this held sale (optional)</span>
        <input class="input" data-hold-label placeholder="e.g. Rahim — couple packs" maxlength="60"></label>
    `,
    footer: `
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <button class="btn btn--primary" type="button" data-hold-go>${icon('clock', 16)} Hold sale</button>
    `,
    onMount(panel, close) {
      panel.querySelector('[data-hold-go]')?.addEventListener('click', () => {
        const label = panel.querySelector('[data-hold-label]')?.value || '';
        const result = store.holdSale(label);
        if (!result.ok) {
          toast(result.message, 'error');
          return;
        }
        close();
        toast('Sale parked — the cart is free again.', 'ok');
      });
    },
  });
}

export function openHeldSales() {
  const held = store.state.held;
  const currency = store.currency();
  openModal({
    title: `Held sales (${held.length})`,
    body: held.length ? `
      <div class="list">
        ${held.map((item) => `
          <div class="list__row">
            <div class="list__main">
              <div class="list__title">${esc(item.label)}</div>
              <div class="list__sub">
                ${int((item.cart || []).reduce((sum, l) => sum + l.qty, 0))} item(s) ·
                ${money(item.totals?.total ?? 0, currency)} ·
                ${new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <button class="btn btn--sm btn--primary" type="button" data-resume="${esc(item.id)}">Resume</button>
            <button class="btn btn--sm btn--ghost" type="button" data-drop-held="${esc(item.id)}" aria-label="Discard">
              ${icon('trash', 14)}
            </button>
          </div>
        `).join('')}
      </div>
    ` : emptyState('Nothing parked', 'Use Hold in the cart to park a sale mid-transaction.', 'clock'),
    footer: `<button class="btn btn--ghost" type="button" data-close>Close</button>`,
    onMount(panel, close) {
      panel.querySelectorAll('[data-resume]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const result = store.resumeHeld(btn.dataset.resume);
          if (!result.ok) {
            toast(result.message, 'error');
            return;
          }
          close();
          toast('Sale restored to the cart.', 'ok');
        });
      });
      panel.querySelectorAll('[data-drop-held]').forEach((btn) => {
        btn.addEventListener('click', () => {
          store.deleteHeld(btn.dataset.dropHeld);
          toast('Held sale discarded.');
          close();
          setTimeout(openHeldSales, 60);
        });
      });
    },
  });
}

/** Receipt preview for a sale that may still be in the outbox. */
export function openSaleSlip(item) {
  if (!item) return;
  const payload = item.payload;
  const currency = store.currency();
  const itemsSubtotal = payload.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const order = {
    order_number: 'PENDING',
    created_at: new Date(item.createdAt || Date.now()).toISOString(),
    customer_name: payload.customer_name,
    dxn_member_id: payload.dxn_member_id,
    payment_method: payload.payment_method,
    subtotal: itemsSubtotal,
    discount: payload.discount,
    total_amount: itemsSubtotal - num(payload.discount),
    total_pv: payload.items.reduce((sum, i) => sum + i.unit_pv * i.quantity, 0),
    items: payload.items.map((i) => {
      const product = store.productById(i.product_id);
      return {
        name: product?.name || `Product ${i.product_id}`,
        quantity: i.quantity,
        unit_price: i.unit_price,
        line_total: i.unit_price * i.quantity,
      };
    }),
  };

  const text = receiptText(order, store.state.settings);

  openModal({
    title: 'Sale saved',
    body: `
      <div style="background:var(--surface-2);padding:14px;border-radius:14px">
        <pre class="receipt" style="border-style:solid">${esc(text)}</pre>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:14px;text-align:center">
        ${hasBase()
          ? 'Queued for sync. The order number appears in Orders once the server confirms it.'
          : 'Stored on this device. Connect the shop server in Settings to share it with every other device.'}
      </p>
      <p style="font-size:12px;color:var(--muted);text-align:center">
        ${int(payload.items.length)} line(s) · ${money(order.total_amount, currency)} · PV ${order.total_pv.toFixed(2)}
      </p>
    `,
    footer: `
      <button class="btn btn--ghost" type="button" data-close>Done</button>
      <button class="btn btn--ghost" type="button" data-slip-print>${icon('print', 16)} Print</button>
      <button class="btn btn--wa" type="button" data-slip-wa>${icon('whatsapp', 16)} WhatsApp</button>
    `,
    onMount(panel) {
      panel.querySelector('[data-slip-print]')?.addEventListener('click', () => {
        printReceipt(`<pre class="receipt">${esc(text)}</pre>`);
      });
      panel.querySelector('[data-slip-wa]')?.addEventListener('click', () => {
        const phone = digits(payload.customer_phone) || store.state.settings.whatsapp_number;
        window.open(waLink(phone, orderMessage(order, store.state.settings)), '_blank', 'noopener');
      });
    },
  });
}

// ── Drawer plumbing ─────────────────────────────────────────────────────────

export function openCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('overlay');
  if (!drawer) return;
  renderCartDrawer();
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }
  document.body.style.overflow = 'hidden';
}

export function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('overlay');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  if (overlay && !drawer.classList.contains('is-open')) {
    overlay.classList.remove('is-open');
    setTimeout(() => { overlay.hidden = true; }, 220);
  }
  document.body.style.overflow = '';
}

export function isCartOpen() {
  return document.getElementById('cartDrawer')?.classList.contains('is-open') || false;
}
