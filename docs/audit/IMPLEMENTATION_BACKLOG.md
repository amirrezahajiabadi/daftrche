# Implementation Backlog — Daftarche

Dependency-aware backlog for the transition from today's single-device app to a guest-first platform with accounts, synchronisation and a paid tier.

**Approved scope, binding on every task below:** synchronisation is free for every registered account and is never a paid product; guest use stays complete and account-free; transport is TLS with standard encryption at rest and separately managed keys (not E2EE); PDF synchronisation covers book metadata and reading progress only — PDF files, PDF highlights, PDF notes and uploaded music never enter the sync pipeline.

**Authorisation boundary:** this backlog performs no Git write operation of any kind — no commit, tag, branch, merge, rebase, reset or history rewrite — and nothing here deploys, publishes, releases or uploads.

- **Priorities:** P0 critical (data loss, security, foundational blocker) · P1 high (required for the first reliable account/sync + Android milestone) · P2 medium (important, after the foundation) · P3 low (polish, later opportunities)
- **Complexity:** Low / Medium / High
- Every task below is a proposal. Nothing here is implemented.

---

## 0. Phase overview

| Phase | Goal | Exit criteria | Can run in parallel with |
|---|---|---|---|
| **0** | Audit (complete) | Seven deliverables produced, source inspected, no code changed | — |
| **1** | Architecture and data foundation | Read-only baseline and verified backup, repeatable verification command, data classification, record envelope (`updatedAt`, tombstones), single write boundary, one sync policy module | Phase 6 Android quick wins, Phase 3 client-only Decision work |
| **2** | Guest mode, accounts, free sync | Guest unchanged; account creation; transport/storage security; resumable migration; two-device sync of the approved record set; PDF metadata-only sync; deletion and export | Phase 3, Phase 5 |
| **3** | Decision Layer depth | Available time and commitments influence the recommendation; recommendation connects to focus | Phase 1, Phase 2 (client-side tasks) |
| **4** | Academic workflows | Courses/semesters/exams exist as first-class objects and feed the planner | Phase 5 |
| **5** | UX and visual refinement | One task surface instead of five; visible data-location state | Phase 4 |
| **6** | Android reliability and release readiness | Device matrix passed, notification exactness resolved, error visibility, APK built by the repeatable script | Phase 1–3 |
| **7** | Monetization and payments | One paid product purchased, verified, restored on a second device | After Phase 2 and Phase 1 |
| **8** | Growth and measurement | Opt-in, content-free analytics with dashboards for the funnels that matter | After Phase 2 |

### Critical path

```
FND-01 (baseline + verified backup)
  → FND-02 (secret hygiene)
    → FND-04 (record envelope) + FND-05 (tombstones) + FND-06 (write boundary)
      → FND-07 (sync policy module) + FND-10 (data classification)
        → ACC-02 (backend skeleton) → ACC-03 (account lifecycle) → SEC-01 (transport/storage/authorization)
          → ACC-04 (client session states) → ACC-05 (sync endpoints)
            → ACC-06 (sync engine) → SYN-01 (PDF metadata/progress scope)
              → GST-02 (migration) → ACC-08 (deletion/export)
                → PAY-02 (entitlements) → PAY-03/04 (channels) → PAY-05 (restore)
```

FND-09 is deliberately **outside** this path: focus history is neither synchronised nor migrated before OD-05 settles its retention and Plus boundary, and putting it on the path would invite shipping the current destructive cap into an account.

Nothing in Phases 3, 5, 6 or 8 blocks this chain. Phase 7 is entirely blocked by Phase 2 plus PAY-01/02.

### Hard sequencing rules

1. **No sync code before FND-04/05/06.** Shipping sync on today's schema guarantees resurrection of deleted records.
2. **No payments before migration.** A paid account with an empty notebook is the worst possible first commercial experience.
3. **No analytics before the consent surface and the allowlist test.** Retrofitting consent after sending data is not possible.
4. **Android phase 6 items marked P0 should be resolved before any account release**, because the first account release is also the first release that can lose data that cannot be re-downloaded.
5. **No sync code before FND-10.** Without a single written classification, "which fields sync" gets decided per pull request, and the PDF exclusion in the approved scope erodes one convenience field at a time.
6. **No account release before SEC-01.** Storing user records without transport protection, at-rest encryption, key separation and per-account authorization is not a sequencing preference; it is a hard gate.
7. **No claim of library sync before SYN-01.** Saying "your library follows you" while the PDFs and annotations stay behind is a support and trust problem, not a copy problem.

---

## Phase 0 — Product maturity audit (complete)

### AUD-01 — Produce the audit
- **Priority:** P0 · **Complexity:** High · **Depends on:** —
- **Modules:** none (documentation only)
- **Deliverables:** `PRODUCT_MATURITY_AUDIT.md`, `TARGET_ARCHITECTURE.md`, `SYNC_AND_DATA_STRATEGY.md`, `ANDROID_MATURITY_PLAN.md`, `MONETIZATION_STRATEGY.md`, `PRIVACY_AND_ANALYTICS_POLICY.md`, `IMPLEMENTATION_BACKLOG.md`
- **Acceptance:** all seven files exist; each architectural claim cites a path; verified/partial/doc-only/missing are distinguished; `node --test` still passes (442/442) and no source file changed.
- **Risks:** conclusions drifting from evidence; mitigated by citing files and marking unverified items explicitly.

