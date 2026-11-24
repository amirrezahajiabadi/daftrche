/* ═══ Local Notifications ═══
   Per-task reminder switches + an automatic due-date watcher.
   No frameworks: Notification API + the service-worker registration.
   Permission is never requested on page load — only from a real user
   interaction (tapping a task's bell). A task is reminded at most once
   per phase: 'soon' when its deadline is today, 'overdue' once it has
   passed. The flag lives on the task (notifiedStatus) so the dedupe
   survives reloads and is reset when the deadline changes. */

import { ICONS } from './constants.js';
import { confirmDialog } from './dialog.js';
import { enablePush, disablePush } from './push-service.js';
import { isBusy } from './calm.js';
import { isNative, scheduleNativeTaskNotification } from './native.js';

const BELL_SVG = ICONS.bell;

/* Notification artwork resolved against the document so the icon and badge
   stay correct when the app is served from a subpath, not only from a domain
   root. */
const NOTIFY_ICON = typeof document !== 'undefined'
  ? new URL('assets/icons/icon-192.png', document.baseURI).href
  : 'assets/icons/icon-192.png';

/* Persistence + reactivity are owned by the pages that render the list; the
   module only flips fields and asks for a save/refresh via these hooks. */
let _save = null, _notify = null, _getTasks = null;
export function bindPersistence({ save, notify, getTasks }) {
  _save = save; _notify = notify; _getTasks = getTasks || null;
}
const persist = () => { _save && _save(); _notify && _notify(); };

/* ── Capability ── */
export const notificationsSupported = () =>
  isNative() || ('Notification' in window && 'serviceWorker' in navigator);

/* ── Permission ──
   'default' → not asked yet; 'granted' → can show; 'denied' → blocked. */
export function notificationPermission() {
  if (isNative()) return 'granted';
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/* ── Permission priming ──
   The system dialog is a one-shot: once it is refused, only the phone's own
   settings can give it back. So the ask is explained first, in the app's words
   and the app's own card, and only at the moment it makes sense — the reader
   turning a reminder on — never on launch and never as part of a batch of asks.
   A reader who already allowed reminders is not asked to justify it again.

   The native side requests the same permission deeper in (js/native.js, when a
   notification is first scheduled), which is why the explanation lives here,
   above both paths. */
let primed = false;
export async function explainReminders() {
  if (primed) return true;
  if (!isNative() && notificationsSupported() && Notification.permission === 'granted') {
    primed = true;
    return true;
  }
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'granted') { primed = true; return true; }
    } catch { /* the reminder path reports its own failure */ }
  }
  const ok = await confirmDialog({
    title: 'یادآوری سرِ وقت',
    body: 'برای اینکه سرِ موعدِ کارها بهت خبر بدم، دفترچه به اجازهٔ اعلان نیاز داره — فقط برای همین. هر وقت خواستی از تنظیمات گوشی برداشته می‌شه.',
    confirmLabel: 'اجازه بده',
    cancelLabel: 'فعلاً نه',
  });
  /* Answered once per session either way: a «فعلاً نه» is an answer, and asking
     again on the next bell would be the batch prompt this is meant to replace. */
  primed = true;
  return ok;
}

/* Must be called from inside a user gesture (click handler). Resolves with
   the resulting permission string. Never called automatically. */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (isNative()) return 'granted';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); }
  catch { return 'denied'; }
}

/* ── Show ──
   Routes through the service worker when available (required on Android,
   best behaviour on desktop too); falls back to the page Notification. */
async function showNotification(title, body, tag) {
  if (!notificationsSupported()) return;
  if (isNative()) {
    scheduleNativeTaskNotification({ id: tag, title, body, date: Date.now() });
    return;
  }
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag,                        // one notification per task, not a pile
        icon: NOTIFY_ICON,
        badge: NOTIFY_ICON,
        lang: 'fa',
        dir: 'rtl',
        data: { action: 'open-tasks' },
        actions: [{ action: 'open-tasks', title: 'دیدن کارها' }],
      });
    } else {
      new Notification(title, { body, tag, icon: NOTIFY_ICON, lang: 'fa', dir: 'rtl' });
    }
  } catch { /* notifications are a bonus — the app never depends on them */ }
}

/* ── Scheduler ──
   Walks the open tasks once and fires what is due. Called on boot and on
   a gentle interval; each call is cheap (a date comparison per task).

   What is due is not always what may be said. A reminder is an interruption,
   so it obeys the same calm rule as the update prompt (js/calm.js): never while
   the reader is typing, inside a focus session, or answering a dialog. Being in
   the background is not "busy" here — a notification is exactly how someone who
   is not looking at the app gets told.

   When the moment is taken, the phase is NOT written down: nothing is marked as
   delivered, so the task keeps being found by every later pass. That is what
   makes a held reminder wait instead of disappear — and it also means a
   reminder held when the app is closed simply arrives on the next open. While
   one is held, a quiet check keeps asking until it can speak. */
