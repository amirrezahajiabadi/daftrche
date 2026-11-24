# Sync and Data Strategy — Daftarche

**Status of this document:** analysis and proposal. Nothing described here is implemented.

## 0. Approved product-owner decisions reflected here

| # | Decision | Effect on this document |
|---|---|---|
| 1 | **Synchronisation is free for every registered account.** An account is optional for local use; it enables sync and commercial actions. Authenticated users keep full local function offline, queueing changes. Guests are never pressured to register. | No paid-sync tier exists; the sync scope is the free account scope |
| 2 | **Data protection is standard encryption in transit (valid HTTPS/TLS) and at rest, with keys managed separately.** Not end-to-end encryption. | This document assumes that model rather than defining it: it is specified in `TARGET_ARCHITECTURE.md` §2.3–2.4, `ANDROID_MATURITY_PLAN.md` §3.11 and SEC-01. No section here may imply E2EE |
| 3 | **PDF synchronisation is metadata and reading progress only.** PDF files, PDF highlights, PDF notes, book cover images and uploaded music never enter the sync pipeline. | §5.2 canonical classification, §5.3 field scope, §7.4 migration scope, §8.1 outbox guard, §10.1 restore behaviour |

These decisions are authoritative for this document. Everything else remains analysis or proposal.

---

## 1. What the source actually says about data

The application is unambiguously single-device. `js/backup.js:1-15` states it in the code's own words:

> *"The app is local-first: the tasks, the streak, the badges and the reading progress live in this one browser and nowhere else… This module is the way out: one JSON file."*

`js/store.js:1` adds an aspiration, not an implementation: *"localStorage for now — Supabase will replace it later"*. Repository-wide search found **no** Supabase client, dependency, endpoint or migration. Treat it as **Doc-only**.

---

## 2. Data inventory (verified)

### 2.1 localStorage — task and activity data

| Key | Contents | Shape | Evidence |
|---|---|---|---|
| `daftarche-v1` | All tasks | Array of task records | `js/constants.js` `STORAGE_KEYS.tasks`; written by `saveTasks` in `js/store.js` |
| `daftarche-history` | Days the app was opened | Array of `YYYY-MM-DD` strings | `js/store.js` `loadHistory` |
| `daftarche-moods` | One mood per day (1–5) | Object keyed by day | `js/store.js` `loadMoods` |
| `daftarche-focus-history` | Completed focus sessions, **capped at 100** | Array of session records | `js/focushistory.js` `HISTORY_CAP = 100` |
| `daftarche-focus-session` | Live/paused focus timer | Object or empty | `js/store.js` `loadSession`/`saveSession` |
| `daftarche-ledger` | Day book: monotonic per-day counters | Object keyed by day | `js/ledger.js` `bumpDay`, `collectTotals` |
| `daftarche-achievements` | Unlocked badges with tier + date | `{v, baselineAt, unlocked{}, recSeen{}}` | `js/achievements.js` `emptyState` |
| `daftarche-books-meta` | Book shelf: progress, goals, highlights, notes | Array of book records | `js/library.js:10-13`; shape at `js/library.js:685-686` |
| `daftarche-birthday-wishes` | Annual birthday capsules | Object | `js/store.js` |
| `daftarche-pomo`, `daftarche-week-goal`, `daftarche-backup-at` | Focus length, weekly goal, last backup stamp | Scalars | `js/constants.js` |

### 2.2 localStorage — preferences and selections

`theme`, `daftarche-theme-modes`, `daftarche-theme-auto`, `daftarche-text-size`, `daftarche-motion`, `daftarche-stats-range`, `daftarche-card-style`, `daftarche-goal`, `daftarche-lang`, `daftarche-name`, `daftarche-avatar`, `daftarche-photo`, `daftarche-scene`, `daftarche-pen-width`, `daftarche-vol-amb`, `daftarche-vol-music`, `daftarche-ambsound`, `daftarche-streak-freeze`, `daftarche-birthday`, `daftarche-birthday-candle`, `daftarche-birthday-theme-off`, `daftarche-tour-complete`, `daftarche-tour-awarded`, `daftarche-first-seen`, `daftarche-ios-guide-dismissed`, `daftarche-frog-dismissed`, `daftarche-backup-nudge`, `daftarche-seen-version`.

### 2.3 localStorage — legacy keys handled by migration

`daftarche-state`, `daftarche_state`, `daftarche_app_state`, `daftarche-all`, `daftarche-store`, `daftarche-tasks` (unversioned). Each is merged into the sharded keys and then removed by `migrateStorage()` in `js/store.js`, which runs at module load.

### 2.4 IndexedDB — binaries

| Database | Store | Key | Contents | Evidence |
|---|---|---|---|---|
| `daftarche-books` (v1) | `books` | `keyPath: 'id'` | The PDF blob per book | `js/library.js:58-70` |
| `daftarche-audio` | `tracks` | — | User-uploaded music | `js/audio.js:241-292` |

