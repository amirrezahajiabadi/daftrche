/* ═══ Worlds — the small feature each earned theme brings ═══
   A world is not only a colour: while it is the active theme, one card on Today
   does something useful in its own language. It is the same data the rest of the
   app already keeps (ticks, focus minutes, the week), shown differently, plus
   two small actions. Switch to any other theme and the card is gone; nothing is
   stored that a theme change would orphan except the week's goal.

     شب‌گرد      گشت شبانه   — the day's unfinished tasks, sent to tomorrow in one tap
     تارنما      تار هفته    — the last seven days as a web
     فضانورد     دفتر پرواز  — focus hours as flight hours, today's orbit
     باغچه       گلدان       — a plant that grows with today's ticks
     دریانورد    کشتیِ هفته  — a weekly goal, and a ship sailing toward its port */
import { state } from './state.js';
import { subscribe } from './bus.js';
import { $, faNum, dayKey, esc, shiftKey } from './utils.js';
import { collectTotals } from './ledger.js';
import { moveTaskToDay } from './tasks.js';
import { todayPending as pending, todayDone as doneToday } from './today.js';
import { STORAGE_KEYS } from './constants.js';
import {
  readString, safeSet,
  loadBirthday, loadBirthdayCandle, saveBirthdayCandle,
  loadBirthdayWishes, saveBirthdayWishes,
} from './store.js';
import { haptic } from './motion.js';
import { openBirthdayShare } from './sharecard.js';
import { confetti, beep } from './confetti.js';
import {
  lastDays, radarPoints, ringPoints, weekdayLetter, plantStage,
  weekDone, shipProgress, clampGoal, stepGoal, orbitProgress, flightHours,
  miniatureStage, summitAltitude, elixirElements, constellationDays, simorghActiveDays,
  birthdayWorldState,
} from './worlds-data.js';
import { re7WorldPlugin } from './world-re7.js';
import { gtasaWorldPlugin } from './world-gtasa.js';

const theme = () => document.documentElement.dataset.theme || '';
export const WORLDS = new Set([
  'shabgard', 'tarnama', 'fazanavard', 'baghche', 'daryanavard',
  'negarkhane', 'qollenavard', 'kimiyagar', 'rasadkhane', 'simorgh',
  'tavalod',
]);

/* ── Fun / Cinematic Worlds Plugin Registry & Lifecycle Hooks ──
   Allows each custom cinematic/game world to isolate its interactive overlays,
   listeners, and ambient effects cleanly inside its own module. */
const WORLD_PLUGINS = new Map();
let activePluginWorldId = null;

export function registerWorldPlugin(worldId, plugin) {
  if (!worldId || !plugin || typeof plugin !== 'object') return;
  WORLD_PLUGINS.set(worldId, plugin);
}

export function getRegisteredWorldPlugins() {
  return [...WORLD_PLUGINS.keys()];
}

export function onWorldActivate(worldId) {
  const plugin = WORLD_PLUGINS.get(worldId);
  if (plugin && typeof plugin.onActivate === 'function') {
    plugin.onActivate(worldId);
  }
  activePluginWorldId = WORLD_PLUGINS.has(worldId) ? worldId : null;
}

export function onWorldDeactivate(worldId) {
  const plugin = WORLD_PLUGINS.get(worldId);
  if (plugin && typeof plugin.onDeactivate === 'function') {
    plugin.onDeactivate(worldId);
  }
  if (activePluginWorldId === worldId) activePluginWorldId = null;
}

function syncWorldLifecycle(nextWorldId) {
  if (activePluginWorldId && activePluginWorldId !== nextWorldId) {
    onWorldDeactivate(activePluginWorldId);
  }
  if (nextWorldId && WORLD_PLUGINS.has(nextWorldId) && activePluginWorldId !== nextWorldId) {
    onWorldActivate(nextWorldId);
  }
}

registerWorldPlugin(re7WorldPlugin.id, re7WorldPlugin);
registerWorldPlugin(gtasaWorldPlugin.id, gtasaWorldPlugin);

