/* ═══ Library: Reading Workspace — Shelf, Reading State, Goal, Storage ═══ */
import { $, faNum, dayKey, esc, nextId, normalizeFa } from './utils.js';
import { readJSON, safeSet, scheduleSave, STORAGE_ERROR_EVENT, requestPersistentStorage } from './store.js';
import { showNotice } from './dialog.js';
import { LIB_ICONS } from './constants.js';
import { openChipPicker } from './taskedit.js';
import { buildZip, readZip, looksLikePdf } from './pdfpack.js';
import { notify } from './bus.js';

const META_KEY = 'daftarche-books-meta';
/* Read through the storage layer's guarded reader: a corrupt value falls back
   to an empty shelf instead of throwing while this module is being evaluated,
   which would otherwise stop the whole app from booting. A value that parses
   but is not a list is treated the same way. */
const storedBooks = readJSON(META_KEY, null);
let books = Array.isArray(storedBooks) ? storedBooks : [];
const saveMeta = () => {
  const ok = scheduleSave(META_KEY, books);
  /* The Today page shows the reading goals; it hears about a change here instead of
     having every writer (the reader, the goal sheet, import) call it. */
  try { window.dispatchEvent(new Event('daftarche:books-changed')); } catch { /* no window */ }
  notify();
  return ok;
};

export function reloadBooks() {
  const stored = readJSON(META_KEY, null);
  books = Array.isArray(stored) ? stored : [];
  renderShelf();
  try { window.dispatchEvent(new Event('daftarche:books-changed')); } catch { /* no window */ }
}

/* Books with a daily page goal that is still running, for the Today page. */
export function readingGoalsToday() {
  const k = dayKey(new Date());
  return books
    .filter(b => Number(b.goal?.pagesPerDay) > 0 && !bookComplete(b))
    .map(b => {
      const goal = Number(b.goal.pagesPerDay);
      const pages = b.stats?.[k]?.pages || 0;
      return { id: b.id, title: b.title || 'کتاب', goal, pages, pct: Math.min(100, Math.round(pages / goal * 100)), met: pages >= goal };
    });
}

export const getBooks = () => books;
export const getBook = id => books.find(b => b.id === id);
export function updateBook(id, patch) {
  const b = getBook(id); if (!b) return;
  Object.assign(b, patch); saveMeta();
}

/* ── Reading progress (deterministic: completed pages / total pages) ── */
export const bookDone = b => new Set(b?.completedPages || []);
export const bookPct = b => (b?.numPages ? Math.round((bookDone(b).size / b.numPages) * 100) : 0);
export const bookComplete = b => !!b?.numPages && bookDone(b).size >= b.numPages;

/* ── IndexedDB for the PDF file ── */
const DB_NAME = 'daftarche-books';
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('books', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
export async function getBookBlob(id) {
  const d = await db();
  return new Promise(res => {
    const q = d.transaction('books').objectStore('books').get(id);
    q.onsuccess = () => res(q.result ? q.result.blob : null);
    q.onerror = () => res(null);
  });
}
/* ── PDF pack (js/pdfpack.js) ──
   The JSON backup carries the book list and progress but not the files. These two
   carry the files: every book's PDF into one zip, and back again. A file goes back
   only to a book the list already knows (restore the JSON backup first) and only
   when that book has no file yet — nothing here overwrites a PDF that is present. */
export async function exportBookPack() {
  const entries = []; let missing = 0;
  for (const b of books) {
    const blob = await getBookBlob(b.id);
    if (blob) entries.push({ name: `${b.id}.pdf`, blob }); else missing++;
  }
  if (!entries.length) return { blob: null, count: 0, missing };
  return { blob: await buildZip(entries), count: entries.length, missing };
}
export async function importBookPack(file) {
  const entries = await readZip(file);
  const res = { restored: 0, had: 0, unknown: 0, bad: 0 };
  for (const { name, blob } of entries) {
    const m = /^([^/\\]+)\.pdf$/i.exec(name);
    const book = m && getBook(m[1]);
    if (!book) { res.unknown++; continue; }
    if (await getBookBlob(book.id)) { res.had++; continue; }
    if (!(await looksLikePdf(blob))) { res.bad++; continue; }
    await putBook({ id: book.id, blob });
    res.restored++;
  }
  return res;
}

/* A put that fails (a full quota, a storage layer refusing to write) used to
   leave this promise pending forever: the import hung with no book, no error
   and the file picker stuck. Every way the transaction can end is wired up
   now, so the caller can say what went wrong and let go of the input. */
async function putBook(rec) {
  const d = await db();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = d.transaction('books', 'readwrite'); } catch (err) { reject(err); return; }
    const req = tx.objectStore('books').put(rec);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    req.onerror = () => reject(req.error || new Error('IndexedDB write failed'));
  });
}
async function delBookBlob(id) {
  const d = await db();
  return new Promise(res => { const tx = d.transaction('books', 'readwrite'); tx.objectStore('books').delete(id); tx.oncomplete = res; });
}

