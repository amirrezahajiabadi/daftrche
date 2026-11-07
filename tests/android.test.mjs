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
  assert.equal(config.plugins?.StatusBar?.overlaysWebView, false, 'StatusBar overlaysWebView must be false');
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
  assert.ok(mainActivity.includes('setDecorFitsSystemWindows(getWindow(), true)'), 'MainActivity must configure decor fits system windows');

  const stylesXmlPath = path.join(ROOT, 'android/app/src/main/res/values/styles.xml');
  assert.ok(fs.existsSync(stylesXmlPath), 'styles.xml missing');
  const stylesXml = fs.readFileSync(stylesXmlPath, 'utf8');
  assert.ok(stylesXml.includes('android:fitsSystemWindows">true'), 'styles.xml must set fitsSystemWindows');
  assert.ok(stylesXml.includes('android:windowFullscreen">false'), 'styles.xml must disable windowFullscreen');
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
