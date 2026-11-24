/* ═══ PDF Reader Annotations, Highlights, Notes & Freehand Layer ═══
   Encapsulates:
     · Dual Annotation Engine: Fine-tip Pen (Draw) vs. Chisel-tip Highlighter
     · Text Selection Highlights & Toolbar Positioning
     · Freehand Stroke Capture, Simplification & Bézier Painting
     · Eraser Hit-Testing & Multi-Level Undo Toast
     · Notes Creation, Sheet Listing & Markdown Export
*/

import { $, faNum, esc, nextId } from './utils.js';
import { STORAGE_KEYS, LIB_ICONS } from './constants.js';
import { showNotice } from './dialog.js';
import { safeSet, readString } from './store.js';
import { saveAndShareBlob } from './native.js';
import {
  HL_PALETTE,
  INK_PALETTE,
  STROKE_COLORS,
  HL_COLORS,
  DRAW_WIDTHS,
  HL_WIDTHS,
  PEN_WIDTHS,
  ERASER_RADIUS,
  resolveColor,
  resolveHlRgba,
  nibPx,
  simplifyStroke,
  strokeHit,
  formatNotesMarkdown,
} from './reader-state.js';

export {
  HL_PALETTE,
  INK_PALETTE,
  STROKE_COLORS,
  HL_COLORS,
  DRAW_WIDTHS,
  HL_WIDTHS,
  PEN_WIDTHS,
  ERASER_RADIUS,
  resolveColor,
  resolveHlRgba,
  nibPx,
};

/* ── Annotation Engine State ── */
let curBookFn = null;
let curPageFn = null;
let pageScaleFn = null;
let engineFn = null;
let onUpdateBookFn = null;
let onUpdatePageUIFn = null;
let onGotoPageFn = null;
let isPenPopHiddenFn = null;
let openPenPopFn = null;
let toggleDockPopFn = null;

let toolMode = null; /* 'highlight' | 'draw' | null */
let penActive = false;
let activeWidthKey = 'medium';
let hlColor = 'yellow';
let inkColor = 'ink-black';
let strokeColor = 'yellow';
let strokeWidth = HL_WIDTHS.medium;

let drawCtx = null;
let drawStroke = null;
let penHintShown = false;
let hintTimer = null;

let eraseActive = false;
let erasing = false;
let erasedStrokes = null;
let eraseUndoTimer = null;
let penPopPress = null;

let lastSelectionRects = null;
let pendingNoteHl = null;

export function getToolMode() { return toolMode; }
export function isPenActive() { return penActive; }
export function isEraseActive() { return eraseActive; }
export function getActiveWidthKey() { return activeWidthKey; }
export function getHlColor() { return hlColor; }
export function getInkColor() { return inkColor; }
export function getStrokeColor() { return strokeColor; }
export function getDrawCtx() { return drawCtx; }

export function initAnnotations(bindings) {
  curBookFn = bindings.getCurBook;
  curPageFn = bindings.getCurPage;
  pageScaleFn = bindings.getPageScale;
  engineFn = bindings.getEngine;
  onUpdateBookFn = bindings.onUpdateBook;
  onUpdatePageUIFn = bindings.onUpdatePageUI;
  onGotoPageFn = bindings.onGotoPage;
  isPenPopHiddenFn = bindings.isPenPopHidden;
  openPenPopFn = bindings.openPenPop;
  toggleDockPopFn = bindings.toggleDockPop;

  bindAnnotationUI();
  restorePenPrefs();
}

export function restorePenPrefs() {
  const savedWidth = readString(STORAGE_KEYS.penWidth);
  if (savedWidth && DRAW_WIDTHS[savedWidth]) activeWidthKey = savedWidth;
  syncPenUI();
}

