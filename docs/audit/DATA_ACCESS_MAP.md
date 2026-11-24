# Phase 1 — Data Access Map

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.1
**Document status:** map of how the current modules reach persistent storage. Nothing here is implemented.
**Date of inspection:** 19 November 2026

This map answers one question: **which module touches which persisted thing, and through which door.** It is the input to the repository boundary in Stage 1.4, because a write door can only be introduced where the writes actually are.

---

## 1. The three doors that exist today

```
                       ┌──────────────────────────────────────────────┐
   views + domain ────►│ js/store.js                                  │
                       │  safeSet / safeRemove / scheduleSave          │
                       │  readJSON / readString                        │
                       │  migrateStorage / clearAll                    │
                       └───────────────┬──────────────────────────────┘
                                       │ localStorage
                       ┌───────────────┴──────────────┐
                       │ browser localStorage          │
                       └──────────────────────────────┘

   js/library.js ─────► indexedDB.open('daftarche-books', 1)    (its own connection, its own promise cache)
   js/audio.js   ─────► indexedDB.open('daftarche-audio', 1)    (its own connection, its own promise cache)

   js/i18n.js:1057 ───► localStorage.getItem('daftarche-name')   (the one bypass)
```

**CURRENT STATE.** There is no fourth door. `js/backup.js` and `js/pdfpack.js` are deliberately storage-injected and DOM-free: `backup.js` receives a storage object, `pdfpack.js` receives blobs. That is why they can be tested without a browser and why they should keep that property after the repository is introduced.

---

## 2. Module → persisted data matrix

Legend: **W** writes, **R** reads, **W→** writes through another module's API.

| Module | Tasks | History | Moods | Ledger | Achievements | Focus history | Live session | Books meta | Book blobs | Audio blobs | Preferences | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `state.js` | R | R | R | — | — | — | — | — | — | — | R (name, pomo) | Populates the singleton at import time |
| `store.js` | W | W | W | W | W | W | W | W | — | — | W | The only localStorage door |
| `tasks.js` | W | — | — | W→ | — | — | — | — | — | — | — | `save()` = `saveTasks(state.tasks)`; calls `rememberDone` |
| `notifications.js` | W→ | — | — | — | — | — | — | — | — | — | — | Mutates `notifiedStatus` on a task and calls the bound save |
| `focus.js` | R | — | — | W→ | — | W→ | W | — | — | R/W→ | W | Persists live session; finalises into history via `focushistory.js` |
| `focushistory.js` | — | — | — | — | — | W/R | — | — | — | — | — | Cap, dedupe, normalise |
| `week.js` | — | W | W | — | — | — | — | — | — | — | — | Today's mood and day marker |
| `ledger.js` | R | R | R | W/R | — | R | — | R | — | — | R (freeze) | Monotonic floors |
| `daycache.js` | R | R | R | R | — | R | — | R | — | — | — | In-memory only |
| `library.js` | — | — | — | — | — | — | — | W/R | W/R | — | — | Second store; `saveMeta()` |
| `reader.js` | — | — | — | — | — | — | — | W→ | R | — | W (pen width) | Writes progress, stats, highlights, notes, cover |
| `stats.js` | R | R | R | R | — | R | — | R | — | — | R/W (range) | Read-only over other owners |
| `achievementsview.js` | R | — | — | — | W/R | — | — | — | — | — | — | One evaluation, one write |
| `achievements.js` | — | — | — | — | R | — | — | — | — | — | — | Pure evaluation and reward catalogue |
| `profile.js` | — | — | — | — | — | — | — | — | — | — | W/R (avatar, photo, first-seen) | Identity |
| `settings.js` | W→ | W→ | R | — | — | — | — | W→ | W→ | W→ | — | Restore, wipe, export |
| `backup.js` | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | — | — | R/W | Pure; storage injected |
| `audio.js` | — | — | — | — | — | — | — | — | — | W/R | R/W (volumes) | Own IndexedDB connection |
| `theme.js` | — | — | — | — | R | — | — | — | — | — | W/R (theme, modes, auto) | Reward gate reads achievements |
| `worlds.js` | R | — | — | — | — | — | — | — | — | — | W (week goal) | Reads tasks and history |
| `birthday.js` | — | — | — | — | — | — | — | — | — | — | W/R (birthday keys) | No direct storage call |
| `i18n.js` | — | — | — | — | — | — | — | — | — | — | R (name, direct) | **Bypasses `store.js`** |
| `backup-nudge.js` | R | — | — | — | — | — | — | — | — | — | W/R (stamps) | |
| `changelog.js` | — | — | — | — | — | — | — | — | — | — | W/R (seen version) | |
| `textsize.js`, `motion.js` | — | — | — | — | — | — | — | — | — | — | W/R | Single preference each |

