/* ═══ Settings — the page the profile's last card moved to ═══
   The rows themselves are older than this file: they were written at the foot of
   the profile, and the ids they answer to («themeModeSwitch», «themeSwatches»,
   «profFreezeBtn», «profClear») have not changed, so the theme picker, the
   achievements engine and the header switch all keep working without knowing the
   markup moved. What lives here is the page around them: what it paints when it
   is opened, and the two buttons that only exist on it.

   It is a page rather than a dialog because nothing here is an answer to the
   moment. Every row is a lasting choice, and a page can be left the way it was
   entered — the back control the shell adds above the header, the browser's own
   back, or the Android gesture (js/app.js). */

import { $, faNum } from './utils.js';
import { state, normalizeTask } from './state.js';
import { markThemePicker, isAutoTheme, setAutoTheme, unlockedThemesCount, totalThemesCount } from './theme.js';
import { APP_VERSION, openReleaseNotes } from './changelog.js';
import { startTour } from './tour.js';
import { clearLibraryData, exportBookPack, importBookPack, reloadBooks } from './library.js';
import { clearUserAudioData } from './audio.js';
import { renderBirthdayRow } from './birthday.js';
import { openShortcuts } from './shortcuts.js';
import { TEXT_SIZES, loadTextSize, saveTextSize } from './textsize.js';
import { markBackupDone } from './backup-nudge.js';
import { collectBackup, parseBackup, applyBackup, mergeBackup, backupFileName, BACKUP_MAX_CHARS } from './backup.js';
import { confirmDialog, showNotice } from './dialog.js';
import { clearAll, flushPending, resetPending, loadTasks, loadName, loadHistory, loadMoods, loadPomo } from './store.js';
import { systemReducedMotion, userReducedMotion, setUserReducedMotion } from './motion.js';
import { isNative, saveAndShareBlob } from './native.js';
import { notify } from './bus.js';
import { invalidateAllBuckets } from './daycache.js';
import { renderList } from './tasks.js';
import { renderToday } from './today.js';
import { renderProfile } from './profile.js';
import { renderAchievements } from './achievementsview.js';
import { renderPlanner } from './planner.js';

let activeSettingsTab = 'general';
let updateStatus = 'idle';
let cachedRemoteRelease = null;

export function switchSettingsTab(tabKey) {
  const validTabs = ['general', 'themes', 'updates'];
  const target = validTabs.includes(tabKey) ? tabKey : 'general';
  activeSettingsTab = target;

  const tabBtns = document.querySelectorAll('.settings-tab');
  tabBtns.forEach(btn => {
    const isSel = btn.dataset.settingsTab === target;
    btn.classList.toggle('sel', isSel);
    btn.setAttribute('aria-selected', String(isSel));
    btn.setAttribute('tabindex', isSel ? '0' : '-1');
  });

  const panels = document.querySelectorAll('.settings-panel');
  panels.forEach(panel => {
    const match = panel.dataset.settingsPanel === target;
    panel.hidden = !match;
  });

  renderSettingsThemeCount();
  if (target === 'updates') {
    renderUpdateSection();
  }
}

export function currentSettingsTab() {
  return activeSettingsTab;
}

export function renderSettingsThemeCount() {
  const countEl = $('#settingsThemeCount');
  if (countEl) {
    const unlocked = unlockedThemesCount();
    countEl.textContent = faNum(unlocked);
    countEl.setAttribute('aria-label', `${faNum(unlocked)} تم باز شده از ${faNum(totalThemesCount())}`);
  }
}

export function ensureSettingsElementVisible(elOrSelector) {
  const el = typeof elOrSelector === 'string' ? $(elOrSelector) : elOrSelector;
  if (!el) return;
  const panel = el.closest('.settings-panel');
  if (panel?.dataset?.settingsPanel) {
    switchSettingsTab(panel.dataset.settingsPanel);
  }
}

