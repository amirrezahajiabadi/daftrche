/* A gentle reminder to back up.
   Everything lives on this device, so the one real risk is losing it with the
   phone or the browser data. After a month without a backup — counted from the
   last one, or from the first visit if there never was one — and only when there
   is something worth keeping, Today shows one quiet card. «Later» silences it
   for two weeks; making a backup resets the clock. It never blocks anything. */
import { STORAGE_KEYS } from './constants.js';
import { readString, safeSet } from './store.js';
import { $ } from './utils.js';
import { state } from './state.js';

const DAY = 864e5;
export const NUDGE_AFTER_DAYS = 30;
export const NUDGE_SNOOZE_DAYS = 14;
export const NUDGE_MIN_TASKS = 5;

/* Pure: should the card show now? Times are ms since the epoch, 0 = never. */
export function shouldNudge({ now, firstSeen, lastBackup, lastNudge, itemCount }) {
  if (itemCount < NUDGE_MIN_TASKS) return false;
  const since = lastBackup || firstSeen;
  if (!since || now - since < NUDGE_AFTER_DAYS * DAY) return false;
  if (lastNudge && now - lastNudge < NUDGE_SNOOZE_DAYS * DAY) return false;
  return true;
}

const num = k => Number(readString(k)) || 0;
export const markBackupDone = () => safeSet(STORAGE_KEYS.backupAt, String(Date.now()));

export function initBackupNudge() {
  const now = Date.now();
  if (!num(STORAGE_KEYS.firstSeen)) safeSet(STORAGE_KEYS.firstSeen, String(now));
  const card = $('#backupNudge');
  if (!card) return;
  const items = (Array.isArray(state.tasks) ? state.tasks.filter(t => t && !t.deletedAt).length : 0);
  if (!shouldNudge({ now, firstSeen: num(STORAGE_KEYS.firstSeen), lastBackup: num(STORAGE_KEYS.backupAt), lastNudge: num(STORAGE_KEYS.backupNudge), itemCount: items })) return;
  card.hidden = false;
  $('#backupNudgeLater')?.addEventListener('click', () => {
    safeSet(STORAGE_KEYS.backupNudge, String(Date.now()));
    card.hidden = true;
  });
  $('#backupNudgeGo')?.addEventListener('click', () => {
    safeSet(STORAGE_KEYS.backupNudge, String(Date.now()));
    card.hidden = true;
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' }));
    window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'general' }));
    setTimeout(() => $('#backupExport')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 450);
  });
}
