# Phase 1 — Architecture and Data Audit

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.1
**Document status:** audit of the current working copy. Nothing in this document has been implemented.
**Date of inspection:** 19 November 2026
**Working copy:** `D:\Project\NewDaftrche` (Working Copy only; no Main, Production, deployment or version-control write was performed)

Statement labels used throughout the Phase 1 package:

- **CURRENT STATE** — observed in the source at the commit-less working copy inspected on the date above.
- **APPROVED DECISION** — a product-owner decision already recorded in the audit set; binding on this design.
- **PROPOSED DESIGN** — a recommendation of this package; not implemented, not approved.
- **IMPLEMENTATION STATUS** — what exists in code today.
- **OPEN QUESTION** — needs an owner answer before the related work can ship.
- **RISK** — a named hazard with a consequence.

---

## 1. Method and evidence

**CURRENT STATE.** Every claim below was read from the working copy. No claim is carried over from an earlier document without re-checking it against the file it names.

What was inspected:

| Area | Files read in full or in the relevant part |
|---|---|
| Boot and entry | `index.html`, `js/app.js`, `js/state.js`, `js/constants.js`, `js/bus.js`, `sw.js` |
| Persistence | `js/store.js`, `js/daycache.js`, `js/backup.js`, `js/backup-nudge.js` |
| Record owners | `js/tasks.js`, `js/focushistory.js`, `js/focus.js`, `js/library.js`, `js/reader.js`, `js/ledger.js`, `js/achievements.js`, `js/achievementsview.js`, `js/daycache.js` |
| Binary stores | `js/library.js` (IndexedDB), `js/audio.js` (IndexedDB), `js/pdfpack.js` |
| Preferences and identity | `js/profile.js`, `js/theme.js`, `js/settings.js`, `js/week.js`, `js/textsize.js`, `js/motion.js`, `js/birthday.js`, `js/i18n.js` |
| Platform | `capacitor.config.json`, `package.json`, `.gitattributes`, `tools/build-www.mjs` (read), `js/native.js` (searches) |
| Tests | `tests/_env.mjs`, test-file inventory, one full `node --test` run |

Measurements taken from the working copy:

| Measurement | Value |
|---|---|
| JavaScript modules in `js/` | 68 |
| Lines in `js/` | 27,917 |
| CSS files in `css/` | 24 |
| `*.test.mjs` files in `tests/` | 41 |
| Lines in `index.html` | 1,772 |
| Entries in `sw.js` `SHELL` | 109 |
| `node --test` on 19 November 2026 | **442 tests, 442 pass, 0 fail, ~2.1 s** |

The test result above was produced by running the command in this working copy during this audit. It is the only executable verification performed; no build, no `www/` regeneration, no Android build, no device check and no browser run was performed for this stage.

---

## 2. Application shape

### 2.1 Entry points — CURRENT STATE

```
index.html                      one document, 1,772 lines, all page sections in the markup
  ├─ inline theme script        pinned by CSP hash (tests/csp.test.mjs)
  ├─ js/version.js              classic script; sets DAFTARCHE_RELEASE / DAFTARCHE_BUILD
  └─ js/app.js                  type="module"; the single module entry
       ├─ js/state.js           in-memory singleton, populated at module evaluation
       ├─ js/store.js           localStorage persistence, debounced writes, legacy migration
       ├─ js/bus.js             `subscribe` / `notify`
       └─ 64 further modules    pages, domain logic, calendar, characters, onboarding
sw.js                           service worker; caches the 109-entry SHELL by BUILD
capacitor.config.json           webDir "www"; Android wraps a generated copy of the tree
```

There is no bundler, no transpiler and no runtime dependency (`package.json` has `devDependencies` only, all Capacitor). `package.json` `"type": "module"`.

**CURRENT STATE.** `js/app.js` imports every page module and initialises each through `safe(name, fn)`, so a throw in one section does not stop the others (`js/app.js:47-50`). Boot order matters: `js/state.js` reads storage **while its module body is evaluated**, which is why the test harness installs an in-memory `localStorage` before importing any app module (`tests/_env.mjs:1-5`).