export function renderUpdateSection() {
  const badge = $('#updateStatusBadge');
  const btn = $('#checkUpdateBtn');
  const statusEl = $('#checkUpdateStatus');
  const actionLabel = $('#checkUpdateActionLabel');
  const tabBadge = $('#settingsUpdateBadge');
  const progressWrap = $('#checkUpdateProgress');

  if (updateStatus === 'installing' || updateStatus === 'downloading') return;

  if (isNative()) {
    if (badge) {
      badge.textContent = 'به‌روز';
      badge.className = 'update-status-badge ok';
    }
    if (statusEl) {
      statusEl.textContent = 'نسخهٔ نصب‌شده به‌روز است. دریافت نسخه‌های تازه از طریق مایکت و بازار انجام می‌شود.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'بررسی آپدیت';
    }
    if (actionLabel) actionLabel.textContent = 'وضعیت نسخه';
    if (tabBadge) tabBadge.hidden = true;
    if (progressWrap) progressWrap.hidden = true;
    return;
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg?.waiting) {
        markUpdateAvailable({ remoteRelease: cachedRemoteRelease });
      } else if (reg?.installing) {
        const worker = reg.installing;
        worker.addEventListener('statechange', function onState() {
          if (worker.state === 'installed' || reg.waiting) {
            worker.removeEventListener('statechange', onState);
            markUpdateAvailable({ remoteRelease: cachedRemoteRelease });
          }
        });
      }
    }).catch(() => {});
  }
}

export function markUpdateAvailable({ remoteRelease } = {}) {
  updateStatus = 'available';
  const badge = $('#updateStatusBadge');
  const btn = $('#checkUpdateBtn');
  const statusEl = $('#checkUpdateStatus');
  const actionLabel = $('#checkUpdateActionLabel');
  const tabBadge = $('#settingsUpdateBadge');
  const progressWrap = $('#checkUpdateProgress');

  if (progressWrap) progressWrap.hidden = true;
  if (tabBadge) tabBadge.hidden = false;
  if (badge) {
    badge.textContent = 'نسخهٔ جدید آماده است';
    badge.className = 'update-status-badge ready';
  }
  if (actionLabel) {
    actionLabel.textContent = 'دریافت نسخه جدید';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'دریافت و نصب به‌روزرسانی';
    btn.classList.add('settings-btn-primary');
  }
  const rel = remoteRelease || cachedRemoteRelease;
  if (statusEl) {
    statusEl.textContent = rel
      ? `نسخهٔ جدید (${faNum(rel)}) در دسترس است! برای دریافت روی دکمهٔ بالا بزنید.`
      : 'نسخهٔ جدید دفترچه آماده است! برای اعمال به‌روزرسانی روی دکمهٔ بالا بزنید.';
  }
}

export function markAppUpToDate() {
  updateStatus = 'latest';
  const badge = $('#updateStatusBadge');
  const btn = $('#checkUpdateBtn');
  const statusEl = $('#checkUpdateStatus');
  const actionLabel = $('#checkUpdateActionLabel');
  const tabBadge = $('#settingsUpdateBadge');
  const progressWrap = $('#checkUpdateProgress');

  if (progressWrap) progressWrap.hidden = true;
  if (tabBadge) tabBadge.hidden = true;
  if (badge) {
    badge.textContent = 'به‌روز';
    badge.className = 'update-status-badge ok';
  }
  if (actionLabel) {
    actionLabel.textContent = 'بررسی نسخه جدید';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'بررسی مجدد';
    btn.classList.remove('settings-btn-primary');
  }
  const ver = APP_VERSION || (typeof self !== 'undefined' ? self.DAFTARCHE_RELEASE : '') || '';
  if (statusEl) {
    statusEl.textContent = ver
      ? `دفتَرچه به‌روز است — شما از آخرین نسخه (${faNum(ver)}) استفاده می‌کنید ✨`
      : 'دفتَرچه به‌روز است — شما از آخرین نسخه استفاده می‌کنید ✨';
  }
}

