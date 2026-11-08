/* ═══ PDF Reader — Daftarche reading workspace ═══
   Two rendering engines:
   1. Custom pdf.js renderer (default): canvas + text layer. The text layer is
      the source of truth for selection → highlights. Falls back gracefully
      (scanned PDFs simply get no text layer; manual page completion still works).
   2. Browser built-in viewer (iframe): used only when it is chosen for a book
      or when the internal renderer fails; that is remembered for the session
      only, so a book recovers on the next visit. No text layer there, hence no
      selection, highlights or notes.
   pdf.js is only used for rendering/counting, never for reading state.
   Reading state (currentPage, completedPages, goal, highlights, notes) lives
   in the book meta record — fully separated from UI.
   The renderer itself is fetched on demand (loadPdfJs below), never as part of
   the app's module graph: a CDN that is slow, blocked or down must not keep the
   notebook from opening. */
import { $, faNum, faDigits, dayKey, esc, nextId } from './utils.js';
import { STORAGE_KEYS, LIB_ICONS } from './constants.js';
import { getBook, updateBook, getBookBlob, renderShelf, bookDone, bookComplete, syncGoalPageCap } from './library.js';
import { recordDay } from './week.js';
import { jingoolMarkup } from './jingool.js';
import { showNotice } from './dialog.js';
import { safeSet, readString } from './store.js';
import { isNative, saveAndShareBlob } from './native.js';

const PDFJS_BASE = new URL('../assets/vendor/pdfjs', import.meta.url).href;

/* ── The renderer, loaded when a book is actually opened ──
   Deliberately not a top-level import: this module is part of the app's boot
   graph, so a static import would make a third-party host a prerequisite for
   the whole notebook. The first book pays for the download; every later book
   reuses the same module instance.

   Recovery after a failed load needs a different URL: a module loader keeps the
   failed response for an address for the rest of the document, so asking for
   the same one again never reaches the network. The first attempt therefore
   uses the plain URL — the one the service worker keeps for offline and the one
   a book opened normally has always used — and only a retry carries a token.
   Both the module and the worker it spawns get that token, so a retry is a real
   second try rather than a repeat of the remembered failure; nothing is added
   to the URL on the normal path. */
let pdfjsLib = null;
let pdfjsLoad = null;
let pdfjsAttempt = 0;

const pdfjsFile = (file, attempt) =>
  `${PDFJS_BASE}/${file}${attempt ? `?retry=${attempt}` : ''}`;

