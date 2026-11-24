/* ═══ PDF Reader — Coordinator & Shell Facade ═══
   Decomposed and modularized:
     · reader-state.js: Pure state logic, page bounds, zoom & goal math
     · reader-canvas.js: Canvas lifecycle, virtualization, pruning & safe DPR scale
     · reader-annotations.js: Highlights, drawing, pen/marker, eraser & notes
*/

import { $, faNum, faDigits, dayKey, esc } from './utils.js';
import { LIB_ICONS } from './constants.js';
import { getBook, updateBook, getBookBlob, renderShelf, bookDone, bookComplete, syncGoalPageCap } from './library.js';
import { recordDay } from './week.js';
import { jingoolMarkup } from './jingool.js';
import { showNotice } from './dialog.js';
import { isNative } from './native.js';

import {
  clampZoom,
  PAGE_WINDOW_RADIUS,
} from './reader-state.js';

import {
  pageBufferMap,
  prunePageBuffers,
  settleRenderTask,
  safeCleanup,
  releaseCanvas,
  setupPageCanvas,
} from './reader-canvas.js';

import {
  initAnnotations,
  teardownAnnotations,
  prepareDrawCanvas,
  paintHighlights,
  togglePen,
  toggleHighlight,
  toggleEraser,
  undoLastStroke,
  isPenActive,
  isEraseActive,
  isPenPopHidden,
  openPenPop,
  syncDrawExtras,
  openNoteForCurrentPage,
  buildNotes,
} from './reader-annotations.js';

const PDFJS_BASE = new URL('../assets/vendor/pdfjs', import.meta.url).href;

let pdfjsLib = null;
let pdfjsLoad = null;
let pdfjsAttempt = 0;

const pdfjsFile = (file, attempt) =>
  `${PDFJS_BASE}/${file}${attempt ? `?retry=${attempt}` : ''}`;

function loadPdfJs() {
  if (pdfjsLib) return Promise.resolve(pdfjsLib);
  if (!pdfjsLoad) {
    const attempt = pdfjsAttempt;
    pdfjsLoad = withTimeout(import(pdfjsFile('build/pdf.min.mjs', attempt)), ENGINE_BUDGET_MS)
      .then(mod => {
        mod.GlobalWorkerOptions.workerSrc = pdfjsFile('build/pdf.worker.min.mjs', attempt);
        pdfjsLib = mod;
        return mod;
      })
      .catch(err => { pdfjsLoad = null; pdfjsAttempt++; throw err; });
  }
  return pdfjsLoad;
}

const NO_ENGINE_TEXT = 'موتور نمایش PDF در دسترس نیست؛ اتصال اینترنت را بررسی کن و دوباره تلاش کن. تا آن وقت نمایشگر ساده فعال است و متن، هایلایت و یادداشت در دسترس نیست.';

const FALLBACK_REASONS = {
  manual: 'نمایشگر مرورگر برای این کتاب انتخاب شده؛ متن و هایلایت در دسترس نیست.',
  engine: 'موتور نمایش PDF در دسترس نیست؛ اتصال اینترنت را بررسی کن و دوباره تلاش کن.',
  auto: 'نمایشگر اختصاصی موفق نشد؛ نمایشگر ساده فعال شد و متن، هایلایت و یادداشت در دسترس نیست.',
};