export async function checkAppUpdate({ userInitiated = false } = {}) {
  const btn = $('#checkUpdateBtn');
  const badge = $('#updateStatusBadge');
  const statusEl = $('#checkUpdateStatus');
  const progressWrap = $('#checkUpdateProgress');

  if (updateStatus === 'installing') return;

  if (isNative()) {
    if (badge) {
      badge.textContent = 'به‌روز';
      badge.className = 'update-status-badge ok';
    }
    if (statusEl) {
      statusEl.textContent = 'برنامهٔ شما به‌روز است. دریافت به‌روزرسانی‌های نسخهٔ اندروید از طریق بازار و مایکت انجام می‌شود.';
    }
    updateStatus = 'latest';
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (badge) {
      badge.textContent = 'آفلاین';
      badge.className = 'update-status-badge offline';
    }
    if (statusEl) {
      statusEl.textContent = 'اتصال اینترنت برقرار نیست. برای بررسی نسخه جدید به اینترنت نیاز است.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'بررسی دوباره';
    }
    if (progressWrap) progressWrap.hidden = true;
    updateStatus = 'offline';
    return;
  }

  let reg = null;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      reg = await navigator.serviceWorker.getRegistration();
    } catch { /* ignore */ }
  }

  if (reg?.waiting) {
    markUpdateAvailable({ remoteRelease: cachedRemoteRelease });
    return;
  }

  if (userInitiated) {
    updateStatus = 'checking';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'در حال بررسی…';
    }
    if (badge) {
      badge.textContent = 'در حال بررسی';
      badge.className = 'update-status-badge';
    }
    if (statusEl) {
      statusEl.textContent = 'در حال بررسی نسخهٔ جدید روی سرور…';
    }
    if (progressWrap) {
      progressWrap.hidden = false;
    }
  }

  let updateFound = false;
  let remoteRelease = null;
  let remoteBuild = null;
  let fetchSucceeded = false;

  try {
    const versionUrl = typeof document !== 'undefined' && document.baseURI
      ? new URL('js/version.js?_t=' + Date.now(), document.baseURI)
      : 'js/version.js?_t=' + Date.now();

    const res = await fetch(versionUrl, { cache: 'no-store' });
    if (res.ok) {
      fetchSucceeded = true;
      const text = await res.text();
      const mRel = text.match(/DAFTARCHE_RELEASE\s*=\s*['"]([^'"]+)['"]/);
      const mBld = text.match(/DAFTARCHE_BUILD\s*=\s*['"]([^'"]+)['"]/);
      if (mRel) remoteRelease = mRel[1];
      if (mBld) remoteBuild = mBld[1];
      if (remoteRelease) cachedRemoteRelease = remoteRelease;
    }
  } catch {
    fetchSucceeded = false;
  }

  const curBuild = typeof self !== 'undefined' ? self.DAFTARCHE_BUILD : null;
  const curRelease = APP_VERSION || (typeof self !== 'undefined' ? self.DAFTARCHE_RELEASE : null);

  if ((remoteBuild && curBuild && remoteBuild !== curBuild) ||
      (remoteRelease && curRelease && remoteRelease !== curRelease)) {
    updateFound = true;
  }

  let swTriggered = false;
  if (reg && typeof reg.update === 'function') {
    try {
      const updatePromise = reg.update();
      swTriggered = true;
      if (reg.installing) {
        updateFound = true;
      }
      await updatePromise;
      if (reg.installing || reg.waiting) {
        updateFound = true;
      }
    } catch {
      // SW update network failure
    }
  }

  if (!fetchSucceeded && !swTriggered && !reg?.waiting) {
    if (userInitiated) {
      updateStatus = 'error';
      if (progressWrap) progressWrap.hidden = true;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'بررسی دوباره';
      }
      if (badge) {
        badge.textContent = 'خطا در بررسی';
        badge.className = 'update-status-badge error';
      }
      if (statusEl) {
        statusEl.textContent = 'بررسی با خطا مواجه شد. لطفاً اتصال اینترنت را بررسی کنید.';
      }
    }
    return;
  }

  if (reg?.installing && !reg?.waiting) {
    updateStatus = 'downloading';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'در حال دریافت فایل‌ها…';
    }
    if (badge) {
      badge.textContent = 'در حال دریافت';
      badge.className = 'update-status-badge';
    }
    if (statusEl) {
      statusEl.textContent = 'نسخهٔ تازه پیدا شد؛ در حال دانلود فایل‌ها روی دستگاه…';
    }
    if (progressWrap) progressWrap.hidden = false;

    const worker = reg.installing;
    worker.addEventListener('statechange', function onState() {
      if (worker.state === 'installed' || reg.waiting) {
        worker.removeEventListener('statechange', onState);
        markUpdateAvailable({ remoteRelease });
      }
    });
    return;
  }

  if (updateFound || reg?.waiting) {
    markUpdateAvailable({ remoteRelease });
  } else {
    markAppUpToDate();
  }
}