function loadPdfJs() {
  if (pdfjsLib) return Promise.resolve(pdfjsLib);
  if (!pdfjsLoad) {
    const attempt = pdfjsAttempt;
    /* A module fetch that never settles would leave the loading veil up for
       good. The budget is generous (it is a real download on a slow line) but
       finite, and a timeout is treated exactly like a failed load so the
       browser viewer can take over. */
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

/* Shown when the renderer itself could not be fetched — as opposed to a file
   that failed to render. The browser viewer keeps the book readable either
   way, but here the cause is worth naming and retrying is worthwhile: the
   engine switch in study settings re-opens the book on our own renderer. */
const NO_ENGINE_TEXT = 'موتور نمایش PDF در دسترس نیست؛ اتصال اینترنت را بررسی کن و دوباره تلاش کن. تا آن وقت نمایشگر ساده فعال است و متن، هایلایت و یادداشت در دسترس نیست.';

/* Why the fallback viewer is on screen, said in the reader's own words. */
const FALLBACK_REASONS = {
  manual: 'نمایشگر مرورگر برای این کتاب انتخاب شده؛ متن و هایلایت در دسترس نیست.',
  engine: 'موتور نمایش PDF در دسترس نیست؛ اتصال اینترنت را بررسی کن و دوباره تلاش کن.',
  auto: 'نمایشگر اختصاصی موفق نشد؛ نمایشگر ساده فعال شد و متن، هایلایت و یادداشت در دسترس نیست.',
};

/* Persian/Arabic/CJK documents often reference predefined CMaps and standard
   font programs that ship with pdf.js instead of inside the file. When those
   URLs are missing pdf.js degrades silently and glyphs can be substituted or
   mapped to the wrong code — visible as jumbled or wrongly spaced text. */
const PDF_ASSETS = {
  cMapUrl: `${PDFJS_BASE}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
};

/* Dual Annotation Engine: Draw (Fine-tip Pen) vs. Highlight (Chisel-tip Marker) */
const HL_PALETTE = {
  yellow: '#f6c445',
  green: '#7ed992',
  blue: '#74b9ff',
  pink: '#f78fb3',
  purple: '#b892ff',
  orange: '#ff9f68',
  teal: '#48dbfb',
  red: '#ff6b6b',
};

const INK_PALETTE = {
  'ink-black': '#1e242b',
  'ink-blue': '#1d4ed8',
  'ink-red': '#dc2626',
  'ink-green': '#15803d',
  'ink-purple': '#6d28d9',
  'ink-brown': '#854d0e',
  'ink-orange': '#ea580c',
  'ink-white': '#f8fafc',
};

const STROKE_COLORS = { ...HL_PALETTE, ...INK_PALETTE };
const HL_COLORS = { ...HL_PALETTE };

function resolveColor(c) {
  if (!c) return '#f6c445';
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return INK_PALETTE[c] || HL_PALETTE[c] || STROKE_COLORS[c] || c;
}

function resolveHlRgba(c, alpha = 0.38) {
  const hex = resolveColor(c);
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

const DRAW_WIDTHS = { thin: 2, medium: 4, thick: 8, xthick: 14 };
const HL_WIDTHS = { thin: 10, medium: 16, thick: 24, xthick: 34 };
const PEN_WIDTHS = { thin: 4, medium: 8, thick: 14, xthick: 22 };

let curBook = null, curPage = 1, zoom = 1, pageScale = 1;
let pdfDoc = null, renderTask = null, textLayerTask = null;
let pdfObjectUrl = null;
let mode = 0;
let bright = 1;            /* brightness factor applied on top of the page tint */
const MODES = ['mode-light', 'mode-sepia', 'mode-dark'];
let timer = { running: false, start: 0, interval: null };
let resizeTimer = null;
let textLayerBroken = false;

/* Dual Annotation Engine tool states */
let toolMode = null; /* 'highlight' | 'draw' | null */
let penActive = false;
let activeWidthKey = 'medium';
let hlColor = 'yellow';
let inkColor = 'ink-black';
let strokeColor = 'yellow';
let strokeWidth = HL_WIDTHS.medium;

function nibPx(w, kind) {
  if (typeof w === 'number') return w;
  const isDraw = kind === 'draw';
  if (isDraw) return DRAW_WIDTHS[w] || DRAW_WIDTHS.medium;
  return HL_WIDTHS[w] || HL_WIDTHS.medium;
}

let drawCtx = null, drawStroke = null;
let penHintShown = false;
/* Eraser state. eraseActive turns every drag on the draw surface into a
   hit-test sweep; erasedStrokes parks the records the undo toast can put back.

   The parking is page-scoped (`{ page, items }`). A flat array was enough while
   the undo could only be pressed on the page that produced it; with the toast
   still up across a page turn, `performEraseUndo` pushed the records back into
   `highlights` — each carrying its original `page` — and restored strokes onto
   whatever page was on screen instead of the one they were erased from. The
   page the erase happened on is the only page the undo is allowed to touch. */
let eraseActive = false;
let erasing = false, erasedStrokes = null;
/* A press that landed on the colour bar (#penPop) but has not yet decided
   whether it is a colour tap or the start of a stroke — see the pointerdown
   handler in initReader and the top of penMove. */
let penPopPress = null;
const ERASER_RADIUS = 22;   /* page-space px, generous for fingers */
/* Set when a draw was inconclusive because the tab was hidden (background tabs
   throttle the render pipeline). The draw is retried once the tab is visible
   instead of degrading the book to the browser viewer. */
let retryOnVisible = false;
let engine = 'internal';   /* 'internal' = our pdf.js renderer, 'browser' = viewer iframe */
let openSeq = 0;           /* invalidates an in-flight open when another book opens */
/* Every call to renderPage() takes a number. A render that was superseded
   while awaiting the page or the layout compares its number before touching
   the canvas, pageScale or the text layer, so an older draw can never land on
   top of a newer page after a fast run of page turns. */
let renderSeq = 0;
let hintTimer = null;
let hintShown = false;
/* Books whose internal render already failed here. Held in memory only, so the
   internal engine is retried on the next visit and no book stays degraded. */
const sessionFallback = new Set();

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('render-timeout')), ms))
]);

/* How long the renderer itself may take to arrive before the book is opened in
   the browser's own viewer instead. */
const ENGINE_BUDGET_MS = 20000;

/* A timed-out draw can still be attached to the canvas, and pdf.js tracks that
   attachment per canvas. The previous task therefore has to finish — or be
   cancelled and allowed to settle — before the canvas is drawn on again. The
   wait is bounded: a task stuck on a throttled worker must not block the next
   attempt forever. */
async function settleRenderTask() {
  const task = renderTask;
  renderTask = null;
  if (!task) return;
  try { task.cancel(); } catch (e) {}
  await Promise.race([
    Promise.resolve(task.promise).catch(() => {}),
    new Promise(r => setTimeout(r, 1500)),
  ]);
}

/* Budget for one page draw. The first page of a document pays for worker
   start-up and font/CMap fetches, which can take many seconds on a slow
   device — a too-tight budget is what pushes books into the browser viewer. */
const CANVAS_BUDGET = 12000;
const CANVAS_BUDGET_LAST = 20000;
const TEXT_BUDGET = 12000;
const TEXT_BUDGET_LAST = 24000;
/* Backstop for one complete opening draw. It must sit above the sum of the step
   budgets above, so the per-step decisions — which know whether it was the
   canvas or only the text layer that struggled — always decide first. */
const OPEN_BACKSTOP = 90000;
/* Budget for parsing/document setup itself, below the whole-open backstop so a
   hang is named here first. */
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
  /* An arrow, not the bare function: onclick would hand the click event to
     togglePageRead's `auto` flag, and a manual tap would read as the clock. */
  $('#markReadBtn').onclick = () => togglePageRead();
  $('#readerEngine').onclick = () => switchEngine();

  /* Scene lighting mode cycle */
  $('#dockMode').onclick = () => { mode = (mode + 1) % MODES.length; applyMode(); };

  /* Top command ribbon: pen, highlighter, eraser, undo, page jump, and settings */
  $('#dockPen')?.addEventListener('click', () => togglePen());
  $('#hlTool')?.addEventListener('click', () => toggleHighlight());
  $('#eraserTool')?.addEventListener('click', () => toggleEraser());
  $('#strokeUndoBtn')?.addEventListener('click', undoLastStroke);
  $('#clearPageStrokesBtn')?.addEventListener('click', clearPageStrokes);
  $('#pageJumpGo')?.addEventListener('click', jumpToInputPage);
  $('#pageJumpInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpToInputPage(); }
  });
  $('#pagePill').onclick = () => toggleDockPop('#pagePop');
  $('#goalChip')?.addEventListener('click', () => {
    if (curBook) window.dispatchEvent(new CustomEvent('open-goal', { detail: curBook.id }));
  });

  /* Subribbon tool mode switcher tabs */
  $('#subribbonHlTab')?.addEventListener('click', () => setToolMode('highlight'));
  $('#subribbonPenTab')?.addEventListener('click', () => setToolMode('draw'));

  /* Custom Color Pickers */
  $('#customHlPicker')?.addEventListener('input', e => {
    hlColor = e.target.value;
    strokeColor = hlColor;
    if (typeof document !== 'undefined') syncPenUI();
  });
  $('#customPenColor')?.addEventListener('input', e => {
    inkColor = e.target.value;
    strokeColor = inkColor;
    if (typeof document !== 'undefined') syncPenUI();
  });

  $('#dockSettings').onclick = () => toggleSettings(true);
  $('#settingsClose').onclick = () => toggleSettings(false);
  $('#modeChips').addEventListener('click', e => {
    const chip = e.target.closest('.set-chip[data-mode]');
    if (!chip) return;
    mode = Number(chip.dataset.mode) % MODES.length;
    applyMode();
  });
  $('#readerBright').addEventListener('input', e => setBrightness(Number(e.target.value)));

  /* Fixed Outside-Click Handler: Bubble phase, safely ignores clicks inside ribbon & popovers */
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#readerRibbon, .reader-top, .reader-subribbon, .reader-page-pop, .dock-pop, #penPop, #pagePop')) {
      toggleDockPop(null);
    }
  }, false);

  /* Freehand pen pointer events */
  $('#drawLayer').addEventListener('pointerdown', startPenStroke);
  window.addEventListener('pointermove', penMove);
  window.addEventListener('pointerup', penEnd);
  window.addEventListener('pointercancel', penEnd);
  /* Eraser drag */
  $('#drawLayer').addEventListener('pointerdown', startErase);
  window.addEventListener('pointermove', eraseMove);
  window.addEventListener('pointerup', endErase);
  window.addEventListener('pointercancel', endErase);

  /* The colour bar floats over the page, and on a desktop its row of swatches
     lands on the page's opening lines — so a press that begins on a swatch and
     then drags is a stroke aimed at the text underneath, while a press that
     never moves is a tap meant to pick that colour. Both readings are honoured:
     the press is held here until the pointer either travels past the slop (the
     stroke starts, anchored at the press point, and the bar folds away) or lifts
     where it started (the click runs untouched and the colour is chosen).

     Starting the stroke moves the pointer capture to the draw surface, so the
     release no longer shares an ancestor with the swatch and the tap's click
     never fires — the two outcomes stay mutually exclusive without a flag. */
  $('#penPop').addEventListener('pointerdown', e => {
    if (!penActive || eraseActive || e.button > 0) return;
    penPopPress = { id: e.pointerId, x: e.clientX, y: e.clientY, ev: e };
  });
  $('#penWidths').addEventListener('click', e => {
    const chip = e.target.closest('.pen-width[data-width]');
    if (!chip) return;
    activeWidthKey = chip.dataset.width;
    safeSet(STORAGE_KEYS.penWidth, activeWidthKey);
    if (typeof document !== 'undefined') syncPenUI();
  });
  restorePenPrefs();

  /* Zen mode */
  $('#readerStage').addEventListener('scroll', onStageScroll, { passive: true });
  $('#readerStage').addEventListener('click', onStageTap);
  /* Swipe to turn: bound once on the stage and decided per touch in the handler
     below, because all three of its conditions (no zoom, no pen, no eraser) can
     change between one touch and the next. */
  $('#readerStage').addEventListener('touchstart', onStageTouchStart, { passive: true });
  $('#readerStage').addEventListener('touchend', onStageTouchEnd, { passive: false });
  $('#fallbackRetry').onclick = () => switchEngine('internal');
  $('#readerHint').onclick = () => { $('#readerHint').hidden = true; };
  window.addEventListener('goal-changed', () => {
    if (curBook && !$('#readerView').hidden) updateGoalBar();
  });

  /* Pen colour swatches in #penPop */
  $('#penPop').addEventListener('click', e => {
    const dot = e.target.closest('.hl-dot');
    if (dot) {
      if (toolMode === 'draw') {
        inkColor = dot.dataset.color;
        strokeColor = inkColor;
      } else {
        hlColor = dot.dataset.color;
        strokeColor = hlColor;
      }
      if (typeof document !== 'undefined') syncPenUI();
      /* The colour is chosen; the bar has done its job. Folding it now hands the
         top of the page back to the pen without a second tap. */
      collapsePenPop();
      return;
    }
    /* A nib pick is the last thing anyone changes before drawing, so it folds
       the bar away too — unlike the tool tabs, which switch what the bar is
       showing and have to stay. */
    if (e.target.closest('.pen-width')) collapsePenPop();
  });

  /* The chevron is the explicit way back to the colour bar while a tool is in
     hand — the lit tool button in the ribbon is the implicit one. */
  $('#penPopToggle')?.addEventListener('click', () => {
    if (isPenPopHidden()) openPenPop();
    else collapsePenPop();
  });

  /* Text-selection toolbar: highlight the selected run or open a note for it. */
  $('#hlBar').addEventListener('click', e => {
    const dot = e.target.closest('.hl-dot');
    if (dot && lastSelectionRects) {
      curBook.highlights = curBook.highlights || [];
      curBook.highlights.push(highlightFromSelection(dot.dataset.color, lastSelectionRects));
      updateBook(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
      updatePageUI();
      clearSelectionState();
    }
    if (e.target.closest('#hlNoteBtn')) { pendingNoteHl = lastSelectionRects; openNoteForCurrentPage(); }
  });
  /* `change`, not `input`: a colour picker fires `input` on every pixel of a
     drag, which used to write a brand-new highlight record each time — dozens
     of duplicates of the same selection. The choice is taken once, when the
     picker closes on a colour. */
  $('#customHlBarColor')?.addEventListener('change', e => {
    if (lastSelectionRects) {
      curBook.highlights = curBook.highlights || [];
      curBook.highlights.push(highlightFromSelection(e.target.value, lastSelectionRects));
      updateBook(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
      updatePageUI();
      clearSelectionState();
    }
  });

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
    if (e.key === 'Escape') { $('#notesSheet').hidden = true; $('#hlBar').hidden = true; $('#eraseToast').hidden = true; $('#noteOverlay').hidden = true; toggleSettings(false); toggleDockPop(null); }
  });
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mousedown', e => {
    if (!$('#hlBar').hidden && !e.target.closest('#hlBar')) $('#hlBar').hidden = true;
  });

  window.addEventListener('resize', () => {
    if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPageSafe(true), 250);
  });

  /* Keyboard and rotation also resize the *visual* viewport without firing a
     window resize; without this hook the canvas keeps its stale dimensions and
     the page stays cropped after the notes field closes. Debounced exactly like
     the plain resize path. */
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => {
      if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderPageSafe(true), 250);
    });
  }

  /* A draw that only failed because the tab was hidden gets a second chance as
     soon as the tab is shown — the reader must not fall back for that. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !retryOnVisible) return;
    if ($('#readerView').hidden || !pdfDoc || engine === 'browser') return;
    retryOnVisible = false;
    renderPageSafe();
    updatePageUI();
  });

  // Close the reader when navigating away from the library
  document.addEventListener('click', e => {
    const tab = e.target.closest('.nav-tab, .more-item');
    if (tab && tab.dataset.page && tab.dataset.page !== 'library' && !$('#readerView').hidden) closeReader();
  });

  /* Page note */
  $('#addNoteBtn').onclick = () => { toggleDockPop(null); pendingNoteHl = null; togglePen(false); openNoteForCurrentPage(); };
  $('#noteSave').onclick = saveNote;
  $('#noteClose').onclick = () => { $('#noteOverlay').hidden = true; };
  $('#noteOverlay')?.addEventListener('click', e => {
    if (e.target === $('#noteOverlay')) $('#noteOverlay').hidden = true;
  });

  /* Notes panel */
  $('#readerNotes').onclick = () => { toggleDockPop(null); buildNotes(); $('#notesSheet').hidden = false; };
  $('#notesClose').onclick = () => { $('#notesSheet').hidden = true; };
  $('#notesExport').onclick = exportNotes;
  $('#notesSheet')?.addEventListener('click', e => {
    if (e.target === $('#notesSheet')) $('#notesSheet').hidden = true;
  });
  $('#settingsSheet')?.addEventListener('click', e => {
    if (e.target === $('#settingsSheet')) toggleSettings(false);
  });
  $('#eraseUndoBtn')?.addEventListener('click', performEraseUndo);

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

/* One dock-side button reflects the current tint; the glyph swaps with it. */
function syncModeBtn() {
  const btn = $('#dockMode');
  MODES.forEach(m => btn.classList.remove(m));
  btn.classList.add(MODES[mode]);
  btn.title = ['نور روز', 'سپیا', 'نور شب'][mode];
  btn.setAttribute('aria-label', btn.title);
}

/* ── Optical filters ──
   The tint and the manual brightness are separate: one decides the character
   of the page (day / sepia / night), the other how bright it renders. Both are
   published as CSS variables the render stack reads, so pdf.js is never asked
   to repaint for a colour change. */
function applyOptics() {
  const stage = $('#readerStage');
  stage.style.setProperty('--reader-bright', String(bright));
  stage.classList.toggle('has-fx', mode !== 0 || bright !== 1);
}

function setBrightness(percent) {
  bright = Math.min(1.4, Math.max(.6, percent / 100));
  applyOptics();
  syncSettingsUI();
}

function applyZoom(next) {
  const z = Math.min(3, Math.max(.5, +next.toFixed(2)));
  if (z === zoom) return;
  zoom = z;
  /* The fallback engine keeps its own zoom inside the frame URL; the internal
     renderer redraws. Zoom used to be a no-op on the fallback engine. */
  if (engine === 'browser') {
    $('#pdfFrame').src = `${pdfObjectUrl}#page=${curPage}&zoom=${Math.round(zoom * 100)}`;
  } else {
    renderPageSafe();
  }
  syncSettingsUI();
}

/* ── Reading settings sheet ── */
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

/* ── Dual Annotation Engine: Draw (fine pen) vs. Highlight (broad marker) ── */
/* The eraser and the undo only matter once there is something to erase or a tool in
   hand, so an idle toolbar shows two fewer buttons (they come back the moment a
   tool is picked or the page has a mark on it). */
function syncDrawExtras() {
  const hasMarks = (curBook?.highlights || []).some(h => h.page === curPage);
  $('#drawGroup')?.classList.toggle('show-extras', Boolean(penActive || eraseActive || hasMarks));
}

function setToolMode(mode) {
  if (mode === toolMode) {
    mode = null;
  }
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
    toggleDockPop(null);
    prepareDrawCanvas();
    if (!penHintShown && engine === 'internal') {
      penHintShown = true;
      const hint = $('#readerHint');
      hint.textContent = toolMode === 'draw'
        ? 'قلم تحریری آماده است — روی صفحه خط بکش یا یادداشت کن'
        : 'هایلایتر آماده است — روی متن یا صفحه بکش';
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { hint.hidden = true; }, 4000);
    }
  } else {
    drawStroke = null;
    $('#readerHint').hidden = true;
  }
  if (typeof document !== 'undefined') syncPenUI();
  syncDrawExtras();
}

