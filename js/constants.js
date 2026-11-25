export const APP_TITLE = 'دفتَرچه — لیست کارهای خودمون';

export const STORAGE_KEYS = {
  tasks:   'daftarche-v1',
  name:    'daftarche-name',
  theme:   'theme',
  history: 'daftarche-history',
  moods:   'daftarche-moods',
  pomo:    'daftarche-pomo',
  session: 'daftarche-focus-session',
  focusHistory: 'daftarche-focus-history',
  frogDismissed: 'daftarche-frog-dismissed',
  penWidth: 'daftarche-pen-width',
  statsRange: 'daftarche-stats-range',
  cardStyle: 'daftarche-card-style',
  themeModes: 'daftarche-theme-modes',
  ledger: 'daftarche-ledger',
  achievements: 'daftarche-achievements',
  freeze: 'daftarche-streak-freeze',
  birthday: 'daftarche-birthday',
  birthdaySeen: 'daftarche-birthday-seen',
  birthdayThemeOff: 'daftarche-birthday-theme-off',
  birthdayCandle: 'daftarche-birthday-candle',
  birthdayWishes: 'daftarche-birthday-wishes',
  /* A fresh marker for the main 3.0.0 tour. The previous marker is deliberately
     left behind as inert device data so every reader gets this release's walk
     once, including readers who completed an earlier tour. */
  tourDone: 'daftarche-tour-complete',
  tourAwarded: 'daftarche-tour-awarded',
  themeAuto: 'daftarche-theme-auto',
  motion: 'daftarche-motion',
  textSize: 'daftarche-text-size',
  firstSeen: 'daftarche-first-seen',
  weekGoal: 'daftarche-week-goal',
  backupAt: 'daftarche-backup-at',
  backupNudge: 'daftarche-backup-nudge',
  goal: 'daftarche-goal',
  journal: 'daftarche-journal',
  study: 'daftarche-study',
  re7Tapes: 'daftarche-re7-tapes',
  re7SfxMuted: 'daftarche-re7-sfx-muted',
  re7Music: 'daftarche-re7-music',
  gtasaSfxMuted: 'daftarche-gtasa-sfx-muted',
  gtasaSaves: 'daftarche-gtasa-saves',
};

/* ═══ Themes ═══
   Nine colours the interface can be painted in: five drawn for daylight and
   four for the dark. Six of them are real palettes taken from coolors.co's
   trending list, every value in css/base.css coming from those five anchors or
   from a blend of them (see the table there). Three more are the notebook's
   own faces: «کاغذ» and «شب» are the paper and the lamp this app was drawn in,
   and «کاغذی» is the bare ink it is read in, so the light half is never without one.

   `mode` is the half of the table a theme belongs to, and it is not decoration:
   it decides three things at once. The picker shows a light/dark switch and then
   only the themes of the chosen half, so nine choices are answered in two
   taps. The one-tap switch in the header walks between the two halves, returning
   to the last theme used in the other one. And every dark-only rule in the CSS
   hangs off html[data-mode="dark"] instead of naming a theme, so adding a fifth
   dark theme costs no new rule anywhere.

   `palette` names the block of raw colours in css/base.css, the same table the
   share card's templates are cut from. The keys are written into html[data-theme]
   and into the card panel, so they must match the blocks in css/base.css in name
   and in order. */
