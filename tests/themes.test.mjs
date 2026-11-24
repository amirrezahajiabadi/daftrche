/* ═══ Theme audit ═══
   The eight themes are written down in three places that have to agree, and none
   of them can see the others: the list in js/constants.js, the palette table and
   the html[data-theme] blocks in css/base.css, and the small script inside
   index.html that paints the theme before the first frame. One key typed wrong
   in any of the three is a theme that silently does not exist — the picker shows
   a chip that paints nothing, or the boot script flashes the wrong colour.

   It also measures. A palette that misses a contrast floor looks perfectly fine
   to whoever wrote it (their screen, their eyes, the light of their room) and
   unreadable to somebody else — which is exactly how «کاغذ» shipped for months
   with an accent at 2.5:1 on its own paper before a measurement caught it.

   Run it with:   node --test tests/
   or directly:   node tests/themes.test.mjs
   No dependencies: node:test and node:assert are both in the runtime, and this
   project has no build step and no package.json to hang a script on. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './_env.mjs';

import {
  THEMES, PICKER_THEMES, THEME_KEYS, THEME_MODES, DEFAULT_THEME, NIGHT_THEME,
  normalizeTheme, modeOf, themesOfMode,
} from '../js/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = path => readFileSync(join(HERE, '..', path), 'utf8');

const CSS = read('css/base.css');
/* The picker's own rules live here — the swatch grid, the segmented control, and
   the two hiding rules that decide which half of the table is on screen. */
const COMPONENTS2 = read('css/components2.css');
const HTML = read('index.html');

/* The fourteen values a palette is made of. meaning colours (success, warning,
   danger) are deliberately not here: they are shared by mode, not by palette. */
const PALETTE_TOKENS = [
  'bg', 'surface', 'elev', 'text', 'text2', 'muted',
  'border', 'border-strong', 'accent', 'accent-strong', 'accent-soft',
  'accent-text',
  'tape', 'glass', 'on-accent',
];

/* The sixteen slots a theme block fills from its palette. */
const THEME_TOKENS = [
  '--color-bg', '--color-surface', '--color-surface-elevated',
  '--color-text-primary', '--color-text-secondary', '--color-text-muted',
  '--color-text-on-accent', '--color-border', '--color-border-strong',
  '--color-accent', '--color-accent-strong', '--color-accent-soft',
  '--color-accent-text',
  '--color-focus', '--tape', '--glass',
];

/* The card's own vocabulary plus the dot a picker paints, all cut from the same
   palette — which is what keeps a printed card from drifting from the app. */
const CARD_TOKENS = [
  '--card-bg', '--card-surface', '--card-text', '--card-muted', '--card-accent',
  '--card-accent-soft', '--card-border', '--card-grid', '--card-tape',
  '--pick-dot-bg', '--pick-dot-ring',
];

/* ── reading the sheet ──
   Every block this cares about starts at the beginning of a line, so the parser
   anchors there: it is what stops `html[data-mode="dark"] .bottom-nav{...}` from
   being read as if it were a mode block. */

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Every body for a selector, in order. A selector can legitimately appear more
   than once — `:root` holds the safe-area insets before it holds the tokens — so
   a caller that wants a particular one has to say which. */
function blockBodies(selector) {
  const out = [];
  const re = new RegExp(`^${escapeRe(selector)}\\{`, 'gm');
  let m;
  while ((m = re.exec(CSS))) {
    const start = m.index + m[0].length;
    const end = CSS.indexOf('}', start);
    if (end > -1) out.push(CSS.slice(start, end));
  }
  return out;
}

/* The token block, not the safe-area one, wherever it has drifted to. */
const defaultBlock = () => blockBodies(':root').find(body => body.includes('--color-bg')) ?? null;

const blockBody = selector => blockBodies(selector)[0] ?? null;

/* Comments come out first: a colon in a sentence would otherwise read as a
   declaration, and these blocks are written with a paragraph above the values. */
const declarations = body => {
  const out = {};
  if (!body) return out;
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  /* Properties, not just custom properties: `color-scheme` is a real one and it
     is one of the things that has to stay in step with the theme's mode. */
  for (const m of clean.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};

const themeBlock = key => declarations(blockBody(`html[data-theme="${key}"]`));
const cardBlock = key => declarations(blockBody(`[data-palette="${key}"]`));
const modeBlock = mode => declarations(blockBody(`html[data-mode="${mode}"]`));

/* The palette table: every `--pal-<theme>-<token>: value` line in the sheet. */
const palettes = {};
for (const m of CSS.matchAll(/^\s*--pal-([a-z]+)-([a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
  (palettes[m[1]] ||= {})[m[2]] = m[3].trim();
}

/* Every `var(--pal-…)` the sheet consumes, and every one it declares. A
   reference with no declaration resolves to nothing, which paints as transparent
   rather than as an error. */
const referenced = new Set([...CSS.matchAll(/var\((--pal-[a-z0-9-]+)[,)]/g)].map(m => m[1]));
const declared = new Set([...CSS.matchAll(/^\s*(--pal-[a-z0-9-]+)\s*:/gm)].map(m => m[1]));

/* ── reading the boot script ──
   The one copy of the theme list that cannot import the others, because it runs
   before any module has been fetched. */
const bootList = name => {
  const m = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(HTML);
  assert.ok(m, `index.html has no \`var ${name} = [...]\``);
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
};

const BOOT_KEYS = bootList('KEYS');
const BOOT_DARK = bootList('DARK');
const BOOT_ALIAS = Object.fromEntries(
  [...(/var ALIAS = \{([^}]*)\}/.exec(HTML)?.[1] || '')
    .matchAll(/(\w+)\s*:\s*'(\w+)'/g)].map(m => [m[1], m[2]]),
);
const BOOT_DEFAULTS = (() => {
  const m = /matchMedia\('\(prefers-color-scheme:dark\)'\)\.matches \? '(\w+)' : '(\w+)'/.exec(HTML);
  assert.ok(m, 'index.html boot script has no prefers-color-scheme fallback');
  return { dark: m[1], light: m[2] };
})();

/* ── colour maths ──
   The same three functions the share card uses, kept here in miniature so the
   numbers in the messages are the numbers a reader would get. */

function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(v => !Number.isNaN(v))) {
      return [p[0], p[1], p[2], p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1];
    }
  }
  return null;
}

