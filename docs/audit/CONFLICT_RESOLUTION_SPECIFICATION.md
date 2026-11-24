# Phase 1 — Conflict Resolution Specification

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.2
**Document status:** proposed specification. **Nothing here is implemented.**
**Date:** 19 November 2026

**APPROVED DECISION (brief §6 Stage 1.2, tasks).** Independent field changes must be merged. Genuine same-field conflicts must be detected and presented for user resolution. A user's change is never silently discarded. Device timestamps are never the sole basis for a decision.

**APPROVED DECISION (reading progress).** The latest valid reading position is authoritative. The highest page number is never selected automatically.

Everything else in this document is **PROPOSED DESIGN**: the mechanism by which those two approved behaviours are achieved.

---

## 1. Vocabulary

| Term | Meaning here |
|---|---|
| **Operation** | One local mutation of one record, identified by `opId` |
| **Ordering key** | `serverSeq` when present, else `rev`, else `updatedAt`, else `id` — first difference decides |
| **Field conflict** | Two operations changed the *same field* of the same record, with neither causally after the other |
| **Genuine conflict** | A field conflict whose losing value cannot be preserved by a domain rule |
| **Merged silently** | Both intents survive; nothing is asked |
| **Surfaced** | The user is shown the conflict and chooses; both values are preserved until then |
| **Dropped** | Forbidden. No path in this specification drops a user value |

---

## 2. Detection

### 2.1 What a comparison sees — PROPOSED DESIGN

```
local       = record as stored on this device
incoming    = record arriving from elsewhere
base        = the last common state, when available (server copy at last pull)
```

Three cases:

| Condition | Result |
|---|---|
| `incoming.rev > local.rev` and `incoming.updatedAt ≥ local.updatedAt` | Incoming is strictly newer → apply, no conflict |
| `local.rev > incoming.rev` and `local.updatedAt ≥ incoming.updatedAt` | Local is strictly newer → keep, no conflict |
| Both changed since `base`, or the ordering keys disagree | Compare **field by field** |

### 2.2 Field-level comparison for tasks

A field is in conflict when **all** of these hold:

1. `local[field] !== base[field]` and `incoming[field] !== base[field]`;
2. `local[field] !== incoming[field]`;
3. neither side's `fieldClock[field]` is strictly later than the other's **and** that later side also has the higher `rev`.

Otherwise the field is resolved by the later `fieldClock` and the decision is **merged silently**, because only one side touched it.

**CURRENT STATE.** Without `base` this is impossible; that is why `js/backup.js` documents "two open copies have no edit stamp to compare, so the one already here stays". The specification therefore requires either a stored `base` per record or the field clock. The field clock is chosen because it survives the absence of a base and costs one small object per task.

### 2.3 Two devices, one clock

A device with a badly wrong clock must not win by accident. The ordering rule therefore never trusts a single number:

```
compare(a, b):
  if a.serverSeq and b.serverSeq differ → higher serverSeq wins
  else if a.rev != b.rev               → higher rev wins
  else if a.updatedAt != b.updatedAt   → later updatedAt wins
  else if a.id != b.id                 → lexical id wins (deterministic, not semantic)
```

Two consequences:

- A clock set to 2099 cannot outrank a genuinely later edit that carries a higher `rev`.
- When everything ties, the tie-break is arbitrary but **deterministic**, so two devices converge on the same answer without coordinating.

---

## 3. Rules per entity

### 3.1 Tasks — S

| Field group | Rule | Type |
|---|---|---|
| `text` | Same-field edit on both sides → **surfaced**. Winner shown, loser kept in the conflict record, one tap to take the other | Surfaced |
| `done` + `doneAt` | Completion is a fact. `done: true` wins over `done: false` regardless of order. Two completions → later `doneAt` wins | Merged silently |
| `p`, `cat`, `dueDate`, `durationMin`, `timeFrom`/`timeTo` | Independent changes merge. Same-field changes → **surfaced** | Surfaced |
| `notify` | Later field write wins | Merged silently |
| `notifiedStatus` | Never compared; device-local | Not part of the merge |
| `created` | Earliest valid value wins | Merged silently |
| `order` | Later `updatedAt` of the moved record wins; tie → higher `rev`; tie → `id` | Merged silently |
| `deletedAt` | A tombstone from a strictly later operation wins. A tombstone and a live edit that are not causally ordered → **surfaced** as "this task was deleted on one device and edited on another" | Surfaced |

**Why `done` beats an edit.** A tick is the user's record of having done something. Undoing it because a title was edited elsewhere would erase a fact. The specification keeps the completion and merges the title as a separate field — which is exactly what field-level merging makes possible.

**Why a delete-vs-edit conflict is surfaced.** Silently resurrecting a task contradicts a delete; silently deleting it contradicts an edit. Neither is acceptable, and the brief forbids silently discarding user changes.

### 3.2 Reading progress — S