Both databases hold bytes and are therefore **outside the synchronisation scope by decision** (status **X** in §5.2). They are reachable today only through the manual PDF pack export (`js/library.js` `exportBookPack`); music has no export at all.

### 2.5 Record shapes

**Task** — `js/state.js` `normalizeTask`:

```
id, text, done, p ('low'|'mid'|'high'), cat, dueDate ('YYYY-MM-DD'|null),
durationMin (1–480|null), timeFrom/timeTo (minutes past midnight, paired|null),
created (ms), doneAt (ms|null), notify (bool), notifiedStatus ('none'|'soon'|'overdue')
```

**Focus session** — `js/focushistory.js` `normalizeHistoryRecord`:

```
id, taskId|null, taskTitle|null (snapshot), startedAt, endedAt,
plannedDurationMin|null, actualDurationMin (≥1), taskCompleted (bool),
rating ('good'|'okay'|'hard')
```

**Book** — `js/library.js:685-686`:

```
id, title, numPages, lastPage, cover, goal, stats (keyed by day),
highlights[], notes[], completedPages[]
```

---

## 3. Synchronisation readiness — the seven questions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Are stable identifiers used? | **Yes.** Tasks and books carry client-generated ids (`utils.js` `nextId`, collision-safe timestamp + random); focus sessions and books match by id in the backup merge | `js/state.js`, `js/utils.js`, `js/backup.js` `stableId` |
| 2 | Are timestamps available? | **Partially.** `created`, `doneAt`, `startedAt`, `endedAt`, day keys exist. **No `updatedAt` anywhere** | Repository search for `updatedAt` returns no source hits |
| 3 | Are modification versions available? | **No.** No `rev`, no vector clock, no server sequence | Same search |
| 4 | Are deletion markers (tombstones) supported? | **No.** Tasks are removed by array filter; books are soft-deleted for 5 s in the UI only, then the metadata and PDF are deleted | `js/tasks.js:622`, `js/library.js` `softDeleteBook`/`settlePendingDelete` |
| 5 | Are migrations implemented? | **Partially.** Key-level legacy merges run at load; task records are normalised forward; there is no store-wide schema version | `js/store.js` `migrateStorage`, `js/state.js` `normalizeTask` |
| 6 | Can data be exported and restored? | **Yes, for JSON data** (with rollback and merge); **yes for PDFs** via a separate pack; **no for uploaded music** | `js/backup.js`, `js/library.js` `exportBookPack`/`importBookPack`; exclusion stated at `js/backup.js:13-15` |
| 7 | Does the app assume one device is the only source of truth? | **Yes, explicitly and structurally.** Single mutable `state`, no writer observation, no outbox, clock-derived identity | `js/state.js`, `js/store.js`, `js/backup.js:1-15` |

**Conclusion:** identifiers and export exist; **versions, tombstones and any change-observation point do not**. Synchronisation is therefore a data-model project before it is a networking project.

---

## 4. Blocking findings (in priority order)

### F1 — Deletes are unrepresentable
`js/tasks.js:622` removes a task from the array. A sync engine cannot distinguish "deleted on device A" from "never existed on device B". Any first sync would resurrect deleted tasks. **Tombstones are mandatory.**

### F2 — No modification stamp
Two open copies of a task cannot be compared; the existing merge policy literally documents this limitation: *"Two open copies have no edit stamp to compare, so the one already here stays"* (`js/backup.js:186-190`). That is acceptable for an occasional manual merge; it is not acceptable for continuous sync.

### F3 — Focus history is destructively capped
`HISTORY_CAP = 100` (`js/focushistory.js`) trims the oldest sessions locally. If history is treated as syncable, sessions silently disappear from the server's perspective unless trims are recorded as deletions. Either (a) exclude the cap from synced data, (b) raise/remove the cap for account users, or (c) make the cap a server-side retention rule applied after merge.

### F4 — Independent stores, no single write door
`js/library.js` holds its own `books` array plus `saveMeta()`; `js/audio.js` opens its own IndexedDB; `js/tasks.js` assigns `state.tasks` directly. A sync layer needs one repository boundary, otherwise every new writer must remember to enqueue an operation.

### F5 — `localStorage` is a poor sync log
Synchronous, ~5 MB per origin, and the task list is a single JSON document. Every keystroke-level change rewrites the whole array. Diffing snapshots to derive operations will not scale to years of data.

### F6 — Device clocks are the only clocks
`id` and `created` come from the device. A wrong clock produces ids that sort oddly and `created` values in the future. Server-assigned monotonic sequence numbers for merge ordering are required; client timestamps must be display-only.

### F7 — Live timer must not sync
`daftarche-focus-session` is a running timer. Copying it across devices would start a timer on a device nobody is using. It is device-local by nature.

---

## 5. Proposed data model

### 5.1 Record envelope

Every syncable record gains:

```
id            string   (unchanged, client-generated, stable)
created       number   (unchanged; display only)
updatedAt     number   (client clock at last local write; optimistic ordering)
serverSeq     number   (server-assigned monotonic; authoritative for merge and cursors)
deletedAt     number|null  (tombstone; null for live records)
```

