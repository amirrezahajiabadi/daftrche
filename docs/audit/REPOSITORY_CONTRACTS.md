# Phase 1 — Repository Contracts

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.4
**Document status:** proposed interfaces. **Nothing is implemented.**
**Date:** 19 November 2026

These are the function contracts of the repository layer. They are written as JavaScript-shaped signatures with explicit semantics, because the implementation will be plain modules with no type system to enforce them.

Conventions used below:

- Every mutating function returns `{ ok: true, record }` or `{ ok: false, error }`; it never throws for a storage or validation failure.
- Every read is synchronous in Phase 1, because `state.js` and the views depend on it.
- `now` and `newId` are injectable for tests but default to `Date.now` and the existing `nextId`.
- A "read model" is a plain object the views may render; it is not the stored object.

---

## 1. `repository.tasks`

| Signature | Semantics |
|---|---|
| `all()` | The live task array, in `order` then `id`. Same array identity until a change, so existing render code keeps working |
| `get(id)` | One read model, or `null`. Never returns a tombstone |
| `create({text, p, cat, dueDate, durationMin, timeFrom, timeTo})` | Validates, mints `id`, sets `created`, `updatedAt`, `rev: 1`, `deletedAt: null`, `originDevice`, `fieldClock`, `order` = end. Persists, notifies, returns the record |
| `update(id, patch)` | Validates each field in `patch`; merges; sets `fieldClock[field] = now` for each supplied field; bumps `rev`; sets `updatedAt`. Persists, notifies, returns the record |
| `setDone(id, done)` | `update` with the completion rules: `done ? doneAt = now : doneAt = null`; raises the ledger floor after the write; clears a live focus session that points at a task being deleted (not at a tick) |
| `reorder(ids, {before, after})` | Rewrites `order` for the moved subset only, using the existing `reorderSubset` semantics: hidden rows keep their place |
| `delete(id)` | Writes a tombstone (`deletedAt`, `updatedAt`, `rev + 1`), removes it from the render list, keeps it readable for undo. Returns the tombstone so the undo has an exact reference |
| `restore(id)` | Clears `deletedAt`, bumps `rev`; the record returns to its previous `order` |
| `deleteMany(ids)` | One tombstone per id, in one pass; returns the list |
| `applyRemote(records)` | Phase 2 only. Applies merged records with `origin: 'sync'`. Must not exist in Phase 1; declared here so the boundary is known |

**Forbidden in this repository:** writing `notifiedStatus` from a caller (it is device-local and written only by `notifications.js` through a dedicated `noteNotified(id, phase)` call), and persisting anything on read.

**Ledger interaction.** `setDone` is the one place that raises the `done` floor, because the floor must be raised *after* the live count changed. Keeping that ordering in one function is what prevents double counting.

### 1.1 `noteNotified(id, phase)`

A narrow write for the notification dedupe marker. It bumps `rev` and `updatedAt` — a notification is a real mutation of the local record — but the field is **not** projected for sync.

**RISK.** A notification stamp bumping `rev` makes the record look modified on every sync. That is correct for local ordering and irrelevant for sync because the field is not projected; the projection compares projected fields, not `rev` alone.

---

## 2. `repository.books`

| Signature | Semantics |
|---|---|
| `all()` | The shelf array; same identity until a change; dispatches `daftarche:books-changed` on every change |
| `get(id)` | Read model with `fileState` resolved **lazily** (see below) |
| `createFromImport({file, title})` | Writes the file to the binary adapter, then the metadata. If the metadata write fails, the file is removed and the error is returned — no orphan by default |
| `update(id, patch)` | Validates; merges; envelope; persists; notifies. `highlights`, `notes` and `cover` are accepted here because they are local fields of an **S** record |
| `saveProgress(id, {page, numPages})` | Sets `lastPage`, `lastReadAt`, and `numPages` when higher; one write; latest-valid semantics on read |
| `markPageRead(id, page, readMinutes)` | Mutates `completedPages` (set semantics) and `stats[day]`; one write |
| `addHighlight(id, highlight)` / `removeHighlight(id, highlightId)` | Append/remove by id; one write each |
| `addNote(id, note)` / `removeNote(id, noteId)` | Same |
| `setGoal(id, goal)` | Validates `pagesPerDay ≤ numPages` when known |
| `delete(id)` | Tombstone + deferred file deletion, preserving the existing five-second undo |
| `fileState(id)` | `'present' \| 'absent' \| 'unknown'` — a query, never a stored flag |
| `attachFile(id, file)` | OD-17 territory. Declared so the shelf can offer it; **not implementable** until the matching rule is decided |

**`fileState` and rendering.** `renderShelf` is synchronous. An IndexedDB lookup is not. The Phase 1 compromise is explicit: the shelf renders from metadata only, and `fileState` is resolved when a book is opened. The "needs the file" state is therefore shown in the reader, not on the card, unless the implementation adds a cached presence map — which must never be persisted as a flag.

