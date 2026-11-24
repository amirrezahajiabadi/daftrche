# Phase 1 — Outbox Design

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.5
**Document status:** proposed design. **No outbox exists and none is implemented.**
**Date:** 19 November 2026

The outbox is the durable record of "local changes that an account still owes the server". In Phase 1 it is **built as an inert boundary**: the code path exists, the guard rejects everything a guest produces, and no network call is ever made.

**APPROVED DECISION.** Sync is free for every registered account. No guest mutation may create remote work.

---

## 1. Where it lives, and why not in `localStorage`

| Option | Verdict | Reasoning |
|---|---|---|
| A `daftarche-*` key in `localStorage` | Rejected | Each entry would be rewritten on every mutation of a whole JSON document; the 5 MB origin quota is already the app's tightest constraint; and a queue in the same store as the records cannot be recovered independently |
| IndexedDB `daftarche-sync` v1 | **Chosen** | Transactional per entry, survives restarts, does not compete with record writes, and is already the project's binary-grade store |
| In memory | Rejected | Loses queued work on a reload, which is the exact failure the outbox exists to prevent |

**RISK.** Android WebView storage eviction could remove IndexedDB. Mitigation: the queue is a *log of intent*, not the data; losing it means "sync will re-derive what changed from `rev`", not "data is lost". This must be tested before Phase 2 relies on it.

---

## 2. Schema — PROPOSED DESIGN

```
Database: daftarche-sync   version 1   (created lazily, never for a guest)

outbox    keyPath 'opId'
  opId        string   `${kind}:${id}:${rev}`
  seq         number   monotonic per installation (meta.nextSeq++)
  kind        'task'|'book'|'activity'|'achievement'
  id          string   record id (day key for day-scoped activity)
  rev         number   local revision at enqueue
  fields      string[] field names touched (tasks only; empty otherwise)
  op          'upsert'|'delete'
  createdAt   number
  attempts    number
  nextAttemptAt number
  status      'pending'|'sending'|'failed'|'dead'
  lastError   string|null   a code, never a payload

meta      keyPath 'k'
  { k: 'nextSeq', v: number }
  { k: 'cursor',  v: number }            // serverSeq for pull (Phase 2)
  { k: 'suspended', v: boolean }         // per-device sync pause (D)

conflicts keyPath 'conflictId'
  (shape in CONFLICT_RESOLUTION_SPECIFICATION.md §4)
```

### 2.1 `fields` instead of a payload

The entry names the record and the fields that changed. The payload is read from the repository at send time.

| Benefit | Consequence |
|---|---|
| The queue cannot become a second copy of the notebook | A queued op for a record that changed again is superseded by the newer `rev` |
| No binary or annotation content can be smuggled into the queue | The projection at send time is the single place where exclusion is enforced |
| Small entries, cheap rewrites | A deleted record's payload is not in the queue, so a send after deletion reads the tombstone |

**RISK.** If the record is deleted *and* the outbox entry is lost, the server never learns about the deletion. Mitigation: the tombstone itself is the durable record of the deletion, and a full reconciliation (compare all local `rev`s to server `rev`s) recovers a lost queue. That reconciliation is Phase 2 work and is named here so the queue is not treated as the only source of truth.

---

## 3. Lifecycle

```
mutation
  └─ repository → outbox.enqueue({kind, id, rev, fields, op})
        ├─ guard: classification says S?            no → drop silently (by design)
        ├─ guard: a session exists?                 no → drop silently (guest)
        ├─ guard: serialised projection ≤ 64 KB?    no → mark 'dead' with code PAYLOAD_TOO_LARGE
        └─ store entry (status 'pending')

flush (Phase 2 only)
  └─ pick entries where status = 'pending' and nextAttemptAt ≤ now, ordered by seq
        ├─ send batch
        ├─ 2xx → delete entry
        ├─ 409 → conflict path, entry resolved or kept with a reason
        ├─ 401 → session becomes signed-in-offline; entries keep status 'pending'
        ├─ 429/5xx → attempts++, exponential backoff with jitter, cap
        └─ other 4xx → status 'dead', code recorded, local record kept
```

### 3.1 Coalescing

When an entry already exists for the same `kind:id`, it is **replaced** by the newer one (new `opId` carrying the new `rev`), keeping the original `seq`. A queue therefore holds at most one pending operation per record, and the number of entries is bounded by the number of changed records rather than by the number of edits.

**RISK.** Coalescing a delete behind an upsert is correct; coalescing an upsert behind a delete must not lose the delete. Rule: `op: 'delete'` always supersedes `op: 'upsert'` for the same record, and the reverse requires an explicit undo (which is a `restore` operation with its own `rev`).

### 3.2 Retry policy

