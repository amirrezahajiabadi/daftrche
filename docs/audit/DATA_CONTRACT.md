# Phase 1 — Data Contract

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.2
**Document status:** proposed contract. **Nothing in this document is implemented.**
**Date:** 19 November 2026

The Data Contract is the single written answer to four questions for every persisted thing: *what identifies it, what may change, how is a change ordered, and who may see it.* It is deliberately narrower than the current code: it describes the shape the data access layer will guarantee, not the shape every module happens to produce today.

**IMPLEMENTATION STATUS: nothing described here exists.** No record today carries `updatedAt`, `rev`, `deletedAt` or an owner field; no store carries a schema version.

---

## 1. Rules that govern the whole contract

| # | Rule | Status |
|---|---|---|
| C-1 | A record's `id` is created on the device, is never derived from content, and never changes | CURRENT STATE (already true: `utils.js:64` `nextId`) |
| C-2 | Every syncable record carries `updatedAt`, written only on a real mutation | PROPOSED DESIGN |
| C-3 | Every syncable record carries `rev`, a per-record integer that increases on each local mutation | PROPOSED DESIGN |
| C-4 | Deletion is a state, not an absence: a deleted record keeps `id`, `deletedAt`, `updatedAt`, `rev` and drops its payload after the retention window | PROPOSED DESIGN |
| C-5 | A device clock orders nothing on the server. It is display and tie-breaking data only | APPROVED DECISION (`SYNC_AND_DATA_STRATEGY.md` §4 F6, §5.1) |
| C-6 | Completion, a page read, and a raised ledger floor are **facts**: no merge may lower them | CURRENT STATE (ledger `bumpDay`, backup merge) — to be preserved |
| C-7 | Reading position is the **latest valid position**, never the highest page number | APPROVED DECISION (Phase 1 brief, §6 Stage 1.2) |
| C-8 | A record excluded from Sync stays readable and writable locally; exclusion never disables a feature | APPROVED DECISION |
| C-9 | A field added in future starts **unsynced** until classified | APPROVED DECISION (`SYNC_AND_DATA_STRATEGY.md` §5.3 rule 6) |
| C-10 | No client-supplied owner identifier is ever accepted as proof of authorization | APPROVED DECISION (`TARGET_ARCHITECTURE.md` §2.3) |

---

## 2. Record envelope

### 2.1 Shape — PROPOSED DESIGN

```
id            string    stable, client-generated, never reused
updatedAt     number    epoch ms, client clock, written on mutation only
rev           integer   ≥ 1, incremented on each local mutation of this record
deletedAt     number|null   null for a live record
originDevice  string    installation id of the writer (diagnostics and conflict copy only)
```

Store-level and batch-level versioning sit **outside** the record, per the approved task split:

```
schemaVersion   integer   one per store, declared in daftarche-schema
batchVersion    integer   one per pushed batch (Phase 2; not created in Phase 1)
serverSeq       number    server-assigned ordering, authoritative; never written locally as truth
```

### 2.2 Why `rev` exists when `updatedAt` already does

`updatedAt` comes from a device clock. Two devices with clocks 40 seconds apart can produce edits whose timestamps invert, and a clock set backwards can permanently lose a later edit. `rev` gives a deterministic local ordering that survives clock skew: a merge can always say "this copy has been revised more times", and only falls back to `updatedAt` when revisions are equal. Neither `rev` nor `updatedAt` decides server order — `serverSeq` does.

### 2.3 Field-level change clock — PROPOSED DESIGN, tasks only

For the task record, and **only** for the task record, the envelope extends to:

```
fieldClock    object    { text?: number, done?: number, dueDate?: number, ... }  epoch ms per field
```

Rationale: the brief's approved task behaviour requires merging independent field changes and detecting genuine same-field conflicts. A single record-level stamp cannot distinguish "A changed the title" from "A changed the title and B changed the due date". Every other record type is merged by whole-record rules, so a field clock there would be unused weight.