function togglePen(force) {
  if (typeof force === 'boolean') {
    setToolMode(force ? (toolMode || 'draw') : null);
    return;
  }
  /* Tapping the lit pen normally puts it away. Once a stroke has tucked the
     colour picker down, though, the tool button is where the hand goes to ask
     for a different colour — so it re-opens the picker first, and only a
     second tap (with the picker already out) retires the tool. */
  if (toolMode === 'draw' && isPenPopHidden()) { openPenPop(); return; }
  setToolMode(toolMode === 'draw' ? null : 'draw');
}

function toggleHighlight(force) {
  if (typeof force === 'boolean') {
    setToolMode(force ? (toolMode || 'highlight') : null);
    return;
  }
  if (toolMode === 'highlight' && isPenPopHidden()) { openPenPop(); return; }
  setToolMode(toolMode === 'highlight' ? null : 'highlight');
}

function toggleEraser(force) {
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
    toggleDockPop(null);
    prepareDrawCanvas();
  } else if (erasing) {
    endErase();
  }
  syncDrawExtras();
}

/* Direct Undo of the last drawn or highlighted mark on the current page */
function undoLastStroke() {
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
  updateBook(curBook.id, { highlights: curBook.highlights });
  paintHighlights();
  updatePageUI();
  erasedStrokes = { page: curPage, items: [{ h: removed, index: lastIdx }] };
  showEraseUndo();
}

/* Clear all drawn strokes on current page with undo toast */
function clearPageStrokes() {
  if (!curBook) return;
  const keep = [];
  const items = [];
  (curBook.highlights || []).forEach((h, i) => {
    if (h.page === curPage) {
      items.push({ h, index: i });
    } else {
      keep.push(h);
    }
  });
  if (items.length) {
    erasedStrokes = { page: curPage, items };
    curBook.highlights = keep;
    updateBook(curBook.id, { highlights: keep });
    paintHighlights();
    updatePageUI();
    showEraseUndo();
  }
}

/* Direct page jump from input */
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

/* Point-to-segment distance in *current page space* — the hit radius is
   expressed in what the user sees, so it works identically at every zoom. */
function strokeHit(h, px, py, f) {
  const pts = h.pts || [];
  if (pts.length < 2) {
    /* A stroke with no points has nothing to be near; without this guard the
       eraser threw on `pts[0].x` and the whole gesture stopped. */
    if (!pts.length) return false;
    const dx = pts[0].x * f - px, dy = pts[0].y * f - py;
    return dx * dx + dy * dy <= ERASER_RADIUS * ERASER_RADIUS;
  }
  const r2 = ERASER_RADIUS * ERASER_RADIUS;
  let ax = pts[0].x * f, ay = pts[0].y * f;
  for (let i = 1; i < pts.length; i++) {
    const bx = pts[i].x * f, by = pts[i].y * f;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    if (ex * ex + ey * ey <= r2) return true;
    ax = bx; ay = by;
  }
  return false;
}