export async function applyAppUpdate() {
  updateStatus = 'installing';
  const btn = $('#checkUpdateBtn');
  const statusEl = $('#checkUpdateStatus');
  const progressWrap = $('#checkUpdateProgress');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'در حال نصب…';
  }
  if (statusEl) {
    statusEl.textContent = 'در حال اعمال به‌روزرسانی و بارگذاری برگهٔ تازه…';
  }
  if (progressWrap) {
    progressWrap.hidden = false;
  }

  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
    document.dispatchEvent(new CustomEvent('daftarche:apply-update'));
  }

  let reloaded = false;
  const doReload = () => {
    if (reloaded) return;
    reloaded = true;
    if (typeof location !== 'undefined') {
      location.reload();
    }
  };

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setTimeout(doReload, 300);
      }, { once: true });

      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage('SKIP_WAITING');
      } else if (reg?.installing) {
        const worker = reg.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            worker.postMessage('SKIP_WAITING');
          }
        });
      }
    } catch { /* ignore */ }
  }

  setTimeout(doReload, 3500);
}

/* What the page says about itself, painted on entry. The picker is marked here
   as well as by js/theme.js because the two halves of the table are remembered
   per half: opening the page must show the theme the app is actually wearing,
   whichever door the reader came through. */
export function renderSettings() {
  markThemePicker();
  renderBirthdayRow();

  const pm = $('#profPomo');
  if (pm) pm.textContent = faNum(state.pomoMin) + ' دقیقه';

  /* The release number alone — the row it sits in is already labelled «نسخه»,
     so the cell must not say the word twice. Persian digits, "3.3.0" → "۳.۳.۰". */
  const pv = $('#profVersion');
  if (pv && APP_VERSION) pv.textContent = faNum(APP_VERSION);

  renderPersistRow();
  renderThemeAutoRow();
  renderMotionRow();
  renderSettingsThemeCount();
  renderUpdateSection();
  switchSettingsTab(activeSettingsTab);
}

function renderThemeAutoRow() {
  const btn = $('#themeAutoBtn');
  const text = $('#themeAutoText');
  if (!btn || !text) return;
  const on = isAutoTheme();
  btn.setAttribute('aria-checked', String(on));
  btn.classList.toggle('on', on);
  text.textContent = on ? 'فعال' : 'غیرفعال';
}

/* The app's own «reduce motion» switch. When the phone already asks for less
   motion the switch reads «on» and is locked: the app never argues with it. */
function renderMotionRow() {
  const btn = $('#motionBtn'), text = $('#motionText'), hint = $('#motionHint');
  if (!btn || !text) return;
  const system = systemReducedMotion();
  const on = system || userReducedMotion();
  btn.setAttribute('aria-checked', String(on));
  btn.classList.toggle('on', on);
  btn.disabled = system;
  text.textContent = on ? 'روشن' : 'خاموش';
  if (hint) hint.textContent = system
    ? 'گوشی‌ت از قبل کاهش حرکت رو خواسته؛ دفترچه هم همون رو رعایت می‌کنه.'
    : 'حرکت‌های تزیینی و پرش‌ها کم می‌شن؛ بازخورد لازم (مثل تیک‌خوردن) می‌مونه.';
}