export const THEMES = [
  { key: 'daftarche',  label: 'دفترچه',   mode: 'light', palette: 'daftarche',  family: 'tile'  },
  { key: 'kashi',      label: 'فیروزه',   mode: 'light', palette: 'kashi',      family: 'tile'  },
  { key: 'cobalt',     label: 'کبالت',    mode: 'light', palette: 'cobalt',     family: 'clean' },
  { key: 'aurora',     label: 'آرورا',    mode: 'light', palette: 'aurora',     family: 'glass' },
  { key: 'lajvard',    label: 'لاجورد',   mode: 'dark',  palette: 'lajvard',    family: 'tile'  },
  { key: 'graphite',   label: 'گرافیت',   mode: 'dark',  palette: 'graphite',   family: 'clean' },
  { key: 'nightglass', label: 'شب‌شیشه',  mode: 'dark',  palette: 'nightglass', family: 'glass' },
  /* The eleven worlds: each is earned (js/achievements.js REWARDS) and each brings
     a small feature of its own to Today (js/worlds.js). */
  { key: 'tarnama',     label: 'تارنما',    mode: 'light', palette: 'tarnama',     family: 'world' },
  { key: 'baghche',     label: 'باغچه',     mode: 'light', palette: 'baghche',     family: 'world' },
  { key: 'daryanavard', label: 'دریانورد',  mode: 'light', palette: 'daryanavard', family: 'world' },
  { key: 'negarkhane',  label: 'نگارخانه',  mode: 'light', palette: 'negarkhane',  family: 'world' },
  { key: 'qollenavard', label: 'قله‌نورد',  mode: 'light', palette: 'qollenavard', family: 'world' },
  { key: 'shabgard',    label: 'شب‌گرد',    mode: 'dark',  palette: 'shabgard',    family: 'world' },
  { key: 'fazanavard',  label: 'فضانورد',   mode: 'dark',  palette: 'fazanavard',  family: 'world' },
  { key: 'kimiyagar',   label: 'کیمیاگر',   mode: 'dark',  palette: 'kimiyagar',   family: 'world' },
  { key: 'rasadkhane',  label: 'رصدخانه',   mode: 'dark',  palette: 'rasadkhane',  family: 'world' },
  { key: 'simorgh',     label: 'سیمرغ',    mode: 'dark',  palette: 'simorgh',     family: 'world' },
  /* Cinematic & Gaming Fun Worlds (`family: 'fun'`): always unlocked, separated from badge-gated worlds */
  { key: 're7-baker',   label: 'عمارت بیکر (RE7)', mode: 'dark', palette: 'rebaker', family: 'fun' },
  { key: 'gtasa-grove', label: 'سن آندریاس — گروو استریت', mode: 'dark', palette: 'gtasa', family: 'fun', hidden: true },
  /* The birthday theme is not a theme the reader picks: it is worn for the one
     day and taken off again. It stays in this table because it is still a key —
     css/base.css has an html[data-theme="tavalod"] block for it and the birthday
     world card hangs off it — but `hidden` keeps it out of the picker, out of the
     unlocked count and out of every «choose a theme» list. js/theme.js applies it
     by itself on the day (applyBirthdayTheme), and nothing else may. */
  { key: 'tavalod',     label: 'تولد',     mode: 'light', palette: 'tavalod',     family: 'world', hidden: true },
];

/* What the standard picker walks, counts, and measures against achievements. */
export const PICKER_THEMES = THEMES.filter(t => !t.hidden && t.family !== 'fun');

/* Cinematic & Game worlds — unlocked by default in their own dedicated picker section. */
export const FUN_THEMES = THEMES.filter(t => !t.hidden && t.family === 'fun');

export const THEME_KEYS = THEMES.map(t => t.key);
export const THEME_MODES = ['light', 'dark'];
export const DEFAULT_THEME = 'daftarche';

/* ─── Navigation map ───
   Two lists, one source. The four homes the bottom bar moves between, and the
   destinations that live behind its «بیشتر» sheet (js/app.js). The bar's
   ORDER is the swipe order and the rail's order, so both are written once and
   nothing re-derives them from the markup.

   The calendar is one destination because it is one page: the week a day is
   planned in and the month it sits in are two zooms of the same calendar, and
   the switch between them sits on the page rather than in the bar. «هفته» used
   to be a destination of its own and keeps working as an alias of this one
   (js/app.js), so an old link still lands on the week. */
export const PRIMARY_PAGES = ['today', 'tasks', 'focus', 'library'];
export const MORE_PAGES = ['calendar', 'study', 'journal', 'stats', 'achv', 'profile', 'settings'];
/* The dark end of the table, and the first of the two halves the one-tap switch
   in the header walks between. */
export const NIGHT_THEME = 'lajvard';

/* A key an older build wrote down, mapped to the nearest theme that replaced it.
   «light» was the warm paper and «paper» still is it; «forest» was the green and
   «sage» is; «dark» was the lamp-lit dark and «night» still is. «شیری» was a
   brighter version of that same warm paper and «paper» is the one that stayed —
   the two were a shade apart, which is precisely why one of them had to go, so
   whoever chose it lands on the paper they were already looking at. None of
   these meanings changed under anyone's feet, which is the point of giving the
   notebook's own two themes their old names back: «شب» is the warm night it
   always was, and the navy-and-gold one that briefly held the name is «طلایی». */