---

## Phase 1 — Architecture and data foundation

### FND-01 — Working-copy baseline and backup verification (read-only)
- **Priority:** P0 · **Complexity:** Low · **Depends on:** —
- **Modules:** repository root; a manifests directory outside the served tree
- **Acceptance:**
  - A baseline manifest is generated **read-only**: relative path, size and content hash for every source, asset and document file in the working copy. The scope is defined by directory, not by version-control state — the working copy is not a repository and no VCS is assumed — with `dist/`, `www/`, `node_modules/` and `android/build/` listed separately as generated output and excluded from the baseline. Generating the manifest modifies nothing.
  - An independent copy of the working copy is taken to storage that is not the working disk, and a restore into a scratch location is verified by comparing manifest hashes: every file matches or the difference is written down.
  - A one-page note states the working-copy boundary (what is Production, what is this copy, what may be edited) and how to re-run the manifest after a change.
  - Explicitly out of scope: initialising a repository, committing, tagging or any other write to version history. The absence of version control is recorded as an open process risk owned by the product owner (`PRODUCT_MATURITY_AUDIT.md` §8.5).
- **Risks:** a baseline that is never restored is not a backup — the restore test is the deliverable, not the manifest. Keystore material must not be copied into any location tracked as documentation or assets.

### FND-02 — Secret hygiene audit and rotation decision
- **Priority:** P0 · **Complexity:** Low · **Depends on:** FND-01
- **Modules:** `android/keystore.properties`, `android/daftarche-release.jks`, `server/push-server.js`, local verification script
- **Acceptance:** written statement of whether the release keystore and its passwords were ever copied anywhere outside this disk; keystore files confirmed absent from the baseline manifest, from any archived copy held alongside documentation, and from the generated `www/` tree; if exposure is suspected, a rotation plan exists (new key, store listing migration path per channel).
- **Risks:** rotating a signing key after release forces users to reinstall; older listings cannot be updated. This is why it must be settled before the next release.

### FND-03 — Repeatable local verification command
- **Priority:** P1 · **Complexity:** Low · **Depends on:** FND-01
- **Modules:** `package.json` scripts, a small verification script
- **Acceptance:** one command runs `node --test` (currently 442 tests) and `node tools/build-www.mjs`, reports each stage's exit status without masking failures through a pipe, and is the documented gate before any hand-off; a failing stage stops the run. Hosted CI is deferred: it presupposes the version-control decision in FND-01, which is not authorised here.
- **Risks:** a verification script that swallows a non-zero exit status is worse than none; the acceptance names the failure-propagation requirement for that reason. Android SDK availability stays a separate, later job.

### FND-04 — Record envelope: `updatedAt`, `serverSeq`, `schemaVersion`
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** FND-01
- **Modules:** `js/state.js` (`normalizeTask`), `js/focushistory.js`, `js/library.js`, `js/achievements.js`, `js/ledger.js`, `js/store.js`
- **Acceptance:** every syncable record carries `updatedAt`; forward migration fills it for existing records without data loss (existing records get `updatedAt = created || now`). Versioning is split deliberately: **one `schemaVersion` per store and per pushed batch**, not per record, so the receiver can validate a whole payload before applying any of it; `serverSeq` orders records; `updatedAt` is optimistic and only decides field-level conflicts. A batch with an unknown `schemaVersion` is rejected whole and the client keeps its records. Migration from schema N to N+1 is tested against a fixture containing only old fields. A repository-wide test asserts no syncable record shape lacks `updatedAt`. The existing 442 tests still pass.
- **Risks:** writing `updatedAt` on read would make records look modified constantly — it must be written only on real mutation. A per-record version marker invites half-migrated records; it is rejected in favour of one version per batch, and that choice must be recorded wherever the payload is documented.

### FND-05 — Deletion markers (tombstones)
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** FND-04
- **Modules:** `js/tasks.js:622` (and the clear-done path at 653), `js/library.js` (`softDeleteBook`, `settlePendingDelete`), `js/focushistory.js` (cap trim), `js/tasks.js` bulk actions
- **Acceptance:** every user-visible delete writes a tombstone instead of only filtering an array; tombstone carries `id`, `deletedAt`, `updatedAt`; UI behaves exactly as today (including the 5-second book undo); a test proves a deleted task is not rendered, not counted in stats, and still exists as a tombstone.
- **Risks:** forgetting one delete path (bulk clear, import overwrite, library clear) creates a resurrection bug later; enumerate every path in a test table.

### FND-06 — Single write boundary (repository)
- **Priority:** P0 · **Complexity:** High · **Depends on:** FND-04
- **Modules:** `js/state.js`, `js/tasks.js`, `js/library.js`, `js/audio.js`, `js/store.js`, `js/ledger.js`, `js/focushistory.js`, `js/achievements.js`
- **Acceptance:** no module outside the repository assigns `state.tasks` or writes `daftarche-*` sync keys directly; all mutations go through repository functions that stamp `updatedAt`, emit change events, and **enqueue an outbox entry only when a session exists**. Local persistence is never conditional on a server response: a write succeeds, returns, and renders whether or not the network is reachable. Guest mode is a local system only — no guest mutation may create remote work. A test runs with networking disabled and no session, performs every core mutation, and asserts that data persisted and the outbox stayed empty.
- **Risks:** large mechanical refactor with no behaviour change intended — the full test suite must stay green at every step, and the work must land in slices (tasks first, then books, then history). A repository that silently waits for the server would turn an offline-first app into a networked one.

