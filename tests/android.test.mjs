import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('capacitor.config.json is valid and configured for Iranian platforms', () => {
  const configPath = path.join(ROOT, 'capacitor.config.json');
  assert.ok(fs.existsSync(configPath), 'capacitor.config.json missing');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.appId, 'com.Amirreza.daftarche', 'appId must match com.Amirreza.daftarche');
  assert.equal(config.webDir, 'www', 'webDir must be www');
  assert.equal(config.appName, 'دَفتَرچه', 'appName must be دَفتَرچه');
  assert.equal(config.android?.minWebViewVersion, 111, 'minWebViewVersion must be at least 111');
  /* Android 15 (API 35) draws every app edge-to-edge, so the bars sit over the
     page instead of beside it. The app therefore asks for that on purpose and
     pads its own content by the insets MainActivity measures (--sat/--sab); the
     old «lay the WebView below the bar» setting could only produce a coloured
     band on the versions where it still worked, and nothing at all on the ones
     where it is ignored. */
  assert.equal(config.plugins?.StatusBar?.overlaysWebView, true,
    'StatusBar must draw over the page: the page pads itself by the window insets');
});

test('local pdf.js vendor assets exist and are complete', () => {
  const pdfjsDir = path.join(ROOT, 'assets/vendor/pdfjs');
  assert.ok(fs.existsSync(pdfjsDir), 'assets/vendor/pdfjs directory missing');

  const mainScript = path.join(pdfjsDir, 'build/pdf.min.mjs');
  const workerScript = path.join(pdfjsDir, 'build/pdf.worker.min.mjs');
  const licenseFile = path.join(pdfjsDir, 'LICENSE');
  const cmapsDir = path.join(pdfjsDir, 'cmaps');
  const fontsDir = path.join(pdfjsDir, 'standard_fonts');

  assert.ok(fs.existsSync(mainScript), 'build/pdf.min.mjs missing');
  assert.ok(fs.statSync(mainScript).size > 200000, 'pdf.min.mjs too small');

  assert.ok(fs.existsSync(workerScript), 'build/pdf.worker.min.mjs missing');
  assert.ok(fs.statSync(workerScript).size > 1000000, 'pdf.worker.min.mjs too small');

  assert.ok(fs.existsSync(licenseFile), 'LICENSE missing');
  assert.ok(fs.existsSync(cmapsDir) && fs.readdirSync(cmapsDir).length > 50, 'cmaps missing or incomplete');
  assert.ok(fs.existsSync(fontsDir) && fs.readdirSync(fontsDir).length > 10, 'standard_fonts missing or incomplete');
});

test('js/native.js exports all bridge functions and handles web fallback gracefully', async () => {
  const native = await import('../js/native.js');

  assert.equal(typeof native.isNative, 'function', 'isNative export missing');
  assert.equal(typeof native.saveAndShareBlob, 'function', 'saveAndShareBlob export missing');
  assert.equal(typeof native.initNativeBackHandler, 'function', 'initNativeBackHandler export missing');
  assert.equal(typeof native.syncSystemBars, 'function', 'syncSystemBars export missing');
  assert.equal(typeof native.scheduleNativeTaskNotification, 'function', 'scheduleNativeTaskNotification export missing');
  assert.equal(typeof native.checkMinWebViewVersion, 'function', 'checkMinWebViewVersion export missing');

  // In Node environment, isNative must be false
  assert.equal(native.isNative(), false, 'isNative should be false in node environment');

  // saveAndShareBlob with null blob
  const resNull = await native.saveAndShareBlob(null, 'test.txt');
  assert.equal(resNull.ok, false);
});

test('tools/build-www.mjs generates valid www directory and build-info.json', () => {
  const wwwDir = path.join(ROOT, 'www');
  const buildInfoPath = path.join(wwwDir, 'build-info.json');

  assert.ok(fs.existsSync(buildInfoPath), 'www/build-info.json missing');
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));

  assert.equal(buildInfo.appId, 'com.Amirreza.daftarche');
  assert.equal(typeof buildInfo.versionName, 'string');
  assert.ok(buildInfo.versionCode > 10000, 'versionCode must be valid positive integer');
  assert.ok(buildInfo.fileCount > 100, 'fileCount must be at least 100 files');
  assert.ok(fs.existsSync(path.join(wwwDir, 'index.html')), 'www/index.html missing');
  assert.ok(fs.existsSync(path.join(wwwDir, 'assets/vendor/pdfjs/build/pdf.min.mjs')), 'pdf.js missing from www');
});

test('sw.js SHELL array includes js/native.js', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'js/native.js'"), 'sw.js SHELL must include js/native.js');
});

