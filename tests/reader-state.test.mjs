/* ═══ Unit Tests for PDF Reader State & Pure Logic (js/reader-state.js) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HL_PALETTE,
  INK_PALETTE,
  DRAW_WIDTHS,
  HL_WIDTHS,
  PEN_WIDTHS,
  ERASER_RADIUS,
  resolveColor,
  resolveHlRgba,
  nibPx,
  clampPage,
  clampZoom,
  nextZoom,
  calculateSafeScale,
  calcReadingProgress,
  calcGoalProgress,
  calcActiveWindow,
  simplifyStroke,
  strokeHit,
  normalizeStroke,
  formatNotesMarkdown,
} from '../js/reader-state.js';

test('clampPage: clamps correctly across edge cases', () => {
  assert.equal(clampPage(1, 10), 1);
  assert.equal(clampPage(5, 10), 5);
  assert.equal(clampPage(10, 10), 10);
  assert.equal(clampPage(0, 10), 1, 'Page 0 clamps to 1');
  assert.equal(clampPage(-5, 10), 1, 'Negative page clamps to 1');
  assert.equal(clampPage(15, 10), 10, 'Page > total clamps to totalPages');
  assert.equal(clampPage(NaN, 10), 1, 'NaN clamps to 1');
  assert.equal(clampPage('3', 10), 3, 'Numeric string parses properly');
  assert.equal(clampPage(5, 0), 1, 'totalPages 0 clamps to 1');
  assert.equal(clampPage(5, null), 1, 'null totalPages clamps to 1');
});

test('clampZoom & nextZoom: zooms and clamps deterministically', () => {
  assert.equal(clampZoom(1.0), 1.0);
  assert.equal(clampZoom(0.2, 0.5, 3.0), 0.5, 'Under-zoom clamps to min');
  assert.equal(clampZoom(5.0, 0.5, 3.0), 3.0, 'Over-zoom clamps to max');
  assert.equal(clampZoom(NaN, 0.5, 3.0), 1.0, 'NaN fallback to 1.0');

  // nextZoom 'in'
  const inZoom = nextZoom(1.0, 'in', 1.2, 0.5, 3.0);
  assert.equal(inZoom, 1.2);

  // nextZoom 'out'
  const outZoom = nextZoom(1.2, 'out', 1.2, 0.5, 3.0);
  assert.equal(outZoom, 1.0);

  // Boundary clamping
  assert.equal(nextZoom(2.8, 'in', 1.2, 0.5, 3.0), 3.0, 'Caps at max 3.0');
  assert.equal(nextZoom(0.55, 'out', 1.2, 0.5, 3.0), 0.5, 'Floors at min 0.5');
});

test('calculateSafeScale: respects DPR limits and max pixel budgets on low-end hardware', () => {
  // Safe normal screen
  const normal = calculateSafeScale({
    zoom: 1.0,
    dpr: 1.5,
    maxDpr: 2.0,
    maxPixels: 16777216,
    baseWidth: 600,
    baseHeight: 800,
  });
  assert.equal(normal.dpr, 1.5);
  assert.equal(normal.zoom, 1.0);
  assert.equal(normal.isCapped, false);

  // High-DPR phone (e.g. 3.5x or 4x retina) gets capped to maxDpr = 2.0
  const highDpr = calculateSafeScale({
    zoom: 1.0,
    dpr: 4.0,
    maxDpr: 2.0,
    maxPixels: 16777216,
    baseWidth: 600,
    baseHeight: 800,
  });
  assert.equal(highDpr.dpr, 2.0, 'Capped at maxDpr 2.0');
  assert.equal(highDpr.isCapped, true);

  // Massive canvas zoomed in exceeding maxPixels (e.g., 2000x2000 at zoom 3 and dpr 2 = 144 megapixels)
  const huge = calculateSafeScale({
    zoom: 3.0,
    dpr: 2.0,
    maxDpr: 2.0,
    maxPixels: 4000000, // 4 megapixels limit
    baseWidth: 2000,
    baseHeight: 2000,
  });
  assert.ok(huge.isCapped, 'Exceeding budget must trigger cap');
  const estPixels = 2000 * huge.zoom * huge.dpr * (2000 * huge.zoom * huge.dpr);
  assert.ok(estPixels <= 4000000 + 10, 'Total pixels must be within budget');
});

test('calcReadingProgress & calcGoalProgress: calculates percentages accurately', () => {
  assert.equal(calcReadingProgress(0, 100), 0);
  assert.equal(calcReadingProgress(50, 100), 50);
  assert.equal(calcReadingProgress(100, 100), 100);
  assert.equal(calcReadingProgress(150, 100), 100, 'Over 100% is capped at 100');
  assert.equal(calcReadingProgress(10, 0), 0, 'Zero totalPages returns 0');

  assert.equal(calcGoalProgress(0, 10).pct, 0);
  assert.equal(calcGoalProgress(0, 10).achieved, false);
  assert.equal(calcGoalProgress(5, 10).pct, 50);
  assert.equal(calcGoalProgress(5, 10).achieved, false);
  assert.equal(calcGoalProgress(10, 10).pct, 100);
  assert.equal(calcGoalProgress(10, 10).achieved, true);
  assert.equal(calcGoalProgress(15, 10).pct, 100, 'Over-goal is capped at 100');
  assert.equal(calcGoalProgress(15, 10).achieved, true);
  assert.equal(calcGoalProgress(5, 0).pct, 0, 'No daily goal returns 0');
});

test('calcActiveWindow: calculates window bounds and eviction correctly', () => {
  // Start of book: page 1 of 20 with radius 1 -> [1, 2]
  const winStart = calcActiveWindow(1, 20, 1);
  assert.equal(winStart.minPage, 1);
  assert.equal(winStart.maxPage, 2);
  assert.ok(winStart.activePages.has(1));
  assert.ok(winStart.activePages.has(2));
  assert.equal(winStart.isPageActive(1), true);
  assert.equal(winStart.isPageActive(2), true);
  assert.equal(winStart.isPageActive(3), false);

  // Middle of book: page 5 of 20 with radius 1 -> [4, 5, 6]
  const winMid = calcActiveWindow(5, 20, 1);
  assert.equal(winMid.minPage, 4);
  assert.equal(winMid.maxPage, 6);
  assert.ok(winMid.activePages.has(4));
  assert.ok(winMid.activePages.has(5));
  assert.ok(winMid.activePages.has(6));
  assert.equal(winMid.isPageActive(3), false);
  assert.equal(winMid.isPageActive(4), true);
  assert.equal(winMid.isPageActive(5), true);
  assert.equal(winMid.isPageActive(6), true);
  assert.equal(winMid.isPageActive(7), false);

  // End of book: page 20 of 20 with radius 1 -> [19, 20]
  const winEnd = calcActiveWindow(20, 20, 1);
  assert.equal(winEnd.minPage, 19);
  assert.equal(winEnd.maxPage, 20);
  assert.ok(winEnd.activePages.has(19));
  assert.ok(winEnd.activePages.has(20));
  assert.equal(winEnd.isPageActive(18), false);
  assert.equal(winEnd.isPageActive(19), true);
  assert.equal(winEnd.isPageActive(20), true);

  // Single page document
  const winSingle = calcActiveWindow(1, 1, 1);
  assert.ok(winSingle.activePages.has(1));
  assert.equal(winSingle.isPageActive(1), true);
  assert.equal(winSingle.isPageActive(2), false);
});

test('simplifyStroke: compresses collinear and micro-movement points', () => {
  // Empty or tiny stroke
  assert.deepEqual(simplifyStroke([]), []);
  assert.deepEqual(simplifyStroke([{ x: 10, y: 10 }]), [{ x: 10, y: 10 }]);
  assert.deepEqual(
    simplifyStroke([{ x: 10, y: 10 }, { x: 20, y: 20 }]),
    [{ x: 10, y: 10 }, { x: 20, y: 20 }]
  );

  // Collinear points along a straight line: intermediate points should be removed
  const straightLine = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 40, y: 0 },
  ];
  const simplified = simplifyStroke(straightLine, 4);
  assert.equal(simplified.length, 2, 'Collinear line is reduced to start and end points');
  assert.deepEqual(simplified[0], { x: 0, y: 0 });
  assert.deepEqual(simplified[1], { x: 40, y: 0 });

  // A sharp bend (triangle wave) should retain the apex
  const sharpBend = [
    { x: 0, y: 0 },
    { x: 20, y: 50 }, // apex
    { x: 40, y: 0 },
  ];
  const retained = simplifyStroke(sharpBend, 4);
  assert.equal(retained.length, 3, 'Apex of bend is preserved');
});

test('strokeHit: accurate hit-testing for eraser sweeps', () => {
  const stroke = {
    pts: [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
    ],
  };

  // Direct hit on the segment (f = 1)
  assert.ok(strokeHit(stroke, 50, 10, 1), 'Hit directly on segment');
  // Near miss within ERASER_RADIUS (22px)
  assert.ok(strokeHit(stroke, 50, 25, 1), 'Hit within radius (dy = 15 <= 22)');
  // Clean miss outside ERASER_RADIUS (dy = 40 > 22)
  assert.ok(!strokeHit(stroke, 50, 50, 1), 'Miss far outside radius');

  // Single-point dot hit test
  const dotStroke = { pts: [{ x: 50, y: 50 }] };
  assert.ok(strokeHit(dotStroke, 55, 55, 1), 'Hit dot within radius');
  assert.ok(!strokeHit(dotStroke, 100, 100, 1), 'Miss dot outside radius');

  // Empty stroke does not throw and returns false
  assert.equal(strokeHit({ pts: [] }, 10, 10, 1), false);
});

test('resolveColor, resolveHlRgba & nibPx: palette resolutions', () => {
  assert.equal(resolveColor('yellow'), HL_PALETTE.yellow);
  assert.equal(resolveColor('ink-black'), INK_PALETTE['ink-black']);
  assert.equal(resolveColor('#123456'), '#123456');
  assert.equal(resolveColor('rgb(10,20,30)'), 'rgb(10,20,30)');
  assert.equal(resolveColor(''), '#f6c445', 'Default yellow');

  // RGBA conversion for highlights
  assert.equal(resolveHlRgba('#f6c445', 0.5), 'rgba(246,196,69,0.5)');
  assert.equal(resolveHlRgba('yellow', 0.38), 'rgba(246,196,69,0.38)');

  // nibPx sizing
  assert.equal(nibPx('thin', 'draw'), DRAW_WIDTHS.thin);
  assert.equal(nibPx('medium', 'draw'), DRAW_WIDTHS.medium);
  assert.equal(nibPx('thick', 'highlight'), HL_WIDTHS.thick);
  assert.equal(nibPx(12, 'draw'), 12, 'Explicit number untouched');
});

test('normalizeStroke: populates required fields cleanly', () => {
  const norm = normalizeStroke({
    color: 'yellow',
    kind: 'draw',
    pts: [{ x: 5, y: 5 }, { x: 15, y: 15 }],
  }, { curPage: 3, pageScale: 1.5, id: 'test-stroke-1', now: 123456789 });

  assert.equal(norm.id, 'test-stroke-1');
  assert.equal(norm.page, 3);
  assert.equal(norm.scale, 1.5);
  assert.equal(norm.createdAt, 123456789);
  assert.equal(norm.free, true);
  assert.equal(norm.kind, 'draw');
  assert.equal(norm.color, 'yellow');
  assert.equal(norm.note, '');
  assert.equal(norm.pts.length, 2);
});

test('formatNotesMarkdown: generates valid GitHub-flavored Markdown', () => {
  const items = [
    { page: 1, free: true, color: 'ink-blue', note: 'نکته مهم' },
    { page: 2, free: false, text: 'جمله برگزیده از کتاب', note: 'ایده پردازی' },
    { page: 5, free: false, text: 'بخش بدون یادداشت', note: '' },
  ];

  const md = formatNotesMarkdown('کتاب تست', items);
  assert.ok(md.startsWith('# کتاب تست\n\n'));
  assert.ok(md.includes('- صفحه 1: [نشان قلمی - ink-blue] — نکته مهم'));
  assert.ok(md.includes('- صفحه 2: «جمله برگزیده از کتاب» — ایده پردازی'));
  assert.ok(md.includes('- صفحه 5: «بخش بدون یادداشت»'));
});