### FND-07 — Extract the merge policy into one reviewed module
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** FND-04
- **Modules:** new `syncPolicy` module; `js/backup.js` (reuse, do not duplicate)
- **Acceptance:** the rules for records classified **S** (completion wins, progress floors, mood per day, achievement monotonicity) exist once and are used by both the backup merge and sync; unit tests cover each rule; a conflict is returned as data, never silently dropped. **The backup path keeps its annotation union and must not be weakened.** `syncPolicy` must contain no rule for `highlights`, `notes`, `cover` or any other device-local/excluded field, and a test asserts exactly that. The separation is specified in `SYNC_AND_DATA_STRATEGY.md` §7.6.
- **Risks:** two drift opportunities in opposite directions — an annotation rule copied into sync (which would silently widen the approved scope) and a backup rule removed to "simplify" the shared module (which would take working functionality away from users).

### FND-08 — Stable installation identity
- **Priority:** P1 · **Complexity:** Low · **Depends on:** FND-01
- **Modules:** `js/store.js` or a new small module
- **Acceptance:** a random UUID created on first run, persisted locally, used for sync idempotency; not derived from hardware; regenerable on user request (used by privacy withdrawal).
- **Risks:** none material; must not be confused with an account id.

### FND-09 — Focus history: sync, retention and the Plus boundary
- **Priority:** P1 · **Complexity:** Low · **Depends on:** FND-04, FND-10, and an owner decision (OD-05). Deliberately **not** on the critical path
- **Modules:** `js/focushistory.js` (`HISTORY_CAP = 100`), `js/stats.js`
- **Acceptance:** three separate questions are answered in writing before any code changes — (1) does history sync at all, (2) how long is it retained locally and server-side, (3) is analysis over it a Plus benefit — then implemented consistently in the local trim and the sync path, with a test proving no session silently vanishes from the server's view. Swapping in sync without answering (2) ships the current destructive cap into the account, which is the failure mode this task exists to prevent. Sync of history is never paid under any answer.
- **Risks:** silently trimming synced data is indistinguishable from data loss from the user's perspective.

### FND-10 — Data classification: syncable, device-local, excluded
- **Priority:** P0 · **Complexity:** Low · **Depends on:** FND-04
- **Modules:** new `dataClassification` module, `js/constants.js` (`STORAGE_KEYS`), `js/state.js`, `js/library.js`, `js/focushistory.js`
- **Acceptance:** one module declares, for every storage key and every record field, exactly one status — **S**, **D**, **P**, **X** or **?** — matching the canonical table in `SYNC_AND_DATA_STRATEGY.md` §5.2 and the field allowlist in §5.3. A test enumerates `STORAGE_KEYS` and the field set of each record and fails when a key or field is unclassified. The book allowlist is positive and closed: `id`, `title`, `addedAt`, `numPages`, `lastPage`, `lastReadAt`, `completedPages`, `stats`, `goal`; `highlights`, `notes`, `cover` and both IndexedDB databases are classified device-local/excluded, and a test asserts the sync projection of a book contains none of them. The per-device sync-suspension flag is classified device-local. New fields are unsynced by default. **A `P` or `?` classification is inactive, not merely unscheduled:** no pending key or field may enter the projection, the migration snapshot or the outbox, and no conflict rule may run for it, until its decision is recorded as approved (OD-06 for preferences; OD-05, OD-08, OD-09 and OD-10 for the rest). The repository projection, the migration snapshot and the outbox all consume this module rather than their own lists.
  - **Negative tests are the point of this task.** For every **D** and **X** field there is a test that submits a record containing it and asserts rejection at each of the three boundaries (projection, migration snapshot, outbox). A classification that is only an enum without rejection tests does not satisfy this task.
- **Risks:** a second, divergent list in the sync engine — the test must assert the engine imports the module. New fields default to *unsynced* until classified, never the reverse.

---

## Phase 2 — Guest mode, accounts and synchronisation

### GST-01 — Guest mode contract tests
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** FND-06
- **Modules:** `js/app.js`, `js/onboarding.js`, `js/settings.js`, new tests
- **Acceptance:** automated tests assert that with no session: every page renders, every core action works, no network request is issued, and no login prompt is shown at first run. This test suite exists **before** account code so it cannot be broken quietly later.
- **Risks:** tests that only check "no exception" would not catch a soft-walled UI; assert on visible controls.

### ACC-01 — Authentication provider decision
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** FND-01
- **Modules:** decision record only
- **Acceptance:** written comparison of self-hosted auth vs. a managed identity service, including whether hosted services and their billing are usable from the target market; storage of tokens on Android addressed; decision recorded with rationale.
- **Risks:** choosing a provider that becomes unreachable from the target region; verify before building.

### ACC-02 — Backend skeleton and deployment target
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** ACC-01, FND-01
- **Modules:** new backend service (separate from `server/push-server.js`), deployment configuration
- **Acceptance:** service starts, exposes a health endpoint, has structured logging without personal content, environment-based configuration, and a documented deployment procedure for the selected host; no secrets in the repository.
- **Risks:** the existing `server/` is a single-purpose Express app; do not extend it into an account service (see `TARGET_ARCHITECTURE.md` D7).

