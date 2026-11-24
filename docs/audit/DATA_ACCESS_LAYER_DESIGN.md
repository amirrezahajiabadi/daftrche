# Phase 1 — Data Access Layer Design

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.4
**Document status:** proposed design. **Nothing is implemented.**
**Date:** 19 November 2026

**Design constraint from the brief.** The layer must work inside the existing vanilla ES-module architecture, with no framework, no bundler and no new runtime dependency. It must not become an abstraction for its own sake.

**APPROVED DECISION.** A guest is a local system only. No local write may depend on a network call or create remote work.

---

## 1. The problem, precisely

Today a write is three unrelated acts performed by a view:

```
mutate a shared object  →  call a save function  →  remember to notify
```

Nothing enforces the third act, nothing records *what* changed, and a fourth act (queue for sync, stamp a revision) has nowhere to live. Every new feature repeats the pattern, so a sync layer introduced later would have to find and wrap each repetition.

**PROPOSED DESIGN.** Replace the three acts with one call whose implementation performs all of them, and keep every read path synchronous for the views that already rely on it.

---

## 2. Layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ View layer — unchanged contract                                          │
│   today.js · tasks.js · library.js · reader.js · stats.js · settings.js   │
│   renders from `state` and from repository read models                   │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ calls (synchronous for reads)
┌──────────────────────────────▼───────────────────────────────────────────┐
│ Repository layer — the only write door                                   │
│   repository-tasks · repository-books · repository-activity              │
│   repository-prefs · repository-session                                  │
│   validates · normalises · stamps envelope · appends change · notifies    │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ adapter interface (see STORAGE_ADAPTER_SPECIFICATION)
┌──────────────────────────────▼───────────────────────────────────────────┐
│ Storage adapters                                                         │
│   kvAdapter (localStorage)   ·   idbAdapter (blobs)   ·   memoryAdapter   │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────┐
│ Outbox adapter (IndexedDB, inert in Phase 1)  ·  Sync engine (Phase 2)    │
└──────────────────────────────────────────────────────────────────────────┘
```

Nothing in the repository layer knows about HTTP, IndexedDB cursors, DOM nodes, or themes.

---

## 3. Module list (PROPOSED DESIGN)

Flat files in `js/`, matching the project's existing convention (no subdirectories, every module listed in `sw.js` `SHELL`).

| Module | Responsibility | Must not |
|---|---|---|
| `js/datacontract.js` | Envelope helpers, validators, normalisers, field allowlists | Touch storage |
| `js/dataclassification.js` | Status of every key and field (**S**/**D**/**P**/**X**/**?**) and the sync projection | Contain merge rules |
| `js/schemas.js` | Store versions, migration registry, `runMigrations()` | Contain UI copy |
| `js/dataadapters.js` | `kvAdapter`, `idbAdapter` (blobs only), `memoryAdapter`, capability detection, error mapping | Contain domain rules |
| `js/repository-tasks.js` | Task reads and writes | Serialise whole lists itself |
| `js/repository-books.js` | Book metadata, progress, stats, annotations | Open IndexedDB directly |
| `js/repository-activity.js` | Day history, moods, ledger floors, achievements | Recompute derived values |
| `js/repository-prefs.js` | Every preference key, name, avatar, photo | Invent defaults |
| `js/repository-session.js` | Live focus session | Write history |
| `js/outbox.js` | Queue append/read/ack, guarded by classification | Exist for a guest |
| `js/workspace.js` | `installationId`, workspace derivation, key namespacing | Decide authorization |
| `js/datareport.js` | Read-only integrity counts | Transmit anything |

**IMPLEMENTATION STATUS: none of these files exists.**

**RISK.** Eleven new modules is a large surface for a project with 68. The design is deliberately conservative: five repositories, two infrastructure adapters, and four small support modules. If implementation shows that `repository-prefs` adds no value beyond `store.js`, it should be dropped rather than kept for symmetry.

---

## 4. The boot-order problem, and the chosen answer

`js/state.js` reads storage **while it is being evaluated**:

```
state.tasks = normalizeTasks(loadTasks())     // runs at import
```

Any design that makes reads asynchronous breaks this, and with it every view that assumes `state` is populated before the first render.

**Options considered:**

| Option | Consequence | Verdict |
|---|---|---|
| Make `state` lazily populated, views await a boot promise | Touches every page, invites a race in early render paths | Rejected for Phase 1 |
| Keep synchronous reads on top of `localStorage`, and make the *write* path the boundary | Views unchanged; migrations run synchronously before `state.js` is evaluated | **Chosen** |
| Move everything to IndexedDB now | Requires an async boot phase and a data copy; a large migration with no Phase 1 benefit | Rejected; the adapter boundary keeps it possible later |

**Chosen boot sequence — PROPOSED DESIGN:**

```
index.html
  └─ js/version.js
  └─ js/app.js
       1. import js/schemas.js             // no side effects
       2. runMigrations()                  // synchronous; before any reader
       3. import js/state.js               // now reads a migrated store
       4. import the rest of the pages
       5. init
