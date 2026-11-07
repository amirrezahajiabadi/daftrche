import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const REFERENCES = ['index.html', 'manifest.webmanifest'];

/* The generator writes the Android launcher set under assets/; Android itself
   only reads mipmap-* inside its own res/. These two sides are kept together
   here so `npm run icons` is the whole pipeline — no icon is ever copied by
   hand, and a launcher can never lag behind the web icon it was rendered from. */
const ANDROID_SOURCE = new URL('assets/icons/android/', ROOT);
const ANDROID_RES = new URL('android/app/src/main/res/', ROOT);

export function iconURL(path, bytes = readFileSync(new URL(path, ROOT))) {
  const fingerprint = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `${path}?asset=${fingerprint}`;
}

export function syncIconReferences(content) {
  return content.replace(/assets\/icons\/[\w.-]+(?:\?asset=[a-f\d]+)?/g, reference => {
    return iconURL(reference.split('?')[0]);
  });
}

/* The rasters are not drawn here: every icon is generated edge to edge from the
   single master (assets/icons/master-logo.jpg) by scripts/generate-icons.py —
   a full-bleed green felt square with the face and pocket inside the central
   safe zone, plus the transparent squircle master. There is no cream padding
   box and no background: the felt runs to every edge. This module regenerates
   those files, copies the Android launcher set into res/, and then fingerprints
   the resulting URLs. */
export function generateIcons({ quiet = false } = {}) {
  const script = fileURLToPath(new URL('generate-icons.py', import.meta.url));
  if (!existsSync(script)) throw new Error(`Missing generator: ${script}`);
  const interpreters = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);
  for (const python of interpreters) {
    const result = spawnSync(python, [script], {
      stdio: quiet ? 'pipe' : 'inherit',
      encoding: 'utf8',
    });
    if (result.error?.code === 'ENOENT') continue;
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${python} scripts/generate-icons.py failed (${result.status})\n${result.stderr || ''}`);
    }
    return python;
  }
  throw new Error('No Python interpreter found; install Python 3 with Pillow to regenerate icons');
}

/* Every generated launcher file, named the way the Android project expects it:
   mipmap-<density>/ic_launcher.png and friends. */
export function androidIconFiles() {
  if (!existsSync(ANDROID_SOURCE)) return [];
  return readdirSync(ANDROID_SOURCE, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .flatMap(dir => readdirSync(new URL(`${dir}/`, ANDROID_SOURCE))
      .filter(name => name.endsWith('.png'))
      .sort()
      .map(name => `${dir}/${name}`));
}

const sameBytes = (a, b) => existsSync(a) && existsSync(b) &&
  createHash('sha256').update(readFileSync(a)).digest('hex') ===
  createHash('sha256').update(readFileSync(b)).digest('hex');

/* Copy the generated launcher set into the Android project. With check: true
   nothing is written and the files that would change are returned instead, so a
   stale res/ fails loudly rather than silently shipping the old launcher. */
export function syncAndroidIcons({ check = false } = {}) {
  if (!existsSync(ANDROID_RES)) return { skipped: true, copied: [], stale: [] };
  const copied = [];
  const stale = [];
  for (const rel of androidIconFiles()) {
    const source = new URL(rel, ANDROID_SOURCE);
    const target = new URL(rel, ANDROID_RES);
    if (sameBytes(source, target)) continue;
    if (check) { stale.push(`android/app/src/main/res/${rel}`); continue; }
    mkdirSync(new URL('./', target), { recursive: true });
    copyFileSync(source, target);
    copied.push(`android/app/src/main/res/${rel}`);
  }
  return { skipped: false, copied, stale };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const check = process.argv.includes('--check');
  if (!check) {
    try {
      generateIcons();
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
  }
  let stale = false;
  for (const path of REFERENCES) {
    const target = new URL(path, ROOT);
    const content = readFileSync(target, 'utf8');
    const updated = syncIconReferences(content);
    if (content === updated) continue;
    stale = true;
    if (check) {
      console.error(`Stale icon URLs in ${path}; run node scripts/sync-icons.mjs`);
    } else {
      writeFileSync(target, updated, 'utf8');
      console.log(`Updated icon URLs in ${path}`);
    }
  }
  const android = syncAndroidIcons({ check });
  if (android.skipped) {
    console.log('Skipping Android launcher icons: no android/ project in this checkout');
  } else if (check) {
    for (const path of android.stale) {
      stale = true;
      console.error(`Stale launcher icon: ${path}; run node scripts/sync-icons.mjs`);
    }
  } else if (android.copied.length) {
    console.log(`Copied ${android.copied.length} launcher icon(s) into android/app/src/main/res`);
  }
  if (stale && check) process.exitCode = 1;
}