const svg = (inner, vb = '0 0 24 24', cls = 'ico') =>
  `<svg class="${cls}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>'),
  web: svg('<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/><path d="M12 7l4 2.5 1 4.5-3.5 3.5h-3L7 14l1-4.5z"/>'),
  rocket: svg('<path d="M12 3c3 2 4.5 5 4.5 9l-2 3h-5l-2-3c0-4 1.5-7 4.5-9z"/><circle cx="12" cy="10" r="1.5"/><path d="M9.5 15l-2.5 3M14.5 15l2.5 3M12 17v3"/>'),
  ship: svg('<path d="M4 15h16l-2.5 4h-11z"/><path d="M12 4v11M12 5l5 8h-5M12 7l-4 6h4"/>'),
  brush: svg('<path d="M18 2l4 4-10 10H8v-4L18 2zM3 21h5l1-2H5a1 1 0 0 1-1-1v-4L3 15v6z"/>'),
  mountain: svg('<path d="M2 20L8.5 7l4.5 9 3-5 4 9H2z"/><path d="M7 10l2.5 3.5 2-1.5"/>'),
  flask: svg('<path d="M9 3h6M10 3v5l-6 10a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3L14 8V3"/>'),
  telescope: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  feather: svg('<path d="M20.2 3.8a6.5 6.5 0 0 0-9.2 0L3 11.8V17h5.2l8-8a6.5 6.5 0 0 0 4-5.2z"/><path d="M16 8l-8 8M3 21l3-3"/>'),
  cake: svg('<path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8"/><path d="M4 16s2-1 4-1 4 1 4 1 2-1 4-1 4 1 4 1"/><path d="M2 21h20"/><path d="M12 7v4"/><path d="M12 3a1.5 1.5 0 011 2.5L12 7l-1-1.5A1.5 1.5 0 0112 3z" fill="currentColor"/>'),
};

let lastMoved = [];

const todayKey = () => dayKey(new Date());
/* What the patrol can still sweep: unfinished and due today (or earlier), or not
   dated at all. A task already sent to tomorrow may still show on Today when it
   is important — it is not the patrol's any more. */
const sweepable = () => pending().filter(t => !t.dueDate || t.dueDate <= todayKey());

function head(icon, title, sub) {
  return `<div class="wc-head"><span class="wc-ico">${icon}</span><div><h2 class="wc-title">${title}</h2><p class="wc-sub">${sub}</p></div></div>`;
}

/* ── شب‌گرد ── */
function patrol() {
  const n = sweepable().length;
  const tomorrow = shiftKey(todayKey(), 1);
  if (lastMoved.length) {
    return head(ICON.moon, 'گشت شبانه', `${faNum(lastMoved.length)} کار رفت برای فردا. شهر آروم شد.`) +
      `<div class="wc-actions"><button type="button" class="wc-btn is-quiet" data-w="undo">برگردون</button></div>`;
  }
  if (!n) return head(ICON.moon, 'گشت شبانه', 'شهر آرومه؛ هیچ کار نیمه‌کاره‌ای نمونده.');
  return head(ICON.moon, 'گشت شبانه', `${faNum(n)} کار امروز نیمه‌کاره مونده.`) +
    `<div class="wc-actions"><button type="button" class="wc-btn" data-w="sweep" data-to="${tomorrow}">بفرستشون برای فردا</button></div>`;
}

/* ── تارنما ── */
function webCard(book) {
  const days = lastDays(book.days, book.today, 7);
  const cx = 110, cy = 92, r = 62;
  const pts = radarPoints(days.map(d => d.done), cx, cy, r);
  const ring = k => ringPoints(7, cx, cy, r * k).map(p => `${p.x},${p.y}`).join(' ');
  const total = days.reduce((a, d) => a + d.done, 0);
  const spokes = ringPoints(7, cx, cy, r).map(p => `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}"/>`).join('');
  const labels = ringPoints(7, cx, cy, r + 15).map((p, i) =>
    `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle">${weekdayLetter(days[i].key)}</text>`).join('');
  const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.v ? 3 : 2}"/>`).join('');
  return head(ICON.web, 'تار هفته', total ? `این هفته ${faNum(total)} کار انجام دادی.` : 'این هفته هنوز تاری نتنیدی؛ اولین کار رو تیک بزن.') +
    `<svg class="wc-web" viewBox="0 0 220 184" role="img" aria-label="نمودار تار هفته: تعداد کارهای انجام‌شدهٔ هفت روز اخیر">
       <g class="wc-grid"><polygon points="${ring(1)}"/><polygon points="${ring(.66)}"/><polygon points="${ring(.33)}"/>${spokes}</g>
       <polygon class="wc-shape" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"/>
       <g class="wc-dots">${dots}</g><g class="wc-labels">${labels}</g></svg>`;
}

/* ── فضانورد ── */
function flight(book) {
  const mins = book.totals.focus.minutes;
  const todayMin = (book.days.find(d => d.key === book.today) || {}).focusMin || 0;
  const p = orbitProgress(todayMin, state.pomoMin || 25);
  const C = 2 * Math.PI * 26;
  return head(ICON.rocket, 'دفتر پرواز', `${faNum(flightHours(mins))} ساعت پرواز تا حالا · امروز ${faNum(todayMin)} دقیقه`) +
    `<div class="wc-orbit"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="wc-orbit-bg" cx="32" cy="32" r="26"/><circle class="wc-orbit-fg" cx="32" cy="32" r="26" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>
       <span>${faNum(Math.round(p * 100))}٪</span></div>
     <div class="wc-actions"><button type="button" class="wc-btn" data-w="fly">پرواز جدید</button></div>`;
}

/* ── باغچه ── */
const PLANT = [
  '<path class="wc-soil" d="M18 54h28l-3 8H21z"/><ellipse class="wc-seed" cx="32" cy="50" rx="3" ry="2"/>',
  '<path class="wc-soil" d="M18 54h28l-3 8H21z"/><path class="wc-stem" d="M32 54V42"/><path class="wc-leaf" d="M32 44c-5 0-8-3-8-7 5 0 8 3 8 7z"/>',
  '<path class="wc-soil" d="M18 54h28l-3 8H21z"/><path class="wc-stem" d="M32 54V32"/><path class="wc-leaf" d="M32 44c-7 0-10-4-10-9 6 0 10 3 10 9zM32 38c6 0 9-4 9-8-6 0-9 3-9 8z"/>',
  '<path class="wc-soil" d="M18 54h28l-3 8H21z"/><path class="wc-stem" d="M32 54V26"/><path class="wc-leaf" d="M32 46c-7 0-10-4-10-9 6 0 10 3 10 9zM32 38c6 0 9-4 9-8-6 0-9 3-9 8z"/><ellipse class="wc-bud" cx="32" cy="22" rx="4" ry="6"/>',
  '<path class="wc-soil" d="M18 54h28l-3 8H21z"/><path class="wc-stem" d="M32 54V28"/><path class="wc-leaf" d="M32 46c-7 0-10-4-10-9 6 0 10 3 10 9zM32 38c6 0 9-4 9-8-6 0-9 3-9 8z"/><g class="wc-bloom"><ellipse cx="32" cy="14" rx="4" ry="7"/><ellipse cx="32" cy="14" rx="4" ry="7" transform="rotate(72 32 22)"/><ellipse cx="32" cy="14" rx="4" ry="7" transform="rotate(144 32 22)"/><ellipse cx="32" cy="14" rx="4" ry="7" transform="rotate(216 32 22)"/><ellipse cx="32" cy="14" rx="4" ry="7" transform="rotate(288 32 22)"/><circle class="wc-core" cx="32" cy="22" r="3.5"/></g>',
];
const PLANT_TEXT = [
  'یه کار برای امروز بنویس تا بکاریمش.', 'جوونه زد! ادامه بده.', 'برگ درآورد.', 'غنچه داد؛ کم مونده.', 'شکوفه کرد! امروز تموم شد.',
];
function garden() {
  const done = doneToday().length, total = done + pending().length;
  const stage = plantStage(done, total);
  return head(svg('<path d="M12 21v-8M12 13c-4 0-6-2-6-5 4 0 6 2 6 5zM12 11c3 0 5-2 5-4-3 0-5 1.5-5 4z"/>'), 'گلدان امروز', total ? `${faNum(done)} از ${faNum(total)} کار · ${PLANT_TEXT[stage]}` : PLANT_TEXT[0]) +
    `<svg class="wc-plant stage-${stage}" viewBox="0 0 64 64" role="img" aria-label="گلدان در مرحلهٔ ${faNum(stage + 1)} از ۵">${PLANT[stage]}</svg>`;
}