/* Clear All: the whole library database goes, PDF files included, because that
   store is the user's own reading material and no part of it is recoverable
   once the metadata is gone. The connection this page is holding is closed
   first — an open handle of our own makes the delete request blocked, and a
   blocked request would leave the files on disk while the app reports a clean
   wipe. Resolves true only when the database is really gone; a failed or
   blocked delete resolves false so the caller can say so instead of reloading
   as if everything had been removed. */
export function clearLibraryData() {
  return new Promise(resolve => {
    const remove = () => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    };
    /* A connection may still be opening; it is awaited so it is closed before
       the delete request is issued, and dropped so a later use reopens fresh. */
    db().then(
      d => { try { d.close(); } catch (e) {} dbP = null; remove(); },
      () => { dbP = null; remove(); }
    );
  });
}


/* ── Soft delete ──
   One book, one undo. The PDF file is the slow half of a delete and the half
   that cannot be rebuilt, so it is only unlinked when the offer expires;
   putting the record back inside that window restores the book with its file,
   its highlights and its notes untouched.

   There is a single pending slot, because the notice is a single notice: a
   second delete has to settle the first, or the row the reader still believes is
   recoverable would quietly lose its file. */
let pendingDelete = null; // { book, index, commit }
function softDeleteBook(id) {
  const idx = books.findIndex(b => b.id === id);
  if (idx < 0) return;
  const book = books[idx];
  const title = book.title || 'کتاب';
  settlePendingDelete();
  const commit = () => { delBookBlob(id); pendingDelete = null; };
  pendingDelete = { book, index: idx, commit };
  books = books.filter(b => b.id !== id);
  saveMeta();
  renderShelf();
  showNotice(`«${title}» حذف شد.`, { actionLabel: 'برگردون', onAction: restorePendingDelete });
  /* The notice's own timer is not exported, so the same 5s is armed here: whether
     the offer was taken or simply ran out, the file follows the metadata. */
  setTimeout(() => { if (pendingDelete?.commit === commit) commit(); }, 5000);
}
function restorePendingDelete() {
  if (!pendingDelete) return;
  const { book, index } = pendingDelete;
  pendingDelete = null;
  books.splice(Math.min(index, books.length), 0, book);
  saveMeta();
  renderShelf();
}
/* The offer is over — a second delete, or the whole library being cleared. */
function settlePendingDelete() {
  if (!pendingDelete) return;
  const { commit } = pendingDelete;
  pendingDelete = null;
  commit();
}

/* The import failed and no toast is on screen for it: say so, then let the
   shared storage warning speak too (it owns its own rate limiting). */
function showImportError(message) {
  const toast = document.getElementById('storageToast');
  if (!toast) return;
  const label = toast.querySelector('.toast-text');
  if (label && message) label.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  /* The storage listener also fires on a failed write; this makes sure the
     message is not swallowed when the failure was the IndexedDB put alone. */
  window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key: META_KEY } }));
}

const BOOK_ICON = `<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 016.5 2z"/></svg>`;

