/**
 * Customer account: sign-in / sign-up, profile, order history, tracking.
 * Transforms the POS into an ecommerce storefront for customers.
 */

import { esc, money, num, int, relTime, digits, toDate } from '../util.js';
import { icon, emptyState, openModal, closeModal, toast, statusBadge, hydrateIcons } from '../ui.js';
import api, { hasBase, ApiError } from '../api.js';
import * as store from '../store.js';

export function openCustomerAuth(mode = 'login') {
  openModal({
    title: mode === 'register' ? 'Create your account' : 'Sign in',
    body: `
      <form id="custAuthForm" autocomplete="off">
        <label class="field"><span>Phone number</span>
          <input class="input" id="custPhone" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required maxlength="40"></label>
        ${mode === 'register' ? `
          <label class="field"><span>Full name</span>
            <input class="input" id="custName" autocomplete="name" placeholder="Your name" maxlength="160"></label>
          <label class="field"><span>Email (optional)</span>
            <input class="input" id="custEmail" type="email" autocomplete="email" placeholder="you@example.com" maxlength="120"></label>
        ` : ''}
        <label class="field"><span>Password</span>
          <input class="input" id="custPass" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="At least 6 characters" required minlength="6"></label>
        <p style="font-size:12px;color:var(--muted);text-align:center;margin-top:8px">
          ${mode === 'register' ? 'Create an account to track orders and checkout faster.' : 'Sign in to view your orders and profile.'}
        </p>
      </form>
    `,
    footer: `
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <button class="btn btn--primary" type="submit" form="custAuthForm" id="custAuthBtn">
        ${icon(mode === 'register' ? 'userPlus' : 'user', 16)} ${mode === 'register' ? 'Create account' : 'Sign in'}
      </button>
    `,
    onMount(panel) {
      hydrateIcons(panel);
      const form = panel.querySelector('#custAuthForm');
      const button = panel.querySelector('#custAuthBtn');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const phone = panel.querySelector('#custPhone').value.trim();
        const password = panel.querySelector('#custPass').value;
        if (!phone || !password) return;
        button.disabled = true;
        button.innerHTML = '<span class="spinner"></span> Please wait…';
        try {
          let result;
          if (mode === 'register') {
            const name = panel.querySelector('#custName').value.trim();
            const email = panel.querySelector('#custEmail').value.trim();
            result = await api.registerCustomer({ phone, password, name, email });
            toast('Account created — welcome!', 'ok');
          } else {
            result = await api.customerLogin(phone, password);
            toast(`Welcome back${result.customer?.name ? ', ' + result.customer.name : ''}.`, 'ok');
          }
          store.setCustomer(true, result.customer || null);
          if (result.customer) store.state.customer = result.customer;
          closeModal();
          location.hash = '#/account';
        } catch (error) {
          const msg = error instanceof ApiError ? error.message : 'Could not sign in.';
          toast(msg, 'error');
          button.disabled = false;
          button.innerHTML = `${icon(mode === 'register' ? 'userPlus' : 'user', 16)} ${mode === 'register' ? 'Create account' : 'Sign in'}`;
        }
      });
      // toggle link
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn btn--ghost btn--sm';
      toggle.style.marginTop = '8px';
      toggle.textContent = mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account';
      toggle.addEventListener('click', () => {
        closeModal();
        setTimeout(() => openCustomerAuth(mode === 'register' ? 'login' : 'register'), 80);
      });
      panel.querySelector('form')?.after(toggle);
    },
  });
}