function startErase(e) {
  if (!eraseActive || penActive || e.button > 0) return;
  e.preventDefault();
  prepareDrawCanvas();
  collapsePenPop();
  erasing = true;
  erasedStrokes = { page: curPage, items: [] };
  eraseCursor(e);
  eraseAt(e);
  /* A synthetic/stale pointer must not break the gesture. */
  try { $('#drawLayer').setPointerCapture(e.pointerId); } catch (err) {}
}

function eraseAt(e) {
  if (!erasing || !eraseActive || penActive || !curBook) return;
  const p = penPos(e);
  const keep = [];
  let removedAny = false;
  if (!erasedStrokes || erasedStrokes.page !== curPage) erasedStrokes = { page: curPage, items: [] };
  (curBook.highlights || []).forEach((h, i) => {
    const f = h.scale ? pageScale / h.scale : 1;
    /* Both mark kinds are erasable: drawn strokes hit by their polyline,
       text-selection highlights by any of their rects. */
    let hit = false;
    if (h.page === curPage) {
      if (h.free && h.pts) hit = strokeHit(h, p.x, p.y, f);
      else if (h.rects) hit = h.rects.some(r =>
        p.x >= r.x * f - ERASER_RADIUS && p.x <= (r.x + r.w) * f + ERASER_RADIUS &&
        p.y >= r.y * f - ERASER_RADIUS && p.y <= (r.y + r.h) * f + ERASER_RADIUS);
    }
    if (hit) { erasedStrokes.items.push({ h, index: i }); removedAny = true; }
    else keep.push(h);
  });
  if (removedAny) {
    curBook.highlights = keep;
    updateBook(curBook.id, { highlights: keep });
    paintHighlights();
  }
}

function eraseMove(e) {
  if (!eraseActive || penActive || !erasing) return;
  eraseCursor(e);
  eraseAt(e);
}

function endErase() {
  erasing = false;
  hideEraserCursor();
  if (erasedStrokes && erasedStrokes.items.length) {
    showEraseUndo();
    /* Keep the removed records parked until the toast hides or the user acts —
       performEraseUndo/hideEraseUndo own this reference from here on. */
    return;
  }
  erasedStrokes = null;
}

function eraseCursor(e) {
  let c = $('#eraserCursor');
  if (!c) {
    c = document.createElement('div');
    c.id = 'eraserCursor';
    c.className = 'eraser-cursor';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
  }
  c.style.left = e.clientX + 'px';
  c.style.top = e.clientY + 'px';
}

function hideEraserCursor() {
  /* Removed outright — a stale halo must never linger into another book or
     engine (teardown relies on this, not just on visibility). */
  $('#eraserCursor')?.remove();
}

/* Undo toast for erasing — reuses the existing toast styles with its own
   element so the task-undo flow is never disturbed. */
let eraseUndoTimer = null;
let eraseHideTimer = null;
function showEraseUndo() {
  const toast = $('#eraseToast');
  if (!toast) return;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(eraseUndoTimer);
  /* A hide that was already on its way out must be called off: a second erase
     landing inside the 300ms fade used to have its toast hidden and its parked
     strokes wiped by the first erase's timer. */
  clearTimeout(eraseHideTimer);
  eraseUndoTimer = setTimeout(hideEraseUndo, 5000);
}
function hideEraseUndo() {
  const toast = $('#eraseToast');
  if (!toast) return;
  toast.classList.remove('show');
  clearTimeout(eraseHideTimer);
  eraseHideTimer = setTimeout(() => { toast.hidden = true; eraseHideTimer = null; }, 300);
  erasedStrokes = null;
}
function performEraseUndo() {
  /* The parked strokes are still live until the toast goes away — but only for
     the page they were erased from. Undoing from anywhere else would push those
     records back into a `highlights` array they no longer describe. */
  if (!erasedStrokes || !erasedStrokes.items.length || !curBook || erasedStrokes.page !== curPage) {
    hideEraseUndo();
    return;
  }
  clearTimeout(eraseUndoTimer);
  curBook.highlights = curBook.highlights || [];
  erasedStrokes.items.forEach(({ h }) => {
    curBook.highlights.push(h);
  });
  erasedStrokes = null;
  updateBook(curBook.id, { highlights: curBook.highlights });
  paintHighlights();
  updatePageUI();
  hideEraseUndo();
}

/* Size the draw surface to the current page wrap. Called on pen enable and on
   every page render; cheap, and idempotent when nothing changed. `force`
   wipes the surface even when the size is unchanged — that is how a page turn
   guarantees strokes from the previous page never linger. */
function prepareDrawCanvas(force) {
  const wrap = $('#pageWrap');
  const c = $('#drawLayer');
  const w = Math.round(wrap.offsetWidth), h = Math.round(wrap.offsetHeight);
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (force || c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    drawCtx = c.getContext('2d');
    drawCtx.scale(dpr, dpr);
  }
}

function penPos(e) {
  const r = $('#drawLayer').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startPenStroke(e) {
  if (!penActive || eraseActive || e.button > 0) return;
  e.preventDefault();
  prepareDrawCanvas();
  if (!drawCtx) return;
  collapsePenPop();
  const p = penPos(e);
  const kind = toolMode || 'draw';
  drawStroke = {
    color: strokeColor,
    kind,
    width: strokeWidth,
    pts: [p]
  };
  try { $('#drawLayer').setPointerCapture(e.pointerId); } catch (err) {}
  paintStrokeLive();
}

/* Live trail: smooth quadratic Bézier curve interpolation */
function paintStrokeLive() {
  if (!drawCtx || !drawStroke) return;
  const pts = drawStroke.pts;
  if (pts.length < 2) return;
  const isDraw = drawStroke.kind === 'draw';
  drawCtx.save();
  drawCtx.strokeStyle = resolveColor(drawStroke.color);
  drawCtx.globalAlpha = isDraw ? 1.0 : 0.38;
  drawCtx.lineWidth = drawStroke.width;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  if (pts.length === 2) {
    drawCtx.beginPath();
    drawCtx.moveTo(pts[0].x, pts[0].y);
    drawCtx.lineTo(pts[1].x, pts[1].y);
    drawCtx.stroke();
  } else {
    const p0 = pts[pts.length - 3];
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];
    const mid1X = (p0.x + p1.x) / 2;
    const mid1Y = (p0.y + p1.y) / 2;
    const mid2X = (p1.x + p2.x) / 2;
    const mid2Y = (p1.y + p2.y) / 2;
    drawCtx.beginPath();
    drawCtx.moveTo(mid1X, mid1Y);
    drawCtx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
    drawCtx.stroke();
  }
  drawCtx.restore();
}

function penMove(e) {
  if (!penActive || eraseActive) return;
  /* A press that started on the colour bar becomes a stroke only once it has
     travelled far enough to be a drag rather than a tap. */
  if (penPopPress && e.pointerId === penPopPress.id) {
    if (drawStroke) { penPopPress = null; }
    else if (Math.hypot(e.clientX - penPopPress.x, e.clientY - penPopPress.y) > 4) {
      const start = penPopPress;
      penPopPress = null;
      startPenStroke(start.ev);
    } else return;
  }
  if (!drawStroke) return;
  const p = penPos(e);
  const pts = drawStroke.pts;
  const last = pts[pts.length - 1];
  /* Skip micro-moves: fewer points, lighter records. */
  if (last && Math.abs(p.x - last.x) < 1.5 && Math.abs(p.y - last.y) < 1.5) return;
  pts.push(p);
  paintStrokeLive();
}

function penEnd(e) {
  /* A press on the colour bar that never travelled was a colour tap: the click
     runs untouched and this hold is simply released. */
  if (e && penPopPress && e.pointerId === penPopPress.id) penPopPress = null;
  if (eraseActive || !drawStroke) return;
  const s = drawStroke;
  drawStroke = null;
  const pts = simplifyStroke(s.pts);
  if (pts.length < 2) { clearDrawCanvas(); return; }   /* a tap is not a mark */
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
  updateBook(curBook.id, { highlights: curBook.highlights });
  /* Wipe the live trail first, then let paintHighlights redraw the committed
     strokes — the reverse order would erase the fresh mark. */
  clearDrawCanvas();
  paintHighlights();
  updatePageUI();
}

/* Douglas–Peucker-lite: keep points that bend the trail more than 2px. A
   stroke recorded at ~60 points loses ~80% of its points with no visible
   difference, which is what keeps localStorage light. */