### 2.2 Module boundaries — CURRENT STATE

There is no enforced layering. Modules fall into five practical groups:

| Group | Examples | Notes |
|---|---|---|
| State | `state.js`, `bus.js`, `daycache.js` | Singleton plus derived in-memory cache |
| Persistence | `store.js`, `backup.js`, `pdfpack.js` | `store.js` is the only localStorage door, `backup.js` is pure and storage-injected |
| Domain | `tasks.js`, `ledger.js`, `achievements.js`, `focushistory.js`, `decision.js`, `decisioncontext.js` | `decision.js`/`decisioncontext.js` are the only DOM-free, fully unit-tested domain pair |
| Page/view | `today.js`, `tasks.js`, `stats.js`, `settings.js`, `library.js`, `reader.js`, `profile.js`, `planner.js`, `calendar.js`, `worlds.js` | Imperative DOM rendering; most also mutate state |
| Platform | `native.js`, `pwa.js`, `notifications.js`, `audio.js`, `sharecard.js` | Capacitor bridge and browser APIs |

**CURRENT STATE — the one hard rule that is followed.** All `localStorage` access in the application goes through `js/store.js`, with exactly one exception: `js/i18n.js:1057` calls `localStorage.getItem('daftarche-name')` directly. Search of `js/` for `localStorage.(getItem|setItem|removeItem|clear)` returns 7 hits, 6 of them inside `store.js` and one in `i18n.js`.

### 2.3 State management — CURRENT STATE

`js/state.js` exports one mutable object:

```
state = {
  tasks[], filter, noDue, catFilter, query, selPri, selCat, selDue, selDur,
  userName, history[], moods{}, pomoMin, session
}
```

Mutated in place by feature modules; `state.tasks` is **reassigned** in `js/tasks.js` (`collapse`, `clearDoneTasks`, undo restore) and in `js/settings.js` (`hydrateStateAfterRestore`). Reads are direct property access in at least 25 modules (search for `state.tasks` returns 40 hits across 18 files).

**Consequence:** there is no write door. A change-tracking layer cannot observe mutations without either wrapping every writer or diffing snapshots.

### 2.4 Event bus — CURRENT STATE

`js/bus.js` is nine lines: a `Set` of listeners, `subscribe(fn)`, `notify()`. `notify()` carries no payload — subscribers re-read state and re-render. `js/daycache.js` subscribes globally and invalidates its cache on every notify.

Cross-module communication also uses ad-hoc `window` events with string names and untyped details: `daftarche:books-changed`, `daftarche:storage-error`, `open-book`, `close-reader`, `open-goal`, `goal-changed`, `theme-applied`, `navigate`, `edit-name`. None is declared in one place.

**CURRENT STATE.** No `storage` event listener exists anywhere in `js/` (search returns zero matches). Two open tabs therefore each hold their own `state` and each rewrite whole keys; the later write wins and the earlier tab's changes are lost without notice.

### 2.5 Persistence — CURRENT STATE

`js/store.js` provides:

| Mechanism | Behaviour |
|---|---|
| `safeSet` / `safeRemove` | Never throw; return boolean; dispatch `daftarche:storage-error` on failure; `js/storagewarn.js` shows it |
| `scheduleSave(key, value, serializer)` | Queues a dirty slice, flushes on `requestIdleCallback` (1000 ms timeout) or a 300 ms `setTimeout` fallback |
| `flushPending()` | Serialises and writes queued slices; hooked to `visibilitychange`, `pagehide`, `beforeunload` |
| `readJSON` / `readString` | Guarded reads; corrupted JSON falls back instead of throwing; dirty slices are read from memory first |
| `clearAll()` | `localStorage.clear()` behind the same guard |
| `migrateStorage()` | Legacy-key merge, executed at module evaluation |
| `requestPersistentStorage()` | `navigator.storage.persist()`, best effort |

Storage is sharded per feature key. There is **one JSON document per key**, and every write of that key re-serialises the whole document — for `daftarche-v1` that is the entire task list on every tick, edit, reorder or notification stamp.

