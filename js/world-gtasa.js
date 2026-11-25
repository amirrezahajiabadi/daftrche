/* ═══ World 2 Plugin: GTA: San Andreas — Grove Street (PS2 Game-Menu + HUD) ═══
   Pure logic exports are 100% Node-testable with zero top-level DOM side effects.
   Provides:
   - Classic San Andreas HUD Card (Respect Progress Bar, $000XXX Score Counter,
     Grove Street Safe House Floppy Disk save button, SFX mute toggle)
   - MISSION PASSED! / RESPECT + non-blocking celebration banner on high-priority
     task or focus session completion + 3-note Web Audio synth chime
   - Per-page Los Santos SVG scenes (Home Sunset, Tasks Radar Grid, Focus Beach)
   - Clean 100% zero-leak mount & teardown lifecycle */

import { $, esc, faNum, dayKey } from './utils.js';
import { STORAGE_KEYS } from './constants.js';
import { readString, safeSet } from './store.js';
import { subscribe } from './bus.js';
import { state } from './state.js';
import { todayPending, todayDone } from './today.js';
import { readLedger } from './ledger.js';
import { getHistory } from './focushistory.js';
import { showNotice } from './dialog.js';
import { haptic, prefersReducedMotion } from './motion.js';
import {
  renderGtasaHomeBackdropSvg,
  renderGtasaTasksBackdropSvg,
  renderGtasaBeachZenSvg,
  renderGtasaFloppyDiskSvg,
  renderGtasaGroveCrestSvg,
  renderGtasaZenHudMarkup,
} from './world-gtasa-art.js';

export const GTASA_WORLD_ID = 'gtasa-grove';
const BANNER_DURATION_MS = 2800;

/**
 * Computes San Andreas HUD metrics (Respect %, formatted $ score, rank, save count).
 * Zero DOM dependencies (100% pure).
 */
export function calcGtasaHudStats({
  pendingCount = 0,
  doneCount = 0,
  highDoneCount = 0,
  focusMin = 0,
  savesCount = 0,
} = {}) {
  const pending = Math.max(0, Math.round(Number(pendingCount) || 0));
  const done = Math.max(0, Math.round(Number(doneCount) || 0));
  const highDone = Math.max(0, Math.min(done, Math.round(Number(highDoneCount) || 0)));
  const focus = Math.max(0, Math.round(Number(focusMin) || 0));
  const saves = Math.max(0, Math.round(Number(savesCount) || 0));

  const total = done + pending;
  let respectPct = 0;
  if (total > 0) {
    respectPct = Math.min(100, Math.round((done / total) * 100));
  } else if (focus > 0) {
    respectPct = Math.min(100, Math.round(focus * 2));
  }

  const dollars = (done * 150) + (highDone * 200) + (focus * 10) + (saves * 25);
  const dollarText = `$${String(dollars).padStart(6, '0')}`;

  let rank = 'تازه‌وارد گروو استریت';
  if (respectPct >= 100 && (done > 0 || focus >= 25)) {
    rank = 'اسطورهٔ گروو استریت (O.G.)';
  } else if (respectPct >= 60) {
    rank = 'فرماندهٔ لوس سانتوس';
  } else if (done > 0 || focus > 0) {
    rank = 'هم‌پیمان گروو';
  }

  return {
    respectPct,
    dollars,
    dollarText,
    rank,
    doneCount: done,
    pendingCount: pending,
    highDoneCount: highDone,
    focusMin: focus,
    savesCount: saves,
  };
}

/**
 * Predicate determining whether a completion should fire the `MISSION PASSED!` banner.
 * Triggers ONLY for a newly completed high-priority task (`p === 'high'`) or a
 * completed Pomodoro/Focus session; ignores low/mid tasks and un-done toggles.
 */
export function shouldTriggerMissionPassed({ task = null, prevDone = false, focusCompleted = false } = {}) {
  if (focusCompleted) return true;
  if (!task || typeof task !== 'object' || task.deletedAt) return false;
  return Boolean(task.done) && !prevDone && task.p === 'high';
}

export function isGtasaAudioMuted() {
  return readString('daftarche-sound') === '0' || readString(STORAGE_KEYS.gtasaSfxMuted) === '1';
}