function renderPersistRow() {
  const persistText = $('#persistStatusText');
  const persistHint = $('#persistHint');
  if (!persistText) return;
  if (isNative()) {
    persistText.textContent = 'فعال (حافظهٔ دستگاه)';
    if (persistHint) persistHint.textContent = 'اطلاعات در حافظهٔ داخلی برنامه نگهداری می‌شوند. پاک‌کردن داده‌ها از تنظیمات گوشی اطلاعات را حذف می‌کند؛ پشتیبان‌گیری منظم توصیه می‌شود.';
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    navigator.storage.persisted().then(persisted => {
      if (persisted) {
        persistText.textContent = 'فعال';
        if (persistHint) persistHint.textContent = 'اطلاعات در حافظهٔ پایدار مرورگر نگهداری می‌شوند و خودکار پاک نخواهند شد.';
      } else {
        persistText.textContent = 'غیرفعال';
        if (persistHint) persistHint.textContent = 'حافظهٔ پایدار فعال نیست؛ ممکن است مرورگر در کمبود حافظه داده‌ها را پاک کند. پشتیبان‌گیری منظم توصیه می‌شود.';
      }
    }).catch(() => {
      persistText.textContent = 'غیرفعال';
    });
  } else {
    persistText.textContent = 'غیرفعال';
  }
}

