#!/usr/bin/env node
/**
 * Static sanity checks for the docs/ front-end (no build step exists):
 *   1. every relative import resolves to a file on disk
 *   2. every named import is actually exported by the target module
 *   3. manifest + sw.js reference files that exist
 *
 * Usage: node scripts/check-js.mjs   (exit code 1 on failure)
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

const files = walk(join(docs, 'js')).filter((f) => !f.includes('check'));

/** Collect exported binding names of one module (best-effort regex). */
function exportsOf(file) {
  const source = readFileSync(file, 'utf8');
  const names = new Set();
  const exportBraces = source.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of exportBraces) {
    for (const part of match[1].split(',')) {
      const name = part.split(' as ')[0].trim();
      if (name && !name.startsWith('default')) names.add(name);
    }
  }
  const decls = source.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  );
  for (const match of decls) names.add(match[1]);
  if (/\nexport const api =/.test(source)) names.add('api'); // declared as `export const api = {`
  if (/export\s+default\s+api\s*;/.test(source)) names.add('default');
  if (/export\s*\{\s*[A-Za-z_$][\w$]*\s+as\s+default\s*\}/.test(source)) names.add('default');
  return names;
}

const exportCache = new Map();
let problems = 0;
const fail = (message) => {
  problems += 1;
  console.error(`✗ ${message}`);
};

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const relative = file.slice(root.length + 1);

  const imports = source.matchAll(/import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/g);
  for (const match of imports) {
    const [, defaultName, namedRaw, namespace, defaultOnly, reference] = match;
    if (!reference.startsWith('.')) continue;

    const target = resolve(dirname(file), reference);
    if (!existsSync(target)) {
      fail(`${relative}: import of missing file ${reference}`);
      continue;
    }

    if (defaultName && !'api'.includes(defaultName) && defaultName !== 'api') {
      // default imports only used for `api` (checked below via named)
    }
    if (!defaultName && !namedRaw && !namespace && defaultOnly) {
      const names = exportCache.get(target) || exportsOf(target);
      exportCache.set(target, names);
      if (!names.has('default')) fail(`${relative}: ${reference} has no default export`);
    }
    if (namespace) continue;

    if (namedRaw) {
      const names = exportCache.get(target) || exportsOf(target);
      exportCache.set(target, names);
      const wanted = new Map();
      for (const part of namedRaw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('type ')) continue;
        const [bound, imported] = trimmed.replace(/[{}]/g, '').split(/\s+as\s+/);
        wanted.set((bound || '').trim(), (imported || bound || '').trim());
      }
      for (const [localName, importedName] of wanted) {
        if (/^api$/.test(importedName)) {
          if (!names.has('api')) fail(`${relative}: { api } not exported from ${reference}`);
          continue;
        }
        if (['default'].includes(importedName)) continue;
        if (importedName === '$' || importedName === '$$') {
          if (!names.has(importedName)) fail(`${relative}: { ${importedName} } not exported from ${reference}`);
          continue;
        }
        if (!names.has(importedName)) {
          fail(`${relative}: { ${importedName} } not exported from ${reference} (bound locally as ${localName})`);
        }
      }
    }
  }
}

// shell references: service worker + manifest
const swPath = join(docs, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const entries = [...sw.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]);
  for (const entry of new Set(entries)) {
    if (!existsSync(join(docs, entry))) fail(`sw.js precache lists missing file: ${entry}`);
  }
}

const manifestPath = join(docs, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [key, value] of Object.entries({ ...manifest.icons.map ? {} : {}, ...manifest })) {
    if (key === 'icons' && Array.isArray(manifest.icons)) {
      for (const icon of manifest.icons) {
        if (icon.src && !existsSync(join(docs, icon.src))) fail(`manifest icon missing: ${icon.src}`);
      }
    }
    if (key === 'shortcuts' && Array.isArray(manifest.shortcuts)) {
      for (const shortcut of manifest.shortcuts) {
        const route = String(shortcut.url || '');
        if (route.startsWith('./#/')) {
          // pass-through; syntax check only for documents
        } else {
          fail(`manifest shortcut URL should start with ./#/: ${route}`);
        }
      }
    }
  }
}

const indexExists = existsSync(join(docs, 'index.html'));
if (!indexExists) fail('docs/index.html missing');

if (problems) {
  console.error(`\n${problems} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ ${files.length} module files — imports, exports and shell references all resolve.`);