**RISK.** `fieldClock` records when a field was written, which is behavioural metadata about the user's typing rhythm. It is **not** analytics data, it never leaves the account boundary, and it must not be included in any analytics event or log line. It is persisted only for **S** records.

### 2.4 Validation rules — PROPOSED DESIGN

A repository write rejects (and reports, rather than silently repairs) when:

| Condition | Result |
|---|---|
| `id` is missing, empty or not a string | Reject; caller must mint one |
| `updatedAt` is not a finite positive number | Reject |
| `updatedAt` is earlier than the stored `updatedAt` **and** `rev` did not increase | Reject as a stale write |
| `deletedAt` is set but `updatedAt` is absent | Reject |
| A field outside the entity's allowlist is present on a **syncable** record | Strip from the sync projection; keep locally only if it is a declared local field |
| A binary-shaped value (Blob, ArrayBuffer, base64 data URL) appears on a syncable field | Reject at the projection boundary (`SYNC_AND_DATA_STRATEGY.md` §8.1) |
| `schemaVersion` of the payload is unknown | Reject the whole batch; the client keeps its records |

Read-time normalisation stays as a *repair* path for legacy data, and is specified in `MIGRATION_SPECIFICATION.md`. The contract's job is to stop new bad writes; normalisation's job is to survive old ones.

---

## 3. Tasks

**Status: S** (every field of `normalizeTask` — user-typed text included, because that is the service the user asked for).

### 3.1 Fields

| Field | Type | Change tracking | Conflict behaviour |
|---|---|---|---|
| `id` | string | never changes | identity |
| `text` | string | `fieldClock.text` | same-field conflict → **user resolution**, both copies kept |
| `done` | boolean | `fieldClock.done` | completed wins over open |
| `doneAt` | epoch ms \| null | follows `done` | later `doneAt` among two completions |
| `p` | `'low'\|'mid'\|'high'` | `fieldClock.p` | same-field conflict → user resolution |
| `cat` | category key | `fieldClock.cat` | same-field conflict → user resolution |
| `dueDate` | `'YYYY-MM-DD'` \| null | `fieldClock.dueDate` | same-field conflict → user resolution |
| `durationMin` | 1..480 \| null | `fieldClock.durationMin` | same-field conflict → user resolution |
| `timeFrom`, `timeTo` | minutes \| null, paired | `fieldClock.timeFrom`/`timeTo` | treated as one field: an invalid pair becomes `null` |
| `created` | epoch ms | never changes | earliest known wins |
| `notify` | boolean | `fieldClock.notify` | latest field write wins (a reminder switch is not worth a dialog) |
| `notifiedStatus` | enum | device-local behaviour | **must not be treated as user content**; see §3.3 |
| `updatedAt`, `rev`, `deletedAt`, `originDevice` | envelope | — | envelope rules |
| `order` | number | on reorder | ordering key, see §3.4 |

### 3.2 Deletion — APPROVED BEHAVIOUR, PROPOSED SHAPE

The user-visible behaviour stays exactly as it is: the row animates out and the undo notice offers it back for five seconds. The storage change is that the record becomes a tombstone:

```
deletedAt = now, updatedAt = now, rev += 1, payload fields cleared after retention
```

Undo clears `deletedAt` and raises `rev` again. Undo therefore works across a reload if the tombstone is persisted — a strict improvement on today's memory-only queue, and the reason tombstones come **before** Sync rather than with it.

### 3.3 `notifiedStatus` is not user content

**PROPOSED DESIGN.** `notifiedStatus` exists to stop the app nagging twice about the same task on the same device. If it synchronised, device B would either suppress a reminder it never showed or repeat one device A already showed. It is therefore **D** (device-local) even though it lives inside an **S** record. The projection drops it; the local record keeps it.

This is the first concrete case of a rule the classification module must encode: *a field's status is independent of its record's status.* `DATA_SCHEMA_REGISTRY.md` §6 lists the field-level exceptions.