/* ── Book totals (new notes + old highlights) ── */
function bookTotals(b) {
  let minutes = 0;
  Object.values(b.stats || {}).forEach(s => { minutes += s.minutes || 0; });
  return { minutes, notes: (b.highlights || []).length + (b.notes || []).length };
}
const bookStatus = b => bookComplete(b) ? 'done' : ((bookDone(b).size > 0 || (b.lastPage || 1) > 1) ? 'reading' : 'new');

/* Tactile notebook cover fallback when PDF has no cover thumbnail yet */
function notebookCoverMarkup(title) {
  return `
    <div class="book-cover-notebook">
      <div class="nb-pattern" aria-hidden="true"></div>
      <div class="nb-header"><span>دفتَرچه</span><span>PDF</span></div>
      <div class="nb-title">${esc(title)}</div>
      <div class="nb-footer">${BOOK_ICON}</div>
    </div>`;
}

/* ── Shelf State (Search, Filter, Sort) ── */
let shelfFilter = 'all';
let shelfSort = 'lastRead';
let shelfSearchQuery = '';
let renameBookId = null;

/* ── Library Summary Stats ── */
function updateLibraryStats() {
  const bar = $('#libraryStatsBar');
  if (!bar) return;
  if (!books.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const reading = books.filter(b => bookStatus(b) === 'reading').length;
  const done = books.filter(b => bookStatus(b) === 'done').length;
  let totalPages = 0;
  let totalMins = 0;
  let totalNotes = 0;

  books.forEach(b => {
    totalPages += bookDone(b).size;
    const t = bookTotals(b);
    totalMins += t.minutes;
    totalNotes += t.notes;
  });

  const bCnt = $('#statBooksCount');
  const bSub = $('#statBooksSub');
  const pCnt = $('#statPagesCount');
  const tCnt = $('#statTimeCount');
  const nCnt = $('#statNotesCount');

  if (bCnt) bCnt.textContent = faNum(books.length);
  if (bSub) bSub.textContent = `${faNum(reading)} مطالعه · ${faNum(done)} تمام`;
  if (pCnt) pCnt.textContent = faNum(totalPages);
  if (tCnt) {
    tCnt.textContent = totalMins >= 60
      ? `${faNum(Math.floor(totalMins / 60))}س ${faNum(totalMins % 60)}د`
      : `${faNum(totalMins)} د`;
  }
  if (nCnt) nCnt.textContent = faNum(totalNotes);
}

/* ── Shelf + Currently Reading ── */
export function renderShelf() {
  updateLibraryStats();
  const ctrl = $('#shelfControls');
  if (ctrl) ctrl.hidden = books.length === 0;

  const grid = $('#shelfGrid');
  const doneGrid = $('#doneGrid');
  const doneWrap = $('#doneShelf');
  grid.innerHTML = ''; doneGrid.innerHTML = '';

  let filtered = [...books];
  if (shelfSearchQuery) {
    /* Typed on a Persian keyboard the same title can arrive with an Arabic yeh
       and kaf («كتاب») and never match the «کتاب» that was stored. normalizeFa is
       the app's one answer to that — the task list's own filter uses it — so the
       shelf reads the query through it too. */
    const q = normalizeFa(shelfSearchQuery.trim()).toLowerCase();
    filtered = filtered.filter(b => normalizeFa(b.title || '').toLowerCase().includes(q));
  }

  if (shelfFilter === 'reading') {
    filtered = filtered.filter(b => bookStatus(b) === 'reading');
  } else if (shelfFilter === 'unread') {
    filtered = filtered.filter(b => bookStatus(b) === 'new');
  } else if (shelfFilter === 'done') {
    filtered = filtered.filter(b => bookStatus(b) === 'done');
  }

  // Sort
  if (shelfSort === 'progress') {
    filtered.sort((a, b) => bookPct(b) - bookPct(a));
  } else if (shelfSort === 'newest') {
    filtered.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } else if (shelfSort === 'title') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fa'));
  } else {
    // default: lastRead
    filtered.sort((a, b) => (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0));
  }

  /* The «در حال مطالعه» card shows the book read most recently — only on the
     plain shelf, with no search and no filter. That book is shown there *instead
     of* in the grid below: it used to appear in both, so a one-book shelf read as
     two books and the count chip contradicted the picture. */
  const showFeatured = !shelfSearchQuery && shelfFilter === 'all';
  const featured = showFeatured
    ? [...books].filter(b => bookStatus(b) !== 'done' && b.numPages)
        .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0] || null
    : null;
  const active = filtered.filter(b => bookStatus(b) !== 'done' && b !== featured);
  const finished = filtered.filter(b => bookStatus(b) === 'done');

  $('#shelfEmpty').hidden = books.length > 0;
  /* The PDF files live only in this browser's IndexedDB and are not part of the
     backup (js/backup.js), so the shelf says so while it holds any. */
  const note = $('#shelfNote');
  if (note) note.hidden = books.length === 0;
  doneWrap.hidden = shelfFilter !== 'all' || finished.length === 0 || !!shelfSearchQuery;

  /* An empty shelf already says «هنوز کتابی اینجا نیست» in the middle of the
     grid; the count badge above it saying «خالی» is the same sentence twice, and
     the heading over both is a header for a list that is not there. Both go
     quiet together. */
  const head = $('.shelf-head');
  if (head) head.hidden = books.length === 0;
  const cnt = $('#shelfCount');
  if (cnt) {
    if (filtered.length !== books.length) cnt.textContent = `${faNum(filtered.length)} از ${faNum(books.length)}`;
    else cnt.textContent = `${faNum(books.length)} کتاب`;
  }

  /* Currently Reading card — shown when viewing all books and no active search */
  const slot = $('#lastReadSlot');
  slot.innerHTML = '';
  if (showFeatured) {
    const last = featured;
    if (last) {
      const done = bookDone(last).size;
      const pct = bookPct(last);
      const t = bookTotals(last);
      let goalLine = '';
      if (last.goal?.pagesPerDay) {
        const todayPages = last.stats?.[dayKey(new Date())]?.pages || 0;
        goalLine = `<span class="lr-goal" title="هدف امروز: ${faNum(todayPages)} از ${faNum(last.goal.pagesPerDay)} صفحه">${LIB_ICONS.target} ${faNum(todayPages)}/${faNum(last.goal.pagesPerDay)} امروز</span>`;
      } else if (last.goal?.text) {
        goalLine = `<span class="lr-goal" title="${esc(last.goal.text)}">${LIB_ICONS.target} ${esc(last.goal.text)}</span>`;
      }
      const card = document.createElement('div');
      card.className = 'lastread';
      /* The whole card opens the book, but it is a plain div: a keyboard user
         tabbing through the shelf had no way in — the only focusable thing in
         it was the «ادامه مطالعه» button, so the card's own click target was
         mouse-only. It now carries the same button contract as `.book-cover`
         (role, tabindex, label, Enter/Space) and the button's own activation is
         left to the button. */
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `ادامهٔ مطالعهٔ ${last.title}`);
      card.innerHTML = `
        ${last.cover ? `<img src="${last.cover}" alt="">` : notebookCoverMarkup(last.title)}
        <div class="lr-info">
          <span class="lr-kicker">در حال مطالعه</span>
          <div class="lr-top"><span class="lr-title">${esc(last.title)}</span><span class="lr-pct">${faNum(pct)}٪</span></div>
          <div class="lr-track"><i style="width:${pct}%"></i></div>
          <span class="lr-sub">${faNum(done)} صفحه از ${faNum(last.numPages)} · ص ${faNum(last.lastPage || 1)}${t.minutes ? ` · ${LIB_ICONS.clock} ${faNum(t.minutes)}د` : ''}${t.notes ? ` · ${LIB_ICONS.note} ${faNum(t.notes)}` : ''}</span>
          ${goalLine}
        </div>
        <button type="button" class="lr-btn">ادامه مطالعه ${LIB_ICONS.arrowFwd}</button>`;
      card.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-book', { detail: last.id })));
      card.addEventListener('keydown', e => {
        /* A keypress on the nested button is the button's own, and it bubbles
           here — opening the book twice in one press. */
        if (e.target.closest('.lr-btn')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('open-book', { detail: last.id }));
        }
      });
      slot.appendChild(card);
    }
  }

  if (books.length > 0 && filtered.length === 0) {
    const noResult = document.createElement('div');
    noResult.className = 'shelf-no-result';
    noResult.innerHTML = `
      <p class="shelf-no-result-text">کتابی با این عنوان یا فیلتر پیدا نشد.</p>
      <button type="button" class="shelf-reset-btn" id="shelfResetBtn">پاک کردن جستجو و فیلترها</button>
    `;
    grid.appendChild(noResult);
    $('#shelfResetBtn')?.addEventListener('click', () => {
      shelfSearchQuery = '';
      shelfFilter = 'all';
      const searchInput = $('#shelfSearch');
      if (searchInput) searchInput.value = '';
      const clearBtn = $('#shelfSearchClear');
      if (clearBtn) clearBtn.hidden = true;
      $('#shelfFilter')?.querySelectorAll('.s-filter-chip').forEach(c => {
        const isAll = c.dataset.filter === 'all';
        c.classList.toggle('on', isAll);
        c.setAttribute('aria-pressed', String(isAll));
      });
      renderShelf();
    });
    return;
  }

  /* Shelf cards */
  if (shelfFilter === 'all' && !shelfSearchQuery) {
    active.forEach((b, i) => {
      grid.appendChild(bookCard(b, i, false));
    });
    finished.forEach((b, i) => {
      doneGrid.appendChild(bookCard(b, i, true));
    });
  } else {
    filtered.forEach((b, i) => {
      grid.appendChild(bookCard(b, i, bookStatus(b) === 'done'));
    });
  }
}

