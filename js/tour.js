/* ═══ Tour — the guided walk through the notebook ═══
   A first-time reader is walked from «الف» to the last station: the card is a
   small page of this notebook (css/base.css, .sheet-paper — the same recipe the
   calendars and the update note read) with an arrow connecting it to the thing
   it is talking about, and a spotlight hole cut around that thing so the rest
   of the page steps back. The tour navigates the pages itself, one station at
   a time, through the very same `navigate` event a tab tap uses.

   Three doors in:
     · the first visit, after the name card (js/app.js chains it);
     · «راهنمای دفترچه» in Settings, for whoever wants the walk again;
     · nowhere else, and never twice uninvited — finishing or skipping writes
       the current tour marker, and leaving mid-walk (Escape) writes nothing.

   The engine borrows the shared modal contract the way every other dialog
   does: the root is an `.overlay` flipped with `hidden`, so js/modal.js keeps
   focus inside and freezes the page behind. Between stations the overlay is
   closed again for a moment — the scroll lock has to be off for the page to
   carry the target into view — then reopened on the new station. */

import { faNum } from './utils.js';
import { loadTourDone, saveTourDone, saveTourAwarded, loadName, loadGoal } from './store.js';
import { notify } from './bus.js';
import { qorqoriMarkup } from './qorqori.js';
import { haptic } from './motion.js';
import { LIB_ICONS } from './constants.js';

/* ═══ The stations ═══
   `sel` is what the spotlight cuts its hole around; `wrap` lifts the hole to
   the section that owns the target when the element alone is too small to read
   as «this part here». The welcome station has no target: its card stands
   alone and asks the question the whole walk hangs on. Exported for the tests
   (tests/tour.test.mjs) — the walk is data before it is behaviour. */
export const STEPS = [
  {
    page: 'today', sel: null, mood: 'happy',
    title: 'خوش اومدی به دفتَرچه!',
    text: 'این‌جا کارهات، تمرکزت و کتاب‌هات کنار هم هستن. فقط پنج ایستگاه، کمتر از یه دقیقه.',
  },
  {
    page: 'today', sel: '#todayList', mood: 'determined', action: 'tick',
    title: 'کار اولت این‌جاست',
    text: 'هر چی بنویسی همین‌جا می‌شینه. تیکش رو بزن تا حس تموم‌شدنش رو ببینی.',
  },
  {
    page: 'today', sel: '#todayFrog', mood: 'thinking',
    title: 'همدم برات انتخاب می‌کنه',
    text: 'نمی‌دونی از کجا شروع کنی؟ همدمت با نگاه به مهلت و حال امروزت، یه کار پیشنهاد می‌ده.',
  },
  {
    page: 'today', sel: '.nav-tab[data-page="focus"]', mood: 'default',
    title: 'تمرکز، یه تایمر ساده',
    text: 'یه کار انتخاب کن، تایمر رو بزن و فقط همون رو انجام بده. آمارش خودکار ثبت می‌شه.',
  },
  {
    page: 'settings', sel: '#profTour', mood: 'celebrating',
    title: 'همه‌چیز مال خودته',
    text: 'تم، حرکت‌ها، پشتیبان‌گیری و همین راهنما توی تنظیمات هستن. هر وقت خواستی برگرد.',
  },
];

/* The fourth station follows what the reader said they came for: someone here
   for books is shown the shelf, not the timer. Everyone else sees the default. */
const GOAL_STATION = {
  books: {
    sel: '.nav-tab[data-page="library"]', mood: 'happy',
    title: 'کتاب‌هات یه قفسه دارن',
    text: 'PDF‌هات رو اضافه کن؛ دفترچه صفحه‌ای که بودی رو یادش می‌مونه و هدف مطالعه هم می‌ذاره.',
  },
};
export function stepsFor(goal = '') {
  const swap = GOAL_STATION[goal];
  return STEPS.map((s, i) => (i === 3 && swap ? { ...s, ...swap } : s));
}

/* The station letters, the way the notebook would number them. */
export const LETTERS = ['الف', 'ب', 'پ', 'ت', 'ث'];