### 3.4 Ordering

**CURRENT STATE.** Task order is array position. There is no ordering field.

**PROPOSED DESIGN.** An explicit `order` number, dense within the user's list, rewritten in a bounded range on reorder (the existing `reorderSubset` helper already computes a reordered subset and never loses hidden items). Array position remains the render order; `order` becomes the persisted truth so that two devices cannot silently disagree about position. Ordering conflicts are cosmetic and resolve by `updatedAt` of the moved record, then by `id` for determinism.

**RISK.** Introducing `order` changes the meaning of the stored array. A migration must assign `order` from current index, and a backup restored from an older file must be assigned values on read. The migration is specified as M-002.

---

## 4. Reading progress

**Status: S** for the nine allowlisted book fields (`SYNC_AND_DATA_STRATEGY.md` §5.3).

The brief's approved behaviour is narrow and deliberate; it is also the one place where this contract **differs from the existing manual-backup merger**:

| Question | Approved contract rule | What the backup merger does today |
|---|---|---|
| Which position is authoritative? | **The latest valid position**, ordered by operation order (`serverSeq`, then `rev`, then `updatedAt`) | Furthest page reached (`Math.max(lastPage)`) |
| Can a position move backwards? | Yes, if the user went back and the later operation says so | No |
| Are page reads (`completedPages`) a fact? | Yes — union, never removed | Union |
| Are per-day counters (`stats`) a fact? | Yes — per day, per counter, the higher value stands | Higher value |
| Does the page count (`numPages`) ever shrink? | No — the highest known page count wins | Highest |

**APPROVED DECISION.** "The latest valid reading position is authoritative. Do not automatically select the highest page number."

**OPEN QUESTION PQ-01.** The manual-backup merger's furthest-page rule is existing, tested behaviour and this phase must not weaken the backup path. The contract therefore *documents* the divergence rather than silently changing `js/backup.js`. Aligning the backup merger with the latest-valid rule is a product decision, not an implementation detail: it changes what a hand-carried merge does to a reader's place in a book.

### 4.1 "Valid position"

A position is valid when:

- `1 ≤ page ≤ numPages` (or `numPages === 0`, meaning the document has not been rendered yet — then the position is stored but treated as provisional);
- it was produced by a real navigation or a mark-read action, not by a restore;
- its ordering key is complete (`rev` present, `updatedAt` finite).

An invalid position is kept as history in the conflict record and **not** applied, rather than being clamped silently into a plausible-looking page.

---

## 5. Focus history

**Status: ? (OD-05).** Not synchronised, not migrated, not queued. This section therefore defines the *shape the contract requires if OD-05 is approved*, and makes no activation claim.

| Approved requirement (brief §6 Stage 1.2) | Contract consequence |
|---|---|
| Preserve the complete valid account archive | The `100` cap is a **local retention policy**, not a schema property. The record itself has no cap |
| Do not make the existing 100-record limit an account retention limit | Retention becomes an explicit, versioned policy value (`retentionLocal`, `retentionAccount`) once OD-05 is answered |
| Pagination is a UI concern | The store returns records; views page them. No limit argument in the read API |
| Active and temporary focus sessions remain local | `daftarche-focus-session` is **D**; only finished records are candidates for **S** after OD-05 |
| Repeated synchronisation must not create duplicates | Identity is `id`; a session is immutable once finished, so a merge is a union by id |

**RISK.** `mergeHistory` trims to 100 *after* merging. If history ever synchronises under the current code, a pull that brings 30 sessions would delete 30 existing ones locally. The contract forbids enabling any history sync until retention is decided **and** the trim is separated from the merge.

---

## 6. Ledger

**Status: S.** Monotonic floors only.

### 6.1 Source of truth per metric

The ledger must not become a second source of truth. Each number has exactly one owner; the ledger holds a floor under it.

