# Phase 1 — Storage Adapter Specification

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.4
**Document status:** proposed specification. **Nothing is implemented.**
**Date:** 19 November 2026

The adapter is the only code that knows which browser API holds the bytes. Everything above it deals in read models and validation results.

**Design rule.** An adapter reports failures; it never decides what they mean for the user. Meaning belongs to the repository, wording belongs to the view.

---

## 1. Adapter inventory

| Adapter | Backs | Phase 1 role |
|---|---|---|
| `kvAdapter` | `localStorage` | Primary store for every record and preference |
| `idbAdapter` | IndexedDB | **Blobs only** — PDF files and audio tracks. No record moves here in Phase 1 |
| `outboxAdapter` | IndexedDB (`daftarche-sync`) | Inert: created only when a session exists (never in Phase 1) |
| `memoryAdapter` | A `Map` | Tests and any environment without storage |

No other adapter exists, and no adapter chooses itself. The composition root (one module, `js/dataadapters.js`) selects the kv and idb implementations once at boot and exposes them.

---

## 2. `kvAdapter` interface

```
isAvailable()                    → boolean
getRaw(key)                      → string | null
setRaw(key, string)              → { ok: true } | { ok: false, code, key }
remove(key)                      → { ok: true } | { ok: false, code, key }
keys()                           → string[]            // for the inventory test and the backup collector
clearAll()                       → { ok: true } | { ok: false, code }
onExternalChange(cb)             → unsubscribe         // the `storage` event
```

### 2.1 Semantics

| Rule | Detail |
|---|---|
| Raw strings only | The adapter never parses. Parsing and shape validation belong above it |
| Non-throwing | Every failure is a result object with a code |
| Per-key atomicity | Relies on `localStorage.setItem` atomicity; a caller never sees a half-written value |
| No batching guarantee | Two keys written in sequence can be interrupted between them — this is why every multi-key operation has a journal |
| No implicit migration | The adapter must not re-shard, rename or repair keys |
| No dirty-cache | The existing `scheduleSave` debounce lives **above** the adapter; the adapter writes immediately when asked |

**RISK.** The current debounce (`scheduleSave` + `flushPending`) is a real behaviour users depend on for input latency. Moving writes into a repository must not remove it, and must not double it. The repository should call the existing debounced writer, and the adapter should be the synchronous flush target.

### 2.2 Error codes

| Code | Cause | Repository maps to |
|---|---|---|
| `QUOTA` | `QuotaExceededError`, `NS_ERROR_DOM_QUOTA_REACHED` | "not saved, storage full" + retry |
| `DENIED` | Storage disabled, private mode, security error | "storage unavailable" persistent banner |
| `UNKNOWN` | Anything else | Generic failure with the key named |

The existing `store.js` already dispatches `daftarche:storage-error` on failure; the adapter keeps that event as the observable signal so `storagewarn.js` needs no change.

### 2.3 `onExternalChange`

**CURRENT STATE.** Nothing listens for the `storage` event, so two tabs silently clobber each other.

**PROPOSED DESIGN.** The adapter exposes the browser's `storage` event with the key and old/new values. One subscriber (the repository composition root) decides:

- if the change is to a key this tab holds dirty, warn and re-read on next idle;
- never auto-merge in Phase 1 (there is no `updatedAt` on legacy records yet);
- show one non-blocking notice: "This notebook was changed in another tab".

This is a **user-visible improvement**, not only a sync prerequisite. It is the cheapest available mitigation for a real, silent data-loss defect.

---

## 3. `idbAdapter` interface

```
open(name, version, upgrade)     → Promise<db>
get(store, key)                  → Promise<record | null>
put(store, record)               → Promise<void>
delete(store, key)               → Promise<void>
getAll(store)                    → Promise<record[]>
deleteDatabase(name)             → Promise<{ok, blocked}>
close()                          → void
```

### 3.1 Requirements carried from the existing code