function simplifyStroke(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let lastA = pts[0], lastB = pts[1];
  for (let i = 2; i < pts.length; i++) {
    const p = pts[i];
    const dx = lastB.x - lastA.x, dy = lastB.y - lastA.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - lastA.x) * dx + (p.y - lastA.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = lastA.x + t * dx - p.x, py = lastA.y + t * dy - p.y;
    if (px * px + py * py > 4) { out.push(p); lastA = lastB; lastB = p; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function clearDrawCanvas() {
  if (drawCtx) drawCtx.clearRect(0, 0, $('#drawLayer').width, $('#drawLayer').height);
}

/* ── Study dock ── */
const DOCK_POPS = { '#penPop': '#dockPen', '#pagePop': '#pagePill' };
let openPop = null;

/* The colour bar (#penPop) opens under the ribbon, which means it hangs over the
   top of the page — and the page is the one thing the pen is for. It used to
   sit there for the whole of a drawing session, covering the first lines of
   every page and swallowing the taps meant for them.

   So it is a picker, not a palette: it is up while a choice is being made and
   down while either pen is in hand. Every path that ends a choice — the first
   stroke, a tapped swatch, its own chevron — folds it away, and the lit tool
   button in the ribbon brings it back. */
function isPenPopHidden() {
  const pop = $('#penPop');
  return !pop || pop.hidden;
}
function openPenPop() {
  const pop = $('#penPop');
  if (!pop || !penActive) return;
  toggleDockPop(null);
  pop.hidden = false;
  $('#penPopToggle')?.setAttribute('aria-expanded', 'true');
}
function collapsePenPop() {
  const pop = $('#penPop');
  if (pop) pop.hidden = true;
  $('#penPopToggle')?.setAttribute('aria-expanded', 'false');
  toggleDockPop(null);
}

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

/* A tap on the page brings the dock back; it never hides it, so a stray tap
   while selecting text cannot take the controls away. */
function onStageTap(e) {
  if (e.target.closest('#hlBar,.dock-pop,.sheet,.overlay,.reader-ribbon,.reader-page-pop,.reader-subribbon')) return;
  if (zenHidden) setZen(false);
  else toggleDockPop(null);
}

/* ── Swipe to turn the page ──
   The reader's own engine draws one page at a time inside a stage that is a
   scroll container, so on a phone the only ways to the next page were the two
   arrow buttons and the page popover — both of them at the far edge or behind
   a tap. A horizontal swipe is what a hand already expects from a reader, and
   the stage is exactly the surface it should work on.

   It is deliberately narrow: a swipe only turns a page at zoom 1 (any zoom makes
   the drag a pan, which is the whole point of having zoomed), never while the pen
   or the eraser is armed (those drags draw and erase), never for a second finger
   (that is a pinch), and never when the drag started on a text selection. The
   decision is made on `touchstart` from the conditions as they are *then*, so a
   gesture cannot change meaning halfway through. */
let swipeOrigin = null;

/* Somewhere inside a live selection: the drag belongs to the selection handles,
   not to the page. */
function inActiveSelection(node) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  if (!node || sel.containsNode?.(node, true)) return true;
  return [...sel.getClientRects()].some(r => r.width > 1 && r.height > 1);
}

function onStageTouchStart(e) {
  swipeOrigin = null;
  if (e.touches.length !== 1) return;
  if (zoom !== 1 || penActive || eraseActive) return;
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
  /* Long enough to be a swipe rather than a tap, flat enough to be horizontal
     rather than a scroll, and past the slop browsers use for a tap. */
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  /* RTL, and the direction a hand already knows from a Persian book: the pages
     are bound on the right, so the next one arrives by dragging the current page
     to the right — dx > 0 is forward, the way the next-page arrow points. */
  if (curBook && curPage >= (curBook.numPages || 1) && dx > 0) return;
  if (curPage <= 1 && dx < 0) return;
  e.preventDefault();
  gotoPage(curPage + (dx > 0 ? 1 : -1));
}

/* ── Open/Close ── */

/* ═══ PDF Canvas Virtualization & Buffer Management ═══
   Only the currently visible page plus at most 1 page above and 1 page below
   keeps an active canvas buffer in memory (window = [curPage - 1, curPage, curPage + 1]).
   Pages outside this window immediately release GPU backing textures (canvas.width = 0,
   canvas.height = 0) while #pageWrap maintains exact dimensions to avoid scroll jumps. */
const PAGE_WINDOW_RADIUS = 1;
const pageBufferMap = new Map(); // pageNum -> { canvas, width, height }

function prunePageBuffers(activePage) {
  for (const [p, buf] of pageBufferMap.entries()) {
    if (Math.abs(p - activePage) > PAGE_WINDOW_RADIUS) {
      if (buf && buf.canvas) {
        buf.canvas.width = 0;
        buf.canvas.height = 0;
        buf.canvas = null;
      }
      pageBufferMap.delete(p);
    }
  }
}

/* Tear down whatever the previous document left behind: pending renders, the
   document itself, its object URL and the layers attached to it. Every open
   starts from a clean engine, so two books can never share state. */
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
  clearDrawCanvas();
  drawStroke = null;

  // Release GPU textures on closing / tearing down engine
  const pc = $('#pdfCanvas');
  if (pc) {
    pc.width = 0;
    pc.height = 0;
    pc.style.width = '';
    pc.style.height = '';
  }
  const dl = $('#drawLayer');
  if (dl) {
    dl.width = 0;
    dl.height = 0;
    dl.style.width = '';
    dl.style.height = '';
  }
  drawCtx = null;
  prunePageBuffers(-999);
  /* Nothing from the eraser session may survive the book that owns its
     strokes: the mode itself, an in-flight drag, the halo cursor and the undo
     toast (with its timer) are all invalidated right here. */
  erasing = false;
  hideEraserCursor();
  clearTimeout(eraseUndoTimer);
  $('#eraseToast').hidden = true;
  if (eraseActive) toggleEraser(false);
  erasedStrokes = null;
  /* A pen left on from the previous book must not silently swallow the first
     drag on the new one — the toggle also re-syncs every visual state. */
  if (penActive) togglePen(false);
}

/* Flip between our own renderer and the browser viewer for the open book. */
function switchEngine(to) {
  if (!curBook) return;
  const target = to || (engine === 'browser' ? 'internal' : 'browser');
  updateBook(curBook.id, { viewer: target, fallback: false });
  curBook.viewer = target;
  if (target === 'internal') sessionFallback.delete(curBook.id);
  openReader(curBook.id, { forceInternal: target === 'internal' });
}

/* One-time, session-scoped hint that highlighting starts with selecting text. */
function maybeShowHighlightHint() {
  if (hintShown || engine !== 'internal') return;
  if (!$('#textLayer').querySelector('span')) return;   /* scanned page: nothing to select */
  hintShown = true;
  const hint = $('#readerHint');
  hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.hidden = true; }, 7000);
}

