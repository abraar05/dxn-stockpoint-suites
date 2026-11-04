/**
 * REST surface shared by the web app, the Android client and anything else that
 * speaks the Stockpoint v1 contract.
 */

import { ApiError, clean, int, money, nowIso } from './util.js';

const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, payload = {}, status = 200) {
  send(res, status, { success: true, ...payload });
}

function fail(res, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'server_error';
  const message = error instanceof ApiError ? error.message : 'The shop server hit an unexpected error.';
  if (!(error instanceof ApiError)) console.error(error);
  send(res, status, {
    success: false,
    message,
    error: { code, message, details: error?.details ?? null },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError('Request body is too large', 413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError('Request body must be valid JSON', 400, 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requestAuth(req, url, db) {
  const token = bearer(req) || clean(req.headers['x-api-key'], 200) || clean(url.searchParams.get('api_key'), 200);
  if (!token) return { isAdmin: false, token: '' };
  if (db.isAdminKey(token)) return { isAdmin: true, token, viaKey: true };
  const session = db.verifyToken(token);
  return { isAdmin: Boolean(session), token, viaKey: false };
}

function requireAdmin(auth) {
  if (!auth.isAdmin) throw new ApiError('Sign in with the shop PIN to do that', 401, 'unauthorized');
}

function receiptText(db, order) {
  const settings = db.publicSettings();
  const currency = settings.currency || 'BDT';
  const sep = '-'.repeat(32);
  const lines = [];
  lines.push(String(settings.branch_name || 'Mohammadpur Stock Point').toUpperCase());
  if (settings.business_address) lines.push(String(settings.business_address));
  if (settings.business_phone) lines.push(`Tel: ${settings.business_phone}`);
  lines.push(sep);
  lines.push(`Order   : ${order.order_number}`);
  lines.push(`Date    : ${order.created_at}`);
  lines.push(`Customer: ${order.customer_name}`);
  if (order.dxn_member_id) lines.push(`Member  : ${order.dxn_member_id}`);
  lines.push(`Payment : ${order.payment_method}`);
  lines.push(sep);
  for (const item of order.items || []) {
    lines.push(`${String(item.name).slice(0, 22).padEnd(22)} x${item.quantity}`);
    lines.push(`  @ ${Number(item.unit_price).toFixed(2)} = ${Number(item.line_total).toFixed(2)}`);
  }
  lines.push(sep);
  if (money(order.discount) > 0) {
    lines.push(`Subtotal: ${Number(order.subtotal).toFixed(2)}`);
    lines.push(`Discount: -${Number(order.discount).toFixed(2)}`);
  }
  lines.push(`TOTAL   : ${Number(order.total_amount).toFixed(2)} ${currency}`);
  lines.push(`PV      : ${Number(order.total_pv).toFixed(2)}`);
  lines.push(sep);
  if (settings.receipt_footer) lines.push(String(settings.receipt_footer));
  return lines.join('\n');
}

export function createApi({ db }) {
  return async function handleApi(req, res, url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = url.pathname.replace(/\/+$/, '') || '/api/v1';
    const auth = requestAuth(req, url, db);
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};

    try {
      // ── Service ───────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/health') {
        ok(res, db.health());
        return;
      }
      if (req.method === 'GET' && path === '/api/v1/config') {
        ok(res, db.config());
        return;
      }
      if (req.method === 'GET' && path === '/api/v1') {
        ok(res, {
          name: 'Mohammadpur Stock Point API',
          version: '3.0.0',
          endpoints: ['/health', '/config', '/products', '/orders', '/sync', '/dashboard', '/reports/sales'],
        });
        return;
      }

      // ── Auth ──────────────────────────────────────────────────────────────
      if (req.method === 'POST' && path === '/api/v1/auth/login') {
        const pin = clean(body.pin, 32);
        const result = db.login(pin);
        ok(res, result);
        return;
      }
      if (req.method === 'GET' && path === '/api/v1/auth/me') {
        requireAdmin(auth);
        ok(res, { role: 'admin', scope: 'admin' });
        return;
      }
      if (req.method === 'POST' && path === '/api/v1/auth/pin') {
        requireAdmin(auth);
        db.changePin(clean(body.new_pin, 32));
        ok(res, { message: 'PIN updated. Existing sessions stay valid until they expire.' });
        return;
      }
      if (req.method === 'POST' && path === '/api/v1/auth/logout') {
        db.logout(auth.token);
        ok(res, { message: 'Signed out' });
        return;
      }

      // ── Catalogue ─────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/products') {
        const includeInactive = url.searchParams.get('include_inactive') === '1' && auth.isAdmin;
        const products = db.products(includeInactive);
        ok(res, {
          products,
          categories: [...new Set(products.map((product) => product.category))],
          count: products.length,
        });
        return;
      }
      if (req.method === 'POST' && path === '/api/v1/products') {
        requireAdmin(auth);
        const product = db.createProduct(body);
        ok(res, { message: 'Product created', product }, 201);
        return;
      }

      const productMatch = path.match(/^\/api\/v1\/products\/(\d+)$/);
      if (productMatch) {
        const id = int(productMatch[1]);
        if (req.method === 'GET') {
          const product = db.product(id);
          if (!product) throw new ApiError('Product not found', 404, 'not_found');
          ok(res, { product });
          return;
        }
        requireAdmin(auth);
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const product = db.updateProduct(id, body);
          ok(res, { message: 'Product updated', product });
          return;
        }
        if (req.method === 'DELETE') {
          db.archiveProduct(id);
          ok(res, { message: 'Product archived' });
          return;
        }
      }

      const restoreMatch = path.match(/^\/api\/v1\/products\/(\d+)\/restore$/);
      if (restoreMatch && req.method === 'POST') {
        requireAdmin(auth);
        const product = db.restoreProduct(int(restoreMatch[1]));
        ok(res, { message: 'Product restored', product });
        return;
      }

      // ── Stock ─────────────────────────────────────────────────────────────
      if (req.method === 'POST' && path === '/api/v1/stock/update') {
        requireAdmin(auth);
        const productId = int(body.productId ?? body.product_id);
        const newQuantity = int(body.newQuantity ?? body.new_quantity, -1);
        if (productId <= 0 || newQuantity < 0) {
          throw new ApiError('productId and a non-negative newQuantity are required', 422, 'validation_error');
        }
        const product = db.product(productId);
        if (!product) throw new ApiError('Product not found', 404, 'not_found');
        const delta = newQuantity - product.stock_qty;
        const after = db.applyStockDelta(productId, delta, clean(body.reason || 'stock_take', 64));
        db.audit('stock_set', 'product', productId, `${product.stock_qty} -> ${newQuantity}`);
        db.save();
        ok(res, { message: 'Stock updated', product: db.product(productId), stock_qty: after });
        return;
      }
      if (req.method === 'POST' && path === '/api/v1/stock/adjust') {
        requireAdmin(auth);
        const productId = int(body.productId ?? body.product_id);
        const delta = int(body.delta ?? body.change);
        if (productId <= 0 || delta === 0) {
          throw new ApiError('productId and a non-zero delta are required', 422, 'validation_error');
        }
        const after = db.applyStockDelta(productId, delta, clean(body.reason || 'adjustment', 64));
        db.audit('stock_adjust', 'product', productId, String(delta));
        db.save();
        ok(res, { message: 'Stock adjusted', product: db.product(productId), stock_qty: after });
        return;
      }
      if (req.method === 'GET' && path === '/api/v1/stock/movements') {
        requireAdmin(auth);
        ok(res, { movements: db.movements(url.searchParams.get('limit') || 100) });
        return;
      }

      // ── Orders ────────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/orders') {
        requireAdmin(auth);
        const orders = db.orders({
          limit: url.searchParams.get('limit') || 100,
          status: clean(url.searchParams.get('status'), 24),
          q: clean(url.searchParams.get('q'), 120),
          from: clean(url.searchParams.get('from'), 12),
          to: clean(url.searchParams.get('to'), 12),
        });
        ok(res, { orders, count: orders.length });
        return;
      }
      if (req.method === 'POST' && path === '/api/v1/orders') {
        const result = db.createOrder(body, { isAdmin: auth.isAdmin });
        ok(res, { order: result.order, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
        return;
      }

      const orderMatch = path.match(/^\/api\/v1\/orders\/(\d+)$/);
      if (orderMatch && req.method === 'GET') {
        requireAdmin(auth);
        const order = db.order(int(orderMatch[1]));
        if (!order) throw new ApiError('Order not found', 404, 'not_found');
        ok(res, { order });
        return;
      }

      const statusMatch = path.match(/^\/api\/v1\/orders\/(\d+)\/status$/);
      if (statusMatch && req.method === 'POST') {
        requireAdmin(auth);
        const order = db.updateOrderStatus(int(statusMatch[1]), body.status);
        ok(res, { message: 'Order status updated', order });
        return;
      }

      const markPaidMatch = path.match(/^\/api\/v1\/orders\/(\d+)\/mark-paid$/);
      if (markPaidMatch && req.method === 'POST') {
        requireAdmin(auth);
        const order = db.markPaid(int(markPaidMatch[1]));
        ok(res, { message: 'Payment confirmed', order });
        return;
      }

      const receiptMatch = path.match(/^\/api\/v1\/orders\/(\d+)\/receipt$/);
      if (receiptMatch && req.method === 'GET') {
        requireAdmin(auth);
        const order = db.order(int(receiptMatch[1]));
        if (!order) throw new ApiError('Order not found', 404, 'not_found');
        ok(res, { receipt: receiptText(db, order), order });
        return;
      }

      // ── Customers ─────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/customers') {
        requireAdmin(auth);
        const customers = db.customers(clean(url.searchParams.get('q'), 120));
        ok(res, { customers, count: customers.length });
        return;
      }
      const customerMatch = path.match(/^\/api\/v1\/customers\/(\d+)$/);
      if (customerMatch && req.method === 'GET') {
        requireAdmin(auth);
        const customer = db.customer(int(customerMatch[1]));
        if (!customer) throw new ApiError('Customer not found', 404, 'not_found');
        const orders = db.orders({ limit: 500 }).filter((order) => int(order.customer_id) === customer.id);
        ok(res, { customer, orders });
        return;
      }

      // ── Reports ───────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/dashboard') {
        requireAdmin(auth);
        ok(res, { data: db.dashboard() });
        return;
      }
      if (req.method === 'GET' && path === '/api/v1/reports/sales') {
        requireAdmin(auth);
        ok(res, db.salesReport(
          clean(url.searchParams.get('from'), 12),
          clean(url.searchParams.get('to'), 12),
        ));
        return;
      }

      // ── Settings ──────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/settings') {
        if (!auth.isAdmin) {
          ok(res, { settings: db.publicSettings() });
          return;
        }
        ok(res, {
          settings: { ...db.settings(), ...db.publicSettings() },
          public: db.publicSettings(),
          rev: db.currentRev(),
        });
        return;
      }
      if ((req.method === 'PUT' || req.method === 'PATCH') && path === '/api/v1/settings') {
        requireAdmin(auth);
        const result = db.saveSettings(body);
        ok(res, { message: 'Settings saved', ...result });
        return;
      }

      // ── Sync ──────────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/v1/sync') {
        const since = Math.max(0, int(url.searchParams.get('since')));
        ok(res, db.sync(since, auth.isAdmin));
        return;
      }
      if (req.method === 'GET' && path === '/api/v1/sync/status') {
        ok(res, {
          server_rev: db.currentRev(),
          server_time: nowIso(),
          scope: auth.isAdmin ? 'admin' : 'public',
        });
        return;
      }

      // ── Courier ───────────────────────────────────────────────────────────
      if (path === '/api/v1/courier/settings') {
        requireAdmin(auth);
        if (req.method === 'GET') {
          ok(res, { settings: db.courierSettings() });
          return;
        }
        if (req.method === 'PUT' || req.method === 'PATCH') {
          ok(res, { message: 'Courier settings saved', settings: db.saveCourierSettings(body) });
          return;
        }
      }
      if (req.method === 'GET' && path === '/api/v1/courier/balance') {
        requireAdmin(auth);
        if (!db.setting('steadfast_api_key', '')) {
          throw new ApiError('Add your SteadFast API key first', 422, 'courier_not_configured');
        }
        ok(res, { balance: { current_balance: 0 }, note: 'Live SteadFast calls run on the PHP API deployment.' });
        return;
      }
      if (path.startsWith('/api/v1/courier/') && req.method === 'POST') {
        requireAdmin(auth);
        throw new ApiError(
          'SteadFast shipment actions are available when the app is connected to the PHP API. The local server keeps your catalogue and orders safe offline.',
          501,
          'courier_unavailable',
        );
      }
      if (req.method === 'GET' && path === '/api/v1/courier/returns') {
        requireAdmin(auth);
        ok(res, { returns: [] });
        return;
      }

      // ── Local demo helpers ────────────────────────────────────────────────
      if (req.method === 'POST' && path === '/api/v1/demo/seed') {
        requireAdmin(auth);
        const result = db.seedDemoOrders();
        ok(res, { message: 'Demo sales created', ...result });
        return;
      }

      throw new ApiError(`No route for ${req.method} ${path}`, 404, 'not_found');
    } catch (error) {
      fail(res, error);
    }
  };
}