const PDF_ASSETS = {
  cMapUrl: `${PDFJS_BASE}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
};

let curBook = null;
let curPage = 1;
let zoom = 1;
let pageScale = 1;
let pdfDoc = null;
let renderTask = null;
let textLayerTask = null;
let pdfObjectUrl = null;
let mode = 0;
let bright = 1;
const MODES = ['mode-light', 'mode-sepia', 'mode-dark'];
let timer = { running: false, start: 0, interval: null };
let resizeTimer = null;
let textLayerBroken = false;
let retryOnVisible = false;
let engine = 'internal';
let openSeq = 0;
let renderSeq = 0;
let hintTimer = null;
let hintShown = false;
const sessionFallback = new Set();

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('render-timeout')), ms)),
]);

const ENGINE_BUDGET_MS = 20000;
const CANVAS_BUDGET = 12000;
const CANVAS_BUDGET_LAST = 20000;
const TEXT_BUDGET = 12000;
const TEXT_BUDGET_LAST = 24000;
const OPEN_BACKSTOP = 90000;
const DOC_BUDGET_MS = 45000;

export function initReader() {
  window.addEventListener('open-book', e => openReader(e.detail));
  window.addEventListener('close-reader', closeReader);
  $('#readerBack').onclick = closeReader;
  $('#prevPage').onclick = () => gotoPage(curPage - 1);
  $('#nextPage').onclick = () => gotoPage(curPage + 1);
  $('#zoomIn').onclick = () => applyZoom(zoom * 1.2);
  $('#zoomOut').onclick = () => applyZoom(zoom / 1.2);
  $('#zoomVal')?.addEventListener('click', () => applyZoom(1));
  $('#firstPageBtn')?.addEventListener('click', () => { gotoPage(1); toggleDockPop(null); });
  $('#lastPageBtn')?.addEventListener('click', () => { if (curBook?.numPages) { gotoPage(curBook.numPages); toggleDockPop(null); } });
  $('#pageRange').addEventListener('input', e => {
    const p = parseInt(e.target.value, 10);
    const inp = $('#pageJumpInput');
    if (inp) inp.value = p;
    gotoPage(p);
  });
  $('#markReadBtn').onclick = () => togglePageRead();
  $('#readerEngine').onclick = () => switchEngine();

  /* Scene lighting mode cycle */
  $('#dockMode').onclick = () => { mode = (mode + 1) % MODES.length; applyMode(); };

  /* Page jump popover */
  $('#pageJumpGo')?.addEventListener('click', jumpToInputPage);
  $('#pageJumpInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpToInputPage(); }
  });
  $('#pagePill').onclick = () => toggleDockPop('#pagePop');
  $('#goalChip')?.addEventListener('click', () => {
    if (curBook) window.dispatchEvent(new CustomEvent('open-goal', { detail: curBook.id }));
  });

  /* Settings sheet */
  $('#dockSettings').onclick = () => toggleSettings(true);
  $('#settingsClose').onclick = () => toggleSettings(false);
  $('#modeChips').addEventListener('click', e => {
    const chip = e.target.closest('.set-chip[data-mode]');
    if (!chip) return;
    mode = Number(chip.dataset.mode) % MODES.length;
    applyMode();
  });
  $('#readerBright').addEventListener('input', e => setBrightness(Number(e.target.value)));

  /* Outside click handler: bubble phase, safely ignores clicks inside ribbon & popovers */
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#readerRibbon, .reader-top, .reader-subribbon, .reader-page-pop, .dock-pop, #penPop, #pagePop')) {
      toggleDockPop(null);
    }
  }, false);

  /* Zen mode & touch */
  $('#readerStage').addEventListener('scroll', onStageScroll, { passive: true });
  $('#readerStage').addEventListener('click', onStageTap);
  $('#readerStage').addEventListener('touchstart', onStageTouchStart, { passive: true });
  $('#readerStage').addEventListener('touchend', onStageTouchEnd, { passive: false });
  $('#fallbackRetry').onclick = () => switchEngine('internal');
  $('#readerHint').onclick = () => { $('#readerHint').hidden = true; };
  window.addEventListener('goal-changed', () => {
    if (curBook && !$('#readerView').hidden) updateGoalBar();
  });

  /* Initialize Annotations Engine */
  initAnnotations({
    getCurBook: () => curBook,
    getCurPage: () => curPage,
    getPageScale: () => pageScale,
    getEngine: () => engine,
    onUpdateBook: (id, patch) => updateBook(id, patch),
    onUpdatePageUI: () => updatePageUI(),
    onGotoPage: (n) => gotoPage(n),
    isPenPopHidden,
    openPenPop,
    toggleDockPop,
  });

  /* Notes & Add note triggers */
  $('#addNoteBtn').onclick = () => { toggleDockPop(null); togglePen(false); openNoteForCurrentPage(); };
  $('#readerNotes').onclick = () => { toggleDockPop(null); buildNotes(); $('#notesSheet').hidden = false; };
  $('#settingsSheet')?.addEventListener('click', e => {
    if (e.target === $('#settingsSheet')) toggleSettings(false);
  });

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if ($('#readerView').hidden) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') gotoPage(curPage + 1);
    if (e.key === 'ArrowLeft') gotoPage(curPage - 1);
    if (e.key === 'PageDown') { gotoPage(curPage + 1); e.preventDefault(); }
    if (e.key === 'PageUp') { gotoPage(curPage - 1); e.preventDefault(); }
    if (e.key === 'p' && !e.ctrlKey && !e.metaKey) { togglePen(); e.preventDefault(); }
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey) { toggleHighlight(); e.preventDefault(); }
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey) { toggleEraser(); e.preventDefault(); }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { undoLastStroke(); e.preventDefault(); }
    if (e.key === 'Escape') {
      $('#notesSheet').hidden = true;
      $('#hlBar').hidden = true;
      $('#eraseToast').hidden = true;
      $('#noteOverlay').hidden = true;
      toggleSettings(false);
      toggleDockPop(null);
    }
  });

  document.addEventListener('mousedown', e => {
    if (!$('#hlBar').hidden && !e.target.closest('#hlBar')) $('#hlBar').hidden = true;
  });

  window.addEventListener('resize', () => {
    if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPageSafe(true), 250);
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => {
      if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderPageSafe(true), 250);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !retryOnVisible) return;
    if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
    retryOnVisible = false;
    renderPageSafe();
    updatePageUI();
  });

  document.addEventListener('click', e => {
    const tab = e.target.closest('.nav-tab, .more-item');
    if (tab && tab.dataset.page && tab.dataset.page !== 'library' && !$('#readerView').hidden) closeReader();
  });

  /* Timer */
  $('#readTimerBtn').onclick = toggleTimer;
}

function applyMode() {
  const stage = $('#readerStage');
  MODES.forEach(m => stage.classList.remove(m));
  stage.classList.add(MODES[mode]);
  applyOptics();
  syncModeBtn();
  syncSettingsUI();
}

function syncModeBtn() {
  const btn = $('#dockMode');
  MODES.forEach(m => btn.classList.remove(m));
  btn.classList.add(MODES[mode]);
  btn.title = ['نور روز', 'سپیا', 'نور شب'][mode];
  btn.setAttribute('aria-label', btn.title);
}

function applyOptics() {
  const stage = $('#readerStage');
  stage.style.setProperty('--reader-bright', String(bright));
  stage.classList.toggle('has-fx', mode !== 0 || bright !== 1);
}

function setBrightness(percent) {
  bright = Math.min(1.4, Math.max(0.6, percent / 100));
  applyOptics();
  syncSettingsUI();
}

function applyZoom(next) {
  const z = clampZoom(next, 0.5, 3.0);
  if (z === zoom) return;
  zoom = z;
  if (engine === 'browser') {
    $('#pdfFrame').src = `${pdfObjectUrl}#page=${curPage}&zoom=${Math.round(zoom * 100)}`;
  } else {
    renderPageSafe();
  }
  syncSettingsUI();
}

