/* Shared test environment: an in-memory localStorage installed BEFORE any app
   module is imported (js/state.js reads storage while it is being evaluated). */
class MemoryStorage {
  constructor() { this.map = new Map(); this.writes = 0; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    this.writes++;
    this.map.set(k, String(v));
    if (typeof globalThis.__DAFTARCHE_CLEAR_DIRTY__ === 'function') {
      globalThis.__DAFTARCHE_CLEAR_DIRTY__(k);
    }
    if (typeof globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__ === 'function') {
      globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__();
    }
  }
  removeItem(k) {
    this.map.delete(k);
    if (typeof globalThis.__DAFTARCHE_CLEAR_DIRTY__ === 'function') {
      globalThis.__DAFTARCHE_CLEAR_DIRTY__(k);
    }
    if (typeof globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__ === 'function') {
      globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__();
    }
  }
  clear() {
    this.map.clear();
    if (typeof globalThis.__DAFTARCHE_RESET_PENDING__ === 'function') {
      globalThis.__DAFTARCHE_RESET_PENDING__();
    }
    if (typeof globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__ === 'function') {
      globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__();
    }
  }
}
export const ls = new MemoryStorage();
globalThis.localStorage = ls;
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
