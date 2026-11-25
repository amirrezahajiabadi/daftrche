/* ═══ Journal Photo Media Store (IndexedDB + JPEG Compression) ═══
   Stores compressed photos as Blobs in IndexedDB ('daftarche-journal-media') so
   localStorage ('daftarche-journal') only tracks lightweight metadata and never hits
   quota limits. Honors EXIF orientation via createImageBitmap when available.
*/

import { nextId } from './utils.js';

const DB_NAME = 'daftarche-journal-media';
const STORE_NAME = 'photos';
const MAX_EDGE = 1280;
const PHOTO_QUALITY = 0.80;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

let dbPromise = null;
const urlCache = new Map(); // photoId -> objectURL

function openMediaDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error('Failed to open journal media DB'));
      };
    });
  }
  return dbPromise;
}

async function decodeImageFile(file) {
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
    try {
      return await window.createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall back to Image */ }
  }
  const objUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objUrl;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode photo'));
      }, 'image/jpeg', quality);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const bin = atob(dataUrl.split(',')[1] || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type: 'image/jpeg' }));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Downscales & re-encodes an image File to a lightweight JPEG Blob.
 * @param {File|Blob} file
 * @returns {Promise<{ blob: Blob, width: number, height: number, mime: string }>}
 */
export async function compressJournalPhoto(file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) {
    throw new Error('فقط فایل تصویری پشتیبانی می‌شود.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('حجم عکس از حد مجاز بیشتر است.');
  }

  const bmp = await decodeImageFile(file);
  try {
    const srcW = bmp.width || bmp.naturalWidth;
    const srcH = bmp.height || bmp.naturalHeight;
    if (!srcW || !srcH) throw new Error('تصویر قابل خواندن نیست.');

    const longest = Math.max(srcW, srcH);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, width, height);

    const blob = await canvasToJpegBlob(canvas, PHOTO_QUALITY);
    return { blob, width, height, mime: 'image/jpeg' };
  } finally {
    if (typeof bmp.close === 'function') {
      try { bmp.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Compresses and saves a photo File in IndexedDB, returning lightweight metadata.
 * @param {File|Blob} file
 * @returns {Promise<{ id: string, width: number, height: number, mime: string, createdAt: number }>}
 */
export async function saveJournalPhoto(file) {
  const { blob, width, height, mime } = await compressJournalPhoto(file);
  const id = `jp-${nextId()}`;
  const createdAt = Date.now();

  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }
    const req = tx.objectStore(STORE_NAME).put({ id, blob, width, height, mime, createdAt });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Media transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Media transaction aborted'));
    req.onerror = () => reject(req.error || new Error('Media write failed'));
  });

  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    urlCache.set(id, URL.createObjectURL(blob));
  }
  return { id, width, height, mime, createdAt };
}

/**
 * Resolves a cached or freshly loaded ObjectURL for a stored photo ID.
 * Returns '' if unavailable or running outside a browser.
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function getJournalPhotoUrl(id) {
  if (!id || typeof indexedDB === 'undefined' || typeof URL === 'undefined') return '';
  if (urlCache.has(id)) return urlCache.get(id);
  try {
    const db = await openMediaDb();
    const record = await new Promise(resolve => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (!record || !record.blob) return '';
    const url = URL.createObjectURL(record.blob);
    urlCache.set(id, url);
    return url;
  } catch {
    return '';
  }
}

/**
 * Deletes a photo blob from IndexedDB and revokes its cached ObjectURL.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteJournalPhoto(id) {
  if (!id) return false;
  if (urlCache.has(id)) {
    try { URL.revokeObjectURL(urlCache.get(id)); } catch { /* ignore */ }
    urlCache.delete(id);
  }
  if (typeof indexedDB === 'undefined') return true;
  try {
    const db = await openMediaDb();
    await new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the entire journal media IndexedDB store (called during Clear All Data).
 * @returns {Promise<boolean>}
 */
export function clearJournalMediaData() {
  for (const url of urlCache.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  urlCache.clear();
  if (typeof indexedDB === 'undefined') return Promise.resolve(true);

  return new Promise(resolve => {
    const remove = () => {
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      } catch {
        resolve(false);
      }
    };
    if (dbPromise) {
      const opening = dbPromise;
      dbPromise = null;
      opening.then(d => {
        try { d.close(); } catch { /* ignore */ }
        remove();
      }, remove);
    } else {
      remove();
    }
  });
}
