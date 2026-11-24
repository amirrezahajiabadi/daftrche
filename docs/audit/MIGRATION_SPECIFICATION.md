# Phase 1 — Migration Specification

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.3
**Document status:** proposed specification. **No migration has been designed into code, and none has been run.**
**Date:** 19 November 2026

Every step below states its source and target version, preconditions, transformation, postconditions, validation, recovery and data-loss risk, as the phase brief requires. No step may be implemented before the whole package is approved.

---

## 1. Execution model — PROPOSED DESIGN

```
boot
 └─ migrationRunner.run()
      1. read registry  (missing → assume version 0 for every family)
      2. compute the steps needed, in order
      3. for each step:
           a. acquire lock
           b. write journal entry {step, state: 'started', at}
           c. snapshot only the keys this step will touch
           d. transform in memory
           e. validate the transformed result
           f. write the transformed keys (one guarded write per key)
           g. re-read each written key and compare against the transformed result
           h. write journal {step, state: 'done'} and the new version
           i. release lock
      4. clear the journal and the snapshot when every step is done
```

### 1.1 Guarantees the runner must provide

| # | Guarantee | Mechanism |
|---|---|---|
| G-1 | Idempotent | A step whose journal entry says `done` is skipped. Re-running a completed step produces byte-identical output |
| G-2 | Interruptible | An interruption between (c) and (g) leaves data untouched or fully transformed, never half of a key (localStorage writes are per-key atomic) |
| G-3 | Recoverable | `started` without `done` means the step must run again from the snapshot |
| G-4 | Observable | The journal records the last step and its state; the failure banner names it |
| G-5 | Non-destructive | A snapshot is written **before** the first transformed write; the original keys are not removed until validation passes |
| G-6 | Bounded | The snapshot covers only the keys the step touches, and is refused (rather than silently truncated) if it would exceed a fixed size cap |

### 1.2 The lock

**PROPOSED DESIGN.** `daftarche-migration-lock = {owner, at}`.

- Acquire: read the key; if absent, write with a fresh random owner token, then read back and confirm the token survived.
- Release: remove only when the token still matches.
- Stale: a lock older than 30 seconds is treated as abandoned and may be taken over.

**RISK.** `localStorage` has no compare-and-swap, so two tabs can both believe they own the lock in a narrow window. The design accepts this because every step is idempotent (G-1) and validation re-reads what was written; the lock reduces the window, it does not claim mutual exclusion. This limitation must be stated in the release note, not hidden.

---

## 2. Handling of missing and malformed values

| Case | Rule |
|---|---|
| Key absent | Not an error. The store is empty; the version is still advanced so the chain is not re-entered |
| Value is not valid JSON | Do not migrate it. Move the raw string to `daftarche-recovery-quarantine` (single slot, last wins) and start the store empty. Report it |
| Value parses but is the wrong type (array expected, object found) | Quarantine as above; do not coerce |
| Record array with some invalid elements | Migrate the valid ones, quarantine the invalid ones **with their index and raw JSON**, and continue. Never drop silently |
| Missing optional field | Fill the declared default; record the fill in the migration summary |
| Missing required field (`id`, timestamp) | Repair deterministically: `id` from a stable hash of the record's raw JSON (never the clock), timestamps from the earliest evidence available, else the migration time. Quarantine the original |
| Duplicate `id` within one store | Keep the first by array order; the later duplicate gets a new id and a `migrated-duplicate` marker. Never merge two records silently |
| Duplicate by content but different ids | **Not** deduplicated. The user wrote two things; the migration is not the place to decide otherwise |
| Day keys that are not `YYYY-MM-DD` | Dropped from day-keyed stores, quarantined |
| Numbers stored as strings | Coerced where the reader already coerces (`parseDurationMin`, `pos`), else left and flagged |

**Rule.** Every quarantine entry is recoverable from storage by a support step, and the migration summary reports the count. A migration that reports "0 problems" while dropping a record is a defect.

---

## 3. Steps

### M-001 — Establish the registry

