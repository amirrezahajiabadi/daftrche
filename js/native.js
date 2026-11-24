/* ═══ Native Bridge (Capacitor) ═══
   Provides transparent native adaptations for Android WebView without
   affecting web behaviour. Lazy-imports plugins only when running in native. */

export const isNative = () =>
  typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

/* ── File Export & Sharing ──
   In web, invokes standard <a download>. In native WebView, writes to cache in
   manageable base64 chunks and presents the native Android Share sheet. */
export async function saveAndShareBlob(blob, filename, { title = 'دَفتَرچه', mimeType = '' } = {}) {
  if (!blob) return { ok: false };

  if (!isNative()) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { ok: true, shared: false };
    } catch (err) {
      console.error('Web download error:', err);
      return { ok: false, error: err };
    }
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    // Convert blob to base64 in 1MB chunks to keep memory usage low
    const CHUNK_SIZE = 1024 * 1024;
    let offset = 0;
    let first = true;

    while (offset < blob.size) {
      const slice = blob.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Chunk = btoa(binary);

      if (first) {
        await Filesystem.writeFile({
          path: filename,
          data: base64Chunk,
          directory: Directory.Cache,
          recursive: true,
        });
        first = false;
      } else {
        await Filesystem.appendFile({
          path: filename,
          data: base64Chunk,
          directory: Directory.Cache,
        });
      }
      offset += CHUNK_SIZE;
    }

    const uriResult = await Filesystem.getUri({
      path: filename,
      directory: Directory.Cache,
    });

    await Share.share({
      title: title || filename,
      files: [uriResult.uri],
      dialogTitle: title || 'ذخیره یا اشتراک‌گذاری',
    });

    return { ok: true, shared: true, uri: uriResult.uri };
  } catch (err) {
    console.error('Native file save/share failed:', err);
    return { ok: false, error: err };
  }
}

/* ── Hardware / gesture Back ──
   Android's back is the reader's gesture, not the app's exit, so it unwinds one
   thing at a time:

     1. an open dialog or sheet closes — a question being answered is not a page
        to leave (the same closeTopDialog the on-screen back uses);
     2. the PDF reader closes, if it is open over the page;
     3. one step back on the app's own trail (`history.state.trail`, written by
        js/app.js), which is the pages the reader actually walked through;
     4. and only on the first page does the app go to the background.

   `history.length` is deliberately not used: a WebView counts entries this app
   never wrote (a redirect on the way in, the initial about:blank), so keying on
   it would either swallow the first real back press or leave a page the reader
   never opened. The trail is the app's own record and is always present. */
export async function initNativeBackHandler(onDialogClose) {
  if (!isNative()) return;

  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      if (typeof onDialogClose === 'function' && onDialogClose()) return;

      const reader = document.getElementById('readerView');
      if (reader && !reader.hidden) {
        window.dispatchEvent(new CustomEvent('close-reader'));
        return;
      }

      const trail = window.history && window.history.state && window.history.state.trail;
      if (Array.isArray(trail) && trail.length > 1) {
        window.history.back();
        return;
      }

      if (typeof App.minimizeApp === 'function') App.minimizeApp();
      else App.exitApp();
    });
  } catch (err) {
    console.error('Failed to register back button listener:', err);
  }
}

/* ── Status Bar / System Bars Sync ──
   Sets light/dark icon contrast on system bars to match active theme mode
   and ensures the system bar never overlays the webview content. */
export async function syncSystemBars(mode, bg) {
  const isDark = mode === 'dark';
  const colorBg = bg || (typeof document !== 'undefined' && document.documentElement ? getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() : '');

  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setSystemBars === 'function') {
    window.AndroidBridge.setSystemBars(colorBg, isDark);
  }

  if (!isNative()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    /* The page draws edge-to-edge (see MainActivity and --sat/--sab), so the
       system bars sit over the content instead of beside it: the bar is a strip
       of the page's own background with the icons on top. Asking the plugin to
       lay the WebView below the bars would undo that and leave a coloured band
       in the theme's colour instead of the page's. */
    await StatusBar.setOverlaysWebView({ overlay: true });
    if (colorBg) {
      await StatusBar.setBackgroundColor({ color: colorBg });
    }
  } catch {
    // StatusBar plugin call optional
  }
}

/* ── Task Notifications Bridge ── */
export async function scheduleNativeTaskNotification({ id, title, body, date }) {
  if (!isNative()) return false;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') return false;
    }

    const notifId = typeof id === 'number'
      ? id
      : (Math.abs(String(id).split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)) % 1000000);

    await LocalNotifications.schedule({
      notifications: [{
        id: notifId,
        title,
        body,
        schedule: { at: new Date(date) },
      }],
    });
    return true;
  } catch (err) {
    console.error('Native notification scheduling failed:', err);
    return false;
  }
}

export async function cancelNativeTaskNotification(id) {
  if (!isNative()) return false;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const notifId = typeof id === 'number'
      ? id
      : (Math.abs(String(id).split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)) % 1000000);
    await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
    return true;
  } catch {
    return false;
  }
}

/* ── Minimum WebView Compatibility Warning ── */
export function checkMinWebViewVersion() {
  if (!isNative()) return;

  const supportsColorMix = typeof window !== 'undefined' &&
    window.CSS && typeof window.CSS.supports === 'function' &&
    window.CSS.supports('color', 'color-mix(in srgb, red, blue)');

  if (!supportsColorMix) {
    const notice = document.createElement('div');
    notice.style.cssText = 'position:fixed;inset-block-start:0;inset-inline:0;background:#d9534f;color:#fff;padding:12px 16px;z-index:999999;font-family:var(--font-ui,sans-serif);font-size:13px;text-align:center;direction:rtl;';
    notice.innerHTML = 'نسخهٔ مرورگر داخلی گوشی شما (Android System WebView) قدیمی است و ممکن است رنگ‌ها را درست نمایش ندهد. لطفاً آن را از <strong>کافه‌بازار</strong> یا <strong>مایکت</strong> به‌روزرسانی کنید.';
    document.body.prepend(notice);
  }
}