function bookCard(b, i, isDone) {
  const done = bookDone(b).size;
  const pct = bookPct(b);
  const st = bookStatus(b);
  const t = bookTotals(b);
  const cta = st === 'done' ? `${LIB_ICONS.check} تمام شد` : `${LIB_ICONS.book} ${st === 'reading' ? 'ادامه' : 'شروع'}`;
  const card = document.createElement('div');
  card.className = 'book-card' + (isDone ? ' book-done' : '');
  card.style.animationDelay = (i * 50) + 'ms';
  card.innerHTML = `
    <div class="book-cover" data-act="open" role="button" tabindex="0" aria-label="باز کردن کتاب ${esc(b.title)}">
      ${b.cover ? `<img src="${b.cover}" alt="">` : notebookCoverMarkup(b.title)}
      <span class="book-prog" style="width:${pct}%"></span>
      ${st === 'reading' ? `<span class="book-pct-badge">${faNum(pct)}٪</span>` : ''}
      ${st === 'done' ? `<span class="book-done-badge" aria-label="مطالعهٔ کامل‌شده">${LIB_ICONS.check}</span>` : ''}
    </div>
    <div class="book-title" data-act="open" role="button" tabindex="0">${esc(b.title)}</div>
    <div class="book-meta">
      ${b.numPages ? `<span>${faNum(done)} از ${faNum(b.numPages)} ص</span>` : '<span>خوانده نشده</span>'}
      ${t.minutes > 0 ? `<span>· ${LIB_ICONS.clock} ${faNum(t.minutes)} د</span>` : ''}
      ${t.notes ? `<span>· ${LIB_ICONS.note} ${faNum(t.notes)}</span>` : ''}
    </div>
    <div class="book-actions">
      <button type="button" class="b-go" data-act="open">${cta}</button>
      <button type="button" class="b-icon-btn b-more" data-act="more" aria-haspopup="menu" aria-label="گزینه‌های کتاب ${esc(b.title)}" title="هدف، تغییر نام، حذف">${LIB_ICONS.more}</button>
    </div>`;
  card.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') window.dispatchEvent(new CustomEvent('open-book', { detail: b.id }));
    /* Goal, rename and delete used to sit on every card as three look-alike round
       buttons, so the one that deletes was as easy to hit as the one that sets a
       goal. They are one ⋯ menu now; delete is last, in red, and still undoable. */
    if (act === 'more') {
      const anchor = e.target.closest('[data-act="more"]');
      openChipPicker(anchor, {
        label: 'گزینه‌های کتاب', current: null,
        options: [
          { value: 'goal', label: 'هدف مطالعه', icon: LIB_ICONS.target, action: true },
          { value: 'rename', label: 'تغییر نام', icon: LIB_ICONS.edit, action: true },
          { value: 'del', label: 'حذف کتاب', icon: LIB_ICONS.trash, action: true, danger: true },
        ],
        onPick: v => {
          if (v === 'goal') openGoal(b.id);
          else if (v === 'rename') openRenameModal(b.id);
          else if (v === 'del') softDeleteBook(b.id);
        },
      });
    }
    /* Soft delete. The row disappears at once and a notice offers it back for a
       few seconds, so the accidental tap that a native confirm used to catch (and
       that a native confirm's mirrored buttons made easy to get wrong) is caught
       by undo instead — and the timer is the only moment the PDF is still in
       IndexedDB. Drawing the shelf without the book would still leave its file
       behind, so the record is held here and put back on «برگردون». */
    if (act === 'del') softDeleteBook(b.id);
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'open') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-book', { detail: b.id }));
      }
    }
  });
  return card;
}

