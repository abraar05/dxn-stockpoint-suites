/**
 * JSON-backed shop database.
 *
 * The API is intentionally dependency-free. All writes go through this class,
 * which keeps a single revision counter so every client can sync incrementally.
 * Data lives in server/data/db.json and is written atomically.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ApiError,
  bool,
  clean,
  dateKey,
  hashPin,
  int,
  money,
  multiline,
  nowIso,
  orderNumber,
  randomToken,
  round,
  safeEqual,
  uuid,
  verifyPin,
} from './util.js';

const VERSION = 3;

const DEFAULT_SETTINGS = {
  branch_name: 'Mohammadpur Stock Point',
  whatsapp_number: '8801939994578',
  currency: 'BDT',
  low_stock_threshold: 6,
  receipt_footer: 'Thank you for choosing Mohammadpur Stock Point. Wealth through health.',
  business_address: 'H # 1, R # 11, B # A, Chandrima Model Town, Dhaka-1207',
  business_phone: '01939994578',
  allow_public_orders: '1',
  steadfast_base_url: 'https://portal.packzy.com/api/v1',
  steadfast_api_key: '',
  steadfast_secret_key: '',
  steadfast_webhook_token: '',
};

const PUBLIC_SETTING_KEYS = [
  'branch_name',
  'whatsapp_number',
  'currency',
  'low_stock_threshold',
  'receipt_footer',
  'business_address',
  'business_phone',
  'allow_public_orders',
];

const PRODUCT_FIELDS = [
  'sku', 'name', 'category', 'description', 'retail_price', 'member_price',
  'pv_points', 'stock_qty', 'low_stock_at', 'image_url', 'is_active',
];

const FALLBACK_PRODUCTS = [
  ['DXN-LZC-3IN1-20', 'Lingzhi Coffee 3-in-1', 'Coffee & Tea', 2460, 2050, 475],
  ['DXN-WHITE-COFFEE-20', 'White Coffee Zhino', 'Coffee & Tea', 2550, 2125, 290],
  ['DXN-ZHI-MOCHA-20', 'Zhi Mocha Coffee', 'Coffee & Tea', 1510, 1260, 290],
  ['DXN-RG-POWDER-50', 'RG Powder 50g', 'Supplements', 4145, 3455, 1070],
  ['DXN-GL-POWDER-80', 'GL Powder 80g', 'Supplements', 3060, 2550, 770],
  ['DXN-SOAP-GANO', 'Ganozhi Soap 75g', 'Personal Care', 470, 390, 65],
  ['DXN-SHAMPOO-GANO', 'Ganozhi Shampoo 200ml', 'Personal Care', 440, 365, 65],
  ['DXN-TOOTHPASTE-120', 'Ganozhi Toothpaste 150g', 'Personal Care', 1000, 835, 110],
  ['DXN-COCOZHI-500', 'Cocozhi 500g', 'Food & Drink', 2695, 2245, 525],
  ['DXN-LEMONZHI-500', 'Lemonzhi 500g', 'Food & Drink', 895, 745, 175],
];

export class Database {
  constructor({ dataDir, catalogPath, pin = '2468', adminKey = '' } = {}) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'db.json');
    this.catalogPath = catalogPath;
    this.initialPin = pin;
    this.adminKey = adminKey;
    this.data = null;
    this.load();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.dbPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      } catch (error) {
        throw new Error(`Could not read ${this.dbPath}: ${error.message}`);
      }
      this.migrate();
      return;
    }
    this.data = this.seed();
    this.save();
  }

  migrate() {
    const data = this.data;
    data.meta ||= {};
    data.meta.version ||= VERSION;
    data.meta.createdAt ||= nowIso();
    data.meta.rev = int(data.meta.rev, 0);
    data.meta.counters ||= { product: 0, order: 0, customer: 0, movement: 0 };
    data.meta.orderDay ||= '';
    data.meta.orderSeq = int(data.meta.orderSeq, 0);
    data.settings ||= {};
    data.products ||= [];
    data.orders ||= [];
    data.customers ||= [];
    data.movements ||= [];
    data.sessions ||= [];
    data.audit ||= [];
    data.customerAccounts ||= [];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!data.settings[key]) {
        data.settings[key] = { value: String(value), rev: 0, updated_at: nowIso() };
      }
    }
    if (!data.meta.pinSalt || !data.meta.pinHash) {
      this.setPinInternal(this.initialPin);
    }
    data.meta.version = VERSION;
  }

  seed() {
    const now = nowIso();
    const salt = randomToken(16);
    const data = {
      meta: {
        version: VERSION,
        createdAt: now,
        updatedAt: now,
        rev: 1,
        pinSalt: salt,
        pinHash: hashPin(this.initialPin, salt),
        counters: { product: 0, order: 0, customer: 0, movement: 0 },
        orderDay: '',
        orderSeq: 0,
      },
      settings: {},
      products: [],
      orders: [],
      customers: [],
      movements: [],
      sessions: [],
      audit: [],
      customerAccounts: [],
    };

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      data.settings[key] = { value: String(value), rev: 0, updated_at: now };
    }

    const catalog = this.readCatalog();
    catalog.forEach((item, index) => {
      data.meta.counters.product += 1;
      const low = index % 11 === 4;
      data.products.push({
        id: data.meta.counters.product,
        sku: clean(item.sku, 64),
        name: clean(item.name, 160),
        category: clean(item.category || 'General', 64),
        description: item.description ? multiline(item.description, 800) : null,
        retail_price: money(item.retail_price),
        member_price: money(item.member_price),
        pv_points: money(item.pv_points),
        stock_qty: low ? 3 : 42 + ((index * 17) % 76),
        low_stock_at: 6,
        image_url: item.image || item.image_url || null,
        is_active: 1,
        created_at: now,
        updated_at: now,
        rev: 1,
      });
    });

    data.audit.push({
      id: 1,
      action: 'installed',
      entity: 'shop',
      entity_id: null,
      detail: `Seeded ${data.products.length} products`,
      created_at: now,
    });

    return data;
  }

  readCatalog() {
    try {
      if (this.catalogPath && fs.existsSync(this.catalogPath)) {
        const raw = JSON.parse(fs.readFileSync(this.catalogPath, 'utf8'));
        if (Array.isArray(raw.products) && raw.products.length) {
          return raw.products.map((product) => ({
            ...product,
            image: product.image || product.image_url || null,
          }));
        }
      }
    } catch {
      // A malformed catalogue must not stop the shop from opening.
    }
    return FALLBACK_PRODUCTS.map(([sku, name, category, retail, member, pv]) => ({
      sku, name, category, retail_price: retail, member_price: member, pv_points: pv, image: null,
    }));
  }

  save() {
    this.data.meta.updatedAt = nowIso();
    const temp = `${this.dbPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.dbPath);
  }

  reset() {
    fs.rmSync(this.dbPath, { force: true });
    this.data = this.seed();
    this.save();
  }

  // ── Revisions & audit ─────────────────────────────────────────────────────

  nextRev() {
    this.data.meta.rev = int(this.data.meta.rev, 0) + 1;
    return this.data.meta.rev;
  }

  currentRev() {
    return int(this.data.meta.rev, 0);
  }

  audit(action, entity, entityId = null, detail = '') {
    const id = (this.data.audit.at(-1)?.id || 0) + 1;
    this.data.audit.push({
      id,
      action: clean(action, 64),
      entity: clean(entity, 32),
      entity_id: entityId === null ? null : String(entityId),
      detail: clean(detail, 300),
      created_at: nowIso(),
    });
    if (this.data.audit.length > 2000) this.data.audit.splice(0, this.data.audit.length - 2000);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  settings() {
    const out = {};
    for (const [key, entry] of Object.entries(this.data.settings)) {
      out[key] = String(entry?.value ?? '');
    }
    return out;
  }

  publicSettings() {
    const all = this.settings();
    const out = {};
    for (const key of PUBLIC_SETTING_KEYS) out[key] = all[key] ?? DEFAULT_SETTINGS[key] ?? '';
    out.low_stock_threshold = int(out.low_stock_threshold, 6);
    out.allow_public_orders = int(out.allow_public_orders, 1);
    return out;
  }

  setting(key, fallback = null) {
    const entry = this.data.settings[key];
    return entry === undefined ? fallback : String(entry.value ?? '');
  }

  putSetting(key, value, bump = true) {
    const rev = bump ? this.nextRev() : 0;
    const now = nowIso();
    this.data.settings[key] = {
      value: String(value ?? ''),
      rev,
      updated_at: now,
    };
    return rev;
  }

  settingsRev() {
    const revs = Object.values(this.data.settings || {}).map((entry) => int(entry?.rev, 0));
    if (!revs.length) return 0;
    // Seeded rows may all carry rev 0; report at least 1 so a full admin sync
    // (since=0) always includes the settings payload.
    return Math.max(1, ...revs);
  }

  setPinInternal(pin) {
    const salt = randomToken(16);
    this.data.meta.pinSalt = salt;
    this.data.meta.pinHash = hashPin(pin, salt);
  }

  changePin(pin) {
    if (String(pin).length < 4) {
      throw new ApiError('The new PIN must be at least 4 characters', 422, 'validation_error');
    }
    this.setPinInternal(String(pin));
    this.nextRev();
    this.audit('pin_changed', 'settings');
    this.save();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  login(pin) {
    if (!pin) throw new ApiError('PIN is required', 422, 'validation_error');
    if (!verifyPin(String(pin), this.data.meta.pinSalt, this.data.meta.pinHash)) {
      throw new ApiError('Incorrect PIN', 401, 'invalid_credentials');
    }
    const token = randomToken(32);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.data.sessions = this.data.sessions
      .filter((session) => new Date(session.expires_at).getTime() > Date.now())
      .slice(-40);
    this.data.sessions.push({ token, created_at: nowIso(), expires_at: expires, role: 'admin' });
    this.audit('signed_in', 'auth');
    this.save();
    return { token, expires_at: expires, role: 'admin' };
  }

  verifyToken(token) {
    if (!token) return null;
    const session = this.data.sessions.find((item) => safeEqual(item.token, token));
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    return session;
  }

  logout(token) {
    if (!token) return;
    this.data.sessions = this.data.sessions.filter((item) => !safeEqual(item.token, token));
    this.save();
  }

  // ── Customer accounts (ecommerce) ────────────────────────────────────────
  registerCustomerAccount({ phone, password, name, email }) {
    const cleanPhone = clean(phone, 40);
    if (!cleanPhone) throw new ApiError('Phone is required', 422, 'validation_error');
    if (String(password || '').length < 6) throw new ApiError('Password must be at least 6 characters', 422, 'validation_error');
    const existing = this.data.customerAccounts.find((a) => String(a.phone) === cleanPhone);
    if (existing) throw new ApiError('An account with this phone already exists', 409, 'duplicate_account');

    // Link to an existing customer record by phone, or create a new one.
    let customer = this.data.customers.find((c) => String(c.phone || '') === cleanPhone);
    const now = nowIso();
    if (!customer) {
      this.data.meta.counters.customer += 1;
      customer = {
        id: this.data.meta.counters.customer,
        name: clean(name, 160) || 'Customer',
        phone: cleanPhone,
        dxn_member_id: null,
        is_member: 0,
        total_orders: 0,
        total_spent: 0,
        total_pv: 0,
        last_order_at: null,
        created_at: now,
        updated_at: now,
        rev: this.nextRev(),
      };
      this.data.customers.push(customer);
    } else {
      if (clean(name, 160)) customer.name = clean(name, 160);
      customer.updated_at = now;
      customer.rev = this.nextRev();
    }

    const salt = randomToken(16);
    const account = {
      id: this.data.customerAccounts.length + 1,
      customer_id: customer.id,
      phone: cleanPhone,
      email: clean(email, 120) || null,
      name: clean(name, 160) || customer.name,
      salt,
      password_hash: hashPin(String(password), salt),
      created_at: now,
      updated_at: now,
    };
    this.data.customerAccounts.push(account);

    const token = randomToken(32);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.data.sessions = this.data.sessions
      .filter((s) => new Date(s.expires_at).getTime() > Date.now())
      .slice(-40);
    this.data.sessions.push({ token, created_at: nowIso(), expires_at: expires, role: 'customer', customer_id: customer.id, account_id: account.id });
    this.save();
    return {
      token,
      expires_at: expires,
      role: 'customer',
      customer: this.mapCustomer(customer),
    };
  }

  loginCustomer(phone, password) {
    const cleanPhone = clean(phone, 40);
    if (!cleanPhone) throw new ApiError('Phone is required', 422, 'validation_error');
    const account = this.data.customerAccounts.find((a) => String(a.phone) === cleanPhone);
    if (!account) throw new ApiError('No account found with this phone', 401, 'invalid_credentials');
    if (!verifyPin(String(password), account.salt, account.password_hash)) {
      throw new ApiError('Incorrect password', 401, 'invalid_credentials');
    }
    const customer = this.data.customers.find((c) => int(c.id) === int(account.customer_id));
    const token = randomToken(32);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.data.sessions = this.data.sessions
      .filter((s) => new Date(s.expires_at).getTime() > Date.now())
      .slice(-40);
    this.data.sessions.push({ token, created_at: nowIso(), expires_at: expires, role: 'customer', customer_id: account.customer_id, account_id: account.id });
    this.save();
    return {
      token,
      expires_at: expires,
      role: 'customer',
      customer: customer ? this.mapCustomer(customer) : null,
    };
  }

  customerAccountByToken(token) {
    const session = this.verifyToken(token);
    if (!session || session.role !== 'customer') return null;
    const account = this.data.customerAccounts.find((a) => int(a.id) === int(session.account_id));
    const customer = this.data.customers.find((c) => int(c.id) === int(session.customer_id));
    return { session, account, customer: customer ? this.mapCustomer(customer) : null };
  }

  myProfile(token) {
    const info = this.customerAccountByToken(token);
    if (!info) throw new ApiError('Sign in to view your profile', 401, 'unauthorized');
    return info.customer;
  }

  myOrders(token) {
    const info = this.customerAccountByToken(token);
    if (!info) throw new ApiError('Sign in to view your orders', 401, 'unauthorized');
    const customerId = int(info.session.customer_id);
    return this.data.orders
      .filter((order) => int(order.customer_id) === customerId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((order) => this.mapOrder(order));
  }

  updateMyProfile(token, patch) {
    const info = this.customerAccountByToken(token);
    if (!info) throw new ApiError('Sign in to update your profile', 401, 'unauthorized');
    const customer = this.data.customers.find((c) => int(c.id) === int(info.session.customer_id));
    if (!customer) throw new ApiError('Customer record not found', 404, 'not_found');
    if (patch.name !== undefined) customer.name = clean(patch.name, 160) || customer.name;
    if (patch.email !== undefined) {
      const acct = this.data.customerAccounts.find((a) => int(a.id) === int(info.session.account_id));
      if (acct) acct.email = clean(patch.email, 120) || null;
    }
    if (patch.dxn_member_id !== undefined) customer.dxn_member_id = clean(patch.dxn_member_id, 40).toUpperCase() || customer.dxn_member_id;
    customer.updated_at = nowIso();
    customer.rev = this.nextRev();
    this.save();
    return this.mapCustomer(customer);
  }

  trackOrder(orderNumber, phone) {
    const cleanNumber = clean(orderNumber, 40);
    const cleanPhone = clean(phone, 40);
    const order = this.data.orders.find((o) =>
      String(o.order_number) === cleanNumber && String(o.customer_phone || '') === cleanPhone
    );
    if (!order) throw new ApiError('Order not found', 404, 'not_found');
    return this.mapOrder(order);
  }

  isAdminKey(key) {
    return Boolean(this.adminKey) && safeEqual(key, this.adminKey);
  }

  // ── Products ──────────────────────────────────────────────────────────────

  mapProduct(row) {
    if (!row) return null;
    return {
      id: int(row.id),
      sku: String(row.sku ?? ''),
      name: String(row.name ?? ''),
      category: String(row.category ?? 'General'),
      description: row.description ?? null,
      retail_price: money(row.retail_price),
      member_price: money(row.member_price),
      pv_points: money(row.pv_points),
      stock_qty: int(row.stock_qty),
      low_stock_at: int(row.low_stock_at, 5),
      image_url: row.image_url ?? null,
      is_active: int(row.is_active ?? 1),
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      rev: int(row.rev, 0),
    };
  }

  products(includeInactive = false) {
    return this.data.products
      .filter((product) => includeInactive || int(product.is_active ?? 1) === 1)
      .map((product) => this.mapProduct(product))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  product(id) {
    return this.mapProduct(this.data.products.find((product) => int(product.id) === int(id)));
  }

  productRow(id) {
    return this.data.products.find((product) => int(product.id) === int(id)) || null;
  }

  createProduct(input) {
    const sku = clean(input.sku, 64).toUpperCase();
    const name = clean(input.name, 160);
    if (!sku || !name) throw new ApiError('SKU and name are required', 422, 'validation_error');
    if (this.data.products.some((product) => String(product.sku).toUpperCase() === sku)) {
      throw new ApiError(`SKU ${sku} already exists`, 409, 'duplicate_sku');
    }

    const rev = this.nextRev();
    const now = nowIso();
    this.data.meta.counters.product += 1;
    const product = {
      id: this.data.meta.counters.product,
      sku,
      name,
      category: clean(input.category || 'General', 64) || 'General',
      description: input.description ? multiline(input.description, 800) : null,
      retail_price: money(input.retail_price),
      member_price: money(input.member_price),
      pv_points: money(input.pv_points),
      stock_qty: Math.max(0, int(input.stock_qty)),
      low_stock_at: Math.max(0, int(input.low_stock_at, 5)),
      image_url: clean(input.image_url, 255) || null,
      is_active: input.is_active === undefined ? 1 : bool(input.is_active),
      created_at: now,
      updated_at: now,
      rev,
    };
    this.data.products.push(product);

    if (product.stock_qty !== 0) {
      this.recordMovement(product.id, product.stock_qty, 'opening_stock', null, rev);
    }
    this.audit('created', 'product', product.id, sku);
    this.save();
    return this.mapProduct(product);
  }

  updateProduct(id, input) {
    const product = this.productRow(id);
    if (!product) throw new ApiError('Product not found', 404, 'not_found');

    const rev = this.nextRev();
    const now = nowIso();
    for (const field of PRODUCT_FIELDS) {
      if (!(field in input)) continue;
      if (field === 'stock_qty') continue; // stock must go through the ledger
      if (['retail_price', 'member_price', 'pv_points'].includes(field)) {
        product[field] = money(input[field]);
      } else if (field === 'low_stock_at') {
        product[field] = Math.max(0, int(input[field], 5));
      } else if (field === 'is_active') {
        product[field] = bool(input[field]);
      } else if (field === 'description') {
        product[field] = input[field] ? multiline(input[field], 800) : null;
      } else if (field === 'image_url') {
        product[field] = clean(input[field], 255) || null;
      } else if (field === 'sku') {
        const sku = clean(input[field], 64).toUpperCase();
        if (!sku) throw new ApiError('SKU cannot be empty', 422, 'validation_error');
        if (this.data.products.some((other) => int(other.id) !== int(id) && String(other.sku).toUpperCase() === sku)) {
          throw new ApiError(`SKU ${sku} already exists`, 409, 'duplicate_sku');
        }
        product[field] = sku;
      } else if (field === 'name') {
        const name = clean(input[field], 160);
        if (!name) throw new ApiError('Name cannot be empty', 422, 'validation_error');
        product[field] = name;
      } else {
        product[field] = clean(input[field], 160);
      }
    }
    product.updated_at = now;
    product.rev = rev;
    this.audit('updated', 'product', product.id);
    this.save();
    return this.mapProduct(product);
  }

  archiveProduct(id) {
    return this.updateProduct(id, { is_active: 0 });
  }

  restoreProduct(id) {
    return this.updateProduct(id, { is_active: 1 });
  }

  applyStockDelta(productId, delta, reason = 'adjustment', orderId = null, bumpRev = true, oversell = false) {
    const product = this.productRow(productId);
    if (!product) throw new ApiError('Product not found', 404, 'not_found');
    const change = int(delta);
    const next = int(product.stock_qty) + change;
    if (next < 0 && !oversell) {
      throw new ApiError(
        `Insufficient stock for "${product.name}" (available: ${product.stock_qty})`,
        409,
        'insufficient_stock',
      );
    }
    const rev = bumpRev ? this.nextRev() : int(product.rev, 0);
    product.stock_qty = next;
    product.updated_at = nowIso();
    product.rev = rev;
    this.recordMovement(product.id, change, reason, orderId, rev);
    return next;
  }

  recordMovement(productId, delta, reason, orderId = null, rev = 0) {
    const product = this.productRow(productId);
    this.data.meta.counters.movement += 1;
    this.data.movements.push({
      id: this.data.meta.counters.movement,
      product_id: int(productId),
      delta: int(delta),
      quantity_after: int(product?.stock_qty),
      reason: clean(reason, 64) || 'adjustment',
      order_id: orderId === null ? null : int(orderId),
      created_at: nowIso(),
      rev: int(rev),
    });
    if (this.data.movements.length > 5000) {
      this.data.movements.splice(0, this.data.movements.length - 5000);
    }
  }

  movements(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, int(limit, 100)));
    return this.data.movements
      .slice()
      .sort((a, b) => int(b.id) - int(a.id))
      .slice(0, safeLimit)
      .map((row) => {
        const product = this.productRow(row.product_id);
        return {
          id: int(row.id),
          product_id: int(row.product_id),
          product_name: product?.name || 'Deleted product',
          product_sku: product?.sku || '',
          delta: int(row.delta),
          quantity_after: int(row.quantity_after),
          reason: String(row.reason),
          order_id: row.order_id === null ? null : int(row.order_id),
          created_at: row.created_at,
        };
      });
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  mapCustomer(row) {
    if (!row) return null;
    return {
      id: int(row.id),
      name: String(row.name ?? ''),
      phone: row.phone ?? null,
      dxn_member_id: row.dxn_member_id ?? null,
      is_member: int(row.is_member ?? 0),
      total_orders: int(row.total_orders),
      total_spent: money(row.total_spent),
      total_pv: money(row.total_pv),
      last_order_at: row.last_order_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      rev: int(row.rev, 0),
    };
  }

  customers(query = '') {
    const q = clean(query, 120).toLowerCase();
    return this.data.customers
      .filter((customer) => {
        if (!q) return true;
        return `${customer.name} ${customer.phone || ''} ${customer.dxn_member_id || ''}`.toLowerCase().includes(q);
      })
      .map((customer) => this.mapCustomer(customer))
      .sort((a, b) => b.total_spent - a.total_spent || a.name.localeCompare(b.name));
  }

  customer(id) {
    return this.mapCustomer(this.data.customers.find((customer) => int(customer.id) === int(id)));
  }

  touchCustomer({ name, phone, memberId, isMember, total, pv, orderAt }) {
    const cleanPhone = clean(phone, 40) || null;
    const cleanMember = clean(memberId, 40).toUpperCase() || null;
    let customer = null;
    if (cleanMember) {
      customer = this.data.customers.find((item) => String(item.dxn_member_id || '').toUpperCase() === cleanMember);
    }
    if (!customer && cleanPhone) {
      customer = this.data.customers.find((item) => String(item.phone || '') === cleanPhone);
    }
    if (!customer) {
      customer = this.data.customers.find(
        (item) => String(item.name).toLowerCase() === clean(name, 160).toLowerCase() && !item.phone && !item.dxn_member_id,
      );
    }

    const now = nowIso();
    if (!customer) {
      this.data.meta.counters.customer += 1;
      customer = {
        id: this.data.meta.counters.customer,
        name: clean(name, 160) || 'Walk-in customer',
        phone: cleanPhone,
        dxn_member_id: cleanMember,
        is_member: isMember ? 1 : 0,
        total_orders: 0,
        total_spent: 0,
        total_pv: 0,
        last_order_at: null,
        created_at: now,
        updated_at: now,
        rev: this.nextRev(),
      };
      this.data.customers.push(customer);
    }

    customer.name = clean(name, 160) || customer.name;
    if (cleanPhone) customer.phone = cleanPhone;
    if (cleanMember) customer.dxn_member_id = cleanMember;
    customer.is_member = isMember || customer.is_member ? 1 : 0;
    customer.total_orders = int(customer.total_orders) + 1;
    customer.total_spent = round(money(customer.total_spent) + money(total));
    customer.total_pv = round(money(customer.total_pv) + money(pv));
    customer.last_order_at = orderAt || now;
    customer.updated_at = now;
    customer.rev = this.nextRev();
    return customer.id;
  }

  adjustCustomerTotals(customerId, { orders = 0, spent = 0, pv = 0 }) {
    const customer = this.data.customers.find((item) => int(item.id) === int(customerId));
    if (!customer) return;
    customer.total_orders = Math.max(0, int(customer.total_orders) + orders);
    customer.total_spent = Math.max(0, round(money(customer.total_spent) + spent));
    customer.total_pv = Math.max(0, round(money(customer.total_pv) + pv));
    customer.updated_at = nowIso();
    customer.rev = this.nextRev();
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  mapOrder(row) {
    if (!row) return null;
    return {
      id: int(row.id),
      client_uuid: row.client_uuid ?? null,
      order_number: String(row.order_number ?? ''),
      customer_id: row.customer_id === null || row.customer_id === undefined ? null : int(row.customer_id),
      customer_name: String(row.customer_name ?? ''),
      customer_phone: row.customer_phone ?? null,
      dxn_member_id: row.dxn_member_id ?? null,
      is_member: int(row.is_member ?? 0),
      subtotal: money(row.subtotal),
      discount: money(row.discount),
      total_amount: money(row.total_amount),
      total_pv: money(row.total_pv),
      status: String(row.status ?? 'CONFIRMED'),
      payment_method: String(row.payment_method ?? 'CASH'),
      note: row.note ?? null,
      source: String(row.source ?? 'web'),
      courier_provider: row.courier_provider ?? null,
      courier_consignment_id: row.courier_consignment_id ?? null,
      courier_tracking_code: row.courier_tracking_code ?? null,
      courier_status: row.courier_status ?? null,
      courier_cod_amount: row.courier_cod_amount === null || row.courier_cod_amount === undefined ? null : money(row.courier_cod_amount),
      courier_created_at: row.courier_created_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      rev: int(row.rev, 0),
      items: Array.isArray(row.items)
        ? row.items.map((item) => ({
          product_id: int(item.product_id),
          sku: String(item.sku ?? ''),
          name: String(item.name ?? ''),
          quantity: int(item.quantity),
          unit_price: money(item.unit_price),
          unit_pv: money(item.unit_pv),
          line_total: round(money(item.unit_price) * int(item.quantity)),
          line_pv: round(money(item.unit_pv) * int(item.quantity)),
        }))
        : [],
    };
  }

  orders(filters = {}) {
    let rows = this.data.orders.slice();
    if (filters.status) rows = rows.filter((order) => order.status === filters.status);
    if (filters.from) rows = rows.filter((order) => dateKey(order.created_at) >= filters.from);
    if (filters.to) rows = rows.filter((order) => dateKey(order.created_at) <= filters.to);
    if (filters.q) {
      const q = String(filters.q).toLowerCase();
      rows = rows.filter((order) => (
        String(order.order_number).toLowerCase().includes(q)
        || String(order.customer_name).toLowerCase().includes(q)
        || String(order.customer_phone || '').toLowerCase().includes(q)
        || String(order.dxn_member_id || '').toLowerCase().includes(q)
      ));
    }
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || int(b.id) - int(a.id));
    const limit = Math.max(1, Math.min(500, int(filters.limit, 100)));
    return rows.slice(0, limit).map((order) => this.mapOrder(order));
  }

  order(id) {
    return this.mapOrder(this.data.orders.find((order) => int(order.id) === int(id)));
  }

  orderRow(id) {
    return this.data.orders.find((order) => int(order.id) === int(id)) || null;
  }

  orderByUuid(clientUuid) {
    if (!clientUuid) return null;
    return this.mapOrder(this.data.orders.find((order) => order.client_uuid === clientUuid));
  }

  nextOrderNumber() {
    const today = dateKey(new Date());
    if (this.data.meta.orderDay !== today) {
      this.data.meta.orderDay = today;
      this.data.meta.orderSeq = 0;
    }
    this.data.meta.orderSeq += 1;
    return orderNumber(this.data.meta.orderSeq, new Date());
  }

  createOrder(payload, { isAdmin = false, customerId = null } = {}) {
    if (!isAdmin && this.setting('allow_public_orders', '1') !== '1') {
      throw new ApiError('Ordering is currently disabled for this stockpoint', 403, 'ordering_disabled');
    }

    const linkedCustomerId = customerId ? int(customerId) : null;
    const linkedCustomer = linkedCustomerId ? this.data.customers.find((c) => int(c.id) === linkedCustomerId) : null;
    const customerName = clean(payload.customer_name, 160) || (linkedCustomer ? clean(linkedCustomer.name, 160) : '');
    if (!customerName) throw new ApiError('customer_name is required', 422, 'validation_error');

    const clientUuid = clean(payload.client_uuid, 64);
    if (clientUuid) {
      const existing = this.orderByUuid(clientUuid);
      if (existing) return { order: existing, duplicate: true };
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new ApiError('At least one item is required', 422, 'validation_error');

    const isMember = bool(payload.is_member) === 1;
    const allowOversell = bool(payload.allow_oversell) === 1;
    const discount = Math.max(0, money(payload.discount));
    const resolved = [];
    let subtotal = 0;
    let totalPv = 0;

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const productId = int(item.product_id ?? item.productId);
      const sku = clean(item.product_sku ?? item.sku, 80).toUpperCase();
      const quantity = int(item.quantity);
      if (quantity <= 0) continue;

      let product = sku ? this.productRowBySku(sku) : null;
      if (!product && productId > 0) product = this.productRow(productId);
      if (!product) {
        throw new ApiError(`Product ${sku || productId} not found`, 404, 'product_missing');
      }
      if (!allowOversell && int(product.stock_qty) < quantity) {
        throw new ApiError(
          `Insufficient stock for "${product.name}" (available: ${product.stock_qty})`,
          409,
          'insufficient_stock',
        );
      }

      const fallbackPrice = isMember ? money(product.member_price) : money(product.retail_price);
      const unitPrice = item.unit_price !== undefined && Number.isFinite(Number(item.unit_price))
        ? Math.max(0, money(item.unit_price))
        : fallbackPrice;
      const unitPv = item.unit_pv !== undefined && Number.isFinite(Number(item.unit_pv))
        ? Math.max(0, money(item.unit_pv))
        : money(product.pv_points);

      subtotal += unitPrice * quantity;
      totalPv += unitPv * quantity;
      resolved.push({ product, quantity, unitPrice, unitPv });
    }

    if (!resolved.length) throw new ApiError('No valid order items were supplied', 422, 'validation_error');

    subtotal = money(subtotal);
    totalPv = money(totalPv);
    const total = money(Math.max(0, subtotal - discount));
    const now = nowIso();
    const rev = this.nextRev();
    const orderNumberValue = this.nextOrderNumber();

    const resolvedCustomerId = linkedCustomerId || this.touchCustomer({
      name: customerName,
      phone: payload.customer_phone || (linkedCustomer ? linkedCustomer.phone : null),
      memberId: payload.dxn_member_id || (linkedCustomer ? linkedCustomer.dxn_member_id : null),
      isMember,
      total,
      pv: totalPv,
      orderAt: now,
    });

    this.data.meta.counters.order += 1;
    const order = {
      id: this.data.meta.counters.order,
      client_uuid: clientUuid || null,
      order_number: orderNumberValue,
      customer_id: resolvedCustomerId,
      customer_name: customerName,
      customer_phone: clean(payload.customer_phone || (linkedCustomer ? linkedCustomer.phone : ''), 40) || null,
      dxn_member_id: clean(payload.dxn_member_id, 40).toUpperCase() || null,
      is_member: isMember ? 1 : 0,
      subtotal,
      discount,
      total_amount: total,
      total_pv: totalPv,
      status: ['CASH', 'CARD', 'BKASH', 'NAGAD', 'WALLET'].includes(clean(payload.payment_method || 'CASH', 24).toUpperCase() || 'CASH')
        ? 'PAID'
        : 'CONFIRMED',
      payment_method: clean(payload.payment_method || 'CASH', 24).toUpperCase() || 'CASH',
      note: payload.note ? multiline(payload.note, 500) : null,
      source: clean(payload.source || 'web', 24) || 'web',
      courier_provider: null,
      courier_consignment_id: null,
      courier_tracking_code: null,
      courier_status: null,
      courier_cod_amount: null,
      courier_created_at: null,
      created_at: now,
      updated_at: now,
      rev,
      items: resolved.map(({ product, quantity, unitPrice, unitPv }) => ({
        product_id: int(product.id),
        sku: String(product.sku),
        name: String(product.name),
        quantity,
        unit_price: unitPrice,
        unit_pv: unitPv,
        line_total: round(unitPrice * quantity),
        line_pv: round(unitPv * quantity),
      })),
    };

    this.data.orders.push(order);
    for (const line of resolved) {
      this.applyStockDelta(line.product.id, -line.quantity, 'sale', order.id, true, allowOversell);
    }
    this.audit('created', 'order', order.id, `${orderNumberValue} · ${total}`);
    this.save();
    return { order: this.mapOrder(order), duplicate: false };
  }

  markPaid(orderId) {
    const order = this.orderRow(orderId);
    if (!order) throw new ApiError('Order not found', 404, 'not_found');
    if (String(order.status) === 'PAID') return this.mapOrder(order);
    order.status = 'PAID';
    order.updated_at = nowIso();
    order.rev = this.nextRev();
    this.audit('status_changed', 'order', order.id, `${order.status} · payment confirmed`);
    this.save();
    return this.mapOrder(order);
  }

  productRowBySku(sku) {
    const target = String(sku).toUpperCase();
    return this.data.products.find((product) => String(product.sku).toUpperCase() === target) || null;
  }

  updateOrderStatus(id, status) {
    const order = this.orderRow(id);
    if (!order) throw new ApiError('Order not found', 404, 'not_found');
    const allowed = ['PENDING', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PAID', 'CANCELLED'];
    const next = String(status || '').toUpperCase();
    if (!allowed.includes(next)) {
      throw new ApiError(`status must be one of: ${allowed.join(', ')}`, 422, 'validation_error');
    }
    if (order.status === next) return this.mapOrder(order);

    const previousStatus = order.status;
    const wasCancelled = order.status === 'CANCELLED';
    const willCancel = next === 'CANCELLED';
    const rev = this.nextRev();

    if (!wasCancelled && willCancel) {
      for (const item of order.items || []) {
        const product = this.productRow(item.product_id);
        if (product) {
          product.stock_qty = int(product.stock_qty) + int(item.quantity);
          product.updated_at = nowIso();
          product.rev = rev;
          this.recordMovement(product.id, int(item.quantity), 'order_cancelled', order.id, rev);
        }
      }
      this.adjustCustomerTotals(order.customer_id, {
        orders: -1,
        spent: -money(order.total_amount),
        pv: -money(order.total_pv),
      });
    }

    if (wasCancelled && !willCancel) {
      for (const item of order.items || []) {
        const product = this.productRow(item.product_id);
        if (!product || int(product.stock_qty) < int(item.quantity)) {
          throw new ApiError(
            `Cannot reopen order: "${item.name}" has only ${product?.stock_qty ?? 0} in stock`,
            409,
            'insufficient_stock',
          );
        }
      }
      for (const item of order.items || []) {
        this.applyStockDelta(item.product_id, -int(item.quantity), 'order_reopened', order.id);
      }
      this.adjustCustomerTotals(order.customer_id, {
        orders: 1,
        spent: money(order.total_amount),
        pv: money(order.total_pv),
      });
    }

    order.status = next;
    order.updated_at = nowIso();
    order.rev = rev;
    this.audit('status_changed', 'order', order.id, `${previousStatus} -> ${next}`);
    this.save();
    return this.mapOrder(order);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  dashboard() {
    const live = this.data.orders.filter((order) => order.status !== 'CANCELLED');
    const today = dateKey(new Date());
    const todayOrders = live.filter((order) => dateKey(order.created_at) === today);
    const activeProducts = this.data.products.filter((product) => int(product.is_active ?? 1) === 1);
    const threshold = int(this.setting('low_stock_threshold', '6'), 6);

    const lowStock = activeProducts
      .filter((product) => int(product.stock_qty) <= Math.max(int(product.low_stock_at, 5), threshold))
      .map((product) => this.mapProduct(product))
      .sort((a, b) => a.stock_qty - b.stock_qty);

    const productMap = new Map(this.data.products.map((product) => [int(product.id), product]));
    const totals = new Map();
    for (const order of live) {
      for (const item of order.items || []) {
        const key = int(item.product_id) || item.name;
        const entry = totals.get(key) || {
          product_id: int(item.product_id),
          name: item.name,
          category: productMap.get(int(item.product_id))?.category || 'Other',
          quantity: 0,
          revenue: 0,
        };
        entry.quantity += int(item.quantity);
        entry.revenue += money(item.line_total);
        totals.set(key, entry);
      }
    }
    const topProducts = [...totals.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 6)
      .map((entry) => ({ ...entry, revenue: money(entry.revenue) }));

    const series = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - i);
      const key = dateKey(date);
      const dayOrders = live.filter((order) => dateKey(order.created_at) === key);
      series.push({
        day: key,
        orders: dayOrders.length,
        revenue: money(dayOrders.reduce((sum, order) => sum + money(order.total_amount), 0)),
        pv: money(dayOrders.reduce((sum, order) => sum + money(order.total_pv), 0)),
      });
    }

    const revenue = money(live.reduce((sum, order) => sum + money(order.total_amount), 0));
    const totalPv = money(live.reduce((sum, order) => sum + money(order.total_pv), 0));

    return {
      total_orders: live.length,
      total_revenue: revenue,
      total_pv: totalPv,
      average_order: live.length ? money(revenue / live.length) : 0,
      today_orders: todayOrders.length,
      today_revenue: money(todayOrders.reduce((sum, order) => sum + money(order.total_amount), 0)),
      today_pv: money(todayOrders.reduce((sum, order) => sum + money(order.total_pv), 0)),
      total_products: activeProducts.length,
      stock_units: activeProducts.reduce((sum, product) => sum + int(product.stock_qty), 0),
      stock_value: money(activeProducts.reduce((sum, product) => sum + int(product.stock_qty) * money(product.member_price), 0)),
      low_stock_count: lowStock.length,
      low_stock_products: lowStock.slice(0, 10),
      top_products: topProducts,
      recent_orders: this.orders({ limit: 6 }),
      sales_by_day: series,
      currency: this.setting('currency', 'BDT'),
    };
  }

  salesReport(from, to) {
    const start = from || dateKey(new Date(Date.now() - 29 * 86400000));
    const end = to || dateKey(new Date());
    const rows = this.data.orders.filter((order) => {
      const key = dateKey(order.created_at);
      return order.status !== 'CANCELLED' && key >= start && key <= end;
    });

    const productMap = new Map(this.data.products.map((product) => [int(product.id), product]));
    const byPayment = new Map();
    const byCategory = new Map();
    const byProduct = new Map();
    const byCustomer = new Map();

    for (const order of rows) {
      const payment = order.payment_method || 'CASH';
      const paymentEntry = byPayment.get(payment) || { payment_method: payment, orders: 0, revenue: 0 };
      paymentEntry.orders += 1;
      paymentEntry.revenue += money(order.total_amount);
      byPayment.set(payment, paymentEntry);

      const customerKey = order.customer_id || order.customer_name;
      const customerEntry = byCustomer.get(customerKey) || {
        customer_id: order.customer_id,
        name: order.customer_name,
        phone: order.customer_phone,
        orders: 0,
        revenue: 0,
      };
      customerEntry.orders += 1;
      customerEntry.revenue += money(order.total_amount);
      byCustomer.set(customerKey, customerEntry);

      for (const item of order.items || []) {
        const category = productMap.get(int(item.product_id))?.category || 'Other';
        const categoryEntry = byCategory.get(category) || { category, quantity: 0, revenue: 0 };
        categoryEntry.quantity += int(item.quantity);
        categoryEntry.revenue += money(item.line_total);
        byCategory.set(category, categoryEntry);

        const productEntry = byProduct.get(item.product_id || item.name) || {
          product_id: item.product_id,
          name: item.name,
          quantity: 0,
          revenue: 0,
        };
        productEntry.quantity += int(item.quantity);
        productEntry.revenue += money(item.line_total);
        byProduct.set(item.product_id || item.name, productEntry);
      }
    }

    const days = [];
    const cursor = new Date(`${start}T12:00:00`);
    const last = new Date(`${end}T12:00:00`);
    let guard = 0;
    while (cursor <= last && guard < 400) {
      const key = dateKey(cursor);
      const dayOrders = rows.filter((order) => dateKey(order.created_at) === key);
      days.push({
        day: key,
        orders: dayOrders.length,
        revenue: money(dayOrders.reduce((sum, order) => sum + money(order.total_amount), 0)),
        pv: money(dayOrders.reduce((sum, order) => sum + money(order.total_pv), 0)),
      });
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }

    const revenue = money(rows.reduce((sum, order) => sum + money(order.total_amount), 0));
    const totalPv = money(rows.reduce((sum, order) => sum + money(order.total_pv), 0));

    return {
      from: start,
      to: end,
      totals: {
        orders: rows.length,
        revenue,
        pv: totalPv,
        average_order: rows.length ? money(revenue / rows.length) : 0,
        units: [...byProduct.values()].reduce((sum, entry) => sum + entry.quantity, 0),
      },
      days,
      by_payment: [...byPayment.values()].sort((a, b) => b.revenue - a.revenue).map((entry) => ({ ...entry, revenue: money(entry.revenue) })),
      by_category: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue).map((entry) => ({ ...entry, revenue: money(entry.revenue) })),
      top_products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((entry) => ({ ...entry, revenue: money(entry.revenue) })),
      top_customers: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((entry) => ({ ...entry, revenue: money(entry.revenue) })),
      currency: this.setting('currency', 'BDT'),
    };
  }

  // ── Sync & service ────────────────────────────────────────────────────────

  sync(since, isAdmin) {
    const serverRev = this.currentRev();
    const products = this.data.products
      .filter((product) => int(product.rev, 0) > since)
      .map((product) => this.mapProduct(product));

    let orders = [];
    let customers = [];
    let settings = null;
    if (isAdmin) {
      orders = this.data.orders
        .filter((order) => int(order.rev, 0) > since)
        .sort((a, b) => int(a.rev) - int(b.rev))
        .slice(0, 500)
        .map((order) => this.mapOrder(order));
      customers = this.data.customers
        .filter((customer) => int(customer.rev, 0) > since)
        .map((customer) => this.mapCustomer(customer));
      if (this.settingsRev() > since) {
        settings = { ...this.settings(), ...this.publicSettings() };
      }
    }

    return {
      server_rev: serverRev,
      since,
      scope: isAdmin ? 'admin' : 'public',
      products,
      orders,
      customers,
      settings,
      truncated: false,
      server_time: nowIso(),
    };
  }

  health() {
    return {
      status: 'ok',
      version: '3.0.0',
      driver: 'json',
      installed: true,
      server_time: nowIso(),
      uptime_seconds: Math.round(process.uptime()),
      node: process.version,
      database: {
        ok: true,
        error: null,
        counts: {
          products: this.data.products.length,
          orders: this.data.orders.length,
          customers: this.data.customers.length,
        },
      },
      server_rev: this.currentRev(),
    };
  }

  config() {
    return {
      branch: this.publicSettings(),
      version: '3.0.0',
      features: {
        public_orders: this.setting('allow_public_orders', '1') === '1',
        sync: true,
        receipts: true,
        courier: Boolean(this.setting('steadfast_api_key', '')),
      },
      server_time: nowIso(),
      server_rev: this.currentRev(),
    };
  }

  courierSettings() {
    return {
      base_url: this.setting('steadfast_base_url', DEFAULT_SETTINGS.steadfast_base_url),
      api_key: this.setting('steadfast_api_key', ''),
      secret_key: this.setting('steadfast_secret_key', ''),
      webhook_token: this.setting('steadfast_webhook_token', ''),
      configured: Boolean(this.setting('steadfast_api_key', '')),
    };
  }

  saveCourierSettings(input) {
    const mapping = {
      base_url: 'steadfast_base_url',
      api_key: 'steadfast_api_key',
      secret_key: 'steadfast_secret_key',
      webhook_token: 'steadfast_webhook_token',
    };
    for (const [field, key] of Object.entries(mapping)) {
      if (input[field] !== undefined) this.putSetting(key, clean(input[field], 255));
    }
    this.audit('settings_updated', 'courier');
    this.save();
    return this.courierSettings();
  }

  saveSettings(input) {
    const writable = [
      'branch_name', 'whatsapp_number', 'currency', 'low_stock_threshold',
      'receipt_footer', 'business_address', 'business_phone', 'allow_public_orders',
      'steadfast_base_url', 'steadfast_api_key', 'steadfast_secret_key', 'steadfast_webhook_token',
    ];
    let changed = 0;
    for (const key of writable) {
      if (!(key in input)) continue;
      let value = input[key];
      if (typeof value === 'boolean') value = value ? '1' : '0';
      this.putSetting(key, clean(value, 600));
      changed += 1;
    }
    if (!changed) throw new ApiError('No writable settings were supplied', 422, 'validation_error');
    this.audit('settings_updated', 'settings', null, 'shop profile');
    this.save();
    return { settings: { ...this.settings(), ...this.publicSettings() }, public: this.publicSettings() };
  }

  seedDemoOrders() {
    const products = this.data.products.filter((product) => int(product.is_active) === 1);
    if (!products.length) return { created: 0 };
    const names = [
      ['Rafiqul Islam', '01711223344', 'DXN-10021', 1],
      ['Nusrat Jahan', '01822334455', '', 0],
      ['Shahin Alam', '01933445566', 'DXN-10442', 1],
      ['Marium Akter', '01644556677', '', 0],
      ['Abdul Karim', '01555667788', 'DXN-10781', 1],
      ['Farhana Yesmin', '01766778899', '', 0],
    ];
    let created = 0;
    for (let day = 13; day >= 0; day -= 1) {
      const count = 1 + ((day * 7) % 3);
      for (let index = 0; index < count; index += 1) {
        const [name, phone, member, isMember] = names[(day + index) % names.length];
        const picks = [
          products[(day * 3 + index) % products.length],
          products[(day * 5 + index + 2) % products.length],
        ];
        const items = picks.map((product, itemIndex) => ({
          product_id: product.id,
          product_sku: product.sku,
          quantity: 1 + ((day + index + itemIndex) % 3),
        }));
        const createdAt = new Date();
        createdAt.setDate(createdAt.getDate() - day);
        createdAt.setHours(10 + (index * 2), 15 + ((day * 5) % 40), 0, 0);
        const order = this.createOrder({
          client_uuid: `demo-${day}-${index}-${uuid().slice(0, 8)}`,
          customer_name: name,
          customer_phone: phone,
          dxn_member_id: member,
          is_member: isMember,
          payment_method: ['CASH', 'BKASH', 'CASH', 'NAGAD'][(day + index) % 4],
          discount: index === 0 && day % 4 === 0 ? 50 : 0,
          note: '',
          source: 'demo',
          allow_oversell: 1,
          items,
        }, { isAdmin: true });
        const row = this.orderRow(order.order.id);
        if (row) {
          row.created_at = createdAt.toISOString();
          row.updated_at = row.created_at;
        }
        created += 1;
      }
    }
    // Keep stock healthy after generating demo sales.
    for (const product of this.data.products) {
      product.stock_qty = Math.max(product.stock_qty, 18 + (product.id % 40));
    }
    this.save();
    return { created };
  }
}

export { DEFAULT_SETTINGS, PUBLIC_SETTING_KEYS, VERSION };