async function openReader(id, opts = {}) {
  const seq = ++openSeq;                 /* supersede any in-flight open */
  const book = getBook(id); if (!book) return;
  /* The timer closes before `curBook` is rebound. A session running from the
     previous book has to bank its minutes against *that* book — stopping it
     after the assignment (as teardown does for everything else) credited the
     reading time to whichever book was opened next. */
  if (timer.running) stopTimerSession();
  cancelAutoRead();
  curBook = book;
  /* Bind the page before the first draw: renderPage() reads curPage, so
     without this a freshly opened book would first paint the previous book's
     page number. Clamped again once the page count is known. */
  curPage = Math.max(1, book.lastPage || 1);
  teardownEngine();
  textLayerBroken = false;
  /* A new book starts from a clean reading surface: dock visible, no stale
     menu, no leftover scroll anchor from the previous book. */
  setZen(false);
  lastScrollTop = 0;
  toggleDockPop(null);
  toggleSettings(false);
  $('#shelfView').hidden = true;
  $('#readerView').hidden = false;
  document.body.classList.add('reader-immersive');
  $('#readerHint').hidden = true;
  $('#readerTitle').textContent = book.title;
  /* Reset the page chrome to this book before the first draw, so the previous
     book's page numbers, percentage and goal can't linger while it loads. */
  updatePageUI();
  updateGoalBar();
  const thumb = $('#readerThumb');
  if (book.cover) { thumb.src = book.cover; thumb.hidden = false; } else thumb.hidden = true;
  $('#readerLoading').hidden = false;

  const blob = await getBookBlob(id);
  if (seq !== openSeq) return;                       /* another book took over */
  /* The PDF for this shelf entry is gone — a wiped IndexedDB, an import that
     never finished writing. A browser alert would have said so in the browser's
     own colours; the notice says it in the app's. */
  if (!blob) {
    showNotice('فایل این کتاب پیدا نشد؛ دوباره از کتابخانه اضافه‌ش کن.', { actionLabel: 'باشه' });
    closeReader();
    return;
  }
  pdfObjectUrl = URL.createObjectURL(blob);

  /* Our own renderer is the default. The browser viewer is used only when it
     was chosen deliberately for this book, or after the internal renderer
     already failed here in this session — never written to the book, so the
     internal engine gets a fresh chance next time. In native Android WebView,
     the browser iframe viewer is unsupported so we always use our renderer. */
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
      /* A getDocument that never settles (a hung worker) must not keep the
         loading veil up forever; the backstop hands the book to the browser
         viewer instead. */
      const doc = await withTimeout(lib.getDocument({ data, ...PDF_ASSETS }).promise, DOC_BUDGET_MS);
      if (seq !== openSeq) { doc.destroy(); return; }
      pdfDoc = doc;
      ok = true;
    } catch (err) {
      /* A renderer that never arrived is a different situation from a file
         that failed to render: the browser viewer covers both, but only this
         one is about the connection rather than about the book. */
      engineMissing = !pdfjsLib;
      console.warn(engineMissing
        ? 'موتور نمایش PDF در دسترس نبود؛ نمایشگر مرورگر استفاده می‌شود:'
        : 'رندر اختصاصی ممکن نشد؛ نمایشگر مرورگر استفاده می‌شود:', err);
    }
  }
  if (ok) {
    let status = null;
    try {
      /* Backstop only: the per-step budgets inside renderPage (canvas, then
         text layer) are what bound the work. */
      status = await withTimeout(renderPage(), OPEN_BACKSTOP);
      drawn = true;
    } catch (err) {
      /* Same rule as a failed draw: a backstop timeout in a throttled hidden
         tab is not evidence that the file can't be rendered. */
      console.warn('رندر صفحه کامل نشد:', err);
      if (document.visibilityState === 'hidden') retryOnVisible = true;
      else ok = false;
    }
    if (seq !== openSeq) return;
    /* Only a canvas that truly failed switches the engine. A slow or
       unbuildable text layer must never do that, otherwise a heavy RTL page
       would lose its selection, highlights and notes. */
    if (status && status.canvasOk === false) {
      /* Hidden tabs throttle the render pipeline, so a timeout there says
         nothing about the file. Stay on the internal engine and draw again
         when the tab is visible. */
      if (document.visibilityState === 'hidden') retryOnVisible = true;
      else ok = false;
    }
  }
  if (!ok) {
    engine = 'browser';
    /* Only a book that failed to render is remembered for this session. A
       renderer that failed to download says nothing about the file, so the
       next open — or the engine switch in study settings — tries again. */
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
    /* Older builds could pin a book to the iframe viewer for good. Only a
       record that actually carries that stale flag is rewritten — opening a
       book must not touch records that never had one. */
    if (book.fallback || (book.viewer && book.viewer !== 'internal')) {
      updateBook(id, { viewer: 'internal', fallback: false });
    }
  }

  $('#pageRange').max = book.numPages || 999999;
  /* The page count only becomes real here — an imported book was created with 0
     — so this is the moment the goal sheet's cap can be corrected. It runs even
     if the goal sheet is closed, because that is the state the next open reads. */
  syncGoalPageCap(id, book.numPages);
  curPage = Math.min(Math.max(1, curPage), book.numPages || curPage);
  zoom = 1;
  applyMode();
  prepareDrawCanvas();
  if (engine === 'browser') {
    $('#pdfFrame').src = `${pdfObjectUrl}#page=${curPage}&zoom=100`;
  } else {
    /* A draw that already finished must not be repeated — a second full render
       costs the same again. Only a first draw that never completed is retried,
       and only when the tab can actually paint; a throttled background tab is
       handled by the visibility handler instead. */
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

/* Switch the visible stage to the browser-viewer iframe */
function engageFallbackUI(reason) {
  /* The iframe never sees our pointer events: the pen, the eraser and any
     in-flight gesture have to retire the moment this engine takes over. */
  if (penActive) togglePen(false);
  if (eraseActive) toggleEraser(false);
  erasing = false;
  hideEraserCursor();
  clearTimeout(eraseUndoTimer);
  $('#eraseToast').hidden = true;
  erasedStrokes = null;
  $('#pdfCanvas').hidden = true;
  $('#textLayer').hidden = true;
  $('#highlightLayer').hidden = true;
  $('#pdfFallback').hidden = false;
  $('#fallbackText').textContent = reason === 'engine' ? NO_ENGINE_TEXT : FALLBACK_REASONS[reason] || FALLBACK_REASONS.auto;
}

function closeReader() {
  openSeq++;
  teardownEngine();
  cancelAutoRead();
  if (timer.running) stopTimerSession();
  curBook = null;
  lastSelectionRects = null;
  pendingNoteHl = null;
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

/* ── Custom page rendering (canvas + text layer) ── */

/* A book can be opened before its stage has been laid out (tab restored in the
   background, container not yet measured). Reading the box at that moment gives
   a zero size, which clamps the page to the minimum scale. Wait briefly for the
   layout, then fall back to the window box so a page always gets a usable size. */
async function stageBox() {
  const stage = $('#readerStage');
  /* A hidden tab never computes layout, and its timers are throttled — waiting
     there would only delay the first page, so use the window box at once. */
  if (document.visibilityState === 'visible') {
    for (let i = 0; i < 8 && stage.clientWidth < 40; i++) await new Promise(r => setTimeout(r, 40));
  }
  return {
    w: stage.clientWidth || window.innerWidth || 360,
    h: stage.clientHeight || window.innerHeight || 640,
  };
}

async function maybeGenerateCover(page) {
  /* True while the cover draw is using this page; renderPage's cleanup waits
     for it instead of releasing the page underneath it. */
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
    /* The page draw may have finished while this was running; its cleanup was
       deferred to here so the page stayed alive long enough to make a cover. */
    if (coverCleanup) { const p = coverCleanup; coverCleanup = null; safeCleanup(p); }
  }
}

async function renderPage(keepScroll) {
  if (!pdfDoc || !curBook) return { canvasOk: true, cancelled: true };
  const doc = pdfDoc, seq = openSeq;
  const myRender = ++renderSeq, atPage = curPage;
  /* True as soon as a newer render (or a newer book) has taken over. The page
     number is checked as well: a page turn bumps renderSeq on its own, but a
     render that is superseded without a new renderPage call must not write to
     the canvas for the page the reader has already left either. */
  const stale = () => myRender !== renderSeq || doc !== pdfDoc || seq !== openSeq || atPage !== curPage;
  if (renderTask) { try { renderTask.cancel(); } catch (e) {} }
  if (textLayerTask) { try { textLayerTask.cancel(); } catch (e) {} }
  const page = await doc.getPage(atPage);
  /* Another book took over while we were fetching this page. */
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  const wrap = $('#pageWrap');
  const stage = $('#readerStage');
  const box = await stageBox();
  /* Another book took over, or the reader closed, while waiting for layout. */
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  const availW = box.w - 28;
  const availH = box.h - 28;
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(availW / base.width, availH / base.height);
  const scale = Math.max(.2, fit * zoom);
  const viewport = page.getViewport({ scale });

  pageScale = scale;
  const canvas = $('#pdfCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  wrap.style.width = viewport.width + 'px';
  wrap.style.height = viewport.height + 'px';

  const ctx = canvas.getContext('2d');
  /* Two attempts: a cold worker can spend longer than one budget on the very
     first page and still be perfectly able to draw it right after. */
  let canvasOk = false;
  const budgets = [CANVAS_BUDGET, CANVAS_BUDGET_LAST];
  for (let attempt = 0; attempt < budgets.length && !canvasOk; attempt++) {
    /* The previous attempt has to be settled before the canvas is reused,
       otherwise pdf.js refuses the second render, both attempts are spent on
       that error and a perfectly renderable page is written off. */
    await settleRenderTask();
    try {
      if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
      renderTask = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      await withTimeout(renderTask.promise, budgets[attempt]);
      canvasOk = true;
    } catch (e) {
      /* A cancelled render was superseded by a newer one, which is not a failure. */
      if (e?.name === 'RenderingCancelledException') { canvasOk = true; break; }
      console.warn(e);
    }
  }
  await settleRenderTask();
  /* The cancelled path used to claim the page was fine before this check, so a
     stale draw could still clear the text layer of the page now on screen. */
  if (stale()) { safeCleanup(page); return { canvasOk: true, cancelled: true }; }
  if (!canvasOk) {
    /* Don't leave the previous page's invisible runs behind: stale text would
       still be selectable and would mis-map highlights. */
    $('#textLayer').innerHTML = '';
    paintHighlights();
    safeCleanup(page);
    return { canvasOk: false };
  }

  /* The page is readable now; the text layer only adds selection on top of it,
     so it must not keep the reader hidden behind the loading veil. The goal bar
     is stored state too, so it is revealed together with the page. */
  if (!$('#readerLoading').hidden) {
    updatePageUI();
    updateGoalBar();
    $('#readerLoading').hidden = true;
  }
  if (canvasOk && curPage === 1 && curBook && !curBook.cover) {
    /* Fire-and-forget: the cover draw runs on this same page object, so the
       page must not be cleaned up underneath it. maybeGenerateCover raises the
       in-flight flag itself, before its first await. */
    maybeGenerateCover(page);
  }

  /* Text layer — source of truth for selection.
     pdf.js lays out every run with `calc(var(--scale-factor) * Npx)`, so the
     scale factor has to be published on the container before the layer is
     built. Without it those declarations are invalid and the transparent runs
     stop matching the canvas — selection and highlights then sit on the wrong
     glyphs (very visible with RTL/Persian lines).
     If the environment can't build it (scanned page, stalled layer), skip
     further attempts instead of paying the timeout on every page. */
  const tl = $('#textLayer');
  tl.innerHTML = '';
  tl.style.setProperty('--scale-factor', String(scale));
  tl.style.width = viewport.width + 'px';
  tl.style.height = viewport.height + 'px';
  /* Selection is the only way to a highlight, so a heavy RTL page (thousands
     of runs) gets a second, longer attempt before the page is written off. */
  if (!textLayerBroken && pdfjsLib) {
    const textBudgets = [TEXT_BUDGET, TEXT_BUDGET_LAST];
    for (let attempt = 0; attempt < textBudgets.length; attempt++) {
      try {
        /* disableNormalization keeps the document's own characters (as upstream's
           text layer does) instead of letting the pipeline rewrite RTL runs. */
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
        /* The timed-out layer may still hold the container or keep writing to
           it; cancel it and start the next attempt from an empty layer so runs
           can't be duplicated (duplicates would double up selections). */
        try { textLayerTask.cancel(); } catch (err) {}
        textLayerTask = null;
        tl.innerHTML = '';
        if (attempt === textBudgets.length - 1) textLayerBroken = true;
      }
    }
  }

  /* A page turn can land inside the text-layer build above; the wrap box and
     the highlight layer belong to whatever page is on screen now, so a stale
     render must not resize the trail surface or repaint another page's marks. */
  if (stale()) { cleanupWhenIdle(page); return { canvasOk: true, cancelled: true }; }

  /* The trail surface must follow the rendered page — zoom, resize and page
     turns all change the wrap box; a resize also wipes the surface, so the
     strokes of the *new* page are painted after it, never the old ones. The
     forced wipe is what separates a page turn from a same-size redraw. */
  prepareDrawCanvas(true);
  paintHighlights();
  if (!keepScroll) stage.scrollTop = 0;
  /* The page's own resources (the operator list, fonts) are released as soon as
     the page has been drawn: a long book that keeps every page alive runs out
     of memory, and the page can always be fetched and parsed again. */
  /* Prune active buffers to keep at most visible page ± 1 page */
  prunePageBuffers(atPage);
  pageBufferMap.set(atPage, { width: viewport.width, height: viewport.height });

  cleanupWhenIdle(page);
  return { canvasOk: true };
}

/* page.cleanup() is a hint, not a contract — a viewer build without it, or a
   page that has already been disposed, must never take the draw down. */
function safeCleanup(page) {
  try { page?.cleanup?.(); } catch (e) { /* nothing more to release */ }
}

/* A page can only be cleaned up once nobody is drawing from it. The cover
   generator of page 1 is the one long-lived user of a page object, so when it
   is in flight the cleanup is parked here until it finishes. */
let coverPending = false;
let coverCleanup = null;

function cleanupWhenIdle(page) {
  if (coverPending) { coverCleanup = page; return; }
  safeCleanup(page);
}

/* An unhandled rejection from a background draw would surface as a console
   error for a page the reader has already left. renderPage reports failure by
   its return value, so a caller that does not await it only needs it silenced. */
const renderPageSafe = (keepScroll) => renderPage(keepScroll).catch(err => {
  console.warn('رندر صفحه انجام نشد:', err);
});

/* Two small helpers wired after init: the pen colour selection needs a visual
   state, and the sync of the draw surface happens inside renderPage. */
/* Re-apply the remembered nib size and colour on every boot. Missing or
   corrupt storage falls back to the defaults silently. */
function restorePenPrefs() {
  const w = readString(STORAGE_KEYS.penWidth, '');
  if (w && (DRAW_WIDTHS[w] || HL_WIDTHS[w] || PEN_WIDTHS[w])) activeWidthKey = w;
  if (typeof document !== 'undefined') syncPenUI();
}

function syncPenUI() {
  if (typeof document === 'undefined') return;
  const isDraw = toolMode === 'draw';
  strokeColor = isDraw ? inkColor : hlColor;
  strokeWidth = isDraw ? (DRAW_WIDTHS[activeWidthKey] || DRAW_WIDTHS.medium) : (HL_WIDTHS[activeWidthKey] || HL_WIDTHS.medium);

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
}
if (typeof document !== 'undefined') syncPenUI();

/* ── Page UI + progress ── */
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

/* ── Navigation + Resume ── */
function gotoPage(n) {
  const total = curBook.numPages || Infinity;
  n = Math.max(1, Math.min(total, n));
  if (n === curPage && engine === 'internal') return;
  /* A selection made on the previous page must not be turned into a highlight
     of this one: the rects are measured in that page's coordinate space. */
  clearSelectionState();
  /* A text layer that timed out on one page says nothing about the next one, and
     selection is the only way to a highlight — so every page gets a fresh try.
     The flag only stops repeat attempts on the page that already failed. */
  textLayerBroken = false;
  curPage = n;
  prunePageBuffers(n);
  /* The undo toast belongs to the page its records came from; leaving that page
     retires it rather than leaving a button that can only be refused. */
  if (erasedStrokes) hideEraseUndo();
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

/* ── Page completion ── */
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

/* ── Auto-read: a page that stays open for a minute counts as read ──
   Progress used to come only from the «خواندم» button, so a book could sit on
   page 7 of 13 and still say 0%. A page now also counts once it has been the
   open page, with the tab in front, for AUTO_READ_MS of *visible* time: the
   clock pauses while the tab is hidden and restarts from zero on every page
   change. It only ever marks — a page is never un-read by it — and a manual
   tap on the button (either way) ends the clock for that visit, so un-marking a
   page the clock was about to claim sticks. Only the internal renderer has a
   page the app knows about; the browser-viewer iframe scrolls on its own. */
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
/* (Re)starts the clock for whatever time is left on the current page. */
function runAutoRead() {
  clearTimeout(autoRead.t);
  autoRead.t = null;
  if (!curBook || engine !== 'internal' || autoRead.left <= 0) return;
  if (document.hidden || $('#readerView').hidden) return;
  if (bookDone(curBook).has(curPage)) return;
  autoRead.since = Date.now();
  autoRead.t = setTimeout(autoMarkRead, autoRead.left);
}
/* A new page (or a newly opened book) is on screen: a fresh minute begins. */
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
  /* The day's page count moves with this very action and with nothing else:
     marking a page read counts it, unmarking takes it back, never below zero.
     It is written in the same update as the page itself, so the goal bar and
     the book's progress can never disagree about what was read today. */
  curBook.stats = withTodayPages(curBook.stats, marked ? 1 : -1);
  updateBook(curBook.id, { completedPages: curBook.completedPages, stats: curBook.stats, lastReadAt: Date.now() });
  updatePageUI();
  updateGoalBar();
  if (bookComplete(curBook)) celebrateCompletion();
}

/* ── Goal bar ── */
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

/* ── Book completion reaction (Jingool, small and brief) ── */
let donePopTimer = null;
function celebrateCompletion() {
  $('#donePopChar').innerHTML = jingoolMarkup('celebrating');
  $('#donePop').hidden = false;
  clearTimeout(donePopTimer);
  donePopTimer = setTimeout(() => { $('#donePop').hidden = true; }, 3200);
}

/* ── Highlights ── */
let lastSelectionRects = null;
let pendingNoteHl = null;

/* Scroll offset of the stage expressed in its own coordinate system.
   `scrollLeft` is negative inside an RTL scroll container, which would move
   the toolbar by twice the horizontal overflow; deriving the offset from the
   page wrapper's box is direction independent. */
function stageScroll() {
  const st = $('#readerStage').getBoundingClientRect();
  const wrap = $('#pageWrap');
  const wr = wrap.getBoundingClientRect();
  return { x: st.left - wr.left + wrap.offsetLeft, y: st.top - wr.top + wrap.offsetTop };
}

function onSelectionChange() {
  if ($('#readerView').hidden || engine === 'browser' || penActive) return;
  const sel = window.getSelection();
  const bar = $('#hlBar');
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const tl = $('#textLayer');
  if (!tl.contains(range.commonAncestorContainer) || !sel.toString().trim()) { bar.hidden = true; return; }
  const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
  if (!rects.length) { bar.hidden = true; return; }
  lastSelectionRects = { text: sel.toString(), rects };
  const stage = $('#readerStage');
  const stRect = stage.getBoundingClientRect();
  const first = rects[0];
  const sc = stageScroll();
  bar.hidden = false;
  bar.style.left = Math.max(8, Math.min(stage.clientWidth - bar.offsetWidth - 8, first.left - stRect.left + sc.x)) + 'px';
  bar.style.top = Math.max(8, Math.min(stage.clientHeight - bar.offsetHeight - 8, first.top - stRect.top + sc.y - bar.offsetHeight - 8)) + 'px';
}

/* Build a highlight record from a captured selection. `scale` records the
   render scale these rects were measured at, so the mark can be re-placed when
   the page is zoomed or the window resized. */
function highlightFromSelection(color, selection) {
  const wrapRect = $('#pageWrap').getBoundingClientRect();
  const rects = selection.rects.map(r => ({
    x: r.left - wrapRect.left,
    y: r.top - wrapRect.top,
    w: r.width, h: r.height,
  }));
  return { id: nextId(), page: curPage, text: selection.text, color, rects, note: '', createdAt: Date.now(), scale: pageScale };
}

/* Drop the captured selection geometry and hide the contextual toolbar. */
function clearSelectionState() {
  lastSelectionRects = null;
  $('#hlBar').hidden = true;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
}

function paintHighlights() {
  const layer = $('#highlightLayer');
  layer.innerHTML = '';
  if (!curBook) return;
  /* Strokes live on the draw canvas: it must start clean every repaint or the
     pixels of erased strokes would linger after eraseAt/undo/zoom. */
  if (drawCtx) {
    drawCtx.clearRect(0, 0, $('#drawLayer').width, $('#drawLayer').height);
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    drawCtx.scale(dpr, dpr);
  }
  (curBook.highlights || []).filter(h => h.page === curPage).forEach(h => {
    /* Records saved before the scale was captured keep their original pixels. */
    const f = h.scale ? pageScale / h.scale : 1;
    if (h.free) {
      /* Hand-drawn stroke / freehand highlight: smooth Bézier curve rendering */
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
  });
}

/* ── Notes ── */
function saveNote() {
  const text = $('#noteInput').value.trim();
  if (text) {
    if (pendingNoteHl) {
      /* Anchor the note to the highlight of the selection it was written for.
         If that text was never highlighted yet, create the highlight now so a
         note can't be silently orphaned. */
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
      updateBook(curBook.id, { highlights: curBook.highlights });
      paintHighlights();
    } else {
      curBook.notes = curBook.notes || [];
      curBook.notes.push({ id: nextId(), page: curPage, text, createdAt: Date.now() });
      updateBook(curBook.id, { notes: curBook.notes });
    }
    updatePageUI();
  }
  pendingNoteHl = null;
  $('#noteOverlay').hidden = true;
}

function openNoteForCurrentPage() {
  $('#noteForText').textContent = pendingNoteHl
    ? `یادداشت برای هایلایت صفحهٔ ${faNum(curPage)}`
    : `یادداشت صفحهٔ ${faNum(curPage)}`;
  $('#noteInput').value = '';
  $('#noteOverlay').hidden = false;
  $('#hlBar').hidden = true;
  setTimeout(() => $('#noteInput').focus(), 200);
}

/* ── Notes Panel (new notes + highlights) ── */
function allNoteItems() {
  const hls = (curBook.highlights || []).map(h => ({
    id: h.id, page: h.page, text: h.text, note: h.note, color: h.color, source: 'highlights',
    free: !!h.free,
  }));
  const fresh = (curBook.notes || []).map(n => ({
    id: n.id, page: n.page, text: n.text, note: '', color: null, source: 'notes',
  }));
  return [...hls, ...fresh].sort((a, b) => a.page - b.page);
}

function buildNotes() {
  const list = $('#notesList'); list.innerHTML = '';
  const items = allNoteItems();
  if (!items.length) { list.innerHTML = '<p class="notes-empty">هنوز یادداشتی نداری؛ قلم رو بردار و روی صفحه بکش یا متنی رو انتخاب کن!</p>'; return; }
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'note-item';
    /* Hand-drawn marks have no quoted text — the stroke itself is the content. */
    el.innerHTML = `
      ${it.color ? `<i class="dot" style="background:${resolveColor(it.color)}"></i>` : ''}
      <div class="note-body">
        <span class="note-text">${it.free ? '<b class="free-tag">نشان قلمی</b>' : esc(it.text)}</span>
        ${it.note ? `<span class="note-note">${LIB_ICONS.note} ${esc(it.note)}</span>` : ''}
      </div>
      <span class="note-page">ص ${faNum(it.page)}</span>
      <button class="note-del" aria-label="حذف">${LIB_ICONS.close}</button>`;
    el.addEventListener('click', e => {
      if (e.target.closest('.note-del')) {
        const bookId = curBook.id;
        const field = it.source === 'highlights' ? 'highlights' : 'notes';
        const before = (curBook[field] || []).slice();
        curBook[field] = before.filter(x => x.id !== it.id);
        updateBook(bookId, { highlights: curBook.highlights, notes: curBook.notes });
        paintHighlights();
        updatePageUI();
        buildNotes();
        /* Deleting is one tap on a small ✕ inside a list, so it carries the
           same way back the rest of the app's deletions do. The undo restores
           the list as it was, and only while the same book is still open. */
        showNotice(it.free ? 'نشان قلمی حذف شد.' : 'یادداشت حذف شد.', {
          actionLabel: 'برگردون',
          onAction: () => {
            if (!curBook || curBook.id !== bookId) return;
            curBook[field] = before;
            updateBook(bookId, { highlights: curBook.highlights, notes: curBook.notes });
            paintHighlights();
            updatePageUI();
            if (!$('#notesSheet').hidden) buildNotes();
          },
        });
        return;
      }
      $('#notesSheet').hidden = true;
      gotoPage(it.page);
    });
    list.appendChild(el);
  });
}

function exportNotes() {
  const items = allNoteItems();
  let md = `# ${curBook.title}\n\n`;
  items.forEach(it => {
    md += it.free
      ? `- صفحه ${it.page}: [نشان قلمی - ${it.color}]${it.note ? ` — ${it.note}` : ''}\n`
      : `- صفحه ${it.page}: «${it.text}»${it.note ? ` — ${it.note}` : ''}\n`;
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  saveAndShareBlob(blob, curBook.title + '.md', { title: curBook.title });
}

/* ── Reading Timer ── */
function toggleTimer() {
  const btn = $('#readTimerBtn');
  if (!timer.running) {
    timer.running = true; timer.start = Date.now();
    btn.classList.add('on');
    btn.setAttribute('aria-pressed', 'true');
    btn.title = 'پایان تایمر مطالعه';
    $('#timerText').textContent = faDigits('0:00');
    timer.interval = setInterval(() => {
      const s = Math.floor((Date.now() - timer.start) / 1000);
      $('#timerText').textContent = faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
  } else stopTimerSession();
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
  /* The capsule keeps the finished count so the session reads as a closed
     loop instead of resetting to zero. */
  const s = Math.floor(ms / 1000);
  const txt = $('#timerText');
  if (txt) txt.textContent = faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  /* Nothing under half a minute is reading. Rounding 2 seconds up to a whole
     minute made every accidental tap — the double-tap that starts and stops the
     timer by mistake — add a minute to the day's total, so the totals drifted
     upwards until they described nothing. Below the floor the session records
     zero minutes — and, now, no streak day either: a mis-tap used to keep the
     streak alive without any reading having happened. */
  const m = ms >= 30000 ? Math.round(ms / 60000) : 0;
  if (m > 0 && curBook) addToday('minutes', m);
  if (ms >= 30000) recordDay();
  updateGoalBar();
}

/* ── Daily stats ── */
/* Returns the book's stats with today's page count moved by `delta`, keeping
   the other days and the day's reading minutes untouched. */
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

export { prunePageBuffers, pageBufferMap };
