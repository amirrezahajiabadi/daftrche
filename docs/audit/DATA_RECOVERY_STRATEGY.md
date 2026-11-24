# Phase 1 — Data Recovery Strategy

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.3
**Document status:** proposed strategy. Nothing is implemented.
**Date:** 19 November 2026

The recovery strategy answers: *when a write, a migration or a restore fails, what is the state of the user's data, what does the app say, and how does the user get back?*

**Governing rule.** No recovery path may ever present a partial state as a clean one. A wipe that could not finish, a migration that quarantined a record, a restore that rolled back — each must be visible, in the app's own voice.

---

## 1. Recovery layers

| Layer | Protects against | Exists today? | Where |
|---|---|---|---|
| **L1 Guarded read** | Corrupt or missing value taking the app down | **Yes** | `readJSON` / `readString` fall back |
| **L2 Read-time repair** | Old or partially written records | **Yes** | `normalizeTask`, `normalizeHistoryRecord`, `readLedger`, `normalizeState`, `normalizeSession` |
| **L3 Guarded write + visible failure** | Quota and private-mode failures | **Yes** | `safeSet` → `daftarche:storage-error` → `storagewarn.js` |
| **L4 Whole-restore rollback** | A failed JSON restore leaving a half-applied state | **Yes** | `applyBackup` remembers every key and rolls back |
| **L5 Whole-merge rollback** | A failed merge | **Yes** | `mergeBackup` builds the result in memory, validates, then writes; failure restores |
| **L6 Pre-migration snapshot** | A migration that fails or is interrupted | **No** | `MIGRATION_SPECIFICATION.md` §1 |
| **L7 Journal resume** | A migration interrupted mid-step | **No** | same |
| **L8 Quarantine** | Malformed records being silently dropped | **No** | same, §2 |
| **L9 Binary-store failure surface** | A blocked IndexedDB delete looking like success | **Partial** | `clearLibraryData`, `clearUserAudioData` resolve `false` |

**IMPLEMENTATION STATUS.** L1–L5 exist and are tested (`backup.test.mjs`, `repair_integrity.test.mjs`). L6–L8 do not exist. L9 exists for deletes only, not for writes.

---

## 2. Failure matrix

| Failure | Detectable? | User-visible state today | Required state |
|---|---|---|---|
| `localStorage.setItem` throws (quota) | Yes, `safeSet` returns false | Toast via `storagewarn.js`; the in-memory change stays until reload, then is lost | Toast **plus** a "not saved" marker on the record, and a retry action. A lost write must not look saved |
| `localStorage` unavailable entirely | Yes, on first read | App renders with defaults; every write fails | A persistent banner: "This browser is not allowing storage; nothing will be kept" |
| A key holds invalid JSON | Yes, `readJSON` catches | Silent empty/fallback | Silent fallback **plus** a quarantine copy, so the raw value is not lost when the next write overwrites the key |
| A record is invalid inside a valid array | Partly | Tasks repaired; focus records dropped | Repaired where possible; dropped only after being copied to quarantine |
| Migration validation fails | Yes (proposed) | — | Abort, restore snapshot, banner naming the step; the app runs on the previous shape |
| Migration interrupted | Yes (journal) | — | Resume on next boot; banner only if resume also fails |
| Wipe partially fails | Yes, both calls are awaited | Notice: "book or music files were not deleted; close other tabs and retry" | Unchanged; already correct |
| Book import: file written, metadata write fails | Yes | Inline error; the file remains as an orphan | Offer cleanup of the orphan, or retry the metadata write |
| Restore replaced metadata, PDFs absent | **No** | Shelf shows books that will not open | Read model exposes `fileState: 'absent'`; the shelf says "needs the file" rather than failing at open |
| Two tabs overwrite each other | **No** | Silent loss | `storage` listener warns and offers reload; long term, the write path becomes per-record |
| Device clock wrong | **No** | Odd ordering, future timestamps | Contract rule: clocks never decide server order; UI shows no wall-clock claim it cannot support |

**RISK.** Four of the rows above are silent today. Two of them (cross-tab writes and a restored book without its file) are *data-integrity* issues that a user will eventually notice as "my data is wrong", not as an error. Both must be made visible before Sync ships, because Sync adds a second writer.

---

## 3. Snapshot design — PROPOSED DESIGN

```
daftarche-migration-snapshot = {
  step: 'M-002',
  at: <epoch ms>,
  registryBefore: {…},
  keys: { 'daftarche-v1': '<raw string>', … }
}
```

