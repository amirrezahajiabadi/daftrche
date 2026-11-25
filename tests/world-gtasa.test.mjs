/* ═══ World 2 Tests: GTA: San Andreas — Grove Street ═══ */
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
  GTASA_WORLD_ID,
  calcGtasaHudStats,
  shouldTriggerMissionPassed,
  setGtasaAudioMuted,
  isGtasaAudioMuted,
  loadGtasaSavesCount,
  incrementGtasaSavesCount,
} from '../js/world-gtasa.js';
import {
  renderGtasaHomeBackdropSvg,
  renderGtasaTasksBackdropSvg,
  renderGtasaBeachZenSvg,
  renderGtasaFloppyDiskSvg,
  renderGtasaZenHudMarkup,
} from '../js/world-gtasa-art.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('gtasa-grove is temporarily hidden while staying cleanly wired without altering standard totals', () => {
  const gtasa = THEMES.find(t => t.key === 'gtasa-grove');
  assert.ok(gtasa, 'gtasa-grove must be registered in THEMES');
  assert.equal(gtasa.family, 'fun');
  assert.equal(gtasa.hidden, true, 'gtasa-grove should be temporarily hidden');
  assert.equal(gtasa.mode, 'dark');
  assert.equal(gtasa.palette, 'gtasa');
  assert.equal(normalizeTheme('gtasa-grove'), 'gtasa-grove');
  assert.equal(modeOf('gtasa-grove'), 'dark');

  assert.equal(FUN_THEMES.some(t => t.key === 'gtasa-grove'), false, 'hidden gtasa-grove must stay out of visible FUN_THEMES picker');
  assert.ok(!PICKER_THEMES.some(t => t.key === 'gtasa-grove'), 'PICKER_THEMES keeps standard 17 themes');
  assert.equal(totalThemesCount(), 17);
  assert.equal(unlockedThemesCount(), 7);
  assert.equal(isThemeUnlocked('gtasa-grove'), false, 'hidden gtasa-grove falls back safely if requested');

  assert.equal(isBackupKey(STORAGE_KEYS.gtasaSaves), false, 'gtasa saves counter stays device-local');
  assert.equal(isBackupKey(STORAGE_KEYS.gtasaSfxMuted), false, 'gtasa SFX mute key stays device-local');
  assert.ok(getRegisteredWorldPlugins().includes('gtasa-grove'));
});

test('calcGtasaHudStats derives Respect %, $ formatted score, and rank accurately across 0, partial, and 100%', () => {
  const zero = calcGtasaHudStats({ pendingCount: 4, doneCount: 0, highDoneCount: 0, focusMin: 0, savesCount: 0 });
  assert.equal(zero.respectPct, 0);
  assert.equal(zero.dollars, 0);
  assert.equal(zero.dollarText, '$000000');
  assert.equal(zero.rank, 'تازه‌وارد گروو استریت');

  const partial = calcGtasaHudStats({ pendingCount: 2, doneCount: 2, highDoneCount: 1, focusMin: 25, savesCount: 1 });
  // dollars = 2*150 + 1*200 + 25*10 + 1*25 = 300 + 200 + 250 + 25 = 775
  assert.equal(partial.respectPct, 50);
  assert.equal(partial.dollars, 775);
  assert.equal(partial.dollarText, '$000775');

  const full = calcGtasaHudStats({ pendingCount: 0, doneCount: 3, highDoneCount: 1, focusMin: 30, savesCount: 2 });
  assert.equal(full.respectPct, 100);
  assert.match(full.rank, /O\.G\./);
  assert.ok(full.dollarText.startsWith('$00'));
});

test('shouldTriggerMissionPassed fires only for high-priority task or focus completion', () => {
  assert.equal(shouldTriggerMissionPassed({ focusCompleted: true }), true);
  assert.equal(shouldTriggerMissionPassed({ task: { id: '1', done: true, p: 'high' }, prevDone: false }), true);

  // Ignores already-done, undone, low/mid tasks, or deleted tasks
  assert.equal(shouldTriggerMissionPassed({ task: { id: '1', done: true, p: 'high' }, prevDone: true }), false);
  assert.equal(shouldTriggerMissionPassed({ task: { id: '2', done: true, p: 'mid' }, prevDone: false }), false);
  assert.equal(shouldTriggerMissionPassed({ task: { id: '3', done: true, p: 'low' }, prevDone: false }), false);
  assert.equal(shouldTriggerMissionPassed({ task: { id: '4', done: false, p: 'high' }, prevDone: false }), false);
  assert.equal(shouldTriggerMissionPassed({ task: { id: '5', done: true, p: 'high', deletedAt: 123 }, prevDone: false }), false);
  assert.equal(shouldTriggerMissionPassed({}), false);
});

test('world-gtasa lifecycle, saves counter, audio mute, and bespoke SVG scenes work without raw hex', () => {
  assert.doesNotThrow(() => {
    onWorldActivate(GTASA_WORLD_ID);
    onWorldDeactivate(GTASA_WORLD_ID);
  });

  const before = loadGtasaSavesCount();
  const after = incrementGtasaSavesCount();
  assert.equal(after, before + 1);

  setGtasaAudioMuted(true);
  assert.equal(isGtasaAudioMuted(), true);
  setGtasaAudioMuted(false);
  assert.equal(isGtasaAudioMuted(), false);

  const svgs = [
    renderGtasaHomeBackdropSvg(),
    renderGtasaTasksBackdropSvg(),
    renderGtasaBeachZenSvg(),
    renderGtasaFloppyDiskSvg(),
    renderGtasaZenHudMarkup(),
  ];
  for (const s of svgs) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(s), 'GTASA inline SVG must not use raw hex colors');
  }
  assert.ok(svgs[0].includes('gtasa-scene-home'));
  assert.ok(svgs[1].includes('gtasa-scene-tasks'));
  assert.ok(svgs[2].includes('gtasa-scene-beach'));
  assert.ok(svgs[3].includes('gtasa-disk-svg'));
  assert.ok(svgs[4].includes('SANTA MARIA BEACH'));
});

test('css/world-gtasa.css obeys scoping, GPU blur limits, zero raw hex, and reduced-motion rules', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'world-gtasa.css'), 'utf8');
  assert.ok(css.includes('html[data-world="gtasa-grove"]'), 'styles must be scoped to html[data-world="gtasa-grove"]');
  assert.ok(css.includes('prefers-reduced-motion'), 'must respect prefers-reduced-motion');
  assert.ok(css.includes('html[data-motion="reduced"]'), 'must respect in-app reduced motion');
  assert.ok(css.includes('.gtasa-mission-banner'), 'MISSION PASSED banner rules missing');
  assert.ok(css.includes('.nav-tab.active'), 'Grove green active nav bar missing');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'css/world-gtasa.css must not embed raw hex colors');

  const blurMatches = css.match(/blur\((\d+)px\)/g) || [];
  for (const m of blurMatches) {
    const val = parseInt(m.replace(/[^\d]/g, ''), 10);
    assert.ok(val <= 10, `Backdrop blur ${m} exceeds 10px limit`);
  }

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'css/world-gtasa.css'"));
  assert.ok(sw.includes("'js/world-gtasa-art.js'"));
  assert.ok(sw.includes("'js/world-gtasa.js'"));
});