**CURRENT STATE.** Every module in the matrix that writes does so by mutating a shared object (`state`, the library's module array, a task record) and then calling a save function. None of them describes *what changed*; the save call serialises a whole document.

---

## 3. Write paths, entity by entity

### 3.1 Tasks

| Operation | Path | What is lost today |
|---|---|---|
| Create | `tasks.js` builds the record → `state.tasks.unshift(task)` → `save()` | Nothing; order is the array |
| Edit | Editor mutates the task object in place → `save()` | No stamp of which field changed |
| Toggle done | Sets `done` and `doneAt` (or clears both) → `save()` → `rememberDone()` → ledger floor | No tombstone for the un-tick |
| Reorder | `state.tasks` spliced → `save()` | Order is not modelled as data; it is array position |
| Recover from undo | Spliced back at the remembered index → `save()` | The undo queue is memory-only |
| Delete (trash) | `state.tasks = tasks.filter(t => t.id !== id)` → `save()` → `showUndo(task, index)` | **No tombstone** |
| Clear done | `state.tasks = currentTasks.filter(t => !t.done)` → `save()` → undo queue | **No tombstone**; several deletions at once |
| Restore backup | `applyBackup` / `mergeBackup` → `hydrateStateAfterRestore` | Replaces the in-memory list wholesale |

### 3.2 Books

| Operation | Path | What is lost today |
|---|---|---|
| Import | `nextId()` → `putBook({id, blob})` (IndexedDB) → `books.unshift({...})` → `saveMeta()` | The two writes are not atomic: a failed metadata write leaves a file with no record |
| Progress | `updateBook(id, {lastPage, lastReadAt})` → `saveMeta()` | No stamp; the furthest-page rule lives only in the backup merger |
| Page marked read | Mutates `completedPages` set, stats and `lastReadAt` in one `updateBook` | Whole book record rewritten |
| Highlight / note | Push into `highlights` / `notes` → `updateBook` | Whole array rewritten on each mark |
| Cover | Written into the metadata record as a data URL | Binary inside localStorage |
| Rename / goal | `updateBook` | No stamp |
| Soft delete | Removes from array → `saveMeta()` → after 5 s `delBookBlob(id)` | Undo window memory-only; the two stores settle at different times |
| Restore metadata | `applyBackup` / `mergeBackup` + `reloadBooks()` | Orphan blobs remain; restored rows may have no file |

### 3.3 Focus

| Operation | Path |
|---|---|
| Start / pause / resume | Mutates `state.session` → `saveSession` (`daftarche-focus-session`) |
| Finish | Finalises, writes session to `daftarche-focus-history` via `addSessionToHistory` (dedupe by id, cap 100), invalidates the day cache |
| Cancel | Keeps the record with `status: 'cancelled'`; history only counts accepted records |

### 3.4 Activity aggregates

| Store | Write path |
|---|---|
| Mood | Mood button → `state.moods[dayKey] = 1..5` → `saveMoods` |
| Day opened | `recordDay()` → pushes today's key once → `saveHistory` |
| Ledger | `rememberDone` / `rememberFocus` read the live count **after** the change and raise a floor with `bumpDay` |
| Achievements | `achievementsview` evaluates once per change, writes `{v, baselineAt, unlocked, recSeen}` |

**CURRENT STATE — one important property worth preserving.** The ledger is a *floor*, not a second source of truth: it is derived from live records and only ever raises a number (`bumpDay` cannot lower). Any repository design must keep that property, because it is what makes ticking and un-ticking a task idempotent.

---

## 4. Read paths that matter to a data layer

| Reader | What it assumes about storage |
|---|---|
| `state.js` at import | Storage is readable **synchronously** and before any module renders |
| `daycache.js` | Can fingerprint tasks, history, moods, books and ledger cheaply, and invalidate on `notify()` |
| `ledger.collectTotals` | Six live sources plus floors; missing/corrupt ledger must degrade to live values |
| `achievementsview` | Achievement envelope is sanitised before use; missing `baselineAt` means first run |
| `library.renderShelf` | `books` array is the shelf; a change must dispatch `daftarche:books-changed` |
| `backup.js` | Storage is a `localStorage`-shaped object with `length`, `key(i)`, `getItem`, `setItem`, `removeItem` |
| `settings.js` | After restore it re-hydrates `state` and re-renders every page |

**RISK.** The synchronous read at import time is load-bearing. A future IndexedDB-primary store cannot be swapped in behind the same API without either an explicit async boot phase or a synchronous cache. `DATA_ACCESS_LAYER_DESIGN.md` §6 addresses this directly.

---

## 5. Direct storage access outside the central utilities

| # | Location | Call | Verdict |
|---|---|---|---|
| 1 | `js/i18n.js:1057` | `localStorage.getItem('daftarche-name')` | Out of contract; must be replaced by `store.loadName()` or the repository equivalent |
| 2 | `js/library.js` `db()` | `indexedDB.open('daftarche-books', 1)` | Legitimate owner of the file store, but outside any shared adapter |
| 3 | `js/library.js` `clearLibraryData` | `indexedDB.deleteDatabase` | Same |
| 4 | `js/audio.js` `db()` | `indexedDB.open('daftarche-audio', 1)` | Same |
| 5 | `js/audio.js` `clearUserAudioData` | `indexedDB.deleteDatabase` | Same |
| 6 | `js/store.js` | all `localStorage` calls | The central door itself |
| 7 | `js/backup.js` | receives `window.localStorage` from `settings.js` | Deliberate injection; keep |

Everything else — 60+ modules — reaches storage only through `store.js` exports or through another module's public functions.

---

## 6. Where the repository boundary must be cut (PROPOSED DESIGN)

```
CURRENT                                   PROPOSED
──────────────────────────────────────    ──────────────────────────────────────────────
tasks.js ──► state.tasks ──► store.js     tasks.js ──► tasksRepository ──► adapters ──► storage
library.js ─► books[] ─────► store.js     library.js ─► booksRepository ─► adapters ──► storage
reader.js ──► updateBook ──► library.js   reader.js ──► booksRepository.saveProgress(...)
focus.js ───► state.session ► store.js    focus.js ───► activityRepository.saveSession(...)
ledger.js ──► scheduleSave               ledger.js ──► activityRepository.raiseFloor(...)
audio.js ───► indexedDB (own)            audio.js ───► binaryStore adapter (shared failure surface)
i18n.js ────► localStorage (direct)      i18n.js ────► preferencesRepository.getName()
```

Cut order is deliberate and does **not** follow the biggest pain first; it follows the risk of leaving the write unwrapped:

| Order | Boundary | Reason |
|---|---|---|
| 1 | Tasks | The only record with delete paths, undo queues and a bulk action; the highest resurrection risk |
| 2 | Books metadata | Second store, two-store delete, and the only record whose binary is excluded from Sync |
| 3 | Activity (history, moods, ledger, achievements) | Monotonic floors and per-day keys; rules already exist and must simply move |
| 4 | Focus (live session + history) | Must stay device-local until OD-05; wrap the live session first, history last |
| 5 | Preferences and identity | Many keys, low risk, and **P** status means they stay local by default |
| 6 | Binary stores (PDF, audio) | Shared adapter and failure surface, but no sync path ever reaches them |

**PROPOSED DESIGN.** Views keep their current rendering contract. Only the write side moves. A view that needs new data asks the repository; it does not learn about adapters.

---

## 7. Failure surfaces today

| Failure | Where it is caught | What the user sees |
|---|---|---|
| `localStorage.setItem` throws (quota, private mode) | `store.js` `safeSet` → `daftarche:storage-error` → `storagewarn.js` | One toast, rate-limited |
| IndexedDB put fails | `library.js` `putBook` rejects → import handler shows an inline message | "The book was not saved; storage may be full" |
| IndexedDB delete is blocked | `clearLibraryData` / `clearUserAudioData` resolve `false` | Notice: close other tabs and retry |
| Corrupt JSON in a key | `readJSON` / `readString` fall back | Silent fallback to defaults |
| Corrupt task record | `normalizeTask` repairs on read | Silent repair |
| Corrupt focus record | `normalizeHistoryRecord` drops it | Silent loss |
| Restore runs out of space | `applyBackup` rolls back and reports | "There was not enough room; nothing changed" |

**RISK.** Silent fallbacks are correct for a local-only app and are not acceptable for a device that also holds account data, where "my list is empty" can mean corruption rather than a fresh start. `DATA_RECOVERY_STRATEGY.md` §4 separates *readable but empty* from *unreadable*, and requires the distinction to become visible before Sync ships.

---

## 8. Reading this map during implementation

A change is considered to have moved a boundary when, for its entity:

1. no module outside its repository assigns the shared object or calls a storage setter for the entity's key;
2. the repository call happens before any render that shows the change;
3. the existing test for that entity still passes **and** a new test asserts the write went through the repository;
4. the documented device-local/excluded fields are unchanged in the payload actually written.

Point 4 is the one that quietly fails: `normalizeTask` spreads unknown fields, so an extra field added for sync support would be persisted and then included in a JSON backup without anyone deciding it should be.