`js/daycache.js` is an in-memory aggregation cache over six live sources plus the ledger floors. It is a derived view: it holds no persisted state.

### 2.6 The second store: the library — CURRENT STATE

`js/library.js` does not go through `state`. It keeps a module-level `books` array, loaded once with `readJSON('daftarche-books-meta', null)`, and writes with `scheduleSave(META_KEY, books)`. `reloadBooks()` re-reads the key after a restore.

`js/reader.js` and `js/stats.js` read books through `getBooks()` / `getBook(id)`; `js/daycache.js` fingerprints `getBooks()` to detect changes. `js/backup.js` treats `daftarche-books-meta` as one more storage key with a bespoke merge rule.

**Consequence:** the library is a second, independent store with its own in-memory copy. Any repository layer must absorb both, or the attention split stays.

### 2.7 Binary stores — CURRENT STATE

| Database | Version | Object store | Key | Record | Writer |
|---|---|---|---|---|---|
| `daftarche-books` | 1 | `books` | `keyPath: 'id'` | `{ id, blob }` — the PDF file | `js/library.js` `putBook` / `delBookBlob` |
| `daftarche-audio` | 1 | `tracks` | `keyPath: 'id'` | `{ id, name, blob }` — uploaded music | `js/audio.js` `addUserTrack` / `removeUserTrack` |

Both databases are opened lazily, both are deleted through `indexedDB.deleteDatabase` after closing the page's own connection, and both report `onblocked` as failure (`js/library.js` `clearLibraryData`, `js/audio.js` `clearUserAudioData`). `js/pdfpack.js` moves PDF files in and out as an ordinary stored-method zip; it never touches IndexedDB itself.

Cache Storage is also used (`daftarche-static-${BUILD}`, `daftarche-runtime-${BUILD}` in `sw.js`), including a warmed PDF cache. Cache entries are replaceable copies, not user records.

### 2.8 Backup and restore — CURRENT STATE

`js/backup.js` is DOM-free and receives a storage object, which is why it is the best-tested persistence path in the project.

| Function | Behaviour |
|---|---|
| `collectBackup(storage, {now, release})` | Every key where `isBackupKey` is true: `theme` or any `daftarche-*`, excluding `daftarche-seen-version`, `daftarche-birthday-seen` (`js/backup.js:39`) |
| `parseBackup(text)` | Validates `app === 'daftarche'`, integer `format` in 1..`BACKUP_FORMAT`, `data` object, every key backup-eligible, every value a string, and eight known keys against a shape table (`array` / `object`) |
| `applyBackup(storage, backup)` | Removes all backup-eligible keys, writes the file's keys, re-runs `migrateStorage`, rolls back every key on any throw |
| `mergeBackup(storage, backup)` | Per-key mergers; keys with no merger keep the local value (`local ?? v`); whole result validated before the first write; rollback on failure |
| `normalizeBackupData(data)` | Converts five legacy monolithic keys and `daftarche-tasks` into sharded keys |

`BACKUP_FORMAT = 1`. Restoring a file from a newer format is refused with an explicit message. PDF files are not in the JSON backup; they travel in the separate PDF pack. Uploaded music has no export.

### 2.9 Schemas and normalisation — CURRENT STATE

There is no store-wide schema version. Three independent partial mechanisms exist:

1. **Key-level legacy migration** — `migrateStorage()` in `js/store.js` merges five legacy monolithic keys and `daftarche-tasks` into the sharded keys, then removes them. Runs at module evaluation and again after a backup restore.
2. **Record-level normalisation on read** — `normalizeTask` (`js/state.js`) fills `id`, `durationMin`, `dueDate` (migrating legacy `due`), `timeFrom/timeTo`, `created`, `doneAt`, `notify`, `notifiedStatus`. `normalizeHistoryRecord` (`js/focushistory.js`) drops invalid session records outright. `normalizeState` (`js/achievements.js`) sanitises the achievement envelope. `readLedger` (`js/ledger.js`) rebuilds a sanitised ledger. All of these are read-time and idempotent, but none is versioned.
3. **Envelope versions that do exist** — `daftarche-ledger` carries `v: 1` (`LEDGER_VERSION`), `daftarche-achievements` carries `v: 1`, the backup file carries `format: 1`, and both IndexedDB databases are at version 1.