export function syncPenUI() {
  if (typeof document === 'undefined') return;
  const isDraw = toolMode === 'draw';
  strokeColor = isDraw ? inkColor : hlColor;
  strokeWidth = isDraw
    ? (DRAW_WIDTHS[activeWidthKey] || DRAW_WIDTHS.medium)
    : (HL_WIDTHS[activeWidthKey] || HL_WIDTHS.medium);

  const tabHl = $('#subribbonHlTab');
  const tabPen = $('#subribbonPenTab');
  if (tabHl) {
    tabHl.classList.toggle('on', !isDraw);
    tabHl.setAttribute('aria-selected', String(!isDraw));
  }
  if (tabPen) {
    tabPen.classList.toggle('on', isDraw);
    tabPen.setAttribute('aria-selected', String(isDraw));
  }

  const hlSwatches = $('#hlColorSwatches');
  const inkSwatches = $('#inkColorSwatches');
  if (hlSwatches) hlSwatches.hidden = isDraw;
  if (inkSwatches) inkSwatches.hidden = !isDraw;

  document.querySelectorAll('#hlColorSwatches .hl-dot').forEach(d => {
    d.classList.toggle('sel', d.dataset.color === hlColor);
  });
  document.querySelectorAll('#inkColorSwatches .hl-dot').forEach(d => {
    d.classList.toggle('sel', d.dataset.color === inkColor);
  });

  document.querySelectorAll('#penWidths .pen-width').forEach(c => {
    const on = c.dataset.width === activeWidthKey;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  });

  const penInd = $('#penIndicator');
  if (penInd) {
    penInd.style.background = resolveColor(inkColor);
  }
  const hlInd = $('#hlIndicator');
  if (hlInd) {
    hlInd.style.background = resolveColor(hlColor);
  }

  const dp = $('#dockPen');
  if (dp) dp.style.setProperty('--pen-c', resolveColor(inkColor));
  const hp = $('#hlTool');
  if (hp) hp.style.setProperty('--hl-c', resolveColor(hlColor));

  const penCustom = $('#customPenColor');
  if (penCustom) {
    penCustom.parentElement?.classList.toggle('on', inkColor.startsWith('#') && !INK_PALETTE[inkColor]);
    if (inkColor.startsWith('#')) penCustom.value = inkColor;
  }
  const hlCustom = $('#customHlPicker');
  if (hlCustom) {
    hlCustom.parentElement?.classList.toggle('on', hlColor.startsWith('#') && !HL_PALETTE[hlColor]);
    if (hlColor.startsWith('#')) hlCustom.value = hlColor;
  }
}

export function syncDrawExtras() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  const hasMarks = (curBook?.highlights || []).some(h => h.page === curPage);
  $('#drawGroup')?.classList.toggle('show-extras', Boolean(penActive || eraseActive || hasMarks));
}

export function setToolMode(mode) {
  if (mode === toolMode) mode = null;
  toolMode = mode;
  penActive = Boolean(mode);
  if (eraseActive && penActive) toggleEraser(false);

  const hlTool = $('#hlTool');
  const dockPen = $('#dockPen');
  if (hlTool) {
    const isHl = toolMode === 'highlight';
    hlTool.classList.toggle('on', isHl);
    hlTool.setAttribute('aria-pressed', String(isHl));
  }
  if (dockPen) {
    const isDraw = toolMode === 'draw';
    dockPen.classList.toggle('on', isDraw);
    dockPen.setAttribute('aria-pressed', String(isDraw));
  }

  const penPop = $('#penPop');
  if (penPop) penPop.hidden = !penActive;
  $('#penPopToggle')?.setAttribute('aria-expanded', String(penActive && !!penPop && !penPop.hidden));
  $('#drawLayer')?.classList.toggle('pen-on', penActive);
  $('#textLayer')?.classList.toggle('pen-off', toolMode === 'draw');

  if (penActive) {
    if (toggleDockPopFn) toggleDockPopFn(null);
    prepareDrawCanvas();
    const engine = engineFn ? engineFn() : 'internal';
    if (!penHintShown && engine === 'internal') {
      penHintShown = true;
      const hint = $('#readerHint');
      if (hint) {
        hint.textContent = toolMode === 'draw'
          ? 'قلم تحریری آماده است — روی صفحه خط بکش یا یادداشت کن'
          : 'هایلایتر آماده است — روی متن یا صفحه بکش';
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => { hint.hidden = true; }, 4000);
      }
    }
  } else {
    drawStroke = null;
    const hint = $('#readerHint');
    if (hint) hint.hidden = true;
  }
  syncPenUI();
  syncDrawExtras();
}

export function togglePen(force) {
  if (typeof force === 'boolean') {
    setToolMode(force ? (toolMode || 'draw') : null);
    return;
  }
  if (toolMode === 'draw' && isPenPopHiddenFn && isPenPopHiddenFn()) {
    if (openPenPopFn) openPenPopFn();
    return;
  }
  setToolMode(toolMode === 'draw' ? null : 'draw');
}

