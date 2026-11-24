/* ═══ Birthday Phase 4 Tests ═══
   Verifies:
   1. nextBirthdayCountdown calculations (today, upcoming, rollover, leap years)
   2. Settings countdown badge rendering & dynamic updates
   3. Birthday Greeting Dialog (#bdOverlay) with celebratory SVG cake, confetti, and theme switch action
   4. Today Header Greeting personalization on birthday with age
   5. Theme unlocking for tavalod on birthday
*/

import './_env.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ls } from './_env.mjs';

import {
  nextBirthdayCountdown,
  birthdayAge,
  birthdayCakeSvg,
  renderBirthdayRow,
  showBirthdayCard,
  normalizeBirthday,
} from '../js/birthday.js';
import { jalaliToDate, dateToJalali } from '../js/jalali.js';
import { saveBirthday, saveName, loadBirthday } from '../js/store.js';
import { isThemeUnlocked, applyTheme, currentTheme } from '../js/theme.js';
import { faDigits } from '../js/utils.js';
import { renderToday } from '../js/today.js';
import { state } from '../js/state.js';

beforeEach(() => {
  ls.clear();
  delete globalThis.document?.documentElement?.dataset?.theme;
  delete globalThis.document?.documentElement?.dataset?.day;
});

test('nextBirthdayCountdown: correctly calculates days until next birthday', () => {
  const bday = { y: 1375, m: 8, d: 15 };

  // 1. Same day: 0 days
  const dExact = jalaliToDate(1405, 8, 15);
  assert.equal(nextBirthdayCountdown(dExact, bday), 0);

  // 2. Ten days before: 10 days
  const dTenBefore = jalaliToDate(1405, 8, 5);
  assert.equal(nextBirthdayCountdown(dTenBefore, bday), 10);

  // 3. One day after: rolls over to next year (~364 or 365 days)
  const dOneAfter = jalaliToDate(1405, 8, 16);
  const cdAfter = nextBirthdayCountdown(dOneAfter, bday);
  assert.ok(cdAfter >= 364 && cdAfter <= 366, `Rollover should be ~365 days, got ${cdAfter}`);

  // 4. 30 Esfand in common year celebrates on 29 Esfand
  const bday30Esfand = { m: 12, d: 30 };
  const dEsfand29 = jalaliToDate(1404, 12, 29); // 1404 is common year (29 days)
  assert.equal(nextBirthdayCountdown(dEsfand29, bday30Esfand), 0, 'celebrates on 29 Esfand in common year');

  // 5. Invalid / null inputs
  assert.equal(nextBirthdayCountdown(new Date(), null), null);
  assert.equal(nextBirthdayCountdown(new Date('invalid'), bday), null);
});

test('birthdayCakeSvg: returns complete, accessible celebratory SVG cake', () => {
  const svg = birthdayCakeSvg();
  assert.ok(svg.includes('<svg class="wc-cake is-lit"'), 'has lit cake SVG class');
  assert.ok(svg.includes('wc-cake-plate'), 'has cake plate');
  assert.ok(svg.includes('wc-cake-tier wc-tier-1'), 'has first tier');
  assert.ok(svg.includes('wc-cake-tier wc-tier-2'), 'has second tier');
  assert.ok(svg.includes('wc-candle'), 'has candles');
  assert.ok(svg.includes('wc-flame'), 'has candle flames');
  assert.ok(svg.includes('wc-sparkles'), 'has celebration sparkles');
  assert.ok(svg.includes('aria-label="کیک جشن تولد"'), 'has accessible Persian label');
});