| Requirement | Source |
|---|---|
| Close the page's own connection before `deleteDatabase`, or the delete is blocked | `clearLibraryData`, `clearUserAudioData` |
| Report `onblocked` as failure, never as success | same |
| Wire every transaction outcome (`oncomplete`, `onerror`, `onabort`, request error) so a failed put cannot leave a promise pending forever | `putBook` comment and implementation |
| Never overwrite an existing blob on import unless the caller asked | `importBookPack` |
| One connection per database, closed on wipe | both modules |

### 3.2 What Phase 1 changes

**Nothing in the data.** No version bump, no new object store, no record moved into IndexedDB. The only change is **ownership**: the two modules stop opening their own connections and use the shared adapter, so a blocked delete and a failed put produce one consistent failure surface.

**RISK.** Refactoring two working IndexedDB paths is the least valuable change in this package relative to its risk. It is therefore sequenced **last** in the implementation plan (P1-11) and may be dropped without affecting anything else.

---

## 4. `outboxAdapter` — Phase 2 surface, Phase 1 shell

Defined in `OUTBOX_DESIGN.md`. Here it matters only for one rule:

> The outbox database must not be created for a guest.

Creating an empty IndexedDB database on first run would be harmless in bytes but would break the claim "a guest's device contains no sync apparatus". It also makes a `deleteDatabase` in a future account-deletion flow more likely to be blocked. The adapter is therefore created lazily on the first enqueue, which never happens without a session.

---

## 5. Capability detection

At boot:

| Capability | Detection | Fallback |
|---|---|---|
| `localStorage` writable | Write and remove a probe key inside a `try` | `memoryAdapter` + persistent banner: nothing will be kept |
| `navigator.storage.persist` | Existence check, then request on the two entry points that already ask (add task, import book) | Silent; already the behaviour |
| `navigator.storage.estimate` | Existence check | Integrity report omits byte counts |
| IndexedDB | `typeof indexedDB !== 'undefined'`; open lazily | Books cannot be imported; message at import time |
| `storage` event | `'onstorage' in window` | No cross-tab warning |

**Rule.** Capability detection never blocks boot. The app already renders a degraded but usable interface when storage is missing, and that must not change.

---

## 6. Atomicity and transactions

| Operation | Atomicity available | Design response |
|---|---|---|
| One record key | Single `setItem` | Atomic |
| Two records | None | Journal + snapshot (migration) or order-of-operations (import: file first, metadata second, file removed on metadata failure) |
| Record + blob | None | Explicit compensation in `repository.books.createFromImport` |
| Restore | None | Existing whole-restore rollback in `applyBackup` |
| Wipe | None across three stores | Existing per-store result reporting |

**RISK.** Every "atomic" claim in this document is about a single key. There is no multi-key transaction in `localStorage` and the design does not pretend otherwise.

---

## 7. Adapter contract tests

| # | Test | Asserts |
|---|---|---|
| SA-1 | `setRaw` when the store is full | Returns `QUOTA`; no throw; `daftarche:storage-error` dispatched |
| SA-2 | `setRaw` when storage is disabled | Returns `DENIED` |
| SA-3 | `getRaw` on a missing key | `null`, not `undefined`, not a throw |
| SA-4 | `keys()` | Matches `Object.keys` of the backing store, including `theme` |
| SA-5 | `clearAll` | Returns ok; subsequent `keys()` empty |
| SA-6 | `onExternalChange` | Fires once per external write; unsubscribes cleanly |
| SA-7 | `memoryAdapter` | Same results for SA-1…SA-5, with `maxBytes` configurable |
| SA-8 | IDB put failure | Rejects with a code; no pending promise |
| SA-9 | IDB blocked delete | Resolves `{ok: false, blocked: true}` |
| SA-10 | No IDB database created for a guest | `indexedDB.open('daftarche-sync')` never called during a full guest session test |

---

## 8. Non-goals

- Encryption of local storage (not required by any approved decision; adding it would change every read path and every backup).
- A SQL layer, a query language, or an ORM.
- Cross-tab locking beyond the notice.
- Sync-aware adapters: the outbox is not an adapter concern, it is a queue.
- Migrating existing data into IndexedDB.