/* ── Reading Goal (metadata only) ── */
let goalBookId = null;
export function openGoal(id) {
  goalBookId = id;
  const b = getBook(id);
  const gp = $('#goalPages');
  gp.value = b.goal?.pagesPerDay > 0 ? b.goal.pagesPerDay : '';
  /* The input can never ask for more pages than the book has. */
  gp.max = String(b.numPages || 500);
  $('#goalText').value = b.goal?.text || '';
  const gtype = b.goal?.text ? 'personal' : 'full';
  document.querySelectorAll('.goal-choice').forEach(c => c.classList.toggle('sel', c.dataset.gtype === gtype));
  $('#goalText').hidden = gtype !== 'personal';
  $('#goalOverlay').hidden = false;
}

/* The goal sheet's page cap follows the book's real page count — but a freshly
   imported book carries `numPages: 0` until the reader has rendered it, so
   opening the goal sheet at import time left the input capped at the 500-page
   placeholder. A three-page PDF could then be given a five-hundred-page-a-day
   goal, which the save handler quietly clamps after the fact. The reader calls
   this the moment the count is known, so an open sheet shows the true cap and
   the next open starts from it. */
export function syncGoalPageCap(id, numPages) {
  if (!numPages || id !== goalBookId) return;
  const gp = $('#goalPages');
  if (gp) gp.max = String(numPages);
}