/* ═══ The geometry — pure, no DOM ═══
   Given the target's rect, the viewport, the measured card and the band the
   glass dock keeps at the bottom, decide which side of the target the card
   sits on, where the card and the arrow go, and where the spotlight's hole is
   cut. Physical coordinates throughout, because everything downstream
   (getBoundingClientRect, fixed positioning) is physical; the stylesheet never
   writes a physical side itself. */
export function computePlacement(rect, vw, vh, boxW, boxH, opts = {}) {
  const gap = opts.gap ?? 14;
  const margin = opts.margin ?? 12;
  const pad = 10;                                // the hole's air around the target
  const topLimit = (opts.topInset ?? 0) + margin;
  const bottomLimit = vh - (opts.bottomInset ?? 0) - margin;

  /* The hole: the target inflated by `pad`, clamped into the viewport so a
     target that reaches past an edge never drags the hole off-screen. */
  const spot = {
    left: Math.max(margin, rect.left - pad),
    top: Math.max(margin, rect.top - pad),
  };
  spot.width = Math.max(24, Math.min(rect.right + pad, vw - margin) - spot.left);
  spot.height = Math.max(24, Math.min(rect.bottom + pad, bottomLimit) - spot.top);

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const clampX = x => Math.min(Math.max(x, margin), Math.max(margin, vw - margin - boxW));
  const clampY = y => Math.min(Math.max(y, margin), Math.max(margin, bottomLimit - boxH));

  const spaceBelow = bottomLimit - (rect.bottom + pad);
  const spaceAbove = rect.top - pad - margin;

  /* Phones have two separate reading areas: the card and the page preview.
     Use a clear gap beside the target's top/bottom edge when it fits. For a
     tall target, dock the card at the clearer viewport edge and return the
     scroll needed to bring the target into the remaining area. The spotlight
     is clipped to that area, so it can never pass beneath the card. */
  if (opts.mobile) {
    const overlap = top => Math.max(0, Math.min(top + boxH, rect.bottom + pad)
      - Math.max(top, rect.top - pad));
    const above = rect.top - pad - topLimit;
    let chosen;
    if (spaceBelow >= boxH + gap && rect.top >= topLimit + pad) {
      chosen = { side: 'bottom', top: rect.bottom + pad + gap };
    } else if (above >= boxH + gap && rect.bottom <= bottomLimit - pad) {
      chosen = { side: 'top', top: rect.top - pad - gap - boxH };
    } else {
      chosen = [
        { side: 'top', top: topLimit, gap: above },
        { side: 'bottom', top: Math.max(topLimit, bottomLimit - boxH), gap: spaceBelow },
      ].map(c => ({ ...c, overlap: overlap(c.top) }))
        .sort((a, b) => a.overlap - b.overlap || b.gap - a.gap)[0];
    }
    const box = { left: clampX(cx - boxW / 2), top: chosen.top };
    const preview = {
      top: chosen.side === 'top' ? box.top + boxH + gap : topLimit,
      bottom: chosen.side === 'bottom' ? box.top - gap : bottomLimit,
    };
    const available = preview.bottom - preview.top - 2 * pad;
    let scrollBy = 0;
    if (rect.height > available || rect.top < preview.top + pad) {
      scrollBy = rect.top - preview.top - pad;
    } else if (rect.bottom > preview.bottom - pad) {
      scrollBy = rect.bottom - preview.bottom + pad;
    }
    spot.top = Math.min(Math.max(rect.top - pad, preview.top), preview.bottom);
    spot.height = Math.max(0, Math.min(rect.bottom + pad, preview.bottom) - spot.top);
    const arrow = {
      left: Math.min(Math.max(cx - 7, box.left + 16), box.left + boxW - 30),
      top: chosen.side === 'top' ? box.top + boxH - 7 : box.top - 7,
    };
    return { side: chosen.side, box, arrow, spot, preview, scrollBy };
  }

  let side, box, arrow;
  if (spaceBelow >= boxH + gap) {
    side = 'bottom';
    box = { left: clampX(cx - boxW / 2), top: rect.bottom + pad + gap };
    arrow = {
      left: Math.min(Math.max(cx - 7, box.left + 16), box.left + boxW - 30),
      top: box.top - 7,
    };
  } else if (spaceAbove >= boxH + gap) {
    side = 'top';
    box = { left: clampX(cx - boxW / 2), top: Math.max(margin, rect.top - pad - gap - boxH) };
    arrow = {
      left: Math.min(Math.max(cx - 7, box.left + 16), box.left + boxW - 30),
      top: box.top + boxH - 7,
    };
  } else {
    /* No room above or below (a tall target on a short screen): hang the card
       beside the target, on whichever side has more of it. */
    side = vw - rect.right >= rect.left ? 'right' : 'left';
    box = {
      left: clampX(side === 'right' ? rect.right + pad + gap : rect.left - pad - gap - boxW),
      top: clampY(cy - boxH / 2),
    };
    arrow = {
      left: side === 'right' ? box.left - 7 : box.left + boxW - 7,
      top: Math.min(Math.max(cy - 7, box.top + 16), box.top + boxH - 30),
    };
  }
  return { side, box, arrow, spot };
}

