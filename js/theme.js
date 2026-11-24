/* ═══ Theme — what colour the interface is painted in ═══
   One place decides, and three things can ask for a change: the picker in
   settings, the one-tap switch in the page headers, and the last choice the
   reader made. Everything else in the app only reads the CSS, because every
   theme is a block of the same tokens in css/base.css.

   Nine themes, in two halves. A theme key is what the reader chose; its mode is
   which half of the table it belongs to, and that is written to the root as
   well (html[data-mode]) because the CSS uses it: every dark-only rule in the
   app hangs off data-mode, not off a theme's name. Two attributes, two
   questions, and neither has to repeat the other's answer.

   The choice is remembered per half as well as a whole, so the switch in the
   header returns to the dark theme the reader actually picked rather than to a
   fixed one. Anything unrecognised — a key an older build wrote down, a
   hand-edited value — counts as no choice at all, and the system preference
   answers instead, which is also what the inline script in index.html does
   before the first paint (it cannot import this file, so it repeats the keys;
   see the comment there).

   It is a module of its own rather than a corner of app.js so that the picker in
   the profile can mark itself without the page and the boot code importing each
   other. */

import { $, faNum } from './utils.js';
import { loadTheme, saveTheme, loadThemeModes, saveThemeModes, loadAchv, loadThemeAuto, saveThemeAuto, loadBirthday, loadBirthdayThemeOff, saveBirthdayThemeOff } from './store.js';
import {
  THEMES, PICKER_THEMES, THEME_MODES, DEFAULT_THEME, NIGHT_THEME,
  normalizeTheme, modeOf, themesOfMode,
} from './constants.js';
import { modeSwitch, swatchRow } from './chipgroup.js';
import { hasReward, normalizeState, rewardFor, rewardRequirements } from './achievements.js';
import { birthdayKey, birthdayStamp, normalizeBirthday, applyBirthdayDay } from './birthday.js';
import { syncSystemBars } from './native.js';

let modeControl = { mark() {} };
let swatchControl = { mark() {}, setMode() {} };

const root = () => document.documentElement;

export const systemPrefersDark = () => {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ||
      window.matchMedia('(prefers-color-scheme:dark)').matches;
  } catch {
    return false;
  }
};

/* Which half of the table is on screen. Read from the attribute the boot script
   or applyTheme wrote; anything unexpected is the light half, which is where
   the default theme lives, so a caller always gets an answer. */
export const currentMode = () => (root()?.dataset?.mode === 'dark' ? 'dark' : 'light');

export const currentTheme = () =>
  normalizeTheme(root()?.dataset?.theme) || (systemPrefersDark() ? NIGHT_THEME : DEFAULT_THEME);

export let QA_UNLOCK_ALL_THEMES = false;
export const setQaUnlockAllThemes = val => { QA_UNLOCK_ALL_THEMES = Boolean(val); };

/* A theme with a reward contract is unavailable until the achievement engine
   has stored the matching rung. Themes without a contract stay basic forever,
   which makes adding a future reward opt-in and safe. */
export const isThemeUnlocked = (key, { ignoreQaBypass = false } = {}) => {
  const normalized = normalizeTheme(key);
  if (!normalized) return false;
  if (QA_UNLOCK_ALL_THEMES && !ignoreQaBypass) return true;
  if (normalized === 'tavalod') {
    /* Not a theme to choose and not one to earn: it is worn for the birthday
       itself and taken off the next day. The day is the whole key, so it cannot
       be kept past midnight, and the reader who would rather not have it simply
       picks another theme (see the opt-out in applyTheme). */
    const b = normalizeBirthday(loadBirthday());
    return Boolean(b && birthdayKey(new Date(), b));
  }
  const reward = rewardFor('theme', normalized);
  return !reward || hasReward(normalizeState(loadAchv()), reward.id);
};

/* A locked theme falls back inside its own half of the table, the same way the
   boot script in index.html does — someone who left in the dark must not wake
   up in the light just because a backup carried a theme they have not earned. */
const allowedTheme = key => isThemeUnlocked(key) ? key : (modeOf(key) === 'dark' ? NIGHT_THEME : DEFAULT_THEME);

/* The last theme used in each half, cleaned on the way in: a key that no longer
   exists, or one whose mode has changed under it, is dropped rather than used. */
function rememberedModes() {
  const saved = loadThemeModes() || {};
  const clean = {};
  THEME_MODES.forEach(m => {
    const k = normalizeTheme(saved[m]);
    if (k && modeOf(k) === m && isThemeUnlocked(k)) clean[m] = k;
  });
  return clean;
}

function rememberMode(mode, key) {
  saveThemeModes({ ...rememberedModes(), [mode]: key });
}

/* The theme to land on when a half is asked for with no theme named: the one
   last used there, else the first of that half in the table. This is what makes
   the header switch remember instead of reset. */