const THEME_ALIASES = {
  /* the first generation */
  dark: 'lajvard', light: 'kashi', forest: 'kashi', cream: 'kashi',
  /* the nine themes this identity replaced, each to the nearest of the six:
     warm light faces to the tile family, the cool bare one to the clean family,
     the lilac to its glass cousin; the dark faces by hue. */
  paper: 'kashi', blush: 'kashi', sage: 'kashi', ink: 'cobalt', lilac: 'aurora',
  night: 'lajvard', gold: 'lajvard', ocean: 'graphite', plum: 'nightglass',
};

/* A stored or shared value, made safe: an unknown key comes back empty so the
   caller can fall back to the default instead of painting nothing. */
export const normalizeTheme = key => {
  const k = THEME_ALIASES[key] || key;
  return THEME_KEYS.includes(k) ? k : '';
};

export const themeByKey = key => THEMES.find(t => t.key === key) || null;

/* Which half a key belongs to. A key nobody recognises is answered with the
   default theme's half rather than nothing, so a caller always has a mode. */
export const modeOf = key => {
  const t = themeByKey(normalizeTheme(key));
  return t ? t.mode : themeByKey(DEFAULT_THEME).mode;
};

export const themesOfMode = mode => THEMES.filter(t => t.mode === mode);

/* Small line icons for the library and reader, in place of emoji: an emoji is drawn
   by the platform, so it changed shape from phone to phone and ignored the theme.
   These take the text colour and size (see .ico in css/library.css). */
