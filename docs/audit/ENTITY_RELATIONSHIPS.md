# Phase 1 — Entity Relationships

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.2
**Document status:** proposed relationship model over the existing stores. Nothing is implemented.
**Date:** 19 November 2026

---

## 1. Entities

| Entity | Status | Identity | Lives in | Cardinality anchor |
|---|---|---|---|---|
| Task | **S** | `task.id` | `daftarche-v1` | many |
| Focus session (finished) | **?** (OD-05) | `session.id` | `daftarche-focus-history` | many, capped locally at 100 |
| Focus session (live) | **D** | `session.id` | `daftarche-focus-session` | at most one |
| Book | **S** (metadata + progress) | `book.id` | `daftarche-books-meta` | many |
| PDF file | **X** | `book.id` | `daftarche-books` / `books` | at most one per book |
| Highlight | **D** | `highlight.id` | inside its book record | many per book |
| Note | **D** | `note.id` | inside its book record | many per book |
| Cover | **X** | `book.id` | inside its book record | at most one per book |
| Audio track | **X** | `track.id` | `daftarche-audio` / `tracks` | many |
| Day record | **S** (moods, opened) | day key `YYYY-MM-DD` | `daftarche-moods`, `daftarche-history` | at most one per day |
| Ledger day | **S** | day key | `daftarche-ledger.days` | at most one per day |
| Achievement | **S** | achievement id | `daftarche-achievements.unlocked` | at most one per achievement |
| Preference | **P** / **D** / **?** | storage key | one key per preference | one |
| Installation | **D** | `installationId` | `daftarche-installation` (proposed) | one |

---

## 2. Relationships

```
                    ┌──────────────┐
                    │ Installation │ 1
                    └──────┬───────┘
                           │ owns (local only)
                    ┌──────▼───────┐
                    │  Workspace   │ 1        guest:<installation> | account:<userId>
                    └──────┬───────┘
        ┌──────────────────┼───────────────────┬────────────────────┐
        │                  │                   │                    │
   ┌────▼────┐        ┌────▼────┐         ┌────▼─────┐        ┌─────▼──────┐
   │  Task   │ 0..1   │  Book   │ 0..n    │ Day key  │ 0..1   │ Achievement│
   └────┬────┘        └────┬────┘         └────┬─────┘        └────────────┘
        │ taskId           │ id                │
        │ (snapshot text)  ├── PDF file 0..1   ├── mood 0..1
   ┌────▼─────────┐        ├── Cover 0..1      ├── opened 0..1
   │Focus session │        ├── Highlight 0..n  └── ledger day 0..1
   │  (finished)  │        ├── Note 0..n
   └────┬─────────┘        └── Stats[day] 0..n
        │
        └── contributes to ──► Ledger day (floor) ──► Achievement evaluation ──► Theme reward
```

**CURRENT STATE.** None of these relationships is enforced. They are conventions held by the modules that read the data: `dayKey(new Date(ts))` maps a timestamp into a day bucket; `session.taskId` may point at a task that no longer exists; `book.id` is the join key between two entirely separate stores.

---

## 3. Referential integrity today

| Relationship | Enforced? | What happens when it breaks |
|---|---|---|
| `focusSession.taskId → task.id` | No, by design | The session keeps `taskTitle` as a **snapshot**, so history survives a deleted or renamed task. A dangling `taskId` is tolerated and never rendered as a link |
| `book.id → PDF blob` | No | A book without a file opens with a "needs the file" state; a blob without a book is unreachable and is only removed by the full wipe |
| `highlight bookId → book.id` | Implicit (nested) | Nested records cannot dangle; they die with the book |
| `stats[day] → day key` | Yes, when read | `daycache` skips keys that are not `YYYY-MM-DD` |
| `ledger.days[day] → day key` | Yes, `readLedger` filters | An invalid key is dropped |
| `moods[day]`, `history[]` | Yes, on read | `history` entries are only added as valid day keys; `daycache` guards anyway |
| `achievements.unlocked → achievement catalogue` | Partly | Unknown ids are preserved but never rendered; the catalogue is code, not data |
| `theme reward → achievements` | Yes, when read | A theme whose reward is not unlocked falls back (`theme.js:78`) |

**PROPOSED DESIGN.** The repository does not attempt to enforce cross-store foreign keys. It records the *known* dangling cases as legitimate states and makes each of them explicit in the read API:

| Legitimate state | API surface |
|---|---|
| Session whose task is gone | Session carries its own title; no link rendered |
| Book without a file on this device | `fileState: 'absent' \| 'present'` on the read model |
| Highlight/note inside a book | Always present if the book is; no separate query |

---

## 4. Cascades and their absence

| Action | What happens today | Required by the contract |
|---|---|---|
| Delete a task | Removed from the array; undo queue holds it; if a focus session points at it, the session is cleared (`clearFocus()`) | Tombstone; the session is not re-pointed; history is untouched because it holds a snapshot |
| Clear completed tasks | Removes every done task at once; each is pushed onto the undo queue | One tombstone per task; undo restores each |
| Delete a book | Metadata removed at once, file removed after 5 s, undo restores metadata only — the file survives because it is deleted last | Tombstone for metadata; the file is deleted only when the tombstone is committed; **a deleted book never takes the file with it before the undo window closes** |
| Clear all data | `clearAll()` + `clearLibraryData()` + `clearUserAudioData()` | Unchanged, with the three failures reported separately (already the case in `settings.js:734-737`) |
| Restore a backup | Metadata replaced; files untouched; audio untouched | Unchanged. A restored record with no file is the normal "needs the file" state |
| Delete an account | Phase 2 | Never deletes the device copy without a separate confirmation |

