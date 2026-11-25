/* ═══ World 1 Tests: Resident Evil 7: Biohazard — Baker Estate (Immersive + Perf) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './_env.mjs';

import { THEMES, FUN_THEMES, PICKER_THEMES, STORAGE_KEYS, normalizeTheme, modeOf } from '../js/constants.js';
import { isThemeUnlocked, totalThemesCount, unlockedThemesCount } from '../js/theme.js';
import { isBackupKey } from '../js/backup.js';
import { onWorldActivate, onWorldDeactivate, getRegisteredWorldPlugins } from '../js/worlds.js';
import {
  RE7_WORLD_ID,
  RE7_ASSETS,
  MAX_RE7_TAPES,
  MAX_RE7_TAPE_NOTE,
  resolveRe7PerfMode,
  computeSaveRoomRecovery,
  selectBakerDialogue,
  computeUnlockedRe7Files,
  normalizeRe7Tapes,
  appendRe7Tape,
  formatRe7TapeMeta,
  renderRe7ZenViewfinderMarkup,
  setRe7AudioMuted,
  isRe7AudioMuted,
  isRe7MusicEnabled,
  setRe7MusicEnabled,
  isSaveRoomMusicRunning,
} from '../js/world-re7.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('re7-baker is registered under fun category without altering standard theme/world totals', () => {
  const re7 = THEMES.find(t => t.key === 're7-baker');
  assert.ok(re7, 're7-baker must be registered in THEMES');
  assert.equal(re7.family, 'fun');
  assert.equal(re7.mode, 'dark');
  assert.equal(re7.palette, 'rebaker');
  assert.equal(normalizeTheme('re7-baker'), 're7-baker');
  assert.equal(modeOf('re7-baker'), 'dark');

  assert.ok(FUN_THEMES.some(t => t.key === 're7-baker'), 'FUN_THEMES must contain re7-baker');
  assert.ok(!PICKER_THEMES.some(t => t.key === 're7-baker'), 'PICKER_THEMES keeps standard 17 themes');
  assert.equal(totalThemesCount(), 17);
  assert.equal(unlockedThemesCount(), 7);
  assert.equal(isThemeUnlocked('re7-baker'), true, 'fun world re7-baker must be unlocked by default');

  assert.equal(isBackupKey(STORAGE_KEYS.re7Tapes), false, 're7 tapes must stay device-local and excluded from JSON backup');
  assert.equal(isBackupKey(STORAGE_KEYS.re7SfxMuted), false, 're7 SFX mute key stays device-local');
  assert.equal(isBackupKey(STORAGE_KEYS.re7Music), false, 're7 music key stays device-local');
  assert.ok(getRegisteredWorldPlugins().includes('re7-baker'));
});

test('all 8 optimized .webp assets exist in assets/worlds/re7/ within tight mobile budgets and are in sw.js SHELL', () => {
  const re7Dir = path.join(ROOT, 'assets', 'worlds', 're7');
  const files = fs.readdirSync(re7Dir);
  assert.equal(files.length, 8, 'assets/worlds/re7/ should contain exactly the 8 optimized ASCII .webp assets');
  for (const f of files) {
    assert.ok(/^[a-z0-9-]+\.webp$/.test(f), `Non-ASCII or unexpected filename remains: ${f}`);
  }

  const budgetsKb = {
    [RE7_ASSETS.homeBg]: 100,
    [RE7_ASSETS.tasksBg]: 80,
    [RE7_ASSETS.focusBg]: 80,
    [RE7_ASSETS.libraryBg]: 55,
    [RE7_ASSETS.grungeTex]: 40,
    [RE7_ASSETS.recorderProp]: 50,
    [RE7_ASSETS.medProp]: 50,
    [RE7_ASSETS.phoneProp]: 30,
  };

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'css/world-re7.css'"));
  assert.ok(sw.includes("'js/world-re7.js'"));

  for (const [relPath, maxKb] of Object.entries(budgetsKb)) {
    const abs = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(abs), `Missing optimized asset: ${relPath}`);
    const kb = fs.statSync(abs).size / 1024;
    assert.ok(kb > 0 && kb <= maxKb, `${relPath} size ${kb.toFixed(1)}KB exceeds ${maxKb}KB budget`);
    assert.ok(sw.includes(`'${relPath}'`), `${relPath} must be registered in sw.js SHELL`);
  }
});

test('computeSaveRoomRecovery, selectBakerDialogue, computeUnlockedRe7Files & perf heuristics', () => {
  const idle = computeSaveRoomRecovery({ pendingCount: 3, doneCount: 0, focusMin: 0 });
  assert.equal(idle.level, 'idle');
  assert.equal(idle.recoveryPct, 0);

  const healing = computeSaveRoomRecovery({ pendingCount: 2, doneCount: 3, focusMin: 15 });
  assert.equal(healing.level, 'recovering');
  assert.equal(healing.recoveryPct, 60);

  const safe = computeSaveRoomRecovery({ pendingCount: 0, doneCount: 4, focusMin: 25 });
  assert.equal(safe.level, 'safe');
  assert.equal(safe.recoveryPct, 100);
  assert.equal(safe.badge, 'SAFE');

  // Dynamic dialogues
  const overdueDlg = selectBakerDialogue({ overdueCount: 2, urgentCount: 1, doneCount: 1 });
  assert.equal(overdueDlg.tone, 'danger');
  assert.equal(overdueDlg.speaker, 'جک بیکر');
  assert.match(overdueDlg.phoneMsg, /عقب‌افتاده/);

  const urgentDlg = selectBakerDialogue({ overdueCount: 0, urgentCount: 1, pendingCount: 1 });
  assert.equal(urgentDlg.tone, 'warning');
  assert.equal(urgentDlg.speaker, 'زوئی بیکر');

  const safeDlg = selectBakerDialogue({ pendingCount: 0, doneCount: 3 });
  assert.equal(safeDlg.tone, 'safe');

  // Unlockable FILES
  const startFiles = computeUnlockedRe7Files({});
  assert.equal(startFiles.length, 5);
  assert.equal(startFiles.filter(f => f.unlocked).length, 1);

  const fullFiles = computeUnlockedRe7Files({ tapesCount: 1, doneCount: 3, focusMin: 25, pendingCount: 0 });
  assert.equal(fullFiles.filter(f => f.unlocked).length, 5);

  // Weak device heuristics
  assert.equal(resolveRe7PerfMode({ hardwareConcurrency: 4, deviceMemory: 8, saveData: false, reducedMotion: false }), 'lite');
  assert.equal(resolveRe7PerfMode({ hardwareConcurrency: 8, deviceMemory: 2, saveData: false, reducedMotion: false }), 'lite');
  assert.equal(resolveRe7PerfMode({ hardwareConcurrency: 8, deviceMemory: 8, saveData: false, reducedMotion: false }), 'full');

  // Music defaults ON unless explicitly disabled
  assert.equal(isRe7MusicEnabled(), true);
  setRe7MusicEnabled(false);
  assert.equal(isRe7MusicEnabled(), false);
  setRe7MusicEnabled(true);
  assert.equal(isRe7MusicEnabled(), true);

  const re7Src = fs.readFileSync(path.join(ROOT, 'js', 'world-re7.js'), 'utf8');
  assert.equal(/\bcodex\b/i.test(re7Src), false, 'world-re7.js must not contain Codex/watch logic');
  assert.ok(re7Src.includes('getSharedAudioCtx'), 'AudioContext must be pooled/shared');
});

test('normalizeRe7Tapes & appendRe7Tape enforce 5-tape ring buffer, clamping, and defensive parsing', () => {
  assert.deepEqual(normalizeRe7Tapes(null), []);
  assert.deepEqual(normalizeRe7Tapes('{not-json'), []);
  assert.deepEqual(normalizeRe7Tapes('{"not":"array"}'), []);

  let tapes = [];
  for (let i = 1; i <= 7; i++) {
    tapes = appendRe7Tape(tapes, {
      id: `tape-${i}`,
      createdAt: 1000 + i,
      jalaliDate: '۴ آذر ۱۴۰۵',
      clock: '۲۱:۱۰',
      doneCount: i,
      focusMin: i * 10,
      note: 'ن'.repeat(MAX_RE7_TAPE_NOTE + 20),
    });
  }
  assert.equal(tapes.length, MAX_RE7_TAPES, 'ring buffer capped at 5 tapes');
  assert.equal(tapes[0].id, 'tape-7', 'newest tape stays first');
  assert.equal(tapes[4].id, 'tape-3', 'oldest entries beyond 5 are evicted');
  assert.equal(tapes[0].note.length, MAX_RE7_TAPE_NOTE);

  const meta = formatRe7TapeMeta(tapes[0]);
  assert.match(meta, /کار انجام‌شده/);
  assert.match(meta, /دقیقه تمرکز/);
});

test('world-re7 lifecycle hooks mount cleanly and tear down on deactivate without leaks', () => {
  assert.doesNotThrow(() => {
    onWorldActivate(RE7_WORLD_ID);
    onWorldDeactivate(RE7_WORLD_ID);
  });
  assert.equal(isSaveRoomMusicRunning(), false, 'Save Room music timer must clear on deactivate');
});

test('css/world-re7.css eliminates blend/mask/has/filter bottlenecks and obeys GPU limits', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'world-re7.css'), 'utf8');
  assert.ok(css.includes('html[data-world="re7-baker"]'), 'styles must be scoped to html[data-world="re7-baker"]');
  assert.ok(css.includes('prefers-reduced-motion'), 'must respect prefers-reduced-motion');
  assert.ok(css.includes('html[data-motion="reduced"]'), 'must respect in-app reduced motion');
  assert.ok(css.includes('html[data-re7-perf="lite"]'), 'must provide lite mode for low-end devices');
  assert.ok(css.includes('html.tab-hidden'), 'must pause animations when tab is hidden');
  assert.ok(css.includes('contain:strict'), 'fixed backdrop root must isolate paint/layout via contain:strict');

  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'css/world-re7.css must not embed raw hex colors');
  assert.equal(/mix-blend-mode/i.test(css), false, 'must not trigger fullscreen framebuffer readback via mix-blend-mode');
  assert.equal(/:has\(/i.test(css), false, 'must avoid :has() DOM invalidation overhead');
  assert.equal(/drop-shadow|mask-image/i.test(css), false, 'must avoid expensive GPU drop-shadow/mask shader passes');
  assert.equal(/codex|ecg/i.test(css), false, 'css/world-re7.css must not include Codex watch styles');

  assert.ok(css.includes('bg-home.webp'));
  assert.ok(css.includes('bg-tasks.webp'));
  assert.ok(css.includes('bg-focus.webp'));
  assert.ok(css.includes('bg-library.webp'));
  assert.ok(css.includes('.confirm-card'));
  assert.ok(css.includes('.re7-phone-panel'));
  assert.ok(css.includes('.re7-file-card'));
  assert.ok(css.includes('.re7-zen-hud') && css.includes('.re7-vf-corner'));
  assert.ok(css.includes('.nav-tab.active'));

  const blurMatches = css.match(/blur\((\d+)px\)/g) || [];
  for (const m of blurMatches) {
    const val = parseInt(m.replace(/[^\d]/g, ''), 10);
    assert.ok(val <= 10, `Backdrop blur ${m} exceeds 10px limit`);
  }

  const zenHud = renderRe7ZenViewfinderMarkup();
  assert.ok(zenHud.includes('REC') && zenHud.includes('VHS // SP') && zenHud.includes('re7-vf-corner'));

  setRe7AudioMuted(true);
  assert.equal(isRe7AudioMuted(), true);
  setRe7AudioMuted(false);
  assert.equal(isRe7AudioMuted(), false);
});