| Field | Value |
|---|---|
| Source version | registry absent |
| Target version | registry `v: 1` present, with the versions the data actually satisfies |
| Preconditions | None. This step runs on a first run, a wiped registry and an old install alike |
| Transformation | Inspect each store family: present and shaped → version 1 if the family is already versioned in the data, else 0; then let later steps advance it. Write `daftarche-schema` |
| Postconditions | A registry exists whose `stores` values are never higher than what the data supports |
| Validation | Every family named in §2.1 of `DATA_SCHEMA_REGISTRY.md` has an entry; no entry claims a version whose required fields are absent from the stored records |
| Recovery | The registry is derivable; delete it and re-run |
| Data-loss risk | **None.** No data key is written |
| Implementation status | Absent |

### M-002 — Task envelope

| Field | Value |
|---|---|
| Source → target | `tasks` 0 → 1 |
| Preconditions | M-001 done; tasks may be absent |
| Transformation | For each task record: `created = created ?? (earliest of doneAt, now)`; `updatedAt = created`; `rev = 1`; `deletedAt = null`; `originDevice = installationId` (created here if absent); `order = index`; `fieldClock = { text: created, done: created, dueDate: created, p: created, cat: created, durationMin: created, timeFrom: created, notify: created }`; `notifiedStatus` kept as-is |
| Postconditions | Every task has the full envelope; `order` is dense and ascending; no task text, category, due date, duration or time span changed |
| Validation | Record count identical; multiset of `(text, cat, dueDate, done, doneAt, durationMin, timeFrom, timeTo)` identical before and after; every id unique; `order` sorted |
| Recovery | Snapshot of `daftarche-v1` is restored on any validation failure |
| Data-loss risk | Low. The only invented values are `updatedAt`/`rev`/`fieldClock` (metadata) and `order` (derived from index). A wrong `order` changes list position, not content |
| Implementation status | Absent. `normalizeTask` fills some optional fields on read but writes no envelope |

### M-003 — Book envelope

| Field | Value |
|---|---|
| Source → target | `books` 0 → 1 |
| Preconditions | M-001 done |
| Transformation | Per book: `updatedAt = lastReadAt ?? addedAt ?? now`; `rev = 1`; `deletedAt = null`; `originDevice = installationId`. `numPages`, `lastPage`, `completedPages`, `stats`, `goal`, `title`, `cover`, `highlights`, `notes`, `viewer`, `fallback` untouched |
| Postconditions | Every book has the envelope; nested annotations keep their ids and `createdAt` |
| Validation | Count identical; per book, `completedPages` set identical, `stats` identical key-for-key, annotation counts identical, `highlights[].id` set identical |
| Recovery | Snapshot of `daftarche-books-meta` |
| Data-loss risk | **Low but consequential.** A bug here can lose annotations, which no later sync can restore because they are device-local. The validation therefore compares annotations explicitly rather than trusting the record count |
| Implementation status | Absent |

### M-004 — Focus envelope

| Field | Value |
|---|---|
| Source → target | `focus` 0 → 1 |
| Preconditions | M-001 done |
| Transformation | Live session: add `updatedAt`/`rev`/`originDevice`; leave `status`, `activeMs`, `runStartedAt` semantics exactly as they are. History: add `updatedAt = endedAt`, `rev = 1`, `deletedAt = null` to each valid record; **do not change the cap and do not re-sort** |
| Postconditions | The live timer restores exactly as before; history order and length are unchanged |
| Validation | `state.session` round-trips through `normalizeSession` to the same active/paused state; history count and id order identical |
| Recovery | Snapshot of both keys |
| Data-loss risk | Medium if a session is dropped, because it is the only record of a running timer. The step must never call `normalizeHistoryRecord` (which drops invalid records) — it adds fields and leaves invalid records in place for quarantine |
| Implementation status | Absent. Classification **?** means history is not activated by this step |

### M-005 — Activity registration