test('android project configuration and manifest are hardened for release', () => {
  const manifestPath = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
  const buildGradlePath = path.join(ROOT, 'android/app/build.gradle');
  const variablesPath = path.join(ROOT, 'android/variables.gradle');
  const bgXmlPath = path.join(ROOT, 'android/app/src/main/res/values/ic_launcher_background.xml');

  assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml missing');
  assert.ok(fs.existsSync(buildGradlePath), 'android/app/build.gradle missing');
  assert.ok(fs.existsSync(variablesPath), 'variables.gradle missing');
  assert.ok(fs.existsSync(bgXmlPath), 'ic_launcher_background.xml missing');

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert.ok(manifest.includes('android:supportsRtl="true"'), 'manifest must support RTL');
  assert.ok(manifest.includes('android:allowBackup="false"'), 'manifest must disable auto backup for privacy');
  assert.ok(manifest.includes('android.permission.INTERNET'), 'manifest missing INTERNET permission');
  assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'), 'manifest missing POST_NOTIFICATIONS permission');
  assert.ok(manifest.includes('SCHEDULE_EXACT_ALARM') && manifest.includes('tools:node="remove"'),
    'manifest must remove SCHEDULE_EXACT_ALARM to avoid policy issues');

  const variables = fs.readFileSync(variablesPath, 'utf8');
  assert.ok(variables.includes('minSdkVersion = 26'), 'minSdkVersion must be 26');
  assert.ok(variables.includes('targetSdkVersion = 36'), 'targetSdkVersion must be 36');

  const bgXml = fs.readFileSync(bgXmlPath, 'utf8');
  assert.ok(bgXml.includes('#1b2a47'), 'launcher background color must match brand navy #1b2a47');

  const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
  assert.ok(buildGradle.includes('com.Amirreza.daftarche'), 'build.gradle must have com.Amirreza.daftarche namespace');
  assert.ok(buildGradle.includes('signingConfigs'), 'build.gradle must support release signing config');

  const templatePath = path.join(ROOT, 'android/keystore.properties.template');
  assert.ok(fs.existsSync(templatePath), 'android/keystore.properties.template missing');

  const mainActivityPath = path.join(ROOT, 'android/app/src/main/java/com/Amirreza/daftarche/MainActivity.java');
  assert.ok(fs.existsSync(mainActivityPath), 'MainActivity.java missing');
  const mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
  /* With a target of 35+ Android draws the window edge-to-edge whether the app
     asks for it or not, so opting out is no longer possible: the Activity runs
     edge-to-edge and hands the measured window insets to the page, which pads
     itself from them (css/base.css --sat/--sab). */
  assert.ok(mainActivity.includes('setDecorFitsSystemWindows(getWindow(), false)'),
    'MainActivity must run edge-to-edge');
  assert.ok(mainActivity.includes("--inset-top") && mainActivity.includes("--inset-bottom"),
    'MainActivity must publish the window insets to the page');

  const stylesXmlPath = path.join(ROOT, 'android/app/src/main/res/values/styles.xml');
  assert.ok(fs.existsSync(stylesXmlPath), 'styles.xml missing');
  const stylesXml = fs.readFileSync(stylesXmlPath, 'utf8');
  /* The page is edge-to-edge and pads itself from the measured insets; a theme
     that fits the system windows would pad for the same bars twice, which is
     the band of empty page that made the phone build look unlike the web app. */
  assert.ok(stylesXml.includes('android:fitsSystemWindows">false'),
    'styles.xml must not fit the system windows: the page pads itself');
  assert.ok(stylesXml.includes('android:windowFullscreen">false'), 'styles.xml must disable windowFullscreen');
});

