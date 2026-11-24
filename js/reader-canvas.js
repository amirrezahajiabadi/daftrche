/* ═══ PDF Canvas Virtualization & Low-End Memory Manager ═══
   Encapsulates:
     · PDF Canvas Virtualization & Buffer Management (active ±1 page sliding window)
     · Canvas Memory Lifecycle & GPU texture recycling (width=0, height=0 release)
     · Device Pixel Ratio (DPR) capping to prevent mobile GPU OOM crashes
     · In-flight PDF.js render task cancellation and race condition settlement
*/

import { PAGE_WINDOW_RADIUS, calculateSafeScale } from './reader-state.js';

export { PAGE_WINDOW_RADIUS };

/**
 * Registry of active page canvas buffers.
 * Map<number, { canvas: HTMLCanvasElement|Object, width: number, height: number, renderTask?: Object }>
 */
export const pageBufferMap = new Map();

/**
 * Prunes canvas buffers outside the active sliding window [activePage - 1, activePage + 1].
 * For evicted pages, explicitly zeroes canvas dimensions to release backing GPU textures
 * and cancels any in-flight render tasks.
 * @param {number} activePage
 */
export function prunePageBuffers(activePage) {
  for (const [p, buf] of pageBufferMap.entries()) {
    if (Math.abs(p - activePage) > PAGE_WINDOW_RADIUS) {
      if (buf && buf.canvas) {
        buf.canvas.width = 0;
        buf.canvas.height = 0;
        buf.canvas = null;
      }
      if (buf && buf.renderTask) {
        try { buf.renderTask.cancel(); } catch (e) { /* ignore */ }
        buf.renderTask = null;
      }
      pageBufferMap.delete(p);
    }
  }
}

/**
 * Safely cancels an in-flight PDF.js render task and waits for it to settle.
 * @param {Object|null} task
 * @param {number} [timeoutMs=1500]
 * @returns {Promise<void>}
 */
export async function settleRenderTask(task, timeoutMs = 1500) {
  if (!task) return;
  try { task.cancel(); } catch (e) { /* ignore */ }
  await Promise.race([
    Promise.resolve(task.promise).catch(() => {}),
    new Promise(r => setTimeout(r, timeoutMs)),
  ]);
}

/**
 * Safely invokes page.cleanup() if available on the page object.
 * @param {Object} page
 */
export function safeCleanup(page) {
  try { page?.cleanup?.(); } catch (e) { /* ignore */ }
}

/**
 * Explicitly releases GPU textures on a canvas element by zeroing its dimensions.
 * @param {HTMLCanvasElement|Object} canvas
 */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  if (canvas.style) {
    canvas.style.width = '';
    canvas.style.height = '';
  }
}

/**
 * Configures canvas backing dimensions with safe DPR capping for mobile/low-end devices.
 * @param {HTMLCanvasElement|Object} canvas
 * @param {Object} viewport PDF.js viewport
 * @param {number} [zoom=1]
 * @param {number} [rawDpr=1]
 * @returns {{ safeDpr: number, effectiveWidth: number, effectiveHeight: number }}
 */
export function setupPageCanvas(canvas, viewport, zoom = 1, rawDpr = 1) {
  if (!canvas || !viewport) return { safeDpr: 1, effectiveWidth: 0, effectiveHeight: 0 };

  const { dpr: safeDpr } = calculateSafeScale({
    zoom,
    dpr: rawDpr,
    maxDpr: 2,
    baseWidth: viewport.width,
    baseHeight: viewport.height,
  });

  const effectiveWidth = Math.floor(viewport.width * safeDpr);
  const effectiveHeight = Math.floor(viewport.height * safeDpr);

  canvas.width = effectiveWidth;
  canvas.height = effectiveHeight;
  if (canvas.style) {
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
  }

  return { safeDpr, effectiveWidth, effectiveHeight };
}