| Field | Value |
|---|---|
| Source → target | `activity` 0 → 1 |
| Preconditions | M-001 done |
| Transformation | Register the version. No shape change. Filter invalid day keys into quarantine as a *copy*, leaving the original arrays untouched if any invalid key exists, and report the count |
| Postconditions | Registry claims version 1; data unchanged |
| Validation | `daftarche-history` and `daftarche-moods` byte-identical (unless quarantining was required, in which case the diff is exactly the removed invalid keys) |
| Recovery | Nothing to recover when no write occurs |
| Data-loss risk | **None** by design: this step is a no-op except for the registry |
| Implementation status | Absent |

### M-006 — Ledger and achievements adoption

| Field | Value |
|---|---|
| Source → target | `ledger` 1 → 1, `achievements` 1 → 1 |
| Preconditions | M-001 done |
| Transformation | Record the versions already present in the data. Do not rewrite the objects. If `v` is missing or unknown, leave the data in place, mark the family version 0, and let the readers keep their existing fallbacks |
| Postconditions | The registry agrees with the data; no value is normalised by a migration |
| Validation | Both keys byte-identical |
| Recovery | None needed |
| Data-loss risk | **None.** A migration that rewrites a monotonic ledger is a risk with no benefit |
| Implementation status | The `v: 1` fields exist; adoption does not |

### M-007 — Preferences and birthday registration

| Field | Value |
|---|---|
| Source → target | `prefs` 0 → 1, `birthday` 0 → 1 |
| Preconditions | M-001 done |
| Transformation | Register. No value is rewritten, no key renamed, no default written |
| Postconditions | `theme` (the one key without a `daftarche-` prefix) is registered explicitly, not by prefix assumption |
| Validation | Every preference key in `DATA_INVENTORY.md` §3 is accounted for; values byte-identical |
| Recovery | None needed |
| Data-loss risk | **None.** `P` and `?` values must not be "tidied" by a migration |
| Implementation status | Absent |

### M-008 — Legacy key sweep

| Field | Value |
|---|---|
| Source → target | `legacy` any → removed |
| Preconditions | M-002…M-007 done, so a record introduced here still receives its envelope in a later run of those steps if needed |
| Transformation | The existing `migrateStorage()` merge, unchanged in behaviour, executed under the journal. Merge order and duplicate rules stay exactly as they are today (existing ids win, unknown ids appended) |
| Postconditions | The six legacy keys are gone; the sharded keys contain everything they held |
| Validation | Count of tasks before ≥ count after; every id present before is present after; history/moods/focus/books/achievements counts never decrease |
| Recovery | Snapshot of every key named in the legacy merge, plus the legacy keys themselves |
| Data-loss risk | Medium. This is the only step that removes user data from a key, and it has been running unattended at module load since the sharding release. Moving it under the journal is a strict improvement, but the merge rules must not change in the same step |
| Implementation status | **Partially exists** as `js/store.js` `migrateStorage()`, without journal, snapshot, validation or version record |

---

## 4. Interruption and resume

| Interruption point | State left behind | Resume behaviour |
|---|---|---|
| Before the journal entry | Nothing changed | Step runs normally |
| After `started`, before snapshot | Nothing changed | Step runs again |
| After snapshot, before the first write | Snapshot exists, data unchanged | Step runs again; the snapshot is rewritten (single slot) |
| Between key writes in a multi-key step | Some keys transformed, some not | Step re-reads, transforms only keys not yet at the target version, validates the whole set |
| After the last write, before `done` | Data fully transformed, journal says started | Step detects that the data already satisfies the postcondition, marks `done` without rewriting |
| After `done`, before the registry write | Journal done, registry old | Registry is written from the journal entry, not recomputed |
| Any point with a full quota | Write fails, `safeSet` returns false | Step aborts, restores the snapshot, reports "not enough room", and leaves the app on the old version with a visible banner |

**Rule.** Every step must be able to answer "is the data already in the target shape?" from the data alone. A step that cannot answer that is not idempotent and may not be implemented.

---

## 5. Storage quota and failure handling

