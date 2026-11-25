/* ═══ World 1 Plugin: Resident Evil 7 — Baker Estate (Immersive + 60fps Perf) ═══
   Pure logic exports are 100% Node-testable with zero top-level DOM side effects.
   Features:
   - Pooled Web Audio Save Room Theme (F#m @ 76 BPM, Celesta + warm pad), default ON
     on entry (auto-unlocks on first gesture if browser suspended AudioContext), toggleable
   - Dynamic context-aware dialogues (Jack Baker, Zoe Baker, Ethan, Save Room)
   - Zoe's Save Room Rotary Phone prop + analog ring + live contextual guidance
   - Dual-tab Save Room modal: 5-Cassette Ring Buffer (TAPES) + Unlockable Lore (FILES)
   - First Aid Med recovery progress prop + per-page backdrops (incl. bg-library.webp)
   - Adaptive `data-re7-perf="lite"` profile & 100% leak-free teardown on deactivate */

import { $, esc, faNum, dayKey, nextId } from './utils.js';
import { STORAGE_KEYS } from './constants.js';
import { readString, safeSet } from './store.js';
import { formatJalaliDate } from './jalali.js';
import { todayPending, todayDone } from './today.js';
import { readLedger } from './ledger.js';
import { getHistory } from './focushistory.js';
import { haptic, prefersReducedMotion } from './motion.js';

export const RE7_WORLD_ID = 're7-baker';
export const MAX_RE7_TAPES = 5;
export const MAX_RE7_TAPE_NOTE = 60;

export const RE7_ASSETS = Object.freeze({
  homeBg: 'assets/worlds/re7/bg-home.webp',
  tasksBg: 'assets/worlds/re7/bg-tasks.webp',
  focusBg: 'assets/worlds/re7/bg-focus.webp',
  libraryBg: 'assets/worlds/re7/bg-library.webp',
  grungeTex: 'assets/worlds/re7/tex-grunge.webp',
  recorderProp: 'assets/worlds/re7/prop-recorder.webp',
  medProp: 'assets/worlds/re7/prop-med.webp',
  phoneProp: 'assets/worlds/re7/prop-phone.webp',
});

/**
 * Pure heuristic deciding `'lite'` vs `'full'` FX tier for weak / budget devices.
 * @param {Object} [env]
 * @returns {'lite'|'full'}
 */
export function resolveRe7PerfMode({
  hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
  deviceMemory = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
  saveData = typeof navigator !== 'undefined' ? navigator.connection?.saveData : false,
  reducedMotion = typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : false,
} = {}) {
  if (reducedMotion || saveData) return 'lite';
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) return 'lite';
  if (typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0 && hardwareConcurrency <= 4) return 'lite';
  return 'full';
}

/**
 * Computes calm survival-horror Save Room recovery state from today's progress.
 * @param {Object} [params]
 */
export function computeSaveRoomRecovery({ pendingCount = 0, doneCount = 0, focusMin = 0 } = {}) {
  const done = Math.max(0, Math.round(Number(doneCount) || 0));
  const pending = Math.max(0, Math.round(Number(pendingCount) || 0));
  const focus = Math.max(0, Math.round(Number(focusMin) || 0));
  const total = done + pending;

  let recoveryPct = 0;
  if (total > 0) {
    recoveryPct = Math.min(100, Math.round((done / total) * 100));
  } else if (focus > 0) {
    recoveryPct = Math.min(100, Math.round(focus * 2));
  }

  let level = 'idle';
  let badge = 'STANDBY';
  let statusText = 'اتاق سیو آماده است — اولین کار امروز را تیک بزن تا نوار بهبودی جان بگیرد.';

  if (done > 0 && pending === 0) {
    level = 'safe';
    badge = 'SAFE';
    statusText = `حالت امن اتاق سیو — همهٔ ${faNum(done)} کار امروز را با موفقیت پشت سر گذاشتی.`;
  } else if (done > 0) {
    level = 'recovering';
    badge = 'HEALING';
    statusText = `حالت امن اتاق سیو — امروز ${faNum(done)} کار رو با موفقیت پشت سر گذاشتی.`;
  } else if (focus > 0) {
    level = 'recovering';
    badge = 'HEALING';
    statusText = `پناهگاه آرام — امروز ${faNum(focus)} دقیقه تمرکز ثبت شده.`;
  }

  return {
    level,
    badge,
    recoveryPct,
    doneCount: done,
    pendingCount: pending,
    focusMin: focus,
    statusText,
  };
}

/**
 * Selects dynamic RE7 Baker Estate dialogue & Zoe phone guidance from today's live state.
 * Zero DOM dependencies (100% pure).
 */
