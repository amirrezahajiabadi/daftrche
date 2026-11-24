/* ═══ Long-List Windowing & Progressive Rendering Helper ═══
   Pure mathematical and slice calculation logic for large list rendering.
   Zero DOM dependencies — 100% testable in Node.js.
*/

export const DEFAULT_BATCH_SIZE = 50;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 200;

/**
 * Clamps a batch size to safe positive bounds.
 * @param {number} size
 * @param {number} [min=MIN_BATCH_SIZE]
 * @param {number} [max=MAX_BATCH_SIZE]
 * @param {number} [fallback=DEFAULT_BATCH_SIZE]
 * @returns {number}
 */
export function clampBatchSize(
  size,
  min = MIN_BATCH_SIZE,
  max = MAX_BATCH_SIZE,
  fallback = DEFAULT_BATCH_SIZE
) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Computes the visible slice and pagination metadata for a list.
 * @template T
 * @param {Array<T>} items
 * @param {number} [renderedCount=0] Current number of items already rendered
 * @param {number} [batchSize=DEFAULT_BATCH_SIZE]
 * @returns {{
 *   slice: Array<T>,
 *   startIndex: number,
 *   endIndex: number,
 *   renderedCount: number,
 *   totalCount: number,
 *   hasMore: boolean,
 *   remainingCount: number,
 *   nextBatchSize: number
 * }}
 */
export function computeWindowSlice(
  items,
  renderedCount = 0,
  batchSize = DEFAULT_BATCH_SIZE
) {
  const safeItems = Array.isArray(items) ? items : [];
  const total = safeItems.length;
  const safeBatch = clampBatchSize(batchSize);

  let effectiveCount = Number.isFinite(Number(renderedCount)) && Number(renderedCount) > 0
    ? Math.floor(Number(renderedCount))
    : safeBatch;

  // Initial render cannot exceed total, but if total is 0, effectiveCount is 0
  if (total === 0) {
    effectiveCount = 0;
  } else {
    effectiveCount = Math.min(total, Math.max(safeBatch, effectiveCount));
  }

  const slice = safeItems.slice(0, effectiveCount);
  const remaining = Math.max(0, total - effectiveCount);
  const hasMore = remaining > 0;
  const nextBatchSize = Math.min(safeBatch, remaining);

  return {
    slice,
    startIndex: 0,
    endIndex: effectiveCount,
    renderedCount: effectiveCount,
    totalCount: total,
    hasMore,
    remainingCount: remaining,
    nextBatchSize,
  };
}

/**
 * Computes index boundaries for the next incremental chunk to render.
 * @param {number} currentCount
 * @param {number} totalCount
 * @param {number} [batchSize=DEFAULT_BATCH_SIZE]
 * @returns {{ startIndex: number, endIndex: number, size: number, hasMoreAfter: boolean }}
 */
export function getNextBatchRange(
  currentCount,
  totalCount,
  batchSize = DEFAULT_BATCH_SIZE
) {
  const total = Number.isFinite(Number(totalCount)) && Number(totalCount) > 0
    ? Math.floor(Number(totalCount))
    : 0;
  const start = Number.isFinite(Number(currentCount)) && Number(currentCount) > 0
    ? Math.min(total, Math.floor(Number(currentCount)))
    : 0;
  const safeBatch = clampBatchSize(batchSize);

  const end = Math.min(total, start + safeBatch);
  const size = Math.max(0, end - start);
  const hasMoreAfter = end < total;

  return {
    startIndex: start,
    endIndex: end,
    size,
    hasMoreAfter,
  };
}

/**
 * Extracts the next batch of items from an array.
 * @template T
 * @param {Array<T>} items
 * @param {number} currentCount
 * @param {number} [batchSize=DEFAULT_BATCH_SIZE]
 * @returns {Array<T>}
 */
export function getNextBatchSlice(
  items,
  currentCount,
  batchSize = DEFAULT_BATCH_SIZE
) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const range = getNextBatchRange(currentCount, items.length, batchSize);
  if (range.size === 0) return [];
  return items.slice(range.startIndex, range.endIndex);
}

/**
 * Determines whether more items can be appended to the rendered list.
 * @param {number} renderedCount
 * @param {number} totalCount
 * @returns {boolean}
 */
export function canAppendMore(renderedCount, totalCount) {
  const total = Number(totalCount) || 0;
  const cur = Number(renderedCount) || 0;
  return total > 0 && cur < total;
}

/**
 * Creates an encapsulated, pure window state controller.
 * @param {Object} [options={}]
 * @param {number} [options.initialBatchSize=DEFAULT_BATCH_SIZE]
 * @param {number} [options.batchSize=DEFAULT_BATCH_SIZE]
 * @returns {{
 *   reset: () => void,
 *   getRenderedCount: () => number,
 *   setRenderedCount: (n: number) => number,
 *   getVisibleSlice: <T>(items: Array<T>) => Array<T>,
 *   expand: <T>(itemsOrTotal: Array<T> | number) => { nextRange: { startIndex: number, endIndex: number, size: number }, newCount: number, hasMore: boolean },
 *   hasMore: <T>(itemsOrTotal: Array<T> | number) => boolean,
 *   remaining: <T>(itemsOrTotal: Array<T> | number) => number
 * }}
 */
export function createListWindowState({
  initialBatchSize = DEFAULT_BATCH_SIZE,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  const safeInitial = clampBatchSize(initialBatchSize);
  const safeBatch = clampBatchSize(batchSize);
  let renderedCount = safeInitial;

  return {
    reset() {
      renderedCount = safeInitial;
    },
    getRenderedCount() {
      return renderedCount;
    },
    setRenderedCount(n) {
      renderedCount = Math.max(0, Math.floor(Number(n) || 0));
      return renderedCount;
    },
    getVisibleSlice(items) {
      const safeItems = Array.isArray(items) ? items : [];
      if (safeItems.length === 0) return [];
      const effective = Math.min(safeItems.length, renderedCount);
      return safeItems.slice(0, effective);
    },
    expand(itemsOrTotal) {
      const total = Array.isArray(itemsOrTotal)
        ? itemsOrTotal.length
        : Math.max(0, Math.floor(Number(itemsOrTotal) || 0));
      const range = getNextBatchRange(renderedCount, total, safeBatch);
      renderedCount = range.endIndex;
      return {
        nextRange: range,
        newCount: renderedCount,
        hasMore: renderedCount < total,
      };
    },
    hasMore(itemsOrTotal) {
      const total = Array.isArray(itemsOrTotal)
        ? itemsOrTotal.length
        : Math.max(0, Math.floor(Number(itemsOrTotal) || 0));
      return renderedCount < total;
    },
    remaining(itemsOrTotal) {
      const total = Array.isArray(itemsOrTotal)
        ? itemsOrTotal.length
        : Math.max(0, Math.floor(Number(itemsOrTotal) || 0));
      return Math.max(0, total - renderedCount);
    },
  };
}