function toggleSettings(on) {
  const open = typeof on === 'boolean' ? on : $('#settingsSheet').hidden;
  $('#settingsSheet').hidden = !open;
  $('#dockSettings').classList.toggle('on', open);
  $('#dockSettings').setAttribute('aria-expanded', String(open));
  if (open) toggleDockPop(null);
  syncSettingsUI();
}

function syncSettingsUI() {
  const b = Math.round(bright * 100);
  $('#readerBright').value = String(b);
  $('#brightVal').textContent = faNum(b) + '٪';
  $('#zoomVal').textContent = faNum(Math.round(zoom * 100)) + '٪';
  const zoomIn = $('#zoomIn');
  const zoomOut = $('#zoomOut');
  if (zoomIn) zoomIn.disabled = zoom >= 3.0;
  if (zoomOut) zoomOut.disabled = zoom <= 0.5;
  document.querySelectorAll('#modeChips .set-chip').forEach(c => {
    const on = Number(c.dataset.mode) === mode;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  });
}

function jumpToInputPage() {
  const inp = $('#pageJumpInput');
  if (!inp || !curBook) return;
  const val = parseInt(inp.value, 10);
  if (Number.isFinite(val)) {
    const total = curBook.numPages || 1;
    const clamped = Math.max(1, Math.min(total, val));
    gotoPage(clamped);
    toggleDockPop(null);
  }
}

let openPop = null;
function toggleDockPop(sel) {
  const target = sel && sel !== openPop ? sel : null;
  openPop = target;
  const pagePop = $('#pagePop');
  if (pagePop) pagePop.hidden = target !== '#pagePop';
  const pagePill = $('#pagePill');
  if (pagePill) {
    pagePill.classList.toggle('on', target === '#pagePop');
    pagePill.setAttribute('aria-expanded', String(target === '#pagePop'));
  }
  if (target === '#pagePop') {
    const input = $('#pageJumpInput');
    if (input) {
      input.value = curPage || 1;
      input.min = '1';
      input.max = String(curBook?.numPages || 999999);
      setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 50);
    }
  }
  if (target) $('#hlBar').hidden = true;
}

let zenHidden = false, scrollRaf = 0, lastScrollTop = 0;
function setZen(on) {
  if (on === zenHidden) return;
  zenHidden = on;
  const ribbon = $('#readerRibbon');
  if (ribbon) ribbon.classList.toggle('zen-scrolled', on);
  const dock = $('#readerDock');
  if (dock) dock.classList.toggle('zen', on);
  if (on) {
    const pagePop = $('#pagePop');
    if (pagePop && !pagePop.hidden) toggleDockPop(null);
  }
}

function onStageScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const stage = $('#readerStage');
    const dy = stage.scrollTop - lastScrollTop;
    lastScrollTop = stage.scrollTop;
    if (stage.scrollTop < 16) setZen(false);
    else if (dy > 8) setZen(true);
    else if (dy < -8) setZen(false);
  });
}

