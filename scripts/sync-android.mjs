#!/usr/bin/env node
/* ═══ Sync the web app into the Android project ═══
   One command that makes android/ a photograph of the web app that is in the
   repository right now — nothing older, nothing missing, nothing extra.

     node scripts/sync-android.mjs

   What it does, in order:

     1. verifies that index.html and CSS files use relative paths (no leading /);
     2. builds www/ from the service worker's SHELL list (excluding sw.js);
     3. reads DAFTARCHE_RELEASE / DAFTARCHE_BUILD out of js/version.js, the one
        place a release number is written, and turns them into the versionName
        and versionCode the stores expect;
     4. writes that identity into www/build-info.json and android/app/build.gradle;
     5. copies assets/icons/android/mipmap-* over res/mipmap-* when the bytes
        differ;
     6. runs `npx cap sync android` to sync into android/app/src/main/assets/public;
     7. ensures sw.js is excluded from the Android assets/public folder;
     8. runs `npm test` to verify all test suites are green.
*/

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncAndroidIcons } from './sync-icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const ANDROID = path.join(ROOT, 'android');
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const CODE_LEDGER = path.join(ANDROID, 'version-code.json');

const say = (...args) => console.log(...args);

/* ── 0. Guard: Verify relative paths ── */
function verifyRelativePaths() {
  say('🔍 بررسی مسیرهای نسبی در index.html و فایل‌های CSS…');
  const filesToCheck = [
    path.join(ROOT, 'index.html'),
    ...fs.readdirSync(path.join(ROOT, 'css'))
      .filter(f => f.endsWith('.css'))
      .map(f => path.join(ROOT, 'css', f)),
  ];

  const absolutePattern = /(?:href|src)\s*=\s*["']\/[^/]|url\(\s*["']?\/[^/]/i;
  for (const file of filesToCheck) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(absolutePattern);
    if (match) {
      console.error(`❌ مسیر مطلق در ${path.relative(ROOT, file)} شناسایی شد: ${match[0]}`);
      process.exit(1);
    }
  }
}

/* ── 1. Version identity ── */
function readVersion() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8');
  const release = source.match(/DAFTARCHE_RELEASE\s*=\s*['"]([^'"]+)['"]/);
  const build = source.match(/DAFTARCHE_BUILD\s*=\s*['"]([^'"]+)['"]/);
  if (!release || !build) {
    console.error('❌ js/version.js has no DAFTARCHE_RELEASE / DAFTARCHE_BUILD to read');
    process.exit(1);
  }
  const buildNum = parseInt(build[1].replace(/\D/g, ''), 10);
  if (!Number.isInteger(buildNum) || buildNum < 1) {
    console.error(`❌ DAFTARCHE_BUILD ('${build[1]}') carries no build number`);
    process.exit(1);
  }
  return { release: release[1], build: build[1], buildNum };
}

function lastCode() {
  try {
    const ledger = JSON.parse(fs.readFileSync(CODE_LEDGER, 'utf8'));
    return Number(ledger.versionCode) || 0;
  } catch { return 0; }
}

/* ── 2. Build www/ ── */
function buildWww() {
  say('📦 ۱. ساخت www از فهرست SHELL سرویس‌ورکر (بدون sw.js)…');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-www.mjs')], {
    cwd: ROOT, stdio: 'inherit',
  });
  const wwwSw = path.join(WWW, 'sw.js');
  if (fs.existsSync(wwwSw)) {
    fs.rmSync(wwwSw, { force: true });
  }
}

/* ── 3. Stamp the version on build-info.json and back into build.gradle ── */
function stampVersion(version, code) {
  const infoPath = path.join(WWW, 'build-info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  info.versionName = version.release;
  info.versionCode = code;
  info.build = version.build;
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf8');

  const gradle = fs.readFileSync(GRADLE, 'utf8');
  const next = gradle
    .replace(/(def appVersionCode = \(buildInfo\?\.versionCode as Integer\) \?: )\d+/,
      `$1${code}`)
    .replace(/(def appVersionName = \(buildInfo\?\.versionName as String\) \?: )"[^"]*"/,
      `$1"${version.release}"`);
  if (next !== gradle) {
    fs.writeFileSync(GRADLE, next, 'utf8');
    say(`🔢 build.gradle: versionName «${version.release}» · versionCode ${code}`);
  }

  fs.writeFileSync(CODE_LEDGER, JSON.stringify({
    versionName: version.release,
    versionCode: code,
    build: version.build,
    updatedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');

  return info;
}

/* ── 4. Launcher icons ── */
function syncIcons() {
  const result = syncAndroidIcons();
  if (result.skipped) {
    say('🎨 پوشهٔ res اندروید نیست؛ از آیکن‌ها گذشتم.');
    return 0;
  }
  return result.copied.length;
}

/* ── 5. Capacitor: copy www/ into the APK's assets and update the plugins ── */
function capSync() {
  say('🔌 ۴. npx cap sync android…');
  const command = 'npx cap sync android';
  const result = spawnSync(command, {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });
  if (result.status !== 0) {
    console.error('❌ cap sync failed');
    process.exit(result.status || 1);
  }
}

/* ── 6. Clean service worker from Android assets ── */
function cleanAndroidAssets() {
  const assetsSw = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'public', 'sw.js');
  if (fs.existsSync(assetsSw)) {
    fs.rmSync(assetsSw, { force: true });
    say('🧹 حذف sw.js از پوشه assets/public اندروید انجام شد.');
  }
}

/* ── 7. Run npm test suite ── */
function runTests() {
  say('🧪 اجرای آزمون‌های خودکار (npm test)…');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['test'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('❌ npm test با شکست مواجه شد.');
    process.exit(result.status || 1);
  }
  say('✅ تمام آزمون‌ها با موفقیت پاس شدند.');
}

/* ── Run ── */
verifyRelativePaths();

const version = readVersion();
say(`🚀 دَفتَرچه ${version.release} · ${version.build}`);

buildWww();

const naturalCode = version.buildNum * 100;
const previous = lastCode();
const code = naturalCode < previous ? previous + 1 : naturalCode;
if (code !== naturalCode) {
  say(`⚠️  کد ساخت در js/version.js (${naturalCode}) از آخرین کد استفاده‌شده `
    + `(${previous}) کمتر است؛ ${code} استفاده شد تا استور آپدیت را بپذیرد.`);
}

const info = stampVersion(version, code);

const icons = syncIcons();
say(icons
  ? `🎨 ${icons} فایل آیکن تازه به res/mipmap-* کپی شد`
  : '🎨 آیکن‌های لانچر از قبل همگام بودند');

capSync();
cleanAndroidAssets();

const assets = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'public');
const size = (dir, total = 0) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
};
const mb = (size(assets) / (1024 * 1024)).toFixed(2);

say('');
say('========================================');
say(`✅ همگام شد: اندروید حالا همان وب‌اپ است`);
say(`📁 assets/public: ${info.fileCount} فایل · ${mb} مگابایت`);
say(`🏷  versionName ${info.versionName} · versionCode ${info.versionCode} · ${info.build}`);
say('========================================');

runTests();