/* ═══ The engine ═══ */
let root = null, spotEl = null, arrowEl = null, card = null;
let kickerEl = null, titleEl = null, textEl = null;
let dotsEl = null, countEl = null, prevBtn = null, nextBtn = null, skipBtn = null;
let cardObserver = null;
let idx = 0;
let steps = STEPS;
let mascotEl = null, actionBtn = null, ticked = false, advanceTimer = 0;
let active = false;
let offerTimer = 0;

/* Width identifies portrait phones; coarse input plus a short viewport also
   catches a phone rotated to landscape, without changing short desktop windows. */
const MOBILE_QUERY = '(max-width: 600px), (pointer: coarse) and (max-width: 950px) and (max-height: 600px)';
const mobileViewport = () => window.matchMedia(MOBILE_QUERY).matches;

function prepareMobile() {
  const mobile = mobileViewport();
  document.body.classList.toggle('tour-mobile-stage', mobile);
  if (mobile) {
    const height = window.visualViewport?.height || window.innerHeight;
    root.style.setProperty('--tour-viewport-height', height + 'px');
    /* Temporary scroll space lets even the first/last page section move away
       from the card. It disappears when the tour closes or switches to desktop. */
    document.body.style.setProperty('--tour-page-space', Math.min(360, Math.max(280, height * .4)) + 'px');
  } else {
    root.style.removeProperty('--tour-viewport-height');
    document.body.style.removeProperty('--tour-page-space');
  }
  return mobile;
}

const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const currentPage = () =>
  document.querySelector('.page.active')?.id.replace(/^page-/, '') || 'today';