Constraints:
- `serverSeq` is written by the server only and ignored on the way in.
- A tombstone keeps only `id`, `deletedAt`, `updatedAt`, `serverSeq`. Payload is dropped after a retention window (proposal: 90 days, then hard delete).
- No record ever changes `id`.

### 5.2 Canonical Sync classification (authoritative)

This table is the single source of truth for what may leave the device. `TARGET_ARCHITECTURE.md`, `PRIVACY_AND_ANALYTICS_POLICY.md`, `MONETIZATION_STRATEGY.md` and `IMPLEMENTATION_BACKLOG.md` summarize it and must link here rather than restating it in their own words. FND-10 turns it into an enforced module, and the repository projection, the migration snapshot and the outbox all read that module.

Status codes:

| Code | Meaning |
|---|---|
| **S** | **Approved for account Sync.** Also included in the guest→account migration snapshot |
| **D** | **Device-local.** Never synchronized, never migrated; it describes the device or the moment, not the person |
| **P** | **Preference.** Optional synchronisation, **pending owner decision** (OD-06). **Inactive until decided:** not synced, not migrated, never queued |
| **X** | **Excluded binary.** Never enters Sync, migration, the outbox or any other cloud path |
| **?** | **Pending owner decision.** Must not be synchronized **or migrated** until the owner decides; listed so nobody promotes it by accident |

| Record / key | Code | Note |
|---|---|---|
| Tasks — every field of `normalizeTask` (`daftarche-v1`) | **S** | Includes user-typed text; that is the service the user asked for |
| Book metadata and reading progress — only the §5.3 allowlist | **S** | Nine fields, positively allowlisted |
| Book `highlights[]` (PDF annotations) | **D** | Approved: excluded from Automatic Account Sync and never transferred to the Daftarche backend. The existing user-initiated JSON backup includes them (§7.6). Annotation continuity through account Sync is not offered |
| Book `notes[]` (PDF notes) | **D** | Same rule: excluded from Automatic Account Sync, never transferred to the Daftarche backend, and included in the existing user-initiated JSON backup. Annotation continuity through account Sync is not offered |
| Book `cover` (base64 thumbnail) | **X** | Image data URL rendered from page 1 |
| PDF files — IndexedDB `daftarche-books` | **X** | Approved permanent exclusion |
| Uploaded music — IndexedDB `daftarche-audio` | **X** | Outside sync scope |
| Day-open history (`daftarche-history`) | **S** | Plain date list |
| Moods (`daftarche-moods`) | **S** | One value per day; existing merge rule applies |
| Ledger (`daftarche-ledger`) | **S** | Monotonic floors; merge keeps the higher value |
| Achievements (`daftarche-achievements`) | **S** | Monotone tier |
| Focus history (`daftarche-focus-history`) | **?** | **OD-05**: the 100-record local cap (F3), retention and the Plus boundary are unresolved. **Pending and inactive:** not synced, not migrated, not queued, and no merge rule runs for it, until OD-05 is decided |
| Birthday record (`daftarche-birthday`, `daftarche-birthday-candle`, `daftarche-birthday-theme-off`) | **?** | **OD-08**: personal data about a possibly-minor user. **Pending and inactive:** not synced or migrated until OD-08 approves inclusion, and its absence from the Backup `EXCLUDED` set is not a Sync classification (consequence 2 below) |
| Birthday wishes (`daftarche-birthday-wishes`) | **?** | **OD-08**: contains user-written text. **Pending and inactive** until OD-08 approves inclusion |
| Reflections | **?** | **OD-09**: no dedicated storage key appears in the inventory in §2, so the record must be identified before it can be classified. If reflections live inside mood or birthday records, they inherit that record's status |
| Weekly goal (`daftarche-week-goal`) | **P** | A setting, not an activity fact — moved out of the synced tier in this revision |
| Pomodoro length (`daftarche-pomo`) | **P** | Same |
| Theme, theme modes, theme-auto, text size, motion, stats range, card style, language | **P** | OD-06; conflicts are cosmetic |
| Display name (`daftarche-name`), avatar key (`daftarche-avatar`) | **P** | OD-06 |
| Streak freeze (`daftarche-streak-freeze`) | **P** | A setting with an in-app economy attached; classify with preferences |
| Profile photo (`daftarche-photo`) | **?** | **OD-10**: a data URL image, so it cannot be treated as a record by default |
| Live focus session (`daftarche-focus-session`) | **D** | F7: would start a timer on a device nobody is using |
| Backup stamps (`daftarche-backup-at`, `daftarche-backup-nudge`) | **D** | Per-device bookkeeping |
| Tour markers (`daftarche-tour-complete`, `daftarche-tour-awarded`), `daftarche-first-seen`, `daftarche-seen-version`, `daftarche-ios-guide-dismissed`, `daftarche-frog-dismissed` | **D** | Would suppress onboarding or update notices wrongly on another device |
| Audio volumes and ambience (`daftarche-vol-amb`, `daftarche-vol-music`, `daftarche-ambsound`), pen width (`daftarche-pen-width`) | **D** | Hardware-and-habit settings |
| Per-device sync suspension flag (future) | **D** | §6.4 |
| Legacy keys (§2.3) | **—** | Merged locally by `migrateStorage()` and then removed; never synced |