export function toggleHighlight(force) {
  if (typeof force === 'boolean') {
    setToolMode(force ? (toolMode || 'highlight') : null);
    return;
  }
  if (toolMode === 'highlight' && isPenPopHiddenFn && isPenPopHiddenFn()) {
    if (openPenPopFn) openPenPopFn();
    return;
  }
  setToolMode(toolMode === 'highlight' ? null : 'highlight');
}

export function toggleEraser(force) {
  const target = typeof force === 'boolean' ? force : !eraseActive;
  eraseActive = target;
  if (eraseActive && penActive) setToolMode(null);
  const btn = $('#eraserTool');
  if (btn) {
    btn.classList.toggle('on', eraseActive);
    btn.setAttribute('aria-pressed', String(eraseActive));
    btn.title = eraseActive ? 'پاک‌کن روشنه — برای خاموش کردن دوباره بزن' : 'پاک‌کن — روی خط بکش تا پاک شه';
  }
  $('#drawLayer')?.classList.toggle('eraser-on', eraseActive);
  if (eraseActive) {
    if (toggleDockPopFn) toggleDockPopFn(null);
    prepareDrawCanvas();
  } else if (erasing) {
    endErase();
  }
  syncDrawExtras();
}

export function undoLastStroke() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  if (!curBook || !curBook.highlights || !curBook.highlights.length) return;
  let lastIdx = -1;
  for (let i = curBook.highlights.length - 1; i >= 0; i--) {
    if (curBook.highlights[i].page === curPage) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return;
  const removed = curBook.highlights.splice(lastIdx, 1)[0];
  if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: curBook.highlights });
  paintHighlights();
  if (onUpdatePageUIFn) onUpdatePageUIFn();
  erasedStrokes = { page: curPage, items: [{ h: removed, index: lastIdx }] };
  showEraseUndo();
}

export function clearPageStrokes() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  if (!curBook) return;
  const keep = [];
  const items = [];
  (curBook.highlights || []).forEach((h, i) => {
    if (h.page === curPage) items.push({ h, index: i });
    else keep.push(h);
  });
  if (items.length) {
    erasedStrokes = { page: curPage, items };
    curBook.highlights = keep;
    if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: keep });
    paintHighlights();
    if (onUpdatePageUIFn) onUpdatePageUIFn();
    showEraseUndo();
  }
}

export function prepareDrawCanvas(force = false) {
  const dl = $('#drawLayer');
  const wrap = $('#pageWrap');
  if (!dl || !wrap) return;
  const w = wrap.offsetWidth;
  const h = wrap.offsetHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);
  if (force || dl.width !== targetW || dl.height !== targetH) {
    dl.width = targetW;
    dl.height = targetH;
    dl.style.width = w + 'px';
    dl.style.height = h + 'px';
    drawCtx = dl.getContext('2d');
  }
}

export function clearDrawCanvas() {
  const dl = $('#drawLayer');
  if (drawCtx && dl) drawCtx.clearRect(0, 0, dl.width, dl.height);
}

