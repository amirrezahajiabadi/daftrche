/* ═══ Onboarding — the first minute ═══
   The name card used to be the whole welcome, and the tour started cold. Now the
   first visit is one short path of three small questions, each answered in a
   tap or a line, and the last one leaves a real task on the page:

     ۱ از ۳  name (the existing card, js/app.js)
     ۲ از ۳  what are you mostly here for — tasks, books or focus
     ۳ از ۳  write your first task (the same quick-add language Today speaks)

   Then the tour (js/tour.js) walks a page that already has the reader's own
   task on it, which is what makes its «tick it» station a real one.
   Every step can be skipped; the answers only ever steer examples and the
   tour's fourth station, never what the app lets anyone do. */
import { $, esc } from './utils.js';
import { LIB_ICONS } from './constants.js';
import { loadGoal, saveGoal, GOALS } from './store.js';
import { parseQuickAdd, renderQuickAddPreview, stripQuickAddToken } from './quickadd.js';
import { addTask } from './tasks.js';
import { dayKey } from './utils.js';
import { haptic } from './motion.js';
import { EXAMPLES, examplesFor, PANES } from './onboarding-copy.js';

const GOAL_CARDS = {
  tasks: { icon: LIB_ICONS.check, title: 'کارهای روزمره', sub: 'لیست و برنامهٔ هر روز' },
  books: { icon: LIB_ICONS.book, title: 'کتاب خوندن', sub: 'قفسهٔ PDF و یادداشت' },
  focus: { icon: LIB_ICONS.clock, title: 'تمرکز', sub: 'تایمر و آمار تمرکز' },
};

export { EXAMPLES, examplesFor, PANES };

let overlay, titleEl, subEl, stepsEl, goalsEl, form, input, preview, suggest, skipBtn, finishCb = null, wired = false;

function pane(which) {
  const p = PANES[which];
  stepsEl.textContent = p.steps;
  titleEl.textContent = p.title;
  subEl.textContent = p.sub;
  const isGoal = which === 'goal';
  goalsEl.hidden = !isGoal;
  form.hidden = isGoal;
  /* A fresh class each time restarts the arrival, so the swap reads as a step. */
  const card = $('#onboardCard');
  card.classList.remove('ob-swap'); void card.offsetWidth; card.classList.add('ob-swap');
  if (!isGoal) {
    paintSuggestions();
    setTimeout(() => input.focus(), 260);
  } else {
    setTimeout(() => goalsEl.querySelector('button')?.focus(), 260);
  }
}

function paintSuggestions() {
  suggest.replaceChildren(...examplesFor(loadGoal()).map(text => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ob-chip'; b.textContent = text;
    b.addEventListener('click', () => { input.value = text; input.dispatchEvent(new Event('input')); input.focus(); haptic('pick'); });
    return b;
  }));
}

function close(done = true) {
  overlay.hidden = true;
  const cb = finishCb; finishCb = null;
  if (done && cb) cb();
}

function wire() {
  if (wired) return;
  wired = true;
  overlay = $('#onboardOverlay');
  titleEl = $('#obTitle'); subEl = $('#obSub'); stepsEl = $('#obSteps');
  goalsEl = $('#obGoals'); form = $('#obTaskForm'); input = $('#obTaskInput');
  preview = $('#obPreview'); suggest = $('#obSuggest'); skipBtn = $('#obSkip');

  goalsEl.replaceChildren(...GOALS.map(g => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ob-goal'; b.dataset.goal = g; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.innerHTML = `<span class="ob-goal-ico" aria-hidden="true">${GOAL_CARDS[g].icon}</span>`
      + `<span class="ob-goal-text"><b>${esc(GOAL_CARDS[g].title)}</b><small>${esc(GOAL_CARDS[g].sub)}</small></span>`;
    b.addEventListener('click', () => {
      goalsEl.querySelectorAll('.ob-goal').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      saveGoal(g); haptic('pick');
      setTimeout(() => pane('task'), 220);
    });
    return b;
  }));

  input.addEventListener('input', () => {
    const parsed = parseQuickAdd(input.value);
    renderQuickAddPreview(preview, parsed, key => {
      const token = parsed.tokens?.[key];
      if (token) { input.value = stripQuickAddToken(input.value, token); input.dispatchEvent(new Event('input')); }
    });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) {
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      setTimeout(() => form.classList.remove('shake'), 380);
      return;
    }
    const parsed = parseQuickAdd(raw);
    const span = (parsed.timeFrom !== null && parsed.timeTo !== null) ? { from: parsed.timeFrom, to: parsed.timeTo } : null;
    addTask(parsed.text || raw, 'mid', parsed.cat || 'misc', parsed.dueDate || dayKey(new Date()), parsed.durationMin, span);
    haptic('done');
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'today' }));
    close(true);
  });

  skipBtn.addEventListener('click', () => close(true));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(true); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) {
      e.stopPropagation();
      close(true);
    }
  });
}

/* The entry point: runs after the name step, hands control back through `done`
   (which is where the tour is offered). Ends up closed whichever way it is left. */
export function startOnboarding(done) {
  wire();
  if (!overlay) { if (done) done(); return; }
  finishCb = done || null;
  overlay.hidden = false;
  pane('goal');
}