function onStageTap(e) {
  if (e.target.closest('#hlBar,.dock-pop,.sheet,.overlay,.reader-ribbon,.reader-page-pop,.reader-subribbon')) return;
  if (zenHidden) setZen(false);
  else toggleDockPop(null);
}

let swipeOrigin = null;
function inActiveSelection(node) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  if (!node || sel.containsNode?.(node, true)) return true;
  return [...sel.getClientRects()].some(r => r.width > 1 && r.height > 1);
}

function onStageTouchStart(e) {
  swipeOrigin = null;
  if (e.touches.length !== 1) return;
  if (zoom !== 1 || isPenActive() || isEraseActive()) return;
  if ($('#readerView').hidden) return;
  if (e.target.closest('#hlBar,.dock-pop,.sheet,.overlay,.reader-page-pop,.reader-subribbon,#notesSheet')) return;
  if (inActiveSelection(e.target)) return;
  const t = e.touches[0];
  swipeOrigin = { x: t.clientX, y: t.clientY };
}

function onStageTouchEnd(e) {
  const start = swipeOrigin;
  swipeOrigin = null;
  if (!start || e.touches.length) return;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (curBook && curPage >= (curBook.numPages || 1) && dx > 0) return;
  if (curPage <= 1 && dx < 0) return;
  e.preventDefault();
  gotoPage(curPage + (dx > 0 ? 1 : -1));
}

function teardownEngine() {
  if (renderTask) { try { renderTask.cancel(); } catch (e) {} renderTask = null; }
  if (textLayerTask) { try { textLayerTask.cancel(); } catch (e) {} textLayerTask = null; }
  if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
  if (pdfObjectUrl) { URL.revokeObjectURL(pdfObjectUrl); pdfObjectUrl = null; }
  $('#pdfFrame').removeAttribute('src');
  $('#pdfCanvas').hidden = false;
  $('#textLayer').hidden = false;
  $('#highlightLayer').hidden = false;
  $('#pdfFallback').hidden = true;
  retryOnVisible = false;
  $('#textLayer').innerHTML = '';
  $('#highlightLayer').innerHTML = '';
  $('#hlBar').hidden = true;

  teardownAnnotations();
  releaseCanvas($('#pdfCanvas'));
  releaseCanvas($('#drawLayer'));
  prunePageBuffers(-999);
}

function switchEngine(to) {
  if (!curBook) return;
  const target = to || (engine === 'browser' ? 'internal' : 'browser');
  updateBook(curBook.id, { viewer: target, fallback: false });
  curBook.viewer = target;
  if (target === 'internal') sessionFallback.delete(curBook.id);
  openReader(curBook.id, { forceInternal: target === 'internal' });
}

function maybeShowHighlightHint() {
  if (hintShown || engine !== 'internal') return;
  if (!$('#textLayer').querySelector('span')) return;
  hintShown = true;
  const hint = $('#readerHint');
  hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.hidden = true; }, 7000);
}