test('renderBirthdayRow: updates settings countdown badge dynamically with accessible attributes', () => {
  const set = new Set();
  const attrs = {};
  const badgeEl = {
    hidden: true,
    textContent: '',
    classList: {
      add: cls => set.add(cls),
      remove: cls => set.delete(cls),
      contains: cls => set.has(cls),
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: k => { delete attrs[k]; },
    getAttribute: k => attrs[k],
  };

  const dateEl = { textContent: '', classList: { toggle() {} } };
  const pickBtn = { setAttribute() {} };

  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.window = { addEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = {
      documentElement: { dataset: {} },
      querySelector: sel => {
        if (sel === '#bdCountdown') return badgeEl;
        if (sel === '#bdDate') return dateEl;
        if (sel === '#bdPick') return pickBtn;
        return null;
      },
      querySelectorAll: () => [],
    };

    // Case 1: No birthday stored
    saveBirthday(null);
    renderBirthdayRow();
    assert.equal(badgeEl.hidden, true);
    assert.equal(badgeEl.textContent, '');
    assert.equal(badgeEl.classList.contains('is-today'), false);
    assert.equal(attrs.role, undefined);
    assert.equal(attrs.tabindex, undefined);

    // Case 2: Birthday is today
    const nowJ = dateToJalali(new Date());
    saveBirthday({ y: 1375, m: nowJ.jm, d: nowJ.jd });
    renderBirthdayRow();
    assert.equal(badgeEl.hidden, false);
    assert.equal(badgeEl.textContent, 'امروز روز تولد شماست!');
    assert.equal(badgeEl.classList.contains('is-today'), true);
    assert.equal(attrs.role, 'button');
    assert.equal(attrs.tabindex, '0');
    assert.ok(attrs['aria-label'].includes('امروز روز تولد شماست!'));

    // Case 3: Birthday is in future
    const futureM = nowJ.jm === 12 ? 1 : nowJ.jm + 1;
    saveBirthday({ y: 1375, m: futureM, d: 1 });
    renderBirthdayRow();
    assert.equal(badgeEl.hidden, false);
    assert.ok(badgeEl.textContent.includes('روز تا تولد شما مانده'));
    assert.equal(badgeEl.classList.contains('is-today'), false);
    assert.equal(attrs.role, undefined);
    assert.equal(attrs.tabindex, undefined);
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  }
});

test('showBirthdayCard: mounts SVG cake, traps focus and restores focus, with one button and no question', () => {
  const overlayListeners = {};
  const overlayEl = {
    hidden: true,
    contains: (el) => el === goBtn,
    addEventListener: (ev, fn) => { overlayListeners[ev] = fn; },
    removeEventListener: (ev) => { delete overlayListeners[ev]; },
  };
  const charEl = { innerHTML: '' };
  const cakeBoxEl = { innerHTML: '', listeners: {} };
  cakeBoxEl.addEventListener = (ev, fn) => { cakeBoxEl.listeners[ev] = fn; };
  cakeBoxEl.removeEventListener = (ev) => { delete cakeBoxEl.listeners[ev]; };

  const nameEl = { textContent: '', hidden: true };
  const ageEl = { textContent: '', hidden: true };
  const goBtn = { listeners: {}, focusCalled: false };
  goBtn.addEventListener = (ev, fn) => { goBtn.listeners[ev] = fn; };
  goBtn.removeEventListener = (ev) => { delete goBtn.listeners[ev]; };
  goBtn.focus = () => { goBtn.focusCalled = true; };

  const mockTriggerBtn = {
    focusCalled: false,
    isConnected: true,
    focus: () => { mockTriggerBtn.focusCalled = true; },
  };

  const docListeners = {};
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.window = { addEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = {
      activeElement: mockTriggerBtn,
      documentElement: { dataset: {} },
      querySelector: sel => {
        if (sel === '#bdOverlay') return overlayEl;
        if (sel === '#bdChar') return charEl;
        if (sel === '#bdCakeBox') return cakeBoxEl;
        if (sel === '#bdName') return nameEl;
        if (sel === '#bdAge') return ageEl;
        if (sel === '#bdGo') return goBtn;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: (ev, fn) => { docListeners[ev] = fn; },
      removeEventListener: (ev) => { delete docListeners[ev]; },
    };

    saveName('امیر');
    const nowJ = dateToJalali(new Date());
    saveBirthday({ y: nowJ.jy - 25, m: nowJ.jm, d: nowJ.jd });

    let afterCalled = false;
    showBirthdayCard(() => { afterCalled = true; });

    assert.equal(overlayEl.hidden, false, 'overlay opens');
    assert.equal(nameEl.textContent, 'امیر', 'name is populated');
    assert.equal(nameEl.hidden, false, 'name is visible');
    assert.ok(ageEl.textContent.includes('۲۵ ساله‌ت'), 'age line is populated');
    assert.equal(ageEl.hidden, false, 'age is visible');
    assert.ok(cakeBoxEl.innerHTML.includes('wc-cake is-lit'), 'cake SVG is rendered into cake box');
    assert.ok(goBtn.focusCalled, 'initial focus is on the one button the card has');

    /* The card asks nothing: there is no «enter the world?» and therefore no
       second focusable. Every Tab parks on the same button instead of leaving
       the dialog. */
    globalThis.document.activeElement = goBtn;
    let tabPrevented = false;
    goBtn.focusCalled = false;
    docListeners.keydown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { tabPrevented = true; },
    });
    assert.equal(tabPrevented, true, 'Tab wrap prevented default');
    assert.equal(goBtn.focusCalled, true, 'Tab stays inside the card');

    globalThis.document.activeElement = goBtn;
    let shiftTabPrevented = false;
    goBtn.focusCalled = false;
    docListeners.keydown({
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { shiftTabPrevented = true; },
    });
    assert.equal(shiftTabPrevented, true, 'Shift+Tab wrap prevented default');
    assert.equal(goBtn.focusCalled, true, 'Shift+Tab stays inside the card');

    // Test Escape key closes dialog and restores focus
    assert.ok(docListeners.keydown, 'keydown listener is attached');
    mockTriggerBtn.focusCalled = false;
    docListeners.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(overlayEl.hidden, true, 'overlay closed on Escape');
    assert.equal(afterCalled, true, 'after callback fired');
    assert.equal(mockTriggerBtn.focusCalled, true, 'focus restored to trigger button on close');

    // The card no longer offers a way into the world, because the world is
    // already on: the birthday theme is applied by the day itself.
    showBirthdayCard();
    assert.equal(overlayEl.hidden, false);
    assert.ok(goBtn.listeners.click, 'the one button still closes the card');
    goBtn.listeners.click();
    assert.equal(overlayEl.hidden, true, 'button closes modal');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  }
});