export function renderAccount(root) {
  const customer = store.state.customer;
  if (!store.state.isCustomer || !customer) {
    root.innerHTML = `
      <div class="card card--pad" style="max-width:520px;margin:40px auto;text-align:center">
        <div style="display:grid;place-items:center;margin-bottom:12px;color:var(--primary)">${icon('user', 34)}</div>
        <h2 style="font-family:var(--font-display);font-size:18px;font-weight:700;margin-bottom:6px">Your account</h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
          Sign in or create an account to view your orders, track deliveries and checkout faster.
        </p>
        <div style="display:grid;gap:10px">
          <button class="btn btn--primary btn--block" type="button" data-signin>${icon('user', 16)} Sign in</button>
          <button class="btn btn--ghost btn--block" type="button" data-register>${icon('userPlus', 16)} Create account</button>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:14px">
          Or <a href="#/track" style="color:var(--primary);font-weight:700">track an order</a> with your order number and phone.
        </p>
      </div>
    `;
    hydrateIcons(root);
    root.querySelector('[data-signin]')?.addEventListener('click', () => openCustomerAuth('login'));
    root.querySelector('[data-register]')?.addEventListener('click', () => openCustomerAuth('register'));
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>My account</h2>
        <p>Welcome back, ${esc(customer.name)}.</p>
      </div>
      <div class="section-head__actions">
        <button class="btn btn--ghost" type="button" id="custSignOut">${icon('logout', 16)} Sign out</button>
      </div>
    </div>

    <div class="split">
      <div class="card card--pad">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">Profile</h2></div>
        </div>
        <label class="field"><span>Name</span>
          <input class="input" id="accName" value="${esc(customer.name)}" maxlength="160"></label>
        <label class="field"><span>Phone</span>
          <input class="input" value="${esc(customer.phone || '')}" disabled></label>
        <label class="field"><span>DXN member ID</span>
          <input class="input" id="accMember" value="${esc(customer.dxn_member_id || '')}" placeholder="Optional" maxlength="40"></label>
        <label class="field"><span>Email</span>
          <input class="input" id="accEmail" type="email" value="${esc(store.state.customer?.email || '')}" placeholder="you@example.com" maxlength="120"></label>
        <button class="btn btn--primary" type="button" id="accSave">${icon('check', 16)} Save profile</button>
      </div>

      <div class="card card--pad">
        <div class="section-head" style="margin-bottom:10px">
          <div><h2 style="font-size:16px">My orders</h2><p>Your recent purchases and their status.</p></div>
          <button class="btn btn--sm btn--ghost" type="button" id="accRefresh">${icon('refresh', 14)} Refresh</button>
        </div>
        <div id="accOrders"><p style="font-size:12.5px;color:var(--muted)">Loading…</p></div>
      </div>
    </div>
  `;

  hydrateIcons(root);
  root.querySelector('#custSignOut')?.addEventListener('click', () => {
    store.setCustomer(false);
    toast('Signed out.');
    location.hash = '#/dashboard';
  });

  const loadOrders = async () => {
    const target = root.querySelector('#accOrders');
    if (!target) return;
    try {
      const result = await api.myOrders();
      const orders = result?.orders || [];
      if (!orders.length) {
        target.innerHTML = emptyState('No orders yet', 'Your purchases will appear here once you place one.', 'receipt');
        return;
      }
      target.innerHTML = `
        <div class="list">
          ${orders.map((o) => `
            <div class="list__row" style="cursor:pointer" data-track="${esc(o.order_number)}">
              <div class="list__main">
                <div class="list__title">${esc(o.order_number)}</div>
                <div class="list__sub">${relTime(o.created_at)} · ${int((o.items||[]).reduce((s,i)=>s+num(i.quantity),0))} unit(s) · ${money(o.total_amount, store.currency())}</div>
              </div>
              ${statusBadge(o.status)}
            </div>
          `).join('')}
        </div>
      `;
      target.querySelectorAll('[data-track]').forEach((row) => {
        row.addEventListener('click', () => {
          location.hash = `#/track?order=${encodeURIComponent(row.dataset.track)}&phone=${encodeURIComponent(customer.phone || '')}`;
        });
      });
    } catch (error) {
      target.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">${esc(error.message || 'Could not load orders.')}</p>`;
    }
  };

  root.querySelector('#accSave')?.addEventListener('click', async () => {
    const btn = root.querySelector('#accSave');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const profile = await api.updateMyProfile({
        name: root.querySelector('#accName').value.trim(),
        dxn_member_id: root.querySelector('#accMember').value.trim(),
        email: root.querySelector('#accEmail').value.trim(),
      });
      store.state.customer = { ...store.state.customer, ...profile };
      toast('Profile saved.', 'ok');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save profile.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });

  root.querySelector('#accRefresh')?.addEventListener('click', loadOrders);
  loadOrders();
}