export async function openReader(id, opts = {}) {
  const seq = ++openSeq;
  const book = getBook(id);
  if (!book) return;
  if (timer.running) stopTimerSession();
  cancelAutoRead();
  curBook = book;
  curPage = Math.max(1, book.lastPage || 1);
  teardownEngine();
  textLayerBroken = false;
  setZen(false);
  lastScrollTop = 0;
  toggleDockPop(null);
  toggleSettings(false);
  $('#shelfView').hidden = true;
  $('#readerView').hidden = false;
  document.body.classList.add('reader-immersive');
  $('#readerHint').hidden = true;
  $('#readerTitle').textContent = book.title;
  updatePageUI();
  updateGoalBar();
  const thumb = $('#readerThumb');
  if (book.cover) { thumb.src = book.cover; thumb.hidden = false; } else thumb.hidden = true;
  $('#readerLoading').hidden = false;

  const blob = await getBookBlob(id);
  if (seq !== openSeq) return;
  if (!blob) {
    showNotice('فایل این کتاب پیدا نشد؛ دوباره از کتابخانه اضافه‌ش کن.', { actionLabel: 'باشه' });
    closeReader();
    return;
  }
  pdfObjectUrl = URL.createObjectURL(blob);

  const browserViewer = !isNative() && (book.viewer === 'browser' || (sessionFallback.has(id) && !opts.forceInternal));

  let ok = false;
  let drawn = false;
  let engineMissing = false;
  if (!browserViewer) {
    try {
      const lib = await loadPdfJs();
      if (seq !== openSeq) return;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (seq !== openSeq) return;
      const doc = await withTimeout(lib.getDocument({ data, ...PDF_ASSETS }).promise, DOC_BUDGET_MS);
      if (seq !== openSeq) { doc.destroy(); return; }
      pdfDoc = doc;
      ok = true;
    } catch (err) {
      engineMissing = !pdfjsLib;
      console.warn(engineMissing
        ? 'موتور نمایش PDF در دسترس نبود؛ نمایشگر مرورگر استفاده می‌شود:'
        : 'رندر اختصاصی ممکن نشد؛ نمایشگر مرورگر استفاده می‌شود:', err);
    }
  }
  if (ok) {
    let status = null;
    try {
      status = await withTimeout(renderPage(), OPEN_BACKSTOP);
      drawn = true;
    } catch (err) {
      console.warn('رندر صفحه کامل نشد:', err);
      if (document.visibilityState === 'hidden') retryOnVisible = true;
      else ok = false;
    }
    if (seq !== openSeq) return;
    if (status && status.canvasOk === false) {
      if (document.visibilityState === 'hidden') retryOnVisible = true;
      else ok = false;
    }
  }
  if (!ok) {
    engine = 'browser';
    if (!engineMissing) sessionFallback.add(id);
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
    if (!book.numPages) {
      try {
        const lib = await loadPdfJs();
        const data = await blob.arrayBuffer();
        const doc = await withTimeout(lib.getDocument({ data, ...PDF_ASSETS }).promise, DOC_BUDGET_MS);
        if (seq !== openSeq) { doc.destroy(); return; }
        updateBook(id, { numPages: doc.numPages });
        book.numPages = doc.numPages;
        doc.destroy();
      } catch (e) { console.warn('گرفتن تعداد صفحه‌ها ممکن نشد:', e); }
    }
    syncGoalPageCap(id, book.numPages);
    engageFallbackUI(book.viewer === 'browser' ? 'manual' : engineMissing ? 'engine' : 'auto');
  } else {
    engine = 'internal';
    sessionFallback.delete(id);
    if (!book.numPages || book.numPages !== pdfDoc.numPages) updateBook(id, { numPages: pdfDoc.numPages });
    book.numPages = pdfDoc.numPages;
    if (book.fallback || (book.viewer && book.viewer !== 'internal')) {
      updateBook(id, { viewer: 'internal', fallback: false });
    }
  }

  $('#pageRange').max = book.numPages || 999999;
  syncGoalPageCap(id, book.numPages);
  curPage = Math.min(Math.max(1, curPage), book.numPages || curPage);
  zoom = 1;
  applyMode();
  prepareDrawCanvas();
  if (engine === 'browser') {
    $('#pdfFrame').src = `${pdfObjectUrl}#page=${curPage}&zoom=100`;
  } else {
    if (!drawn && document.visibilityState === 'visible') await renderPage();
    if (seq !== openSeq) return;
    maybeShowHighlightHint();
    if (pdfDoc && curBook && !curBook.cover && curPage !== 1) {
      pdfDoc.getPage(1).then(p => maybeGenerateCover(p)).catch(() => {});
    }
  }
  if (seq !== openSeq) return;
  updatePageUI();
  updateGoalBar();
  $('#readerLoading').hidden = true;
  startAutoRead();
}

function engageFallbackUI(reason) {
  if (isPenActive()) togglePen(false);
  if (isEraseActive()) toggleEraser(false);
  teardownAnnotations();
  $('#pdfCanvas').hidden = true;
  $('#textLayer').hidden = true;
  $('#highlightLayer').hidden = true;
  $('#pdfFallback').hidden = false;
  $('#fallbackText').textContent = reason === 'engine' ? NO_ENGINE_TEXT : FALLBACK_REASONS[reason] || FALLBACK_REASONS.auto;
}

export function closeReader() {
  openSeq++;
  teardownEngine();
  cancelAutoRead();
  if (timer.running) stopTimerSession();
  curBook = null;
  coverCleanup = null;
  $('#readerView').hidden = true;
  document.body.classList.remove('reader-immersive');
  $('#shelfView').hidden = false;
  $('#notesSheet').hidden = true;
  $('#donePop').hidden = true;
  $('#readerHint').hidden = true;
  $('#readerLoading').hidden = true;
  setZen(false);
  toggleDockPop(null);
  toggleSettings(false);
  renderShelf();
}

async function stageBox() {
  const stage = $('#readerStage');
  if (document.visibilityState === 'visible') {
    for (let i = 0; i < 8 && stage.clientWidth < 40; i++) await new Promise(r => setTimeout(r, 40));
  }
  return {
    w: stage.clientWidth || window.innerWidth || 360,
    h: stage.clientHeight || window.innerHeight || 640,
  };
}

let coverPending = false;
let coverCleanup = null;
function cleanupWhenIdle(page) {
  if (coverPending) { coverCleanup = page; return; }
  safeCleanup(page);
}

