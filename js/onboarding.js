/* ═══ Onboarding — the first minute ═══
   The name card used to be the whole welcome, and the tour started cold. Now the
   first visit is one short path of three small questions, each answered in a
   tap or a line, and the last one leaves a real task on the page:

     ۱ از ۳  name (the existing card, js/app.js)
     ۲ از ۳  what are you mostly here for — tasks, books or focus
     ۳ از ۳  write your first task (the same quick-add language Today speaks)

   This is Material's Self-Select model, not a benefits carousel: the one
   question that is asked genuinely changes the first run (the examples, the
   Today suggestions and the tour's own station all read the answer), so a
   separate «here is what the app does» walk would tell the reader twice and
   cost a screen. Material explicitly says not to put Self-Select and Top User
   Benefits behind each other, and this app has nothing to announce that the
   choice does not already say.

   What the three steps are built to do:
     · every step is one tap — the goal cards advance on the tap that chooses
       them, and the third step opens with a ready example already typed in the
       field, so «first task» costs a confirmation, not a sentence;
     · the exit never leaves the screen: the card's body scrolls, its footer
       (primary action + skip) does not, so a short phone or the edge-to-edge
       drawing of Android 15 can never bury the way out;
     · the pane change is Material's emphasized pair — 200ms accelerate out,
       400ms decelerate in — instead of an instant text swap.

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

/* Each card is a benefit, not a tab name: what the reader gets out of that part
   of the notebook, in the words they would use for it. */
const GOAL_CARDS = {
  tasks: { icon: LIB_ICONS.check, title: 'هیچ کاری از قلم نمی‌افته', sub: 'امروز، مهلت‌ها و پیشنهاد «از کجا شروع کنم»' },
  books: { icon: LIB_ICONS.book, title: 'کتاب و یادداشت، یک‌جا', sub: 'قفسهٔ PDF، درصد مطالعه و یادداشت‌های خودت' },
  focus: { icon: LIB_ICONS.clock, title: 'تمرکز، با آمار', sub: 'تایمر، رکوردها و این‌که وقتت کجا رفته' },
};

export { EXAMPLES, examplesFor, PANES };

let overlay, titleEl, subEl, stepsEl, goalsEl, form, input, preview, suggest, skipBtn, goBtn, finishCb = null, wired = false;
let swapTimer = null;

const reduceMotion = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Fills the pane. Nothing here animates: it is called once the outgoing pane has
   finished leaving, so the reader never sees two texts at once. */
function paintPane(which) {
  const p = PANES[which];
  stepsEl.textContent = p.steps;
  titleEl.textContent = p.title;
  subEl.textContent = p.sub;
  const isGoal = which === 'goal';
  goalsEl.hidden = !isGoal;
  form.hidden = isGoal;

  /* The footer's primary is the page's call to action, and what it means is the
     step's own answer: on the question it moves on with whatever is chosen — or
     with nothing, which is a legitimate answer — and on the task it submits the
     example already in the field. The quiet button beside it is always the way
     out, and it is never hidden. */
  if (goBtn) goBtn.textContent = isGoal ? 'بریم با همین' : 'اضافه کن و بریم';
  if (skipBtn) skipBtn.textContent = isGoal ? 'شروع بدون انتخاب' : 'رد کردن این کار';

  if (isGoal) {
    setTimeout(() => goalsEl.querySelector('button')?.focus(), 40);
    return;
  }

  paintSuggestions();
  /* The third step opens with the answer already written: the first example of
     the chosen goal is in the field and parsed, so the step costs one tap. It is
     selected, so a reader with a different task in mind just types over it. */
  const first = examplesFor(loadGoal())[0];
  input.value = first;
  input.dispatchEvent(new Event('input'));
  setTimeout(() => input.focus(), 40);
}

/* One step to the next, in Material's emphasized pair: the pane on screen leaves
   on emphasized-accelerate (200ms), the next one settles on emphasized-decelerate
   (400ms). Reduced motion skips the wait rather than the content. */
function pane(which) {
  const card = $('#onboardCard');
  if (!card || reduceMotion()) {
    paintPane(which);
    card?.classList.add('ob-swap');
    return;
  }
  clearTimeout(swapTimer);
  card.classList.remove('ob-swap');
  card.classList.add('ob-leave');
  swapTimer = setTimeout(() => {
    card.classList.remove('ob-leave');
    paintPane(which);
    void card.offsetWidth;      // a fresh class, so the arrival restarts
    card.classList.add('ob-swap');
  }, 200);
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
  clearTimeout(swapTimer);
  $('#onboardCard')?.classList.remove('ob-leave');
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
  goBtn = $('#obGo');

  goalsEl.replaceChildren(...GOALS.map(g => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ob-goal'; b.dataset.goal = g; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.innerHTML = `<span class="ob-goal-ico" aria-hidden="true">${GOAL_CARDS[g].icon}</span>`
      + `<span class="ob-goal-text"><b>${esc(GOAL_CARDS[g].title)}</b><small>${esc(GOAL_CARDS[g].sub)}</small></span>`;
    b.addEventListener('click', () => {
      goalsEl.querySelectorAll('.ob-goal').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      saveGoal(g); haptic('pick');
      /* Long enough for the chosen card to show its state before it leaves. */
      setTimeout(() => pane('task'), 140);
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

  /* The footer's primary: on the question it moves on with whatever is chosen,
     or straight into the app when nothing is — the same door the quiet button
     behind it opens, offered as the obvious one. On the task step it submits the
     example already in the field, so the first task is one tap away. */
  goBtn?.addEventListener('click', () => {
    if (form.hidden) {
      const chosen = goalsEl.querySelector('.ob-goal[aria-checked="true"]')?.dataset.goal;
      if (chosen) { haptic('pick'); pane('task'); }
      else { haptic('back'); close(true); }
      return;
    }
    form.requestSubmit();
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