function initGoal() {
  document.querySelectorAll('.goal-choice').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.goal-choice').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      $('#goalText').hidden = c.dataset.gtype !== 'personal';
      if (c.dataset.gtype === 'personal') $('#goalText').focus();
    };
  });
  $('#goalSave').onclick = () => {
    const b = getBook(goalBookId); if (!b) return;
    const sel = document.querySelector('.goal-choice.sel');
    const gtype = sel?.dataset.gtype || 'full';
    const text = gtype === 'personal' ? $('#goalText').value.trim() : '';
    const entered = Number($('#goalPages').value);
    let pages = Number.isFinite(entered) && entered > 0 ? Math.floor(entered) : null;
    if (pages && b.numPages) pages = Math.min(pages, b.numPages);
    updateBook(goalBookId, { goal: (text || pages) ? { type: gtype, text: text || null, pagesPerDay: pages } : null });
    $('#goalOverlay').hidden = true;
    renderShelf();
    window.dispatchEvent(new CustomEvent('goal-changed'));
  };
  const goalOverlay = $('#goalOverlay');
  $('#goalClose').onclick = () => { goalOverlay.hidden = true; };
  goalOverlay?.addEventListener('click', e => {
    if (e.target === goalOverlay) goalOverlay.hidden = true;
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && goalOverlay && !goalOverlay.hidden) goalOverlay.hidden = true;
  });
  window.addEventListener('open-goal', e => openGoal(e.detail));
}