| Metric | Source of truth | How the ledger is raised | Double-count hazard |
|---|---|---|---|
| `done` | Task records with `doneAt` on that day | `rememberDone` counts live tasks after the change, then raises the floor | Counting deltas would double-count tick → untick → tick; counting the live number cannot |
| `focusMin`, `sessions` | Finished focus-history records for that day | `rememberFocus` sums the archive, then raises the floor | Summing ledger days on top of history would double the total |
| Read minutes, pages | Book `stats[day]` | Not stored in the ledger at all (`ledger.js` comment) | None — the book is the only copy |
| Notes/marks | Book `highlights[]` + `notes[]` `createdAt` | Not stored in the ledger | None |
| Mood | `daftarche-moods[day]` | Not stored in the ledger | None |
| Opened | `daftarche-history` | Not stored in the ledger | None |

**PROPOSED DESIGN.** The rule survives the repository unchanged: `raiseFloor(day, patch)` keeps the higher value and can never lower one. It is the same function, moved behind the boundary.

### 6.2 Merge rule

Per day, per counter: `max(local, incoming)`. Never sum two ledgers. A ledger arriving with an unknown `v` is kept as-is locally and not merged — the safe direction, because a floor that is too low only under-reports while a merged floor that is too high can never be corrected.

---

## 7. Books — seven separate things

**APPROVED DECISION.** Sync covers book metadata and reading progress only; files, highlights, notes, covers and music never enter the pipeline. The contract therefore **splits one stored record into seven entities** with different statuses.

| Entity | Status | Identity | Where it lives | May change? |
|---|---|---|---|---|
| Book metadata (`id`, `title`, `addedAt`, `numPages`, `goal`) | **S** | book `id` | `daftarche-books-meta` | Yes |
| Reading progress (`lastPage`, `lastReadAt`) | **S** | book `id` | same record | Yes, ordered as §4 |
| Reading statistics (`stats`, `completedPages`) | **S** | book `id` + day | same record | Yes, monotonic |
| PDF file | **X** | book `id` | IndexedDB `daftarche-books` | Replaced only by an explicit import |
| Highlights | **D** | highlight `id` | inside the metadata record | Yes, locally |
| PDF notes | **D** | note `id` | inside the metadata record | Yes, locally |
| Cover image | **X** | book `id` | inside the metadata record (data URL) | Yes, locally |

**Consequence for the contract.** The *stored* record still contains all seven, because they share one key today. The *projected* record carries only the nine allowlisted fields. The projection is a positive allowlist, so a new book field cannot leak into Sync by being added to the record.

### 7.1 A book without its file

**APPROVED BEHAVIOUR.** A book record may exist on a device that has never held the PDF. That state is normal.

```
{ id, title, numPages, lastPage, ... }  present
blob for id in daftarche-books          absent
```

Required contract behaviour:

1. the metadata is valid and must be kept;
2. its absence is **not** a deletion signal and must never create a tombstone;
3. the UI distinguishes "needs the file on this device" from "deleted";
4. importing a matching file attaches it to the existing record rather than minting a new one — the attachment identity question is **OD-17** and remains open.

---

## 8. Preferences

**Status: P** for every preference; **?** where a specific decision is named; **D** where the setting describes hardware or instalment.

| Preference | Key | Class | Reason |
|---|---|---|---|
| Theme, theme modes, theme-auto | `theme`, `daftarche-theme-modes`, `daftarche-theme-auto` | **P** (OD-06) | Cosmetic; conflict is not worth a dialog |
| Text size, reduced motion | `daftarche-text-size`, `daftarche-motion` | **P** (OD-06) | Device ergonomics, plausibly per device |
| Stats range, card style | `daftarche-stats-range`, `daftarche-card-style` | **P** (OD-06) | View state |
| Language | `daftarche-lang` | **P** (OD-06) | Follows the person more than the device |
| Display name, companion | `daftarche-name`, `daftarche-avatar` | **P** (OD-06) | Identity-adjacent |
| Pomodoro length, weekly goal, streak freeze | `daftarche-pomo`, `daftarche-week-goal`, `daftarche-streak-freeze` | **P** (OD-06) | Settings with an economy attached; not activity facts |
| Profile photo | `daftarche-photo` | **?** (OD-10) | A data URL image, not a record |
| Volumes, ambience, scene, music selection, pen width | `daftarche-vol-*`, `daftarche-ambsound`, `daftarche-scene`, `daftarche-music`, `daftarche-pen-width` | **D** | Hardware and habit |
| Tour, first-seen, seen-version, iOS guide, frog dismissal | as inventoried | **D** | Would suppress onboarding on another device |
| Backup stamps | `daftarche-backup-at`, `daftarche-backup-nudge` | **D** | Per-device bookkeeping |
| Live focus session | `daftarche-focus-session` | **D** | Would start a timer on a device nobody is using |