| Failure | Detection | Behaviour |
|---|---|---|
| Quota exceeded during snapshot | `safeSet` false | Abort before touching data. Report. Offer the JSON backup/export path |
| Quota exceeded during a transformed write | `safeSet` false | Restore the snapshot, abort, report |
| `localStorage` unavailable (private mode) | first read throws or returns null | Do not run; the application already degrades through `safeSet`'s guard and `storagewarn.js` |
| IndexedDB blocked | `onblocked` | Not part of any Phase 1 migration (no IDB schema change is proposed), but the existing delete paths already report it |
| Mid-step crash | journal `started` | Resume path above |

**RISK.** A migration increases storage temporarily (snapshot plus new value). The largest store is the task list; the snapshot cap must be sized so a device with a nearly full quota fails **before** writing, not halfway through.

---

## 6. Backup interaction

| Interaction | Rule |
|---|---|
| Restoring an old backup into a new app | `parseBackup` accepts `format: 1`; the restored keys are then migrated by the normal runner. Because `applyBackup` clears backup-eligible keys first, the registry is removed and rebuilt — which is correct, because the restored data is old |
| Restoring a backup made by a newer app | Refused by `parseBackup` (`format > BACKUP_FORMAT`), unchanged |
| Merge into an existing store | `mergeBackup` writes merged strings; the runner must be invoked after a merge so newly arriving old-shaped records receive the envelope. Today `applyBackup` calls `migrateStorage`; the runner replaces that call |
| Registry inside a backup | Excluded (see `BACKUP_COMPATIBILITY.md` §5) |
| Migration summary inside a backup | Never. It is diagnostic, device-local |

---

## 7. Web and Android

| Concern | Web | Android |
|---|---|---|
| Runner timing | Before `state.js` evaluation | Same; the bundle is the same modules |
| Storage API | `localStorage` | Same WebView API |
| Crash mid-run | Tab closed → journal resume | App killed → journal resume |
| Service worker build | `BUILD` bump required for any new module | `www/` rebuild required |
| Downgrade | Old cached build may run after a new one wrote data | APK downgrade is not a normal path |

**RISK (web only).** A service worker can serve a previous build from cache after a new build has migrated data. The shell cache is keyed by `BUILD`, so a new build replaces it, but a client that has not yet activated the new worker can still run the old code against new data. The registry's "store version > required" rule covers this case: the old build must refuse to write, not corrupt. This is the strongest argument for implementing §5 of `DATA_SCHEMA_REGISTRY.md` **with** the first envelope migration rather than later.

---

## 8. What no step may do

- Delete a user record to make a shape fit.
- Rename a storage key without a step that reads the old key and writes the new one in one pass.
- Change `daftarche-focus-history`'s cap.
- Write `updatedAt` on read.
- Touch `daftarche-books` or `daftarche-audio`.
- Introduce an envelope on a **P** or **?** record and then leave it active by accident: the field may exist, but the classification governs whether it is projected, queued or merged.
- Run inside a render path, on a timer, or in a service worker.
- Report success when any quarantine entry was written.

---

## 9. Fixtures the migration tests must contain

Specified here, executed later (`MIGRATION_TEST_PLAN.md`).

| Fixture | Contents |
|---|---|
| `legacy-v0-minimal` | One task with only `{id, text, done}`; no other keys |
| `legacy-v0-full` | Tasks with `due` (legacy field), `durationMin` as a string, a task without `id`, a task with `timeFrom` but no `timeTo` |
| `legacy-monolith` | `daftarche-store` holding tasks, history, moods, focusHistory, books, userName, theme, ledger, achievements |
| `legacy-books` | Books with annotations, stats, a missing `numPages`, a `cover` data URL |
| `legacy-focus` | A live paused session and three history records, one invalid |
| `legacy-duplicates` | Two tasks with the same `id`; two tasks with identical text and different ids |
| `corrupt-json` | `daftarche-v1` holding `"{not json"` |
| `wrong-shape` | `daftarche-books-meta` holding an object instead of an array |
| `newer-registry` | Registry claiming `tasks: 9` |
| `quota-full` | A storage stub that refuses writes above a fixed size |