async function maybeGenerateCover(page) {
  coverPending = true;
  if (!curBook || curBook.cover) { coverPending = false; return; }
  try {
    const baseVp = page.getViewport({ scale: 1 });
    const targetW = 240;
    const scale = targetW / (baseVp.width || 1);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = c.toDataURL('image/jpeg', 0.75);
    if (dataUrl && dataUrl.length > 100 && curBook && !curBook.cover) {
      curBook.cover = dataUrl;
      updateBook(curBook.id, { cover: dataUrl });
      const thumb = $('#readerThumb');
      if (thumb) {
        thumb.src = dataUrl;
        thumb.hidden = false;
      }
    }
  } catch (err) {
    console.warn('تولید خودکار جلد انجام نشد:', err);
  } finally {
    coverPending = false;
    if (coverCleanup) { const p = coverCleanup; coverCleanup = null; safeCleanup(p); }
  }
}

async function renderPage(keepScroll) {
  if (!pdfDoc || !curBook) return { canvasOk: true, cancelled: true };
  const doc = pdfDoc, seq = openSeq;
  const myRender = ++renderSeq, atPage = curPage;
  const stale = () => myRender !== renderSeq || doc !== pdfDoc || seq !== openSeq || atPage !== curPage;
  if (renderTask) { try { renderTask.cancel(); } catch (e) {} }
  if (textLayerTask) { try { textLayerTask.cancel(); } catch (e) {} }
  const page = await doc.getPage(atPage);
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  const wrap = $('#pageWrap');
  const stage = $('#readerStage');
  const box = await stageBox();
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  const availW = box.w - 28;
  const availH = box.h - 28;
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(availW / base.width, availH / base.height);
  const scale = Math.max(0.2, fit * zoom);
  const viewport = page.getViewport({ scale });

  pageScale = scale;
  const canvas = $('#pdfCanvas');
  const rawDpr = window.devicePixelRatio || 1;
  const { dpr: safeDpr } = setupPageCanvas(canvas, viewport, zoom, rawDpr);
  wrap.style.width = viewport.width + 'px';
  wrap.style.height = viewport.height + 'px';

  const ctx = canvas.getContext('2d');
  let canvasOk = false;
  const budgets = [CANVAS_BUDGET, CANVAS_BUDGET_LAST];
  for (let attempt = 0; attempt < budgets.length && !canvasOk; attempt++) {
    await settleRenderTask(renderTask);
    try {
      if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
      renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: safeDpr !== 1 ? [safeDpr, 0, 0, safeDpr, 0, 0] : null,
      });
      await withTimeout(renderTask.promise, budgets[attempt]);
      canvasOk = true;
    } catch (e) {
      if (e?.name === 'RenderingCancelledException') { canvasOk = true; break; }
      console.warn(e);
    }
  }
  await settleRenderTask(renderTask);
  renderTask = null;
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  if (!canvasOk) {
    $('#textLayer').innerHTML = '';
    paintHighlights();
    safeCleanup(page);
    return { canvasOk: false };
  }

  if (!$('#readerLoading').hidden) {
    updatePageUI();
    updateGoalBar();
    $('#readerLoading').hidden = true;
  }
  if (canvasOk && curPage === 1 && curBook && !curBook.cover) {
    maybeGenerateCover(page);
  }

  // Text layer
  const tl = $('#textLayer');
  tl.innerHTML = '';
  tl.style.setProperty('--scale-factor', String(scale));
  tl.style.width = viewport.width + 'px';
  tl.style.height = viewport.height + 'px';

  if (!textLayerBroken && pdfjsLib) {
    const textBudgets = [TEXT_BUDGET, TEXT_BUDGET_LAST];
    for (let attempt = 0; attempt < textBudgets.length; attempt++) {
      try {
        const textContent = await page.getTextContent({ disableNormalization: true });
        if (stale()) break;
        textLayerTask = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: tl,
          viewport,
        });
        await withTimeout(textLayerTask.render(), textBudgets[attempt]);
        break;
      } catch (e) {
        if (stale()) break;
        console.warn(e);
        try { textLayerTask.cancel(); } catch (err) {}
        textLayerTask = null;
        tl.innerHTML = '';
        if (attempt === textBudgets.length - 1) textLayerBroken = true;
      }
    }
  }

  if (stale()) { cleanupWhenIdle(page); return { canvasOk: true, cancelled: true }; }

  prepareDrawCanvas(true);
  paintHighlights();
  if (!keepScroll) stage.scrollTop = 0;

  // Prune active buffers to keep at most visible page ± 1 page
  prunePageBuffers(atPage);
  pageBufferMap.set(atPage, { canvas, width: canvas.width, height: canvas.height, renderTask });

  cleanupWhenIdle(page);
  return { canvasOk: true };
}

const renderPageSafe = (keepScroll) => renderPage(keepScroll).catch(err => {
  console.warn('رندر صفحه انجام نشد:', err);
});