```

**IMPLEMENTATION NOTE.** ES module imports are hoisted, so `app.js` cannot simply `import './state.js'` after a call. The runner must be executed from a module that `state.js` itself imports first, or `state.js` must call the runner before reading. The cleaner form is:

```
// js/state.js (first lines)
import { runMigrations } from './schemas.js';
runMigrations();
// then read storage as today
```

This keeps the ordering explicit at the one place that depends on it, and costs one synchronous call at boot. It must be timed: if the chain is slow on a large store, the answer is to make each step cheap, not to defer it.

---

## 5. Write flow

```
repository.tasks.update(id, patch)
  1. read the record (in-memory index → kv adapter)
  2. validate the patch against the field allowlist
  3. merge fields; bump rev; set updatedAt; update fieldClock entries
  4. project for sync (classification) — a separate object, never the stored one
  5. persist through the kv adapter (single key, whole array today)
  6. append a change entry to the outbox  — ONLY if a session exists
  7. emit one change event with {kind, id, fields}
  8. return the read model
```

Step 6 is the only conditional step, and in Phase 1 the condition is always false because no session exists. That is what makes the outbox "inert" without a feature flag that could be flipped by accident.

Step 5 is deliberately still a whole-array write. Changing the physical layout is a storage migration (Phase 2 at the earliest); the boundary is what Phase 1 buys.

**RISK (the central one of this design).** A whole-key write means two concurrent writes lose one of them — the same defect as today, relocated. The boundary makes the fix possible (a per-record store) but does not fix it. Phase 1 must state this plainly rather than imply that introducing repositories removes the race.

---

## 6. Read flow

| Reader | Today | After the boundary |
|---|---|---|
| `state.js` | `loadTasks()` | `repository.tasks.all()` — same synchronous shape |
| `daycache.js` | reads `state` + `getBooks()` + `getHistory()` | reads the same, through repository selectors |
| `library.js` | module array + `readJSON` | `repository.books.all()` returning the same array identity until a change |
| `stats.js`, `ledger.js` | read `state` and store loaders | unchanged surface |
| `settings.js` | `loadTasks`, `loadHistory`, … for re-hydration | one `repository.hydrate()` |

**Rule.** A read never writes. No `updatedAt` is stamped on read; no default is persisted on read. Defaults are applied in the read model only. This is the rule that keeps revisions meaningful.

---

## 7. Error taxonomy

| Class | Example | Repository behaviour | UI obligation |
|---|---|---|---|
| `ValidationError` | Patch contains an unknown field on an **S** record | Reject the write; nothing persisted | Show the reason; never retry silently |
| `StorageUnavailable` | `localStorage` disabled | Reject; emit `storage-error` | Persistent banner, not a toast |
| `QuotaExceeded` | `setItem` throws | Reject; emit `storage-error` with the key | "Not saved" marker on the record |
| `Conflict` | Stale `rev` on a write | Reject with the current record attached | Refresh the row |
| `MigrationBlocked` | Store version newer than the build | Reject writes **for that family only** | Banner naming the family |
| `AdapterFailure` | IndexedDB blocked or aborted | Reject with a code | Actionable sentence, existing pattern |

A repository never throws for a recoverable storage failure: it returns `{ok: false, error}` so a view cannot forget to handle it. Programming errors (`TypeError`, unknown kind) may throw.

---

## 8. Change events

**PROPOSED DESIGN.** One event name, one shape:

```
daftarche:data-changed
detail = { kind: 'tasks'|'books'|'activity'|'prefs'|'session', id?: string, fields?: string[], origin: 'local'|'sync'|'migration' }
```

`js/bus.js` keeps its `notify()` for "something changed, re-render"; the new event carries *what* changed for the day cache and for a future sync engine. The existing `daftarche:books-changed` remains during the transition and is emitted by the books repository, so no shelf code changes.

**RISK.** Two notification mechanisms at once invite double renders. The migration of a module must replace its `notify()` call with the event plus one `notify()`, never both in different places.

---

## 9. Boundaries with the layers that come later

| Later layer | What it may use | What it must not do |
|---|---|---|
| `syncPolicy` | Read models and the classification module | Be imported by a repository (a repository must not decide conflicts) |
| `syncEngine` | Outbox adapter, repositories' apply methods, `serverSeq` | Open the binary stores; bypass validation |
| Session store | `workspace.js` for scoping | Write user records |
| Analytics | Nothing from the repository | Receive record content, ids or counts of content |

**APPROVED DECISION.** Analytics stays opt-in and content-free; it never reads the data layer.

---

## 10. Why not the alternatives

| Alternative | Why not |
|---|---|
| Introduce a state-management library | Adds a dependency and a paradigm; the brief forbids a framework and the test suite imports modules directly |
| Wrap `state` in a Proxy to observe writes | Implicit, hard to test, and it cannot distinguish a render-triggering mutation from a persistence mutation; also breaks `state.tasks` reassignment semantics |
| Diff snapshots to derive changes | Every keystroke rewrites a whole array; diffing would be a second full pass and still cannot tell two identical edits apart |
| A CRDT library | Semantics do not match the product's monotonic facts and explicit user resolution; adds weight and a new failure mode |
| Move to IndexedDB-first now | Requires an async boot and a data copy, and buys nothing Phase 1 needs |
| A class per repository | The project uses modules and plain objects; classes add ceremony without a benefit here |

---

## 11. Success criteria for the layer

1. No module outside a repository assigns `state.tasks`, mutates a book record, or calls a storage setter for a task/book/activity key.
2. Every write stamps `updatedAt` and `rev` exactly once.
3. Every write is visible to the day cache without the caller remembering to invalidate it.
4. A guest write never creates an outbox entry.
5. A failed write never leaves the in-memory state claiming success.
6. Reads stay synchronous, so no view gained an `await`.
7. The full existing suite passes unchanged.
8. A test asserts the modules above are the only writers.

**IMPLEMENTATION STATUS.** None of the eight is true today.