/* ── دریانورد ── */
const loadGoal = () => clampGoal(readString(STORAGE_KEYS.weekGoal));
function voyage(book) {
  const goal = loadGoal();
  const done = weekDone(book.days, book.weekStartKey(book.today), book.today);
  const p = shipProgress(done, goal);
  const arrived = p >= 1;
  /* The sea runs right to left, the way the page reads: the ship starts at the
     right-hand end and the port is at the left. */
  const x = 196 - p * 172;
  return head(ICON.ship, 'کشتیِ هفته', arrived ? 'به بندر رسیدی! هدف این هفته انجام شد.' : `${faNum(done)} از ${faNum(goal)} کار این هفته`) +
    `<svg class="wc-sea" viewBox="0 0 220 64" role="img" aria-label="کشتی ${faNum(Math.round(p * 100))} درصد راه تا بندر را رفته">
       <path class="wc-wave" d="M0 46c14-8 28-8 42 0s28 8 42 0 28-8 42 0 28 8 42 0 28-8 52 0V64H0z"/>
       <path class="wc-port" d="M14 46V28l8-6 8 6v18M22 22v-8l6 2-6 2"/>
       <g class="wc-ship" style="transform:translateX(${x.toFixed(1)}px)"><path d="M-12 34h24l-4 8h-16z"/><path d="M0 12v22M0 14l9 14H0M0 18l-7 10h7"/></g></svg>
     <div class="wc-goal"><span>هدف هفته</span>
       <button type="button" class="wc-step" data-w="goal-" aria-label="هدف کمتر">−</button>
       <b>${faNum(goal)}</b>
       <button type="button" class="wc-step" data-w="goal+" aria-label="هدف بیشتر">+</button></div>`;
}

/* ── نگارخانه ── */
function miniatureCard(book) {
  const weekStart = book.weekStartKey(book.today);
  const thisWeekDays = (book.days || []).filter(d => d.key >= weekStart && d.key <= book.today);
  const doneCount = thisWeekDays.reduce((s, d) => s + (d.done || 0), 0);
  const readMin = thisWeekDays.reduce((s, d) => s + (d.readMin || 0), 0);
  const notesCount = (book.totals.read && book.totals.read.notes) || 0;
  const score = doneCount + Math.floor(readMin / 10) + Math.min(5, notesCount);
  const stage = miniatureStage(score);

  const stageArt = [
    '',
    '<path class="wc-mini-mountains" d="M20 98 Q60 76 100 88 T180 98 Z"/>',
    '<path class="wc-mini-mountains" d="M20 98 Q60 76 100 88 T180 98 Z"/><path class="wc-mini-tree" d="M100 88 C92 74 90 54 100 38 C110 54 108 74 100 88 Z M100 88 V98"/>',
    '<path class="wc-mini-mountains" d="M20 98 Q60 76 100 88 T180 98 Z"/><path class="wc-mini-tree" d="M100 88 C92 74 90 54 100 38 C110 54 108 74 100 88 Z M100 88 V98"/><path class="wc-mini-cloud" d="M38 34 Q52 26 62 31 Q72 22 86 28 Q92 38 78 40 Q58 44 38 34 Z"/>',
    '<path class="wc-mini-mountains" d="M20 98 Q60 76 100 88 T180 98 Z"/><path class="wc-mini-tree" d="M100 88 C92 74 90 54 100 38 C110 54 108 74 100 88 Z M100 88 V98"/><path class="wc-mini-cloud" d="M38 34 Q52 26 62 31 Q72 22 86 28 Q92 38 78 40 Q58 44 38 34 Z"/><path class="wc-mini-bird" d="M136 42 Q146 32 156 39 Q166 32 176 42 Q166 45 156 43 Z"/>',
    '<path class="wc-mini-mountains" d="M20 98 Q60 76 100 88 T180 98 Z"/><path class="wc-mini-tree" d="M100 88 C92 74 90 54 100 38 C110 54 108 74 100 88 Z M100 88 V98"/><path class="wc-mini-cloud" d="M38 34 Q52 26 62 31 Q72 22 86 28 Q92 38 78 40 Q58 44 38 34 Z"/><path class="wc-mini-bird" d="M136 42 Q146 32 156 39 Q166 32 176 42 Q166 45 156 43 Z"/><g class="wc-mini-sun"><circle cx="100" cy="20" r="7"/><path d="M100 9 V13 M100 27 V31 M89 20 H93 M107 20 H111"/></g>',
  ];

  const sub = stage === 5
    ? 'مرقع نگارگری این هفته کامل شد! شاهکار به پایان رسید.'
    : (stage > 0
        ? `مرحلهٔ ${faNum(stage)} از ۵ · ${faNum(score)} امتیاز مطالعه و کار این هفته`
        : 'با مطالعه و ثبت کارهای این هفته، نقش‌های مرقع رو کامل کن.');

  return head(ICON.brush, 'مرقعِ نگارگری', sub) +
    `<svg class="wc-miniature stage-${stage}" viewBox="0 0 200 108" role="img" aria-label="مرقع نگارگری در مرحلهٔ ${faNum(stage)} از ۵">
       <path class="wc-arch" d="M20 100 V40 Q20 12 100 10 Q180 12 180 40 V100 Z"/>
       ${stageArt[stage]}
     </svg>
     <div class="wc-actions"><button type="button" class="wc-btn is-quiet" data-w="library">باز کردن کتابخانه</button></div>`;
}