export const LIB_ICONS = {
  books: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M16 5.5l3.8-1 3 14.6-3.8 1z" transform="translate(-1.4 .4)"/></svg>',
  page: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  note: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/></svg>',
  target: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/></svg>',
  book: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5v13C19.5 17 16 17 12 19c-4-2-7.5-2-10-.5z"/><path d="M12 6v13"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>',
  more: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  calendar: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  tag: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12.2V4a1 1 0 011-1h8.2a1 1 0 01.7.3l7.8 7.8a1 1 0 010 1.4l-7.7 7.7a1 1 0 01-1.4 0L3.3 12.9a1 1 0 01-.3-.7z"/><circle cx="8" cy="8" r="1.3"/></svg>',
  warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>',
  close: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrowFwd: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>',
  arrowBack: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
  chevDown: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  chevUp: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  smile: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
  meh: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 15.5h7"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
  frown: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 16.3c.9-1.2 2-1.8 3.5-1.8s2.6.6 3.5 1.8"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
  spark: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v3M17.5 4.5h3"/></svg>',
  lock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/></svg>',
  eye: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  chart: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  layout: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18M10 10v10"/></svg>',
  moon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>',
  search: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  image: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
  compass: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  undo: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  phone: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  folder: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  medal: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.5 2.8v5.7c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V5.8z"/></svg>',
  keyboard: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/></svg>',
  music: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export const P_CYCLE = { low: 'mid', mid: 'high', high: 'low' };
export const P_LABEL = { low: 'کم', mid: 'متوسط', high: 'زیاد' };
/* One shape per priority, so the level reads without the colour: a leaf, a bolt,
   a flame. The same three glyphs the add form's priority row has always used. */
export const PRI_ICONS = {
  low:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20v-7"/><path d="M12 13c0-3.4 2.4-5.6 6.4-5.6 0 3.4-2.4 5.6-6.4 5.6z"/><path d="M12 13c0-3.4-2.4-5.6-6.4-5.6 0 3.4 2.4 5.6 6.4 5.6z"/></svg>',
  mid:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 5 13.5h5.5L9 22l8-11.5h-5.5L13 2z"/></svg>',
  high: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 2.4-.2 3.9-1.4 5.3C9.4 9.7 8 11.2 8 13.4a4.2 4.2 0 0 0 8.4 0c0-2.2-1.4-3.7-2.6-5.1C12.6 7 11.4 5.4 12 3z"/></svg>',
};
/* Duration presets offered by the chip picker and the editor (minutes; null = none) */
export const DUR_PRESETS = [null, 5, 15, 30, 60, 90];

export const CATS = [
  { key: 'study',    label: 'درس',     color: '#4e93d8' },
  { key: 'project',  label: 'پروژه',   color: '#9a6ff0' },
  { key: 'home',     label: 'خونه',    color: '#7fb069' },
  { key: 'shopping', label: 'خرید',    color: '#eab13c' },
  { key: 'health',   label: 'سلامت',   color: '#ef6f8e' },
  { key: 'misc',     label: 'متفرقه',  color: '#a79c8a' },
];

export const MOODS = [
  { label: 'حالوم خرابه مشتی', sub: 'ناراحت نباش، یه روز خوب میاد!', color: '#e4584f' },
  { label: 'هعی',               sub: '',                                color: '#f07850' },
  { label: 'بد نیستم',          sub: '',                                color: '#eab13c' },
  { label: 'خوبم',              sub: '',                                color: '#a8c66c' },
  { label: 'میزان میزان',       sub: 'همیشه میزان باشی گل!',           color: '#7fb069' },
];

export const FACES = [
  `<circle cx="12" cy="12" r="9.5" stroke-width="2"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><path d="M7 8.5l3-1.5" stroke-width="2" stroke-linecap="round"/><path d="M17 8.5l-3-1.5" stroke-width="2" stroke-linecap="round"/><path d="M8.5 17c1-1.8 2.2-2.5 3.5-2.5s2.5.7 3.5 2.5" stroke-width="2" stroke-linecap="round"/>`,
  `<circle cx="12" cy="12" r="9.5" stroke-width="2"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><path d="M7.5 8l3 .5" stroke-width="2" stroke-linecap="round"/><path d="M16.5 8l-3 .5" stroke-width="2" stroke-linecap="round"/><path d="M9 16h6" stroke-width="2" stroke-linecap="round"/>`,
  `<circle cx="12" cy="12" r="9.5" stroke-width="2"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><path d="M9.5 15.5c.8.6 1.6.9 2.5.9s1.7-.3 2.5-.9" stroke-width="2" stroke-linecap="round"/>`,
  `<circle cx="12" cy="12" r="9.5" stroke-width="2"/><path d="M7 10.5c.5-1 1.2-1.5 2-1.5s1.5.5 2 1.5" stroke-width="2" stroke-linecap="round"/><path d="M13 10.5c.5-1 1.2-1.5 2-1.5s1.5.5 2 1.5" stroke-width="2" stroke-linecap="round"/><path d="M8.5 15c1 1.5 2.2 2.2 3.5 2.2s2.5-.7 3.5-2.2" stroke-width="2" stroke-linecap="round"/>`,
  `<circle cx="12" cy="12" r="9.5" stroke-width="2"/><path d="M8.5 9l.6 1.2 1.3.2-1 .9.3 1.3-1.2-.7-1.2.7.3-1.3-1-.9 1.3-.2z" fill="currentColor" stroke="none"/><path d="M15.5 9l.6 1.2 1.3.2-1 .9.3 1.3-1.2-.7-1.2.7.3-1.3-1-.9 1.3-.2z" fill="currentColor" stroke="none"/><path d="M8 14.5c1.1 2 2.4 3 4 3s2.9-1 4-3" stroke-width="2" stroke-linecap="round"/><circle cx="6.5" cy="14" r="1.2" fill="currentColor" opacity=".2" stroke="none"/><circle cx="17.5" cy="14" r="1.2" fill="currentColor" opacity=".2" stroke="none"/>`,
];

export const WEEKDAY_LETTERS = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

export const ICONS = {
  grip:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`,
  clock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 13V9"/><path d="M12 5V3M9 3h6"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>`,
  bell:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>`,
  cake:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8"/><path d="M4 16s2-1 4-1 4 1 4 1 2-1 4-1 4 1 4 1"/><path d="M2 21h20"/><path d="M12 7v4"/><path d="M12 3a1.5 1.5 0 011 2.5L12 7l-1-1.5A1.5 1.5 0 0112 3z" fill="currentColor"/></svg>`,
};
