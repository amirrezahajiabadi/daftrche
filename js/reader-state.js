/* ═══ PDF Reader State, Pure Calculations & Geometries ═══
   Pure, deterministic logic layer for the reader:
     · Page bounds & zoom level clamping
     · Safe DPR and scale budgeting for low-end device GPU protection
     · Active viewport window calculation (canvas virtualization)
     · Reading progress & daily goal calculations
     · Freehand stroke simplification & eraser collision hit-testing
     · Normalization & serialization for highlights, notes, and freehand marks
   Zero DOM coupling — 100% testable in Node.js.
*/

/* ── Palettes & Dimensions ── */
export const HL_PALETTE = {
  yellow: '#f6c445',
  green: '#7ed992',
  blue: '#74b9ff',
  pink: '#f78fb3',
  purple: '#b892ff',
  orange: '#ff9f68',
  teal: '#48dbfb',
  red: '#ff6b6b',
};

export const INK_PALETTE = {
  'ink-black': '#1e242b',
  'ink-blue': '#1d4ed8',
  'ink-red': '#dc2626',
  'ink-green': '#15803d',
  'ink-purple': '#6d28d9',
  'ink-brown': '#854d0e',
  'ink-orange': '#ea580c',
  'ink-white': '#f8fafc',
};

export const STROKE_COLORS = { ...HL_PALETTE, ...INK_PALETTE };
export const HL_COLORS = { ...HL_PALETTE };

export const DRAW_WIDTHS = { thin: 2, medium: 4, thick: 8, xthick: 14 };
export const HL_WIDTHS = { thin: 10, medium: 16, thick: 24, xthick: 34 };
export const PEN_WIDTHS = { thin: 4, medium: 8, thick: 14, xthick: 22 };

export const PAGE_WINDOW_RADIUS = 1;
export const ERASER_RADIUS = 22;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 3.5;

/**
 * Resolves a named color token or hex string to a valid CSS color string.
 * @param {string} c
 * @returns {string}
 */
export function resolveColor(c) {
  if (!c) return '#f6c445';
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return INK_PALETTE[c] || HL_PALETTE[c] || STROKE_COLORS[c] || c;
}

/**
 * Converts a hex color into an RGBA color string with specified alpha.
 * @param {string} c
 * @param {number} [alpha=0.38]
 * @returns {string}
 */