**RISK.** The book cascade is the only one where a user-visible undo exists over a *binary* deletion. Any change here must keep the ordering: metadata tombstone first, file deletion last, undo restores the metadata before the file is gone.

---

## 5. Cross-entity invariants

These are the statements that must hold after any write, and the tests in `PHASE_1_VALIDATION_PLAN.md` assert them.

| # | Invariant | Check |
|---|---|---|
| I-1 | A task appears at most once by `id` in the list | Count ids vs unique ids |
| I-2 | A task with `done: true` has a `doneAt`; a task with `done: false` has `doneAt: null` | Per-record check |
| I-3 | A focus session counted as finished has `endedAt ≥ startedAt` and `actualDurationMin ≥ 1` | `normalizeHistoryRecord` already enforces |
| I-4 | At most one live focus session exists | `getActiveSession` returns one or none |
| I-5 | A book's `completedPages` contains only integers in `1..numPages` when `numPages > 0` | Read model validation |
| I-6 | A book's `stats` keys are valid day keys and values are non-negative numbers | Read model validation |
| I-7 | A ledger day never decreases for `done`, `focusMin` or `sessions` | Compare before/after any write |
| I-8 | Ledger floors never exceed what the live sources could support **on the same day as they were raised**; afterwards they may exceed live values (that is their purpose) | Documented, not asserted as equality |
| I-9 | `daftarche-history` contains no duplicate day keys | Set comparison |
| I-10 | Every highlight/note has an `id` unique within its book | Per-book uniqueness |
| I-11 | A preference key holds a value its reader accepts, or the reader falls back | Reader-by-reader fallback already exists |
| I-12 | A record classified **D** or **X** never appears in the sync projection | Negative projection tests (FND-10) |

---

## 6. Day keys are the join across five stores

**CURRENT STATE.** The same `YYYY-MM-DD` key appears in:

| Store | Meaning of the key |
|---|---|
| `daftarche-history` | The app was opened |
| `daftarche-moods` | The reader's mood (1..5) |
| `daftarche-ledger.days` | Floors for done / focusMin / sessions |
| `book.stats[day]` | Pages and minutes read in that book |
| task `dueDate`, `doneAt`, `created` | Derived to a day at read time |

**PROPOSED DESIGN.** The day key is a first-class join key and must be generated by one function (`js/utils.js` `dayKey`) with one timezone rule: the device's local calendar day. Two consequences are worth writing down because they are invisible today and would become bugs in a multi-device account:

1. **A traveller changes timezone.** The same instant can belong to two different local days on two devices. The contract keeps day keys as *device-local calendar facts*; it never converts a stored day key to another timezone, and it never recomputes a historical day key.
2. **Midnight rollover with the app open.** `daycache` already detects a new day and re-buckets; the ledger follows on the next write. No record is rewritten at rollover.

**OPEN QUESTION PQ-02.** Whether a synced account should present a single "account day" (server timezone) or keep each device's own day boundary. The recommendation is to keep the device day boundary, because a day of one's own life is local, and to make the differences visible only where they matter (weekly totals). This needs an owner answer before Phase 2 sync of day-keyed records.

---

## 7. Derived entities — explicitly not stored

| Derived thing | Derived from | Why it is not stored |
|---|---|---|
| Streak, freezes | Active-day set from five stores | `streakInfo` is pure; storing it would create a second truth that can contradict the first |
| Records, best day, best month | Ledger days + live sources | Recomputed per render; the ledger is the floor |
| Achievement tiers | Live totals | Stored only as "highest tier reached", never as a computed score |
| Shelf status (`new` / `reading` / `done`) | `completedPages`, `numPages`, `lastPage` | Pure function `bookStatus` |
| Week score | Ledger days | Pure function `scoreOf` |
| Book "file present" | IndexedDB lookup | Must stay a query, not a flag, or it goes stale after a wipe |

**RISK.** Any derived value that gets persisted "for speed" becomes a second source of truth. The existing design avoids this; the data access layer must not introduce caching that is written to storage.

---

## 8. Ownership boundaries between entities

| Boundary | Rule |
|---|---|
| Book metadata vs PDF file | Different stores, different statuses. Metadata may exist without the file; the file may exist without metadata only as an orphan |
| Reading progress vs annotations | Progress is **S**; annotations are **D**. A device may have full progress and no annotations, or annotations and stale progress; neither degrades the other |
| Ledger vs focus history | The ledger is a floor; history is the source. Trimming history never lowers a floor, which is why the ledger exists |
| Live session vs history | The live session is **D** and mutable; history is append-only |
| Preferences vs activity | No preference may influence a stored activity fact; a theme never changes a ledger number |
| Account workspace vs guest workspace | Separate key namespaces; a guest record is copied into an account workspace during migration, never moved |

---

## 9. What would break these relationships

| Change | Effect |
|---|---|
| Storing highlights outside the book record | Introduces a join that does not exist today, plus an orphan class |
| Writing `updatedAt` on read | Every record looks modified; revisions inflate and merges become meaningless |
| Deleting a book before its undo window | Loses the file with no way back |
| Trimming history before deduplicating by id | Can drop a record that is also arriving from another device |
| Summing ledger days instead of taking maxima | Double counting on every merge |
| Persisting a computed streak | A second truth that disagrees after a restore |
| Namespacing keys before the backup collector is registry-based | Backup silently drops or duplicates records |