export function selectBakerDialogue({
  pendingCount = 0,
  overdueCount = 0,
  urgentCount = 0,
  doneCount = 0,
  focusMin = 0,
} = {}) {
  const pending = Math.max(0, Math.round(Number(pendingCount) || 0));
  const overdue = Math.max(0, Math.round(Number(overdueCount) || 0));
  const urgent = Math.max(0, Math.round(Number(urgentCount) || 0));
  const done = Math.max(0, Math.round(Number(doneCount) || 0));
  const focus = Math.max(0, Math.round(Number(focusMin) || 0));

  if (overdue > 0) {
    return {
      tone: 'danger',
      speaker: 'جک بیکر',
      quote: '«به خانواده خوش اومدی رفیق! اون کار عقب‌افتاده هنوز تو راهرو منتظرته…»',
      phoneMsg: `زوئی (پشت خط): «بابا اطراف راهرو پرسه می‌زنه. همون ${faNum(overdue)} کار عقب‌افتاده رو اول رد کن تا مسیر امن بشه.»`,
    };
  }
  if (urgent > 0) {
    return {
      tone: 'warning',
      speaker: 'زوئی بیکر',
      quote: '«فانوس مارگریت داره نزدیک می‌شه… وقتشه کار فوری امروز رو تموم کنی.»',
      phoneMsg: `زوئی (پشت خط): «گوش کن، فرصت کمه؛ ${faNum(urgent)} کار فوری داری — رویش تمرکز کن و نوارت رو ذخیره کن.»`,
    };
  }
  if (done > 0 && pending === 0) {
    return {
      tone: 'safe',
      speaker: 'اتاق سیو',
      quote: '«طلوع از پشت مرداب لوئیزیانا پیداست؛ امروز از عمارت بیکر سربلند بیرون اومدی.»',
      phoneMsg: `زوئی (پشت خط): «کارت عالی بود! همهٔ ${faNum(done)} کار امروز تموم شد؛ در ایوان شرقی بازه.»`,
    };
  }
  if (done > 0) {
    return {
      tone: 'recovering',
      speaker: 'اتاق سیو',
      quote: '«بوی گیاه درمانی میاد… راهروهای عمارت رو آروم و پیوسته پشت سر می‌ذاری.»',
      phoneMsg: `زوئی (پشت خط): «مسیرت درسته؛ تا الان ${faNum(done)} کار انجام دادی و ${faNum(pending)} کار دیگه مونده.»`,
    };
  }
  if (focus > 0) {
    return {
      tone: 'recovering',
      speaker: 'اتاق سیو',
      quote: '«چراغ تنگستن روشنه و سکوت برقراره؛ صدای قدم‌های متمرکزت تو خونه می‌پیچه.»',
      phoneMsg: `زوئی (پشت خط): «امروز ${faNum(focus)} دقیقه تمرکز ثبت کردی. وقتش رسیده اولین کار امروز رو تیک بزنی.»`,
    };
  }
  return {
    tone: 'idle',
    speaker: 'اتاق سیو بیکر',
    quote: '«در رو قفل کن… همین ضبط‌صوت کوچیک و یه ذهن آروم برای شروع کافیه.»',
    phoneMsg: 'زوئی (پشت خط): «اگه صدام رو می‌شنوی، از همون کار سبک اول شروع کن؛ هر تیک تو رو به خروج نزدیک‌تر می‌کنه.»',
  };
}

/**
 * Computes progressive unlock state for the 5 collectible Baker Estate lore FILES.
 */
export function computeUnlockedRe7Files({
  tapesCount = 0,
  doneCount = 0,
  focusMin = 0,
  pendingCount = 0,
} = {}) {
  const tapes = Math.max(0, Math.round(Number(tapesCount) || 0));
  const done = Math.max(0, Math.round(Number(doneCount) || 0));
  const focus = Math.max(0, Math.round(Number(focusMin) || 0));
  const pending = Math.max(0, Math.round(Number(pendingCount) || 0));
  const total = done + pending;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done > 0 && pending === 0;

  return [
    {
      id: 'file-01',
      code: 'FILE 01',
      title: 'دستورالعمل اتاق سیو دالوی',
      author: 'یادداشت ناشناس روی میز چوبی',
      unlockHint: 'همیشه در دسترس',
      unlocked: true,
      body: '«وقتی راهروها شلوغ می‌شن، برگرد به اتاق سیو. این ضبط‌صوت کاست پیشرفتت رو نگه می‌داره و بطری سبز سمت راست، نشون می‌ده چقدر از مسیر امروز رو سالم طی کردی.»',
    },
    {
      id: 'file-02',
      code: 'FILE 02',
      title: 'تماس خط اول: یادداشت زوئی',
      author: 'زوئی بیکر — تریلر حیاط',
      unlockHint: 'با انجام ۱ کار در امروز باز می‌شود',
      unlocked: done >= 1,
      body: '«شنیدم بالاخره دست به کار شدی. خونهٔ اصلی پر از کارهای نیمه‌کاره‌ست، اما نذار جک سرعتت رو بگیره. هر کاری که تیک می‌زنی یه قفل قدیمی رو باز می‌کنه.»',
    },
    {
      id: 'file-03',
      code: 'FILE 03',
      title: 'فرمول گیاه درمانی قوی (Strong)',
      author: 'آزمایشگاه زیرزمین شرقی',
      unlockHint: 'با رسیدن بهبودی به ۵۰٪ باز می‌شود',
      unlocked: pct >= 50 || done >= 2,
      body: '«ترکیب برگ سبز و آرامش ذهن: وقتی بیش از نیمی از وظایف روزت انجام می‌شه، تنش محیط فروکش می‌کنه. نظم بهترین پادزهر عمارت بیکره.»',
    },
    {
      id: 'file-04',
      code: 'FILE 04',
      title: 'کارت‌پستال: به خانواده خوش اومدی',
      author: 'جک بیکر — تالار غذاخوری',
      unlockHint: 'با ضبط ۱ نوار یا ۱۵ دقیقه تمرکز باز می‌شود',
      unlocked: tapes >= 1 || focus >= 15,
      body: '«هی پسر! فکر کردی می‌تونی بی‌سروصدا تمرکز کنی و در بری؟ حداقل صدای خش‌خش نوارت رو اینجا جا گذاشتی… خوش گذشت، نه؟»',
    },
    {
      id: 'file-05',
      code: 'FILE 05',
      title: 'برگهٔ کلید ایوان شرقی',
      author: 'پروندهٔ خروج — مزرعهٔ بیکر',
      unlockHint: 'با تکمیل همهٔ کارهای امروز (SAFE) باز می‌شود',
      unlocked: allDone,
      body: '«مه مرداب کنار رفت و نور صبح به شیشهٔ شکستهٔ گلخونه افتاد. همهٔ کارهای امروزت با موفقیت بسته شد — تا فردا، عمارت در آرامشه.»',
    },
  ];
}