const resolveTarget = step => {
  let el = null;
  if (window.innerWidth >= 1024 && step.sel) {
    if (step.sel.includes('.nav-tab') || step.sel.includes('[data-page')) {
      el = document.querySelector(`.side-rail ${step.sel}`);
    }
  }
  if (!el && step.sel) {
    const list = document.querySelectorAll(step.sel);
    for (const item of list) {
      if (item.offsetParent !== null || getComputedStyle(item).display !== 'none') {
        el = item;
        break;
      }
    }
    if (!el && list.length > 0) el = list[0];
  }
  if (!el) return null;
  return step.wrap ? el.closest(step.wrap) || el : el;
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/* Built once, on the first open — like the release-notes dialog, everything is
   plain elements and textContent; the copy is static and nothing from the page
   is ever interpolated. */
function ensureRoot() {
  if (root) return;

  root = el('div', 'overlay tour-overlay');
  root.id = 'tourOverlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'راهنمای دفترچه');
  root.hidden = true;

  spotEl = el('div', 'tour-spot');
  spotEl.setAttribute('aria-hidden', 'true');

  arrowEl = el('div', 'tour-arrow');
  arrowEl.setAttribute('aria-hidden', 'true');

  card = el('aside', 'tour-card sheet-paper');
  kickerEl = el('span', 'tour-kicker');
  titleEl = el('h2', 'tour-title');
  textEl = el('p', 'tour-text');
  textEl.setAttribute('aria-live', 'polite');
  /* The companion stands beside the words, the way a guide would. */
  mascotEl = el('span', 'tour-mascot');
  mascotEl.setAttribute('aria-hidden', 'true');
  /* A station can ask the reader to do the thing it is talking about. */
  actionBtn = el('button', 'tour-try');
  actionBtn.type = 'button';
  actionBtn.hidden = true;
  const words = el('div', 'tour-words');
  words.append(titleEl, textEl, actionBtn);
  const copy = el('div', 'tour-copy');
  copy.append(mascotEl, words);

  const dotsRow = el('div', 'tour-dots-row');
  dotsEl = el('div', 'tour-dots');
  dotsEl.setAttribute('aria-hidden', 'true');
  countEl = el('span', 'tour-count');
  dotsRow.append(dotsEl, countEl);

  const actions = el('div', 'tour-actions');
  prevBtn = el('button', 'tour-btn is-prev', 'قبلی');
  prevBtn.type = 'button';
  nextBtn = el('button', 'tour-btn is-next', 'بریم!');
  nextBtn.type = 'button';
  actions.append(prevBtn, nextBtn);

  skipBtn = el('button', 'tour-skip');
  skipBtn.append(
    el('span', 'tour-skip-label', 'دفترچه رو میشناسم بذار بریم سراغ کار زندگیمون'),
    el('span', 'tour-skip-mobile', 'فعلاً رد کن'),
  );
  skipBtn.type = 'button';

  card.append(kickerEl, copy, dotsRow, actions, skipBtn);
  root.append(spotEl, arrowEl, card);
  document.body.append(root);
  const before = el('div', 'tour-page-space');
  const after = el('div', 'tour-page-space');
  before.setAttribute('aria-hidden', 'true');
  after.setAttribute('aria-hidden', 'true');
  document.body.prepend(before);
  document.body.append(after);

  if (typeof ResizeObserver !== 'undefined') {
    cardObserver = new ResizeObserver(() => {
      if (active && mobileViewport()) scheduleReposition();
    });
  }

  prevBtn.addEventListener('click', () => { haptic('step'); show(idx - 1); });
  nextBtn.addEventListener('click', () => { haptic('step'); idx === steps.length - 1 ? finish(true, true) : show(idx + 1); });
  skipBtn.addEventListener('click', () => finish(true, false));
  actionBtn.addEventListener('click', doAction);

  /* A swipe on the card turns the page: toward the left is forward, because the
     notebook reads right to left. Touch only — a mouse has the buttons. */
  let sx = 0, sy = 0, tracking = false;
  card.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY; tracking = true;
  });
  card.addEventListener('pointerup', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * .6) return;
    if (dx < 0 && idx < steps.length - 1) { haptic('step'); show(idx + 1); }
    else if (dx > 0 && idx > 0) { haptic('step'); show(idx - 1); }
  });
  card.addEventListener('pointercancel', () => { tracking = false; });
}

/* «Try it»: the tick station really ticks the reader's first task — through the
   row's own check button, so the page reacts exactly as it would to a tap. */
function doAction() {
  if (ticked) return;
  const row = document.querySelector('#todayList .t-row:not(.done) .t-check');
  if (!row) return;
  ticked = true;
  row.click();
  haptic('done');
  paintAction();
  mascotEl.innerHTML = qorqoriMarkup('celebrating');
  mascotEl.classList.remove('hop'); void mascotEl.offsetWidth; mascotEl.classList.add('hop');
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => { if (active && idx === 1 && steps[idx].action === 'tick') show(idx + 1); }, 1100);
}

function paintAction() {
  const s = steps[idx];
  const has = s.action === 'tick' && (ticked || document.querySelector('#todayList .t-row:not(.done) .t-check'));
  actionBtn.hidden = !has;
  if (!has) return;
  actionBtn.disabled = ticked;
  actionBtn.innerHTML = ticked ? `${LIB_ICONS.check} انجام شد` : 'تیکش رو بزن';
  actionBtn.classList.toggle('is-done', ticked);
}

function render() {
  const s = steps[idx];
  card.querySelector('.tour-copy').scrollTop = 0;
  kickerEl.textContent = `ایستگاه ${LETTERS[idx]}`;
  const who = loadName();
  titleEl.textContent = idx === 0 && who ? `${who}، خوش اومدی!` : s.title;
  textEl.textContent = s.text;
  mascotEl.innerHTML = qorqoriMarkup(s.mood || 'default');
  paintAction();

  countEl.textContent = `${faNum(idx + 1)} از ${faNum(steps.length)}`;
  dotsEl.replaceChildren(...steps.map((_, i) => {
    const d = el('i', 'tour-dot' + (i === idx ? ' on' : ''));
    d.textContent = '';
    return d;
  }));

  prevBtn.hidden = idx === 0;
  nextBtn.textContent = idx === 0 ? 'بریم!' : idx === steps.length - 1 ? 'شروع کنیم' : 'بعدی';
}