/* ── قله‌نورد ── */
function summitCard(book) {
  const weekStart = book.weekStartKey(book.today);
  const weekDays = (book.days || []).filter(d => d.key >= weekStart && d.key <= book.today);
  const activeDays = weekDays.filter(d => d.done > 0 || d.focusMin > 0 || d.readMin > 0 || d.opened).length;
  const alt = summitAltitude(activeDays);
  const morningDone = (state.tasks || []).some(t => t && !t.deletedAt && t.done && t.doneAt && new Date(t.doneAt).getHours() < 7);
  const allDone = doneToday().length > 0 && pending().length === 0;
  const heroBonus = morningDone || allDone;

  const camps = [
    { x: 18,  y: 84 },
    { x: 48,  y: 74 },
    { x: 78,  y: 63 },
    { x: 108, y: 52 },
    { x: 138, y: 41 },
    { x: 168, y: 30 },
    { x: 198, y: 18 },
  ];

  const currentCamp = activeDays > 0 ? camps[Math.min(activeDays - 1, camps.length - 1)] : null;
  const climber = currentCamp
    ? `<g class="wc-climber" transform="translate(${currentCamp.x - 6}, ${currentCamp.y - 14})"><circle cx="6" cy="3" r="2.5"/><path d="M6 6 V11 M3 8 L9 8 M4 14 L6 11 L8 14"/></g>`
    : '';

  const dots = camps.map((c, i) => {
    const act = i < activeDays;
    return `<circle class="wc-camp-dot ${act ? 'is-active' : ''}" cx="${c.x}" cy="${c.y}" r="${act ? 3.5 : 2.5}"/>`;
  }).join('');

  const summitFlag = (heroBonus || activeDays >= 7)
    ? `<g class="wc-summit-flag"><path d="M198 18 V6 L208 10 L198 14" class="wc-flag"/><circle cx="210" cy="8" r="4" class="wc-sun-flare"/></g>`
    : '';

  const sub = `${faNum(alt)} متر ارتفاع صعود (${faNum(activeDays)} از ۷ روز هفته)` +
    (heroBonus ? ' · نشان سحرگاهی روشن شد' : '');

  return head(ICON.mountain, 'مسیر صعود دماوند', sub) +
    `<svg class="wc-summit" viewBox="0 0 220 96" role="img" aria-label="مسیر صعود تا ارتفاع ${faNum(alt)} متر">
       <path class="wc-summit-bg" d="M18 84 L48 74 L78 63 L108 52 L138 41 L168 30 L198 18"/>
       <path class="wc-summit-done" d="${camps.slice(0, Math.max(1, activeDays)).map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x} ${c.y}`).join(' ')}"/>
       ${dots}
       ${climber}
       ${summitFlag}
     </svg>
     <div class="wc-actions"><button type="button" class="wc-btn is-quiet" data-w="tasks">برنامهٔ امروز</button></div>`;
}

/* ── کیمیاگر ── */
function elixirCard(book) {
  const doneCount = doneToday().length;
  const todayRec = ((book.days || []).find(d => d.key === book.today) || {});
  const focusMin = todayRec.focusMin || 0;
  const hasSpirit = Boolean(todayRec.mood || todayRec.readMin > 0 || (state.moods && state.moods[book.today]));
  const el = elixirElements({ doneCount, focusMin, hasSpirit });

  const liquidLevels = [
    '',
    '<path class="wc-flask-liquid" d="M66 68 Q80 72 94 68 A24 24 0 0 1 66 68 Z"/>',
    '<path class="wc-flask-liquid" d="M58 54 Q80 58 102 54 A24 24 0 0 1 58 54 Z"/>',
    '<path class="wc-flask-liquid is-gold" d="M56 46 Q80 50 104 46 A24 24 0 0 1 56 46 Z"/><circle class="wc-bubble" cx="74" cy="50" r="2"/><circle class="wc-bubble" cx="86" cy="45" r="2.5"/><path class="wc-vapor" d="M78 12 Q80 4 82 12 Q84 4 86 12"/>',
  ];

  const sub = el.complete
    ? 'اکسیر امروز به طلا تبدیل شد! هر سه عنصر ترکیب شدند.'
    : `${faNum(el.count)} از ۳ عنصر اکسیر ترکیب شده · ` +
      (!el.work ? 'کار، ' : '') + (!el.focus ? 'تمرکز، ' : '') + (!el.spirit ? 'حال/مطالعه' : '');

  return head(ICON.flask, 'اکسیرِ روزانه', sub.replace(/، $/, '')) +
    `<svg class="wc-elixir stage-${el.count}" viewBox="0 0 160 92" role="img" aria-label="اکسیر با ${faNum(el.count)} عنصر از ۳">
       <path class="wc-flask-stand" d="M56 84 H104 M80 84 V76"/>
       <circle class="wc-flask-glass" cx="80" cy="54" r="24"/>
       <path class="wc-flask-neck" d="M74 30 V14 H86 V30"/>
       ${liquidLevels[el.count]}
       <g class="wc-element ${el.work ? 'is-active' : ''}" transform="translate(26, 46)"><circle r="9"/><text y="3" text-anchor="middle" font-size="9">کار</text></g>
       <g class="wc-element ${el.focus ? 'is-active' : ''}" transform="translate(80, 10)"><circle r="8"/><text y="3" text-anchor="middle" font-size="8">تمرکز</text></g>
       <g class="wc-element ${el.spirit ? 'is-active' : ''}" transform="translate(134, 46)"><circle r="9"/><text y="3" text-anchor="middle" font-size="9">جان</text></g>
     </svg>
     <div class="wc-actions"><button type="button" class="wc-btn" data-w="fly">شروع تمرکز کیمیاگری</button></div>`;
}

/* ── رصدخانه ── */
function constellationCard(book) {
  const stars = constellationDays(book.days, book.weekStartKey(book.today), book.today);
  const coords = [
    { x: 190, y: 32 },
    { x: 176, y: 68 },
    { x: 136, y: 72 },
    { x: 142, y: 36 },
    { x: 104, y: 44 },
    { x: 66,  y: 56 },
    { x: 26,  y: 40 },
  ];

  const segments = [
    [0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]
  ];

  const bgLines = segments.map(([a, b]) =>
    `<line class="wc-const-line" x1="${coords[a].x}" y1="${coords[a].y}" x2="${coords[b].x}" y2="${coords[b].y}"/>`
  ).join('');

  const activeLines = segments.filter(([a, b]) => stars[a].active && stars[b].active).map(([a, b]) =>
    `<line class="wc-const-line is-active" x1="${coords[a].x}" y1="${coords[a].y}" x2="${coords[b].x}" y2="${coords[b].y}"/>`
  ).join('');

  const starNodes = stars.map((s, i) => {
    const c = coords[i];
    const ring = s.isToday ? `<circle class="wc-const-today" cx="${c.x}" cy="${c.y}" r="7"/>` : '';
    const flare = s.active ? `<path class="wc-const-flare" d="M${c.x} ${c.y - 6} V${c.y + 6} M${c.x - 6} ${c.y} H${c.x + 6}"/>` : '';
    return `<g class="wc-star-node ${s.active ? 'is-active' : ''}">
              ${ring}
              <circle class="wc-const-star ${s.active ? 'is-active' : ''}" cx="${c.x}" cy="${c.y}" r="${s.active ? 3.5 : 2}"/>
              ${flare}
              <text class="wc-const-label" x="${c.x}" y="${c.y + 15}" text-anchor="middle">${s.letter}</text>
            </g>`;
  }).join('');

  const activeCount = stars.filter(s => s.active).length;
  const sub = activeCount === 7
    ? 'هفت‌اورنگِ کامل! آسمان هفته یکپارچه درخشید.'
    : `${faNum(activeCount)} ستاره از هفت‌اورنگ این هفته روشنه.`;

  return head(ICON.telescope, 'صورت فلکیِ هفته', sub) +
    `<svg class="wc-constellation" viewBox="0 0 220 96" role="img" aria-label="صورت فلکی هفت‌اورنگ با ${faNum(activeCount)} ستارهٔ روشن">
       <g class="wc-const-grid">${bgLines}${activeLines}</g>
       <g class="wc-const-stars">${starNodes}</g>
     </svg>
     <div class="wc-actions"><button type="button" class="wc-btn is-quiet" data-w="tasks">رصد روزهای هفته</button></div>`;
}

/* ── سیمرغ ── */
function simorghCard(book) {
  const activeDays = simorghActiveDays(book.days, book.today);
  const cx = 110, cy = 82;
  const r1 = 44, r2 = 68;
  const plumes = [];

  for (let i = 0; i < 30; i++) {
    const a = Math.PI - (i * Math.PI) / 29;
    const x1 = +(cx + Math.cos(a) * r1).toFixed(1);
    const y1 = +(cy - Math.sin(a) * r1).toFixed(1);
    const x2 = +(cx + Math.cos(a) * r2).toFixed(1);
    const y2 = +(cy - Math.sin(a) * r2).toFixed(1);
    const active = i < activeDays;
    plumes.push(`<line class="wc-plume ${active ? 'is-active' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }

  const sub = activeDays >= 30
    ? 'سیمرغ تجلی یافت! سی مرغ به قاف رسیدند.'
    : `${faNum(activeDays)} از ۳۰ روز فعال · پرواز در مسیر کوه قاف`;

  return head(ICON.feather, 'سی مرغِ قاف', sub) +
    `<svg class="wc-simorgh" viewBox="0 0 220 96" role="img" aria-label="${faNum(activeDays)} از ۳۰ پرِ سیمرغ روشن است">
       <g class="wc-simorgh-fan">${plumes.join('')}</g>
       <circle class="wc-simorgh-core" cx="${cx}" cy="${cy}" r="34"/>
       <text class="wc-simorgh-count" x="${cx}" y="${cy - 2}" text-anchor="middle">${faNum(activeDays)}</text>
       <text class="wc-simorgh-label" x="${cx}" y="${cy + 13}" text-anchor="middle">از ۳۰ پر</text>
     </svg>
     <div class="wc-actions"><button type="button" class="wc-btn" data-w="fly">پرواز سیمرغ</button></div>`;
}