| Property | Decision |
|---|---|
| Slots | One. A second migration replaces the first snapshot — but only after the first migration completed or was abandoned |
| Scope | Only the keys the current step writes |
| Size cap | Fixed, and checked before writing. If the snapshot would exceed the cap, the step does not start |
| Classification | **D**; excluded from backup and Sync |
| Retention | Removed when the whole chain completes; kept if any step failed, until the next successful boot |
| Access | No UI in Phase 1. A support procedure reads it; a future settings entry may expose "restore the previous data" |

**OPEN QUESTION PQ-03.** Whether the snapshot should ever be user-restorable from the app. The recommendation is yes, but only after the migration chain is stable, because a user-restorable snapshot is a second data path with its own support burden.

---

## 4. Integrity verification

### 4.1 What is checked, and when

| When | Check | On failure |
|---|---|---|
| Boot, after migrations | Registry present; every registered store readable; record counts match the last known counts when available | Banner; do not rewrite anything |
| Before a destructive action (restore, wipe) | Backup parses; shape table satisfied; enough room estimated | Refuse with a reason |
| After any migration step | The step's own postconditions | Roll back the step |
| After a restore | Re-hydrate state and verify counts against the file's counts | Report a mismatch rather than reloading as success |
| On demand (support) | A read-only report: per store, record count, invalid-record count, quarantine count, registry versions | Printed, never auto-repaired |

### 4.2 A read-only integrity report — PROPOSED DESIGN

A small module (`js/datareport.js`, proposed) returns:

```
{
  release, build, schema: {tasks: 1, books: 1, …},
  stores: {
    tasks:      {records: 412, invalid: 0, quarantined: 0, bytes: 190233},
    books:      {records: 9,   invalid: 0, files: 8, orphans: 1},
    focus:      {live: 'paused', history: 100, cap: 100},
    activity:   {days: 308, moods: 250},
    ledger:     {days: 308, version: 1},
    achievements:{unlocked: 14, version: 1}
  },
  backup: {format: 1, lastExportAt: …},
  quarantine: {entries: 1, lastAt: …}
}
```

No personal content is included: counts only. It is designed to answer a support question without asking a user to send their notebook.

**RISK.** A report that lists counts can still be identifying in aggregate. It stays on the device and is only shown to the user; it is never transmitted. No analytics event includes it.

---

## 5. What is genuinely unrecoverable

| Data | Why unrecoverable | What the app must say |
|---|---|---|
| A write lost to a full quota, once the page reloads | The value was never persisted | "Not saved" before the reload, with a retry |
| A PDF deleted after its undo window | The blob is gone; the metadata was already removed | Nothing today; the undo window is the promise |
| Uploaded music after "clear all data" | No export exists (OD-18) | The wipe dialog already says music is deleted |
| Any record dropped by the current focus-history normaliser | Dropped before any copy was made | Must stop dropping without a quarantine copy |
| Data in `www/` or an Android build that was never built from current source | Not user data | — |

**APPROVED DECISION.** Music is outside the current manual export; whether it must be included is **OD-18** and remains open. No copy may promise a music export, and no copy may declare it permanently impossible.

---

## 6. Support procedures (documentation only)

| Situation | Step |
|---|---|
| "My tasks are gone" | Read the integrity report; if counts are non-zero, the render is at fault, not the data. If counts are zero, check for a quarantine entry and the last backup stamp |
| "The app opens on an old version after an update" | Store version newer than build → read-only mode is working; activate the new build or restore the previous data from the snapshot |
| "Migration banner will not clear" | The journal names the step; re-running is safe (idempotent) |
| "A book will not open" | `fileState: 'absent'` — the file was never on this device or the store was cleared. Import it again (OD-17 governs attachment to the existing record) |
| "Two tabs fight" | Known limitation; close one tab. A `storage` listener is the fix, specified in P1-09 |

---

## 7. Recovery acceptance criteria

The strategy is satisfied when all of the following are true **and tested**:

1. A migration interrupted at every step boundary leaves either the old shape or the new shape, never a mixture.
2. A failed step restores the snapshot and the app boots on the previous shape.
3. A quarantined record is retrievable and the count is reported.
4. A restore that runs out of room leaves every key exactly as it was.
5. A wipe reports each store's outcome separately.
6. A book without its file is a supported, visible state.
7. An unreadable key does not present as an empty notebook without saying so.
8. No recovery path writes `updatedAt` on read.
9. The integrity report contains no user content.
10. Nothing in this strategy requires a network call.