test('the birthday theme puts itself on for the day, and a theme the reader picks turns it off', async () => {
  const T = await import('../js/theme.js');
  const S = await import('../js/store.js');
  const nowJ = dateToJalali(new Date());
  const otherM = nowJ.jm === 12 ? 1 : nowJ.jm + 1;
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.window = globalThis;
    globalThis.window.dispatchEvent = () => true;
    globalThis.document = {
      documentElement: { dataset: { theme: 'kashi', mode: 'light' } },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    S.saveTheme('kashi');
    S.saveBirthdayThemeOff('');

    // Any other day of the year: nothing is put on and nothing is taken off.
    S.saveBirthday({ y: nowJ.jy - 20, m: otherM, d: 1 });
    assert.equal(T.applyBirthdayTheme(), false);
    assert.equal(T.currentTheme(), 'kashi');

    // The day itself: the birthday theme is worn without being chosen or stored.
    S.saveBirthday({ y: nowJ.jy - 20, m: nowJ.jm, d: nowJ.jd });
    assert.equal(T.applyBirthdayTheme(), true);
    assert.equal(T.currentTheme(), 'tavalod');
    assert.equal(S.loadTheme(), 'kashi', 'the birthday theme is never saved as a choice');

    /* Picking another theme on the day is how the reader says no. It has to
       survive a reload — which is what the second call stands in for. */
    T.applyTheme('kashi');
    assert.equal(T.currentTheme(), 'kashi');
    assert.equal(T.applyBirthdayTheme(), false, 'the day does not put it back');
    assert.equal(T.currentTheme(), 'kashi');

    // And the morning after, the reader's own theme is what is on screen.
    S.saveBirthday({ y: nowJ.jy - 20, m: otherM, d: 1 });
    globalThis.document.documentElement.dataset.theme = 'tavalod';
    assert.equal(T.applyBirthdayTheme(), false);
    assert.equal(T.currentTheme(), 'kashi');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    S.saveBirthday(null);
    S.saveTheme('daftarche');
    S.saveBirthdayThemeOff('');
  }
});