Four consequences worth stating plainly:

1. **Nothing is synced by default.** A record or field enters Sync only when this table says **S**, and a new field starts unsynced until it is classified here and in FND-10.
2. **The backup is not the Sync scope.** A JSON backup is a file the user owns and carries by hand, so it legitimately includes annotations, covers and titles; Sync is narrower by decision. `EXCLUDED = new Set(['daftarche-seen-version', 'daftarche-birthday-seen'])` in `js/backup.js` describes backup behaviour and must not be read as the sync scope. **Birthdays show exactly why:** `daftarche-birthday` is absent from that set only because the *backup* carries it, which says nothing about Sync — its Sync status is **?** under OD-08, so it does not synchronise. **Backup classification and Sync classification are separate questions and never substitute for each other.**
3. **Pending means inactive, not scheduled.** A **P** or **?** row is frozen where it stands: it may not enter the repository projection, the migration snapshot or the outbox, and no conflict rule may run for it in `syncPolicy`, until its decision is recorded as approved. Today that covers Focus history (OD-05), the birthday record and annual wishes (OD-08), reflections (OD-09), the profile photo (OD-10) and every preference field (OD-06).
4. **A backup is not an account export either.** Automatic Sync, the manual local backup and the account data export are three different paths with three different scopes; §7.6 keeps them apart, and uploaded music is treated separately there (OD-18).

### 5.3 PDF synchronization scope (approved)

Synchronisation carries book metadata and reading progress only. The field set below is verified from the source, not assumed: the record is created at `js/library.js:685-686` and extended by the reader.

| Book field | In the sync payload | Evidence / note |
|---|---|---|
| `id` | **Yes** | Record key, client-generated at import (`js/library.js:683`) |
| `title` | **Yes** | From the file name at import, editable afterwards (`js/library.js:685`) |
| `addedAt` | **Yes** | Insertion stamp (`js/library.js:685`) |
| `numPages` | **Yes** | `0` until the reader has rendered the document (`js/library.js:524`, `:685`) |
| `lastPage` | **Yes** | Current page (`js/reader.js:1822`) |
| `lastReadAt` | **Yes** | Last read stamp (`js/reader.js:1822`, `:1914`) |
| `completedPages` | **Yes** | Pages marked read (`js/reader.js:1904-1914`) |
| `stats` | **Yes** | Per-day `{pages, minutes}` reading counters (`js/daycache.js:84`, `js/reader.js:1914`) |
| `goal` | **Yes** | `{pagesPerDay, text}` — user-typed text, which is why it belongs to account-scoped content and never to analytics |
| `cover` | **No** | A base64 image data URL rendered from page 1 (`js/reader.js:1505-1507`) — a binary derivative, therefore outside the approved metadata-and-progress scope. Without it the shelf renders the notebook fallback (`js/library.js:450`), so nothing breaks on a second device |
| `highlights` | **No** | Annotation records; approved as device-local. The element shape was not inspected because it is out of scope |
| `notes` | **No** | Annotation records; approved as device-local |
| PDF bytes (`daftarche-books` IndexedDB) | **No** | Approved: never uploaded to or synchronised with the backend. The file is carried by the user-initiated PDF pack (`js/library.js` `exportBookPack`), not by Sync |

Rules that follow from the approved scope:

1. The sync engine treats a book as a **metadata record**. It has no code path that opens the `daftarche-books` object store, and no code path that reads or writes a blob.
2. A book record arriving on a device that does not hold the PDF is **valid and must be kept**. A missing local file is not a deletion signal, must not create a tombstone, and must never remove metadata or progress.
3. The UI must distinguish "book known, file not on this device" from "book deleted". Both cannot look the same.
4. Merge rules for the syncable subset are the book rows in §5.4; nothing in `highlights`/`notes`/`cover` is merged by sync.
5. Exclusion is enforced at **three separate boundaries** and all three are required: the **repository projection** (the record handed to the sync layer carries only allowlisted fields), the **migration snapshot** (§7.4), and the **outbox guard** (§8.1). A field the projection drops cannot reach the other two.
6. Allowlisting is positive: a newly added book field is unsynced until it appears in the §5.3 table and in the classification module (FND-10). Nothing syncs by default.

### 5.4 Conflict policy — reuse what is already tested

The backup merge (`js/backup.js:180-240`) already states domain rules in words. They should be promoted into a shared `syncPolicy` module rather than re-derived:

