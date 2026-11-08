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
import { state } from './state.js';
import { markThemePicker, isAutoTheme, setAutoTheme, unlockedThemesCount, totalThemesCount } from './theme.js';
import { APP_VERSION, openReleaseNotes } from './changelog.js';
import { startTour } from './tour.js';
import { clearLibraryData, exportBookPack, importBookPack } from './library.js';
import { clearUserAudioData } from './audio.js';
import { renderBirthdayRow } from './birthday.js';
import { openShortcuts } from './shortcuts.js';
import { TEXT_SIZES, loadTextSize, saveTextSize } from './textsize.js';
import { markBackupDone } from './backup-nudge.js';
import { collectBackup, parseBackup, applyBackup, mergeBackup, backupFileName, BACKUP_MAX_CHARS } from './backup.js';
import { confirmDialog, showNotice } from './dialog.js';
import { clearAll, flushPending, resetPending } from './store.js';
import { systemReducedMotion, userReducedMotion, setUserReducedMotion } from './motion.js';
import { isNative, saveAndShareBlob } from './native.js';

let activeSettingsTab = 'general';

export function switchSettingsTab(tabKey) {
  const target = tabKey === 'themes' ? 'themes' : 'general';
  activeSettingsTab = target;

  const tabBtns = document.querySelectorAll('.settings-tab');
  tabBtns.forEach(btn => {
    const isSel = btn.dataset.settingsTab === target;
    btn.classList.toggle('sel', isSel);
    btn.setAttribute('aria-selected', String(isSel));
  });

  const panels = document.querySelectorAll('.settings-panel');
  panels.forEach(panel => {
    const match = panel.dataset.settingsPanel === target;
    panel.hidden = !match;
  });

  renderSettingsThemeCount();
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
     so the cell must not say the word twice. Persian digits, "2.0.0" → "۲.۰".
     The number comes from js/version.js; without that file the cell is left
     empty rather than showing a wrong version. */
  const pv = $('#profVersion');
  if (pv && APP_VERSION) pv.textContent = APP_VERSION.split('.').slice(0, 2).join('.').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

  renderPersistRow();
  renderThemeAutoRow();
  renderMotionRow();
  renderSettingsThemeCount();
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
       confirm cannot say «برگشت‌ناپذیر» in the notebook's voice, and its two
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
