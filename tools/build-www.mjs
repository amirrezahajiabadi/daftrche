/* ═══ Build WWW for Android (Capacitor) ═══
   Copies the offline web shell files (defined in sw.js SHELL) plus vendored
   local assets (pdf.js) into the www/ directory for Capacitor packaging.
   Zero bundler, zero transpilation, pure web assets. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const WWW = path.resolve(ROOT, 'www');

// 1. Read version from js/version.js
const versionSource = fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8');
const releaseMatch = versionSource.match(/DAFTARCHE_RELEASE\s*=\s*['"]([^'"]+)['"]/);
const buildMatch = versionSource.match(/DAFTARCHE_BUILD\s*=\s*['"]([^'"]+)['"]/);

if (!releaseMatch || !buildMatch) {
  console.error('❌ Could not parse DAFTARCHE_RELEASE or DAFTARCHE_BUILD from js/version.js');
  process.exit(1);
}

const versionName = releaseMatch[1];
const buildStr = buildMatch[1];
const buildNum = parseInt(buildStr.replace(/\D/g, ''), 10) || 1;
const versionCode = buildNum * 100;

console.log(`📦 Building www for دَفتَرچه v${versionName} (Build: ${buildStr}, Code: ${versionCode})`);

// 2. Read SHELL from sw.js
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const shellMatch = swSource.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) {
  console.error('❌ Could not parse SHELL array from sw.js');
  process.exit(1);
}

const shellFiles = shellMatch[1]
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.startsWith("'") || line.startsWith('"'))
  .map(line => line.replace(/^['"]|['"],?$/g, ''));

console.log(`📋 Found ${shellFiles.length} files in sw.js SHELL`);

// 3. Prepare www directory
if (fs.existsSync(WWW)) {
  fs.rmSync(WWW, { recursive: true, force: true });
}
fs.mkdirSync(WWW, { recursive: true });

// 4. Copy SHELL files
let copiedCount = 0;
let totalBytes = 0;

for (const relPath of shellFiles) {
  // Service Worker is for Web PWA only, excluded from native Android APK assets
  if (relPath === 'sw.js') continue;
  const src = path.join(ROOT, relPath);
  if (!fs.existsSync(src)) {
    console.error(`❌ Missing shell file: ${relPath}`);
    process.exit(1);
  }
  const dest = path.join(WWW, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copiedCount++;
  totalBytes += fs.statSync(src).size;
}

// 5. Copy vendored pdf.js assets if they exist
const pdfjsSrc = path.join(ROOT, 'assets/vendor/pdfjs');
if (fs.existsSync(pdfjsSrc)) {
  const copyRecursive = (srcDir, destDir) => {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        copiedCount++;
        totalBytes += fs.statSync(srcPath).size;
      }
    }
  };
  copyRecursive(pdfjsSrc, path.join(WWW, 'assets/vendor/pdfjs'));
  console.log(`📚 Copied local pdf.js vendor assets`);
}

// 6. Write build-info.json into www
const buildInfo = {
  appName: 'دَفتَرچه',
  appId: 'com.Amirreza.daftarche',
  versionName,
  versionCode,
  build: buildStr,
  builtAt: new Date().toISOString(),
  fileCount: copiedCount,
  totalBytes,
};
fs.writeFileSync(path.join(WWW, 'build-info.json'), JSON.stringify(buildInfo, null, 2), 'utf8');

const mb = (totalBytes / (1024 * 1024)).toFixed(2);
console.log(`✅ Successfully built www/: ${copiedCount} files (${mb} MB)`);
console.log(`   versionName: ${versionName}, versionCode: ${versionCode}`);
