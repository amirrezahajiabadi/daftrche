#!/usr/bin/env node
/* ═══ Build the Android APK from this terminal ═══

     node scripts/build-apk.mjs            # release: tests → sync → assembleRelease
     node scripts/build-apk.mjs --debug    # debug:   sync → assembleDebug
     node scripts/build-apk.mjs --skip-test

   The same command on Windows, macOS and Linux: the only platform-specific
   parts are the Gradle wrapper's file name and the default place the JDK and the
   Android SDK usually live, and both are decided here rather than in package.json
   (which cannot know which shell it will be read by).

   A release is signed with android/keystore.properties + the .jks it names. If
   those are missing the build still runs — android/app/build.gradle falls back to
   an unsigned release — but the result cannot be uploaded to Myket or Cafe
   Bazaar, so that case is called out at the end instead of being left as a
   surprise at upload time. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');

const argv = new Set(process.argv.slice(2));
const debug = argv.has('--debug');
const skipTest = argv.has('--skip-test');
const task = debug ? 'assembleDebug' : 'assembleRelease';
const folder = debug ? 'debug' : 'release';
const apkName = debug ? 'app-debug.apk' : 'app-release.apk';

const say = (...args) => console.log(...args);
const fail = message => { console.error(`\n❌ ${message}\n`); process.exit(1); };

/* ── Toolchain ──
   JAVA_HOME and ANDROID_HOME come from the environment when they are set;
   otherwise the usual install locations are probed, because a Git Bash window on
   Windows rarely carries either. */
function pickJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\jdk21\\jdk-21.0.12.1+1',
    '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    '/usr/lib/jvm/java-21-openjdk-amd64',
  ].filter(Boolean);
  for (const dir of candidates) {
    const java = path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(java)) return dir;
  }
  return process.env.JAVA_HOME || null;
}

function pickAndroidHome() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(dir)) || null;
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
};

/* Windows runs the Gradle wrapper through cmd.exe; anywhere else it is a plain
   executable. The command is passed as one string when a shell is involved,
   because Node warns about pairing `args` with `shell: true`. */
const runGradle = (task) => {
  /* Absolute path: the wrapper is resolved by the shell, and a relative
     «gradlew.bat» is not on PATH even with the right working directory. */
  const wrapper = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const command = process.platform === 'win32' ? `"${wrapper}" ${task}` : wrapper;
  const args = process.platform === 'win32' ? [] : [task];
  const result = spawnSync(command, args, {
    cwd: ANDROID,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, JAVA_HOME: pickJavaHome(), ANDROID_HOME: pickAndroidHome() },
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

/* ── 1. Tests ──
   A release build that ships a failing tree is a release nobody can roll back
   from a store quickly, so the suite runs first and its failure stops the build
   before anything is signed. Debug builds skip it: they exist to be tried. */
if (!debug && !skipTest) {
  say('🧪 ۱. اجرای تست‌ها…');
  run(process.execPath, ['--test'], { cwd: ROOT });
}

/* ── 2. Web → Android ── */
say(`\n🔄 ۲. همگام‌سازی وب‌اپ با اندروید…`);
run(process.execPath, [path.join(ROOT, 'scripts', 'sync-android.mjs')], { cwd: ROOT });

const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'www', 'build-info.json'), 'utf8'));
say(`\n🏷  ${info.versionName} · ${info.build} · versionCode ${info.versionCode}`);

/* ── 3. Gradle ── */
const javaHome = pickJavaHome();
const androidHome = pickAndroidHome();
if (!javaHome) fail('JDK پیدا نشد. JAVA_HOME را تنظیم کنید (JDK 21).');
if (!androidHome) fail('Android SDK پیدا نشد. ANDROID_HOME را تنظیم کنید.');

say(`\n🔨 ۳. ${task}…`);
runGradle(task);

/* ── 4. Report ── */
const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', folder, apkName);
if (!fs.existsSync(apk)) fail(`فایل ${apkName} در پوشهٔ خروجی نبود.`);

const dist = path.join(ROOT, 'dist');
fs.mkdirSync(dist, { recursive: true });
const copy = path.join(dist, debug ? 'daftarche-debug.apk' : 'daftarche.apk');
fs.copyFileSync(apk, copy);

const mb = (fs.statSync(copy).size / (1024 * 1024)).toFixed(2);
const signed = fs.existsSync(path.join(ANDROID, 'keystore.properties'));

say('');
say('========================================');
say(debug ? '🐞 APK دیباگ آماده است' : '🎉 APK ریلیز آماده است');
say(`📦 ${copy}`);
say(`⚖️  ${mb} مگابایت · ${info.versionName} (${info.versionCode})`);
say(`🗂  خروجی گریدل: ${apk}`);
if (!debug && !signed) {
  say('⚠️  keystore.properties پیدا نشد؛ این خروجی امضای انتشار ندارد و برای مایکت/بازار قابل آپلود نیست.');
}
say('========================================');