export function paintHighlights() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  const pageScale = pageScaleFn ? pageScaleFn() : 1;
  const layer = $('#highlightLayer');
  if (layer) layer.innerHTML = '';
  if (!curBook) return;

  const dl = $('#drawLayer');
  if (drawCtx && dl) {
    drawCtx.clearRect(0, 0, dl.width, dl.height);
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    drawCtx.scale(dpr, dpr);
  }

  (curBook.highlights || []).filter(h => h && h.page === curPage).forEach(h => {
    const f = h.scale ? pageScale / h.scale : 1;
    if (h.free) {
      if (drawCtx) {
        const isDraw = h.kind === 'draw';
        drawCtx.save();
        drawCtx.strokeStyle = resolveColor(h.color);
        drawCtx.globalAlpha = isDraw ? 1.0 : 0.38;
        drawCtx.lineWidth = nibPx(h.width, h.kind);
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';

        const pts = h.pts || [];
        if (pts.length === 1) {
          drawCtx.beginPath();
          drawCtx.arc(pts[0].x * f, pts[0].y * f, drawCtx.lineWidth / 2, 0, Math.PI * 2);
          drawCtx.fillStyle = drawCtx.strokeStyle;
          drawCtx.fill();
        } else if (pts.length === 2) {
          drawCtx.beginPath();
          drawCtx.moveTo(pts[0].x * f, pts[0].y * f);
          drawCtx.lineTo(pts[1].x * f, pts[1].y * f);
          drawCtx.stroke();
        } else if (pts.length > 2) {
          drawCtx.beginPath();
          drawCtx.moveTo(pts[0].x * f, pts[0].y * f);
          for (let i = 1; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const midX = ((p1.x + p2.x) / 2) * f;
            const midY = ((p1.y + p2.y) / 2) * f;
            drawCtx.quadraticCurveTo(p1.x * f, p1.y * f, midX, midY);
          }
          const last = pts[pts.length - 1];
          drawCtx.lineTo(last.x * f, last.y * f);
          drawCtx.stroke();
        }
        drawCtx.restore();
      }
      return;
    }
    if (layer) {
      (h.rects || []).forEach(r => {
        const d = document.createElement('i');
        d.style.left = +(r.x * f).toFixed(2) + 'px';
        d.style.top = +(r.y * f).toFixed(2) + 'px';
        d.style.width = +(r.w * f).toFixed(2) + 'px';
        d.style.height = +(r.h * f).toFixed(2) + 'px';
        d.style.background = resolveHlRgba(h.color, 0.38);
        if (h.note) d.classList.add('has-note');
        d.title = h.note ? 'یادداشت: ' + h.note : '';
        layer.appendChild(d);
      });
    }
  });
}

function penPos(e) {
  const r = $('#drawLayer').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startPenStroke(e) {
  if (!penActive || eraseActive || e.button > 0) return;
  const p = penPos(e);
  drawStroke = {
    pts: [p],
    color: strokeColor,
    kind: toolMode === 'draw' ? 'draw' : 'highlight',
    width: strokeWidth,
  };
  $('#drawLayer').setPointerCapture?.(e.pointerId);
  paintStrokeLive();
}

function paintStrokeLive() {
  if (!drawCtx || !drawStroke) return;
  const isDraw = drawStroke.kind === 'draw';
  drawCtx.save();
  drawCtx.strokeStyle = resolveColor(drawStroke.color);
  drawCtx.globalAlpha = isDraw ? 1.0 : 0.38;
  drawCtx.lineWidth = nibPx(drawStroke.width, drawStroke.kind);
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  const pts = drawStroke.pts;
  const n = pts.length;
  if (n === 1) {
    drawCtx.beginPath();
    drawCtx.arc(pts[0].x, pts[0].y, drawCtx.lineWidth / 2, 0, Math.PI * 2);
    drawCtx.fillStyle = drawCtx.strokeStyle;
    drawCtx.fill();
  } else if (n === 2) {
    drawCtx.beginPath();
    drawCtx.moveTo(pts[0].x, pts[0].y);
    drawCtx.lineTo(pts[1].x, pts[1].y);
    drawCtx.stroke();
  } else if (n > 2) {
    const p0 = pts[n - 3];
    const p1 = pts[n - 2];
    const p2 = pts[n - 1];
    const startX = (p0.x + p1.x) / 2;
    const startY = (p0.y + p1.y) / 2;
    const endX = (p1.x + p2.x) / 2;
    const endY = (p1.y + p2.y) / 2;
    drawCtx.beginPath();
    drawCtx.moveTo(startX, startY);
    drawCtx.quadraticCurveTo(p1.x, p1.y, endX, endY);
    drawCtx.stroke();
  }
  drawCtx.restore();
}

function penMove(e) {
  if (penPopPress && e.pointerId === penPopPress.id) {
    const dx = e.clientX - penPopPress.x;
    const dy = e.clientY - penPopPress.y;
    if (dx * dx + dy * dy > 36) {
      const ev = penPopPress.ev;
      penPopPress = null;
      $('#penPop').hidden = true;
      startPenStroke(ev);
    }
  }
  if (!penActive || eraseActive || !drawStroke) return;
  drawStroke.pts.push(penPos(e));
  paintStrokeLive();
}

function penEnd(e) {
  if (e && penPopPress && e.pointerId === penPopPress.id) penPopPress = null;
  if (eraseActive || !drawStroke) return;
  const s = drawStroke;
  drawStroke = null;
  const pts = simplifyStroke(s.pts);
  if (pts.length < 2) { clearDrawCanvas(); return; }

  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  const pageScale = pageScaleFn ? pageScaleFn() : 1;
  if (!curBook) return;

  curBook.highlights = curBook.highlights || [];
  curBook.highlights.push({
    id: nextId(),
    page: curPage,
    text: '',
    color: s.color,
    kind: s.kind || 'draw',
    free: true,
    pts,
    width: s.width,
    scale: pageScale,
    note: '',
    createdAt: Date.now(),
  });
  if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: curBook.highlights });
  clearDrawCanvas();
  paintHighlights();
  if (onUpdatePageUIFn) onUpdatePageUIFn();
}