/* ── Rename Book Modal ── */
function openRenameModal(id) {
  const b = getBook(id);
  if (!b) return;
  renameBookId = id;
  const input = $('#renameInput');
  if (input) input.value = b.title || '';
  const overlay = $('#renameOverlay');
  if (overlay) overlay.hidden = false;
  setTimeout(() => {
    if (input) {
      input.focus();
      input.select();
    }
  }, 120);
}

function initRename() {
  const overlay = $('#renameOverlay');
  const input = $('#renameInput');
  const saveBtn = $('#renameSave');
  const closeBtn = $('#renameClose');

  const closeRename = () => {
    overlay.hidden = true;
    renameBookId = null;
  };

  const commitRename = () => {
    if (!renameBookId) return;
    const val = input.value.trim();
    if (val) {
      updateBook(renameBookId, { title: val });
      renderShelf();
      closeRename();
    } else {
      input.focus();
    }
  };

  saveBtn?.addEventListener('click', commitRename);
  closeBtn?.addEventListener('click', closeRename);
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closeRename();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeRename();
  });
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
  });
}

/* ── Import book ── */
export function initLibrary() {
  renderShelf();
  initGoal();
  initRename();

  const searchInput = $('#shelfSearch');
  const searchClear = $('#shelfSearchClear');
  searchInput?.addEventListener('input', e => {
    shelfSearchQuery = e.target.value;
    if (searchClear) searchClear.hidden = !shelfSearchQuery.trim();
    renderShelf();
  });
  searchClear?.addEventListener('click', () => {
    shelfSearchQuery = '';
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    searchClear.hidden = true;
    renderShelf();
  });

  const filterWrap = $('#shelfFilter');
  filterWrap?.addEventListener('click', e => {
    const btn = e.target.closest('.s-filter-chip[data-filter]');
    if (!btn) return;
    filterWrap.querySelectorAll('.s-filter-chip').forEach(c => {
      const active = c === btn;
      c.classList.toggle('on', active);
      c.setAttribute('aria-pressed', String(active));
    });
    shelfFilter = btn.dataset.filter || 'all';
    renderShelf();
  });

  const sortSelect = $('#shelfSortSelect');
  sortSelect?.addEventListener('change', e => {
    shelfSort = e.target.value;
    renderShelf();
  });

  $('#importBtn').onclick = () => $('#bookFile').click();
  const emptyAdd = $('#emptyAdd');
  if (emptyAdd) emptyAdd.onclick = () => $('#bookFile').click();
  $('#bookFile').addEventListener('change', async e => {
    const fileInput = e.target;
    const f = e.target.files[0];
    if (!f) return;
    /* Two imports in the same millisecond would otherwise collide on one id and
       silently replace each other. */
    const id = nextId();
    /* Asked before the first await, while the browser still counts this as the
       reader's own action — some browsers refuse the request otherwise. */
    requestPersistentStorage();
    try {
      await putBook({ id, blob: f });
      books.unshift({
        id, title: f.name.replace(/\.pdf$/i, ''), addedAt: Date.now(),
        numPages: 0, lastPage: 1, cover: '', goal: null, stats: {}, highlights: [], notes: [],
        completedPages: []
      });
      saveMeta(); renderShelf();
      window.dispatchEvent(new CustomEvent('open-book', { detail: id }));
      /* The goal sheet used to pop open 400ms later, over a reader that had just
         appeared and a first page the person had not seen yet. The goal is one tap
         away on the reader's «هدف» chip and on the shelf card instead. */
    } catch (err) {
      console.warn('کتاب ذخیره نشد:', err);
      showImportError('کتاب ذخیره نشد؛ شاید حافظهٔ مرورگر پر است. یک بار دیگر امتحان کن.');
    } finally {
      /* Whatever happened, the picker is cleared so choosing the same file
         again is a change the browser will report. */
      fileInput.value = '';
    }
  });
}