| Situation | Rule |
|---|---|
| Two positions, one strictly later in operation order | Later valid position wins, even if its page number is lower |
| Two positions with equal order keys | Higher `rev`, then the *earlier* position is kept and the later one recorded as a conflict? **No** — see below |
| A position outside `1..numPages` | Not applied; recorded in the conflict record as rejected with a reason |
| `completedPages` | Union. A page once read stays read |
| `stats[day]` | Per day, per counter, the higher value |
| `numPages` | Highest known wins (a document cannot lose pages) |
| `lastReadAt` | Later valid value wins |

**Tie rule.** When two positions have the same `rev` and `updatedAt` — which requires an identical clock reading and identical revision — the position belonging to the device with the lexically smaller `originDevice` wins for determinism. This is not a semantic choice; it exists so the two devices agree. No conflict is surfaced, because a page position is not worth interrupting a reader over, and both positions remain in the conflict log for inspection.

**Why not "furthest page".** A reader who finished a book and then re-opened page 12 is on page 12. Furthest-page logic would drag them back to the end every time they revisit a chapter. That is the reason the approved decision names this case explicitly.

**OPEN QUESTION PQ-01** (repeated from `DATA_CONTRACT.md` §4): the existing manual-backup merger uses furthest-page. That path is not changed in this phase.

### 3.3 Focus history — ? (OD-05)

Not synchronised, therefore not merged. The rule below is written down only so it is not invented later under pressure:

- a finished session is immutable; identity is `id`;
- a merge is a union by `id`, newest first;
- the local 100-record trim must be applied **after** the union and must be a declared retention policy, not a silent side effect.

### 3.4 Ledger — S

| Field | Rule |
|---|---|
| `done`, `focusMin`, `sessions` per day | `max(local, incoming)`. Never sum |
| `seededAt` | Earliest valid day key |
| Unknown `v` | Not merged; local value kept and the incoming ledger quarantined in the conflict record |

### 3.5 Achievements — S

| Field | Rule |
|---|---|
| `unlocked[id].tier` | Higher tier |
| `unlocked[id].at` | Equal tiers: the copy that knows the day wins; if both know, the earlier day (it is when the tier was first reached) |
| `baselineAt` | Earliest valid day |
| `recSeen[key]` | Later day (suppresses more, which is the safe direction for a dedupe mark) |

### 3.6 Moods — S

One choice per day. Local stands; incoming fills days that have no mood. Two different moods for the same day is **not** a conflict worth surfacing: the last writer's mood is what the reader meant, and the day's mood is not a fact that can be reconstructed.

### 3.7 Day-open history — S

Set union of valid day keys. A day opened on any device was opened.

### 3.8 Books — S for the nine allowlisted fields

| Field | Rule |
|---|---|
| `title` | A chosen title stays unless this device never chose one. Two different renames after the last common state → **surfaced** (it is user-typed text) |
| `goal` | Same as `title`. `goal.text` is user-typed, so a genuine conflict is surfaced |
| `addedAt` | Earliest valid value |
| `numPages` | Highest |
| `stats`, `completedPages` | Monotonic |
| `lastPage`, `lastReadAt` | Latest valid, per §3.2 |
| `highlights`, `notes`, `cover` | **Not merged by Sync.** Device-local by decision. Only the manual backup merger touches them, and it keeps its existing union-by-id rule |

### 3.9 Preferences — P

Inactive. No conflict rule may run for a **P** field until OD-06 is answered. If OD-06 later approves preference sync, the proposed rule is last-writer-wins by `updatedAt`, with no user prompt: a theme disagreement is cosmetic.

---

## 4. The conflict record

**PROPOSED DESIGN.** A conflict is data, not a log line. It is stored where it can survive a restart and be shown later.

```
conflict = {
  conflictId   string    deterministic: `${kind}:${recordId}:${field}:${hash(loser)}`
  kind         'task' | 'book' | 'book-title' | 'book-goal' | 'task-delete-edit'
  recordId     string
  field        string | null
  winner       any       applied value
  loser        any       preserved value, never applied
  winnerOrigin string    device label or 'this device'
  loserOrigin  string
  detectedAt   number
  resolvedAt   number | null
  resolution   'kept-winner' | 'took-loser' | 'kept-both' | null
}
```

Rules:

1. `conflictId` is deterministic so a repeated sync cannot create duplicates of the same conflict.
2. The loser is stored **verbatim**, including its type. A `null` due date is a real value and must not be confused with "no loser".
3. A resolved conflict is removed after the user has seen the outcome, or after a retention window (proposal: 30 days), whichever is later. It is never removed by a subsequent merge.
4. A conflict never blocks the rest of the batch. The record is applied with the winner, marked "1 disagreement to review", and the queue continues.
5. Conflicts are **device-local** in Phase 1 (there is no server). If two devices both detect the same conflict, each shows its own copy; the ids match, so a later Phase 2 could deduplicate them without redesign.

---

## 5. Surfacing to the user

