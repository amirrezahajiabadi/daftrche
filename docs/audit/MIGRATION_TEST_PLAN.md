# Phase 1 — Migration Test Plan

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.3
**Document status:** test plan. **No test in this document has been written or executed.**
**Date:** 19 November 2026

The existing suite runs 442 tests and passes; it contains no migration test, because there is no versioned migration to test. This plan defines the tests that must exist before any migration step is enabled, and the fixtures they run against.

---

## 1. Harness

| Element | Choice | Reason |
|---|---|---|
| Runner | `node --test`, already the project's only test runner | No new dependency; `npm test` stays the gate |
| Storage | `tests/_env.mjs` `MemoryStorage`, extended with a configurable quota | It is already installed before app modules import, which is the only way to test `state.js` |
| Quota simulation | `MemoryStorage` gains `maxBytes`; `setItem` throws `QuotaExceededError` above it | Required to test the abort path, not just the happy path |
| IndexedDB | Not required by any Phase 1 step | No IDB schema change is proposed. Tests assert the runner **never opens** `daftarche-books` or `daftarche-audio` |
| Clock | Injected `now()` into the runner | A migration that stamps `updatedAt` must be tested deterministically |
| Random | Injected id factory for repair paths | A repaired id must be stable for the same input |

**Rule.** A test that only asserts "it did not throw" is not acceptable for a migration. Every test asserts a **content-level** postcondition: the exact multiset of records, the exact annotation ids, the exact ledger numbers.

---

## 2. Fixtures

Stored as JSON files under `tests/fixtures/migrations/`.

| Fixture | Contents | Exercises |
|---|---|---|
| `v0-minimal.json` | One task `{id, text, done}` | Envelope backfill with the least evidence |
| `v0-full.json` | Tasks with legacy `due`, string `durationMin`, one without `id`, one with `timeFrom` only, one with `notifiedStatus: 'overdue'` | Field migration, pair validation, repair, device-local field preservation |
| `v0-monolith.json` | `daftarche-store` with tasks, history, moods, focusHistory, books, userName, theme, ledger, achievements | M-008 merge |
| `v0-books.json` | Three books: one full, one with a cover data URL and 12 highlights, one `numPages: 0` | Annotation and cover preservation |
| `v0-focus.json` | One paused live session; three history records, one with `endedAt < startedAt` | Live-session preservation; invalid record quarantined, not dropped |
| `v0-duplicates.json` | Two tasks sharing an id; two tasks with identical text and different ids | Duplicate id repair; content duplicates left alone |
| `v0-corrupt.json` | `daftarche-v1` = `"{not json"` | Quarantine, empty store, reported |
| `v0-wrong-shape.json` | `daftarche-books-meta` = `{}` | Quarantine, no coercion |
| `v1-current.json` | A fully migrated store | Idempotence: running the chain changes nothing |
| `v9-registry.json` | Registry claiming `tasks: 9` | Read-only refusal, no write |
| `empty.json` | No keys at all | First run |

---

## 3. Test groups

### G-1 — Registry

| # | Test | Postcondition |
|---|---|---|
| MT-01 | Run on `empty.json` | Registry written with every family present, all at the version the empty data satisfies; no other key created |
| MT-02 | Run on `v0-minimal.json` | Registry present; `tasks` advanced only after M-002 validated |
| MT-03 | Registry corrupt | Rebuilt; report says rebuilt; data untouched |
| MT-04 | Registry claims a newer version | No write of any kind; read-only state reported for that family; other families unaffected |
| MT-05 | Run twice | Second run performs no writes (assert `MemoryStorage.writes` unchanged) |

### G-2 — Tasks

| # | Test | Postcondition |
|---|---|---|
| MT-10 | `v0-full.json` | Every task gains `updatedAt`, `rev: 1`, `deletedAt: null`, `originDevice`, `fieldClock`, `order` |
| MT-11 | Legacy `due` field | Becomes `dueDate`; `due` absent afterwards; value identical |
| MT-12 | `timeFrom` without `timeTo` | Both become `null`; the rest of the record unchanged |
| MT-13 | Task without `id` | Gains a deterministic id; the original record is in quarantine |
| MT-14 | `notifiedStatus` | Preserved verbatim; not projected for sync |
| MT-15 | Order | `order` equals the original array index for every task; the array order is unchanged |
| MT-16 | Content equality | Multiset of `(text, cat, dueDate, done, doneAt, durationMin, timeFrom, timeTo)` identical before and after |

