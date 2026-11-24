# Phase 1 — Data Schema Registry

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.3
**Document status:** proposed registry over observed current schemas. Nothing is implemented.
**Date:** 19 November 2026

**Rule observed while writing this document:** no schema version is invented. Where the source carries a version, it is recorded as observed. Where it carries none, that is recorded as *unversioned* and the first versioned form is numbered `1` — the beginning of versioning, not a fictional history.

---

## 1. What exists today

| Store | Key / database | Version carried by the source | Evidence |
|---|---|---|---|
| Tasks | `daftarche-v1` | **None.** The `v1` is part of the key name, not a record schema version | `js/constants.js:4`; `normalizeTask` changes the record shape without changing the key |
| Day-open history | `daftarche-history` | None | `js/store.js` `loadHistory` |
| Moods | `daftarche-moods` | None | `js/store.js` `loadMoods` |
| Ledger | `daftarche-ledger` | **`v: 1`** | `js/ledger.js` `LEDGER_VERSION = 1`, `readLedger` rejects any other `v` |
| Achievements | `daftarche-achievements` | **`v: 1`** | `js/achievements.js` `emptyState`; `js/achievementsview.js` writes `{v: 1, …}` |
| Focus history | `daftarche-focus-history` | None | `js/focushistory.js` |
| Live focus session | `daftarche-focus-session` | None | `js/focus.js` `normalizeSession` |
| Books | `daftarche-books-meta` | None | `js/library.js` |
| Birthday wishes | `daftarche-birthday-wishes` | None | `js/store.js` |
| Preferences | 30+ keys | None (each is a scalar or a small JSON value) | inventory in `DATA_INVENTORY.md` |
| PDF files | IndexedDB `daftarche-books` | **Database version 1** | `indexedDB.open(DB_NAME, 1)` |
| Audio tracks | IndexedDB `daftarche-audio` | **Database version 1** | `indexedDB.open(DB_NAME, 1)` |
| Backup file | `format` field | **`format: 1`** | `js/backup.js` `BACKUP_FORMAT = 1` |

**CURRENT STATE.** There is no store-wide schema identity. Nothing records "this device has task schema N". A future migration therefore cannot ask what it is migrating from; it can only inspect shapes and guess.

---

## 2. Registry design — PROPOSED DESIGN

### 2.1 Independent, sequential versions

One version per **store family**, not one per application. Reason: a change to the task record must not force a migration of the birthday wishes, and the stores are written by different modules at different times.

| Store family | Stores covered | Proposal |
|---|---|---|
| `tasks` | `daftarche-v1` | version 1 = envelope (id, created, updatedAt, rev, deletedAt, originDevice, fieldClock, order) |
| `books` | `daftarche-books-meta` | version 1 = envelope on the book record; version 2 adds nothing until OD-17 |
| `activity` | `daftarche-history`, `daftarche-moods` | version 1 = unchanged content, registry-known |
| `ledger` | `daftarche-ledger` | version 1 already exists in the data; registry adopts it as version 1 |
| `achievements` | `daftarche-achievements` | version 1 already exists; adopted |
| `focus` | `daftarche-focus-session`, `daftarche-focus-history` | version 1 = live session envelope; history frozen at version 1 until OD-05 |
| `prefs` | every preference key | version 1 = unchanged content, registry-known |
| `birthday` | the five birthday keys | version 1 = unchanged content; **?** classification means no migration beyond registry entry |
| `backup` | the JSON file | `format` stays **1** (see `BACKUP_COMPATIBILITY.md`) |

### 2.2 The registry key

```
daftarche-schema = {
  v: 1,                        // registry envelope version
  stores: {
    tasks: 1, books: 1, activity: 1, ledger: 1,
    achievements: 1, focus: 1, prefs: 1, birthday: 1
  },
  lastMigration: 'M-004' | null,
  updatedAt: <epoch ms>
}
```

| Property | Decision | Why |
|---|---|---|
| Classification | **D** (device-local) | It describes this installation's stored shapes, not the person's data |
| Backup | Excluded (see `BACKUP_COMPATIBILITY.md` §5) | Restoring a registry from a newer app into an older one would claim versions that app cannot honour |
| Sync | Never | It is not a record |
| Written | Only by the migration runner, after a successful migration | A version written before success is a lie that blocks recovery |
| Missing | Treated as "every store at its oldest known version" | A first run, a wiped key or an old install all converge on the same path |

### 2.3 What a version number means

A store version is the **shape of the stored documents**, not the application release. Consequences:

- A release that adds a feature without changing stored shapes does not change any version.
- A release that adds one optional field **does** change the version, because the migration must fill it for existing records and the reader must not depend on the field being absent.
- A field that is optional and defaulted on read is still a version change if a writer can produce it; otherwise two devices disagree about what the same version means.

### 2.4 Payload versions (Phase 2, defined here so it is not invented later)

```
payloadVersion = { tasks: 1, books: 1, activity: 1, ledger: 1, achievements: 1 }
```

A pushed batch declares one payload version per kind it contains. A receiver that does not know a declared version rejects the **whole batch** and the client keeps its records. No partial application of an unknown shape.

---

## 3. Migration chain — PROPOSED DESIGN

Each step is specified in `MIGRATION_SPECIFICATION.md`. The chain is linear per family; no step depends on an unrelated family's step.