**CURRENT STATE.** `daftarche-v1` is a **key name**, not a record schema version: `normalizeTask` changes the record shape without changing that key. Books, moods, day history, focus history, birthday wishes and every preference key carry no version at all.

### 2.10 Web and Android — CURRENT STATE

| Concern | Web | Android (Capacitor 8, `www/`) |
|---|---|---|
| Source of files | `index.html`, `js/`, `css/` served directly | `www/` generated by `tools/build-www.mjs`, then `npx cap sync` |
| Offline | service worker, `SHELL` cache keyed by `BUILD` | bundled assets; service worker unregistered (`js/pwa.js:14-25`) |
| Notifications | Web Push (disabled by default) or none | Local notifications plugin |
| File export | `<a download>` | Filesystem + share sheet (`js/native.js`) |
| Storage | `localStorage` + IndexedDB | same APIs inside the WebView; `minWebViewVersion: 111`, `allowMixedContent: false` |

**RISK.** `www/` is a generated copy of `js/`, `css/` and `index.html`. A change made only in `js/` reaches Android only after `npm run build:www`. Two divergent copies of the same module in the tree (`js/` and `www/js/`) are a real source of confusion, and `www/js/` also appears in broad repository searches.

### 2.11 Existing tests — CURRENT STATE

41 `*.test.mjs` files, `node --test`, no framework, no dependency. `tests/_env.mjs` installs a `MemoryStorage` class before any app module loads — the pattern any new storage test should reuse. Coverage relevant to this phase:

| Test file | What it protects |
|---|---|
| `backup.test.mjs` | Collect / parse / apply / merge / rollback |
| `repair_integrity.test.mjs` | Corrupt-storage repair paths |
| `model.test.mjs` | Task normalisation and ordering helpers |
| `pwa.test.mjs`, `sw.test.mjs`, `csp.test.mjs` | Shell, cache and CSP integrity |
| `app_integrity.test.mjs`, `html-structure.test.mjs` | Module/СHELL/DOM integrity |
| `phase2/3/4/5.test.mjs`, `worlds`, `achievements`, `ledger`, `calendar*`, `i18n`, `settings-updates` | Domain behaviour |
| `tests/browser/regress.mjs` | Browser regression script (`npm run test:browser`), not part of `node --test` |

The suite passes: **442/442**. It does not cover IndexedDB, quota failure, cross-tab writes, restore of a book without its file, or any sync concept — none of those exists.

---

## 3. Findings

Severity: **P0** blocks safe Account/Sync work · **P1** must be fixed in the foundation · **P2** correctness or maintainability.