function position() {
  if (!active || !root || root.hidden) return;
  const mobile = prepareMobile();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bw = card.offsetWidth;
  const bh = card.offsetHeight;
  const step = steps[idx];

  let placement = null;
  const target = step.sel && resolveTarget(step);
  const nav = document.getElementById('bottomNav');
  let bottomInset = nav && !nav.hidden ? nav.offsetHeight + 26 : 0;
  let topInset = 0;
  if (mobile) {
    const visual = window.visualViewport;
    const style = getComputedStyle(root);
    topInset = (visual?.offsetTop || 0) + (parseFloat(style.getPropertyValue('--tour-safe-top')) || 0);
    let bottom = (visual?.offsetTop || 0) + (visual?.height || vh)
      - (parseFloat(style.getPropertyValue('--tour-safe-bottom')) || 0);
    /* The navigation is itself one station: don't clip its spotlight out
       of the viewport by reserving the navigation's band for that station. */
    if (nav && target !== nav && nav.getClientRects().length) {
      bottom = Math.min(bottom, nav.getBoundingClientRect().top - 12);
    }
    bottomInset = vh - bottom;
  }
  if (target) {
    const options = { bottomInset, topInset, mobile };
    placement = computePlacement(target.getBoundingClientRect(), vw, vh, bw, bh, options);
    if (mobile && getComputedStyle(target).position !== 'fixed') {
      for (let attempt = 0; attempt < 3 && Math.abs(placement.scrollBy) > 1; attempt++) {
        const previousTop = target.getBoundingClientRect().top;
        window.scrollBy({ top: placement.scrollBy, behavior: 'instant' });
        const rect = target.getBoundingClientRect();
        placement = computePlacement(rect, vw, vh, bw, bh, options);
        if (Math.abs(rect.top - previousTop) < 1) break;
      }
    }
  }
  /* No target (the welcome question) or a target that went missing: the card
     stands alone, a little above the middle, with no hole and no arrow. */
  if (!placement) {
    placement = {
      side: 'center',
      box: {
        left: (vw - bw) / 2,
        top: mobile ? Math.max(topInset + 12, topInset + (vh - bottomInset - topInset - bh) / 2)
          : (vh - bh) / 2 - vh * 0.06,
      },
      arrow: null, spot: null,
    };
  }

  const rail = document.querySelector('.side-rail');
  const railVisible = !mobile && vw >= 1024 && rail && getComputedStyle(rail).display !== 'none';
  if (railVisible && placement?.box) {
    const railRect = rail.getBoundingClientRect();
    const rightLimit = railRect.left - 12;
    if (target && target.getBoundingClientRect().right <= railRect.left) {
      if (placement.box.left + bw > rightLimit) {
        placement.box.left = Math.max(12, rightLimit - bw);
        if (placement.arrow) {
          const tRect = target.getBoundingClientRect();
          placement.arrow.left = Math.min(Math.max(tRect.left + tRect.width / 2 - 7, placement.box.left + 16), placement.box.left + bw - 30);
        }
      }
    } else if (!target) {
      placement.box.left = Math.max(12, (railRect.left - bw) / 2);
    }
  }

  /* The geometry above is physical, because getBoundingClientRect is; the
     stylesheet only ever speaks logical sides, so the write converts: in this
     RTL document inset-inline-start is the distance from the right edge. The
     card keeps its CSS-driven width (never an inline one) so a resize can
     re-measure it; the hole and the arrow carry their own sizes. */
  const put = (node, left, top, w, h) => {
    node.style.insetInlineStart = Math.round(vw - left - w) + 'px';
    node.style.insetBlockStart = Math.round(top) + 'px';
    if (w != null && node !== card) node.style.width = w + 'px';
    if (h != null && node !== card) node.style.height = h + 'px';
  };

  put(card, placement.box.left, placement.box.top, card.offsetWidth, null);

  if (placement.spot && placement.spot.height > 0) {
    spotEl.style.display = 'block';
    put(spotEl, placement.spot.left, placement.spot.top, placement.spot.width, placement.spot.height);
  } else {
    spotEl.style.display = 'none';
  }

  if (placement.arrow) {
    arrowEl.style.display = 'block';
    put(arrowEl, placement.arrow.left, placement.arrow.top, arrowEl.offsetWidth, null);
  } else {
    arrowEl.style.display = 'none';
  }
}