/* ── تولد ── */
let isEditingWish = false;

function birthdayCard() {
  const bState = birthdayWorldState({
    date: new Date(),
    stored: loadBirthday(),
    candleDate: loadBirthdayCandle(),
    todayKey: todayKey(),
    wishes: loadBirthdayWishes(),
  });

  const sub = bState.isBirthdayToday
    ? 'امروز روز درخشش توست! شمع کیک رو فوت کن و سال نوت رو جشن بگیر.'
    : (bState.hasBirthday
        ? (bState.daysUntil === 0
            ? 'امروز روز درخشش توست! شمع کیک رو فوت کن و سال نوت رو جشن بگیر.'
            : (bState.daysUntil !== null
                ? `${faNum(bState.daysUntil)} روز تا سالروز تولد باقی مانده`
                : 'دنیای جشن تولد و آرزوهای زندگی'))
        : 'تاریخ تولدت رو در تنظیمات ثبت کن تا جشن تولدت آماده باشه.');

  const cakeClass = bState.candleBlown ? 'wc-cake is-blown' : 'wc-cake is-lit';
  const cakeAction = bState.candleBlown ? 'relight-candle' : 'blow-candle';
  const cakeAriaLabel = bState.candleBlown
    ? 'کیک تولد با شمع خاموش‌شده؛ برای روشن کردن دوباره ضربه بزنید'
    : 'کیک تولد با شمع‌های روشن؛ برای فوت کردن شمع ضربه بزنید';

  const cakeSvg = `
    <svg class="${cakeClass}" viewBox="0 0 200 120" role="button" aria-label="${cakeAriaLabel}" data-w="${cakeAction}" tabindex="0">
      <circle class="wc-cake-halo" cx="100" cy="64" r="62"/>
      <ellipse class="wc-cake-plate" cx="100" cy="108" rx="72" ry="7"/>
      <path class="wc-cake-stand" d="M85 108 L80 115 H120 L115 108 Z"/>
      <rect class="wc-cake-tier wc-tier-1" x="42" y="70" width="116" height="34" rx="6"/>
      <path class="wc-cake-icing" d="M42 76 Q51 86 61 76 Q70 86 80 76 Q90 86 100 76 Q110 86 120 76 Q130 86 140 76 Q150 86 158 76 V70 H42 Z"/>
      <rect class="wc-cake-tier wc-tier-2" x="62" y="44" width="76" height="26" rx="5"/>
      <path class="wc-cake-icing" d="M62 50 Q71 58 81 50 Q90 58 100 50 Q110 58 119 50 Q129 58 138 50 V44 H62 Z"/>
      <g class="wc-sprinkles" aria-hidden="true">
        <rect x="48" y="82" width="5" height="2" rx="1" transform="rotate(-18 48 82)"/>
        <rect x="67" y="88" width="5" height="2" rx="1" transform="rotate(14 67 88)"/>
        <rect x="88" y="80" width="5" height="2" rx="1" transform="rotate(-28 88 80)"/>
        <rect x="108" y="88" width="5" height="2" rx="1" transform="rotate(22 108 88)"/>
        <rect x="128" y="81" width="5" height="2" rx="1" transform="rotate(-12 128 81)"/>
        <rect x="146" y="87" width="5" height="2" rx="1" transform="rotate(30 146 87)"/>
        <rect x="72" y="58" width="4" height="2" rx="1" transform="rotate(18 72 58)"/>
        <rect x="95" y="63" width="4" height="2" rx="1" transform="rotate(-24 95 63)"/>
        <rect x="118" y="57" width="4" height="2" rx="1" transform="rotate(10 118 57)"/>
      </g>
      <circle class="wc-cake-pearl" cx="54" cy="94" r="2.5"/>
      <circle class="wc-cake-pearl" cx="74" cy="94" r="2.5"/>
      <circle class="wc-cake-pearl" cx="100" cy="94" r="2.5"/>
      <circle class="wc-cake-pearl" cx="126" cy="94" r="2.5"/>
      <circle class="wc-cake-pearl" cx="146" cy="94" r="2.5"/>

      <!-- Left Candle -->
      <g class="wc-candle" transform="translate(78, 22)">
        <rect class="wc-candle-stick" x="-2" y="6" width="4" height="16" rx="1"/>
        <line class="wc-candle-wick" x1="0" y1="6" x2="0" y2="2"/>
        <g class="wc-flame-group">
          <ellipse class="wc-flame wc-flame-outer" cx="0" cy="-2" rx="3.5" ry="5.5"/>
          <ellipse class="wc-flame wc-flame-inner" cx="0" cy="-1.5" rx="1.8" ry="3"/>
        </g>
        <g class="wc-smoke-group">
          <path class="wc-smoke" d="M0 2 Q-3 -5 0 -10 T2 -16"/>
        </g>
      </g>

      <!-- Center Candle -->
      <g class="wc-candle is-center" transform="translate(100, 18)">
        <rect class="wc-candle-stick" x="-2.5" y="6" width="5" height="20" rx="1"/>
        <line class="wc-candle-wick" x1="0" y1="6" x2="0" y2="2"/>
        <g class="wc-flame-group">
          <ellipse class="wc-flame wc-flame-outer" cx="0" cy="-3" rx="4.5" ry="7"/>
          <ellipse class="wc-flame wc-flame-inner" cx="0" cy="-2" rx="2.2" ry="4"/>
        </g>
        <g class="wc-smoke-group">
          <path class="wc-smoke" d="M0 2 Q-4 -6 0 -12 T3 -20"/>
        </g>
      </g>

      <!-- Right Candle -->
      <g class="wc-candle" transform="translate(122, 22)">
        <rect class="wc-candle-stick" x="-2" y="6" width="4" height="16" rx="1"/>
        <line class="wc-candle-wick" x1="0" y1="6" x2="0" y2="2"/>
        <g class="wc-flame-group">
          <ellipse class="wc-flame wc-flame-outer" cx="0" cy="-2" rx="3.5" ry="5.5"/>
          <ellipse class="wc-flame wc-flame-inner" cx="0" cy="-1.5" rx="1.8" ry="3"/>
        </g>
        <g class="wc-smoke-group">
          <path class="wc-smoke" d="M0 2 Q3 -5 0 -10 T-2 -16"/>
        </g>
      </g>

      <!-- Celebration Sparkles -->
      <g class="wc-sparkles">
        <path class="wc-sparkle sp-1" d="M30 45 L32 40 L34 45 L39 47 L34 49 L32 54 L30 49 L25 47 Z"/>
        <path class="wc-sparkle sp-2" d="M165 40 L167 36 L169 40 L173 42 L169 44 L167 48 L165 44 L161 42 Z"/>
        <circle class="wc-sparkle-dot sp-3" cx="48" cy="30" r="1.8"/>
        <circle class="wc-sparkle-dot sp-4" cx="152" cy="25" r="2"/>
      </g>
    </svg>
  `;

  /* The numbers as little cards, not a row of pills: the figure is what the eye
     should land on, and a label underneath lets «۱۱۳۲۲» keep its unit without
     the two fighting for the same line. */
  const tiles = [];
  if (bState.daysLived !== null) {
    tiles.push(`<div class="wc-bday-pill"><b>${faNum(bState.daysLived)}</b><small>روز زندگی</small></div>`);
  }
  if (bState.age !== null) {
    tiles.push(`<div class="wc-bday-pill"><b>${faNum(bState.age)}</b><small>سالگی</small></div>`);
  }
  if (!bState.isBirthdayToday && bState.daysUntil !== null) {
    tiles.push(`<div class="wc-bday-pill"><b>${faNum(bState.daysUntil)}</b><small>روز تا تولد</small></div>`);
  }
  const tilesHtml = tiles.length ? `<div class="wc-bday-stats">${tiles.join('')}</div>` : '';

  /* One banner instead of a pill that reads like the others: the day itself is
     the headline, and the three numbers are the small print under it. */
  const todayBanner = bState.isBirthdayToday
    ? `<p class="wc-bday-today">${ICON.cake}<span>روز تولد شما مبارک!</span></p>`
    : '';

  /* A garland over the cake and a bunch of balloons behind it. Both are drawn
     here, in the card, rather than in the page's fixed layers: they belong to the
     birthday world and leave with it, and they cost one SVG each instead of a
     full-screen layer that has to be masked. */
  const garlandSvg = `
    <svg class="wc-bday-garland" viewBox="0 0 320 46" aria-hidden="true" focusable="false">
      <path class="wc-garland-string" d="M2 8 Q60 30 110 22 T210 22 Q265 30 318 8"/>
      <g class="wc-garland-flags">
        <polygon class="wc-flag" points="26,14 40,16 33,30"/>
        <polygon class="wc-flag is-alt" points="58,21 72,23 65,37"/>
        <polygon class="wc-flag" points="90,24 104,25 97,39"/>
        <polygon class="wc-flag is-alt" points="122,23 136,23 129,37"/>
        <polygon class="wc-flag" points="154,21 168,21 161,35"/>
        <polygon class="wc-flag is-alt" points="186,21 200,21 193,35"/>
        <polygon class="wc-flag" points="218,22 232,23 225,37"/>
        <polygon class="wc-flag is-alt" points="250,24 264,25 257,39"/>
        <polygon class="wc-flag" points="282,20 296,22 289,36"/>
      </g>
    </svg>`;

  /* Each balloon carries its position in its own coordinates rather than a
     transform attribute: the float animation is a CSS transform, and a CSS
     transform replaces the attribute, which collapsed all five into the corner
     the first time this was drawn. */
  const balloonsSvg = `
    <svg class="wc-balloons" viewBox="0 0 220 132" aria-hidden="true" focusable="false">
      <g class="wc-balloon b1">
        <ellipse class="wc-balloon-body" cx="26" cy="30" rx="14" ry="17"/>
        <ellipse class="wc-balloon-shine" cx="21" cy="24" rx="3.4" ry="5.4"/>
        <path class="wc-balloon-knot" d="M22 47l4 5 4-5z"/>
        <path class="wc-balloon-string" d="M26 52Q18 76 30 104"/>
      </g>
      <g class="wc-balloon b2 is-alt">
        <ellipse class="wc-balloon-body" cx="72" cy="22" rx="15" ry="18"/>
        <ellipse class="wc-balloon-shine" cx="67" cy="15" rx="3.6" ry="5.8"/>
        <path class="wc-balloon-knot" d="M68 40l4 5 4-5z"/>
        <path class="wc-balloon-string" d="M72 45Q80 72 66 108"/>
      </g>
      <g class="wc-balloon b3">
        <ellipse class="wc-balloon-body" cx="112" cy="34" rx="13" ry="16"/>
        <ellipse class="wc-balloon-shine" cx="107" cy="28" rx="3" ry="5"/>
        <path class="wc-balloon-knot" d="M108 50l4 5 4-5z"/>
        <path class="wc-balloon-string" d="M112 55Q104 80 114 106"/>
      </g>
      <g class="wc-balloon b4 is-alt">
        <ellipse class="wc-balloon-body" cx="154" cy="20" rx="15" ry="18"/>
        <ellipse class="wc-balloon-shine" cx="149" cy="13" rx="3.6" ry="5.8"/>
        <path class="wc-balloon-knot" d="M150 38l4 5 4-5z"/>
        <path class="wc-balloon-string" d="M154 43Q164 70 152 108"/>
      </g>
      <g class="wc-balloon b5">
        <ellipse class="wc-balloon-body" cx="196" cy="32" rx="13" ry="17"/>
        <ellipse class="wc-balloon-shine" cx="191" cy="26" rx="3.2" ry="5.2"/>
        <path class="wc-balloon-knot" d="M192 49l4 5 4-5z"/>
        <path class="wc-balloon-string" d="M196 54Q206 78 194 104"/>
      </g>
    </svg>`;

  // Main action buttons
  let actionBtn = '';
  if (bState.candleBlown) {
    actionBtn = `<button type="button" class="wc-btn is-quiet" data-w="relight-candle">روشن کردن دوبارهٔ شمع</button>`;
  } else {
    actionBtn = `<button type="button" class="wc-btn wc-bday-blow-btn" data-w="blow-candle">فوت کردن شمع</button>`;
  }
  if (bState.hasBirthday) {
    actionBtn += `<button type="button" class="wc-btn is-quiet" data-w="share-bday">کارت تولد برای اشتراک</button>`;
  } else {
    actionBtn += `<button type="button" class="wc-btn is-quiet" data-w="open-bday-picker">تنظیم تاریخ تولد</button>`;
  }
  const actionsHtml = `<div class="wc-actions">${actionBtn}</div>`;

  // Wish capsule box
  let wishHtml = '';
  if (isEditingWish) {
    wishHtml = `
      <div class="wc-wish-box">
        <div class="wc-wish-form">
          <label class="wc-wish-label" for="wcWishInput">کپسول آرزوی سال ${faNum(bState.currentYear)}:</label>
          <textarea id="wcWishInput" class="wc-wish-input" rows="2" maxlength="150" placeholder="آرزو و هدف امسال برای زندگی...">${esc(bState.wish)}</textarea>
          <div class="wc-wish-btns">
            <button type="button" class="wc-btn" data-w="save-wish">ذخیره در کپسول</button>
            <button type="button" class="wc-btn is-quiet" data-w="cancel-wish">انصراف</button>
          </div>
        </div>
      </div>
    `;
  } else if (bState.wish) {
    wishHtml = `
      <div class="wc-wish-box">
        <div class="wc-wish-header">
          <span class="wc-wish-title">کپسول آرزوی ${faNum(bState.currentYear)}</span>
          <button type="button" class="wc-wish-edit-btn" data-w="edit-wish" aria-label="ویرایش آرزو">ویرایش</button>
        </div>
        <p class="wc-wish-text">${esc(bState.wish)}</p>
      </div>
    `;
  } else {
    wishHtml = `
      <div class="wc-wish-box is-empty">
        <button type="button" class="wc-wish-prompt" data-w="edit-wish">
          <span>یک آرزو در کپسول امسال بنویس...</span>
        </button>
      </div>
    `;
  }

  return head(ICON.cake, 'جشن تولد', sub) +
    `<div class="wc-bday-scene">${garlandSvg}<div class="wc-bday-stage">${balloonsSvg}${cakeSvg}</div>${todayBanner}${tilesHtml}</div>` +
    actionsHtml + wishHtml;
}