/* ── Eraser Logic ── */
function startErase(e) {
  if (!eraseActive || e.button > 0) return;
  erasing = true;
  eraseCursor(e);
  eraseAt(e);
  $('#drawLayer')?.setPointerCapture?.(e.pointerId);
}

function eraseAt(e) {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  const pageScale = pageScaleFn ? pageScaleFn() : 1;
  if (!curBook || !curBook.highlights) return;

  const p = penPos(e);
  const px = p.x;
  const py = p.y;
  const keep = [];
  const hit = [];

  curBook.highlights.forEach((h, index) => {
    if (h.page !== curPage) { keep.push(h); return; }
    const f = h.scale ? pageScale / h.scale : 1;
    if (strokeHit(h, px, py, f, ERASER_RADIUS)) hit.push({ h, index });
    else keep.push(h);
  });

  if (hit.length) {
    if (!erasedStrokes || erasedStrokes.page !== curPage) {
      erasedStrokes = { page: curPage, items: [] };
    }
    hit.forEach(item => {
      if (!erasedStrokes.items.some(x => x.h.id === item.h.id)) erasedStrokes.items.push(item);
    });
    curBook.highlights = keep;
    if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: keep });
    paintHighlights();
    if (onUpdatePageUIFn) onUpdatePageUIFn();
    showEraseUndo();
  }
}

function eraseMove(e) {
  if (!eraseActive) return;
  eraseCursor(e);
  if (erasing) eraseAt(e);
}

function endErase() {
  if (!erasing) return;
  erasing = false;
  hideEraserCursor();
}

function eraseCursor(e) {
  const ring = $('#eraserHalo');
  if (!ring || !eraseActive) return;
  ring.hidden = false;
  ring.style.left = e.clientX + 'px';
  ring.style.top = e.clientY + 'px';
}

function hideEraserCursor() {
  const ring = $('#eraserHalo');
  if (ring) ring.hidden = true;
}

function showEraseUndo() {
  const toast = $('#eraseToast');
  if (!toast || !erasedStrokes || !erasedStrokes.items.length) return;
  const count = erasedStrokes.items.length;
  const msg = $('#eraseToastText');
  if (msg) msg.textContent = count === 1 ? 'یک خط پاک شد.' : `${faNum(count)} خط پاک شد.`;
  toast.hidden = false;
  clearTimeout(eraseUndoTimer);
  eraseUndoTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

export function hideEraseUndo() {
  const toast = $('#eraseToast');
  if (toast) toast.hidden = true;
  clearTimeout(eraseUndoTimer);
}

export function performEraseUndo() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  if (!curBook || !erasedStrokes || !erasedStrokes.items.length) return;
  if (erasedStrokes.page !== curPage) return;

  const list = curBook.highlights || [];
  const sorted = erasedStrokes.items.slice().sort((a, b) => a.index - b.index);
  sorted.forEach(({ h, index }) => {
    const at = Math.min(Math.max(0, index), list.length);
    list.splice(at, 0, h);
  });
  curBook.highlights = list;
  if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: list });
  erasedStrokes = null;
  hideEraseUndo();
  paintHighlights();
  if (onUpdatePageUIFn) onUpdatePageUIFn();
}

/* ── Text Selection & Highlighting ── */
function stageScroll() {
  const stage = $('#readerStage');
  const wrap = $('#pageWrap');
  if (!stage || !wrap) return { x: 0, y: 0 };
  const st = stage.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  return { x: st.left - wr.left + wrap.offsetLeft, y: st.top - wr.top + wrap.offsetTop };
}

