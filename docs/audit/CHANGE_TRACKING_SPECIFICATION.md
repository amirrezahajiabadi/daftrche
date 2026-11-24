# Phase 1 — Change Tracking Specification

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.5
**Document status:** proposed specification. **No change tracking exists today and none is implemented.**
**Date:** 19 November 2026

**APPROVED DECISION.** Sync is free for every registered account and never exists for a guest. Change tracking must therefore be able to answer "what changed?" without requiring an account, and must produce **no** remote work for a guest.

**Current state in one line.** Nothing records what changed. `saveTasks(state.tasks)` serialises a whole array; `updateBook(id, patch)` rewrites a whole record; `saveSession` rewrites one object. There is no `updatedAt`, no `rev`, no operation queue and no deletion marker anywhere in `js/`.

---

## 1. What must be tracked, and why

| Need | Without it | Provided by |
|---|---|---|
| Know a record changed | An engine must diff snapshots | `updatedAt` + `rev` |
| Order two edits of one record | Clock comparison, which is untrustworthy | `rev`, then `serverSeq` in Phase 2 |
| Represent a delete | A deleted record is indistinguishable from an absent one | `deletedAt` tombstone |
| Merge independent field edits | Whole-record last-writer-wins loses a field | `fieldClock` on tasks |
| Send only what changed | Whole-store upload on every sync | outbox operations |
| Survive a restart with pending work | Queue lost on reload | outbox in IndexedDB |
| Avoid duplicates on retry | Server may apply one operation twice | `opId` idempotency |
| Explain a conflict to the user | Silent overwrite | conflict record |

---

## 2. The record envelope (normative for this phase)

```
id            string        stable, never reused
updatedAt     number        epoch ms, client clock, written only on mutation
rev           integer       ≥ 1, incremented on every local mutation
deletedAt     number|null   tombstone marker
originDevice  string        installation id of the writer
fieldClock    object        tasks only; per-field epoch ms
```

Store-level versioning and batch versioning are outside the record (`DATA_SCHEMA_REGISTRY.md` §2).

### 2.1 Rules

| # | Rule | Why |
|---|---|---|
| CT-1 | `updatedAt` is written **only** by a repository mutation | Writing it on read makes every record look dirty and destroys merge meaning |
| CT-2 | `rev` increments by exactly one per mutation, including a tombstone and an undo | Two mutations with the same `rev` would tie in ordering |
| CT-3 | A tombstone keeps `id`, `deletedAt`, `updatedAt`, `rev`, `originDevice` and drops the payload after the retention window | The identity is what prevents resurrection; the payload is what costs space |
| CT-4 | `created` never changes | It is the earliest evidence of the record's existence |
| CT-5 | A mutation that changes nothing does not bump `rev` | Otherwise a render or a no-op save inflates revisions |
| CT-6 | A device-local field may be written without widening the projection | `notifiedStatus` is the working example |
| CT-7 | No change record contains a binary value or a data URL | Enforced at enqueue |
| CT-8 | A change record contains no user text | The outbox references `{kind, id, rev}`; the payload is read at send time, so the queue itself is small and cannot become a second copy of the notebook |

**CT-8 is the most consequential rule here.** It means the outbox is a *log of intent*, not a copy of data. Consequences: the queue stays small; a corrupted queue cannot corrupt records; a queued operation for a record that changed again is superseded by the later revision rather than replayed twice.

---

## 3. Where tracking is attached

| Operation | Tracked at | `rev` bumped | Outbox entry (session only) |
|---|---|---|---|
| Task create | `repository.tasks.create` | yes | yes |
| Task field edit | `repository.tasks.update` | yes | yes |
| Task tick / untick | `repository.tasks.setDone` | yes | yes |
| Task reorder | `repository.tasks.reorder` | yes, on each moved record | yes, one per moved record |
| Task delete / bulk delete | `repository.tasks.delete(Many)` | yes | yes, tombstone op |
| Task undo | `repository.tasks.restore` | yes | yes |
| Book metadata edit | `repository.books.update` | yes | yes |
| Reading position | `repository.books.saveProgress` | yes | yes |
| Page read / stats | `repository.books.markPageRead` | yes | yes |
| Highlight / note add or remove | `repository.books.*` | yes | **no** — device-local |
| Cover | `repository.books.update` | yes | **no** — excluded binary |
| Book delete | `repository.books.delete` | yes | yes (metadata tombstone only) |
| Day opened | `repository.activity.recordDay` | n/a (set semantics) | yes, as a day-set addition |
| Mood | `repository.activity.setMood` | n/a | yes |
| Ledger floor | `repository.activity.raiseFloor` | n/a (monotonic) | yes, as a raised value |
| Achievements | `repository.activity.saveAchievements` | yes | yes |
| Focus session live | `repository.session.*` | yes | **no** — device-local |
| Focus history append | `repository.activity.appendSession` | yes | **no** until OD-05 |
| Any preference | `repository.prefs.set` | no | **no** — no preference is **S** |

---

## 4. Revision semantics

### 4.1 Local revision

```
rev starts at 1 on create
every accepted mutation: rev = rev + 1
a rejected mutation leaves rev unchanged
```

### 4.2 Ordering a pair of copies

```
order(a, b):
  serverSeq (Phase 2)  → higher wins
  rev                  → higher wins
  updatedAt            → later wins
  originDevice         → lexically smaller wins (deterministic tie-break only)
```