function updatePageUI() {
  const total = curBook?.numPages || 1;
  $('#pageLabel').textContent = curBook?.numPages ? `${faNum(curPage)} / ${faNum(curBook.numPages)}` : faNum(curPage);
  const range = $('#pageRange');
  if (range) {
    range.value = curPage;
    range.max = String(curBook?.numPages || 1);
  }
  const prevBtn = $('#prevPage');
  const nextBtn = $('#nextPage');
  const firstBtn = $('#firstPageBtn');
  const lastBtn = $('#lastPageBtn');
  if (prevBtn) prevBtn.disabled = curPage <= 1;
  if (nextBtn) nextBtn.disabled = curPage >= total;
  if (firstBtn) firstBtn.disabled = curPage <= 1;
  if (lastBtn) lastBtn.disabled = curPage >= total;

  const hasMarks = (curBook?.highlights || []).some(h => h.page === curPage);
  const undoBtn = $('#strokeUndoBtn');
  if (undoBtn) undoBtn.disabled = !hasMarks;
  syncDrawExtras();

  const isFallback = engine === 'browser';
  if ($('#dockPen')) $('#dockPen').disabled = isFallback;
  if ($('#hlTool')) $('#hlTool').disabled = isFallback;
  if ($('#eraserTool')) $('#eraserTool').disabled = isFallback;

  const read = curBook ? bookDone(curBook).has(curPage) : false;
  $('#pagePill').classList.toggle('is-read', read);
  $('#pagePill').setAttribute('aria-label', read
    ? `صفحهٔ ${faNum(curPage)} — خوانده شده`
    : `صفحهٔ ${faNum(curPage)}`);
  $('#pageWrap')?.classList.toggle('is-read', read);
  if (curBook?.numPages) {
    const done = bookDone(curBook).size;
    $('#readerPct').textContent = `${faNum(Math.round((done / curBook.numPages) * 100))}٪`;
  } else {
    $('#readerPct').textContent = '';
  }
  const notesBadge = $('#readerNotesBadge');
  if (notesBadge) {
    const totalNotes = (curBook?.highlights?.length || 0) + (curBook?.notes?.length || 0);
    notesBadge.textContent = faNum(totalNotes);
    notesBadge.hidden = totalNotes <= 0;
  }
  updateMarkBtn();
}

function gotoPage(n) {
  const total = curBook?.numPages || Infinity;
  n = Math.max(1, Math.min(total, n));
  if (n === curPage && engine === 'internal') return;
  textLayerBroken = false;
  curPage = n;
  prunePageBuffers(n);
  updateBook(curBook.id, { lastPage: n, lastReadAt: Date.now() });
  curBook.lastPage = n;
  if (engine === 'browser') {
    $('#pdfFrame').src = `${pdfObjectUrl}#page=${n}&zoom=${Math.round(zoom * 100)}`;
  } else {
    renderPageSafe();
  }
  updatePageUI();
  updateGoalBar();
  startAutoRead();
}