### ACC-03 — Account lifecycle endpoints
- **Priority:** P1 · **Complexity:** High · **Depends on:** ACC-02
- **Modules:** backend auth, client `sessionStore`
- **Acceptance:** sign-up, sign-in, sign-out, token refresh, session revoke; password hashed with a modern KDF; rate limiting on auth routes; email/phone verification if required by the product decision; all endpoints covered by tests including failure paths.
- **Risks:** account takeover via weak reset flows; enumeration via error messages.

### ACC-04 — Client session state and the three user states
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** ACC-03
- **Modules:** new `sessionStore`, `js/app.js`, `js/settings.js`, `js/profile.js`
- **Acceptance:** `guest | signed-in | signed-in-offline` is explicit in code and covered by tests; offline operation never blocks; expired session degrades to offline-tolerant rather than a login wall; sign-out offers "keep local copy" vs "remove from device".
- **Risks:** a subtle bug here turns guest mode into a broken mode — the highest reputational risk in the whole backlog.

### ACC-05 — Sync endpoints
- **Priority:** P1 · **Complexity:** High · **Depends on:** ACC-03, SEC-01, FND-04, FND-05, FND-10
- **Modules:** backend records API
- **Acceptance:** push operations (idempotent, keyed by device + op id), pull since cursor (`serverSeq`), per-record conflict outcome, tombstones included, payload size limits, validation rejects unknown fields; API contract documented. In addition, and binding: **every route derives the account from the session and never from a client-supplied id**; a record kind or field outside the approved classification fails validation instead of being stored; binary-shaped payloads (blobs, data URLs for a cover, annotation arrays, music) are rejected with a specific error; transport is HTTPS only.
- **Risks:** cursors that skip records on concurrent writes (test with interleaved writers); a permissive validator that quietly accepts a widened payload, which would break the approved scope silently.

### ACC-06 — Sync engine on the client
- **Priority:** P1 · **Complexity:** High · **Depends on:** ACC-05, FND-06, FND-07, FND-10
- **Modules:** new `syncEngine`, `js/store.js`, `js/bus.js`
- **Acceptance:** outbox flush on foreground/online/debounced mutation; exponential backoff with jitter; 401 handled without blocking local use; conflicts merged by `syncPolicy`; cursor advanced only after apply; a visible "last synced / N pending" line in settings. The outbox rejects binary or unclassified payloads **at enqueue** through `dataClassification`; the queue survives an app restart; the engine never opens `daftarche-books` or `daftarche-audio`; no token, receipt or secret is written to a log on any path, including error paths.
- **Risks:** infinite retry loops on a permanently rejected record; partial apply leaving inconsistent state — apply must be transactional per batch; a debug log added during development leaking a token.

### SEC-01 — Transport, storage, key and authorization baseline
- **Priority:** P0 · **Complexity:** High · **Depends on:** ACC-02, ACC-03
- **Modules:** backend configuration, database and backup configuration, secret manager, client `sessionStore`, `_headers`, logging
- **Acceptance:**
  - Every client–server call uses HTTPS with a valid certificate chain; a plaintext request is refused rather than silently upgraded; HSTS set; the client never disables certificate validation.
  - Database, backups and object storage are encrypted at rest by the platform mechanism, demonstrated by restoring from an encrypted snapshot.
  - Keys live in a secret manager, separate from the data store and from the repository; rotation is documented and rehearsed once.
  - Passwords are stored only as a modern KDF hash; session and refresh tokens are hashed at rest where the design permits and are never placed in a URL.
  - A test drives sign-in, sync and purchase verification with logging captured and asserts that no token, password, receipt payload or secret appears in any log line.
  - Every record route is account-scoped from the session; a two-account test proves account B cannot read, overwrite, delete or enumerate account A's records, including through a forged id or cursor.
  - A written statement in the repository records the model as standard encryption in transit and at rest, **explicitly not E2EE**, with operator-side access technically possible.
- **Risks:** describing this as E2EE — forbidden; one unauthenticated route or one token in a debug log defeats the model, so any change to auth or logging re-runs both the two-account test and the log-scrubbing test.

