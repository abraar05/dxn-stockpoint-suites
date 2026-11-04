/**
 * API smoke tests: boots the zero-dependency server in-process on an ephemeral
 * port and exercises the contract the web app and the Android app depend on.
 *
 * Run: npm test  (or: node --test tests/api.test.mjs)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { Database } from '../server/lib/db.js';
import { createApi } from '../server/lib/api.js';

/** Boots a fresh server instance on a random port with an empty data dir. */
async function bootServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpoint-test-'));
  const db = new Database({ dataDir, pin: '2468', adminKey: 'test-admin-key' });
  const handle = createApi({ db });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    handle(req, res, url).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { message: error.message, code: 'internal' } }));
    });
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();

  const call = async (method, target, { body, token, adminKey } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${target}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(adminKey ? { 'X-Api-Key': adminKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  };

  return { db, server, call, dataDir, port };
}

let ctx;
test.before(async () => {
  ctx = await bootServer();
});
test.after(async () => {
  ctx.server.close();
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

let adminToken = '';

test('health: version, products and revision', async () => {
  const { status, body } = await ctx.call('GET', '/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'ok');
  assert.ok(body.database.counts.products > 0);
  assert.ok(body.server_rev >= 0);
});

test('login: correct PIN issues a token, wrong PIN is rejected', async () => {
  const good = await ctx.call('POST', '/api/v1/auth/login', { body: { pin: '2468' } });
  assert.equal(good.status, 200);
  assert.ok(good.body.token);
  adminToken = good.body.token;

  const bad = await ctx.call('POST', '/api/v1/auth/login', { body: { pin: '0000' } });
  assert.equal(bad.status, 401);
});

test('products: public list without auth', async () => {
  const { status, body } = await ctx.call('GET', '/api/v1/products');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.products));
  const product = body.products[0];
  for (const field of ['id', 'sku', 'name', 'retail_price', 'member_price', 'stock_qty', 'rev']) {
    assert.ok(field in product, `missing field ${field}`);
  }
});

test('order create: totals, stock decrement and MSP order number', async () => {
  const list = await ctx.call('GET', '/api/v1/products');
  const product = list.body.products.find((p) => p.stock_qty >= 10);
  assert.ok(product, 'seed should include a stocked product');

  const before = product.stock_qty;
  const uuid = `test-order-${crypto.randomUUID()}`;
  const { status, body } = await ctx.call('POST', '/api/v1/orders', {
    body: {
      client_uuid: uuid,
      customer_name: 'Test Customer',
      customer_phone: '01911111111',
      payment_method: 'CASH',
      items: [{ product_id: product.id, quantity: 2, unit_price: product.retail_price, unit_pv: product.pv_points }],
      source: 'test',
    },
  });

  assert.equal(status, 201);
  assert.equal(body.success, true);
  const order = body.order;
  assert.ok(/^MSP-\d{6}-\d{4}$/.test(order.order_number), `unexpected order_number ${order.order_number}`);
  assert.ok(Math.abs(order.total_amount - product.retail_price * 2) < 0.01);
  assert.ok(order.items[0].line_total > 0);

  const after = await ctx.call('GET', `/api/v1/products/${product.id}`);
  assert.equal(after.body.product.stock_qty, before - 2, 'stock should decrement by the quantity sold');
});

test('orders idempotency: same client_uuid returns the same order', async () => {
  const list = await ctx.call('GET', '/api/v1/products');
  const product = list.body.products[0];
  const uuid = `dup-${crypto.randomUUID()}`;
  const payload = {
    client_uuid: uuid,
    customer_name: 'Dup Test',
    items: [{ product_id: product.id, quantity: 1, unit_price: product.retail_price, unit_pv: product.pv_points }],
  };

  const first = await ctx.call('POST', '/api/v1/orders', { body: payload });
  assert.equal(first.status, 201);
  const beforeCount = (await ctx.call('GET', '/api/v1/orders', { token: adminToken })).body.orders.length;

  const second = await ctx.call('POST', '/api/v1/orders', { body: payload });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.order.id, first.body.order.id);

  const afterCount = (await ctx.call('GET', '/api/v1/orders', { token: adminToken })).body.orders.length;
  assert.equal(afterCount, beforeCount, 'no extra order row should be created');
});

test('oversell: rejected without the flag, allowed with it', async () => {
  const list = await ctx.call('GET', '/api/v1/products');
  const product = list.body.products.find((p) => p.stock_qty > 0 && p.stock_qty < 100);
  assert.ok(product);

  const rejected = await ctx.call('POST', '/api/v1/orders', {
    body: {
      client_uuid: `over-${crypto.randomUUID()}`,
      customer_name: 'Oversell Reject',
      items: [{ product_id: product.id, quantity: product.stock_qty + 999, unit_price: product.retail_price, unit_pv: product.pv_points }],
    },
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.success, false);
  assert.equal(rejected.body.error.code, 'insufficient_stock');

  const allowed = await ctx.call('POST', '/api/v1/orders', {
    body: {
      client_uuid: `over-ok-${crypto.randomUUID()}`,
      customer_name: 'Oversell Allow',
      allow_oversell: 1,
      items: [{ product_id: product.id, quantity: product.stock_qty + 999, unit_price: product.retail_price, unit_pv: product.pv_points }],
    },
  });
  assert.equal(allowed.status, 201);

  const after = await ctx.call('GET', `/api/v1/products/${product.id}`);
  assert.equal(after.body.product.stock_qty, product.stock_qty - (product.stock_qty + 999), 'stock may go negative when oversell is granted');
});

test('sync: admin pushes products, orders, settings and server_rev', async () => {
  const anonymous = await ctx.call('GET', '/api/v1/sync?since=0');
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.scope, 'public');
  assert.ok(Array.isArray(anonymous.body.products));

  const { status, body } = await ctx.call('GET', '/api/v1/sync?since=0', { token: adminToken });
  assert.equal(status, 200);
  assert.equal(body.scope, 'admin');
  assert.ok(Array.isArray(body.products));
  assert.ok(Array.isArray(body.orders));
  assert.ok(body.settings?.branch_name);
  assert.ok(body.server_rev >= 0);
  assert.ok(typeof body.truncated === 'boolean');
});

test('dashboard: admin-only endpoint', async () => {
  const anonymous = await ctx.call('GET', '/api/v1/dashboard');
  assert.equal(anonymous.status, 401);

  const withToken = await ctx.call('GET', '/api/v1/dashboard', { token: adminToken });
  assert.equal(withToken.status, 200);
  assert.ok(withToken.body.data);
});

test('sales report: admin-only with day buckets', async () => {
  const anonymous = await ctx.call('GET', '/api/v1/reports/sales');
  assert.equal(anonymous.status, 401);

  const report = await ctx.call('GET', '/api/v1/reports/sales', { token: adminToken });
  assert.equal(report.status, 200);
  assert.ok(Array.isArray(report.body.days));
  assert.ok(report.body.totals);
});

test('stock movement: stock update is admin-only and logs', async () => {
  const anonymous = await ctx.call('POST', '/api/v1/stock/update', { body: { productId: 1, newQuantity: 5, reason: 'stock_take' } });
  assert.equal(anonymous.status, 401);

  const updated = await ctx.call('POST', '/api/v1/stock/update', {
    token: adminToken,
    body: { productId: 1, newQuantity: 77, reason: 'stock_take' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.product.stock_qty, 77);

  const movements = await ctx.call('GET', '/api/v1/stock/movements?limit=5', { token: adminToken });
  assert.equal(movements.status, 200);
  assert.ok(movements.body.movements.length > 0);
  assert.equal(movements.body.movements[0].reason, 'stock_take');
});

test('products write: admin-only create with validation', async () => {
  const anonymous = await ctx.call('POST', '/api/v1/products', { body: { sku: 'X', name: 'X' } });
  assert.equal(anonymous.status, 401);

  const missingName = await ctx.call('POST', '/api/v1/products', { token: adminToken, body: { sku: 'SKU-ONLY-NO-NAME' } });
  assert.equal(missingName.status, 422);

  const created = await ctx.call('POST', '/api/v1/products', {
    token: adminToken,
    body: {
      sku: 'DXN-TEST-PRODUCT',
      name: 'Test Product',
      category: 'Test',
      retail_price: 100,
      member_price: 80,
      pv_points: 10,
      stock_qty: 5,
    },
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.product.id > 0);
});

test('unknown API route: JSON error envelope', async () => {
  const { status, body } = await ctx.call('GET', '/api/v1/does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.ok(body.error.code);
});

test('settings save: strips the admin hash from the response', async () => {
  const { status, body } = await ctx.call('PUT', '/api/v1/settings', {
    token: adminToken,
    body: { branch_name: 'Test Stockpoint' },
  });
  assert.equal(status, 200);
  assert.equal(body.settings.branch_name, 'Test Stockpoint');
  assert.ok(!('admin_pin_hash' in body.settings));
});