export function initSettings() {
  /* ── What this build changed ──
     The boot check hands the release notes to whoever was here for the previous
     release; this is the other door — someone who wants to read what they are
     running right now. */
  $('#profNotes')?.addEventListener('click', openReleaseNotes);

  $('#profTour')?.addEventListener('click', () => startTour());

  $('#openShortcutsBtn')?.addEventListener('click', () => openShortcuts());

  $('#checkUpdateBtn')?.addEventListener('click', () => {
    if (updateStatus === 'available') {
      applyAppUpdate();
    } else {
      checkAppUpdate({ userInitiated: true });
    }
  });

  $('#profTourUpdates')?.addEventListener('click', () => startTour());

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('daftarche:update-available', () => {
      markUpdateAvailable();
    });
  }

  const autoBtn = $('#themeAutoBtn');
  if (autoBtn) {
    autoBtn.addEventListener('click', e => {
      e.stopPropagation();
      setAutoTheme(!isAutoTheme());
    });
    autoBtn.closest('.settings-row')?.addEventListener('click', e => {
      if (e.target.closest('#themeAutoBtn')) return;
      autoBtn.click();
    });
  }
  window.addEventListener('theme-auto-changed', renderThemeAutoRow);
  renderThemeAutoRow();

  const motionBtn = $('#motionBtn');
  if (motionBtn) {
    motionBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (systemReducedMotion()) return;
      setUserReducedMotion(!userReducedMotion());
      renderMotionRow();
    });
    motionBtn.closest('.settings-row')?.addEventListener('click', e => {
      if (e.target.closest('#motionBtn')) return;
      motionBtn.click();
    });
  }
  renderMotionRow();

  /* Text size: three radio buttons in the same segmented control the theme
     picker uses; the choice applies at once. */
  const seg = $('#textSizeSeg');
  if (seg) {
    const paint = () => {
      const cur = loadTextSize();
      seg.replaceChildren(...TEXT_SIZES.map(s => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'seg-btn' + (s.id === cur ? ' sel' : '');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(s.id === cur));
        b.textContent = s.label;
        b.addEventListener('click', () => { saveTextSize(s.id); paint(); });
        return b;
      }));
    };
    paint();
  }

  /* ── Settings tabs (general vs themes) ── */
  const tabsList = document.querySelector('.settings-tabs');
  if (tabsList) {
    tabsList.addEventListener('click', e => {
      const btn = e.target.closest('.settings-tab');
      if (btn && btn.dataset.settingsTab) {
        switchSettingsTab(btn.dataset.settingsTab);
      }
    });

    tabsList.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const tabs = Array.from(tabsList.querySelectorAll('.settings-tab'));
      const curIdx = tabs.findIndex(t => t.classList.contains('sel'));
      const step = e.key === 'ArrowLeft' ? 1 : -1;
      const nextIdx = (curIdx + step + tabs.length) % tabs.length;
      const nextTab = tabs[nextIdx];
      if (nextTab) {
        nextTab.focus();
        switchSettingsTab(nextTab.dataset.settingsTab);
      }
    });
  }

  window.addEventListener('navigate-settings-tab', e => {
    if (e.detail) switchSettingsTab(e.detail);
  });
  window.addEventListener('theme-applied', renderSettingsThemeCount);
  renderSettingsThemeCount();
  switchSettingsTab(activeSettingsTab);

  /* ── Backup ──
     Export writes every daftarche-* key to one JSON file; import validates a
     file completely before touching anything, then asks how it should land —
     merge into what is here, or replace it. The page reloads after either, so
     every module boots from the data as it now stands. */
  const status = $('#backupStatus');
  const say = msg => { if (status) status.textContent = msg; };

  $('#backupExport')?.addEventListener('click', async () => {
    try {
      flushPending();
      const backup = collectBackup(localStorage, { release: APP_VERSION });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const res = await saveAndShareBlob(blob, backupFileName(), { title: 'پشتیبان دَفتَرچه' });
      if (res.ok) {
        markBackupDone();
        say('پشتیبان ساخته شد؛ فایل رو یه جای امن نگه دار.');
      } else {
        say('ساختن پشتیبان نشد. دوباره امتحان کن.');
      }
    } catch {
      say('ساختن پشتیبان نشد. دوباره امتحان کن.');
    }
  });

  /* PDFs, separately: the JSON above leaves them out because they can be large. */
  const pdfStatus = $('#pdfPackStatus');
  const sayPdf = msg => { if (pdfStatus) pdfStatus.textContent = msg; };
  $('#pdfPackExport')?.addEventListener('click', async () => {
    sayPdf('در حال جمع‌کردن فایل‌ها…');
    try {
      const { blob, count, missing } = await exportBookPack();
      if (!blob) { sayPdf('فایل PDFای روی این دستگاه نیست که ذخیره بشه.'); return; }
      const res = await saveAndShareBlob(blob, backupFileName().replace(/\.json$/, '') + '-pdf.zip', { title: 'پک PDF کتاب‌های دَفتَرچه' });
      if (res.ok) {
        sayPdf(`${faNum(count)} فایل ذخیره شد${missing ? ` (${faNum(missing)} کتاب فایلی نداشت)` : ''}. این زیپ رو هم کنار پشتیبان نگه دار.`);
      } else {
        sayPdf('ساختن پک PDF نشد. شاید حافظه کم باشه.');
      }
    } catch { sayPdf('ساختن پک PDF نشد. شاید حافظه کم باشه.'); }
  });
  const pdfInput = $('#pdfPackFile');
  $('#pdfPackImport')?.addEventListener('click', () => pdfInput?.click());
  pdfInput?.addEventListener('change', async () => {
    const file = pdfInput.files && pdfInput.files[0];
    pdfInput.value = '';
    if (!file) return;
    sayPdf('در حال برگرداندن…');
    try {
      const r = await importBookPack(file);
      const bits = [`${faNum(r.restored)} فایل برگشت`];
      if (r.had) bits.push(`${faNum(r.had)} تا از قبل بود`);
      if (r.unknown) bits.push(`${faNum(r.unknown)} تا به کتابی توی لیست نمی‌خورد (اول پشتیبان JSON رو برگردون)`);
      if (r.bad) bits.push(`${faNum(r.bad)} تا PDF معتبر نبود`);
      sayPdf(bits.join('، ') + '.');
      if (r.restored) window.dispatchEvent(new Event('daftarche:books-changed'));
    } catch { sayPdf('این فایل پک PDF دفترچه نیست.'); }
  });

  const fileInput = $('#backupFile');
  $('#backupImport')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';   // so choosing the same file twice still fires
    if (!file) return;
    if (file.size > BACKUP_MAX_CHARS) { say('این فایل خیلی بزرگه و پشتیبان دفترچه نیست.'); return; }

    let text;
    try { text = await file.text(); } catch { say('فایل خوانده نشد.'); return; }

    /* Only a file that passed every check reaches the question — an invalid
       one is reported and nothing is asked. */
    const parsed = parseBackup(text);
    if (!parsed.ok) { say(parsed.reason); return; }

    /* The decision dialog. Cancelling it — the Escape key, the backdrop, the
       «انصراف» button — answers null and touches nothing. */
    const when = parsed.backup.exportedAt ? new Date(parsed.backup.exportedAt) : null;
    const whenEl = $('#backupWhen');
    if (whenEl) whenEl.textContent = when && !isNaN(when) ? when.toLocaleDateString('fa-IR') : 'اخیراً';
    const choice = await new Promise(resolve => {
      const overlay = $('#backupOverlay');
      if (!overlay) { resolve(null); return; }
      const done = value => {
        overlay.hidden = true;
        $('#backupMerge')?.removeEventListener('click', onMerge);
        $('#backupReplace')?.removeEventListener('click', onReplace);
        $('#backupCancel')?.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEscape);
        resolve(value);
      };
      const onMerge = () => done('merge');
      const onReplace = () => done('replace');
      const onCancel = () => done(null);
      const onBackdrop = e => { if (e.target === overlay) done(null); };
      const onEscape = e => { if (e.key === 'Escape') done(null); };
      $('#backupMerge')?.addEventListener('click', onMerge);
      $('#backupReplace')?.addEventListener('click', onReplace);
      $('#backupCancel')?.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onEscape);
      overlay.hidden = false;
    });
    if (choice === null) { say('وارد شدن پشتیبان لغو شد؛ چیزی عوض نشد.'); return; }

    let res;
    resetPending();
    if (choice === 'merge') res = mergeBackup(localStorage, parsed.backup);
    else res = applyBackup(localStorage, parsed.backup);
    if (!res.ok) { say(res.reason); return; }
    hydrateStateAfterRestore();
    say(choice === 'merge' ? 'ادغام شد؛ دفترچه دوباره بالا می‌آد…' : 'بازگردانی شد؛ دفترچه دوباره بالا می‌آد…');
    setTimeout(() => location.reload(), 600);
  });

  /* ── The wipe ──
     localStorage holds tasks, settings and the book metadata; the PDF files and
     the uploaded music live in their own databases and are removed explicitly.
     Both results are awaited before the page leaves, so a wipe that could not
     finish is reported instead of being reloaded away as a success. */
  const cl = $('#profClear');
  if (cl) cl.onclick = async () => {
    /* The most destructive action in the app, in the app's own dialog: a native
       confirm cannot say «برگشت‌ناپذیر» در صدای دفترچه، and its two
       buttons are laid out for a left-to-right box, so «تأیید» and «انصراف»
       land in the opposite order from every other confirm on this page. */
    const ok = await confirmDialog({
      title: 'همهٔ داده‌ها پاک بشه؟',
      body: 'همهٔ کارها، آمار، کتاب‌ها و موسیقی‌ها پاک می‌شن. این کار قابل برگشت نیست.',
      confirmLabel: 'پاک کن',
      cancelLabel: 'انصراف',
      danger: true,
    });
    if (!ok) return;
    const [booksCleared, audioCleared] = await Promise.all([
      clearLibraryData(),
      clearUserAudioData(),
    ]);
    clearAll();
    if (!booksCleared || !audioCleared) {
      /* Nothing left to reload into a toast on this page — the wipe may have
         taken the storage the toast would have been painted over — so the
         message is a notice and the reload waits for it to have been read. */
      showNotice('فایل‌های کتاب یا موسیقی پاک نشدن؛ اگه تب دیگه‌ای از دفترچه بازه ببندش و دوباره امتحان کن.', { actionLabel: 'باشه' });
      setTimeout(() => location.reload(), 400);
      return;
    }
    location.reload();
  };
}

export function hydrateStateAfterRestore() {
  const loadedTasks = loadTasks();
  state.tasks = (Array.isArray(loadedTasks) ? loadedTasks : []).map(normalizeTask).filter(Boolean);
  state.userName = loadName();
  state.history = loadHistory();
  state.moods = loadMoods();
  state.pomoMin = loadPomo();
  try { reloadBooks(); } catch { /* ignore */ }
  invalidateAllBuckets();
  notify();
  if (typeof document !== 'undefined') {
    renderList();
    renderToday();
    renderProfile();
    renderSettings();
    renderAchievements();
    renderPlanner();
  }
}