export function onSelectionChange() {
  const engine = engineFn ? engineFn() : 'internal';
  if ($('#readerView')?.hidden || engine === 'browser' || penActive) return;
  const sel = window.getSelection();
  const bar = $('#hlBar');
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const tl = $('#textLayer');
  if (!tl || !tl.contains(range.commonAncestorContainer) || !sel.toString().trim()) {
    if (bar) bar.hidden = true;
    return;
  }
  const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
  if (!rects.length) {
    if (bar) bar.hidden = true;
    return;
  }
  lastSelectionRects = { text: sel.toString(), rects };
  const stage = $('#readerStage');
  if (!stage || !bar) return;
  const stRect = stage.getBoundingClientRect();
  const first = rects[0];
  const sc = stageScroll();
  bar.hidden = false;
  bar.style.left = Math.max(8, Math.min(stage.clientWidth - bar.offsetWidth - 8, first.left - stRect.left + sc.x)) + 'px';
  bar.style.top = Math.max(8, Math.min(stage.clientHeight - bar.offsetHeight - 8, first.top - stRect.top + sc.y - bar.offsetHeight - 8)) + 'px';
}

export function highlightFromSelection(color, selection) {
  const curPage = curPageFn ? curPageFn() : 1;
  const pageScale = pageScaleFn ? pageScaleFn() : 1;
  const wrap = $('#pageWrap');
  const wrapRect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
  const rects = (selection?.rects || []).map(r => ({
    x: r.left - wrapRect.left,
    y: r.top - wrapRect.top,
    w: r.width,
    h: r.height,
  }));
  return {
    id: nextId(),
    page: curPage,
    text: selection?.text || '',
    color,
    rects,
    note: '',
    createdAt: Date.now(),
    scale: pageScale,
  };
}

export function clearSelectionState() {
  lastSelectionRects = null;
  const bar = $('#hlBar');
  if (bar) bar.hidden = true;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
}

/* ── Notes ── */
export function saveNote() {
  const curBook = curBookFn ? curBookFn() : null;
  const curPage = curPageFn ? curPageFn() : 1;
  if (!curBook) return;
  const input = $('#noteInput');
  const text = input ? input.value.trim() : '';

  if (text) {
    if (pendingNoteHl) {
      curBook.highlights = curBook.highlights || [];
      const same = curBook.highlights.filter(h => h.page === curPage && h.text === pendingNoteHl.text);
      const hl = same.find(h => !h.note) || same[0] || null;
      if (hl) {
        hl.note = text;
      } else {
        const created = highlightFromSelection('yellow', pendingNoteHl);
        created.note = text;
        curBook.highlights.push(created);
      }
      if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
    } else {
      curBook.notes = curBook.notes || [];
      curBook.notes.push({ id: nextId(), page: curPage, text, createdAt: Date.now() });
      if (onUpdateBookFn) onUpdateBookFn(curBook.id, { notes: curBook.notes });
    }
    if (onUpdatePageUIFn) onUpdatePageUIFn();
  }
  pendingNoteHl = null;
  const overlay = $('#noteOverlay');
  if (overlay) overlay.hidden = true;
}

export function openNoteForCurrentPage() {
  const curPage = curPageFn ? curPageFn() : 1;
  const label = $('#noteForText');
  if (label) {
    label.textContent = pendingNoteHl
      ? `یادداشت برای هایلایت صفحهٔ ${faNum(curPage)}`
      : `یادداشت صفحهٔ ${faNum(curPage)}`;
  }
  const input = $('#noteInput');
  if (input) input.value = '';
  const overlay = $('#noteOverlay');
  if (overlay) overlay.hidden = false;
  const hlBar = $('#hlBar');
  if (hlBar) hlBar.hidden = true;
  setTimeout(() => input?.focus(), 200);
}

export function allNoteItems() {
  const curBook = curBookFn ? curBookFn() : null;
  if (!curBook) return [];
  const hls = (curBook.highlights || []).map(h => ({
    id: h.id,
    page: h.page,
    text: h.text,
    note: h.note,
    color: h.color,
    source: 'highlights',
    free: Boolean(h.free),
  }));
  const fresh = (curBook.notes || []).map(n => ({
    id: n.id,
    page: n.page,
    text: n.text,
    note: '',
    color: null,
    source: 'notes',
  }));
  return [...hls, ...fresh].sort((a, b) => a.page - b.page);
}