### GST-02 — Guest-to-account migration
- **Priority:** P0 · **Complexity:** High · **Depends on:** ACC-05, ACC-06, FND-10
- **Modules:** new migration module, backend migration endpoints, account screens
- **Acceptance:** visible progress with cancellation before the first page and resume after. **Local data is preserved until the server confirms the final page accepted**, and the local store switches to synced mode only after that acknowledgement; a migration that never completes leaves a working guest app and a resumable server-side draft. Retries are idempotent: re-sending the same page must not duplicate a record, and re-running the whole migration must converge on the same server state (tested by replaying from the first page). Interruption at every step is tested by simulated aborts, and the resume path is tested from each one. Every category is covered explicitly — one test per **S** record kind that must arrive, and one per **D**/**X** field that must never appear in any request: PDF bytes, `highlights`, `notes`, `cover`, music, the live session, `daftarche-photo`. The progress screen reports record counts, and the copy never describes the account as a full library backup.
- **Risks:** this is the highest-consequence flow in the product — it needs a dedicated acceptance suite and a manual rehearsal on two devices. A second risk specific to the approved scope: users expect "everything moves to my account", so the screen must say plainly, before it runs, that PDFs and annotations stay on this device.

### ACC-07 — Second-device sign-in flow
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** ACC-06, FND-10
- **Modules:** account screens, `syncEngine`
- **Acceptance:** matches the five binding rules in `TARGET_ARCHITECTURE.md` §4.2. Empty device → restore with no dialog. Device with local data → **merge is the default and the only non-destructive path**. Replacement is an explicit act, separate from the sign-in step, naming what will be lost with a count of affected local records. Signing in never deletes a local record. Synchronisation starts because the account carries it — no payment, upgrade or trial prompt appears. Only status-**S** records are pulled; a book restored without its PDF is marked as needing the file, not deleted. A refusal to choose leaves the device syncing nothing rather than guessing. A test signs in over a populated local store and asserts every pre-existing record still exists; a second test asserts that the destructive path requires the extra confirmation.
- **Risks:** users losing local records by accepting a default they did not read; a "use my cloud data" default that quietly replaces a populated device. Whether a device may stay **permanently** local-only is OD-07 and must not be decided by this task.

### ACC-08 — Account deletion and full export
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** ACC-06
- **Modules:** backend deletion + export, `js/settings.js:734-737`, new screens
- **Acceptance:** one action deletes account records, tombstones, cursors, migrations, devices, entitlements and analytics ids; local device data is removed only under a **separate** confirmation that uses the existing wipe path (`js/settings.js:734-737`), and declining it leaves the device fully usable as a guest; export produces a machine-readable file of everything the server holds. The export screen must state what the account never held — PDF files, PDF highlights, PDF notes, book covers, uploaded music — and point the user at the local JSON backup and PDF pack for the documents and annotations. Uploaded music has no export today, and whether the manual local export must carry it is OD-18: the copy states that plainly, without promising a music export and without declaring music permanently unexportable. The deletion screen states whether purchases are recoverable and how, but **no grace period is assumed or implemented** — that is OD-11, and neither a silent retention window nor a promise of one may ship first. The entitlement consequences of deletion and later re-creation are OD-12. Export stays free. A test asserts no residual rows and that a declined device wipe leaves local data intact.
- **Risks:** orphaned rows in one table makes the "we deleted your data" claim false; an export that looks complete while the user's PDFs were never in it; a grace period added "for safety" that the policy never disclosed.

### ACC-09 — Device management
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** ACC-03
- **Modules:** backend devices, account screens
- **Acceptance:** device list with label, platform, last seen; remote sign-out of a single device; the current device cannot be removed without signing out.
- **Risks:** low; but a stale device list is worse than none if it never updates.

### ACC-10 — In-app privacy and data screen
- **Priority:** P1 · **Complexity:** Low · **Depends on:** ACC-04, FND-10
- **Modules:** settings page, new copy
- **Acceptance:** one screen answers four questions in plain language, for the state the user is actually in: **(1) where is my data** — device only, or device plus the approved record set in the cloud; **(2) what synchronises** — tasks, book metadata and reading progress, activity records; **(3) what is never sent to Daftarche's servers, and therefore never synchronised** — PDF files, PDF highlights, PDF notes, book cover images, uploaded music; **(4) what a Manual Local Backup/Export can contain** — the existing JSON file, which carries PDF annotations and book covers, and the separate PDF pack, which carries the PDF files themselves; these are user-initiated local files that need no account and no connection, so the screen must not describe exclusion from Sync as "never leaves the device". Uploaded music is in no export today and whether the manual export must include it is **OD-18**; the copy states that as the current limitation, without promising a music export and without declaring music permanently unexportable. It describes the protection model as encryption in transit and at rest with operator-side access technically possible, and **never** says end-to-end encrypted. Export and delete entry points are linked; the wording stays honest for a guest who has chosen not to register.
- **Risks:** copy drifting from behaviour — generate both lists from the classification module the sync engine uses (FND-10), never from prose typed twice.

### SYN-01 — PDF metadata and reading-progress synchronisation (file stays local)
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** ACC-05, ACC-06, FND-10
- **Modules:** `js/library.js` (book projection), `js/reader.js` (write path), `syncPolicy`, `syncEngine`, shelf UI
- **Acceptance:**
  - The synced projection is exactly `id`, `title`, `addedAt`, `numPages`, `lastPage`, `lastReadAt`, `completedPages`, `stats`, `goal` (verified field set: `js/library.js:685-686`, `js/reader.js:1822` and `:1904-1914`). A test enumerates the book record keys and fails if the projection carries any other key or drops one of these.
  - `highlights`, `notes` and `cover` are excluded by the projection, and a test asserts the outbox rejects a payload containing any of them.
  - No sync code path opens the `daftarche-books` object store; a test asserts the engine never references the blob database.
  - Two-device test: page position, completed pages and per-day counters written on device A appear on device B with no PDF present on B.
  - Device B shows the book's progress and marks it unavailable for reading on this device; the absent file produces **no** tombstone and **no** metadata delete on either side (asserted explicitly).
  - Deleting the book on device A removes the metadata on B while leaving B's local file untouched until the user confirms removal there.
  - Device B offers a single action to **attach** a local PDF to the restored record, and the attachment preserves page position, completed pages, per-day counters and goal (`SYNC_AND_DATA_STRATEGY.md` §10.1).
  - A re-imported PDF is never merged automatically on a filename match; the matching rule is OD-17. Until it is decided, the test asserts that a re-import produces a surfaced attachment offer, never a silent duplicate and never a silent merge.
- **Risks:** the approved scope eroding through convenience ("also send the cover"); the projection test is the defence. Device-local book ids (`js/library.js:683`) make reconciliation a design task, not a lookup.

---

## Phase 3 — Decision Layer and core productivity

### DEC-01 — "How much time do I have?" input
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** —
- **Modules:** `js/decision.js` (new signal), `js/today.js`, `js/chipgroup.js`
- **Acceptance:** a one-tap time-available control (e.g. 10/25/45/60/an hour+) filters or boosts candidates whose `durationMin` fits; tasks with unknown duration are never assumed short; behaviour with no selection is byte-identical to today (regression test on existing `tests/decision.test.mjs` cases).
- **Risks:** making the recommendation jittery; the new signal must be additive and testable in isolation.

### DEC-02 — Commitment awareness (planned spans and busy time)
- **Priority:** P1 · **Complexity:** High · **Depends on:** DEC-01
- **Modules:** `js/decision.js`, `js/planner.js`, `js/calendar.js`, `js/state.js` (`timeFrom`/`timeTo`)
- **Acceptance:** the engine receives today's planned spans and avoids recommending a 90-minute task inside a 30-minute gap; overlapping commitments are surfaced (warning, not blocking) when planning; existing spans become meaningful for the first time.
- **Risks:** timezone and midnight-crossing bugs; the span fields are minutes-past-midnight pairs, so a span ending the next day is not representable — decide explicitly whether that is supported.

### DEC-03 — Recommendation → focus handoff
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** DEC-01
- **Modules:** `js/today.js`, `js/focus.js`
- **Acceptance:** one tap starts a focus session pre-filled with the recommended task and a sensible duration; returning from focus updates the recommendation; skipping persists only for the session, as today.
- **Risks:** focus session state and recommendation state both being module-level singletons; define the ownership clearly.

### DEC-04 — Local outcome tracking for recommendations
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** DEC-02
- **Modules:** `js/decision.js`, `js/decisioncontext.js`, `js/ledger.js`
- **Acceptance:** accepted/skipped outcomes are recorded locally (no network), feed the existing context layer within its bounded rules, and are visible in insights; the engine's "never rewrite the base score" invariant is preserved and tested.
- **Risks:** turning a transparent, explainable engine into an opaque one; keep the reason strings human and the modifier capped as today.

### DEC-05 — Planner conflict detection
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** DEC-02
- **Modules:** `js/planner.js`
- **Acceptance:** two tasks planned into the same span produce a visible, dismissible warning; no automatic rescheduling.
- **Risks:** noisy warnings in a dense week — allow a per-day dismissal.

---

## Phase 4 — Academic workflows

### ACD-01 — Courses and semesters as first-class objects
- **Priority:** P2 · **Complexity:** High · **Depends on:** FND-06
- **Modules:** new domain module, `js/state.js`, `js/tasks.js`, planner
- **Acceptance:** a course has a name, term, colour and optional meeting times; tasks can be assigned to a course; filtering by course exists; deleting a course does not delete its tasks (they become unassigned); new records follow the FND-04 envelope and are syncable.
- **Risks:** over-modelling early; start with name + term + optional weekly meeting only.

### ACD-02 — Exam and assignment types
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** ACD-01
- **Acceptance:** a task can be marked exam/assignment/reading with a distinct visual treatment and a countdown; the decision engine weights exams appropriately (a new, tested score component, not a hack inside deadline scoring).
- **Risks:** duplicating the existing priority field; keep one source of urgency.

### ACD-03 — Weekly timetable view
- **Priority:** P3 · **Complexity:** Medium · **Depends on:** ACD-01, DEC-02
- **Acceptance:** a read-only week grid of course meetings; the free gaps feed DEC-02 as available time.
- **Risks:** the app already has three calendar zooms; add this only if it replaces, not adds to, existing surfaces.

### ACD-04 — Study planning assistance
- **Priority:** P3 · **Complexity:** High · **Depends on:** ACD-02, DEC-02
- **Acceptance:** a proposed study allocation for an exam based on remaining days and available gaps, presented as a suggestion the user can accept, never applied silently.
- **Risks:** scope creep into an opaque scheduler that contradicts the product's deterministic, explainable decision philosophy.

---

## Phase 5 — UX and visual refinement

### UX-01 — Consolidate task surfaces
- **Priority:** P2 · **Complexity:** High · **Depends on:** FND-06
- **Modules:** `js/today.js`, `js/tasks.js`, `js/planner.js`, `js/calendar.js`, `js/week.js`, shared row component
- **Acceptance:** one shared task-row renderer and one shared edit path; each surface keeps only its distinct affordance; a written inventory shows no capability exists on one surface and is silently missing on another.
- **Risks:** regression across five surfaces with no DOM test coverage; introduce a browser regression check for the task list before refactoring.

### UX-02 — Visible data-location state
- **Priority:** P2 · **Complexity:** Low · **Depends on:** ACC-04
- **Acceptance:** the header or settings always answers "where is my data?" in one line; the state changes with the session; offline-and-signed-in is distinguishable from guest.
- **Risks:** copy that implies cloud safety for guest users.

### UX-03 — Onboarding refresh for the new model
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** ACC-04, DEC-01
- **Acceptance:** the three-step flow (`js/onboarding.js`) still works with no account; the account offer appears once, after value is demonstrated, and is dismissible permanently; the tour still runs on a page containing the user's own task.
- **Risks:** turning a calm onboarding into a signup funnel — the strongest brand risk in this phase.

### UX-04 — Documentation accuracy pass
- **Priority:** P2 · **Complexity:** Low · **Depends on:** —
- **Acceptance:** `docs/roadmap.md` corrected (PDF.js is now local, not CDN-pinned; `reader.js` is ~2,264 lines, not ~1,500); `_headers` CSP dropped the unused `cdn.jsdelivr.net` allowances or a comment explains why they remain; every doc statement matches the code.
- **Risks:** none; this is pure debt repayment.

---

## Phase 6 — Android reliability and release readiness

### AND-01 — Resolve notification exactness
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** —
- **Modules:** `AndroidManifest.xml`, `js/native.js`, notification copy
- **Acceptance:** either exact alarms are requested and work with the store policy justification, or the UI and copy state that reminders are approximate; a device log proves the chosen behaviour.
- **Risks:** store policy questions around exact alarms; a late reminder in a planning app reads as a bug.

### AND-02 — Physical device test matrix
- **Priority:** P0 · **Complexity:** Medium · **Depends on:** FND-03
- **Modules:** `docs/` (recorded results)
- **Acceptance:** the matrix in `ANDROID_MATURITY_PLAN.md` §4 executed on at least one mid-range and one low-end device (or documented emulator substitutes), with results written down including failures.
- **Risks:** findings may invalidate assumptions about glass-theme performance and timer behaviour.

### AND-03 — Opt-in, content-free error visibility
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** PRV-01
- **Acceptance:** uncaught errors and the existing `safe()` failures are reported only with explicit consent, carrying an error code, module key and version — never content, never a URL with query parameters.
- **Risks:** accidental capture of user text in stack traces or console arguments; must scrub arguments.

### AND-04 — Make backup prominent on Android
- **Priority:** P1 · **Complexity:** Low · **Depends on:** —
- **Modules:** `js/backup-nudge.js`, `js/settings.js`, first-run flow
- **Acceptance:** given `allowBackup="false"`, the user is told early and clearly that uninstalling removes data and that export is the only backup; the nudge respects dismissal and never blocks.
- **Risks:** alarming copy at first run; phrase it as an option, not a warning.

### AND-05 — Performance pass on low-end hardware
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** AND-02
- **Modules:** `css/glass.css`, `css/base.css`, `js/worlds.js`, `js/motion.js`
- **Acceptance:** measured start-up and interaction timings on the low-end device; glass themes and world animations degrade gracefully; reduced motion and reduced transparency verified.
- **Risks:** unmeasured optimisation; every claim must be backed by a measurement.

### AND-06 — Deep links for reminders and purchase returns
- **Priority:** P3 · **Complexity:** Medium · **Depends on:** ACC-04
- **Acceptance:** a notification opens the relevant task; a purchase return opens the entitlement screen; no other intent filter introduced.
- **Risks:** undecided; defer until payments exist.

---

## Phase 7 — Monetization and payments

### PAY-01 — Product catalogue decision and server-side catalogue
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** FND-10
- **Acceptance:** the premium boundary is written down (what is free forever, what is Plus, what is one-time), existing earned worlds explicitly excluded from paid access; **synchronisation is not in the catalogue** — no sync product, no sync trial, no paid device limit, and the free account is documented as carrying sync; a server-side catalogue serves names and prices per channel; the client hard-codes no price.
- **Risks:** retroactively charging for earned content — treat as a hard prohibition. The second risk is a "premium sync" row reappearing in a price table or store listing, which the catalogue test must catch.

### PAY-02 — Entitlement service and cached client state
- **Priority:** P0 · **Complexity:** High · **Depends on:** ACC-06, PAY-01
- **Acceptance:** idempotent grants keyed by channel order id; permanent vs expiring entitlements; client caches a snapshot with a fetch timestamp and grace window; a manually granted test product unlocks a theme on two devices; expiry degrades to the default theme without deleting data; an account with **no** entitlement still syncs normally, proving sync is not gated on payment.
- **Risks:** silent double-grant or double-charge; refund path leaving a live entitlement.

### PAY-03 — Android store billing channel
- **Priority:** P1 · **Complexity:** High · **Depends on:** PAY-02, AND-01
- **Acceptance:** one non-consumable pack purchased through the store channel, verified server-side with signature validation and a developer-payload binding the purchase to the account, then active after reinstall and on a second device.
- **Risks:** store policy on parallel channels; signature verification done wrong (client-side only) is worse than none.

### PAY-04 — Web checkout channel
- **Priority:** P2 · **Complexity:** High · **Depends on:** PAY-02
- **Acceptance:** web purchase via a local card gateway with server-side verification and an idempotent callback; not reachable from the store-distributed Android build; retry-safe on abandoned payment.
- **Risks:** policy conflict if offered inside a store build; callback replay.

### PAY-05 — Restore purchases
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** PAY-03
- **Acceptance:** a settings action refreshes entitlements from the server and, where supported, asks the channel to restore; a replaced device recovers everything with no support contact.
- **Risks:** two sources of truth (channel and server) disagreeing — server wins, always.

### PAY-06 — Entitlement-aware UI
- **Priority:** P1 · **Complexity:** Medium · **Depends on:** PAY-02
- **Modules:** `js/theme.js` (`isThemeUnlocked`), `js/chipgroup.js`, `js/settings.js`
- **Acceptance:** lock state is `earned OR entitled`; the picker explains each lock precisely (achievement vs purchase); the birthday theme path and the test-only `QA_UNLOCK_ALL_THEMES` bypass still work; tests cover all four combinations.
- **Risks:** a locked theme falling back to the wrong half of the palette table (existing logic in `allowedTheme`, must be preserved).

### PAY-07 — Refund, expiry and support tooling
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** PAY-02
- **Acceptance:** refund revokes the entitlement without deleting data; an admin-visible order lookup exists for support; every state change is logged with an order id and no personal content.
- **Risks:** support cannot answer "I paid and see nothing" without this.

---

## Phase 8 — Growth and measurement

### PRV-01 — Consent surface and consent record
- **Priority:** P1 · **Complexity:** Low · **Depends on:** ACC-10
- **Acceptance:** analytics is off by default; a settings toggle with an explicit description of what is and is not sent; consent stored locally with version, timestamp and policy hash and sent with each batch; withdrawal deletes the installation id.
- **Risks:** bundling consent with the account terms — explicitly forbidden by the brief.

### PRV-02 — Event allowlist and schema test
- **Priority:** P1 · **Complexity:** Low · **Depends on:** PRV-01
- **Acceptance:** the entire event vocabulary lives in one module; a test fails if any payload key is outside the allowlist or if any value is a free-text string beyond a fixed enum; the list is published alongside the policy.
- **Risks:** a future contributor adding "just one" contextual field; the test is the only durable defence.

### GRW-01 — Analytics ingestion endpoint
- **Priority:** P2 · **Complexity:** Medium · **Depends on:** PRV-02
- **Acceptance:** batch ingestion, consent required per installation, 90-day raw retention, no user id, IP not stored beyond truncated form, rate limited.
- **Risks:** quietly becoming a behavioural tracking system; keep the vocabulary closed and the retention short.

### GRW-02 — Funnel measurement with shipping decisions attached
- **Priority:** P2 · **Complexity:** Low · **Depends on:** GRW-01
- **Acceptance:** for each measured funnel (onboarding completion, first task, first focus, first book, migration success, paywall → purchase) there is a named decision the metric will inform, written before collection starts.
- **Risks:** collecting data with no decision attached — exactly the kind of collection the brief discourages.

### GRW-03 — Pricing evidence
- **Priority:** P3 · **Complexity:** Low · **Depends on:** GRW-02, PAY-05
- **Acceptance:** a written price band informed by observed willingness signals (paywall views, purchase starts, completions), still subject to product-owner approval.
- **Risks:** pricing before evidence; this task exists to prevent that.

---

## 12. Summary of P0 items

| ID | Item | Why it is P0 |
|---|---|---|
| FND-01 | Baseline manifest + verified backup | No review or rollback exists, and a single lost disk would take the only copy |
| FND-02 | Secret hygiene | Release key may be exposed |
| FND-04 | Record envelope | Sync cannot be correct without it |
| FND-05 | Tombstones | Deletes would resurrect |
| FND-06 | Write boundary | Sync cannot observe changes otherwise |
| FND-10 | Data classification | The approved sync scope erodes without one written list |
| SEC-01 | Transport, at-rest, key, token and authorization baseline | Approved; storing account records without it is unacceptable |
| SYN-01 | PDF metadata/progress sync only | The approved scope must be enforced, not merely stated |
| GST-02 | Guest→account migration | Highest-consequence flow; risks user data |
| ACC-08 | Account deletion and export | Legal and trust requirement |
| PAY-02 | Entitlement service | Payments cannot be safe without it |
| AND-01 | Notification exactness | Core promise of a planning app |
| AND-02 | Device matrix | Converts "unverified" into "known" |
| AUD-01 | This audit | Complete |

---

## 13. Dependencies that commonly get missed

1. **FND-07 before ACC-06.** Writing sync merges before the policy module exists guarantees two divergent implementations.
2. **GST-01 before ACC-04.** Without a guest contract test, account work silently degrades guest mode and nobody notices until users complain.
3. **ACC-08 before PAY-02.** An account that cannot be deleted must not be able to hold a purchase.
4. **PRV-01/02 before any analytics call.** Consent retrofitted after sending is not consent.
5. **AND-04 before any paid release.** A paying Android user whose data vanishes on uninstall is the worst possible outcome of the whole roadmap.
6. **UX-04 (doc accuracy) before the next release note**, because release notes are generated from `js/changelog.js` and the changelog already describes behaviour the roadmap text contradicts.
7. **FND-10 before ACC-05, ACC-06, GST-02 and SYN-01.** Four tasks depend on one classification; if each defines its own list, the PDF exclusion decays quietly.
8. **SEC-01 before the first account release, not after it.** Authorization and log hygiene cannot be added to records that already exist in the wrong place.
9. **ACC-10 after FND-10, never before.** A privacy screen written from prose drifts from the engine within one release.
10. **FND-09 only after OD-05.** "Sync the history" and "keep every session forever" are different promises; answering one and shipping the other is how a retention cap quietly becomes data loss.