export function renderTrack(root) {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const orderNumber = params.get('order') || '';
  const phone = params.get('phone') || '';

  root.innerHTML = `
    <div class="section-head">
      <div><h2>Track your order</h2><p>Enter your order number and phone to see live status.</p></div>
    </div>

    <div class="card card--pad" style="max-width:560px">
      <div class="form-2">
        <label class="field"><span>Order number</span>
          <input class="input" id="trackOrder" value="${esc(orderNumber)}" placeholder="MSP-261104-0001" maxlength="40"></label>
        <label class="field"><span>Phone number</span>
          <input class="input" id="trackPhone" value="${esc(phone)}" placeholder="01XXXXXXXXX" maxlength="40"></label>
      </div>
      <button class="btn btn--primary btn--block" type="button" id="trackBtn">${icon('search', 16)} Track order</button>
      <div id="trackResult" style="margin-top:18px"></div>
    </div>
  `;

  hydrateIcons(root);

  const run = async () => {
    const on = root.querySelector('#trackOrder').value.trim();
    const ph = root.querySelector('#trackPhone').value.trim();
    const target = root.querySelector('#trackResult');
    if (!on || !ph) { toast('Order number and phone are required.', 'error'); return; }
    target.innerHTML = '<p style="font-size:12.5px;color:var(--muted)"><span class="spinner"></span> Looking up…</p>';
    try {
      const result = await api.trackOrder(on, ph);
      const order = result.order;
      const steps = ['CONFIRMED', 'PAID', 'PACKED', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
      const current = (order.status || '').toUpperCase();
      const cancelled = current === 'CANCELLED';
      target.innerHTML = `
        <div class="card card--pad" style="background:var(--surface-2)">
          <div class="row mb-2" style="justify-content:space-between;align-items:center">
            <strong>${esc(order.order_number)}</strong>
            ${statusBadge(order.status)}
          </div>
          <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
            ${esc(order.customer_name)} · ${money(order.total_amount, store.currency())} · ${int((order.items||[]).reduce((s,i)=>s+num(i.quantity),0))} unit(s)
          </p>
          ${cancelled ? `<p style="color:var(--danger);font-weight:700">This order was cancelled.</p>` : `
            <div class="list">
              ${steps.map((step, i) => {
                const done = steps.indexOf(current) >= i || current === 'DELIVERED';
                const active = current === step;
                return `
                  <div class="list__row" style="opacity:${done ? 1 : 0.45}">
                    <span class="badge ${done ? 'badge--ok' : 'badge--muted'}">${done ? '✓' : i + 1}</span>
                    <div class="list__main">
                      <div class="list__title" style="${active ? 'font-weight:800;color:var(--primary)' : ''}">${step.replace(/_/g, ' ')}</div>
                      ${active ? '<div class="list__sub">Current status</div>' : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
          ${order.courier_tracking_code ? `
            <p style="font-size:12.5px;color:var(--muted);margin-top:12px">
              Courier: ${esc(order.courier_provider || 'SteadFast')} · tracking <span class="mono">${esc(order.courier_tracking_code)}</span> · ${esc(order.courier_status || '')}
            </p>
          ` : ''}
          <p style="font-size:11.5px;color:var(--faint);margin-top:10px">Last updated ${relTime(order.updated_at || order.created_at)}</p>
        </div>
      `;
    } catch (error) {
      target.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">${esc(error.message || 'Order not found.')}</p>`;
    }
  };

  root.querySelector('#trackBtn')?.addEventListener('click', run);
  if (orderNumber && phone) run();
}