/* One station. The overlay always closes first — the scroll lock has to be off
   for the page to scroll the target into view — and reopens once the page has
   settled under the new station. */
async function show(i) {
  idx = Math.max(0, Math.min(steps.length - 1, i));
  const step = steps[idx];

  if (root) root.hidden = true;
  ensureRoot();
  prepareMobile();
  if (currentPage() !== step.page) {
    window.dispatchEvent(new CustomEvent('navigate', { detail: step.page }));
  }
  if (step.page === 'settings' && step.sel) {
    const el = document.querySelector(step.sel);
    const panel = el?.closest?.('.settings-panel');
    if (panel?.dataset?.settingsPanel) {
      window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: panel.dataset.settingsPanel }));
    }
  }
  const target = step.sel && resolveTarget(step);
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  await raf2();
  if (!active) return;

  render();
  root.hidden = false;
  position();
  /* Each station arrives: the card rises into place and the dim eases in.
     Removing and re-adding the class restarts the animation for every step. */
  root.classList.remove('tour-in'); void root.offsetWidth; root.classList.add('tour-in');
}

function finish(markDone, award = false) {
  active = false;
  clearTimeout(advanceTimer);
  if (root) root.hidden = true;
  if (repositionFrame) {
    cancelAnimationFrame(repositionFrame);
    clearTimeout(repositionFrame);
    repositionFrame = 0;
  }
  window.removeEventListener('resize', scheduleReposition);
  document.removeEventListener('scroll', scheduleReposition, { capture: true, passive: true });
  document.removeEventListener('keydown', onKey);
  window.visualViewport?.removeEventListener('resize', scheduleReposition);
  window.visualViewport?.removeEventListener('scroll', scheduleReposition);
  document.body.classList.remove('tour-mobile-stage');
  document.body.style.removeProperty('--tour-page-space');
  cardObserver?.disconnect();
  if (markDone) {
    saveTourDone();
    if (award) {
      saveTourAwarded();
      notify();
    }
  }
}

function onKey(e) {
  if (e.key === 'Escape') finish(false);
  else if (e.key === 'ArrowLeft' && idx < steps.length - 1) show(idx + 1);   // RTL: forward is leftward
  else if (e.key === 'ArrowRight' && idx > 0) show(idx - 1);
}

/* While the walk is open, a rotated phone or a scrolled page must not leave the
   hole and the card pointing at where the target used to be. Repositioning is
   coalesced into one frame — a resize fires dozens of times a second. In a
   hidden tab requestAnimationFrame never runs, so there the coalescing falls
   back to a timer: the walk still lands where it belongs when the tab wakes. */
let repositionFrame = 0;
function scheduleReposition() {
  if (!active || repositionFrame) return;
  const run = () => { repositionFrame = 0; position(); };
  repositionFrame = document.hidden ? setTimeout(run, 32) : requestAnimationFrame(run);
}

/* ═══ The two doors ═══

   The first visit: ask only if the walk was never finished or declined.
   Settings: always from station one, whoever asks. */
export function offerTour() {
  if (loadTourDone() || active || offerTimer) return;
  const tryStart = () => {
    offerTimer = 0;
    /* Release notes may be queued at the same boot. Wait until that shared
       dialog is closed so the two welcome moments never cover each other. */
    const notes = document.getElementById('changelogOverlay');
    if (notes && !notes.hidden) {
      offerTimer = setTimeout(tryStart, 300);
      return;
    }
    if (!loadTourDone()) startTour();
  };
  offerTimer = setTimeout(tryStart, 800);
}

export function startTour() {
  if (active) return;
  active = true;
  steps = stepsFor(loadGoal());
  ticked = false;
  ensureRoot();
  cardObserver?.observe(card);
  document.fonts?.ready.then(() => { if (active && mobileViewport()) scheduleReposition(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', scheduleReposition, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleReposition, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleReposition, { passive: true });
  /* Capture: the page itself scrolls on window — a bubble listener on document
     never hears it. */
  document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
  show(0);
}