### G-3 — Books

| # | Test | Postcondition |
|---|---|---|
| MT-20 | `v0-books.json` | Each book gains the envelope; every other field byte-identical |
| MT-21 | Annotations | `highlights[].id` set identical; each highlight's `rects`/`pts` identical |
| MT-22 | Notes | `notes[].id` set identical |
| MT-23 | Cover | Data URL preserved exactly |
| MT-24 | `numPages: 0` | Preserved as `0`, not defaulted |
| MT-25 | Progress fields | `lastPage`, `completedPages`, `stats` untouched by the migration |

### G-4 — Focus

| # | Test | Postcondition |
|---|---|---|
| MT-30 | Paused session | Restores as paused with the same `activeMs`, `startedAt`, `runStartedAt` |
| MT-31 | History order and length | Unchanged; cap not applied by the migration |
| MT-32 | Invalid history record | Quarantined with its raw JSON; count of valid records unchanged |
| MT-33 | Classification guard | History records are not enqueued anywhere (no outbox exists in Phase 1; assert the module is not imported by the runner) |

### G-5 — Ledger, achievements, activity

| # | Test | Postcondition |
|---|---|---|
| MT-40 | Ledger | Byte-identical; `v: 1` respected |
| MT-41 | Unknown ledger `v` | Left in place; family recorded at version 0; readers keep their fallback |
| MT-42 | Achievements | Byte-identical |
| MT-43 | History/moods with an invalid day key | Quarantined copy exists; valid keys intact |
| MT-44 | No recomputation | `collectTotals` before and after returns the same numbers (the ledger must not be rebuilt) |

### G-6 — Legacy sweep

| # | Test | Postcondition |
|---|---|---|
| MT-50 | `v0-monolith.json` | Six legacy keys removed; sharded keys contain every record |
| MT-51 | Id collision between legacy and sharded | Existing record wins, exactly as `migrateStorage` does today |
| MT-52 | Legacy key with a corrupt payload | Quarantined; the legacy key is **not** removed |
| MT-53 | Counts | Task count after ≥ before; id set after ⊇ before |

### G-7 — Failure and interruption

| # | Test | Postcondition |
|---|---|---|
| MT-60 | Quota exceeded during snapshot | No data key changed; step not started; failure reported |
| MT-61 | Quota exceeded mid-step | Snapshot restored; every key byte-identical to before |
| MT-62 | Interrupt after `started`, before snapshot | Next run completes normally; one snapshot |
| MT-63 | Interrupt between key writes | Next run transforms only what remains; final state equals an uninterrupted run |
| MT-64 | Interrupt after last write, before `done` | Next run detects the target shape, marks done, does not rewrite |
| MT-65 | Validation failure injected | Rollback; the app reports the step name |
| MT-66 | Two runners concurrently (simulated interleaving) | Final state equals a single run; no duplicate records; documented lock limitation observed, not "proven safe" |

### G-8 — Compatibility

| # | Test | Postcondition |
|---|---|---|
| MT-70 | Old backup restored, then runner | Envelope present; counts match; content identical |
| MT-71 | New data, old reader simulation | `normalizeTask` preserves unknown fields |
| MT-72 | Restore invalidates registry | Registry absent after `applyBackup`; rebuilt on next run |
| MT-73 | Support keys | Absent from `collectBackup` |

### G-9 — Non-regression

| # | Test | Postcondition |
|---|---|---|
| MT-80 | Full suite | All existing 442 tests still pass |
| MT-81 | `state.js` boot | A migrated store produces the same `state.tasks` as before the migration |
| MT-82 | Day cache | `collectTotals` identical before and after a full chain |
| MT-83 | Backup round trip | `backup.test.mjs` unchanged and passing |
| MT-84 | No binary access | The runner never calls `indexedDB` |

---

## 4. Exit criteria

A migration step may be enabled only when:

1. every test in its group passes;
2. G-7 passes for that step specifically (interruption at **its** boundaries);
3. G-9 passes in full;
4. the step's postconditions are asserted on **content**, not on shape alone;
5. the fixture set includes a store from before every previously shipped release;
6. the quarantine count is asserted to be zero for well-formed fixtures and non-zero for the malformed ones.

---

## 5. Execution status

| Group | Status |
|---|---|
| G-1 … G-9 | **Specified only. None written. None executed.** |
| Existing suite | 442 tests executed on 19 November 2026: 442 pass, 0 fail |

This table is the honest state of the work: the plan exists, the tests do not.