| Condition | Behaviour |
|---|---|
| Network failure | `attempts++`, backoff `min(2^attempts · 1s, 5 min)` with jitter |
| `429` | Honour `Retry-After` when present; otherwise backoff |
| `5xx` | Backoff, up to 8 attempts, then `failed` (retried on next foreground) |
| `401` / `403` | No retry; session degrades to offline; user is asked to sign in **without blocking local use** |
| `409` | Not an error: merge and resolve, then the entry is removed or re-queued with the resolved `rev` |
| `4xx` other | `dead`, code stored, record kept locally and marked "not synced" |
| Entry older than 30 days | Kept, not silently dropped; the settings line reports it |

---

## 4. Guarding at enqueue

The guard is the only place where the approved scope is enforced for outgoing data.

| Check | Source of truth | Failure |
|---|---|---|
| Kind is `S` | `js/dataclassification.js` | Drop, no error |
| Record is projected by allowlist | classification | Unclassified fields are not in the projection |
| No binary | projection is plain JSON; a `Blob`/`ArrayBuffer`/data-URL string is rejected | `dead` with code |
| Size ≤ 64 KB | serialised projection | `dead` with code |
| Session exists | `sessionStore.exists()` | Drop, no error |

**APPROVED DECISION.** The backend never receives a PDF file, a PDF highlight or note, a book cover or a music track. The guard is the third of the three required boundaries (projection, migration snapshot, outbox), and all three are required (`SYNC_AND_DATA_STRATEGY.md` §5.3 rule 5).

---

## 5. Ordering

| Property | Decision |
|---|---|
| Queue order | `seq`, monotonic per installation, assigned at enqueue |
| Batch composition | Consecutive pending entries, up to a count and size limit |
| Per-record order | Guaranteed by coalescing: one entry per record |
| Cross-record order | Not semantically required; the server applies per-record |
| Pull order | `serverSeq`, strictly increasing, cursor advanced only after apply |
| Clock use | None for ordering |

**RISK.** Coalescing per record means "edit A then edit B on the same record" is sent once, with the later state. That is correct for a per-record model and wrong for an audit log. The product needs no audit log, and creating one would retain user text indefinitely.

---

## 6. Idempotency

```
opId = `${kind}:${id}:${rev}`
```

- Deterministic, so a retried request with the same operation is recognisable.
- The server must treat a repeated `opId` as a no-op returning the stored outcome.
- A new mutation produces a new `rev`, hence a new `opId`: a retried old operation can never be mistaken for the new one.

**RISK.** Two installations can produce the same `id` with different `rev`s only if they share ids, which they do not. The installation id is therefore part of the identity chain even though it is not part of `opId`; the server keys operations by account + `opId`, which is sufficient because record ids are unique within an account.

---

## 7. Failure surfaces

| Situation | Stored state | What the user sees (Phase 2) |
|---|---|---|
| Offline for a week | Entries pending | "N changes waiting to sync" |
| One record rejected permanently | `dead` | That record marked "not synced"; the rest continue |
| Queue corrupted | Database open fails | "Sync is paused; your data is on this device" — never a data-loss claim |
| Quota during enqueue | Write fails | Local write succeeded, sync entry lost; a reconciliation on next foreground recovers it |
| Suspended on this device | `suspended: true` | "Sync paused on this device"; nothing deleted |

---

## 8. What the outbox is not

- Not a second database of records.
- Not an audit log.
- Not a place for preferences (none is **S**).
- Not a place for annotations, covers, PDFs or music.
- Not a task queue for background work while the app is closed. No daemon is promised; flush happens on foreground, on reconnect, or debounced after a mutation.
- Not created for a guest.

---

## 9. Test obligations

| # | Test | Asserts |
|---|---|---|
| OB-1 | Guest mutation sweep | No database created; no entry; no `fetch` |
| OB-2 | Signed-in enqueue | One entry per record; `opId` deterministic |
| OB-3 | Coalescing | Ten edits → one entry at the latest `rev` |
| OB-4 | Delete after edit | One delete entry |
| OB-5 | Undo after delete | A restore entry with a higher `rev` |
| OB-6 | Guard: annotation | Enqueue containing `highlights` is refused |
| OB-7 | Guard: data URL | Refused with a code |
| OB-8 | Guard: oversize | Refused with a code |
| OB-9 | Backoff | Attempt times follow the formula, bounded |
| OB-10 | 401 handling | Entries retained; local use unaffected |
| OB-11 | 409 | Entry resolved or kept, never dropped |
| OB-12 | Restart | Queue survives a reload |
| OB-13 | Cursor | Advanced only after a successful apply |
| OB-14 | Suspension | Nothing pushed while suspended; nothing deleted |

Every test above is **specified, not executed**.

---

## 10. Phase 1 delivery

Phase 1 delivers the queue's storage adapter, the guard, the enqueue path and the tests — but nothing calls `flush`, because nothing creates a session. The value of building it now is that the repository is written against a real boundary instead of a comment, so Phase 2 does not have to reopen every write path.
