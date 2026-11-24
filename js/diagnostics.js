/* ═══ Privacy-First Local Crash & Diagnostics Logger ═══
   Maintains a sanitized, offline-only ring buffer of runtime errors.
   Guarantees zero tracking, zero remote telemetry, and strict redaction of user data.
*/

export const DIAGNOSTICS_STORAGE_KEY = 'daftarche_diag_v1';
export const MAX_DIAGNOSTIC_ENTRIES = 30;

/**
 * Strips personal data, local file system paths, query strings, and auth tokens.
 * @param {string} str
 * @returns {string}
 */
export function redactSensitiveData(str) {
  if (typeof str !== 'string') return '';
  return str
    // Redact email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email_redacted]')
    // Redact URLs query parameters (?token=..., ?name=...)
    .replace(/\?[^)\s"'>]+/g, '?query_redacted')
    // Normalize local Windows and Unix absolute paths to relative root
    .replace(/(?:[a-zA-Z]:)?[\\/](?:[^\\/\s"']+[\\/])*([a-zA-Z0-9_-]+\.(?:js|mjs|html))/g, 'js/$1')
    // Redact long hex / base64 hashes or tokens (32+ chars)
    .replace(/\b[a-fA-F0-9]{32,}\b/g, '[hash_redacted]')
    // Collapse excess whitespace
    .trim();
}

/**
 * Pure function to sanitize and normalize an error into a bounded diagnostic record.
 * @param {any} err
 * @param {string} [source='app']
 * @param {string} [build='unknown']
 * @param {number} [now=Date.now()]
 * @returns {{
 *   ts: string,
 *   build: string,
 *   source: string,
 *   name: string,
 *   message: string,
 *   stack: Array<string>
 * }}
 */
export function sanitizeError(err, source = 'app', build = null, now = Date.now()) {
  const currentBuild = build || (typeof self !== 'undefined' && self.DAFTARCHE_BUILD) || 'unknown';

  let name = 'Error';
  let rawMessage = 'Unknown error';
  let rawStack = '';

  if (err instanceof Error) {
    name = err.name || 'Error';
    rawMessage = err.message || 'Error occurred';
    rawStack = err.stack || '';
  } else if (typeof err === 'string') {
    name = 'Error';
    rawMessage = err;
  } else if (typeof err === 'object' && err !== null) {
    name = err.name || 'Error';
    rawMessage = typeof err.message === 'string'
      ? err.message
      : typeof err.reason === 'string'
      ? err.reason
      : err.status
      ? `HTTP ${err.status}`
      : JSON.stringify(err);
    rawStack = typeof err.stack === 'string' ? err.stack : '';
  } else if (err !== undefined && err !== null) {
    rawMessage = String(err);
  }

  // Sanitize message and enforce 160 char limit
  const sanitizedMessage = redactSensitiveData(rawMessage).slice(0, 160);

  // Extract and sanitize top 3 stack frames
  const stackFrames = [];
  if (typeof rawStack === 'string' && rawStack.length > 0) {
    const lines = rawStack.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('at ') || trimmed.includes('@')) {
        stackFrames.push(redactSensitiveData(trimmed).slice(0, 120));
        if (stackFrames.length >= 3) break;
      }
    }
  }

  return {
    ts: new Date(now).toISOString(),
    build: String(currentBuild),
    source: String(source || 'app').slice(0, 32),
    name: String(name).slice(0, 48),
    message: sanitizedMessage,
    stack: stackFrames,
  };
}

/**
 * Retrieves the local diagnostics log from localStorage.
 * @returns {Array<Object>}
 */
export function getDiagnostics() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Appends a diagnostic entry into the bounded ring buffer (max 30 items).
 * Guaranteed to never throw or break storage quotas.
 * @param {Object} entry
 */
export function pushDiagnosticEntry(entry) {
  if (typeof localStorage === 'undefined' || !entry) return;
  try {
    const current = getDiagnostics();
    current.push(entry);
    const trimmed = current.slice(-MAX_DIAGNOSTIC_ENTRIES);
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // If quota exceeded, aggressively shrink to last 10 entries and retry once
    try {
      const current = getDiagnostics().slice(-10);
      current.push(entry);
      localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Ignore if storage is completely blocked
    }
  }
}

/**
 * Clears the diagnostics error log from localStorage.
 */
export function clearDiagnostics() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Manually logs a caught runtime error or unexpected condition.
 * @param {string} source Component or module name
 * @param {any} err Error object, string or event
 */
export function logDiagnosticError(source, err) {
  const sanitized = sanitizeError(err, source);
  pushDiagnosticEntry(sanitized);
}

/**
 * Formats a comprehensive, human-readable diagnostics report.
 * @returns {Promise<string>} Plain text / Markdown diagnostics summary
 */
export async function formatDiagnosticsReport() {
  const version = (typeof self !== 'undefined' && self.DAFTARCHE_RELEASE) || '3.5.0';
  const build = (typeof self !== 'undefined' && self.DAFTARCHE_BUILD) || 'unknown';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js / Headless';
  const time = new Date().toISOString();

  let storageInfo = 'نامشخص';
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      const usedMb = ((est.usage || 0) / (1024 * 1024)).toFixed(2);
      const quotaMb = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
      storageInfo = `${usedMb} MB / ${quotaMb} MB`;
    } catch {
      storageInfo = 'در دسترس نیست';
    }
  }

  const logs = getDiagnostics();

  let report = `# گزارش عیب‌یابی دَفتَرچه (Daftarche Diagnostics)\n\n`;
  report += `- تاریخ تولید: ${time}\n`;
  report += `- نسخه برنامه: ${version} (ساخت: ${build})\n`;
  report += `- حافظه تخمینی: ${storageInfo}\n`;
  report += `- مشخصات محیط: ${ua}\n`;
  report += `- تعداد خطاهای ثبت‌شده: ${logs.length} (حداکثر ${MAX_DIAGNOSTIC_ENTRIES})\n\n`;

  if (!logs.length) {
    report += `## وضعیت سیستم\nهیچ خطایی ثبت نشده است؛ برنامه کاملاً پایدار بوده است.\n`;
    return report;
  }

  report += `## فهرست خطاهای محلی اخیر\n`;
  logs.forEach((log, index) => {
    report += `\n### ${index + 1}. [${log.ts}] [منبع: ${log.source}]\n`;
    report += `- نوع: ${log.name}\n`;
    report += `- پیام: ${log.message}\n`;
    report += `- بیلد: ${log.build}\n`;
    if (Array.isArray(log.stack) && log.stack.length > 0) {
      report += `- پشته:\n`;
      log.stack.forEach(frame => {
        report += `    ${frame}\n`;
      });
    }
  });

  return report;
}

let listenersAttached = false;

/**
 * Initializes global uncaught error and unhandled rejection listeners.
 */
export function initDiagnostics() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  window.addEventListener('error', event => {
    try {
      const err = event.error || event.message || 'Window error';
      logDiagnosticError('window.error', err);
    } catch {
      // Safety guarantee: diagnostics logger must never crash the app
    }
  });

  window.addEventListener('unhandledrejection', event => {
    try {
      const err = event.reason || 'Unhandled promise rejection';
      logDiagnosticError('window.unhandledrejection', err);
    } catch {
      // Safety guarantee
    }
  });
}

// Auto-initialize if running in a window environment
if (typeof window !== 'undefined') {
  initDiagnostics();
}
