import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const c2 = readFileSync(new URL('../css/components2.css', import.meta.url), 'utf8');
const pwaSrc = readFileSync(new URL('../js/pwa.js', import.meta.url), 'utf8');

test('HTML structure of the Morphing Ink Pill update toast', () => {
  const at = html.indexOf('id="updateToast"');
  assert.ok(at > 0, '#updateToast must be present in index.html');

  // Verify container classes
  const tagStart = html.lastIndexOf('<div', at);
  const tag = html.slice(tagStart, html.indexOf('>', at) + 1);
  assert.match(tag, /\btoast\b/);
  assert.match(tag, /\btoast-sticky\b/);
  assert.match(tag, /\bsheet-paper\b/);
  assert.match(tag, /\bupdate-toast\b/);
  assert.match(tag, /role="status"/);
  assert.match(tag, /aria-live="polite"/);

  // Extract toast block
  const toastEnd = html.indexOf('</div>', at);
  const body = html.slice(tagStart, toastEnd + 6);

  // Background fill and bar
  assert.match(body, /class="update-toast__fill"/);
  assert.match(body, /class="update-toast__bar"/);

  // Badge with page and check icons
  assert.match(body, /class="update-toast__badge"/);
  assert.match(body, /class="update-toast__icon update-toast__icon--page"/);
  assert.match(body, /class="update-toast__icon update-toast__icon--check"/);

  // Copy stack
  assert.match(body, /class="update-toast__title toast-text">نسخهٔ جدید اومده!<\/strong>/);
  assert.match(body, /id="updateSub">یک برگهٔ تازه و بهینه‌تر از دفتَرچه آماده است\.<\/span>/);

  // Actions: button, progress pill, and dismiss button
  assert.match(body, /class="toast-btn" id="updateBtn"[^>]*>دریافتش کن<\/button>/);
  assert.match(body, /id="updatePercent"[^>]*role="progressbar"/);
  assert.match(body, /aria-valuemin="0"/);
  assert.match(body, /aria-valuemax="100"/);
  assert.match(body, /aria-valuenow="0"/);
  assert.match(body, /aria-live="off"/);
  assert.match(body, /id="updateDismiss"[^>]*aria-label="بعداً"/);
});