test('isThemeUnlocked: tavalod belongs to the day, not to a stored date', () => {
  const nowJ = dateToJalali(new Date());

  // 1. Without birthday: tavalod is locked
  saveBirthday(null);
  assert.equal(isThemeUnlocked('tavalod'), false, 'tavalod is locked when no birthday is set');

  // 2. Birthday matches today: tavalod is unlocked — this is the day it is worn
  saveBirthday({ y: nowJ.jy - 20, m: nowJ.jm, d: nowJ.jd });
  assert.equal(isThemeUnlocked('tavalod'), true, 'tavalod is unlocked on user birthday');

  /* 3. Birthday does not match today: locked again. It is not a theme to keep,
     pick or earn — the next birthday unlocks it by itself. */
  const otherM = nowJ.jm === 12 ? 1 : nowJ.jm + 1;
  saveBirthday({ y: nowJ.jy - 20, m: otherM, d: 1 });
  assert.equal(isThemeUnlocked('tavalod'), false, 'tavalod is not a theme for the rest of the year');

  // Leave the store as we found it for the tests after this one.
  saveBirthday(null);
});

test('Today Header greeting: personalizes header greeting on birthday with name and age and accessible attributes', () => {
  const greetClasses = new Set();
  const occasionClasses = new Set();
  const greetAttrs = {};
  const occasionAttrs = {};

  const greetEl = {
    textContent: '',
    classList: {
      add: c => greetClasses.add(c),
      remove: c => greetClasses.delete(c),
      contains: c => greetClasses.has(c),
    },
    setAttribute: (k, v) => { greetAttrs[k] = String(v); },
    removeAttribute: k => { delete greetAttrs[k]; },
  };
  const dateEl = { textContent: '' };
  const occasionEl = {
    hidden: true,
    textContent: '',
    classList: {
      add: c => occasionClasses.add(c),
      remove: c => occasionClasses.delete(c),
      contains: c => occasionClasses.has(c),
    },
    setAttribute: (k, v) => { occasionAttrs[k] = String(v); },
    removeAttribute: k => { delete occasionAttrs[k]; },
  };
  const summaryEl = { textContent: '' };

  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.window = { addEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = {
      documentElement: { dataset: {} },
      querySelector: sel => {
        if (sel === '#todayGreet') return greetEl;
        if (sel === '#todayDate') return dateEl;
        if (sel === '#todayOccasion') return occasionEl;
        if (sel === '#todaySummary') return summaryEl;
        return null;
      },
      querySelectorAll: () => [],
    };

    saveName('سارا');
    const nowJ = dateToJalali(new Date());

    // 1. Birthday today with year set (e.g. 28 years old)
    saveBirthday({ y: nowJ.jy - 28, m: nowJ.jm, d: nowJ.jd });
    state.userName = 'سارا';
    renderToday();

    assert.ok(greetEl.textContent.includes('تولدت مبارک سارا!'));
    assert.ok(greetEl.textContent.includes('۲۸ سالگی'));
    assert.equal(greetEl.classList.contains('is-birthday'), true);
    assert.equal(greetAttrs.role, 'button');
    assert.equal(greetAttrs.tabindex, '0');
    assert.equal(occasionEl.hidden, false);
    assert.ok(occasionEl.textContent.includes('امروز: تولد شما مبارک!'));
    assert.equal(occasionEl.classList.contains('is-birthday'), true);
    assert.equal(occasionAttrs.role, 'button');
    assert.equal(occasionAttrs.tabindex, '0');

    // 2. Birthday today without birth year
    saveBirthday({ m: nowJ.jm, d: nowJ.jd });
    renderToday();
    assert.equal(greetEl.textContent, 'تولدت مبارک سارا!');
    assert.equal(greetEl.classList.contains('is-birthday'), true);

    // 3. Not birthday today
    const otherM = nowJ.jm === 12 ? 1 : nowJ.jm + 1;
    saveBirthday({ y: nowJ.jy - 28, m: otherM, d: 1 });
    renderToday();
    assert.equal(greetEl.textContent, 'سلام سارا');
    assert.equal(greetEl.classList.contains('is-birthday'), false);
    assert.equal(greetAttrs.role, undefined);
    assert.equal(greetAttrs.tabindex, undefined);
    assert.equal(occasionEl.classList.contains('is-birthday'), false);
    assert.equal(occasionAttrs.role, undefined);
    assert.equal(occasionAttrs.tabindex, undefined);
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  }
});

