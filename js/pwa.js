import { isBusy } from './calm.js';

const CHECK_INTERVAL = 30 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;
const ACTIVATION_TIMEOUT = 15000;
const SAFETY_TIMEOUT = 3500;
const ANIM_DURATION = 1600;
const CELEBRATION_BEAT = 280;
const REDUCED_DURATION = 400;

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
  const sub = toast?.querySelector('#updateSub');
  const dismissBtn = toast?.querySelector('#updateDismiss');
  const fillEl = toast?.querySelector('.update-toast__fill');
  const barEl = toast?.querySelector('.update-toast__bar');
  const percentEl = toast?.querySelector('#updatePercent');

  const toFa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const prefersReduced = () =>
    document.documentElement?.dataset?.motion === 'reduced' ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)')?.matches);

  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  let applyStart = 0;
  let controller = sw.controller;
  let registration = null;
  let registering = false;
  let waiting = null;
  let applying = null;
  let reloading = false;
  let poll = 0;
  let activationTimer = 0;
  let safetyTimer = 0;
  let checking = false;
  let lastCheck = -Infinity;
  let snoozed = false;
  const observed = new WeakSet();

  const stopPolling = () => { clearInterval(poll); poll = 0; };
  const hideOffer = () => {
    stopPolling();
    if (!toast) return;
    toast.hidden = true;
    toast.classList.remove('show');
  };

  const setState = state => {
    if (toast?.dataset) toast.dataset.state = state;
    else if (typeof toast?.setAttribute === 'function') toast.setAttribute('data-state', state);
  };

  const resetUI = () => {
    applyStart = 0;
    setState('idle');
    if (button) {
      button.disabled = false;
      button.textContent = 'دریافتش کن';
    }
    if (message) message.textContent = 'نسخهٔ جدید اومده!';
    if (sub) sub.textContent = 'یک برگهٔ تازه و بهینه‌تر از دفتَرچه آماده است.';
    if (percentEl) {
      percentEl.textContent = '۰٪';
      percentEl.setAttribute?.('aria-valuenow', '0');
    }
    if (fillEl?.style) fillEl.style.transform = 'scaleX(0)';
    if (barEl?.style) barEl.style.transform = 'scaleX(0)';
    if (dismissBtn?.style) dismissBtn.style.display = '';
  };

  const calm = () => !document.hidden && !isBusy() &&
    [...document.querySelectorAll('.toast')].every(t => t === toast || t.hidden);

  function showOffer() {
    if (snoozed || !waiting || applying || !toast || !button) return;
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
      snoozed = false;
      if (message) message.textContent = 'نسخهٔ جدید اومده!';
      if (!applying) resetUI();
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
        document.dispatchEvent(new CustomEvent('daftarche:update-available'));
      }
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
    clearTimeout(safetyTimer);
    activationTimer = 0;
    safetyTimer = 0;
    applying = null;
    resetUI();
    syncWaiting();
    if (waiting && message) message.textContent = 'به‌روزرسانی کامل نشد؛ دوباره امتحان کن.';
  }

  function triggerReload() {
    if (reloading) return;
    reloading = true;
    clearTimeout(activationTimer);
    clearTimeout(safetyTimer);
    hideOffer();
    location.reload();
  }

  // Reload only when an existing controller is replaced.
  sw.addEventListener('controllerchange', () => {
    const previous = controller;
    controller = sw.controller;
    if (!previous || !controller || previous === controller || reloading) return;
    clearTimeout(activationTimer);
    clearTimeout(safetyTimer);

    const elapsed = applyStart ? clock() - applyStart : 0;
    const remaining = Math.max(0, ANIM_DURATION - elapsed);
    setTimeout(() => {
      if (message) message.textContent = 'همه‌چیز آماده است ✨';
      setState('done');
      if (percentEl) {
        percentEl.textContent = '۱۰۰٪';
        percentEl.setAttribute?.('aria-valuenow', '100');
      }
      setTimeout(() => {
        triggerReload();
      }, CELEBRATION_BEAT);
    }, remaining);
  });

  function getProgress(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 100;
    if (t < 0.35) {
      const p = t / 0.35;
      return 45 * (1 - Math.pow(1 - p, 2));
    } else if (t < 0.80) {
      const p = (t - 0.35) / 0.45;
      return 45 + 40 * p;
    } else {
      const p = (t - 0.80) / 0.20;
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      return 85 + 15 * ease;
    }
  }

  function startProgressFlow() {
    if (prefersReduced()) {
      if (message) message.textContent = 'در حال به‌روزرسانی...';
      if (sub) sub.textContent = 'کارها و یادداشتهات کاملاً امنه';
      if (percentEl) {
        percentEl.textContent = '۰٪';
        percentEl.setAttribute?.('aria-valuenow', '0');
      }
      setTimeout(() => {
        if (message) message.textContent = 'همه‌چیز آماده است ✨';
        if (percentEl) {
          percentEl.textContent = '۱۰۰٪';
          percentEl.setAttribute?.('aria-valuenow', '100');
        }
        setState('done');
      }, REDUCED_DURATION);
      return;
    }

    let startTime = null;
    let lastReportedP = -1;
    let lastTick = -1;
    let tickCount = 0;
    if (message) message.textContent = 'در حال صحافی برگهٔ تازه...';
    if (sub) sub.textContent = 'کارها و یادداشتهات کاملاً امنه';

    function step(ts) {
      const now = typeof ts === 'number' ? ts : clock();
      if (now === lastTick) {
        if (++tickCount > 2) return;
      } else {
        lastTick = now;
        tickCount = 1;
      }
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const t = Math.min(1, Math.max(0, elapsed / ANIM_DURATION));
      const progress = getProgress(t);

      const scale = (progress / 100).toFixed(4);
      if (fillEl?.style) fillEl.style.transform = `scaleX(${scale})`;
      if (barEl?.style) barEl.style.transform = `scaleX(${scale})`;

      const pRound = Math.round(progress);
      if (percentEl) {
        percentEl.textContent = `${toFa(pRound)}٪`;
        if (pRound >= lastReportedP + 10 || pRound === 100) {
          lastReportedP = pRound;
          percentEl.setAttribute?.('aria-valuenow', String(pRound));
        }
      }

      if (t < 1) {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
      }
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
  }

  button?.addEventListener('click', () => {
    if (applying || reloading) return;
    syncWaiting();
    if (!waiting) return;
    applying = waiting;
    applyStart = clock();
    button.disabled = true;
    setState('updating');
    if (dismissBtn?.style) dismissBtn.style.display = 'none';

    activationTimer = setTimeout(retryActivation, ACTIVATION_TIMEOUT);
    safetyTimer = setTimeout(() => {
      if (applying && !reloading) triggerReload();
    }, SAFETY_TIMEOUT);

    try { applying.postMessage('SKIP_WAITING'); }
    catch { retryActivation(); return; }

    startProgressFlow();
  });

  if (typeof dismissBtn?.addEventListener === 'function') {
    dismissBtn.addEventListener('click', () => {
      snoozed = true;
      hideOffer();
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('daftarche:apply-update', () => {
      button?.click();
    });
  }

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