export function buildNotes() {
  const list = $('#notesList');
  if (!list) return;
  list.innerHTML = '';
  const items = allNoteItems();
  if (!items.length) {
    list.innerHTML = '<p class="notes-empty">هنوز یادداشتی نداری؛ قلم رو بردار و روی صفحه بکش یا متنی رو انتخاب کن!</p>';
    return;
  }
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.innerHTML = `
      ${it.color ? `<i class="dot" style="background:${resolveColor(it.color)}"></i>` : ''}
      <div class="note-body">
        <span class="note-text">${it.free ? '<b class="free-tag">نشان قلمی</b>' : esc(it.text)}</span>
        ${it.note ? `<span class="note-note">${LIB_ICONS.note} ${esc(it.note)}</span>` : ''}
      </div>
      <span class="note-page">ص ${faNum(it.page)}</span>
      <button class="note-del" aria-label="حذف">${LIB_ICONS.close}</button>`;

    el.addEventListener('click', e => {
      const curBook = curBookFn ? curBookFn() : null;
      if (!curBook) return;
      if (e.target.closest('.note-del')) {
        const bookId = curBook.id;
        const field = it.source === 'highlights' ? 'highlights' : 'notes';
        const before = (curBook[field] || []).slice();
        curBook[field] = before.filter(x => x.id !== it.id);
        if (onUpdateBookFn) onUpdateBookFn(bookId, { highlights: curBook.highlights, notes: curBook.notes });
        paintHighlights();
        if (onUpdatePageUIFn) onUpdatePageUIFn();
        buildNotes();

        showNotice(it.free ? 'نشان قلمی حذف شد.' : 'یادداشت حذف شد.', {
          actionLabel: 'برگردون',
          onAction: () => {
            if (!curBook || curBook.id !== bookId) return;
            curBook[field] = before;
            if (onUpdateBookFn) onUpdateBookFn(bookId, { highlights: curBook.highlights, notes: curBook.notes });
            paintHighlights();
            if (onUpdatePageUIFn) onUpdatePageUIFn();
            if (!$('#notesSheet')?.hidden) buildNotes();
          },
        });
        return;
      }
      const sheet = $('#notesSheet');
      if (sheet) sheet.hidden = true;
      if (onGotoPageFn) onGotoPageFn(it.page);
    });
    list.appendChild(el);
  });
}

export function exportNotes() {
  const curBook = curBookFn ? curBookFn() : null;
  if (!curBook) return;
  const items = allNoteItems();
  const md = formatNotesMarkdown(curBook.title, items);
  const blob = new Blob([md], { type: 'text/markdown' });
  saveAndShareBlob(blob, curBook.title + '.md', { title: curBook.title });
}

export function teardownAnnotations() {
  clearDrawCanvas();
  drawStroke = null;
  erasing = false;
  hideEraserCursor();
  clearTimeout(eraseUndoTimer);
  const toast = $('#eraseToast');
  if (toast) toast.hidden = true;
  if (eraseActive) toggleEraser(false);
  erasedStrokes = null;
  penPopPress = null;
  clearSelectionState();
}

export function isPenPopHidden() {
  const pop = $('#penPop');
  return !pop || pop.hidden;
}

export function openPenPop() {
  const pop = $('#penPop');
  if (!pop || !penActive) return;
  if (toggleDockPopFn) toggleDockPopFn(null);
  pop.hidden = false;
  $('#penPopToggle')?.setAttribute('aria-expanded', 'true');
}

export function collapsePenPop() {
  const pop = $('#penPop');
  if (pop) pop.hidden = true;
  $('#penPopToggle')?.setAttribute('aria-expanded', 'false');
  if (toggleDockPopFn) toggleDockPopFn(null);
}