test('keyboard activation: Enter/Space triggers birthday card on badge, header greeting, and occasion', async () => {
  const badgeListeners = {};
  const greetListeners = {};
  const occasionListeners = {};
  const badgeClasses = new Set(['is-today']);

  const badgeEl = {
    classList: {
      contains: c => badgeClasses.has(c),
      add: c => badgeClasses.add(c),
      remove: c => badgeClasses.delete(c),
    },
    addEventListener: (ev, fn) => { badgeListeners[ev] = fn; },
  };
  const greetEl = {
    classList: { add: () => {}, remove: () => {}, contains: () => true },
    addEventListener: (ev, fn) => { greetListeners[ev] = fn; },
  };
  const occasionEl = {
    classList: { add: () => {}, remove: () => {}, contains: () => true },
    addEventListener: (ev, fn) => { occasionListeners[ev] = fn; },
  };
  const overlayEl = { hidden: true, addEventListener: () => {}, removeEventListener: () => {} };
  const goBtn = { focus() {}, addEventListener: () => {}, removeEventListener: () => {} };

  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.window = { addEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = {
      documentElement: { dataset: {} },
      querySelector: sel => {
        if (sel === '#bdCountdown') return badgeEl;
        if (sel === '#todayGreet') return greetEl;
        if (sel === '#todayOccasion') return occasionEl;
        if (sel === '#bdOverlay') return overlayEl;
        if (sel === '#bdGo') return goBtn;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const nowJ = dateToJalali(new Date());
    saveBirthday({ y: nowJ.jy - 20, m: nowJ.jm, d: nowJ.jd });

    const { initBirthday } = await import('../js/birthday.js');
    initBirthday();
    const { initToday } = await import('../js/today.js');
    initToday();

    assert.ok(badgeListeners.keydown, 'badge has keydown listener');
    assert.ok(greetListeners.keydown, 'greet has keydown listener');
    assert.ok(occasionListeners.keydown, 'occasion has keydown listener');

    // Pressing Enter on badge opens overlay
    overlayEl.hidden = true;
    let badgePrevented = false;
    badgeListeners.keydown({ key: 'Enter', preventDefault: () => { badgePrevented = true; } });
    assert.equal(badgePrevented, true);
    assert.equal(overlayEl.hidden, false, 'Enter opened birthday card from badge');

    // Pressing Space on greet opens overlay
    overlayEl.hidden = true;
    let greetPrevented = false;
    greetListeners.keydown({ key: ' ', preventDefault: () => { greetPrevented = true; } });
    assert.equal(greetPrevented, true);
    assert.equal(overlayEl.hidden, false, 'Space opened birthday card from greet');

    // Pressing Enter on occasion opens overlay
    overlayEl.hidden = true;
    let occasionPrevented = false;
    occasionListeners.keydown({ key: 'Enter', preventDefault: () => { occasionPrevented = true; } });
    assert.equal(occasionPrevented, true);
    assert.equal(overlayEl.hidden, false, 'Enter opened birthday card from occasion');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  }
});