| Record | Rule | Source |
|---|---|---|
| Task — completion | Completed wins over open; between two completions, later `doneAt` | `js/backup.js` `pickTask` |
| Task — edits | Currently "local wins" because no edit stamp exists; **with `updatedAt` this becomes: later `updatedAt` wins**, with the losing text preserved in a conflict log for the user | New rule required (F2) |
| Task — order | Local order first, incoming new tasks appended in their file order | `js/backup.js` |
| Focus history — **dormant / proposed / Backup-only** | Finished sessions are immutable; union by id; never reorder existing. **Not an active Sync rule:** the union applies only to the manual backup merge while OD-05 is unresolved | `js/backup.js` merge comment |
| Books — progress | Pages read and per-day stats only grow (floor rule) | `js/backup.js`, `js/ledger.js` |
| Books — position | Furthest page reached wins | `js/backup.js` |
| Books — title/goal | Chosen value stays; a value never chosen locally may arrive. `cover` is not merged by sync (device-local) | `js/backup.js` |
| Highlights/notes | **Not part of sync.** Device-local by decision; only the manual backup merge unions them by id | `js/backup.js` |
| Moods | One choice per day; local stands; incoming fills gaps | `js/backup.js` |
| Ledger | Higher floor per day per metric | `js/backup.js`, `js/ledger.js` `bumpDay` |
| Achievements | Higher tier stands; earlier baseline; later `recSeen` | `js/backup.js` |
| Prefs (single value) — **dormant / proposed** | Last write wins by `updatedAt`. **Inactive until OD-06:** the rule must not run for any **P** field, none of which may be in Sync | New rule |

Two rows above are deliberately dormant. Focus history and single-value preferences are listed so their existing domain rule is not lost, but neither is an active Sync rule: OD-05 and OD-06 are unresolved, and a dormant rule must not become the reason a pending field is treated as approved.

**Design note:** this preserves the product's philosophical stance — *completion and progress are facts that cannot be undone by a merge* — rather than importing a generic CRDT library whose semantics would contradict it.

### 5.5 Unresolvable conflicts must be visible
Task text edited differently on two devices is the one genuinely destructive case. Proposal: keep both (winner live, loser stored in a `conflicts` collection surfaced as "this task was edited in two places" with a restore action). Silent discard is explicitly forbidden by the brief.

---

## 6. Guest and account data models

### 6.1 Guest
- No identity row; no server contact except an optional version check.
- Same local schema as an account user, **plus** nothing extra. This is essential: the upgrade path must not require a separate store.
- A local-only `installationId` (random, created on first run) is needed for sync idempotency and for analytics rotation if ever enabled. It must not be derived from hardware identifiers.

### 6.2 Account
- `user(id, createdAt, status)` — no password material in the client; no password reuse across features.
- `device(id, userId, label, platform, lastSeenAt, createdAt)` — supports a device list and remote sign-out.
- `record(userId, kind, id, payload, updatedAt, serverSeq, deletedAt)` — one table or one table per kind; ordering by `serverSeq`.
- `cursor(userId, deviceId, lastSeq)` — pull cursor per device.
- `migration(userId, deviceId, state, lastAckedSeq, startedAt)` — for F-§7 below.
- `entitlement(userId, productId, source, grantedAt, expiresAt, receiptRef)` — see `MONETIZATION_STRATEGY.md`.
- Every record is scoped by `userId`. No route accepts a client-supplied owner id, and a pull cursor is bound to both the account and the device. Authorization baseline: `TARGET_ARCHITECTURE.md` §2.3, implemented by SEC-01.

### 6.3 User states persisted on the client
```
session = { state: 'guest' }                                   // default, forever valid
        | { state: 'signed-in', userId, token, expiresAt }
        | { state: 'signed-in-offline', userId, token, expiresAt (stale) }
```
`guest` is not an error state and must never render a login prompt on its own.

### 6.4 Account-level Sync versus per-device suspension

These two are routinely conflated and must stay distinct:

| Concept | Owner | Meaning | Effect on data |
|---|---|---|---|
| **Account-level Sync** | The account, free | The account carries synchronisation for as long as it exists. No paid tier, no trial, no device-count upgrade | Records live on the server for that account |
| **Per-device suspension** | One device | The user stops *this device* from pushing and pulling, without changing the account | Nothing is deleted, locally or on the server; the device shows "sync paused on this device" |

Rules:

- Suspension is a device-local flag (status **D**). It is never an account downgrade, never a purchase, never a reason to nag.
- Suspending on one device must not disturb another device's syncing, and must delete nothing on either side.
- Signing out is stronger than suspension: it ends the session, keeps local data by default, and stops syncing for that device entirely.
- Re-enabling sync resumes from the stored cursor; the engine must not re-upload the whole store.
- A permanently "local-only" device (open decision §12.3) is the durable form of the same mechanism, not a second feature.

---

## 7. Guest-to-account migration

### 7.1 Requirements from the brief, restated as testable criteria
1. No local record is lost or duplicated by the migration.
2. Interruption at any point is recoverable without user-visible damage.
3. Conflicts are detected and resolved by the stated rules, never by silent overwrite.
4. Local data survives a failed migration (the app continues to work as guest).
5. The migration is idempotent: running it twice produces the same server state.