/**
 * Safely normalizes stored cassette save tapes (clamps note length, max 5 ring buffer).
 */
export function normalizeRe7Tapes(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `tape-${nextId()}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const createdAt = Number.isFinite(Number(item.createdAt)) && Number(item.createdAt) > 0
      ? Math.floor(Number(item.createdAt))
      : Date.now();
    const jalaliDate = typeof item.jalaliDate === 'string' && item.jalaliDate.trim()
      ? item.jalaliDate.trim().slice(0, 32)
      : '';
    const clock = typeof item.clock === 'string' && item.clock.trim()
      ? item.clock.trim().slice(0, 12)
      : '';
    const doneCount = Number.isFinite(Number(item.doneCount)) && Number(item.doneCount) >= 0
      ? Math.round(Number(item.doneCount))
      : 0;
    const focusMin = Number.isFinite(Number(item.focusMin)) && Number(item.focusMin) >= 0
      ? Math.round(Number(item.focusMin))
      : 0;
    const rawNote = typeof item.note === 'string' ? item.note.trim() : '';
    const note = rawNote.length > MAX_RE7_TAPE_NOTE ? rawNote.slice(0, MAX_RE7_TAPE_NOTE) : rawNote;

    out.push({ id, createdAt, jalaliDate, clock, doneCount, focusMin, note });
    if (out.length >= MAX_RE7_TAPES) break;
  }
  return out;
}

export function appendRe7Tape(tapes, newTape) {
  const existing = normalizeRe7Tapes(tapes);
  const added = normalizeRe7Tapes([newTape]);
  if (!added.length) return existing;
  return [added[0], ...existing.filter(t => t.id !== added[0].id)].slice(0, MAX_RE7_TAPES);
}

export function formatRe7TapeMeta(tape) {
  const d = Number(tape?.doneCount) || 0;
  const f = Number(tape?.focusMin) || 0;
  return `${faNum(d)} کار انجام‌شده · ${faNum(f)} دقیقه تمرکز`;
}

export function isRe7AudioMuted() {
  return readString('daftarche-sound') === '0' || readString(STORAGE_KEYS.re7SfxMuted) === '1';
}

export function setRe7AudioMuted(muted) {
  safeSet(STORAGE_KEYS.re7SfxMuted, muted ? '1' : '0');
  return Boolean(muted);
}

/**
 * Save Room music defaults to ON unless explicitly muted ('0') by the user.
 */
export function isRe7MusicEnabled() {
  if (readString('daftarche-sound') === '0') return false;
  return readString(STORAGE_KEYS.re7Music) !== '0';
}

export function setRe7MusicEnabled(enabled) {
  safeSet(STORAGE_KEYS.re7Music, enabled ? '1' : '0');
  return Boolean(enabled);
}

/**
 * Returns Found-Footage VHS Camcorder Viewfinder markup for #focusZenOverlay.
 */
export function renderRe7ZenViewfinderMarkup() {
  return `
    <span class="re7-vf-corner is-ts" aria-hidden="true"></span>
    <span class="re7-vf-corner is-te" aria-hidden="true"></span>
    <span class="re7-vf-corner is-bs" aria-hidden="true"></span>
    <span class="re7-vf-corner is-be" aria-hidden="true"></span>
    <div class="re7-zen-vhs">
      <span class="re7-rec-dot"></span>
      <span>REC ● VHS // SP</span>
    </div>
    <div class="re7-zen-tape-id">DULVEY EST. · CAM-03</div>
    <div class="re7-zen-foot">PLAY ▶ BATT [████░]</div>`;
}

/* ── Shared Session Web Audio SFX + RE7 Save Room Music (Zero Lag / Pooled Ctx) ── */
let sharedAudioCtx = null;
let cachedNoiseBuf = null;
let saveRoomTimer = null;
let saveRoomOut = null;
let saveRoomPadOsc = null;
let saveRoomStep = 0;

function getSharedAudioCtx() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function getTapeNoiseBuffer(ctx) {
  if (cachedNoiseBuf && cachedNoiseBuf.sampleRate === ctx.sampleRate) return cachedNoiseBuf;
  const sampleRate = ctx.sampleRate || 44100;
  const len = Math.floor(sampleRate * 0.28);
  const buf = ctx.createBuffer(1, len, sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  cachedNoiseBuf = buf;
  return buf;
}

// Haunting F#m -> D -> A -> E @ ~76 BPM Save Room Celesta pattern (frequencies in Hz)
const SAVE_ROOM_CHORDS = [
  { bass: 92.50, notes: [185.00, 220.00, 277.18, 369.99, 277.18, 220.00] }, // F#m
  { bass: 73.42, notes: [146.83, 220.00, 293.66, 369.99, 293.66, 220.00] }, // Dmaj7 color
  { bass: 110.00, notes: [220.00, 277.18, 329.63, 440.00, 329.63, 277.18] }, // A
  { bass: 82.41, notes: [164.81, 207.65, 246.94, 329.63, 246.94, 207.65] }, // E
];

export function isSaveRoomMusicRunning() {
  return Boolean(saveRoomTimer);
}

export function stopSaveRoomMusic() {
  clearInterval(saveRoomTimer);
  saveRoomTimer = null;
  if (saveRoomPadOsc) {
    try { saveRoomPadOsc.stop(); } catch { /* ignore */ }
    saveRoomPadOsc = null;
  }
  if (saveRoomOut && sharedAudioCtx) {
    try {
      const t = sharedAudioCtx.currentTime;
      saveRoomOut.gain.cancelScheduledValues(t);
      saveRoomOut.gain.setTargetAtTime(0, t, 0.12);
    } catch { /* ignore */ }
    const oldOut = saveRoomOut;
    saveRoomOut = null;
    setTimeout(() => { try { oldOut.disconnect(); } catch { /* ignore */ } }, 280);
  } else {
    saveRoomOut = null;
  }
}

export function startSaveRoomMusic() {
  try {
    if (!isRe7MusicEnabled() || saveRoomTimer) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.24, ctx.currentTime + 1.4);
    out.connect(ctx.destination);
    saveRoomOut = out;

    // Gentle low Louisiana marsh pad oscillator (reused across measures — 1 node total)
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 340;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.11;
    const pad = ctx.createOscillator();
    pad.type = 'triangle';
    pad.frequency.value = SAVE_ROOM_CHORDS[0].bass;
    pad.connect(padFilter).connect(padGain).connect(out);
    pad.start(ctx.currentTime);
    saveRoomPadOsc = pad;

    const stepSec = 60 / 76 / 2; // 8th-note grid (~0.394s)
    let nextTime = ctx.currentTime + 0.08;

    const tickMusic = () => {
      if (!saveRoomOut || !sharedAudioCtx || sharedAudioCtx.state !== 'running') return;
      while (nextTime < sharedAudioCtx.currentTime + 0.9) {
        const barIdx = Math.floor(saveRoomStep / 6) % SAVE_ROOM_CHORDS.length;
        const stepInBar = saveRoomStep % 6;
        const chord = SAVE_ROOM_CHORDS[barIdx];

        if (stepInBar === 0 && saveRoomPadOsc) {
          saveRoomPadOsc.frequency.setTargetAtTime(chord.bass, nextTime, 0.18);
        }

        // Delicate Celesta / Music-Box chime
        const freq = chord.notes[stepInBar];
        const osc = sharedAudioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, nextTime);
        const ng = sharedAudioCtx.createGain();
        ng.gain.setValueAtTime(0.0001, nextTime);
        ng.gain.linearRampToValueAtTime(stepInBar === 0 ? 0.15 : 0.095, nextTime + 0.018);
        ng.gain.exponentialRampToValueAtTime(0.0001, nextTime + 1.45);
        osc.connect(ng).connect(saveRoomOut);
        osc.start(nextTime);
        osc.stop(nextTime + 1.5);

        saveRoomStep += 1;
        nextTime += stepSec;
      }
    };

    tickMusic();
    saveRoomTimer = setInterval(tickMusic, 650);
    return true;
  } catch {
    return false;
  }
}

/**
 * Short analog/metallic survival-horror menu click when RE7 audio is enabled.
 */
export function playRe7MenuTick() {
  try {
    if (isRe7AudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.018);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.025);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classic rotary Save Room telephone double-ring sound when calling Zoe.
 */
export function playPhoneRingSound() {
  try {
    if (isRe7AudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    [0, 0.24].forEach(offset => {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      o1.type = 'sine';
      o2.type = 'triangle';
      o1.frequency.setValueAtTime(440, now + offset);
      o2.frequency.setValueAtTime(480, now + offset);
      g.gain.setValueAtTime(0.001, now + offset);
      g.gain.linearRampToValueAtTime(0.11, now + offset + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.16);
      o1.connect(g);
      o2.connect(g);
      g.connect(ctx.destination);
      o1.start(now + offset);
      o2.start(now + offset);
      o1.stop(now + offset + 0.18);
      o2.stop(now + offset + 0.18);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Crisp brief paper-page rustle when opening/switching lore FILES.
 */
export function playPaperFlipSound() {
  try {
    if (isRe7AudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getTapeNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1750, now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    src.connect(hp).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.07);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mechanical cassette clack + brief analog tape whir when saving progress.
 */
export function playCassetteSound() {
  try {
    if (isRe7AudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;

    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(760, now);
    clickOsc.frequency.exponentialRampToValueAtTime(140, now + 0.038);
    clickGain.gain.setValueAtTime(0.24, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    clickOsc.connect(clickGain).connect(ctx.destination);
    clickOsc.start(now);
    clickOsc.stop(now + 0.05);

    const noise = ctx.createBufferSource();
    noise.buffer = getTapeNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, now + 0.04);
    filter.Q.setValueAtTime(1.8, now + 0.04);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.09, now + 0.04);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now + 0.04);

    return true;
  } catch {
    return false;
  }
}

/* ── Live UI Lifecycle & Interactive Baker Save Room Architecture ── */
let worldAbort = null;
let recPulseTimer = null;
let phoneOpen = false;
let activeModalTab = 'tapes';

function readTapes() {
  return normalizeRe7Tapes(readString(STORAGE_KEYS.re7Tapes) || '[]');
}

function writeTapes(list) {
  const clean = normalizeRe7Tapes(list);
  safeSet(STORAGE_KEYS.re7Tapes, JSON.stringify(clean));
  return clean;
}

function todayFocusMinutes(todayKeyStr) {
  const fromHistory = getHistory()
    .filter(r => r && Number.isFinite(Number(r.endedAt)) && dayKey(new Date(Number(r.endedAt))) === todayKeyStr)
    .reduce((sum, r) => sum + (Number(r.actualDurationMin) || 0), 0);
  let fromLedger = 0;
  try {
    const led = readLedger();
    fromLedger = Number(led?.days?.[todayKeyStr]?.focusMin) || 0;
  } catch { /* ignore */ }
  return Math.max(Math.round(fromHistory), Math.round(fromLedger));
}

function liveTodayMetrics() {
  const todayKeyStr = dayKey(new Date());
  const pending = todayPending();
  const done = todayDone();
  let overdueCount = 0;
  let urgentCount = 0;
  for (const t of pending) {
    if (typeof t.dueDate === 'string' && t.dueDate && t.dueDate < todayKeyStr) overdueCount += 1;
    if (t.p === 'high') urgentCount += 1;
  }
  return {
    todayKeyStr,
    pendingCount: pending.length,
    doneCount: done.length,
    overdueCount,
    urgentCount,
    focusMin: todayFocusMinutes(todayKeyStr),
  };
}

function syncActivePageAttr() {
  if (typeof document === 'undefined') return;
  const activePage = document.querySelector('.page.active');
  const pageKey = (activePage ? activePage.id.replace(/^page-/, '') : 'today') || 'today';
  if (document.documentElement.dataset.re7Page !== pageKey) {
    document.documentElement.dataset.re7Page = pageKey;
  }
}

function mountBackdropScene(perfMode) {
  if (typeof document === 'undefined' || !document.body || $('#re7BackdropRoot')) return;
  const wrap = document.createElement('div');
  wrap.id = 're7BackdropRoot';
  wrap.setAttribute('aria-hidden', 'true');
  const grungeLayer = perfMode === 'full' ? '<div class="re7-grunge-layer"></div>' : '';
  wrap.innerHTML = `<div class="re7-bg-layer"></div><div class="re7-scrim-layer"></div>${grungeLayer}`;
  document.body.prepend(wrap);
  syncActivePageAttr();
}

function mountZenViewfinder() {
  const zen = $('#focusZenOverlay');
  if (!zen || $('#re7ZenHud')) return;
  const hud = document.createElement('div');
  hud.id = 're7ZenHud';
  hud.className = 're7-zen-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML = renderRe7ZenViewfinderMarkup();
  zen.appendChild(hud);
}

function triggerRecorderPulse() {
  const deck = $('.re7-deck-panel');
  if (!deck) return;
  deck.classList.add('is-recording');
  clearTimeout(recPulseTimer);
  recPulseTimer = setTimeout(() => {
    deck.classList.remove('is-recording');
  }, 1800);
}

function renderFilesPanel(overlay, m, tapes) {
  const filesEl = overlay.querySelector('#re7FilesList');
  if (!filesEl) return;
  const files = computeUnlockedRe7Files({
    tapesCount: tapes.length,
    doneCount: m.doneCount,
    focusMin: m.focusMin,
    pendingCount: m.pendingCount,
  });
  const unlockedNum = files.filter(f => f.unlocked).length;
  const countBadge = overlay.querySelector('#re7FilesCountBadge');
  if (countBadge) countBadge.textContent = `${faNum(unlockedNum)} از ${faNum(files.length)} پرونده باز شده`;

  filesEl.innerHTML = files.map(f => {
    if (!f.unlocked) {
      return `
        <li class="re7-file-card is-locked" data-file-id="${esc(f.id)}">
          <div class="re7-file-head">
            <span class="re7-file-code">${esc(f.code)} · قفل‌شده</span>
          </div>
          <strong class="re7-file-title">${esc(f.title)}</strong>
          <p class="re7-file-hint">${esc(f.unlockHint)}</p>
        </li>`;
    }
    return `
      <li class="re7-file-card is-open" data-file-id="${esc(f.id)}">
        <div class="re7-file-head">
          <span class="re7-file-code">${esc(f.code)} · DULVEY ARCHIVE</span>
          <span class="re7-file-author">${esc(f.author)}</span>
        </div>
        <strong class="re7-file-title">${esc(f.title)}</strong>
        <p class="re7-file-body">${esc(f.body)}</p>
      </li>`;
  }).join('');
}

function renderTapeModalBody() {
  const overlay = $('#re7TapeOverlay');
  if (!overlay) return;
  const snapEl = overlay.querySelector('#re7SnapSummary');
  const listEl = overlay.querySelector('#re7TapesList');
  const tapesPanel = overlay.querySelector('#re7TabTapesPanel');
  const filesPanel = overlay.querySelector('#re7TabFilesPanel');

  overlay.querySelectorAll('[data-re7-tab]').forEach(btn => {
    const isSel = btn.dataset.re7Tab === activeModalTab;
    btn.classList.toggle('is-active', isSel);
    btn.setAttribute('aria-selected', String(isSel));
  });
  if (tapesPanel) tapesPanel.hidden = activeModalTab !== 'tapes';
  if (filesPanel) filesPanel.hidden = activeModalTab !== 'files';

  const m = liveTodayMetrics();
  if (snapEl) {
    snapEl.innerHTML = `<span>وضعیت فعلی اتاق سیو</span><strong>${esc(formatRe7TapeMeta(m))}</strong>`;
  }

  const tapes = readTapes();
  renderFilesPanel(overlay, m, tapes);

  if (!listEl) return;
  if (!tapes.length) {
    listEl.innerHTML = '<li class="re7-empty-tapes">هنوز نواری ضبط نشده است. اولین نوار کاست را ثبت کن.</li>';
    return;
  }

  listEl.innerHTML = tapes.map((tape, idx) => {
    const slotNum = String(idx + 1).padStart(2, '0');
    const noteHtml = tape.note ? `<p class="re7-tape-note">«${esc(tape.note)}»</p>` : '';
    return `
      <li class="re7-tape-item" data-tape-id="${esc(tape.id)}">
        <div class="re7-tape-top">
          <span class="re7-tape-slot">TAPE ${slotNum} — عمارت بیکر</span>
          <div>
            <span class="re7-tape-date">${esc(tape.jalaliDate)}${tape.clock ? ` · ${esc(tape.clock)}` : ''}</span>
            <button type="button" class="re7-tape-del" data-re7-del="${esc(tape.id)}" aria-label="حذف نوار">×</button>
          </div>
        </div>
        <div class="re7-tape-meta">${esc(formatRe7TapeMeta(tape))}</div>
        ${noteHtml}
      </li>`;
  }).join('');
}

function closeTapeModal() {
  const ov = $('#re7TapeOverlay');
  if (ov) ov.hidden = true;
}

function openTapeModal({ tab = 'tapes', focusNote = true } = {}) {
  if (typeof document === 'undefined') return;
  activeModalTab = tab === 'files' ? 'files' : 'tapes';
  let overlay = $('#re7TapeOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 're7TapeOverlay';
    overlay.className = 'overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="re7-modal" role="dialog" aria-modal="true" aria-labelledby="re7ModalTitle">
        <div class="re7-modal-head">
          <div>
            <h2 id="re7ModalTitle">اتاق سیو عمارت بیکر</h2>
            <p class="re7-modal-sub">در رو قفل کن... پیشرفتت رو روی نوار ضبط کن یا پرونده‌ها رو بخون.</p>
          </div>
          <button type="button" class="r-icon" id="re7ModalClose" aria-label="بستن">
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="re7-modal-tabs" role="tablist" aria-label="بخش‌های اتاق سیو">
          <button type="button" class="re7-tab-btn is-active" data-re7-tab="tapes" role="tab" aria-selected="true">TAPES · نوارهای کاست</button>
          <button type="button" class="re7-tab-btn" data-re7-tab="files" role="tab" aria-selected="false">FILES · پرونده‌های عمارت</button>
        </div>
        <div class="re7-snap-box" id="re7SnapSummary"></div>
        <div id="re7TabTapesPanel">
          <form class="re7-rec-form" id="re7RecForm" autocomplete="off">
            <input type="text" id="re7TapeNoteInput" class="re7-note-input" maxlength="${MAX_RE7_TAPE_NOTE}" placeholder="یادداشت کوتاه روی نوار کاست (اختیاری)..." aria-label="یادداشت روی نوار کاست">
            <button type="submit" class="re7-rec-submit">ضبط پیشرفت روی نوار (REC ●)</button>
          </form>
          <ul class="re7-tapes-list" id="re7TapesList"></ul>
        </div>
        <div id="re7TabFilesPanel" hidden>
          <div class="re7-files-meta" id="re7FilesCountBadge"></div>
          <ul class="re7-files-list" id="re7FilesList"></ul>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const signal = worldAbort?.signal;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('#re7ModalClose')) {
        playRe7MenuTick();
        closeTapeModal();
        return;
      }
      const tabBtn = e.target.closest('[data-re7-tab]');
      if (tabBtn?.dataset.re7Tab) {
        activeModalTab = tabBtn.dataset.re7Tab;
        if (activeModalTab === 'files') playPaperFlipSound();
        else playRe7MenuTick();
        renderTapeModalBody();
        return;
      }
      const delBtn = e.target.closest('[data-re7-del]');
      if (delBtn?.dataset.re7Del) {
        playRe7MenuTick();
        const next = readTapes().filter(t => t.id !== delBtn.dataset.re7Del);
        writeTapes(next);
        renderTapeModalBody();
        window.dispatchEvent(new CustomEvent('re7-tapes-changed'));
      }
    }, { signal });

    overlay.querySelector('#re7RecForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const input = overlay.querySelector('#re7TapeNoteInput');
      const now = new Date();
      const todayKeyStr = dayKey(now);
      const clock = `${faNum(String(now.getHours()).padStart(2, '0'))}:${faNum(String(now.getMinutes()).padStart(2, '0'))}`;
      const newTape = {
        id: `tape-${nextId()}`,
        createdAt: now.getTime(),
        jalaliDate: formatJalaliDate(now),
        clock,
        doneCount: todayDone().length,
        focusMin: todayFocusMinutes(todayKeyStr),
        note: input?.value || '',
      };
      writeTapes(appendRe7Tape(readTapes(), newTape));
      playCassetteSound();
      haptic('done');
      triggerRecorderPulse();
      if (input) input.value = '';
      renderTapeModalBody();
      window.dispatchEvent(new CustomEvent('re7-tapes-changed'));
    }, { signal });
  }

  renderTapeModalBody();
  overlay.hidden = false;
  if (activeModalTab === 'tapes' && focusNote) overlay.querySelector('#re7TapeNoteInput')?.focus();
}

function renderRe7Card() {
  const m = liveTodayMetrics();
  const recovery = computeSaveRoomRecovery(m);
  const dlg = selectBakerDialogue(m);
  const tapes = readTapes();
  const files = computeUnlockedRe7Files({
    tapesCount: tapes.length,
    doneCount: m.doneCount,
    focusMin: m.focusMin,
    pendingCount: m.pendingCount,
  });
  const unlockedFilesCount = files.filter(f => f.unlocked).length;

  const sfxMuted = readString(STORAGE_KEYS.re7SfxMuted) === '1';
  const musicOn = readString(STORAGE_KEYS.re7Music) !== '0';

  const speakerIcon = sfxMuted
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>';

  const musicIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

  return `
    <div class="re7-card-head">
      <div class="wc-head">
        <span class="wc-ico">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="7.5" cy="12" r="2"/><circle cx="16.5" cy="12" r="2"/><path d="M9.5 12h5"/></svg>
        </span>
        <div>
          <h2 class="wc-title">اتاق سیو عمارت بیکر</h2>
          <p class="re7-card-whisper is-${dlg.tone}">${esc(dlg.quote)}</p>
        </div>
      </div>
      <div class="re7-audio-controls">
        <button type="button" class="re7-mute-btn re7-music-btn${musicOn ? ' is-playing' : ' is-muted'}" id="re7MusicBtn" data-re7="toggle-music" aria-pressed="${musicOn}" title="آهنگ اتاق سیو RE7">
          ${musicIcon}
          <span>${musicOn ? '♪ BGM ON' : '♪ BGM OFF'}</span>
        </button>
        <button type="button" class="re7-mute-btn${sfxMuted ? ' is-muted' : ''}" id="re7MuteBtn" data-re7="toggle-sfx" aria-pressed="${sfxMuted}" title="صدای افکت‌های اتاق سیو">
          ${speakerIcon}
          <span>${sfxMuted ? 'SFX OFF' : 'SFX ON'}</span>
        </button>
      </div>
    </div>
    <div class="re7-hud-grid">
      <div class="re7-deck-panel">
        <div class="re7-deck-top">
          <div class="re7-prop-stage is-recorder">
            <img class="re7-prop-img re7-prop-recorder" src="${RE7_ASSETS.recorderProp}" alt="ضبط‌صوت اتاق سیو بیکر" width="420" height="336" loading="lazy" decoding="async">
          </div>
          <div class="re7-deck-meta">
            <span class="re7-deck-tag">SAVE ROOM // ${tapes.length ? `${faNum(tapes.length)}/${faNum(MAX_RE7_TAPES)}` : '۰'} نوار</span>
            <span class="re7-tape-count">${faNum(unlockedFilesCount)} از ${faNum(files.length)} پروندهٔ عمارت باز شده</span>
          </div>
        </div>
        <div class="re7-deck-actions">
          <button type="button" class="re7-tape-btn" data-re7="open-tape">ضبط پیشرفت روی نوار (REC ●)</button>
          <button type="button" class="re7-tape-btn is-ghost" data-re7="open-tapes">نوارهای ذخیره‌شده</button>
          <button type="button" class="re7-tape-btn is-ghost" data-re7="open-files">پرونده‌ها (FILES)</button>
        </div>
      </div>
      <div class="re7-side-stack">
        <div class="re7-med-panel is-${recovery.level}" style="--re7-heal:${recovery.recoveryPct}%" role="status" aria-live="polite">
          <div class="re7-med-head">
            <span class="re7-med-title">FIRST AID MED</span>
            <span class="re7-med-badge">${recovery.badge} · ${faNum(recovery.recoveryPct)}٪</span>
          </div>
          <div class="re7-med-body">
            <div class="re7-prop-stage is-med">
              <img class="re7-prop-img re7-prop-med" src="${RE7_ASSETS.medProp}" alt="بطری کمک‌های اولیه عمارت بیکر" width="420" height="336" loading="lazy" decoding="async">
            </div>
            <div class="re7-med-info">
              <div class="re7-med-track" aria-hidden="true"><i class="re7-med-fill" style="width:${recovery.recoveryPct}%"></i></div>
              <p class="re7-med-status">${esc(recovery.statusText)}</p>
            </div>
          </div>
        </div>
        <div class="re7-phone-panel${phoneOpen ? ' is-open' : ''}">
          <div class="re7-phone-row">
            <div class="re7-prop-stage is-phone">
              <img class="re7-prop-img re7-prop-phone" src="${RE7_ASSETS.phoneProp}" alt="تلفن اتاق سیو زوئی" width="340" height="239" loading="lazy" decoding="async">
            </div>
            <div class="re7-phone-copy">
              <span class="re7-med-title">ZOE LINE // اتاق سیو</span>
              <button type="button" class="re7-phone-btn" id="re7PhoneBtn" data-re7="ring-zoe">
                <span>${phoneOpen ? '☎ بستن خط تلفن' : '☎ پاسخ به زنگ تلفن زوئی'}</span>
              </button>
            </div>
          </div>
          <p class="re7-phone-bubble" id="re7PhoneBubble"${phoneOpen ? '' : ' hidden'}>${esc(dlg.phoneMsg)}</p>
        </div>
      </div>
    </div>`;
}

function activateRe7World() {
  if (typeof document === 'undefined') return;
  if (worldAbort) worldAbort.abort();
  worldAbort = new AbortController();
  const signal = worldAbort.signal;

  const perfMode = resolveRe7PerfMode();
  document.documentElement.dataset.re7Perf = perfMode;

  mountBackdropScene(perfMode);
  mountZenViewfinder();

  if (typeof MutationObserver === 'function') {
    const pageObserver = new MutationObserver(syncActivePageAttr);
    document.querySelectorAll('.page').forEach(p => {
      pageObserver.observe(p, { attributes: true, attributeFilter: ['class'] });
    });
    signal.addEventListener('abort', () => pageObserver.disconnect(), { once: true });
  }

  window.addEventListener('hashchange', syncActivePageAttr, { signal, passive: true });
  window.addEventListener('popstate', syncActivePageAttr, { signal, passive: true });

  // Start Save Room Music automatically on activation; if browser blocks before gesture, arm one unlock listener
  if (isRe7MusicEnabled()) {
    startSaveRoomMusic();
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      const resumeOnGesture = () => {
        if (isRe7MusicEnabled()) {
          sharedAudioCtx?.resume().then(() => {
            if (!saveRoomTimer) startSaveRoomMusic();
          }).catch(() => {});
        }
      };
      document.addEventListener('pointerdown', resumeOnGesture, { once: true, signal, passive: true });
      document.addEventListener('keydown', resumeOnGesture, { once: true, signal, passive: true });
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSaveRoomMusic();
    else if (isRe7MusicEnabled()) startSaveRoomMusic();
  }, { signal });

  $('#worldCard')?.addEventListener('click', e => {
    const act = e.target.closest('[data-re7]')?.dataset.re7;
    if (!act) return;
    if (act === 'toggle-music') {
      const nextOn = !isRe7MusicEnabled();
      setRe7MusicEnabled(nextOn);
      if (nextOn) startSaveRoomMusic();
      else stopSaveRoomMusic();
      playRe7MenuTick();
      window.dispatchEvent(new CustomEvent('re7-tapes-changed'));
      return;
    }
    if (act === 'toggle-sfx') {
      const nextMuted = !(readString(STORAGE_KEYS.re7SfxMuted) === '1');
      setRe7AudioMuted(nextMuted);
      if (!nextMuted) playRe7MenuTick();
      window.dispatchEvent(new CustomEvent('re7-tapes-changed'));
      return;
    }
    if (act === 'ring-zoe') {
      phoneOpen = !phoneOpen;
      if (phoneOpen) playPhoneRingSound();
      else playRe7MenuTick();
      window.dispatchEvent(new CustomEvent('re7-tapes-changed'));
      return;
    }
    if (act === 'open-files') {
      playPaperFlipSound();
      openTapeModal({ tab: 'files', focusNote: false });
      return;
    }
    playRe7MenuTick();
    if (act === 'open-tape') openTapeModal({ tab: 'tapes', focusNote: true });
    else if (act === 'open-tapes') openTapeModal({ tab: 'tapes', focusNote: false });
  }, { signal });

  $('#bottomNav')?.addEventListener('click', e => {
    if (e.target.closest('.nav-tab')) playRe7MenuTick();
  }, { signal });
  $('#sideRail')?.addEventListener('click', e => {
    if (e.target.closest('.nav-tab')) playRe7MenuTick();
  }, { signal });

  document.addEventListener('keydown', e => {
    const ov = $('#re7TapeOverlay');
    if (e.key === 'Escape' && ov && !ov.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closeTapeModal();
    }
  }, { signal });
}

function deactivateRe7World() {
  phoneOpen = false;
  activeModalTab = 'tapes';
  clearTimeout(recPulseTimer);
  recPulseTimer = null;
  stopSaveRoomMusic();
  if (worldAbort) {
    worldAbort.abort();
    worldAbort = null;
  }
  cachedNoiseBuf = null;
  if (sharedAudioCtx) {
    try { sharedAudioCtx.close(); } catch { /* ignore */ }
    sharedAudioCtx = null;
  }
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.re7Page;
    delete document.documentElement.dataset.re7Perf;
    $('#re7TapeOverlay')?.remove();
    $('#re7ZenHud')?.remove();
    $('#re7BackdropRoot')?.remove();
  }
}

export const re7WorldPlugin = {
  id: RE7_WORLD_ID,
  onActivate: activateRe7World,
  onDeactivate: deactivateRe7World,
  renderCard: renderRe7Card,
};