const luminance = ([r, g, b]) => {
  const f = v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const A = luminance(a), B = luminance(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

/* A translucent colour, laid over what is behind it: what a reader sees for a
   soft accent fill is the accent mixed with the paper under it. */
const over = (fg, bg) => (fg[3] >= 1
  ? fg
  : [fg[0] * fg[3] + bg[0] * (1 - fg[3]),
     fg[1] * fg[3] + bg[1] * (1 - fg[3]),
     fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1]);

/* The floors, each with the reason it is what it is. */
const FLOORS = [
  { what: 'body text on the page', fg: '--color-text-primary', bg: '--color-bg', min: 4.5 },
  { what: 'body text on a card', fg: '--color-text-primary', bg: '--color-surface', min: 4.5 },
  { what: 'secondary text on a card', fg: '--color-text-muted', bg: '--color-surface', min: 3 },
  /* The bug this floor exists for: muted was light enough to read at 3.2:1 on
     the page, which looks fine to whoever chose it and disappears for everyone
     else. Both the page and the card are checked. */
  { what: 'secondary text on the page', fg: '--color-text-muted', bg: '--color-bg', min: 4.5 },
  { what: 'secondary text on a card, at the 4.5 floor', fg: '--color-text-muted', bg: '--color-surface', min: 4.5 },
  { what: 'the accent as an edge or an icon', fg: '--color-accent', bg: '--color-bg', min: 3 },
  { what: 'the label on an accent button', fg: '--color-text-on-accent', bg: '--color-accent', min: 4.5 },
  { what: 'the label on a danger button', fg: '--color-text-on-danger', bg: '--state-danger', min: 4.5 },
  { what: 'the label on a success button', fg: '--color-text-on-success', bg: '--state-success', min: 4.5 },
  { what: 'text on a soft accent fill', fg: '--color-text-primary', bg: '--color-accent-soft', min: 4.5 },
  { what: 'the focus ring', fg: '--color-focus', bg: '--color-bg', min: 3 },
  { what: 'accent text on soft accent fill', fg: '--color-accent-text', bg: '--color-accent-soft', min: 4.5 },
  { what: 'accent text on background', fg: '--color-accent-text', bg: '--color-bg', min: 4.5 },
];

test('every theme in js/constants.js is a complete palette in css/base.css', () => {
  for (const theme of THEMES) {
    const palette = palettes[theme.palette];
    assert.ok(palette, `no --pal-${theme.palette}-* block in css/base.css for theme «${theme.key}»`);
    const missing = PALETTE_TOKENS.filter(t => !(t in palette));
    assert.deepEqual(missing, [], `--pal-${theme.palette}-* is missing: ${missing.join(', ')}`);
    const extra = Object.keys(palette).filter(t => !PALETTE_TOKENS.includes(t));
    assert.deepEqual(extra, [], `--pal-${theme.palette}-* has tokens nothing reads: ${extra.join(', ')}`);
  }
  const darkPal = palettes['tavaloddark'];
  assert.ok(darkPal, 'no --pal-tavaloddark-* block in css/base.css');
  const darkMissing = PALETTE_TOKENS.filter(t => !(t in darkPal));
  assert.deepEqual(darkMissing, [], `--pal-tavaloddark-* is missing: ${darkMissing.join(', ')}`);
  const darkExtra = Object.keys(darkPal).filter(t => !PALETTE_TOKENS.includes(t));
  assert.deepEqual(darkExtra, [], `--pal-tavaloddark-* has tokens nothing reads: ${darkExtra.join(', ')}`);
});

test('no palette value is empty, and every token the sheet consumes is declared', () => {
  for (const [name, palette] of Object.entries(palettes)) {
    for (const [token, value] of Object.entries(palette)) {
      assert.ok(value.length > 0, `--pal-${name}-${token} is empty`);
    }
  }
  const dangling = [...referenced].filter(name => !declared.has(name)).sort();
  assert.deepEqual(dangling, [], `consumed but never declared: ${dangling.join(', ')}`);
});

test('palette values are colours the share card can parse', () => {
  /* The card reads its colours out of getComputedStyle and its parser only
     understands #hex and rgb()/rgba(). A palette written with color-mix() would
     resolve to `color(srgb …)` in Chromium, the parser would return null, and the
     card would silently fall back to black and white — taking its measured
     contrast system with it. Hence plain colours, forever. */
  for (const [name, palette] of Object.entries(palettes)) {
    for (const [token, value] of Object.entries(palette)) {
      assert.ok(parseColor(value), `--pal-${name}-${token} is "${value}" — not a #hex or rgba() the card can read`);
    }
  }
  assert.ok(!/color-mix\(|color\(srgb|oklch\(/.test(defaultBlock() || ''),
    'the default token block uses a colour function the card cannot parse');
});

test('every theme block fills all sixteen slots from its own palette', () => {
  for (const theme of THEMES) {
    const block = themeBlock(theme.key);
    assert.ok(Object.keys(block).length, `no html[data-theme="${theme.key}"] block in css/base.css`);
    const missing = THEME_TOKENS.filter(t => !(t in block));
    assert.deepEqual(missing, [], `html[data-theme="${theme.key}"] leaves ${missing.join(', ')} unset`);
    /* And each slot has to point at this theme's own palette: a copy-pasted
       block that still names the previous one is the mistake this catches.
       `color-scheme` is the one real property in here and maps nothing. */
    for (const [token, value] of Object.entries(block)) {
      if (!token.startsWith('--')) continue;
      const ref = /^var\((--pal-([a-z]+)-[a-z0-9-]+)\)$/.exec(value);
      assert.ok(ref, `html[data-theme="${theme.key}"] sets ${token} to "${value}" — a theme block only maps its palette`);
      assert.equal(ref[2], theme.palette,
        `html[data-theme="${theme.key}"] maps ${token} from «${ref[2]}», which is not its palette «${theme.palette}»`);
    }
  }
  const tavalodDarkBlock = declarations(blockBody('html[data-theme="tavalod"][data-mode="dark"]'));
  assert.ok(Object.keys(tavalodDarkBlock).length, 'no html[data-theme="tavalod"][data-mode="dark"] block in css/base.css');
  const missingDark = THEME_TOKENS.filter(t => !(t in tavalodDarkBlock));
  assert.deepEqual(missingDark, [], `html[data-theme="tavalod"][data-mode="dark"] leaves ${missingDark.join(', ')} unset`);
  for (const [token, value] of Object.entries(tavalodDarkBlock)) {
    if (!token.startsWith('--')) continue;
    const ref = /^var\((--pal-([a-z]+)-[a-z0-9-]+)\)$/.exec(value);
    assert.ok(ref, `html[data-theme="tavalod"][data-mode="dark"] sets ${token} to "${value}"`);
    assert.equal(ref[2], 'tavaloddark',
      `html[data-theme="tavalod"][data-mode="dark"] maps ${token} from «${ref[2]}», which is not «tavaloddark»`);
  }
});

test('every palette has a card block wired to that same palette', () => {
  for (const theme of THEMES) {
    const block = cardBlock(theme.palette);
    assert.ok(Object.keys(block).length, `no [data-palette="${theme.palette}"] block in css/base.css`);
    const missing = CARD_TOKENS.filter(t => !(t in block));
    assert.deepEqual(missing, [], `[data-palette="${theme.palette}"] leaves ${missing.join(', ')} unset`);
    for (const [token, value] of Object.entries(block)) {
      assert.ok(new RegExp(`^var\\(--pal-${theme.palette}-`).test(value),
        `[data-palette="${theme.palette}"] maps ${token} to "${value}" — it must come from its own palette`);
    }
  }
  const tavalodDarkCard = cardBlock('tavaloddark');
  assert.ok(Object.keys(tavalodDarkCard).length, 'no [data-palette="tavaloddark"] block in css/base.css');
  const missingDarkCard = CARD_TOKENS.filter(t => !(t in tavalodDarkCard));
  assert.deepEqual(missingDarkCard, [], `[data-palette="tavaloddark"] leaves ${missingDarkCard.join(', ')} unset`);
  for (const [token, value] of Object.entries(tavalodDarkCard)) {
    assert.ok(/^var\(--pal-tavaloddark-/.test(value),
      `[data-palette="tavaloddark"] maps ${token} to "${value}" — it must come from --pal-tavaloddark-*`);
  }
});

test('the three sources agree on which themes exist', () => {
  assert.deepEqual(BOOT_KEYS, THEME_KEYS,
    'the boot script in index.html and js/constants.js disagree about the theme keys');
  assert.deepEqual(BOOT_DARK, themesOfMode('dark').map(t => t.key),
    'the boot script\'s dark list disagrees with the themes whose mode is dark');
  assert.deepEqual(THEME_KEYS, THEMES.map(t => t.key));
  assert.equal(new Set(THEME_KEYS).size, THEME_KEYS.length, 'a theme key is used twice');
  for (const mode of THEME_MODES) {
    assert.ok(themesOfMode(mode).length >= 2, `the ${mode} half of the table has fewer than two themes`);
  }
});

test('color-scheme follows the mode, in both the theme block and the mode block', () => {
  for (const theme of THEMES) {
    const scheme = themeBlock(theme.key)['color-scheme'];
    assert.equal(scheme, theme.mode, `html[data-theme="${theme.key}"] declares color-scheme:${scheme}`);
  }
  const tavalodDarkScheme = declarations(blockBody('html[data-theme="tavalod"][data-mode="dark"]'))['color-scheme'];
  assert.equal(tavalodDarkScheme, 'dark', 'html[data-theme="tavalod"][data-mode="dark"] declares color-scheme: dark');
  assert.equal(modeBlock('light')['color-scheme'], 'light');
  assert.equal(modeBlock('dark')['color-scheme'], 'dark');
  /* The mode blocks are also where the shared decisions live, so a theme never
     has to restate them. */
  for (const mode of THEME_MODES) {
    const block = modeBlock(mode);
    for (const token of ['--state-success', '--state-warning', '--state-danger', '--state-glass-hover', '--shadow-1', '--shadow-2']) {
      assert.ok(block[token], `html[data-mode="${mode}"] does not set ${token}`);
    }
  }
});

test('the default theme is the one :root and the boot script point at', () => {
  assert.ok(THEME_KEYS.includes(DEFAULT_THEME), 'DEFAULT_THEME is not one of THEMES');
  assert.equal(THEME_KEYS[0], DEFAULT_THEME, 'the first theme in the table is meant to be the default');
  assert.equal(modeOf(DEFAULT_THEME), 'light', 'the default theme belongs to the light half');
  assert.ok(THEME_KEYS.includes(NIGHT_THEME), 'NIGHT_THEME is not one of THEMES');
  assert.equal(modeOf(NIGHT_THEME), 'dark', 'NIGHT_THEME belongs to the dark half');

  /* :root is the default theme written out longhand, so the two cannot drift. */
  const root = declarations(defaultBlock());
  assert.equal(root['--color-bg'], `var(--pal-${DEFAULT_THEME}-bg)`);
  assert.equal(root['--color-accent'], `var(--pal-${DEFAULT_THEME}-accent)`);
  assert.equal(root['--color-text-muted'], `var(--pal-${DEFAULT_THEME}-muted)`);
  assert.equal(root['--tape'], `var(--pal-${DEFAULT_THEME}-tape)`);

  assert.equal(BOOT_DEFAULTS.light, DEFAULT_THEME, 'a first visit on a light system should land on the default theme');
  assert.equal(BOOT_DEFAULTS.dark, NIGHT_THEME, 'a first visit on a dark system should land on the night theme');
});

test('keys an older build wrote down still resolve to a real theme', () => {
  for (const [legacy, expected] of Object.entries(BOOT_ALIAS)) {
    assert.equal(normalizeTheme(legacy), expected, `the boot script maps «${legacy}» to «${expected}»`);
    assert.ok(THEME_KEYS.includes(expected), `«${legacy}» maps to «${expected}», which is not a theme`);
  }
  for (const k of THEME_KEYS) assert.equal(normalizeTheme(k), k, 'a current key must pass through');
  /* Every key any earlier build ever wrote must land on a theme of the same half
     — someone who read in the dark must not wake up in the light. */
  const OLD = { paper: 'light', lilac: 'light', blush: 'light', sage: 'light', ink: 'light', light: 'light', cream: 'light', forest: 'light',
                night: 'dark', gold: 'dark', ocean: 'dark', plum: 'dark', dark: 'dark' };
  for (const [old, half] of Object.entries(OLD)) {
    assert.ok(THEME_KEYS.includes(normalizeTheme(old)), `«${old}» resolves to nothing`);
    assert.equal(modeOf(old), half, `«${old}» changes half of the table`);
    assert.ok(old in BOOT_ALIAS, `the boot script does not know the old key «${old}»`);
  }
  assert.equal(normalizeTheme('nonsense'), '', 'an unknown key must come back empty, not as itself');
  assert.equal(normalizeTheme(''), '');
  assert.equal(modeOf('nonsense'), modeOf(DEFAULT_THEME), 'an unknown key still needs a mode');
});

/* A theme is read the way the browser reads it: the block names a slot, the slot
   points at a palette value, and `mode` blocks supply the tokens a theme does not
   write down itself. This resolves one step of that indirection, which is all the
   sheet has. */
function resolveToken(theme, get) {
  const decls = { ...themeBlock(theme.key), ...modeBlock(theme.mode) };
  return token => {
    const raw = decls[token];
    if (!raw) return null;
    /* A palette name is letters only, which is what keeps `--pal-gold-accent-soft`
       from being read as palette «gold-accent» and token «soft». */
    const ref = /^var\(--pal-([a-z]+)-([a-z0-9-]+)\)$/.exec(raw);
    return ref ? (palettes[ref[1]]?.[ref[2]] ?? null) : raw;
  };
}

test('contrast floors hold in every theme', () => {
  const failures = [];
  const missing = [];

  for (const theme of THEMES) {
    const value = resolveToken(theme);
    const colour = token => {
      const raw = value(token);
      if (raw === null) { missing.push(`«${theme.key}» ${token}`); return null; }
      const parsed = parseColor(raw);
      if (!parsed) missing.push(`«${theme.key}» ${token} = "${raw}"`);
      return parsed;
    };

    /* The surface a translucent fill is laid over, resolved once per theme. */
    const surface = colour('--color-surface');

    for (const floor of FLOORS) {
      const fg = colour(floor.fg);
      let bg = colour(floor.bg);
      if (!fg || !bg) continue;
      /* A soft accent fill is not what the page paints — what a reader sees is
         that fill mixed with the surface under it. */
      if (fg[3] < 1 || bg[3] < 1) bg = over(bg, surface || [255, 255, 255, 1]);
      const ratio = contrast(fg, bg);
      if (ratio < floor.min) {
        failures.push(`«${theme.key}» ${floor.what}: ${ratio.toFixed(2)}:1 (floor ${floor.min}) [${floor.fg} on ${floor.bg}]`);
      }
    }
  }

  /* Also verify contrast floors for tavalod under dark mode */
  const tavalodDarkDecls = { ...declarations(blockBody('html[data-theme="tavalod"][data-mode="dark"]')), ...modeBlock('dark') };
  const darkVal = token => {
    const raw = tavalodDarkDecls[token];
    if (!raw) return null;
    const ref = /^var\(--pal-([a-z]+)-([a-z0-9-]+)\)$/.exec(raw);
    return ref ? (palettes[ref[1]]?.[ref[2]] ?? null) : raw;
  };
  const darkColour = token => {
    const raw = darkVal(token);
    if (raw === null) { missing.push(`«tavalod-dark» ${token}`); return null; }
    const parsed = parseColor(raw);
    if (!parsed) missing.push(`«tavalod-dark» ${token} = "${raw}"`);
    return parsed;
  };
  const darkSurface = darkColour('--color-surface');
  for (const floor of FLOORS) {
    const fg = darkColour(floor.fg);
    let bg = darkColour(floor.bg);
    if (!fg || !bg) continue;
    if (fg[3] < 1 || bg[3] < 1) bg = over(bg, darkSurface || [0, 0, 0, 1]);
    const ratio = contrast(fg, bg);
    if (ratio < floor.min) {
      failures.push(`«tavalod-dark» ${floor.what}: ${ratio.toFixed(2)}:1 (floor ${floor.min}) [${floor.fg} on ${floor.bg}]`);
    }
  }

  assert.deepEqual(missing, [], `tokens with no resolvable colour:\n  ${missing.join('\n  ')}`);
  assert.deepEqual(failures, [], `contrast floors missed:\n  ${failures.join('\n  ')}`);
});

test('the picker hides the other half of the table by CSS, in both directions', () => {
  /* The swatches and the card's palette chips are all in the DOM; which half is
     on screen is one attribute on the host. Both directions have to be written
     down, or the half that was showing first never goes away. */
  for (const row of ['.swatch-row', '.pick-row']) {
    for (const [host, hidden] of [['light', 'dark'], ['dark', 'light']]) {
      const needle = `${row}[data-mode="${host}"]`;
      const i = COMPONENTS2.indexOf(needle);
      assert.ok(i > -1, `css/components2.css has no hiding rule for ${needle}`);
      const rule = COMPONENTS2.slice(i, COMPONENTS2.indexOf('}', i));
      assert.ok(rule.includes(`[data-mode="${hidden}"]`) && rule.includes('display:none'),
        `${needle} does not hide its [data-mode="${hidden}"] children`);
    }
  }
});


test('the boot script\'s lock table matches the rewards in js/achievements.js', async () => {
  const A = await import('../js/achievements.js');
  const m = /var LOCK = \{([^}]*)\}/.exec(HTML);
  assert.ok(m, 'index.html boot script has no LOCK table');
  const boot = Object.fromEntries([...m[1].matchAll(/(\w+)\s*:\s*\['([\w-]+)',\s*(\d+)\]/g)].map(x => [x[1], [x[2], Number(x[3])]]));
  const rewarded = THEMES.filter(t => A.rewardFor('theme', t.key));
  assert.deepEqual(Object.keys(boot).sort(), rewarded.map(t => t.key).sort());
  for (const t of rewarded) {
    const reqs = A.rewardRequirements(A.rewardFor('theme', t.key).id);
    assert.deepEqual(boot[t.key], [reqs[0].achievement.id, reqs[0].tier], t.key);
  }
});

test('the boot script\'s QA unlock flag matches js/theme.js QA_UNLOCK_ALL_THEMES', async () => {
  const { QA_UNLOCK_ALL_THEMES } = await import('../js/theme.js');
  const m = /var QA_UNLOCK = (true|false);/.exec(HTML);
  assert.ok(m, 'index.html boot script has no QA_UNLOCK declaration');
  assert.equal(m[1] === 'true', QA_UNLOCK_ALL_THEMES,
    'index.html QA_UNLOCK does not match js/theme.js QA_UNLOCK_ALL_THEMES');
});

test('all world themes have complete atmospheric and reduced-motion rules in css/worlds.css', () => {
  const WORLDS_CSS = read('css/worlds.css');
  const GLASS_CSS = read('css/glass.css');
  const worldThemes = THEMES.filter(t => t.family === 'world');

  assert.equal(worldThemes.length, 11, 'expected 11 world themes');

  for (const w of worldThemes) {
    assert.ok(
      WORLDS_CSS.includes(`html[data-theme="${w.key}"]::before`) &&
      WORLDS_CSS.includes(`html[data-theme="${w.key}"]::after`),
      `css/worlds.css missing ::before/::after for ${w.key}`
    );
  }

  const newWorlds = ['negarkhane', 'qollenavard', 'kimiyagar', 'rasadkhane', 'simorgh', 'tavalod'];
  for (const key of newWorlds) {
    assert.ok(
      WORLDS_CSS.includes(`html[data-theme="${key}"] body`),
      `css/worlds.css missing atmospheric body styling for ${key}`
    );
  }

  // Simorgh also requires glass rules
  assert.ok(
    GLASS_CSS.includes('html[data-theme="simorgh"]'),
    'css/glass.css missing glass rules for simorgh'
  );

  const cardClasses = ['.wc-miniature', '.wc-summit', '.wc-elixir', '.wc-constellation', '.wc-simorgh'];
  for (const cls of cardClasses) {
    assert.ok(WORLDS_CSS.includes(cls), `css/worlds.css missing card styles for ${cls}`);
  }
});

test('settings page dual tabs and themes panel structure', async () => {
  const SETTINGS_CSS = read('css/settings.css');

  // Verify tab list and buttons in HTML
  assert.ok(HTML.includes('class="settings-tabs"'), 'index.html missing .settings-tabs');
  assert.ok(HTML.includes('data-settings-tab="general"'), 'index.html missing general tab');
  assert.ok(HTML.includes('data-settings-tab="themes"'), 'index.html missing themes tab');
  assert.ok(HTML.includes('id="settingsThemeCount"'), 'index.html missing #settingsThemeCount badge');

  // Verify panels
  assert.ok(HTML.includes('data-settings-panel="general"'), 'index.html missing general panel');
  assert.ok(HTML.includes('data-settings-panel="themes"'), 'index.html missing themes panel');

  // Verify readability/motion moved to general panel
  const genPanelStart = HTML.indexOf('data-settings-panel="general"');
  const themesPanelStart = HTML.indexOf('data-settings-panel="themes"');
  assert.ok(genPanelStart > -1 && themesPanelStart > genPanelStart, 'panels in expected order');

  const genPanelHtml = HTML.slice(genPanelStart, themesPanelStart);
  assert.ok(genPanelHtml.includes('id="textSizeSeg"'), '#textSizeSeg should be inside general panel');
  assert.ok(genPanelHtml.includes('id="motionBtn"'), '#motionBtn should be inside general panel');
  assert.ok(genPanelHtml.includes('id="backupExport"'), '#backupExport should be inside general panel');

  const themesPanelHtml = HTML.slice(themesPanelStart);
  assert.ok(themesPanelHtml.includes('id="themeAutoBtn"'), '#themeAutoBtn should be inside themes panel');
  assert.ok(themesPanelHtml.includes('id="themeModeSwitch"'), '#themeModeSwitch should be inside themes panel');
  assert.ok(themesPanelHtml.includes('id="themeSwatches"'), '#themeSwatches should be inside themes panel');

  // Verify CSS styles
  assert.ok(SETTINGS_CSS.includes('.settings-tabs'), 'css/settings.css missing .settings-tabs');
  assert.ok(SETTINGS_CSS.includes('.settings-tab'), 'css/settings.css missing .settings-tab');
  assert.ok(SETTINGS_CSS.includes('.settings-panel[hidden]'), 'css/settings.css missing .settings-panel[hidden]');
  assert.ok(SETTINGS_CSS.includes('.swatch-group-title'), 'css/settings.css missing .swatch-group-title');

  // Verify JS exports and handlers
  const SETTINGS_JS = read('js/settings.js');
  assert.ok(/export function switchSettingsTab\(/.test(SETTINGS_JS), 'switchSettingsTab export missing');
  assert.ok(/export function renderSettingsThemeCount\(/.test(SETTINGS_JS), 'renderSettingsThemeCount export missing');
  assert.ok(SETTINGS_JS.includes('navigate-settings-tab'), 'navigate-settings-tab listener missing');

  const T = await import('../js/theme.js');
  assert.equal(typeof T.unlockedThemesCount, 'function', 'unlockedThemesCount export missing');
  assert.equal(T.totalThemesCount(), 17, 'totalThemesCount should be 17: the birthday theme is not in the picker');
  assert.equal(T.unlockedThemesCount(), 7, 'unlockedThemesCount should be 7 by default for a new user');
});

test('all 11 world themes are locked by default in production and fall back safely', async () => {
  const T = await import('../js/theme.js');
  const S = await import('../js/store.js');
  const A = await import('../js/achievements.js');

  assert.equal(T.QA_UNLOCK_ALL_THEMES, false, 'QA bypass must be disabled in production');

  const baseThemes = ['daftarche', 'kashi', 'cobalt', 'aurora', 'lajvard', 'graphite', 'nightglass'];
  const worldThemes = [
    'daryanavard', 'shabgard', 'tarnama', 'baghche', 'fazanavard',
    'qollenavard', 'kimiyagar', 'negarkhane', 'rasadkhane', 'simorgh', 'tavalod',
  ];

  for (const key of baseThemes) {
    assert.equal(T.isThemeUnlocked(key), true, `base theme ${key} should be unlocked`);
  }

  for (const key of worldThemes) {
    assert.equal(T.isThemeUnlocked(key), false, `world theme ${key} should be locked by default`);
  }

  assert.equal(T.unlockedThemesCount(), 7);
  assert.equal(T.totalThemesCount(), 17);

  /* The birthday theme is not a world theme the reader can earn or pick: it is
     hidden from the picker and locked every day that is not the birthday. */
  assert.ok(!PICKER_THEMES.some(t => t.key === 'tavalod'), 'tavalod must not be offered in the picker');
  assert.equal(T.isThemeUnlocked('tavalod'), false);

  // Applying locked theme with remember:true must fail
  for (const key of worldThemes) {
    assert.equal(T.applyTheme(key, { remember: true }), false, `applyTheme(${key}) should fail when locked`);
  }

  // Fallback of dark world themes must be lajvard, light world themes must be kashi
  const darkWorlds = ['shabgard', 'fazanavard', 'kimiyagar', 'rasadkhane', 'simorgh'];
  const lightWorlds = ['daryanavard', 'tarnama', 'baghche', 'qollenavard', 'negarkhane', 'tavalod'];

  for (const key of darkWorlds) {
    assert.equal(modeOf(key), 'dark');
  }
  for (const key of lightWorlds) {
    assert.equal(modeOf(key), 'light');
  }

  // Test automatic recovery: if a user had a locked theme saved, initTheme safely falls back
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  try {
    globalThis.document = {
      documentElement: { dataset: {} },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    globalThis.window = {
      dispatchEvent: () => true,
    };
    S.saveTheme('shabgard');
    S.saveThemeModes({ dark: 'shabgard', light: 'tarnama' });
    T.initTheme();
    assert.equal(S.loadTheme(), 'lajvard', 'saved locked theme should be sanitized to lajvard');
    assert.equal(S.loadThemeModes()?.dark, 'lajvard', 'remembered dark mode should be sanitized to lajvard');
    // Test light locked theme recovery as well
    S.saveTheme('tarnama');
    T.initTheme();
    assert.equal(S.loadTheme(), 'daftarche', 'saved light locked theme should be sanitized to daftarche');
    assert.equal(globalThis.document.documentElement.dataset.theme, 'daftarche');
    assert.equal(globalThis.document.documentElement.dataset.mode, 'light');
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
  }
});

test('index.html inline boot script safely resolves and falls back across all 11 worlds and modes', () => {
  const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(HTML)[1];
  assert.ok(inlineScript, 'inline boot script missing in index.html');

  function runBootScript({ storage = {}, prefersDark = false } = {}) {
    const store = new Map(Object.entries(storage));
    const doc = { documentElement: { dataset: {} } };
    const fn = new Function('localStorage', 'document', 'matchMedia', inlineScript);
    fn(
      { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
      doc,
      query => ({ matches: prefersDark && query.includes('dark') })
    );
    return doc.documentElement.dataset;
  }

  const darkWorlds = ['shabgard', 'fazanavard', 'kimiyagar', 'rasadkhane', 'simorgh'];
  /* «تولد» is not in this list any more: it is not a theme the boot script can
     reason about. It is worn for one day by js/theme.js itself and never stored
     as a choice, so the first paint has no saved birthday theme to fall back
     from. */
  const lightWorlds = ['daryanavard', 'tarnama', 'baghche', 'qollenavard', 'negarkhane'];

  // All 11 world themes without achievements must fall back to their mode default
  for (const w of darkWorlds) {
    const res = runBootScript({ storage: { theme: w } });
    assert.deepEqual(res, { theme: 'lajvard', mode: 'dark' }, `locked dark world ${w} should fall back to lajvard`);
  }

  for (const w of lightWorlds) {
    const res = runBootScript({ storage: { theme: w } });
    assert.deepEqual(res, { theme: 'daftarche', mode: 'light' }, `locked light world ${w} should fall back to kashi`);
  }

  // Base themes must pass through untouched
  for (const b of ['daftarche', 'kashi', 'cobalt', 'aurora']) {
    const res = runBootScript({ storage: { theme: b } });
    assert.deepEqual(res, { theme: b, mode: 'light' });
  }
  for (const b of ['lajvard', 'graphite', 'nightglass']) {
    const res = runBootScript({ storage: { theme: b } });
    assert.deepEqual(res, { theme: b, mode: 'dark' });
  }

  // Unlocked world theme must apply if earned
  const achvEarned = JSON.stringify({
    unlocked: {
      'night-owl': { tier: 1 },
      chain: { tier: 2 },
      'record-breaker': { tier: 1 },
    },
  });
  const resShabgard = runBootScript({
    storage: { theme: 'shabgard', 'daftarche-achievements': achvEarned },
  });
  assert.deepEqual(resShabgard, { theme: 'shabgard', mode: 'dark' });

  const resTarnama = runBootScript({
    storage: { theme: 'tarnama', 'daftarche-achievements': achvEarned },
  });
  assert.deepEqual(resTarnama, { theme: 'tarnama', mode: 'light' });

  const resTavalod = runBootScript({
    storage: { theme: 'tavalod', 'daftarche-achievements': achvEarned },
  });
  assert.deepEqual(resTavalod, { theme: 'tavalod', mode: 'light' });

  // If achievement tier is insufficient, must fall back
  const achvInsufficient = JSON.stringify({
    unlocked: {
      chain: { tier: 1 }, // tarnama requires tier 2
    },
  });
  const resTarnamaLocked = runBootScript({
    storage: { theme: 'tarnama', 'daftarche-achievements': achvInsufficient },
  });
  assert.deepEqual(resTarnamaLocked, { theme: 'daftarche', mode: 'light' });

  /* «تولد» has no lock in the boot table any more, because it is not earned and
     never saved as a choice: the first paint passes a stale value through and
     js/theme.js decides on the day itself (applyBirthdayTheme), which is the only
     thing that ever puts this theme on. */
  const resTavalodStale = runBootScript({
    storage: { theme: 'tavalod', 'daftarche-achievements': achvInsufficient },
  });
  assert.deepEqual(resTavalodStale, { theme: 'tavalod', mode: 'light' });

  // Missing theme falls back to matchMedia
  assert.deepEqual(runBootScript({ storage: {}, prefersDark: true }), { theme: 'lajvard', mode: 'dark' });
  assert.deepEqual(runBootScript({ storage: {}, prefersDark: false }), { theme: 'daftarche', mode: 'light' });
});

test('theme swatches render lock state, lockedText, lock icons, and live counter updates', async () => {
  if (typeof self === 'undefined') globalThis.self = globalThis;
  if (typeof document === 'undefined') {
    globalThis.document = {
      baseURI: 'http://localhost/',
      documentElement: { dataset: {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    globalThis.window = globalThis;
  }
  await import('../js/version.js');
  const { swatchRow } = await import('../js/chipgroup.js');
  const A = await import('../js/achievements.js');
  const S = await import('../js/store.js');
  const T = await import('../js/theme.js');
  const { faNum } = await import('../js/utils.js');

  // 1. Build swatches the way js/theme.js does: from the pickable table only.
  const items = PICKER_THEMES.map((theme, idx) => {
    const reward = A.rewardFor('theme', theme.key);
    const condition = reward ? A.rewardRequirements(reward.id).map(({ achievement }) =>
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
      locked: !T.isThemeUnlocked(theme.key),
      lockText: reward?.lockedText,
      lockCondition: condition ? `شرط باز شدن: ${condition}` : '',
      groupTitle, groupSub,
    };
  });

  const host = {
    dataset: {},
    innerHTML: '',
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  swatchRow(host, items, {
    group: 'theme',
    onPick: () => {},
    isLocked: key => !T.isThemeUnlocked(key),
  });

  const html = host.innerHTML;
  assert.ok(html.length > 0, 'swatchRow should generate HTML');

  // Verify the ten earnable world swatches have lock icons and lockText
  const worldThemes = PICKER_THEMES.filter(t => t.family === 'world');
  for (const wt of worldThemes) {
    const reward = A.rewardFor('theme', wt.key);
    assert.ok(html.includes(`data-key="${wt.key}"`), `missing swatch button for ${wt.key}`);
    assert.ok(html.includes(reward.lockedText), `missing lockedText "${reward.lockedText}" for ${wt.key}`);
    assert.ok(html.includes('swatch-lock-icon'), `swatch for ${wt.key} must carry swatch-lock-icon`);
  }

  /* The birthday theme is worn, not chosen: no swatch, no lock, no count. */
  assert.ok(!html.includes('data-key="tavalod"'), 'the birthday theme must not be a swatch');

  // Base themes must not have lock icons
  const baseThemes = PICKER_THEMES.filter(t => t.family !== 'world');
  for (const bt of baseThemes) {
    assert.ok(html.includes(`data-key="${bt.key}"`), `missing swatch button for ${bt.key}`);
    const btnStart = html.indexOf(`data-key="${bt.key}"`);
    const btnEnd = html.indexOf('</button>', btnStart);
    const btnHtml = html.slice(btnStart, btnEnd);
    assert.ok(!btnHtml.includes('swatch-lock-icon'), `base theme ${bt.key} should not have lock icon`);
    assert.ok(!btnHtml.includes('swatch-lock'), `base theme ${bt.key} should not have swatch-lock text`);
  }

  // 2. Test #settingsThemeCount synchronization
  const countEl = {
    textContent: '',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };

  const origDoc = globalThis.document;
  try {
    globalThis.document = {
      baseURI: 'http://localhost/',
      documentElement: { dataset: {} },
      querySelector: sel => (sel === '#settingsThemeCount' ? countEl : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
    };

    // Initial state: empty achievements -> 7 themes unlocked
    S.saveAchv(A.emptyState());
    T.markThemePicker();
    assert.equal(countEl.textContent, faNum(7));
    assert.equal(countEl.attrs['aria-label'], `${faNum(7)} تم باز شده از ${faNum(17)}`);

    // Unlock chain tier 2 (tarnama unlocked) -> 8 themes unlocked
    S.saveAchv(A.normalizeState({ unlocked: { chain: { tier: 2, at: '2026-09-02' } } }));
    T.markThemePicker();
    assert.equal(countEl.textContent, faNum(8));
    assert.equal(countEl.attrs['aria-label'], `${faNum(8)} تم باز شده از ${faNum(17)}`);

    // Unlock pages tier 1 (daryanavard) + night-owl tier 1 (shabgard) -> 10 themes unlocked
    S.saveAchv(A.normalizeState({
      unlocked: {
        chain: { tier: 2, at: '2026-09-02' },
        pages: { tier: 1, at: '2026-09-03' },
        'night-owl': { tier: 1, at: '2026-09-04' },
      },
    }));
    T.markThemePicker();
    assert.equal(countEl.textContent, faNum(10));
    assert.equal(countEl.attrs['aria-label'], `${faNum(10)} تم باز شده از ${faNum(17)}`);
  } finally {
    globalThis.document = origDoc;
    S.saveAchv(A.emptyState());
  }
});