| Step | Family | From → To | One-line purpose |
|---|---|---|---|
| M-001 | registry | absent → present | Establish `daftarche-schema` with the versions actually satisfied |
| M-002 | tasks | 0 → 1 | Add envelope, `fieldClock`, `order`; keep every existing value |
| M-003 | books | 0 → 1 | Add envelope to book records; split nothing (annotations stay nested) |
| M-004 | focus | 0 → 1 | Add envelope to the live session and to finished history records |
| M-005 | activity | 0 → 1 | Register, no shape change; normalise day keys defensively |
| M-006 | ledger / achievements | 1 → 1 | Register the versions already present; no shape change |
| M-007 | prefs / birthday | 0 → 1 | Register; no shape change; **P**/**?** values untouched |
| M-008 | legacy keys | any → removed | Re-run the existing `migrateStorage` merge under the journal, then delete the legacy keys |

**IMPLEMENTATION STATUS.** None of M-001…M-008 exists. `migrateStorage()` today performs only the part of M-008 that concerns monolithic and unversioned task keys, without a journal, without a snapshot and without recording that it ran.

---

## 4. Ordering and dependencies

```
M-001 (registry)
  ├─ M-002 (tasks)  ─┐
  ├─ M-003 (books)   │  independent shapes, independent failure domains
  ├─ M-004 (focus)   │
  ├─ M-005 (activity)│
  ├─ M-006 (ledger/achievements)
  └─ M-007 (prefs/birthday)
        └─ M-008 (legacy key sweep, last: it may create records the envelope steps then touch)
```

**PROPOSED DESIGN.** M-002…M-007 may run in any order relative to each other because they touch disjoint keys. M-008 runs last so a legacy merge cannot introduce a record that misses its envelope.

**RISK.** `migrateStorage()` currently runs at **module evaluation** of `js/store.js`, before the registry exists. Moving it behind the registry changes boot order; `state.js` reads storage during its own module evaluation, which happens when `app.js` imports it. The runner must therefore complete before `state.js` is evaluated, or `state.is` must be populated from the migrated store. The implementation plan (P1-03) makes this explicit rather than leaving it to import order.

---

## 5. Rules for unknown, older and newer versions

| Situation | Behaviour | Reason |
|---|---|---|
| Registry missing | Assume the oldest version for every family, run the chain | First run, wiped key, restored old backup |
| Store version < required | Run the missing steps in order | Normal upgrade |
| Store version = required | No migration; validate a sample and continue | Normal boot |
| Store version > required (a newer app wrote it, then the user downgraded) | **Do not migrate, do not write.** Open read-only for that family, tell the user plainly, and offer the existing JSON backup path | Writing an old shape over a new one destroys fields the old app does not know |
| Registry says a migration started and never finished | Resume from the journal, not from the beginning | See `MIGRATION_SPECIFICATION.md` §4 |
| Registry is corrupt | Rebuild from shape inspection, report that it was rebuilt | A registry is derivable; the data is not |

**RISK.** "Read-only mode" is a new user-visible state. It must be implemented as a *banner plus disabled writes for the affected family only*, never as a whole-app lockout, and it must never trigger on a fresh install.

---

## 6. Field-level exceptions inside a versioned record

A store version governs the document; individual fields can still differ from their record's status. These exceptions must be declared here because the classification module reads this table.

| Record | Field | Field status | Reason |
|---|---|---|---|
| Task (**S**) | `notifiedStatus` | **D** | Stops a second device nagging or suppressing a reminder it never showed |
| Task (**S**) | `order` | **S** | Position is shared; otherwise two devices disagree about the list |
| Book (**S**) | `highlights`, `notes` | **D** | Approved exclusion |
| Book (**S**) | `cover` | **X** | Binary derivative |
| Book (**S**) | `viewer`, `fallback` | **D** | Records which engine worked on this device |
| Focus history (**?**) | all fields | **?** | Inactive until OD-05 |
| Any (**S**) | `originDevice` | **D** | Diagnostics only; the value describes the writer, not the record |

**Rule.** A field-level exception is only valid if the projection drops the field. A test asserts each exception is absent from the sync projection (FND-10).

---

## 7. Registry invariants

| # | Invariant | Enforcement |
|---|---|---|
| R-1 | Every store written by the application has an entry in `stores` | Test enumerates storage keys and compares |
| R-2 | `lastMigration` names the last step that completed successfully | Runner writes it in the same atomic step as the version |
| R-3 | A version is never written before its data is durable | Runner order: snapshot → transform → validate → write data → write version |
| R-4 | No version decreases | Runner refuses a downgrade |
| R-5 | The registry is never synchronised and never restored from a backup | Classification **D** + backup exclusion |
| R-6 | A store not present in the registry is treated as version 0, not as "no data" | Prevents an empty-render bug on first upgrade |

**RISK (R-6).** Treating "no registry entry" as "no data" would silently present an empty notebook to a user whose data is intact. That is the single most damaging failure this registry can produce, and R-6 exists to forbid it.

---

## 8. Change procedure for future work

Any change that alters a stored shape must, in the same change:

1. bump the family version in this registry;
2. add a migration step to `MIGRATION_SPECIFICATION.md` with source, target, preconditions, transformation, postconditions, validation, recovery and data-loss risk;
3. add a fixture containing **only** the old fields to the migration test plan;
4. state whether the field is **S**, **D**, **P**, **X** or **?** and, if it is not local, why;
5. state what happens to the field on a device running the previous version (the answer must not be "it corrupts").

A change that skips step 4 silently widens the sync surface; a change that skips step 5 creates a downgrade failure that only appears in the field.