export function themeForMode(mode) {
  const fallback = mode === 'dark' ? NIGHT_THEME : DEFAULT_THEME;
  const remembered = rememberedModes()[mode];
  if (remembered && isThemeUnlocked(remembered)) return remembered;
  return themesOfMode(mode).find(t => !t.hidden && isThemeUnlocked(t.key))?.key || fallback;
}

/* The browser paints its own chrome (Android status bar, Safari toolbar) from
   the theme-color meta. It has to follow the theme actually in use rather than
   the system preference alone, and it is read from the same token the CSS paints
   with, so the brand colour and the interface can never drift apart. */
export function syncThemeColor() {
  /* Exported because the day face is written on top of the theme: a birthday
     repaints --color-bg without going through applyTheme, and the browser's own
     chrome has to be re-read after it. Guarded for the Node tests, where there
     is a document but not always a meta. */
  try {
    const meta = document.querySelector?.('meta[name="theme-color"]');
    const bg = getComputedStyle(root()).getPropertyValue('--color-bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
    syncSystemBars(currentMode(), bg);
  } catch { /* no document to paint */ }
}

/* The switch in the header flips to the other half of the table; its label says
   what the tap will do, so one tap never has to be tried to be understood. */
function syncThemeButtons() {
  const next = currentMode() === 'dark' ? 'تم روشن' : 'تم تیره';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.setAttribute('aria-label', next);
    btn.setAttribute('title', next);
  });
}

export function markThemePicker() {
  const theme = currentTheme();
  const mode = currentMode();
  modeControl.mark(mode);
  swatchControl.setMode(mode);
  swatchControl.mark(theme);
  syncThemeButtons();
  const countEl = $('#settingsThemeCount');
  if (countEl) {
    const unlocked = unlockedThemesCount();
    countEl.textContent = faNum(unlocked);
    countEl.setAttribute('aria-label', `${faNum(unlocked)} تم باز شده از ${faNum(totalThemesCount())}`);
  }
}

/* One write: the two attributes are the whole state. `remember` is false only
   when the value being applied is the one already stored (or one the reader
   never chose), where re-saving it would turn a system preference into a
   decision. */
export function applyTheme(key, { remember = true, dismissBirthday = true } = {}) {
  const requested = normalizeTheme(key) || DEFAULT_THEME;
  if (remember && !isThemeUnlocked(requested)) return false;

  /* Choosing a theme on your birthday is how you decline the birthday one. The
     day's stamp is written down so that a reload — or the next tick of the day
     watcher — does not put it back on. Picking the birthday theme itself (only
     possible while the day is on) is not a decline.

     `dismissBirthday: false` is for the one caller that is not the reader: the
     automatic-theme restore in initTheme, which runs before anyone has touched
     anything and must not count as «no thanks». */
  if (remember && dismissBirthday && requested !== 'tavalod') {
    const b = normalizeBirthday(loadBirthday());
    const stamp = b && birthdayStamp(new Date(), b);
    if (stamp) saveBirthdayThemeOff(stamp);
  }

  const next = allowedTheme(requested);
  const mode = modeOf(next);
  root().dataset.theme = next;
  root().dataset.mode = mode;
  if (remember) {
    saveTheme(next);
    rememberMode(mode, next);
  }
  syncThemeColor();
  markThemePicker();
  window.dispatchEvent(new CustomEvent('theme-applied', { detail: next }));
  return true;
}

/* Move to a half of the table without naming a theme in it — the mode switch
   above the swatches. Choosing the half that is already on is not a change, so
   it leaves the current theme alone rather than jumping to the remembered one. */
export function applyMode(mode) {
  if (!THEME_MODES.includes(mode)) return;
  if (isAutoTheme()) {
    saveThemeAuto(false);
    window.dispatchEvent(new CustomEvent('theme-auto-changed', { detail: false }));
  }
  applyTheme(mode === currentMode() ? currentTheme() : themeForMode(mode));
}

/* Dark from any light theme, and the last light back from the dark half: the
   six-way choice lives in settings, where every option can be named. */
export const isAutoTheme = () => loadThemeAuto();

export function setAutoTheme(enable) {
  saveThemeAuto(enable);
  if (enable) {
    const mode = systemPrefersDark() ? 'dark' : 'light';
    applyTheme(themeForMode(mode), { remember: true });
  } else {
    const cur = currentTheme();
    saveTheme(cur);
    rememberMode(currentMode(), cur);
    markThemePicker();
  }
  window.dispatchEvent(new CustomEvent('theme-auto-changed', { detail: enable }));
}

export const toggleTheme = () => {
  if (isAutoTheme()) {
    saveThemeAuto(false);
    window.dispatchEvent(new CustomEvent('theme-auto-changed', { detail: false }));
  }
  applyTheme(currentMode() === 'dark' ? themeForMode('light') : themeForMode('dark'));
};

export const unlockedThemesCount = () => PICKER_THEMES.filter(t => isThemeUnlocked(t.key)).length;
export const totalThemesCount = () => PICKER_THEMES.length;