| # | Severity | Finding | Evidence | Consequence |
|---|---|---|---|---|
| A-01 | P0 | No modification stamp on any record | `updatedAt` search: zero hits in `js/` | Two copies of one record cannot be ordered; field-level conflict detection is impossible |
| A-02 | P0 | Deletion is unrepresentable | `js/tasks.js` `collapse` (`state.tasks = tasks.filter(...)`) and `clearDoneTasks`; `js/library.js` `settlePendingDelete` deletes metadata and file | A first sync would resurrect deleted tasks; a deleted book cannot be distinguished from an unknown one |
| A-03 | P0 | No single write door | `state.tasks` reassigned in `tasks.js` and `settings.js`; `library.js` owns a second store; `audio.js` a third | No place exists to stamp, enqueue or emit changes; every new writer must remember the rules |
| A-04 | P1 | No schema version, and the key name `daftarche-v1` is misleading | §2.9 above | Record-shape changes are untracked; a future migration cannot know what it is migrating from |
| A-05 | P1 | Whole-key rewrites on every mutation | `saveTasks` serialises the whole task array | Write cost grows with history; the 5 MB origin quota is reached sooner than the data warrants |
| A-06 | P1 | Focus history is destructively capped at 100 | `HISTORY_CAP = 100`, `mergeHistory` slices | Old minutes vanish locally; any future sync must decide retention before shipping (OD-05) |
| A-07 | P1 | Two independent in-memory copies of the shelf | `js/library.js` module array vs `daftarche-books-meta` | A restore or a second writer can leave the shelf rendering stale data until `reloadBooks()` |
| A-08 | P1 | No cross-tab coordination | Zero `storage` event listeners | Two open tabs clobber each other's task list; the loss is silent |
| A-09 | P1 | Library and audio open their own IndexedDB connections | `js/library.js` `db()`, `js/audio.js` `db()` | Quota and blocked-delete handling is per module; no shared failure surface |
| A-10 | P2 | Direct storage read outside `store.js` | `js/i18n.js:1057` | One place can observe a different value than the central layer reports as dirty |
| A-11 | P2 | Two different "first seen" keys | `STORAGE_KEYS.firstSeen = 'daftarche-first-seen'` (`js/constants.js:33`) vs `SEEN_KEY = 'daftarche-firstseen'` (`js/profile.js:19`) | Two device facts with similar names; any inventory or classification must list both or silently miss one |
| A-12 | P2 | Untyped `window` events | §2.4 | No contract to extend when writes move behind a repository |
| A-13 | P2 | Read-time normalisation is the only migration for record shapes | `normalizeTask`, `normalizeHistoryRecord` | A record is only correct after being read; a write path that bypasses normalisation can persist an unnormalised shape |
| A-14 | P2 | Corrupt records are dropped, not preserved, in focus history | `normalizeHistoryRecord` returns `null` and `getHistory` filters | Silent loss of a session the user believes exists; acceptable today, unacceptable once history is account data (OD-05) |

---

## 4. What the foundation must therefore provide

**PROPOSED DESIGN.** Each item maps to a document in this package.

| Need | Where it is specified |
|---|---|
| One written data contract per entity, with identifier, timestamp and revision rules | `DATA_CONTRACT.md` |
| One registry of schema versions and sequential migrations | `DATA_SCHEMA_REGISTRY.md`, `MIGRATION_SPECIFICATION.md` |
| One repository boundary that every writer goes through | `DATA_ACCESS_LAYER_DESIGN.md`, `REPOSITORY_CONTRACTS.md` |
| Storage adapters that isolate `localStorage` and IndexedDB failure modes | `STORAGE_ADAPTER_SPECIFICATION.md` |
| Change tracking, tombstones and an inert outbox that a guest never touches | `CHANGE_TRACKING_SPECIFICATION.md`, `OUTBOX_DESIGN.md` |
| Backup kept compatible while new support keys are introduced | `BACKUP_COMPATIBILITY.md` |
| Recovery from an interrupted migration or a full quota | `DATA_RECOVERY_STRATEGY.md` |
| A test plan that distinguishes specified from executed | `MIGRATION_TEST_PLAN.md`, `PHASE_1_VALIDATION_PLAN.md` |

---

## 5. Boundaries honoured by this stage

- No source file, test, asset, dependency, configuration, schema or database was modified.
- No migration was run. No IndexedDB database was opened, created or deleted by this audit.
- No deployment, publication, release, upload or stores submission was performed.
- No version-control write of any kind was performed. The working copy has no usable commit metadata, so this document makes no claim about repository state.
- No browser, device or Android build was executed.

## 6. Items not verified at this stage

| Item | Why not verified |
|---|---|
| IndexedDB behaviour under quota pressure on a real device | Requires a device run, out of scope for a design-only stage |
| Android WebView storage eviction policy for this app | Platform behaviour, not derivable from the source |
| `www/` and `android/` copies being byte-identical to `js/` | No build was run; the copies exist but their freshness is unverified |
| Which module writes `daftarche-frog-dismissed`, `daftarche-card-style` and `daftarche-streak-freeze` | Declared in `STORAGE_KEYS` with store-layer setters; the calling UI path was not traced in this pass |
| Real-device timing of the 300 ms debounce flush | Would need instrumentation on hardware |