test('CSS rules of the Morphing Ink Pill update toast enforce design tokens and logical properties', () => {
  const start = c2.indexOf('/* ═══ Update Toast: Morphing Ink Pill with Paper Tape ═══ */');
  assert.ok(start > 0, 'Update toast CSS block must exist in css/components2.css');
  const end = c2.indexOf('/* ═══ 12. Empty State ═══', start);
  const block = c2.slice(start, end > 0 ? end : start + 3000);

  // Positioning and geometry
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /inset-inline:\s*1rem/);
  assert.match(block, /max-width:\s*420px/);
  assert.match(block, /border-radius:\s*16px/);
  assert.match(block, /overflow:\s*hidden/);

  // Paper tape pseudo-element
  assert.match(block, /\.update-toast::before/);
  assert.match(block, /width:\s*44px/);
  assert.match(block, /height:\s*6px/);
  assert.match(block, /background:\s*var\(--color-tape,\s*var\(--color-accent-soft\)\)/);
  assert.match(block, /border-radius:\s*0 0 4px 4px/);

  // Semantic tokens only - no raw hex / rgb colors in update-toast block
  // Ignore SVG fills or comments, check CSS property values
  const lines = block.split('\n').filter(l => !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
  for (const line of lines) {
    assert.doesNotMatch(line, /#(?:[0-9a-fA-F]{3,8})\b/, `Raw hex color found in CSS line: ${line}`);
    assert.doesNotMatch(line, /\brgba?\(/, `Raw rgb/rgba color found in CSS line: ${line}`);
  }

  // Logical properties only - no left / right directional properties
  for (const line of lines) {
    if (line.includes('transform-origin')) continue; // transform-origin: right center is permitted
    assert.doesNotMatch(line, /\bmargin-left\b/, `Directional margin-left found: ${line}`);
    assert.doesNotMatch(line, /\bmargin-right\b/, `Directional margin-right found: ${line}`);
    assert.doesNotMatch(line, /\bpadding-left\b/, `Directional padding-left found: ${line}`);
    assert.doesNotMatch(line, /\bpadding-right\b/, `Directional padding-right found: ${line}`);
    assert.doesNotMatch(line, /[^-\w]left\s*:/, `Directional left: found: ${line}`);
    assert.doesNotMatch(line, /[^-\w]right\s*:/, `Directional right: found: ${line}`);
    assert.doesNotMatch(line, /text-align:\s*left/, `text-align: left found: ${line}`);
    assert.doesNotMatch(line, /letter-spacing/, `letter-spacing found: ${line}`);
    assert.doesNotMatch(line, /text-transform:\s*uppercase/, `text-transform: uppercase found: ${line}`);
  }

  // Reduced motion support
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /html\[data-motion="reduced"\]/);
});

test('pwa.js includes the staged progressive easing curve and safety fallbacks', () => {
  // Extract getProgress function from source
  const startIdx = pwaSrc.indexOf('function getProgress(t) {');
  assert.ok(startIdx > 0, 'getProgress function must exist in js/pwa.js');
  const endIdx = pwaSrc.indexOf('\n  }', startIdx);
  const body = pwaSrc.slice(startIdx + 'function getProgress(t) {'.length, endIdx);
  const getProgress = new Function('t', body);

  // Curve monotonicity and boundary values
  assert.equal(getProgress(0), 0);
  assert.equal(getProgress(1), 100);

  // Staged pacing checks:
  // Fast initial start: 0 -> 45% around t = 0.35
  const p35 = getProgress(0.35);
  assert.ok(p35 >= 44 && p35 <= 46, `At t=0.35 expected ~45%, got ${p35}`);

  // Reassuring cruise: 45% -> 85% around t = 0.80
  const p80 = getProgress(0.80);
  assert.ok(p80 >= 84 && p80 <= 86, `At t=0.80 expected ~85%, got ${p80}`);

  // Monotonicity check
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const p = getProgress(i / 100);
    assert.ok(p >= prev, `Curve should be monotonic: prev=${prev}, curr=${p}`);
    prev = p;
  }

  // Check reassurance Persian copy is present in pwa.js
  assert.ok(pwaSrc.includes('در حال صحافی برگهٔ تازه...'), 'Reassurance title during binding must be present');
  assert.ok(pwaSrc.includes('کارها و یادداشتهات کاملاً امنه'), 'Data security reassurance subtitle must be present');
  assert.ok(pwaSrc.includes('همه‌چیز آماده است ✨'), 'Celebration title must be present');

  // Check safety timeout constant
  assert.match(pwaSrc, /SAFETY_TIMEOUT\s*=\s*3500/, '3500ms safety timeout must be defined');
  assert.match(pwaSrc, /ANIM_DURATION\s*=\s*1600/, '1600ms animation duration must be defined');
  assert.match(pwaSrc, /CELEBRATION_BEAT\s*=\s*280/, '280ms celebration beat must be defined');
});

test('pwa update flow interactive state machine and snooze behavior', () => {
  // Verify that snooze and retry states are wired correctly in pwa.js
  assert.match(pwaSrc, /setState\('updating'\)/, 'Must transition to updating state on click');
  assert.match(pwaSrc, /setState\('done'\)/, 'Must transition to done state upon completion');
  assert.match(pwaSrc, /dismissBtn\.addEventListener\('click'/, 'Dismiss button must have click listener');
  assert.match(pwaSrc, /snoozed\s*=\s*true/, 'Snooze flag must be set upon dismissal');
  assert.match(pwaSrc, /hideOffer\(\)/, 'hideOffer must be invoked on snooze');
  assert.match(pwaSrc, /triggerReload\(\)/, 'Safety timeout must trigger reload if controllerchange is delayed');
});