**PROPOSED DESIGN.** The classification is data, not prose: one module (`js/dataclassification.js`) exports the status of every key and field, and every other consumer reads it. `P` and `?` are **inactive**: no projection, no snapshot, no outbox entry, no conflict rule.

---

## 9. Workspace ownership

### 9.1 Two identities

| Identity | Scope | Created | Stored | Used for |
|---|---|---|---|---|
| `installationId` | this installation | first run, random | `daftarche-installation` (**D**) | outbox idempotency, conflict origin labels, analytics rotation if ever enabled |
| `userId` | the account | server | session store (Phase 2) | ownership and authorization — **server-derived only** |
| `workspaceId` (local derivation) | the records in this browser | derived per boot | in memory | scoping local stores so two accounts on one device cannot mix |

```
workspaceId = 'guest:' + installationId
            | 'account:' + userId          // userId is opaque and server-supplied
```

### 9.2 Rules

1. **PROPOSED DESIGN.** Records gain a local `workspace` stamp in the store key space, not in the record payload. Two accounts on one installation therefore cannot read each other's tasks even if a session bug occurs.
2. **APPROVED DECISION.** A `workspaceId` is never sent as proof of anything. Every server route derives the account from the session.
3. Signing out keeps the local workspace (default) and does not delete it; removing the device copy is a separate, explicit action.
4. A guest workspace is complete on its own. No guest mutation may create remote work, and no guest read may require a network call.
5. Guest-to-account migration copies the guest workspace into the account workspace **without deleting the original** until the server acknowledges the final page (`SYNC_AND_DATA_STRATEGY.md` §7.2).

### 9.3 Why the workspace is in the key space, not the record

**PROPOSED DESIGN.** Putting `workspace` inside every record would change every record shape and every backup file for a scoping concern. Keeping it in the key namespace means:

- existing keys keep working for the single-workspace case (the guest prefix is the default);
- the first account sign-in on a device performs the one migration from unprefixed keys into the account namespace;
- a JSON backup remains a single-workspace document, which matches what a user expects a backup to be.

**RISK.** Namespaced keys change `isBackupKey` semantics: `daftarche-account:<id>:v1` still starts with `daftarche-`, so it would be picked up by the backup collector. `BACKUP_COMPATIBILITY.md` §5 therefore requires the collector to work from an explicit key registry rather than a prefix test before any namespace is introduced.

---

## 10. What this contract deliberately does not do

| Not done | Why |
|---|---|
| Define server tables, endpoints or payload bytes | Phase 2 (`TARGET_ARCHITECTURE.md` §2.3); this phase stops at the client boundary |
| Decide OD-05, OD-06, OD-08, OD-10, OD-17, OD-18 | Owner decisions; the contract keeps them inactive |
| Change the backup merge rules | The backup is a separate mechanism with working, tested behaviour |
| Introduce a CRDT library | The product's semantics are monotonic facts plus explicit user resolution, not arbitrary convergence |
| Replace localStorage with IndexedDB | A storage migration is not needed to obtain a contract; the adapter boundary makes it possible later without touching domain code |
| Add a database dependency | The project has no runtime dependencies and this phase adds none |