export function resolveHlRgba(c, alpha = 0.38) {
  const hex = resolveColor(c);
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

/**
 * Returns pixel width of a stroke based on line width key and tool kind.
 * @param {string|number} w
 * @param {'draw'|'highlight'} kind
 * @returns {number}
 */
export function nibPx(w, kind) {
  if (typeof w === 'number') return w;
  const isDraw = kind === 'draw';
  if (isDraw) return DRAW_WIDTHS[w] || DRAW_WIDTHS.medium;
  return HL_WIDTHS[w] || HL_WIDTHS.medium;
}

/**
 * Clamps a page number between 1 and totalPages.
 * @param {number} page
 * @param {number} totalPages
 * @returns {number}
 */
export function clampPage(page, totalPages) {
  const tot = Number.isInteger(Number(totalPages)) && Number(totalPages) > 0 ? Number(totalPages) : 1;
  const p = Number.isInteger(Number(page)) ? Number(page) : 1;
  return Math.max(1, Math.min(p, tot));
}

/**
 * Clamps a zoom level between min and max bounds.
 * @param {number} zoom
 * @param {number} [min=MIN_ZOOM]
 * @param {number} [max=MAX_ZOOM]
 * @returns {number}
 */
export function clampZoom(zoom, min = MIN_ZOOM, max = MAX_ZOOM) {
  const z = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  return Math.max(min, Math.min(z, max));
}

/**
 * Calculates next stepped zoom level.
 * @param {number} current
 * @param {'in'|'out'} direction
 * @param {number} [factor=1.2]
 * @param {number} [min=MIN_ZOOM]
 * @param {number} [max=MAX_ZOOM]
 * @returns {number}
 */
export function nextZoom(current, direction = 'in', factor = 1.2, min = MIN_ZOOM, max = MAX_ZOOM) {
  const cur = clampZoom(current, min, max);
  if (direction === 'in') return clampZoom(cur * factor, min, max);
  return clampZoom(cur / factor, min, max);
}

/**
 * Calculates safe DPR and scale for low-end device memory protection.
 * Prevents Canvas pixel buffers from exceeding safe mobile GPU limits (e.g. 16 megapixels).
 * @param {Object} [options]
 * @param {number} [options.zoom=1]
 * @param {number} [options.dpr=1]
 * @param {number} [options.maxDpr=2]
 * @param {number} [options.maxPixels=16777216] 4096 x 4096 standard mobile limit
 * @param {number} [options.baseWidth=800]
 * @param {number} [options.baseHeight=1200]
 * @returns {{ zoom: number, dpr: number, effectiveScale: number, isCapped: boolean }}
 */
export function calculateSafeScale({
  zoom = 1,
  dpr = 1,
  maxDpr = 2,
  maxPixels = 16777216,
  baseWidth = 800,
  baseHeight = 1200,
} = {}) {
  let validZoom = clampZoom(zoom);
  const rawDpr = Number.isFinite(Number(dpr)) && Number(dpr) > 0 ? Number(dpr) : 1;
  let cappedDpr = Math.min(rawDpr, maxDpr);
  let isCapped = rawDpr > maxDpr;

  // Check if pixel budget is exceeded at current zoom * dpr
  const estWidth = baseWidth * validZoom * cappedDpr;
  const estHeight = baseHeight * validZoom * cappedDpr;
  const totalPixels = estWidth * estHeight;

  if (totalPixels > maxPixels && totalPixels > 0) {
    const scaleFactor = Math.sqrt(maxPixels / totalPixels);
    if (cappedDpr * scaleFactor >= 1) {
      cappedDpr *= scaleFactor;
    } else {
      cappedDpr = 1;
      const baseArea = baseWidth * baseHeight;
      if (baseArea > 0) {
        validZoom = Math.min(validZoom, Math.sqrt(maxPixels / baseArea));
      }
    }
    isCapped = true;
  }

  return {
    zoom: validZoom,
    dpr: cappedDpr,
    effectiveScale: validZoom * cappedDpr,
    isCapped,
  };
}

/**
 * Computes reading progress percentage based on completed page count and total pages.
 * @param {number} completedCount
 * @param {number} totalPages
 * @returns {number}
 */
export function calcReadingProgress(completedCount, totalPages) {
  const tot = Number(totalPages);
  if (!Number.isFinite(tot) || tot <= 0) return 0;
  const done = Number.isFinite(Number(completedCount)) && Number(completedCount) > 0 ? Number(completedCount) : 0;
  return Math.min(100, Math.max(0, Math.round((done / tot) * 100)));
}

/**
 * Computes daily reading goal progress and completion state.
 * @param {number} todayPages
 * @param {number|null} pagesPerDay
 * @returns {{ pct: number, achieved: boolean, pages: number, target: number|null }}
 */
export function calcGoalProgress(todayPages, pagesPerDay) {
  const target = Number.isFinite(Number(pagesPerDay)) && Number(pagesPerDay) > 0 ? Math.floor(Number(pagesPerDay)) : null;
  const pages = Number.isFinite(Number(todayPages)) && Number(todayPages) > 0 ? Math.floor(Number(todayPages)) : 0;
  if (!target) return { pct: 0, achieved: false, pages, target: null };
  const pct = Math.min(100, Math.max(0, Math.round((pages / target) * 100)));
  return { pct, achieved: pages >= target, pages, target };
}

/**
 * Computes active window range for canvas virtualization.
 * Pages outside [minPage, maxPage] must be evicted from GPU memory.
 * @param {number} activePage
 * @param {number} totalPages
 * @param {number} [bufferRadius=PAGE_WINDOW_RADIUS]
 * @returns {{ minPage: number, maxPage: number, activePages: Set<number>, isPageActive: (p: number) => boolean }}
 */
export function calcActiveWindow(activePage, totalPages, bufferRadius = PAGE_WINDOW_RADIUS) {
  const tot = Number.isInteger(Number(totalPages)) && Number(totalPages) > 0 ? Number(totalPages) : 1;
  const cur = Number.isInteger(Number(activePage)) ? Number(activePage) : -999;

  if (cur <= 0 || cur > tot) {
    return {
      minPage: 0,
      maxPage: 0,
      activePages: new Set(),
      isPageActive: () => false,
    };
  }

  const minPage = Math.max(1, cur - bufferRadius);
  const maxPage = Math.min(tot, cur + bufferRadius);
  const activePages = new Set();
  for (let p = minPage; p <= maxPage; p++) activePages.add(p);

  return {
    minPage,
    maxPage,
    activePages,
    isPageActive: p => activePages.has(Number(p)),
  };
}

/**
 * Douglas-Peucker-lite point reduction for recorded stroke trails.
 * Keeps points that bend the trail by more than toleranceSq px.
 * @param {Array<{x: number, y: number}>} pts
 * @param {number} [toleranceSq=4]
 * @returns {Array<{x: number, y: number}>}
 */
export function simplifyStroke(pts, toleranceSq = 4) {
  if (!Array.isArray(pts) || pts.length < 3) return Array.isArray(pts) ? pts.slice() : [];
  const out = [pts[0]];
  let lastA = pts[0], lastB = pts[1];
  for (let i = 2; i < pts.length; i++) {
    const p = pts[i];
    const dx = lastB.x - lastA.x, dy = lastB.y - lastA.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = ((p.x - lastA.x) * dx + (p.y - lastA.y) * dy) / len2;
    const projX = lastA.x + t * dx;
    const projY = lastA.y + t * dy;
    const distSq = (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
    if (distSq > toleranceSq) {
      out.push(p);
      lastA = lastB;
      lastB = p;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Hit-tests whether a pointer position intersects with any line segment of a stroke.
 * @param {Object} h Highlight/stroke record
 * @param {number} px Pointer X in page space
 * @param {number} py Pointer Y in page space
 * @param {number} f Scale factor (pageScale / recordedScale)
 * @param {number} [radius=ERASER_RADIUS]
 * @returns {boolean}
 */
export function strokeHit(h, px, py, f, radius = ERASER_RADIUS) {
  if (!h || typeof h !== 'object') return false;
  const pts = h.pts || [];
  if (pts.length < 2) {
    if (!pts.length) return false;
    const dx = pts[0].x * f - px, dy = pts[0].y * f - py;
    return dx * dx + dy * dy <= radius * radius;
  }
  const r2 = radius * radius;
  let ax = pts[0].x * f, ay = pts[0].y * f;
  for (let i = 1; i < pts.length; i++) {
    const bx = pts[i].x * f, by = pts[i].y * f;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    if (ex * ex + ey * ey <= r2) return true;
    ax = bx;
    ay = by;
  }
  return false;
}

/**
 * Validates and normalizes a freehand stroke before persistence.
 * @param {Object} stroke
 * @param {Object} context
 * @returns {Object|null}
 */
export function normalizeStroke(stroke, { curPage = 1, pageScale = 1, id = null, now = Date.now() } = {}) {
  if (!stroke || typeof stroke !== 'object') return null;
  const pts = simplifyStroke(stroke.pts);
  if (pts.length < 2) return null;
  return {
    id: id || stroke.id || (now + '' + Math.random().toString(16).slice(2)),
    page: Number(stroke.page) || curPage,
    text: '',
    color: stroke.color || 'yellow',
    kind: stroke.kind === 'draw' ? 'draw' : 'highlight',
    free: true,
    pts,
    width: stroke.width || HL_WIDTHS.medium,
    scale: Number(stroke.scale) || pageScale,
    note: stroke.note || '',
    createdAt: Number(stroke.createdAt) || now,
  };
}

/**
 * Formats annotations and notes into a Markdown document for export.
 * @param {string} title
 * @param {Array<Object>} items
 * @returns {string}
 */
export function formatNotesMarkdown(title, items = []) {
  let md = `# ${title || 'یادداشت‌های کتاب'}\n\n`;
  (Array.isArray(items) ? items : []).forEach(it => {
    if (!it) return;
    if (it.free) {
      md += `- صفحه ${it.page}: [نشان قلمی - ${it.color || 'سفارشی'}]${it.note ? ` — ${it.note}` : ''}\n`;
    } else {
      md += `- صفحه ${it.page}: «${it.text || ''}»${it.note ? ` — ${it.note}` : ''}\n`;
    }
  });
  return md;
}
