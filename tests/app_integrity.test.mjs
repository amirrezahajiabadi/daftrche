/* ═══ App Module Graph & Import Integrity Tests ═══
   Verifies that every named import in the application resolves to an actual export,
   preventing catastrophic startup syntax errors (e.g. unexported renderToday). */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const jsDir = path.join(rootDir, 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && f !== 'version.js');

test('Named imports integrity: every imported symbol must be exported by its target module', async () => {
  // 1. Gather all exports from every module in js/
  const exportsMap = new Map();
  for (const f of files) {
    const fileUrl = pathToFileURL(path.join(jsDir, f)).href;
    try {
      const mod = await import(fileUrl);
      exportsMap.set(f, Object.keys(mod));
    } catch (e) {
      // If a module cannot be evaluated directly in Node due to DOM globals, we extract its export statements statically
      const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
      const staticExports = new Set();
      // Match export function foo, export const bar, export { baz, qux }
      const funcMatch = code.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([a-zA-Z0-9_$]+)/g);
      for (const m of funcMatch) staticExports.add(m[1]);
      const varMatch = code.matchAll(/export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g);
      for (const m of varMatch) staticExports.add(m[1]);
      const blockMatch = code.matchAll(/export\s+\{([^}]+)\}/g);
      for (const m of blockMatch) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) staticExports.add(name);
        }
      }
      exportsMap.set(f, Array.from(staticExports));
    }
  }

  // 2. Verify all import statements in each js file
  const errors = [];
  for (const f of files) {
    const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"](\.\/[^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      const specifiers = match[1].split(',').map(s => s.trim()).filter(Boolean);
      const targetRel = match[2];
      const targetFile = path.basename(targetRel);
      if (!exportsMap.has(targetFile)) continue;
      const targetExports = exportsMap.get(targetFile);

      for (const spec of specifiers) {
        const importedName = spec.split(/\s+as\s+/)[0].trim();
        if (!targetExports.includes(importedName)) {
          errors.push(`In ${f}: '${importedName}' is imported from '${targetRel}', but '${targetFile}' does not export it.`);
        }
      }
    }
  }

  assert.deepEqual(errors, [], `Broken imports found:\n${errors.join('\n')}`);
});

test('today.js exports renderToday, todayPending, todayDone, and initToday', async () => {
  const todayMod = await import('../js/today.js');
  assert.equal(typeof todayMod.renderToday, 'function', 'today.js must export renderToday');
  assert.equal(typeof todayMod.todayPending, 'function', 'today.js must export todayPending');
  assert.equal(typeof todayMod.todayDone, 'function', 'today.js must export todayDone');
  assert.equal(typeof todayMod.initToday, 'function', 'today.js must export initToday');
});

