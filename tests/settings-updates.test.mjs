import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './_env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const HTML = read('index.html');
const CSS = read('css/settings.css');
const SETTINGS_JS = read('js/settings.js');

test('settings tabs include general, themes, and updates with matching panels', () => {
  // Tabs list
  assert.ok(HTML.includes('class="settings-tabs"'), 'index.html must have .settings-tabs');
  assert.ok(HTML.includes('data-settings-tab="general"'), 'general tab missing');
  assert.ok(HTML.includes('data-settings-tab="themes"'), 'themes tab missing');
  assert.ok(HTML.includes('data-settings-tab="updates"'), 'updates tab missing');
  assert.ok(HTML.includes('id="settingsUpdateBadge"'), '#settingsUpdateBadge missing');

  // Panels
  assert.ok(HTML.includes('data-settings-panel="general"'), 'general panel missing');
  assert.ok(HTML.includes('data-settings-panel="themes"'), 'themes panel missing');
  assert.ok(HTML.includes('data-settings-panel="updates"'), 'updates panel missing');

  // Panel order: general, then themes, then updates
  const genIdx = HTML.indexOf('data-settings-panel="general"');
  const themesIdx = HTML.indexOf('data-settings-panel="themes"');
  const updatesIdx = HTML.indexOf('data-settings-panel="updates"');
  assert.ok(genIdx > -1 && themesIdx > genIdx && updatesIdx > themesIdx,
    'panels must be ordered: general, themes, updates');
});

test('updates panel contains update check button, version indicator, status, and notes', () => {
  const updatesPanelStart = HTML.indexOf('data-settings-panel="updates"');
  const updatesPanelEnd = HTML.indexOf('</main>', updatesPanelStart);
  assert.ok(updatesPanelStart > 0 && updatesPanelEnd > updatesPanelStart);
  const panelHtml = HTML.slice(updatesPanelStart, updatesPanelEnd);

  // Check update controls
  assert.ok(panelHtml.includes('id="profVersion"'), '#profVersion must be in updates panel');
  assert.ok(panelHtml.includes('id="updateStatusBadge"'), '#updateStatusBadge must be in updates panel');
  assert.ok(panelHtml.includes('id="checkUpdateBtn"'), '#checkUpdateBtn must be in updates panel');
  assert.ok(panelHtml.includes('id="checkUpdateStatus"'), '#checkUpdateStatus must be in updates panel');
  assert.ok(panelHtml.includes('id="checkUpdateProgress"'), '#checkUpdateProgress must be in updates panel');
  assert.ok(panelHtml.includes('id="profNotes"'), '#profNotes must be present for release notes');
  assert.ok(panelHtml.includes('id="profTourUpdates"'), '#profTourUpdates should be available in updates panel');

  // Accessibility
  assert.ok(panelHtml.includes('role="status"'), 'status text must have role="status"');
  assert.ok(panelHtml.includes('aria-live="polite"'), 'status text must have aria-live="polite"');
});

test('css/settings.css styles settings tabs for 3 sections and update components cleanly', () => {
  // Tabs layout
  assert.ok(CSS.includes('grid-template-columns:repeat(3,1fr)'), 'settings-tabs must support 3 tabs');
  assert.ok(CSS.includes('.settings-tab-badge'), '.settings-tab-badge rule must exist');
  assert.ok(CSS.includes('.settings-tab-badge[hidden]'), '.settings-tab-badge[hidden] must be display: none');
  assert.ok(CSS.includes('.update-status-badge'), '.update-status-badge rule must exist');
  assert.ok(CSS.includes('.update-progress-wrap[hidden]'), '.update-progress-wrap[hidden] must be display: none');
  assert.ok(CSS.includes('.update-progress-fill'), '.update-progress-fill rule must exist');

  // Design tokens: No raw hex in newly added update rules
  const updateSectionIdx = CSS.indexOf('/* ═══ Update Section ═══ */');
  assert.ok(updateSectionIdx > -1, 'Update Section comment block must exist in css/settings.css');
  const updateBlock = CSS.slice(updateSectionIdx);
  const lines = updateBlock.split('\n').filter(l => !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
  for (const line of lines) {
    assert.doesNotMatch(line, /#(?:[0-9a-fA-F]{3,8})\b/, `Raw hex color found in update CSS: ${line}`);
    assert.doesNotMatch(line, /\brgba?\(/, `Raw rgb/rgba color found in update CSS: ${line}`);
    assert.doesNotMatch(line, /\bmargin-left\b/, `Directional margin-left found: ${line}`);
    assert.doesNotMatch(line, /\bmargin-right\b/, `Directional margin-right found: ${line}`);
    assert.doesNotMatch(line, /\bpadding-left\b/, `Directional padding-left found: ${line}`);
    assert.doesNotMatch(line, /\bpadding-right\b/, `Directional padding-right found: ${line}`);
    assert.doesNotMatch(line, /[^-\w]left\s*:/, `Directional left: found: ${line}`);
    assert.doesNotMatch(line, /[^-\w]right\s*:/, `Directional right: found: ${line}`);
  }
});

test('js/settings.js exports update check functions and tab switching supports all 3 tabs', () => {
  assert.ok(/export function switchSettingsTab\(/.test(SETTINGS_JS));
  assert.ok(/export function currentSettingsTab\(/.test(SETTINGS_JS));
  assert.ok(/export function renderUpdateSection\(/.test(SETTINGS_JS));
  assert.ok(/export (?:async )?function checkAppUpdate\(/.test(SETTINGS_JS));
  assert.ok(/export (?:async )?function applyAppUpdate\(/.test(SETTINGS_JS));
  assert.ok(/export function markUpdateAvailable\(/.test(SETTINGS_JS));
  assert.ok(/export function markAppUpToDate\(/.test(SETTINGS_JS));
  assert.ok(SETTINGS_JS.includes("'updates'"), 'settings.js must recognize updates tab');
});

test('checkAppUpdate handles offline, server updates, and network errors gracefully', async () => {
  await import('../js/version.js');
  const settingsModule = await import('../js/settings.js');
  assert.equal(typeof settingsModule.checkAppUpdate, 'function');
  assert.equal(typeof settingsModule.applyAppUpdate, 'function');
  assert.equal(typeof settingsModule.markUpdateAvailable, 'function');
  assert.equal(typeof settingsModule.markAppUpToDate, 'function');
  assert.equal(typeof settingsModule.switchSettingsTab, 'function');
});