const RETRY_MS = 15000;
let retry = 0;
const stopRetrying = () => { clearInterval(retry); retry = 0; };

/* What a task has to say right now, phase by phase. null = silence. */
function dueFor(t, todayStr) {
  if (!t || t.done || t.deletedAt || !t.notify || !t.dueDate) return null;
  if (t.notifiedStatus === 'overdue') return null;   // terminal phase already delivered
  if (t.dueDate < todayStr) return 'overdue';
  if (t.dueDate === todayStr && t.notifiedStatus !== 'soon') return 'soon';
  return null;
}

function deliver(t, phase) {
  t.notifiedStatus = phase;
  if (phase === 'overdue') showNotification('یه کار از موعدش گذشت!', t.text, `daftarche-overdue-${t.id}`);
  else showNotification('مهلت امروزشه', t.text, `daftarche-soon-${t.id}`);
}

export function checkDueTasksAndNotify(tasks) {
  if (!notificationsSupported() || Notification.permission !== 'granted') { stopRetrying(); return; }
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const due = [];
  for (const t of tasks) {
    const phase = dueFor(t, todayStr);
    if (phase) due.push([t, phase]);
  }
  if (!due.length) { stopRetrying(); return; }

  if (isBusy()) {
    /* Silent from here: the phase stays unwritten and the clock keeps asking. */
    if (!retry) retry = setInterval(() => { if (_getTasks) checkDueTasksAndNotify(_getTasks()); }, RETRY_MS);
    return;
  }

  stopRetrying();
  for (const [t, phase] of due) deliver(t, phase);
  persist();
}

/* ── Per-task switch (called from the bell button on a task card) ──
   Returns the resulting boolean so the UI can reflect it.
   The same user gesture also (re)creates the Web Push subscription so
   reminders survive the app being fully closed; when push is unsupported
   or the push server is absent, enablePush resolves null and the local
   scheduler alone keeps working — the bell never fails visually. */
export async function setTaskNotify(task, on) {
  if (on) {
    /* Explained before the OS asks: the reader is told what the permission is
       for, and a «not now» never reaches the system dialog at all. */
    if (!(await explainReminders())) return false;
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') return false; // UI stays off; the switch reflects reality
    // Turning it on re-arms the reminder for the current phase
    task.notifiedStatus = 'none';
    // Background upgrade layer: best-effort, never blocks or errors the bell
    enablePush().catch(() => {});
  } else {
    // The very last bell going off tears the push subscription down so the
    // server stops holding a dead endpoint for this device.
    const anyRemaining = _getTasks ? _getTasks().some(t => t !== task && !t.deletedAt && t.notify) : false;
    if (!anyRemaining) disablePush().catch(() => {});
  }
  task.notify = on;
  task.updatedAt = Date.now();
  const currentVersion = Number.isInteger(Number(task.version ?? task.rev)) ? Number(task.version ?? task.rev) : 1;
  task.version = currentVersion + 1;
  task.rev = task.version;
  persist();
  if (on) checkDueTasksAndNotify([task]); // immediate feedback if it's already due
  return on;
}

/* ── Boot ──
   No permission prompt here — just start watching (no-ops until granted). */
export function initNotifications(getTasks) {
  if (!notificationsSupported()) return;
  /* The retry clock needs to know where the list is, and the app hands it over
     here; bindPersistence() may have it too. Either one is enough. */
  if (getTasks && !_getTasks) _getTasks = getTasks;
  const run = () => checkDueTasksAndNotify(getTasks());
  run();
  // Re-register an already-valid push subscription with the backend (no
  // prompts, no subscription creation on load — iOS-safe).
  import('./push-service.js').then(m => m.syncExistingSubscription()).catch(() => {});
  // Gentle re-check: every 30 min while open, and whenever the app resurfaces
  setInterval(run, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  // Re-check when the calendar day rolls over without a reload
  let lastDay = new Date().getDate();
  setInterval(() => {
    const day = new Date().getDate();
    if (day !== lastDay) { lastDay = day; run(); }
  }, 60 * 1000);
}

/* ── Bell markup helper (used by tasks.js) ── */
export function bellHtml(task) {
  if (!notificationsSupported()) return '';
  const on = !!task.notify;
  return `<button class="bell-btn ${on ? 'on' : ''}" title="${on ? 'یادآوری روشنه' : 'یادآوری خاموشه'}" aria-label="یادآوری" aria-pressed="${on}">${BELL_SVG}</button>`;
}
export function refreshBell(li, task) {
  const btn = li.querySelector('.bell-btn');
  if (!btn) return;
  btn.classList.toggle('on', !!task.notify);
  btn.setAttribute('aria-pressed', String(!!task.notify));
  btn.title = task.notify ? 'یادآوری روشنه' : 'یادآوری خاموشه';
}
