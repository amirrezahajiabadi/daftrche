/* ═══ Capture Mobile Screenshots for Android Release / App Stores ═══
   Screenshots in iPhone 14 mobile viewport (390×844 @ 3x DPR = 1170×2532 px).
   Covers 8 key sections with rich study, fitness/sports, habits, and reading scenarios:
     1. docs/screenshots/01-today.png        (امروز — همراه با اهداف مطالعه و پیشنهاد همدم)
     2. docs/screenshots/02-tasks.png        (کارها — دسته‌بندی درسی، ورزشی، زمان‌بندی و اولویت)
     3. docs/screenshots/03-focus.png        (فوکوس — نشست پومودورو حل تمرین ریاضی، صداهای طبیعت و موسیقی)
     4. docs/screenshots/04-library.png      (کتابخانه — عادت‌های اتمی، انسان در جستجوی معنی و آمار مطالعه)
     5. docs/screenshots/05-stats.png        (آمار — نمودار تحلیلی ۷ روز، ساعات تمرکز، پیوستگی و تفکیک دسته‌ها)
     6. docs/screenshots/06-achievements.png (نشان‌ها — تالار افتخارات، رتبه، مدال‌ها و دستاوردهای بازشده)
     7. docs/screenshots/07-themes.png       (تم‌ها و دنیاها — ویترین ۱۶ پوستهٔ ایرانی و دنیاهای پویا)
     8. docs/screenshots/08-profile.png      (پروفایل — شناسنامه کاربری، همدم قورقوری و کپسول شناور پومودورو)
*/

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'docs', 'screenshots');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cleanPath = decodeURIComponent(url.pathname);
      const rel = (cleanPath === '/' || cleanPath === '') ? 'index.html' : cleanPath.replace(/^\/+/, '');
      const filePath = join(ROOT, rel);
      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found: ' + req.url);
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  console.log(`📡 Local server listening on http://127.0.0.1:${port}`);

  const userDataDir = await mkdtemp(join(tmpdir(), 'chrome-ss-'));
  console.log(`🌐 Launching headless Chrome...`);

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const cdpPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome CDP timeout')), 10000);
    chrome.stderr.on('data', d => {
      const m = d.toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });

  console.log(`🔌 Chrome listening on CDP port ${cdpPort}`);

  const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) throw new Error('No page target found');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  // Exact 9:16 mobile aspect ratio: 450 × 800 CSS pixels @ 2x DPR = 900 × 1600 physical pixels
  // Ratio: 900 / 1600 = 9 / 16 (0.5625), max dimension 1600 <= 3000px, file size < 3MB
  await send('Emulation.setDeviceMetricsOverride', {
    width: 450,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
    fitWindow: false,
  });

  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  });

  // Calculate day keys
  const now = new Date();
  const getDayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayKeyToday = getDayKey(now);

  const tomorrowDt = new Date(now);
  tomorrowDt.setDate(tomorrowDt.getDate() + 1);
  const tomorrowKey = getDayKey(tomorrowDt);

  // Rich sample data for Study, Fitness/Sports, Habits, and Reading
  const seedScript = `
    try {
      localStorage.setItem('theme', 'kashi');
      localStorage.setItem('daftarche-name', 'امیررضا');
      localStorage.setItem('daftarche-firstseen', '2026-04-10');
      localStorage.setItem('daftarche-tour-complete', 'yes');
      localStorage.setItem('daftarche-tour-awarded', 'yes');
      localStorage.setItem('daftarche-goal', 'tasks');
      localStorage.setItem('daftarche-seen-version', '3.4.0');
      localStorage.setItem('daftarche-ios-guide-dismissed', '1');
      localStorage.setItem('daftarche-streak-freeze', '1');
      localStorage.setItem('daftarche-avatar', 'qorqori');

      // Moods: past 7 days
      const moods = {};
      const moodValues = [5, 4, 5, 4, 5, 4, 5];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 864e5);
        const dk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        moods[dk] = moodValues[i];
      }
      localStorage.setItem('daftarche-moods', JSON.stringify(moods));

      // Realistic tasks (Study, Sports/Fitness, Habits, Reading)
      const sampleTasks = [
        {
          id: 't-1',
          text: 'حل تمرین‌های ریاضی و آمار دانشگاه',
          done: false,
          p: 'high',
          cat: 'study',
          dueDate: '${dayKeyToday}',
          durationMin: 45,
          timeFrom: 16 * 60,
          timeTo: 17 * 60 + 30,
          created: Date.now() - 3600000
        },
        {
          id: 't-2',
          text: 'مرور لغات تخصصی و تمرین اسپیکینگ زبان',
          done: false,
          p: 'mid',
          cat: 'study',
          dueDate: '${dayKeyToday}',
          durationMin: 30,
          timeFrom: 18 * 60,
          timeTo: 18 * 60 + 30,
          created: Date.now() - 7200000
        },
        {
          id: 't-3',
          text: '۴۵ دقیقه تمرین بدنسازی و کشش در باشگاه',
          done: true,
          doneAt: Date.now() - 3600000,
          p: 'high',
          cat: 'health',
          dueDate: '${dayKeyToday}',
          durationMin: 45,
          created: Date.now() - 10000000
        },
        {
          id: 't-4',
          text: 'دویدن صبحگاهی در پارک و تمرین تنفس عمیق',
          done: true,
          doneAt: Date.now() - 7200000,
          p: 'low',
          cat: 'health',
          dueDate: '${dayKeyToday}',
          durationMin: 20,
          created: Date.now() - 14000000
        },
        {
          id: 't-5',
          text: 'خلاصه‌نویسی مباحث آزمون پایان‌ترم',
          done: false,
          p: 'high',
          cat: 'study',
          dueDate: '${tomorrowKey}',
          durationMin: 60,
          created: Date.now() - 2000000
        },
        {
          id: 't-6',
          text: 'پیاده‌روی عصرگاهی و استراحت چشم',
          done: false,
          p: 'low',
          cat: 'health',
          dueDate: '${tomorrowKey}',
          durationMin: 15,
          created: Date.now() - 1500000
        },
        {
          id: 't-7',
          text: 'خرید مکمل ورزشی و تغذیه سالم',
          done: false,
          p: 'low',
          cat: 'shopping',
          dueDate: '${tomorrowKey}',
          durationMin: null,
          created: Date.now() - 1000000
        }
      ];

      // Add completed history tasks across past 7 days for the stats chart
      for (let i = 1; i < 7; i++) {
        const d = new Date(Date.now() - i * 864e5);
        const dk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        sampleTasks.push(
          {
            id: 't-hist-a-' + i,
            text: 'مطالعه مباحث درسی روز ' + i,
            done: true,
            doneAt: d.getTime() - 2 * 3600000,
            p: 'mid',
            cat: 'study',
            dueDate: dk,
            durationMin: 40,
            created: d.getTime() - 5 * 3600000
          },
          {
            id: 't-hist-b-' + i,
            text: 'تمرین ورزشی و تحرک روز ' + i,
            done: true,
            doneAt: d.getTime() - 4 * 3600000,
            p: 'high',
            cat: 'health',
            dueDate: dk,
            durationMin: 30,
            created: d.getTime() - 6 * 3600000
          }
        );
      }
      localStorage.setItem('daftarche-v1', JSON.stringify(sampleTasks));

      // Realistic books
      const sampleBooks = [
        {
          id: 'b-1',
          title: 'عادت‌های اتمی — جیمز کلیر',
          numPages: 320,
          completedPages: Array.from({ length: 180 }, (_, i) => i + 1),
          lastPage: 181,
          goal: { pagesPerDay: 20 },
          highlights: [
            { text: 'تغییرات کوچک نتایج شگفت‌انگیز ایجاد می‌کنند', page: 24 },
            { text: 'شما به سطح اهدافتان نمی‌رسید، بلکه به سطح سیستم‌هایتان سقوط می‌کنید', page: 62 }
          ],
          notes: [{ text: 'قانون ۲ دقیقه‌ای برای شروع تمرین ورزشی بسیار کارساز است', page: 48 }],
          stats: {
            '${dayKeyToday}': { pages: 15, minutes: 30 }
          }
        },
        {
          id: 'b-2',
          title: 'انسان در جستجوی معنی — ویکتور فرانکل',
          numPages: 210,
          completedPages: Array.from({ length: 105 }, (_, i) => i + 1),
          lastPage: 106,
          goal: { pagesPerDay: 15 },
          highlights: [
            { text: 'کسی که چرایی برای زندگی دارد با هر چگونگی خواهد ساخت', page: 85 }
          ],
          notes: [{ text: 'فصل اراده معطوف به معنا فوق‌العاده الهام‌بخش بود', page: 85 }],
          stats: {
            '${dayKeyToday}': { pages: 10, minutes: 25 }
          }
        },
        {
          id: 'b-3',
          title: 'تفکر سریع و کند — دانیل کانمن',
          numPages: 450,
          completedPages: Array.from({ length: 450 }, (_, i) => i + 1),
          lastPage: 450,
          goal: { pagesPerDay: 15 },
          highlights: [],
          notes: [],
          stats: {}
        }
      ];
      localStorage.setItem('daftarche-books-meta', JSON.stringify(sampleBooks));

      // Active focus session (25 mins, 5 mins elapsed -> 20:00 remaining on Math study)
      const focusSession = {
        id: 'f-1',
        taskId: 't-1',
        startedAt: Date.now() - 5 * 60 * 1000,
        plannedDurationMin: 25,
        activeMs: 5 * 60 * 1000,
        runStartedAt: Date.now() - 5 * 60 * 1000,
        status: 'active',
        taskCompleted: null,
        rating: null
      };
      localStorage.setItem('daftarche-focus-session', JSON.stringify(focusSession));

      // Focus settings
      localStorage.setItem('daftarche-scene', 'rain');
      localStorage.setItem('daftarche-ambsound', '1');
      localStorage.setItem('daftarche-music', 'spring');

      // Focus history for past days
      const focusHistory = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 864e5);
        focusHistory.push({
          id: 'h-' + i,
          taskId: 't-1',
          taskTitle: i % 2 === 0 ? 'حل تمرین‌های ریاضی و آمار دانشگاه' : 'تمرین زبان و لغات تخصصی',
          startedAt: d.getTime() - 60 * 60 * 1000,
          endedAt: d.getTime() - 35 * 60 * 1000,
          plannedDurationMin: 25,
          actualDurationMin: 25,
          taskCompleted: true,
          rating: 'good'
        });
      }
      localStorage.setItem('daftarche-focus-history', JSON.stringify(focusHistory));

      // Unlocked achievements & ledger stats
      const achievements = {
        baselineAt: '2026-04-10',
        unlocked: {
          'first-step': { tier: 3, at: '2026-04-12' },
          'chain': { tier: 3, at: '2026-05-01' },
          'focus-minutes': { tier: 2, at: '2026-05-15' },
          'pages': { tier: 3, at: '2026-06-01' },
          'night-owl': { tier: 2, at: '2026-06-10' },
          'active-days': { tier: 2, at: '2026-07-01' },
          'first-note': { tier: 3, at: '2026-07-15' },
          'hard-worker': { tier: 2, at: '2026-08-01' },
          'early-bird': { tier: 2, at: '2026-08-20' },
          'tour-intro': { tier: 1, at: '2026-04-10' }
        },
        recSeen: {}
      };
      localStorage.setItem('daftarche-achievements', JSON.stringify(achievements));

      // Ledger for streak and consistent stats
      const ledgerDays = {};
      for (let i = 0; i < 14; i++) {
        const d = new Date(Date.now() - i * 864e5);
        const dk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        ledgerDays[dk] = {
          done: 3 + (i % 3),
          focusMin: 25 + (i % 2) * 25,
          sessions: 1 + (i % 2)
        };
      }
      localStorage.setItem('daftarche-ledger', JSON.stringify({ v: 1, seededAt: '2026-04-10', days: ledgerDays }));
    } catch (e) {
      console.error('Seed error:', e);
    }
  `;

  await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript });

  console.log(`🚀 Navigating to app...`);
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/#today` });

  // Wait for load and fonts
  await new Promise(res => {
    const handler = e => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Page.loadEventFired') {
        ws.removeEventListener('message', handler);
        res();
      }
    };
    ws.addEventListener('message', handler);
  });

  // Evaluate wait for fonts and layout
  await send('Runtime.evaluate', {
    expression: `
      new Promise(async (resolve) => {
        if (document.fonts) await document.fonts.ready;
        setTimeout(resolve, 800);
      })
    `,
    awaitPromise: true,
  });

  const captureScreen = async (filename) => {
    // Hide scrollbars and any temporary banner overlays if present
    await send('Runtime.evaluate', {
      expression: `
        document.body.style.overflow = 'hidden';
        const banner = document.getElementById('iosInstallBanner');
        if (banner) banner.hidden = true;
        const nameOv = document.getElementById('nameOverlay');
        if (nameOv) nameOv.hidden = true;
        const obOv = document.getElementById('onboardOverlay');
        if (obOv) obOv.hidden = true;
        const tour = document.getElementById('tourOverlay');
        if (tour) tour.remove();
        const chg = document.getElementById('changelogOverlay');
        if (chg) chg.remove();
      `
    });

    const res = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = join(OUT_DIR, filename);
    await writeFile(outPath, buffer);
    console.log(`📸 Saved screenshot: ${filename} (${buffer.length} bytes)`);
  };

  const navigateTo = async (page) => {
    await send('Runtime.evaluate', {
      expression: `
        new Promise((resolve) => {
          window.dispatchEvent(new CustomEvent('navigate', { detail: '${page}' }));
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
        })
      `,
      awaitPromise: true,
    });
  };

  console.log(`📸 Capturing all 8 requested screenshots...`);

  // 1. امروز (Today)
  await navigateTo('today');
  await captureScreen('01-today.png');

  // 2. کارها (Tasks)
  await navigateTo('tasks');
  await captureScreen('02-tasks.png');

  // 3. فوکوس (Focus) — با کاراکتر فکرباز، رینگ پومودورو حل تمرین ریاضی و پنل صوتی باز
  await navigateTo('focus');
  await send('Runtime.evaluate', {
    expression: `
      document.body.classList.add('focus-sound-open');
      document.querySelectorAll('#page-focus .vibe-card').forEach(el => el.classList.add('open'));
      const toggle = document.getElementById('focusSoundToggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    `
  });
  await captureScreen('03-focus.png');

  // 4. کتابخونه (Library)
  await navigateTo('library');
  await captureScreen('04-library.png');

  // 5. آمار (Stats)
  await navigateTo('stats');
  await send('Runtime.evaluate', {
    expression: `
      window.scrollTo(0, 0);
      new Promise(r => setTimeout(r, 400));
    `,
    awaitPromise: true,
  });
  await captureScreen('05-stats.png');

  // 6. نشان‌ها (Achievements)
  await navigateTo('achv');
  await send('Runtime.evaluate', {
    expression: `
      window.scrollTo(0, 0);
      new Promise(r => setTimeout(r, 400));
    `,
    awaitPromise: true,
  });
  await captureScreen('06-achievements.png');

  // 7. تم‌ها و دنیاها (Themes & Worlds in Settings)
  await navigateTo('settings');
  await send('Runtime.evaluate', {
    expression: `
      const tabThemes = document.getElementById('settingsTabThemes');
      if (tabThemes) tabThemes.click();
      const pickerCard = document.querySelectorAll('#settingsPanelThemes .vibe-card')[1];
      if (pickerCard) {
        pickerCard.scrollIntoView({ block: 'start' });
      } else {
        window.scrollTo(0, 160);
      }
      new Promise(r => setTimeout(r, 400));
    `,
    awaitPromise: true,
  });
  await captureScreen('07-themes.png');

  // 8. پروفایل (Profile)
  await navigateTo('profile');
  await send('Runtime.evaluate', {
    expression: `
      window.scrollTo(0, 0);
      new Promise(r => setTimeout(r, 400));
    `,
    awaitPromise: true,
  });
  await captureScreen('08-profile.png');

  console.log(`✅ All 8 screenshots captured successfully in ${OUT_DIR}!`);

  ws.close();
  chrome.kill();
  server.close();
  try {
    await rm(userDataDir, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error capturing screenshots:', err);
  process.exit(1);
});