**RISK.** A cached presence map that is written to storage becomes stale after a wipe or a restore and would tell a user their file exists when it does not. If it is added at all, it lives in memory only.

---

## 3. `repository.activity`

| Signature | Semantics |
|---|---|
| `recordDay(dayKey)` | Adds the day to `daftarche-history` if absent; no duplicate; one write |
| `setMood(dayKey, value)` | Validates 1..5; replaces the day's mood |
| `raiseFloor(dayKey, patch)` | `bumpDay` semantics: only ever higher; no-op when nothing rises |
| `rememberDone(now)` / `rememberFocus(now)` | Read the live count, then raise the floor — moved from `js/ledger.js` unchanged |
| `history()` / `moods()` / `ledger()` | Sanitised reads, same shapes as today |
| `saveAchievements(state)` | Replaces the envelope after validation `{v, baselineAt, unlocked, recSeen}` |
| `appendSession(record)` | Focus history; **gated**: must refuse while the classification is **?** (OD-05) *for sync purposes only* — local append keeps working exactly as today |

**Rule.** `raiseFloor` never accepts a lower value, and no function in this repository accepts a "replace the ledger" call. The only writer of the ledger is the floor raiser.

---

## 4. `repository.prefs`

| Signature | Semantics |
|---|---|
| `get(key)` | Raw string or null, through the kv adapter |
| `getJSON(key, fallback)` / `getString(key, fallback)` | Guarded, with the same fallbacks `store.js` uses today |
| `set(key, value)` | Validates that the key is a known preference; classifies it; writes |
| `remove(key)` | Guarded removal |
| `getName()` / `setName(value)` | The one preference `i18n.js` reads directly today; replaces that bypass |
| `avatar()` / `setAvatar(a)` | Sanitises against the five-character catalogue |
| `photo()` / `setPhoto(dataUrl)` | Accepts a data URL; returns `false` when it could not be persisted (existing behaviour) |

**Rule.** A preference reader keeps its existing default. The repository does not invent a default; it passes through the fallback the caller already uses, so a change of layer cannot change behaviour.

**Rule.** No preference write is ever enqueued. Every preference is **P**, **D** or **?**; none is **S**, so the outbox guard rejects it structurally rather than by a runtime check.

---

## 5. `repository.session`

| Signature | Semantics |
|---|---|
| `current()` | Normalised live session or `null` |
| `start({taskId, plannedMin, taskTitle})` | Refuses when a session is active; mints id, stamps |
| `pause()` / `resume()` | Adjusts `activeMs`, `runStartedAt`, `status` |
| `cancel()` | Ends with `status: 'cancelled'` |
| `finish({taskCompleted, rating})` | Computes `actualDurationMin`, ends, appends to history through `repository.activity` |

**Rule.** The live session is **D**. It is never projected, never queued, never migrated. A second device must never see a running timer.

---

## 6. `repository.hydrate()`

Used by `settings.js` after a restore:

```
repository.hydrate() →
  rebuilds state.tasks from the store (normalised)
  rebuilds the books array
  re-reads name, history, moods, pomo
  invalidates the day cache
  emits one data-changed event per kind
```

It is the only sanctioned way to reload everything, and it must not write anything.

---

## 7. Cross-cutting obligations

| Obligation | Where it is enforced |
|---|---|
| Envelope stamped once per mutation | In the repository, never in a view |
| `origin` recorded as `local` for user writes | Same |
| One change event per mutation | Same |
| Validation before persistence | `js/datacontract.js` |
| Sync projection built from the classification module | `js/dataclassification.js` |
| Outbox append only when a session exists | `js/outbox.js` |
| No repository call reaches IndexedDB blobs except `repository.books` | A test asserts the import graph |

---

## 8. Interface honesty

Three signatures above cannot be implemented as written without a decision:

| Signature | Blocked by |
|---|---|
| `books.attachFile` | OD-17 (how a re-imported PDF is matched to a restored record) |
| `activity.appendSession` sync behaviour | OD-05 (whether history syncs, and its retention) |
| `prefs.set` for `daftarche-photo` | OD-10 (whether the photo follows the account) |

They are declared so the shape is not invented later under time pressure. Declaring them is not deciding them: each must remain unimplemented or local-only until its decision is recorded.

---

## 9. What the contracts deliberately do not include

- No `save()` with no arguments that writes everything.
- No bulk `replaceAll` for tasks or books except the restore path, which lives in `backup.js`.
- No repository for analytics, themes as a subsystem, or achievements evaluation — those are domain logic and views, not storage.
- No generic `get(collection, id)`; typed functions keep the field allowlists honest.
- No async read variant "for later"; adding one later is a deliberate change with a test, not an option nobody uses.