### 7.2 Procedure

| Step | Client | Server | Failure behaviour |
|---|---|---|---|
| 1 | Create account / sign in | Issue session | Nothing changes locally |
| 2 | Compute snapshot: every record classified **S** in §5.2, and nothing else — no **P** or **?** record, so preference values stay local until OD-06 is approved; never a binary | — | Abort is free: no writes yet |
| 3 | `POST /migration/start {installationId, counts}` | Create migration row, return `migrationId` | Retry with same key returns the same id |
| 4 | Loop `POST /migration/page {migrationId, seq, records[]}` | Upsert with per-record conflict check; assign `serverSeq`; return outcomes | Client stores `lastAckedSeq`; resume from there |
| 5 | On final ack, `POST /migration/complete` | Mark complete | If the client dies here, resume shows "almost done" and retries completion |
| 6 | Switch local store to synced mode; start normal sync | — | If step 6 fails, local data is intact and the user can retry |
| 7 | Never delete local data in this flow | — | — |

### 7.3 Duplicate handling
- Records are matched by `id`. A guest record whose id already exists on the server (same account signed in before on this device) is merged with the same policy as a normal sync pull.
- Genuine duplicates with different ids (the same task written twice by the user) are **not** deduplicated automatically. Proposal: after migration, offer a one-time "looks like duplicates" review listing records with identical text and same day — user-initiated, never automatic.

### 7.4 What must be migrated vs. deliberately not

Migration transfers **only records classified S in §5.2**, and projects fields explicitly rather than serialising whole records, so a field added later cannot start migrating by accident. A **P** or **?** record stays local — out of the snapshot, the outbox and Sync — until the owner decides.

| Migrated | Not migrated | Reason |
|---|---|---|
| Tasks; the nine allowlisted book metadata/progress fields; day-open history; moods; ledger; achievements | **PDF files** | Approved: not uploaded and not migrated; the file is carried only by the user-initiated PDF pack |
| | **PDF `highlights[]` and `notes[]`** | Device-local by decision: not migrated and not synchronised, and annotation continuity across devices is explicitly not offered. This is an exclusion from Sync and migration, not from export — the user-initiated JSON backup still carries them (§7.6) |
| | **Book `cover`** | Image data URL, not metadata |
| | **Uploaded music** | Binary content outside sync scope |
| | Focus history (**?**, OD-05) | Pending and inactive: cap, retention and Plus boundary unresolved |
| | Birthday record and annual wishes (**?**, OD-08) | Personal data; the minors question is unresolved |
| | Reflections (**?**, OD-09) | Not yet identified as a record |
| | Preferences (**P**, OD-06) | Pending and inactive: no **P** field enters this snapshot until preference sync is approved |
| | Profile photo (**?**, OD-10) | Data URL image |
| | live focus session, backup stamps, tour markers | Device-local by nature |

The migration must report a truthful count before it starts — records, not files — and must never present itself as a complete library backup: the PDFs, annotations and music are not going to the account.

### 7.5 UX requirement
The migration must be a **visible, single-purpose screen** with a progress state and an explicit promise: *"Your PDF annotations are not uploaded to your account. They remain available in your local data and can be included in your JSON backup."* The promise must name the backend transfer it is describing; it must never be read as a statement that annotations cannot leave the device by the user's own export, and it must not imply that account migration carries them. It must be cancellable before step 4 and resumable after.

### 7.6 Backup, Sync and account export are different mechanisms

Automatic Sync and the manual backup share domain rules; the account export shares none of them, because it only reads what the server already holds. None of the three may be conflated with another:

| | Manual local backup (`js/backup.js`) | Automatic account Sync | Account data export |
|---|---|---|---|
| Trigger | The user exports and imports a file | Automatic while signed in | The user requests a copy of their account data |
| Scope | Whatever the backup module serializes today — including PDF annotations and book covers; uploaded music is not included (OD-18) | Only status **S** records in §5.2 | Everything the server holds: records, entitlements, device list, account metadata |
| Merge rules | `js/backup.js:180-240`, per key, already tested | `syncPolicy`, reusing those rules **only for in-scope records** | None — it is a read-only copy |
| Owner of the data | The user | The service, on the user's behalf | The user, on request |
| Uploaded music | Not included today; whether it must be is **OD-18** | Never — status **X** | Can never appear: the backend never receives it |

Three distinct paths, and the differences are not editorial:

1. **Automatic account Sync** moves only status **S** records, only while a session exists. It is the narrowest of the three by decision.
2. **Manual local backup/export** is a file the user carries by hand. It is wider than Sync because the user owns it — annotations, covers and titles legitimately belong in it — but it is a file, not a service.
3. **Account data export** describes only what the server received. It can never be a complete copy of the user's library, and the UI must not present it as one.