test('the phone lays the page out at the browser scale', () => {
  /* A WebView used to shrink the page to .94 «because a full window looks
     bigger than a tab», then scale its height and dock clearance back up by
     1.064 to compensate. On a phone that combination never adds up: the zoomed
     page is a fraction wider than its window, the WebView answers with its own
     shrink-to-fit, and the result is cropped and enlarged at once. The phone
     must lay out exactly like the browser — only the reader's own text size
     scales a page. */
  const states = fs.readFileSync(path.join(ROOT, 'css/states.css'), 'utf8');
  assert.doesNotMatch(states, /is-native[^{]*\{[^}]*\bzoom\s*:/,
    'the native shell must not rescale the page');
  assert.doesNotMatch(states, /is-native\[data-text[^{]*\{[^}]*\bzoom\s*:/,
    'the native shell must not override the reader\'s text size');

  /* Android's WebView may inflate text by itself when it judges a block of text
     small for the layout width (font boosting). It is off: 100% is 100%. */
  const base = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8');
  assert.match(base, /text-size-adjust:100%/, 'font boosting must be disabled');

  /* And the insets the Activity hands over are in CSS pixels: WindowInsets are
     physical pixels, so an undivided value asks a 3x phone for a 63px band. */
  const activity = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/java/com/Amirreza/daftarche/MainActivity.java'), 'utf8');
  assert.match(activity, /bars\.top \/ density/, 'horizontal insets must be converted by density');
  assert.match(activity, /bars\.bottom \/ density/, 'bottom insets must be converted by density');
});

test('the phone does not blur the page it is scrolling', () => {
  /* A backdrop blur on the dock is re-sampled on every frame the page moves,
     and the frosted themes put the same filter on every card; the modal scrim
     covers the viewport with one more. All three are gone on native, where the
     opaque surface tokens already carry the look. */
  const states = fs.readFileSync(path.join(ROOT, 'css/states.css'), 'utf8');
  assert.match(states, /html\.is-native \.bottom-nav\{backdrop-filter:none/, 'the dock must not blur on a phone');
  assert.doesNotMatch(states, /is-native \.bottom-nav\{backdrop-filter:blur/, 'the dock keeps no blur on a phone');
  assert.match(states, /html\.is-native \.overlay\{backdrop-filter:none/, 'the scrim must not blur on a phone');

  /* Long pages build below the fold on demand instead of on open. */
  assert.match(states, /content-visibility:auto/, 'offscreen sections must be render-lazy');

  /* The frosted themes go opaque on native instead of filtering every card. */
  const glass = fs.readFileSync(path.join(ROOT, 'css/glass.css'), 'utf8');
  assert.match(glass, /html\.is-native:is\(\[data-theme="aurora"\]\)?[\s\S]{0,120}--glass-fill:var\(--color-surface\)/,
    'frosted themes must use the solid surface on native');

  /* And the browser keeps its glass: the cost only matters where it is paid.
     The dock pays for one filter function, not a filter list — a saturate or a
     brightness after the blur is another pass over the backdrop on every frame
     the page moves, for a tint the dock's own gradient already carries. */
  const base = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8');
  assert.match(base, /backdrop-filter:blur\(8px\);/, 'the web dock keeps its glass');
  assert.doesNotMatch(base, /backdrop-filter:blur\([^;}]*saturate/, 'the dock pays for one filter, not a list');

  /* In a glass theme an in-flow card sits over the theme's own aurora — smooth
     radial gradients with nothing for a blur to smooth — so it is painted by
     its fill alone and takes no backdrop sample. Only the floating layer, which
     travels over live text, keeps a blur, and it keeps exactly one. */
  assert.doesNotMatch(glass, /saturate\(/, 'the glass themes keep one filter function, not a list');
  const cardRule = glass.match(/\.progress-card,[\s\S]*?\}/)[0];
  assert.doesNotMatch(cardRule, /backdrop-filter/, 'in-flow glass cards must not sample the page behind them');
  assert.match(glass, /\.bottom-nav,\.sheet,\.name-card\)\{[\s\S]{0,180}backdrop-filter:blur\(8px\);/,
    'the floating glass layer keeps its single blur');
});

test('every control owns a finger-sized hit area on the phone', () => {
  /* The chips, tabs and text buttons keep their drawn size — they are the
     design — and grow a 44px-tall strip of hit area around themselves. Vertical
     only: widening them would let a tap between two neighbours in a row land on
     the wrong one. The icon buttons carry their own expander in tasks.css. */
  const states = fs.readFileSync(path.join(ROOT, 'css/states.css'), 'utf8');
  assert.match(states, /height:max\(100%,44px\)/, 'controls must own a 44px hit strip');
  assert.match(states, /html\.is-native :is\(input,textarea,select\)\{scroll-margin-block:96px\}/,
    'a focused field must be able to clear the keyboard');
  assert.match(states, /user-select:none/, 'a long press on a control is not a text selection');

  /* The existing icon expanders must stay: a 16px dot with a 44px reach. */
  const tasks = fs.readFileSync(path.join(ROOT, 'css/tasks.css'), 'utf8');
  assert.match(tasks, /\.check::after\{content:'';position:absolute;inset:-9px/, 'the task checkbox must keep its reach');
  assert.match(tasks, /\.pri-dot::after\{content:'';position:absolute;inset:-14px/, 'the priority dot must keep its reach');
});

test('launcher icons in android res are the generated set, never a hand copy', async () => {
  const { androidIconFiles, syncAndroidIcons } = await import('../scripts/sync-icons.mjs');
  const files = androidIconFiles();
  assert.ok(files.length >= 15, 'the generator should write a launcher for every density');

  const result = syncAndroidIcons({ check: true });
  assert.equal(result.skipped, false, 'android project is missing');
  assert.deepEqual(result.stale, [],
    'run node scripts/sync-icons.mjs to copy the launcher set into android/app/src/main/res');
});