export function setGtasaAudioMuted(muted) {
  safeSet(STORAGE_KEYS.gtasaSfxMuted, muted ? '1' : '0');
  return Boolean(muted);
}

export function loadGtasaSavesCount() {
  const n = Number(readString(STORAGE_KEYS.gtasaSaves, '0'));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function incrementGtasaSavesCount() {
  const next = loadGtasaSavesCount() + 1;
  safeSet(STORAGE_KEYS.gtasaSaves, String(next));
  return next;
}

/* ── Pooled Web Audio Synth Chimes (Zero File Assets / Zero Ctx Churn) ── */
let sharedAudioCtx = null;

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

/**
 * Nostalgic 3-note San Andreas Mission Passed synth chord chime.
 */
export function playMissionPassedChime() {
  try {
    if (isGtasaAudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const notes = [
      { freq: 466.16, t: 0.00, dur: 0.22, gain: 0.14 }, // Bb4
      { freq: 587.33, t: 0.16, dur: 0.24, gain: 0.15 }, // D5
      { freq: 698.46, t: 0.34, dur: 0.72, gain: 0.17 }, // F5
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.t);
      g.gain.setValueAtTime(0.0001, now + n.t);
      g.gain.linearRampToValueAtTime(n.gain, now + n.t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.dur + 0.03);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Crisp 2-note Grove Street Safe House save-disk chime.
 */
export function playSaveDiskChime() {
  try {
    if (isGtasaAudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    [392.0, 523.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0.0001, now + i * 0.1);
      g.gain.linearRampToValueAtTime(0.13, now + i * 0.1 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.32);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.35);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Subtle PS2 menu select tick.
 */
export function playGtasaMenuTick() {
  try {
    if (isGtasaAudioMuted()) return false;
    const ctx = getSharedAudioCtx();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.025);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
    return true;
  } catch {
    return false;
  }
}

/* ── Live UI Lifecycle & San Andreas HUD Architecture ── */
let worldAbort = null;
let gtasaActive = false;
let bannerTimer = null;
let savePulseTimer = null;
let busSubscribed = false;
let prevTaskSnapshot = new Map();
let prevHistoryIds = new Set();

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

function takeStateSnapshots() {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  prevTaskSnapshot = new Map();
  for (const t of tasks) {
    if (t && t.id && !t.deletedAt) {
      prevTaskSnapshot.set(t.id, { done: Boolean(t.done), p: t.p || 'mid' });
    }
  }
  const hist = getHistory();
  prevHistoryIds = new Set(hist.filter(r => r && r.id).map(r => r.id));
}

function checkMissionCompletionDiff() {
  if (!gtasaActive || typeof document === 'undefined') return;
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  let triggeredReason = null;

  for (const t of tasks) {
    if (!t || !t.id || t.deletedAt) continue;
    const prev = prevTaskSnapshot.get(t.id);
    if (shouldTriggerMissionPassed({ task: t, prevDone: prev ? prev.done : false })) {
      triggeredReason = 'high-task';
      break;
    }
  }

  const hist = getHistory();
  if (!triggeredReason) {
    for (const r of hist) {
      if (r && r.id && !prevHistoryIds.has(r.id) && r.status === 'completed') {
        triggeredReason = 'focus';
        break;
      }
    }
  }

  takeStateSnapshots();

  if (triggeredReason === 'high-task') {
    showMissionPassedBanner('ماموریت مهم با موفقیت انجام شد — دمت گرم!');
  } else if (triggeredReason === 'focus') {
    showMissionPassedBanner('تمرکز تموم شد — احترام محله بالاتر رفت!');
  }
}

function ensureBusHook() {
  if (busSubscribed) return;
  busSubscribed = true;
  subscribe(checkMissionCompletionDiff);
}

export function showMissionPassedBanner(subtitle = 'ماموریت انجام شد — دمت گرم!') {
  if (typeof document === 'undefined' || !document.body) return;
  let banner = $('#gtasaMissionBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gtasaMissionBanner';
    banner.className = 'gtasa-mission-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner);
  }

  banner.innerHTML = `
    <div class="gtasa-mb-inner">
      <div class="gtasa-mb-title" dir="ltr">MISSION PASSED!</div>
      <div class="gtasa-mb-respect" dir="ltr">RESPECT +</div>
      <p class="gtasa-mb-sub">${esc(subtitle)}</p>
    </div>`;

  banner.hidden = false;
  banner.classList.remove('is-leaving');
  banner.classList.add('is-visible');

  playMissionPassedChime();
  haptic('done');

  clearTimeout(bannerTimer);
  const fadeMs = prefersReducedMotion() ? 2200 : BANNER_DURATION_MS;
  bannerTimer = setTimeout(() => {
    banner.classList.remove('is-visible');
    banner.classList.add('is-leaving');
    setTimeout(() => {
      if (banner && banner.parentNode) banner.hidden = true;
    }, 320);
  }, fadeMs);
}

let lastRenderedSceneKey = '';
function syncBackdropPageScene() {
  if (typeof document === 'undefined') return;
  const rootWrap = $('#gtasaBackdropRoot');
  if (!rootWrap) return;

  const activePage = document.querySelector('.page.active');
  const pageKey = (activePage ? activePage.id.replace(/^page-/, '') : 'today') || 'today';
  if (document.documentElement.dataset.gtasaPage !== pageKey) {
    document.documentElement.dataset.gtasaPage = pageKey;
  }

  const targetScene = pageKey === 'tasks' ? 'tasks' : pageKey === 'focus' ? 'focus' : 'home';
  if (targetScene !== lastRenderedSceneKey) {
    lastRenderedSceneKey = targetScene;
    const svg = targetScene === 'tasks'
      ? renderGtasaTasksBackdropSvg()
      : targetScene === 'focus'
        ? renderGtasaBeachZenSvg()
        : renderGtasaHomeBackdropSvg();
    rootWrap.innerHTML = `${svg}<div class="gtasa-scrim-layer"></div>`;
  }
}

function mountBackdropScene() {
  if (typeof document === 'undefined' || !document.body || $('#gtasaBackdropRoot')) return;
  lastRenderedSceneKey = '';
  const wrap = document.createElement('div');
  wrap.id = 'gtasaBackdropRoot';
  wrap.setAttribute('aria-hidden', 'true');
  document.body.prepend(wrap);
  syncBackdropPageScene();
}

function mountZenHud() {
  const zen = $('#focusZenOverlay');
  if (!zen || $('#gtasaZenHud')) return;
  const hud = document.createElement('div');
  hud.id = 'gtasaZenHud';
  hud.className = 'gtasa-zen-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML = renderGtasaZenHudMarkup();
  zen.prepend(hud);
}

function renderGtasaCard() {
  const todayKeyStr = dayKey(new Date());
  const pending = todayPending();
  const done = todayDone();
  const highDoneCount = done.filter(t => t && t.p === 'high').length;
  const focusMin = todayFocusMinutes(todayKeyStr);
  const savesCount = loadGtasaSavesCount();

  const stats = calcGtasaHudStats({
    pendingCount: pending.length,
    doneCount: done.length,
    highDoneCount,
    focusMin,
    savesCount,
  });

  const muted = readString(STORAGE_KEYS.gtasaSfxMuted) === '1';
  const speakerIcon = muted
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>';

  return `
    <div class="gtasa-card-head">
      <div class="wc-head">
        <span class="wc-ico">${renderGtasaGroveCrestSvg()}</span>
        <div>
          <h2 class="wc-title">گروو استریت — خونهٔ CJ</h2>
          <p class="gtasa-card-sub">${esc(stats.rank)} · لوس سانتوس</p>
        </div>
      </div>
      <div class="gtasa-hud-right">
        <span class="gtasa-cash" dir="ltr" aria-label="امتیاز دلاری">${esc(stats.dollarText)}</span>
        <button type="button" class="gtasa-mute-btn${muted ? ' is-muted' : ''}" id="gtasaMuteBtn" data-gtasa="toggle-sfx" aria-pressed="${muted}" title="صدای منو و چیم ماموریت">
          ${speakerIcon}
          <span>${muted ? 'SFX OFF' : 'SFX ON'}</span>
        </button>
      </div>
    </div>

    <div class="gtasa-hud-grid">
      <div class="gtasa-respect-panel">
        <div class="gtasa-respect-top">
          <span class="gtasa-respect-label" dir="ltr">RESPECT</span>
          <span class="gtasa-respect-val">${faNum(stats.respectPct)}٪ امروز (${faNum(stats.doneCount)} کار · ${faNum(stats.focusMin)} دقیقه)</span>
        </div>
        <div class="gtasa-respect-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.respectPct}" aria-label="احترام روزانه گروو استریت">
          <i class="gtasa-respect-fill" style="width:${stats.respectPct}%"></i>
        </div>
      </div>

      <button type="button" class="gtasa-save-btn" id="gtasaSaveBtn" data-gtasa="save">
        <span class="gtasa-disk-wrap">${renderGtasaFloppyDiskSvg()}</span>
        <span class="gtasa-save-copy">
          <strong>ذخیرهٔ بازی — خونه CJ</strong>
          <small>${savesCount ? `${faNum(savesCount)} بار ذخیره شده` : 'کلیک برای ثبت چک‌پوینت'}</small>
        </span>
      </button>
    </div>`;
}

function activateGtasaWorld() {
  if (typeof document === 'undefined') return;
  if (worldAbort) worldAbort.abort();
  worldAbort = new AbortController();
  const signal = worldAbort.signal;

  gtasaActive = true;
  ensureBusHook();
  takeStateSnapshots();
  mountBackdropScene();
  mountZenHud();

  if (typeof MutationObserver === 'function') {
    const pageObserver = new MutationObserver(syncBackdropPageScene);
    document.querySelectorAll('.page').forEach(p => {
      pageObserver.observe(p, { attributes: true, attributeFilter: ['class'] });
    });
    signal.addEventListener('abort', () => pageObserver.disconnect(), { once: true });
  }

  window.addEventListener('hashchange', syncBackdropPageScene, { signal, passive: true });
  window.addEventListener('popstate', syncBackdropPageScene, { signal, passive: true });

  $('#worldCard')?.addEventListener('click', e => {
    const act = e.target.closest('[data-gtasa]')?.dataset.gtasa;
    if (!act) return;
    if (act === 'toggle-sfx') {
      const nextMuted = !isGtasaAudioMuted();
      setGtasaAudioMuted(nextMuted);
      if (!nextMuted) playGtasaMenuTick();
      window.dispatchEvent(new CustomEvent('gtasa-hud-changed'));
      return;
    }
    if (act === 'save') {
      const nextSaves = incrementGtasaSavesCount();
      playSaveDiskChime();
      haptic('done');
      const saveBtn = $('#gtasaSaveBtn');
      if (saveBtn) {
        saveBtn.classList.add('is-saving');
        clearTimeout(savePulseTimer);
        savePulseTimer = setTimeout(() => saveBtn.classList.remove('is-saving'), 900);
      }
      showNotice(`بازی ذخیره شد — خونه CJ (چک‌پوینت ${faNum(nextSaves)})`);
      window.dispatchEvent(new CustomEvent('gtasa-hud-changed'));
    }
  }, { signal });

  $('#bottomNav')?.addEventListener('click', e => {
    if (e.target.closest('.nav-tab')) playGtasaMenuTick();
  }, { signal });
  $('#sideRail')?.addEventListener('click', e => {
    if (e.target.closest('.nav-tab')) playGtasaMenuTick();
  }, { signal });
}

function deactivateGtasaWorld() {
  gtasaActive = false;
  lastRenderedSceneKey = '';
  clearTimeout(bannerTimer);
  bannerTimer = null;
  clearTimeout(savePulseTimer);
  savePulseTimer = null;

  if (worldAbort) {
    worldAbort.abort();
    worldAbort = null;
  }
  if (sharedAudioCtx) {
    try { sharedAudioCtx.close(); } catch { /* ignore */ }
    sharedAudioCtx = null;
  }
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.gtasaPage;
    $('#gtasaMissionBanner')?.remove();
    $('#gtasaZenHud')?.remove();
    $('#gtasaBackdropRoot')?.remove();
  }
}

export const gtasaWorldPlugin = {
  id: GTASA_WORLD_ID,
  onActivate: activateGtasaWorld,
  onDeactivate: deactivateGtasaWorld,
  renderCard: renderGtasaCard,
};