**Uploaded music is outside Sync and outside the account export, but it is not categorically outside the manual export.** It never enters Automatic Account Sync (status **X**), and because the backend never receives it, no Account Data Export can ever contain it. The current Manual Local Backup/Export implementation does not include it either. Whether the manual export must include it is an unresolved owner decision — **OD-18** — and until it is decided no music export may be promised in copy and no implementation task is created for one. Those four statements hold together: out of Sync, out of the account export, absent from today's manual export, and unsettled for the manual export's future. Absent today is not the same as impossible.

Rules for FND-07, the shared-policy task:

- Reusing the backup merge rules is approved **only** for records classified **S**. A rule that exists for `highlights` or `notes` stays in the backup path and must not be imported into `syncPolicy`.
- Backup behaviour must not be weakened or removed to simplify Sync. Annotation merge in the manual path stays as it is.
- Sync conflict resolution must never be invoked for a field outside the canonical table.
- A test asserts that `syncPolicy` contains no rule for `highlights`, `notes`, `cover` or any other **D**/**X** field.

---

## 8. Synchronisation lifecycle

```
                    ┌──────────────┐
   mutation ───────▶│  repository  │──▶ local write (updatedAt, outbox append)
                    └──────────────┘
                             │
        signed-in? ──────────┴────────── no ──▶ stop (guest mode, unchanged behaviour)
             │yes
             ▼
      ┌─────────────┐   debounce/online/foreground   ┌──────────────┐
      │ syncEngine  │───────────────────────────────▶│  push ops    │
      └─────────────┘                                └──────────────┘
             │                                                │
             │◀──────────── pull since cursor ────────────────┘
             ▼
      merge(remote, local) ──▶ apply ──▶ advance cursor ──▶ emit change events
```

Triggers: app foreground, explicit pull-to-refresh, successful mutation flush (debounced ≥ a few seconds), connectivity regained. No background daemon is promised.

Retry policy: exponential backoff with jitter, capped; permanent failures (401/403/409-resolved) are not retried; a 401 moves the session to `signed-in-offline` and asks for re-auth **without blocking local use**.

Observability on the client: a plain "last synced at / N changes pending" line in settings. No telemetry requirement.

### 8.1 Outbox payload constraints

The outbox is a record queue, not a file queue. This is enforced at enqueue time, not at the network call.

- A queued entry is JSON: `{kind, id, updatedAt, fields}`. A `Blob`, `File`, `ArrayBuffer`, base64 data URL or IndexedDB reference may never be enqueued.
- Binary-shaped fields (`cover`, `daftarche-photo`, any future image field) are stripped at the repository boundary before the outbox sees the record, so an engine bug cannot resurrect them.
- The guard rejects unknown `kind` values and payloads above a fixed serialised-size cap (proposal: 64 KB), which also bounds task text and `goal.text`.
- The migration path in §7 uses the same guard: a snapshot that would include a PDF blob, a cover or an annotation fails loudly instead of uploading.
- A rejected record never blocks the queue: it stays local, is marked "not synced" with a precise reason, and the rest of the batch proceeds.

---

## 9. Offline behaviour (account users)

| Situation | Behaviour |
|---|---|
| Session valid, offline | Full local use; outbox grows; commercial features read cached entitlements |
| Session expired, offline | Full local use; a soft banner explains sync is paused; no forced sign-out (signing out would orphan queued ops) |
| Conflict discovered on reconnect | Merge per policy; surface destructive conflicts; never drop silently |
| Server rejects a record (schema/validation) | Keep locally, mark "not synced", show a precise reason; do not retry forever |
| Storage full locally | Existing `safeSet` path already emits `STORAGE_ERROR_EVENT` → `js/storagewarn.js`; sync must not make this worse by duplicating payloads |

---

## 10. Account deletion and recovery

### 10.1 A restored book without its PDF — required behaviour

The approved model lets metadata and progress exist on a device that has never held the file. That state is normal, not an error:

| Situation | Required behaviour |
|---|---|
| Sign in on device B | Book rows arrive with title, page count, current page, last read, per-day counters and goal |
| Device B opens the book | Progress and goal are visible; the book is clearly marked as **needing the PDF on this device**, with one action to import or attach it. It is not shown as missing, corrupt or deleted |
| Sync runs while the file is absent | Nothing is deleted on either side; progress simply cannot advance on that device |
| User imports the matching PDF | It is offered as an **attachment to the existing book record**, preserving the restored page position, completed pages, per-day counters and goal |
| User imports a different PDF | It becomes a new book; the restored row is untouched |

The attachment step does not exist today: import always mints a new id (`js/library.js:683` `nextId()`), so without it a re-import creates a second shelf entry for the same book.

**Do not rely on filename matching.** Two unrelated files named `کتاب.pdf` are ordinary, and the same document renamed is equally ordinary. Identity must come from something the app can actually compare.

Implementation questions to settle before building it — deliberately not answered here:

1. What identifies a document well enough to match it: page count plus file size, a content hash, or the PDF's own document identifier? Each has a cost — hashing a large file on a phone, or reading document metadata without loading the whole file.
2. Where does the attach action live: the shelf card, the reader, or both?
3. When a candidate match is uncertain, does the app ask, or leave the records separate?
4. If the user later deletes the book on another device, the local file on this device must survive until its owner chooses to remove it — deletion is per device, not a broadcast erase.

Until those are decided: **never merge automatically, always offer the attachment, never delete a restored record.** Carried as SYN-01 in the backlog.

### 10.2 Second-device sign-in must not destroy local data

This applies whenever an account signs in on a device that already holds records — a second phone, a used device, or a re-install with a restored backup.

| Device state | Behaviour |
|---|---|
| No meaningful local data | Restore the account's synchronized records. No question is needed |
| Local data exists | **Merge is the default and the only non-destructive path.** Both sides are kept; the merge policy (§5.4) decides the overlaps |
| User wants the account's copy instead | Permitted **only** as an explicit choice that names what will be lost and shows the count of affected local records before confirmation. Never a default, never a silent replace |
| User wants none of their local data on the account | "Keep this device local-only": sync stays paused on this device (§6.4); nothing is deleted on either side |

Rules:

1. No screen may offer a choice whose consequence is unexplained. "Use my cloud data", with no statement that N local records would be replaced, is not acceptable.
2. A destructive replace needs a confirmation separate from the sign-in step, naming the local record count.
3. During the sign-in merge nothing is deleted on either side. Normal sync afterwards applies tombstones as usual (§5.4) — that is a later, ordinary sync operation, not part of signing in.
4. Whether a device may stay **permanently** local-only is an open decision (OD-07). The pause mechanism itself is not: it is defined in §6.4.

**Deletion (must be complete and provable):**
1. Server: revoke sessions, delete records, tombstones, cursors, migrations, entitlements (with a legal-retention note for invoices, if any), push subscriptions, analytics ids.
2. Client: offer "delete this device's copy too" as a separate confirmation → `clearAll()` + `clearLibraryData()` + audio DB (`js/settings.js:734-737` already performs the two local wipes).
3. Confirmation screen lists exactly what was deleted.

**Recovery:**
- Data export: JSON (existing format) and PDF pack (existing). Uploaded music has no export today; whether the manual local export must carry it is **OD-18** and remains pending, so no music export is promised or required until that decision is recorded.
- Restore on a new device: sign in → server snapshot, or import the JSON file as today.
- A user who never created an account has exactly today's recovery story, and the UI must say so plainly rather than implying cloud safety.

---

## 11. Migration risks

| Risk | Impact | Mitigation |
|---|---|---|
| Deleting user data during migration | Catastrophic trust loss | Never delete in migration; keep the existing `applyBackup` rollback pattern |
| Clock skew producing out-of-order edits | Lost edits | `serverSeq` authoritative; `updatedAt` only optimistic |
| Tombstone explosion | Cost and sync bloat | Retention window + compacted snapshots |
| Local `HISTORY_CAP` silently trimming synced history | Apparent data loss | Decide F3 explicitly before sync ships |
| `localStorage` quota during migration staging | Failed migration | Stage outbox in IndexedDB, not localStorage |
| Two devices editing the same book's highlights | Cannot occur through sync — annotations are device-local by decision; only a hand-carried JSON backup merge can unite them | Keep annotations out of the payload; say so in the UI |
| Schema evolution after sync ships | Irreversible divergence | Version the payload (`schemaVersion`) from day one |
| Guest user upgrades, then loses interest and asks for deletion | Half-deleted state | Deletion must be one operation, tested end to end |

---

## 12. Open decisions for the product owner

**Settled by the product owner and no longer open:** synchronisation is free for every registered account; transport uses valid HTTPS/TLS and stored data and backups use standard encryption at rest with separately managed keys (explicitly **not** E2EE); PDF synchronisation is limited to metadata and reading progress, with PDF files, PDF highlights, PDF notes, **book cover images** and uploaded music excluded. The cover exclusion follows from the approved scope and is closed.

These settle the protection model, the price of Sync and the PDF/annotation/music exclusion. They do **not** approve any **P** or **?** row in §5.2: pending decisions remain pending, and no pending field is in Sync or in the migration snapshot.

The consolidated register — question, why it matters, affected documents and tasks, recommendation, cost of postponing — is `PRODUCT_MATURITY_AUDIT.md` §10. The entries that touch this document:

| OD | Question affecting this document |
|---|---|
| OD-05 | Focus history: whether it syncs at all, what its retention cap is, and whether long-range analysis is a Plus benefit |
| OD-06 | Do preferences follow the account or stay per device? |
| OD-07 | May a device stay permanently local-only while signed in? |
| OD-08 | Do the birthday record and annual wishes sync? |
| OD-09 | What exactly are "reflections", and do they sync? |
| OD-10 | Does the profile photo follow the account? |
| OD-11 | Is account deletion immediate, or after a disclosed grace period? (§10) |
| OD-17 | How is a re-imported PDF matched to a restored book record? (§10.1) |
| OD-18 | Must uploaded music be included in the manual local export? (§7.6, §10.2) |