function bindAnnotationUI() {
  // Top ribbon buttons
  $('#dockPen')?.addEventListener('click', () => togglePen());
  $('#hlTool')?.addEventListener('click', () => toggleHighlight());
  $('#eraserTool')?.addEventListener('click', () => toggleEraser());
  $('#strokeUndoBtn')?.addEventListener('click', undoLastStroke);
  $('#clearPageStrokesBtn')?.addEventListener('click', clearPageStrokes);

  // Subribbon tabs
  $('#subribbonHlTab')?.addEventListener('click', () => setToolMode('highlight'));
  $('#subribbonPenTab')?.addEventListener('click', () => setToolMode('draw'));

  // Custom color pickers
  $('#customHlPicker')?.addEventListener('input', e => {
    hlColor = e.target.value;
    strokeColor = hlColor;
    syncPenUI();
  });
  $('#customPenColor')?.addEventListener('input', e => {
    inkColor = e.target.value;
    strokeColor = inkColor;
    syncPenUI();
  });

  // Pointer events on draw layer
  const dl = $('#drawLayer');
  if (dl) {
    dl.addEventListener('pointerdown', e => {
      if (eraseActive) startErase(e);
      else startPenStroke(e);
    });
  }
  window.addEventListener('pointermove', e => {
    if (eraseActive) eraseMove(e);
    else penMove(e);
  });
  window.addEventListener('pointerup', e => {
    if (eraseActive) endErase();
    else penEnd(e);
  });
  window.addEventListener('pointercancel', e => {
    if (eraseActive) endErase();
    else penEnd(e);
  });

  // Pen pop swatches and width chips
  $('#penPop')?.addEventListener('pointerdown', e => {
    if (!penActive || eraseActive || e.button > 0) return;
    penPopPress = { id: e.pointerId, x: e.clientX, y: e.clientY, ev: e };
  });

  $('#penPop')?.addEventListener('click', e => {
    const dot = e.target.closest('.hl-dot');
    if (dot) {
      if (toolMode === 'draw') {
        inkColor = dot.dataset.color;
        strokeColor = inkColor;
      } else {
        hlColor = dot.dataset.color;
        strokeColor = hlColor;
      }
      syncPenUI();
      collapsePenPop();
      return;
    }
    if (e.target.closest('.pen-width')) collapsePenPop();
  });

  $('#penPopToggle')?.addEventListener('click', () => {
    if (isPenPopHidden()) openPenPop();
    else collapsePenPop();
  });

  $('#penWidths')?.addEventListener('click', e => {
    const chip = e.target.closest('.pen-width[data-width]');
    if (!chip) return;
    activeWidthKey = chip.dataset.width;
    safeSet(STORAGE_KEYS.penWidth, activeWidthKey);
    syncPenUI();
  });

  // Highlight selection contextual popup buttons
  $('#hlBar')?.addEventListener('click', e => {
    const dot = e.target.closest('.hl-dot');
    if (dot && lastSelectionRects) {
      const curBook = curBookFn ? curBookFn() : null;
      if (!curBook) return;
      curBook.highlights = curBook.highlights || [];
      curBook.highlights.push(highlightFromSelection(dot.dataset.color, lastSelectionRects));
      if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
      if (onUpdatePageUIFn) onUpdatePageUIFn();
      clearSelectionState();
    }
    if (e.target.closest('#hlNoteBtn')) {
      pendingNoteHl = lastSelectionRects;
      openNoteForCurrentPage();
    }
  });

  $('#customHlBarColor')?.addEventListener('change', e => {
    if (lastSelectionRects) {
      const curBook = curBookFn ? curBookFn() : null;
      if (!curBook) return;
      curBook.highlights = curBook.highlights || [];
      curBook.highlights.push(highlightFromSelection(e.target.value, lastSelectionRects));
      if (onUpdateBookFn) onUpdateBookFn(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
      if (onUpdatePageUIFn) onUpdatePageUIFn();
      clearSelectionState();
    }
  });

  // Notes overlay
  $('#noteSave')?.addEventListener('click', saveNote);
  $('#noteClose')?.addEventListener('click', () => {
    pendingNoteHl = null;
    const overlay = $('#noteOverlay');
    if (overlay) overlay.hidden = true;
  });
  $('#noteOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'noteOverlay') {
      pendingNoteHl = null;
      e.target.hidden = true;
    }
  });

  // Notes sheet
  $('#notesClose')?.addEventListener('click', () => {
    const sheet = $('#notesSheet');
    if (sheet) sheet.hidden = true;
  });
  $('#notesExport')?.addEventListener('click', exportNotes);
  $('#notesSheet')?.addEventListener('click', e => {
    if (e.target.id === 'notesSheet') e.target.hidden = true;
  });

  // Erase undo toast
  $('#eraseUndoBtn')?.addEventListener('click', performEraseUndo);

  // Document selection change listener
  document.addEventListener('selectionchange', onSelectionChange);
}