export const RENDER = {
  shabgard: patrol,
  tarnama: webCard,
  fazanavard: flight,
  baghche: garden,
  daryanavard: voyage,
  negarkhane: miniatureCard,
  qollenavard: summitCard,
  kimiyagar: elixirCard,
  rasadkhane: constellationCard,
  simorgh: simorghCard,
  tavalod: birthdayCard,
};

export function renderWorld() {
  const card = $('#worldCard');
  if (!card) return;
  const t = theme();
  const plugin = WORLD_PLUGINS.get(t);
  if (!WORLDS.has(t) && !plugin) {
    card.hidden = true;
    card.innerHTML = '';
    delete card.dataset.world;
    return;
  }
  card.dataset.world = t;
  if (plugin && typeof plugin.renderCard === 'function') {
    card.innerHTML = plugin.renderCard(t);
    card.hidden = false;
    return;
  }
  const book = (t === 'shabgard' || t === 'baghche' || t === 'tavalod') ? null : collectTotals();
  card.innerHTML = RENDER[t](book);
  card.hidden = false;
}

function onClick(e) {
  const b = e.target.closest('[data-w]');
  if (!b) return;
  const act = b.dataset.w;
  if (act === 'sweep') {
    lastMoved = sweepable().map(t => t.id);
    lastMoved.forEach(id => moveTaskToDay(id, b.dataset.to));
    haptic('done');
  } else if (act === 'undo') {
    const ids = lastMoved; lastMoved = [];
    ids.forEach(id => moveTaskToDay(id, todayKey()));
    haptic('pick');
  } else if (act === 'fly') {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'focus' }));
  } else if (act === 'library') {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'library' }));
  } else if (act === 'tasks') {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'today' }));
  } else if (act === 'goal-' || act === 'goal+') {
    safeSet(STORAGE_KEYS.weekGoal, String(stepGoal(loadGoal(), act === 'goal+' ? 1 : -1)));
    haptic('pick');
  } else if (act === 'blow-candle') {
    saveBirthdayCandle(todayKey());
    haptic('done');
    confetti();
    beep();
  } else if (act === 'relight-candle') {
    saveBirthdayCandle('');
    haptic('pick');
  } else if (act === 'edit-wish') {
    isEditingWish = true;
    renderWorld();
    const input = $('#wcWishInput');
    if (input) input.focus();
    return;
  } else if (act === 'save-wish') {
    const input = $('#wcWishInput');
    const val = input ? input.value.trim() : '';
    const bState = birthdayWorldState({
      date: new Date(),
      stored: loadBirthday(),
      candleDate: loadBirthdayCandle(),
      todayKey: todayKey(),
      wishes: loadBirthdayWishes(),
    });
    const wishes = { ...(loadBirthdayWishes() || {}) };
    if (val) {
      wishes[bState.currentYear] = val;
    } else {
      delete wishes[bState.currentYear];
      delete wishes[String(bState.currentYear)];
    }
    saveBirthdayWishes(wishes);
    haptic('done');
    isEditingWish = false;
  } else if (act === 'cancel-wish') {
    isEditingWish = false;
  } else if (act === 'share-bday') {
    haptic('pick');
    openBirthdayShare();
    return;
  } else if (act === 'open-bday-picker') {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' }));
    setTimeout(() => { $('#bdPick')?.click(); }, 150);
  }
  renderWorld();
}

export function initWorlds() {
  const card = $('#worldCard');
  if (!card) return;
  card.addEventListener('click', onClick);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const b = e.target.closest('[data-w]');
      if (b && b.tagName.toLowerCase() !== 'button' && b.tagName.toLowerCase() !== 'textarea') {
        e.preventDefault();
        b.click();
      }
    } else if (e.key === 'Escape' && isEditingWish) {
      isEditingWish = false;
      renderWorld();
    }
  });
  subscribe(renderWorld);
  window.addEventListener('theme-applied', () => {
    lastMoved = [];
    isEditingWish = false;
    syncWorldLifecycle(theme());
    renderWorld();
  });
  window.addEventListener('re7-tapes-changed', renderWorld);
  window.addEventListener('gtasa-hud-changed', renderWorld);
  syncWorldLifecycle(theme());
  renderWorld();
}
