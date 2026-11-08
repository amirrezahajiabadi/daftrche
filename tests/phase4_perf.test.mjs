/* ═══ Phase 4: PDF Reader Memory Management & CSS GPU Optimization Tests ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const { prunePageBuffers, pageBufferMap } = await import('../js/reader.js');

test('PDF Reader: Canvas virtualization frees GPU memory outside the active ±1 page window', () => {
  pageBufferMap.clear();

  // Create mock canvas objects for pages 1 to 5
  const mockCanvases = {};
  for (let p = 1; p <= 5; p++) {
    mockCanvases[p] = { width: 800, height: 1200, style: {} };
    pageBufferMap.set(p, {
      canvas: mockCanvases[p],
      width: 800,
      height: 1200,
    });
  }

  assert.equal(pageBufferMap.size, 5);

  // Active page is 3 -> window should be [2, 3, 4]. Pages 1 and 5 must be pruned.
  prunePageBuffers(3);

  assert.equal(pageBufferMap.size, 3);
  assert.ok(pageBufferMap.has(2));
  assert.ok(pageBufferMap.has(3));
  assert.ok(pageBufferMap.has(4));
  assert.ok(!pageBufferMap.has(1));
  assert.ok(!pageBufferMap.has(5));

  // Verify that canvases for pruned pages had dimensions zeroed to release GPU backing store
  assert.equal(mockCanvases[1].width, 0);
  assert.equal(mockCanvases[1].height, 0);
  assert.equal(mockCanvases[5].width, 0);
  assert.equal(mockCanvases[5].height, 0);

  // Kept canvases still have their dimensions
  assert.equal(mockCanvases[3].width, 800);
  assert.equal(mockCanvases[3].height, 1200);

  // Closing / tearing down reader prunes all buffers (activePage = -999)
  prunePageBuffers(-999);
  assert.equal(pageBufferMap.size, 0);
  assert.equal(mockCanvases[2].width, 0);
  assert.equal(mockCanvases[2].height, 0);
  assert.equal(mockCanvases[3].width, 0);
  assert.equal(mockCanvases[3].height, 0);
  assert.equal(mockCanvases[4].width, 0);
  assert.equal(mockCanvases[4].height, 0);
});

test('CSS GPU Optimization: Backdrop blur values are capped at <= 10px', () => {
  const baseCss = fs.readFileSync(path.join(rootDir, 'css', 'base.css'), 'utf8');
  const glassCss = fs.readFileSync(path.join(rootDir, 'css', 'glass.css'), 'utf8');

  // Verify no blur > 10px in base.css or glass.css
  const blurMatches = (baseCss + '\n' + glassCss).match(/blur\((\d+)px\)/g) || [];
  for (const m of blurMatches) {
    const val = parseInt(m.replace(/[^\d]/g, ''), 10);
    assert.ok(val <= 10, `Backdrop blur value ${m} exceeds GPU limit of 10px`);
  }
});

test('CSS Containment: Independent cards, sheets, and items contain layout and style', () => {
  const componentsCss = fs.readFileSync(path.join(rootDir, 'css', 'components.css'), 'utf8');
  const overlaysCss = fs.readFileSync(path.join(rootDir, 'css', 'overlays.css'), 'utf8');
  const achievementsCss = fs.readFileSync(path.join(rootDir, 'css', 'achievements.css'), 'utf8');
  const libraryCss = fs.readFileSync(path.join(rootDir, 'css', 'library.css'), 'utf8');
  const statsCss = fs.readFileSync(path.join(rootDir, 'css', 'stats.css'), 'utf8');
  const plannerCss = fs.readFileSync(path.join(rootDir, 'css', 'planner.css'), 'utf8');

  assert.match(componentsCss, /\.progress-card\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(componentsCss, /\.week-card\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(componentsCss, /\.vibe-card\s*\{[^}]*contain:\s*layout\s+style/);

  assert.match(overlaysCss, /\.overlay\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(overlaysCss, /\.name-card,\.roll-card,\.focus-card\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(overlaysCss, /\.sheet\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(overlaysCss, /\.note-item\s*\{[^}]*contain:\s*layout\s+style/);

  assert.match(achievementsCss, /\.achv-near-card\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(achievementsCss, /\.achv-item\s*\{[^}]*contain:\s*layout\s+style/);

  assert.match(libraryCss, /\.book-card\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(statsCss, /\.stat-section\s*\{[^}]*contain:\s*layout\s+style/);
  assert.match(plannerCss, /\.wk-row\s*\{[^}]*contain:\s*layout\s+style/);
});

