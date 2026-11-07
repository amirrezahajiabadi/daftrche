import { isBusy } from './calm.js';

const CHECK_INTERVAL = 30 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;
const ACTIVATION_TIMEOUT = 15000;

/* The worker usually activates in a few hundred milliseconds, and a state that
   blinks past reads as a glitch rather than as work. The note holds its loading
   line for this long from the tap, then shows the filled line for one more beat,
   and only then does the page come back. */
const WORK_MIN = 1200;
const DONE_BEAT = 450;

export function initPWA() {
  const isNative = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
  if (isNative) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister());
      }).catch(() => {});
    }
    if (typeof caches !== 'undefined') {
      caches.keys().then(keys => {
        keys.filter(k => k.startsWith('daftarche-')).forEach(k => caches.delete(k));
      }).catch(() => {});
    }
    return;
  }
  if (!('serviceWorker' in navigator)) return;

  const sw = navigator.serviceWorker;
  const toast = document.querySelector('#updateToast');
  const button = document.querySelector('#updateBtn');
  const message = toast?.querySelector('.toast-text');
  /* The quiet line under the title carries the stage, so the words live in the
     markup (index.html) and js/i18n.js rewrites them; pwa.js only picks one. */
  const sub = toast?.querySelector('.update-sub');
  const idleLabel = button?.textContent?.trim() || 'دریافتش کن';
  const workingLabel = button?.dataset?.working || 'در حال به‌روزرسانی…';
  /* performance.now is monotonic; the test harness only provides Date. Both
     answer the same question: how long the note has been saying «working». */
  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const setStage = stage => {
    if (!sub) return;
    if (sub.dataset) sub.dataset.stage = stage;
    const text = sub.dataset?.[stage];
    if (text) sub.textContent = text;
  };
  let applyStart = 0;
  let controller = sw.controller;
  let registration = null;
  let registering = false;
  let waiting = null;
  let applying = null;
  let reloading = false;
  let poll = 0;
  let activationTimer = 0;
  let checking = false;
  let lastCheck = -Infinity;
  const observed = new WeakSet();

  const stopPolling = () => { clearInterval(poll); poll = 0; };
  const hideOffer = () => {
    stopPolling();
    if (!toast) return;
    toast.hidden = true;
    toast.classList.remove('show', 'is-applying', 'is-done');
    setStage('idle');
  };
  const resetButton = () => {
    applyStart = 0;
    toast?.classList.remove('is-applying', 'is-done');
    setStage('idle');
    if (!button) return;
    button.disabled = false;
    button.textContent = idleLabel;
  };
  const calm = () => !document.hidden && !isBusy() &&
    [...document.querySelectorAll('.toast')].every(t => t === toast || t.hidden);

  function showOffer() {
    if (!waiting || applying || !toast || !button) return;
    if (!calm()) {
      if (!poll) poll = setInterval(showOffer, 2000);
      return;
    }
    stopPolling();
    if (!toast.hidden) return;
    toast.hidden = false;
    requestAnimationFrame(() => { if (!toast.hidden) toast.classList.add('show'); });
  }

  function syncWaiting() {
    const worker = registration?.waiting;
    if (!worker || worker.state !== 'installed' || !sw.controller) {
      waiting = null;
      if (!applying) hideOffer();
      return;
    }
    if (worker !== waiting) {
      waiting = worker;
      if (message) message.textContent = 'نسخهٔ جدید اومده!';
      if (!applying) resetButton();
    }
    observe(worker);
    showOffer();
  }

  function observe(worker) {
    if (!worker || observed.has(worker)) return;
    observed.add(worker);
    worker.addEventListener('statechange', syncWaiting);
  }

  function retryActivation() {
    clearTimeout(activationTimer);
    activationTimer = 0;
    applying = null;
    resetButton();
    syncWaiting();
    if (waiting && message) message.textContent = 'به‌روزرسانی کامل نشد؛ دوباره امتحان کن.';
  }

  // Reload only when an existing controller is replaced.
  sw.addEventListener('controllerchange', () => {
    const previous = controller;
    controller = sw.controller;
    if (!previous || !controller || previous === controller || reloading) return;
    reloading = true;
    clearTimeout(activationTimer);
    /* The update is already active by the time this fires; what is left is the
       moment the reader is owed. The ink line finishes, the line under the title
       says it is ready, and the reload follows the beat rather than the event. */
    const elapsed = applyStart ? clock() - applyStart : 0;
    setTimeout(() => {
      setStage('done');
      toast?.classList.remove('is-applying');
      toast?.classList.add('is-done');
      setTimeout(() => { hideOffer(); location.reload(); }, DONE_BEAT);
    }, Math.max(0, WORK_MIN - elapsed));
  });

  button?.addEventListener('click', () => {
    if (applying || reloading) return;
    syncWaiting();
    if (!waiting) return;
    applying = waiting;
    applyStart = clock();
    button.disabled = true;
    button.textContent = workingLabel;
    setStage('working');
    toast?.classList.remove('is-done');
    toast?.classList.add('is-applying');
    activationTimer = setTimeout(retryActivation, ACTIVATION_TIMEOUT);
    try { applying.postMessage('SKIP_WAITING'); }
    catch { retryActivation(); }
  });

  async function checkForUpdate(force = false) {
    if (!registration || checking || navigator.onLine === false) return;
    if (!force && Date.now() - lastCheck < RETRY_DELAY) return;
    lastCheck = Date.now();
    checking = true;
    try { await registration.update(); }
    catch { /* Retry when the connection returns. */ }
    finally { checking = false; syncWaiting(); }
  }

  // PDF downloads run after activation, without delaying the update.
  function warmReader() {
    try { registration?.active?.postMessage('WARM_PDF_CACHE'); }
    catch { /* The reader can fetch these files when opened. */ }
  }

  async function register() {
    if (registration || registering) return;
    registering = true;
    try {
      registration = await sw.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' });
    } catch { return; }
    finally { registering = false; }
    registration.addEventListener('updatefound', () => {
      observe(registration.installing);
      syncWaiting();
    });
    observe(registration.installing);
    syncWaiting();
    sw.ready.then(warmReader).catch(() => {});
    void checkForUpdate();
    setInterval(() => {
      if (!document.hidden) void checkForUpdate();
    }, CHECK_INTERVAL);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    syncWaiting();
    void checkForUpdate();
  });
  addEventListener('pageshow', () => { syncWaiting(); void checkForUpdate(); });
  addEventListener('online', () => {
    if (!registration) { void register(); return; }
    void checkForUpdate(true);
    warmReader();
  });

  if (document.readyState === 'complete') void register();
  else addEventListener('load', register, { once: true });
}