function updateMarkBtn() {
  const btn = $('#markReadBtn');
  if (!btn || !curBook) return;
  const read = bookDone(curBook).has(curPage);
  btn.classList.toggle('is-read', read);
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span id="markReadText" class="mark-read-label">${read ? 'خوانده شد' : 'خواندم'}</span>`;
  btn.title = read ? 'خوانده شد — کلیک برای تغییر به خوانده‌نشده' : 'علامت‌گذاری صفحه به عنوان خوانده شده (خودکار هم پس از یک دقیقه ماندن)';
  btn.setAttribute('aria-pressed', String(read));
  btn.setAttribute('aria-label', read ? 'صفحه خوانده شد' : 'علامت‌گذاری صفحه به عنوان خوانده شده');
  $('#pageWrap')?.classList.toggle('is-read', read);
}

const AUTO_READ_MS = 60000;
const autoRead = { t: null, left: 0, since: 0, bookId: null, page: 0 };

function cancelAutoRead() {
  clearTimeout(autoRead.t);
  autoRead.t = null;
  autoRead.left = 0;
}
function pauseAutoRead() {
  if (autoRead.t === null) return;
  clearTimeout(autoRead.t);
  autoRead.t = null;
  autoRead.left = Math.max(0, autoRead.left - (Date.now() - autoRead.since));
}
function runAutoRead() {
  clearTimeout(autoRead.t);
  autoRead.t = null;
  if (!curBook || engine !== 'internal' || autoRead.left <= 0) return;
  if (document.hidden || $('#readerView').hidden) return;
  if (bookDone(curBook).has(curPage)) return;
  autoRead.since = Date.now();
  autoRead.t = setTimeout(autoMarkRead, autoRead.left);
}
function startAutoRead() {
  autoRead.bookId = curBook ? curBook.id : null;
  autoRead.page = curPage;
  autoRead.left = AUTO_READ_MS;
  runAutoRead();
}
function autoMarkRead() {
  autoRead.t = null;
  autoRead.left = 0;
  if (!curBook || curBook.id !== autoRead.bookId || curPage !== autoRead.page) return;
  if (engine !== 'internal' || document.hidden || $('#readerView').hidden) return;
  if (bookDone(curBook).has(curPage)) return;
  togglePageRead(true);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAutoRead();
    else if (curBook && autoRead.bookId === curBook.id && autoRead.page === curPage) runAutoRead();
  });
}

function togglePageRead(auto = false) {
  if (!auto) cancelAutoRead();
  const done = new Set(curBook.completedPages || []);
  const marked = !done.has(curPage);
  if (marked) done.add(curPage);
  else done.delete(curPage);
  curBook.completedPages = [...done];
  curBook.stats = withTodayPages(curBook.stats, marked ? 1 : -1);
  updateBook(curBook.id, { completedPages: curBook.completedPages, stats: curBook.stats, lastReadAt: Date.now() });
  updatePageUI();
  updateGoalBar();
  if (bookComplete(curBook)) celebrateCompletion();
}

function updateGoalBar() {
  const bar = $('#goalBar');
  const chipText = $('#goalChipText');
  const chip = $('#goalChip');
  if (!curBook) return;
  const st = curBook.stats?.[dayKey(new Date())] || { pages: 0, minutes: 0 };
  const rawG = Number(curBook.goal?.pagesPerDay);
  const g = Number.isFinite(rawG) && rawG > 0 ? rawG : null;
  const pct = g ? Math.min(100, Math.round((st.pages / g) * 100)) : 0;
  const goalName = curBook.goal?.text ? `<span class="goal-name">${LIB_ICONS.target} ${esc(curBook.goal.text)}</span>` : '';

  if (chipText) {
    if (g) {
      chipText.innerHTML = `${LIB_ICONS.target} ${faNum(st.pages)}/${faNum(g)}`;
    } else if (curBook.goal?.text) {
      chipText.innerHTML = `${LIB_ICONS.target} ${esc(curBook.goal.text)}`;
    } else {
      chipText.innerHTML = `${LIB_ICONS.target} هدف`;
    }
  }
  if (chip) {
    chip.title = g ? `هدف امروز: ${faNum(st.pages)} از ${faNum(g)} صفحه (${faNum(pct)}٪)` : 'تنظیم هدف مطالعه';
  }
  if (bar) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.innerHTML = (g || goalName)
      ? `<div class="goal-track"><i style="width:${pct}%"></i></div>`
      : '';
  }
  const editBtn = $('#goalEdit');
  if (editBtn) editBtn.onclick = () => window.dispatchEvent(new CustomEvent('open-goal', { detail: curBook.id }));
}

let donePopTimer = null;
function celebrateCompletion() {
  $('#donePopChar').innerHTML = jingoolMarkup('celebrating');
  $('#donePop').hidden = false;
  clearTimeout(donePopTimer);
  donePopTimer = setTimeout(() => { $('#donePop').hidden = true; }, 3200);
}

function toggleTimer() {
  const btn = $('#readTimerBtn');
  if (!timer.running) {
    timer.running = true;
    timer.start = Date.now();
    btn.classList.add('on');
    btn.setAttribute('aria-pressed', 'true');
    btn.title = 'پایان تایمر مطالعه';
    $('#timerText').textContent = faDigits('0:00');
    timer.interval = setInterval(() => {
      const s = Math.floor((Date.now() - timer.start) / 1000);
      $('#timerText').textContent = faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
  } else {
    stopTimerSession();
  }
}

function stopTimerSession() {
  const ms = Date.now() - timer.start;
  clearInterval(timer.interval);
  timer.running = false;
  const btn = $('#readTimerBtn');
  if (btn) {
    btn.classList.remove('on');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'شروع تایمر مطالعه';
  }
  const s = Math.floor(ms / 1000);
  const txt = $('#timerText');
  if (txt) txt.textContent = faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  const m = ms >= 30000 ? Math.round(ms / 60000) : 0;
  if (m > 0 && curBook) addToday('minutes', m);
  if (ms >= 30000) recordDay();
  updateGoalBar();
}

function withTodayPages(stats, delta) {
  const k = dayKey(new Date());
  const next = Object.assign({}, stats || {});
  const day = Object.assign({ pages: 0, minutes: 0 }, next[k]);
  day.pages = Math.max(0, (Number(day.pages) || 0) + delta);
  next[k] = day;
  return next;
}

function addToday(kind, v) {
  const k = dayKey(new Date());
  curBook.stats = curBook.stats || {};
  curBook.stats[k] = curBook.stats[k] || { pages: 0, minutes: 0 };
  curBook.stats[k][kind] += v;
  updateBook(curBook.id, { stats: curBook.stats });
}

export {
  prunePageBuffers,
  pageBufferMap,
};
