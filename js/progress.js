/* ═══ Filters, Category Bar, Daily Frog, List Footer ═══ */

import { state } from './state.js';
import { $, faNum, startOfToday } from './utils.js';
import { CATS, LIB_ICONS } from './constants.js';
import { subscribe } from './bus.js';
import { renderList, collapse, clearDoneTasks } from './tasks.js';

/* ── Footer counter ──
   The progress ring and the sentence under it moved to the stats page
   (js/stats.js), where they answer for the window the reader has chosen there
   instead of for the whole list. What is left here is the list's own footer. */

function updateProgress() {
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object');
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;

  /* «امروز N کار»: what today has already given, next to what is left. Counted from
     the moment each task was ticked, so it is an honest tally and not a goal. */
  const t0 = startOfToday().getTime();
  const today = tasks.filter(t => t.done && t.doneAt && t.doneAt >= t0).length;
  const counter = $('#counter');
  if (counter) {
    counter.textContent = total
      ? `${faNum(total - done)} کار باقی‌مانده` + (today ? ` · امروز ${faNum(today)} کار انجام دادی` : '')
      : '';
  }
  const clearBtn = $('#clearBtn');
  if (clearBtn) clearBtn.style.visibility = done ? 'visible' : 'hidden';
}

/* ── Category bar ── */
function buildCatBar() {
  const wrap = $('#cats');
  const mk = (key, label, color) => {
    const b = document.createElement('button');
    b.className = 'cat-chip' + (key === 'all' ? ' active' : '');
    b.dataset.cat = key;
    b.style.setProperty('--cc', color);
    b.innerHTML = `<span class="dot"></span>${label}<span class="cnt"></span>`;
    return b;
  };
  wrap.appendChild(mk('all', 'همه', 'var(--accent)'));
  CATS.forEach(c => wrap.appendChild(mk(c.key, c.label, c.color)));
  /* «بدون مهلت» is a property, not a status or a category, so it is a toggle that
     narrows whatever is chosen — it can sit next to a category or a status. */
  const flag = document.createElement('button');
  flag.type = 'button'; flag.className = 'cat-chip is-flag'; flag.dataset.flag = 'nodue';
  flag.setAttribute('aria-pressed', 'false');
  flag.innerHTML = '<span class="flag-ico" aria-hidden="true"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3.2"/></svg></span>بدون مهلت<span class="cnt"></span>';
  wrap.appendChild(flag);
  wrap.addEventListener('click', e => {
    const b = e.target.closest('.cat-chip');
    if (!b) return;
    if (b.dataset.flag === 'nodue') {
      state.noDue = !state.noDue;
      b.classList.toggle('on', state.noDue);
      b.setAttribute('aria-pressed', String(state.noDue));
      renderList();
      return;
    }
    if (b.classList.contains('active')) return;
    wrap.querySelector('.cat-chip.active')?.classList.remove('active');
    b.classList.add('active');
    state.catFilter = b.dataset.cat;
    renderList();
  });
}

function updateCatCounts() {
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object');
  document.querySelectorAll('.cats .cat-chip').forEach(ch => {
    const cntEl = ch.querySelector('.cnt');
    if (!cntEl) return;
    const k = ch.dataset.cat;
    if (ch.dataset.flag === 'nodue') {
      const n = tasks.filter(t => !t.done && !t.dueDate).length;
      cntEl.textContent = n ? faNum(n) : '';
      return;
    }
    const n = k === 'all'
      ? tasks.filter(t => !t.done).length
      : tasks.filter(t => !t.done && (t.cat || 'misc') === k).length;
    cntEl.textContent = n ? faNum(n) : '';
  });
}

/* ── Filters ── */
function movePill() {
  const act = document.querySelector('.filters button.active'), pill = $('#pill');
  if (!act || !pill) return;
  pill.style.width = act.offsetWidth + 'px';
  pill.style.transform = `translateX(${act.offsetLeft}px)`;
}

/* Measuring the active filter forces layout; a resize fires many events per
   second, so the measurement is taken once per frame instead of once per event. */
let pillFrame = 0;
function schedulePill() {
  if (pillFrame) return;
  pillFrame = requestAnimationFrame(() => { pillFrame = 0; movePill(); });
}

/* ── Daily frog ── */
export function frogScore(t) {
  if (!t || typeof t !== 'object') return 0;
  let s = 0;
  if (t.p === 'high') s += 3; else if (t.p === 'mid') s += 1.5;
  if (t.dueDate) {
    const diff = Math.round((new Date(t.dueDate + 'T00:00:00') - startOfToday()) / 864e5);
    if (diff < 0) s += 4; else if (diff === 0) s += 2.5; else if (diff <= 1) s += 1;
  }
  return s;
}

export function findFrog() {
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object');
  const pool = tasks.filter(t => !t.done);
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => frogScore(b) - frogScore(a))[0];
}

function updateFrog() {
  const el = $('#frog');
  if (!el) return; // Frog now lives on the Today page
  const frog = findFrog();
  if (!frog) { el.hidden = true; return; }
  el.hidden = false;
  $('#frogName').textContent = frog.text;
}

/* ── Init ── */
export function initProgress() {
  buildCatBar();
  $('#frog')?.addEventListener('click', () => {
    const frog = findFrog();
    if (frog) {
      const el = $('#taskList').querySelector(`[data-id="${frog.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
    }
  });

  $('#filters').addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn || btn.classList.contains('active')) return;
    document.querySelector('.filters .active')?.classList.remove('active');
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    movePill();
    renderList();
  });
  addEventListener('resize', schedulePill);
  movePill();

  $('#clearBtn').onclick = () => {
    clearDoneTasks();
  };

  subscribe(() => { updateProgress(); updateCatCounts(); updateFrog(); });
}