| Rule | Detail |
|---|---|
| Where | The record itself (task row, shelf card) carries a marker; the detail is in one place, not a modal on every sync |
| Wording | Names what happened and what is currently shown, e.g. «این کار در دو جا ویرایش شد؛ متنِ فعلی از این دستگاه است» |
| Actions | "Keep this", "Take the other", and for text "Keep both" (creates a second task with the loser's text) |
| Never | A dialog that appears while the user is typing; a destructive action by default; a silent overwrite |
| Guest | A guest never sees a sync conflict, because a guest never syncs. A **restore** conflict (backup merge) is a different, already-implemented path with its own notice |

**RISK.** The most likely implementation failure is a conflict UI that appears during onboarding or a restore, when the user has no context. The specification requires conflicts to be surfaced only on the record, never as an app-level interruption.

---

## 6. Worked examples

### E-1 — Independent edits merge

```
base:     { text: "خرید نان",  dueDate: "2026-11-20", p: "mid" }
device A: { text: "خرید نان و شیر", dueDate: "2026-11-20", p: "mid", rev: 4, fieldClock: { text: 1000 } }
device B: { text: "خرید نان",  dueDate: "2026-11-21", p: "mid", rev: 4, fieldClock: { dueDate: 1200 } }
result:   { text: "خرید نان و شیر", dueDate: "2026-11-21", p: "mid", rev: 5 }
```
Both intents survive. Nothing is asked.

### E-2 — Same-field conflict is surfaced

```
base:     { text: "خرید نان" }
device A: { text: "خرید نان سنگک", rev: 4, updatedAt: 1000, fieldClock: { text: 1000 } }
device B: { text: "خرید نان بربری", rev: 4, updatedAt: 1010, fieldClock: { text: 1010 } }
applied:  B's text (later field clock), rev 5
conflict: { kind: 'task', field: 'text', winner: 'خرید نان بربری', loser: 'خرید نان سنگک' }
user may: keep winner · take loser · keep both as two tasks
```

### E-3 — Completion beats an edit

```
base:     { text: "گزارش", done: false }
device A: { done: true, doneAt: 500, rev: 4 }
device B: { text: "گزارش نهایی", done: false, rev: 4 }
result:   { text: "گزارش نهایی", done: true, doneAt: 500, rev: 5 }
```
The tick is a fact; the title is a field. Both survive.

### E-4 — Delete versus edit is surfaced

```
device A: { deletedAt: 900, rev: 5 }
device B: { text: "نسخهٔ دوم", rev: 5 }
```
Ordering keys tie, so neither is causally later. The record is kept live with B's text, a `task-delete-edit` conflict is recorded, and the user chooses: delete it, or keep it. A silent choice either way would contradict one of the two actions.

### E-5 — Reading position moves backwards

```
device A: lastPage 240, rev 8, updatedAt 1000   (reader finished the book)
device B: lastPage 12,  rev 9, updatedAt 2000   (reader opened a chapter)
result:   lastPage 12
```
Approved behaviour: latest valid position. The furthest-page rule is not applied here.

### E-6 — A clock that is wrong

```
device A: rev 3, updatedAt 4102444800000  (clock set to 2100)
device B: rev 4, updatedAt 1795000000000  (correct clock)
result:   B wins — higher rev outranks a later timestamp
```

---

## 7. What must never happen

| Forbidden | Why |
|---|---|
| A user's text disappearing because the other device wrote later | The brief forbids silent discard |
| A completion reverting to open after a merge | A fact cannot be undone by a merge |
| A ledger day decreasing | Floors are monotonic |
| `completedPages` losing a page | A page read is a fact |
| A reading position jumping to the furthest page | Approved behaviour says latest valid |
| A conflict resolved by device clock alone when revisions disagree | Clocks are not trustworthy |
| A conflict shown as a blocking modal during boot, onboarding or restore | No context, and it trains users to dismiss |
| A conflict record created for a field classified **D**/**X** | Those fields never merge |
| A conflict record containing a PDF blob, annotation body or music | Binary and annotation content never enters the sync path |

---

## 8. Test obligations for this specification

Specified, not executed. Full matrix in `PHASE_1_VALIDATION_PLAN.md` §5.

| # | Test | Asserts |
|---|---|---|
| CR-1 | E-1 as a fixture | Both fields merged, no conflict |
| CR-2 | E-2 as a fixture | Winner applied, loser preserved verbatim |
| CR-3 | E-3 as a fixture | Completion retained, title merged |
| CR-4 | E-4 as a fixture | Conflict surfaced, nothing applied silently |
| CR-5 | E-5 as a fixture | Lower page wins on later operation |
| CR-6 | E-6 as a fixture | `rev` outranks a skewed clock |
| CR-7 | Identical records | No conflict, ids stable, `rev` unchanged |
| CR-8 | Repeated merge of the same pair | Same result, one conflict record, no duplicate |
| CR-9 | Deleted record merged twice | One tombstone, no resurrection |
| CR-10 | Ledger merge | Max per field, never a sum |
| CR-11 | Achievements merge | Higher tier, earlier `baselineAt`, later `recSeen` |
| CR-12 | Book merge | Annotations not touched by the sync path |
| CR-13 | Conflict record shape | Deterministic id, loser type preserved (including `null`) |