Device clocks never outrank revisions (`CONFLICT_RESOLUTION_SPECIFICATION.md` §2.3, example E-6).

### 4.3 What a revision is not

- It is **not** a vector clock. Two devices editing the same record both reach `rev: 5`; the tie is broken deterministically, and a genuine field conflict is surfaced.
- It is **not** a server sequence. The server assigns `serverSeq`; the client never invents one.
- It is **not** a content hash. Revisions count mutations, not equality.

**PROPOSED DESIGN.** A vector clock was considered and rejected: it would grow with the number of devices, and the product only needs to distinguish "one side changed" from "both changed", which `fieldClock` + `rev` already answers for the one record type that needs field merging.

---

## 5. Tombstones

| Property | Decision |
|---|---|
| Written by | Every delete path, in the repository |
| Kept for | A retention window (proposal: 90 days), then the payload is dropped and the tombstone remains until compaction |
| Visible to the user | Never as a row; the undo notice is the only surface |
| Counted in totals | No. `daycache`, `ledger`, `stats` must exclude deleted records |
| Pruned by | A compaction step that runs only after a server has acknowledged the deletion (Phase 2). A guest never compacts, because a guest has no server |
| Included in a backup | **Yes**, as part of the record array. A backup is a full copy of the notebook's state including its deletions, otherwise restoring a backup would resurrect records the user deleted |

**RISK.** Including tombstones in a backup means a JSON file shows records the user cannot see. That is correct — the file is the state, not the view — but the backup's own shape check (`SHAPES['daftarche-v1'] === 'array'`) is unchanged, so no compatibility work is needed.

**RISK.** Undo after the retention window would fail. The window is 90 days; the undo window is 5 seconds. No interaction.

---

## 6. Reading progress: operation ordering, not page comparison

**APPROVED DECISION.** The latest valid position is authoritative; the highest page is never selected automatically.

Implementation consequences:

| Need | Mechanism |
|---|---|
| Distinguish "went to page 12 later" from "went to page 240 earlier" | `rev` + `serverSeq`, never `max(page)` |
| Reject an impossible position | `1 ≤ page ≤ numPages` when `numPages > 0` |
| Preserve a rejected position | Conflict record with a reason |
| Keep page reads monotonic | `completedPages` is set-union; `stats` takes per-field maxima |

**CURRENT STATE.** `js/backup.js` `mergeBook` uses `Math.max(lastPage)`. That is the manual-merge path, which is not changed in this phase (OPEN QUESTION PQ-01).

---

## 7. Change events

```
daftarche:data-changed
  detail: { kind, id?, fields?, origin: 'local'|'sync'|'migration', rev? }
```

| Consumer | What it does |
|---|---|
| `daycache` | Invalidates the affected buckets (today: all) |
| `bus` subscribers | Re-render, as today |
| Outbox (Phase 2) | Nothing; the repository enqueues before emitting |
| Cross-tab listener | Warns, never merges in Phase 1 |

**Rule.** One mutation emits exactly one event. A view must not emit it a second time.

---

## 8. Guest guarantees

| Guarantee | How it is structurally true |
|---|---|
| No outbox entry | enqueue is guarded by `session.exists()`; a guest has no session |
| No sync database | `outboxAdapter` opens lazily on first enqueue |
| No network call | Nothing in the repository imports `fetch`; a test asserts a guest session issues zero requests |
| No loss of function | Every field written locally is written whether or not a server exists |
| No prompt | Change tracking is invisible; it produces no UI of its own |

---

## 9. Migration of existing records

| Store | Backfill |
|---|---|
| Tasks | `updatedAt = created`, `rev = 1`, `deletedAt = null`, `originDevice = installationId`, `order = index`, `fieldClock` seeded from `created` |
| Books | `updatedAt = lastReadAt ?? addedAt`, `rev = 1`, `deletedAt = null` |
| Focus history | `updatedAt = endedAt`, `rev = 1` |
| Ledger, achievements | no envelope; `v: 1` already present |
| Day history, moods | no envelope; keyed sets |

Every backfill is specified in `MIGRATION_SPECIFICATION.md` with validation and rollback.

---

## 10. Test obligations

| # | Test | Asserts |
|---|---|---|
| CT-T1 | Create / edit / tick / reorder / delete / undo | `rev` increments exactly once each; `updatedAt` changes; no other field changes |
| CT-T2 | No-op update | `rev` unchanged |
| CT-T3 | Read a record | No write to storage at all |
| CT-T4 | Delete | Tombstone survives a reload; not rendered; not counted |
| CT-T5 | Guest mutation sweep | Outbox empty; no `daftarche-sync` database; zero `fetch` calls |
| CT-T6 | Ordering fixtures | `rev` beats a skewed clock; ties resolve deterministically |
| CT-T7 | Device-local field write | `notifiedStatus` changes locally; projection unchanged |
| CT-T8 | Event count | One `data-changed` per mutation |
| CT-T9 | Backup contains a tombstone | Restore keeps the record deleted |
| CT-T10 | Binary rejection | An enqueued payload containing a data URL is refused with a code |

---

## 11. Explicit non-goals

- No field-level tracking outside tasks.
- No vector clocks, no causal graphs, no CRDT.
- No background change scanner.
- No change tracking for analytics.
- No tracking of render state, filters, scroll position or which page was open.
- No server sequence numbers invented on the client.
