/* ═══ Simple Event System for Coordinating Modules ═══
   Modules that depend on data changes subscribe,
   and modules that change data call notify.
   Notifications are coalesced via microtask to eliminate redundant re-renders
   and layout thrashing under CPU pressure. */

const listeners = new Set();
let notifyScheduled = false;

export const subscribe = fn => listeners.add(fn);

export const notify = () => {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    listeners.forEach(fn => {
      try { fn(); } catch (err) { console.error('[دفتَرچه] خطا در لیسنر bus:', err); }
    });
  });
};

export const notifySync = () => {
  notifyScheduled = false;
  listeners.forEach(fn => {
    try { fn(); } catch (err) { console.error('[دفتَرچه] خطا در لیسنر bus:', err); }
  });
};