/* ── The birthday theme, put on and taken off by the calendar ──
   The one theme the reader does not choose. On the day it replaces whatever
   theme is on screen, without asking and without being stored as a choice; the
   day after, the reader's own theme is put back. A reader who wants their
   colours on their birthday just picks one, which records the day in
   loadBirthdayThemeOff() and is honoured here.

   The day face on the root goes on and off with it, here rather than in the
   caller: it is the same decision, and a caller that only asked this question
   must not be able to leave the day's palette painted over a theme that is no
   longer the day's.

   Returns whether the birthday theme is the one now on screen. */
export function applyBirthdayTheme(now = new Date()) {
  const b = normalizeBirthday(loadBirthday());
  const stamp = b && birthdayStamp(now, b);
  if (stamp && loadBirthdayThemeOff() !== stamp) {
    if (currentTheme() !== 'tavalod') applyTheme('tavalod', { remember: false });
    applyBirthdayDay(true);
    return true;
  }
  if (currentTheme() === 'tavalod') {
    applyTheme(normalizeTheme(loadTheme()) || DEFAULT_THEME, { remember: false });
  }
  applyBirthdayDay(false);
  return false;
}

export function initTheme() {
  modeControl = modeSwitch($('#themeModeSwitch'), { modes: THEME_MODES, onPick: applyMode });
  /* PICKER_THEMES, not THEMES: the birthday theme is a key js/birthday.js puts on
     by itself, and offering it here would be offering it on the wrong day. */
  swatchControl = swatchRow($('#themeSwatches'), PICKER_THEMES.map((theme, idx) => {
    const reward = rewardFor('theme', theme.key);
    const condition = reward ? rewardRequirements(reward.id).map(({ achievement }) =>
      `نشان «${achievement.title}»`).join(' یا ') : '';
    let groupTitle = '';
    let groupSub = '';
    if (idx === 0) {
      groupTitle = 'تم‌های پایه';
    } else if (theme.family === 'world' && PICKER_THEMES[idx - 1]?.family !== 'world') {
      groupTitle = 'دنیاهای ویژه (با نشان‌ها باز می‌شوند)';
      groupSub = 'هر دنیا یک کارت تعاملی به صفحهٔ امروز اضافه می‌کند';
    }
    return {
      ...theme, rewardId: reward?.id,
      locked: !isThemeUnlocked(theme.key),
      lockText: reward?.lockedText,
      lockCondition: condition ? `شرط باز شدن: ${condition}` : '',
      groupTitle, groupSub,
    };
  }), {
    group: 'theme',
    onPick: key => {
      if (isAutoTheme()) {
        saveThemeAuto(false);
        window.dispatchEvent(new CustomEvent('theme-auto-changed', { detail: false }));
      }
      applyTheme(key);
    },
    isLocked: key => !isThemeUnlocked(key),
  });

  // Sanitize stored theme & remembered modes if they contain locked worlds
  const modes = loadThemeModes();
  if (modes && typeof modes === 'object') {
    let modesChanged = false;
    const cleanModes = { ...modes };
    THEME_MODES.forEach(m => {
      if (cleanModes[m] && !isThemeUnlocked(cleanModes[m])) {
        cleanModes[m] = m === 'dark' ? NIGHT_THEME : DEFAULT_THEME;
        modesChanged = true;
      }
    });
    if (modesChanged) saveThemeModes(cleanModes);
  }

  const stored = loadTheme();
  if (stored && !isThemeUnlocked(stored)) {
    const fallback = modeOf(stored) === 'dark' ? NIGHT_THEME : DEFAULT_THEME;
    saveTheme(fallback);
    rememberMode(modeOf(fallback), fallback);
  }

  if (isAutoTheme()) {
    const mode = systemPrefersDark() ? 'dark' : 'light';
    applyTheme(themeForMode(mode), { remember: true, dismissBirthday: false });
  } else {
    const active = loadTheme() || currentTheme();
    applyTheme(allowedTheme(active), { remember: false });
  }

  /* The calendar gets the last word: on the birthday the theme is the birthday's
     own, and the reader's stored choice is left untouched underneath it. */
  applyBirthdayTheme();

  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onSchemeChange = e => {
        /* A system setting is not the reader declining anything, so it must not
           count as «no thanks» to the birthday theme — and while the day's
           theme is on, the day keeps the colours until it is over or the
           reader picks one themselves. */
        if (isAutoTheme() && currentTheme() !== 'tavalod') {
          const mode = e.matches ? 'dark' : 'light';
          applyTheme(themeForMode(mode), { remember: true, dismissBirthday: false });
        }
      };
      if (mq.addEventListener) {
        mq.addEventListener('change', onSchemeChange);
      } else if (mq.addListener) {
        mq.addListener(onSchemeChange);
      }
    }
  } catch { /* matchMedia listener unavailable */ }

  markThemePicker();

  document.querySelectorAll('.theme-btn').forEach(btn => { btn.onclick = toggleTheme; });
}
