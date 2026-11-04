/**
 * Shared helpers for the Stockpoint server.
 *
 * No dependencies: this file is deliberately small so the whole API can run on
 * a shop laptop with nothing but Node.js installed.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export class ApiError extends Error {
  constructor(message, status = 400, code = 'bad_request', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const nowIso = () => new Date().toISOString();

export function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function clean(value, max = 160) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

export function multiline(value, max = 600) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function money(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' ? 1 : 0;
}

export function uuid() {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function orderNumber(sequence, date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `MSP-${yy}${mm}${dd}-${String(sequence).padStart(4, '0')}`;
}

export function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

export function verifyPin(pin, salt, expected) {
  try {
    const actual = Buffer.from(hashPin(pin, salt), 'hex');
    const target = Buffer.from(String(expected), 'hex');
    return actual.length === target.length && crypto.timingSafeEqual(actual, target);
  } catch {
    return false;
  }
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function paginate(list, page = 1, pageSize = 50) {
  const safePage = Math.max(1, int(page, 1));
  const safeSize = Math.min(500, Math.max(1, int(pageSize, 50)));
  const start = (safePage - 1) * safeSize;
  return {
    rows: list.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: list.length,
    pages: Math.max(1, Math.ceil(list.length / safeSize)),
  };
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
};

export function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((out, part) => {
      const index = part.indexOf('=');
      if (index === -1) return out;
      out[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return out;
    }, {});
}
