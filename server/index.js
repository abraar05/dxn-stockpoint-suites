#!/usr/bin/env node
/**
 * Mohammadpur Stock Point — local shop server.
 *
 *   node server/index.js                 start on http://127.0.0.1:4173
 *   node server/index.js --open          start and open the browser
 *   node server/index.js --port 8080     choose a port
 *   node server/index.js --reset         recreate the database
 *   node server/index.js --demo          seed friendly demo sales
 *
 * The same process serves the PWA from docs/ and the JSON API from /api/v1.
 * No npm install, no database server, no cloud account.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Database } from './lib/db.js';
import { createApi } from './lib/api.js';
import { mimeFor } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const DATA = path.join(__dirname, 'data');
const CATALOG = path.join(DOCS, 'products-catalog.json');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const hasFlag = (name) => process.argv.includes(name);

const PORT = Number(argument('--port', process.env.PORT || 4173));
const HOST = argument('--host', process.env.HOST || '127.0.0.1');
const PIN = argument('--pin', process.env.DXN_PIN || '2468');
const ADMIN_KEY = process.env.DXN_ADMIN_KEY || 'local-dev-admin-key-change-me';
const OPEN = hasFlag('--open');
const DEMO = hasFlag('--demo');
const RESET = hasFlag('--reset');

if (RESET) {
  fs.rmSync(path.join(DATA, 'db.json'), { force: true });
}

const db = new Database({
  dataDir: DATA,
  catalogPath: CATALOG,
  pin: PIN,
  adminKey: ADMIN_KEY,
});

if (DEMO && db.data.orders.length === 0) {
  const result = db.seedDemoOrders();
  console.log(`Seeded ${result.created} demo sales.`);
}

const handleApi = createApi({ db });

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  // '/' resolves to the docs folder itself; serveStatic appends index.html.
  const target = path.resolve(DOCS, relative || '.');
  if (target !== DOCS && !target.startsWith(DOCS + path.sep)) return null;
  return target;
}

function serveStatic(req, res, pathname) {
  let filePath = resolveStatic(pathname);
  if (!filePath) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (pathname === '/' || pathname.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // A client-side route such as /orders should still boot the app.
    if (!path.extname(filePath)) {
      filePath = path.join(DOCS, 'index.html');
      try {
        stat = fs.statSync(filePath);
      } catch {
        sendText(res, 404, 'Not found');
        return;
      }
    } else {
      sendText(res, 404, 'Not found');
      return;
    }
  }

  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      sendText(res, 404, 'Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }

  const headers = {
    'Content-Type': mimeFor(filePath),
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest'
      ? 'no-cache'
      : 'public, max-age=3600',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  };

  if (ext === '.html') {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      const ms = Date.now() - started;
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${ms}ms`);
    }
  });

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendText(res, 500, 'Server error');
      else res.end();
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  serveStatic(req, res, url.pathname);
});

function openBrowser(target) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Opening a browser is a convenience, never a requirement.
  }
}

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const url = `http://${displayHost}:${PORT}`;
  const products = db.data.products.length;
  const orders = db.data.orders.length;

  console.log('');
  console.log('  Mohammadpur Stock Point');
  console.log('  ───────────────────────────────────────────');
  console.log(`  Shop app     ${url}`);
  console.log(`  API health   ${url}/api/v1/health`);
  console.log(`  Admin PIN    ${PIN}`);
  console.log(`  Data file    ${path.join(DATA, 'db.json')}`);
  console.log(`  Catalogue    ${products} products · ${orders} orders`);
  console.log('  ───────────────────────────────────────────');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (OPEN) openBrowser(url);
});

process.on('SIGINT', () => {
  console.log('\nStopping Stockpoint…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
