# Target Architecture — Daftarche

This document describes what exists, what is proposed, and why. It is a direction, not an approved design: no part of it has been implemented.

**Three decisions in this document are approved by the product owner and are not proposals:** synchronisation is free for every registered account; data is protected by standard encryption in transit and at rest with separately managed keys (explicitly not E2EE); PDF synchronisation is limited to metadata and reading progress, with files, annotations and music excluded. They are marked **[APPROVED]** where they appear. Everything else remains a recommendation.

---

## 1. Current architecture (verified)

### 1.1 Shape

```
index.html (single document, 116 KB, 9 page sections)
  └─ <script type="module" src="js/app.js">        ← single entry
       ├─ js/state.js                              ← in-memory singleton store
       ├─ js/store.js                              ← localStorage persistence + migrations
       ├─ js/bus.js                                ← tiny event bus
       ├─ ~74 view/domain modules (js/*.js, 27,917 lines)
       └─ DOM: imperative rendering per page

css/ (25 files, hand-written, logical properties, token-based)
assets/ fonts, icons, character art, vendor/pdfjs (local)
sw.js   offline shell cache keyed by DAFTARCHE_BUILD
server/ optional Express Web Push service (dormant from the client)
android/ Capacitor 8 project wrapping www/ (produced by tools/build-www.mjs)
```

### 1.2 Characteristics

| Property | Observation | Evidence |
|---|---|---|
| Framework | None. Native ES modules, no bundler, no transpile | `js/app.js:1-45`; `README.md:1-8` |
| State | One mutable singleton, mutated directly by feature modules | `js/state.js` `export const state` |
| Reactivity | Event bus + explicit re-render calls | `js/bus.js`, `notify()` calls throughout |
| Persistence | `localStorage`, sharded per key, debounced; `IndexedDB` for binary blobs | `js/store.js` |
| Boot resilience | Each section initialised inside `safe(name, fn)` so one failure does not stop the app | `js/app.js:47-50` |
| Platform | Capacitor 8 on Android; PWA on web; a small native bridge for insets, bars, back, files, notifications | `js/native.js`, `MainActivity.java` |
| Secrets | Push server reads VAPID keys and `ADMIN_API_KEY` from environment only | `server/push-server.js:51-70` |

### 1.3 Structural couplings worth naming

1. **`state` is imported by many modules and mutated in place.** `js/tasks.js` assigns `state.tasks = …` directly (e.g. line 622). There is no repository boundary, so a sync layer cannot observe changes without either wrapping the writers or diffing snapshots.
2. **Views read storage directly.** `js/library.js` keeps its own module-level `books` array initialised from `readJSON`, i.e. the library is a second, independent store with its own save path. Same for `js/audio.js` (IndexedDB).
3. **Cross-module side effects via window events.** `daftarche:books-changed`, `theme-applied`, `close-reader`, `daftarche:storage-error` are custom events, not part of a typed contract.
4. **`today.js` → `decision.js` → `decisioncontext.js` is the one genuinely layered domain.** It is DOM-free below `today.js` and fully unit-tested. This is the pattern to extend, not to replace.

---

## 2. Proposed target architecture

Principle from the brief, restated as a constraint on every component:

> Guest-first for free usage. Account-required for synchronisation and commercial functionality.

### 2.1 Client layers

```
┌─────────────────────────────────────────────────────────────┐
│ View layer (existing js/*.js pages, unchanged contract)     │
├─────────────────────────────────────────────────────────────┤
│ Domain layer (tasks, focus, library, decision, ledger)      │
│   — gains an explicit write API instead of raw state writes │
├─────────────────────────────────────────────────────────────┤
│ NEW  Data layer: repository + change log                    │
│   localDb (IndexedDB primary) ← → legacy localStorage       │
│   every mutation writes {record, updatedAt, deviceId, op}   │
├─────────────────────────────────────────────────────────────┤
│ NEW  Session & entitlement state                            │
│   sessionStore: signed-out | signed-in | signed-in-offline  │
│   entitlements: cached, server-authoritative                │
├─────────────────────────────────────────────────────────────┤
│ NEW  Sync engine (only active when signed in)               │
│   outbox → push → pull → merge → apply → prune tombstones   │
├─────────────────────────────────────────────────────────────┤
│ Platform adapters                                          │
│   web: localStorage/IndexedDB, fetch, service worker        │
│   android: Capacitor plugins, bundled assets, no SW         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Component responsibilities (proposed)

| Component | Responsibility | Must not |
|---|---|---|
| `repository` | Single write door for domain records; assigns `updatedAt`, appends to change log, emits change events | Know about HTTP |
| `localDb` | Store records + change log durably; support export of full snapshot | Contain business rules |
| `sessionStore` | Persist auth state and device id; survive restart; never store the raw password | Decide entitlements |
| `entitlements` | Read cached entitlement snapshot; expose `has(productId)`; refresh from server | Grant without a server-verified purchase |
| `syncEngine` | Push pending ops, pull remote changes, merge, resolve conflicts, retry with backoff | Write to UI directly; delete local data on failure |
| `syncPolicy` | The merge rules (reuse of `js/backup.js` semantics) | Live inside UI modules |
| `apiClient` | Typed HTTP calls, auth header, error mapping, request ids | Retry blindly on 4xx |

### 2.3 Backend responsibilities (proposed)

**Functional:** authentication, account lifecycle, sync endpoints, cloud persistence of the approved record set, purchase verification, entitlement and subscription state, device registry, account deletion, full data export, and (optionally) minimal consent-based analytics ingestion.

**Security — [APPROVED] requirements, none of which exists yet:**

| Requirement | Meaning for this backend |
|---|---|
| Encryption in transit | Every client–server call over valid HTTPS/TLS. No plaintext fallback, no mixed content, HSTS, certificate validation on the client. Android already forbids cleartext (`capacitor.config.json`), which must stay true. |
| Encryption at rest | Database volumes, object storage and backups encrypted by a standard managed mechanism; snapshots inherit it. |
| Key management | Keys and credentials held in a secret manager or KMS, separate from the database, from application data and from the source tree. Rotation documented. No key committed to the project. |
| Credential handling | Passwords stored only as a modern KDF hash. Session and refresh tokens never written to logs, never sent to analytics, and hashed at rest where the design permits. |
| Authorization | Every record read and write is scoped to the `userId` derived from the authenticated session, never from a client-supplied identifier. Two-account isolation is a tested property, not an intention. |

**Explicit non-responsibility: binaries and annotations.** The backend never stores, receives, proxies or reconstructs a PDF file, a PDF highlight or note, a book cover image or an uploaded music track. It stores task text and book titles as opaque strings for the account owner and never needs to parse them. **Opaque is not the same as unreadable:** it means the application assigns no semantics to the content, not that the content is encrypted against the operator. An authorised operator holding database access and the encryption key can read decrypted synced text. That distinction is exactly what separates this design from E2EE (§2.4).

### 2.4 Security boundaries — what "encrypted" means here [APPROVED]

| Layer | Mechanism | Protects against | Does not protect against |
|---|---|---|---|
| In transit | TLS with valid certificates on every hop | Interception and tampering on the network | A compromised or malicious server |
| At rest | Standard encryption of database, backups and object storage | Stolen disks, leaked snapshots, mis-scoped backups | An operator, or anyone holding both database access and the key |
| Application authorization | Per-account scoping on every query | One user reading another user's records | Anything above it |
| End-to-end encryption | **Not implemented, not planned under this decision** | — | — |

Consequences that the product's own wording must not soften:

- This is **not** end-to-end encryption. The service operator can technically read synced task text, book titles and notes. No document, store listing or in-app screen may imply otherwise.
- The claim that survives is narrower and still strong: **a guest session sends no data to the Daftarche backend**, and a guest can keep using the app locally without registering at all. For an authenticated user, only the approved Sync record set is transferred, and only while Sync is enabled. **User-initiated Manual Local Backup/Export is a separate mechanism:** it needs no account and no backend, and it may include PDF files, PDF annotations and book cover images according to the existing export behaviour. Uploaded music is not included in the current manual export, and whether it must be is pending (OD-18). None of these excluded items is transferred through **Automatic Account Sync** or **Account Data Export**. Analytics stays opt-in and content-free.
- A future E2EE design is a separate decision with real costs (lost keys mean unrecoverable data; server-side support and search become impossible). It must not be hinted at today.

---

## 3. User states — explicitly modelled

| State | Identity | Data location | Available features | Sync |
|---|---|---|---|---|
| **Guest / local-only** | None | Device only | Everything currently shipped; local backup/export; focus, library, decision, worlds earned by achievement | **None, by design** — free, complete and never time-limited |
| **Authenticated / synced** | Account | Device + cloud (approved record set only) | Everything in guest mode, plus synchronisation, restore on a new device, purchases and subscriptions | **[APPROVED] Included free with the account.** Not a paid tier |
| **Authenticated but temporarily offline** | Account, token cached | Device (authoritative while offline) + queued operations | Everything local; commercial features read the cached entitlement snapshot; purchases require connectivity | Queued; flushes when connectivity returns |

Rules that fall out of this and must be enforced in code:

- **[APPROVED] Synchronisation is a property of having an account, not of paying for one.** No screen, price table, store listing or paywall may present sync as a Plus benefit or as a trial that expires.
- **[APPROVED] No sync payload may contain a PDF file, a PDF annotation, a book cover image or a music track.** The rule is enforced at the repository and outbox boundary, not by convention.
- Entering the app never requires a network call. Onboarding stays as it is today (`js/onboarding.js`): name → goal → first task, all skippable.
- Signing out must **not** delete local data by default. Offer "keep this device's copy" and "remove from this device" as distinct, explicit actions.
- An expired or offline session must degrade to the guest experience for *local* features, never to a login wall.
- Entitlements are readable offline from a cached snapshot, with a defined grace period; a subscription expiry that cannot be checked must not instantly remove a theme the user is wearing. Fall back to the free theme, do not delete data.

---

## 4. Data flow for the three critical journeys

### 4.1 Guest → account migration (the highest-risk flow)

```
1. Guest has local data (records + assets).
2. User chooses to create an account (from a sync prompt or a purchase).
3. Client authenticates; receives session + server user id.
4. Client creates a MIGRATION SESSION on the server (idempotency key = device id + user id).
5. Client pushes a snapshot in pages, each page tagged with a monotonic sequence.
6. Server writes with per-record conflict check; responds with per-record outcome
   (created | merged | rejected-conflict).
7. Client records progress locally; any interruption resumes from the last
   acknowledged sequence (not from zero).
8. Client marks the migration complete only after the final page is acknowledged,
   then switches the local store into "synced" mode.
9. Local data is NEVER deleted by the migration itself.
```

Two failure modes must be designed for explicitly:

- **Interrupted mid-migration**: server holds a partial snapshot. Resume must be idempotent; re-pushing the same record must not duplicate it (ids are client-generated and stable — see `SYNC_AND_DATA_STRATEGY.md` §4).
- **Guest data changed during migration**: the migration session is a snapshot; operations after it become normal sync operations, ordered behind the migration.
- **Scope of the snapshot [APPROVED]**: only the approved syncable records are migrated — tasks, book metadata and reading progress, moods, ledger, achievements, day-open history. **Focus history is not part of it:** it stays outside both Sync and migration until OD-05 is resolved, and no pending (`P` or `?`) record — preference values under OD-06 included — may enter a migration snapshot before its decision is approved (`SYNC_AND_DATA_STRATEGY.md` §5.2, §5.4, §7.4). PDF files, PDF highlights, PDF notes, book covers and uploaded music are never part of the migration, and the migration must report its counts so the user is not led to believe the account is a full backup of their library (§5 of `SYNC_AND_DATA_STRATEGY.md`). Whether uploaded music belongs in the manual local export is a separate, unresolved owner decision (OD-18); it is not a migration question and is not decided here.

### 4.2 Account sign-in on a second device

```
sign in → fetch server snapshot → inspect local state
   ├─ no meaningful local data → restore the account's records (no question)
   └─ local data exists → MERGE (default, non-destructive)
                          └─ optional: "use the account's copy instead"
                             → explicit confirmation naming what is lost
→ sync runs from here; signing in itself deletes nothing
```

Five binding rules:

1. **Empty device → restore.** The account's synchronized records are pulled. No dialog, no choice to misread.
2. **Device with local data → merge by default.** Both sides survive; the merge policy decides overlapping records (`SYNC_AND_DATA_STRATEGY.md` §5.4).
3. **Never a silent replace.** Signing in must not delete a local record.
4. **Destructive replacement is an explicit, explained act** — separate from the sign-in step, naming what will be lost and how many local records are affected.
5. **No ambiguous choices.** A dialog offering "use my cloud data" without stating the consequence is a defect, not a simplification.

What arrives is metadata, not files. A restored book carries its title, page count, current page, per-day reading counters and goal; the PDF itself is not synchronised, so it stays on the device that imported it and travels only in a user-initiated local export. The UI therefore has to treat two states separately:

| State | Source of truth | Requirement |
|---|---|---|
| Book metadata and reading progress | The synced record | Always shown, on every device, whether or not the file exists locally |
| Local file availability | This device's `daftarche-books` IndexedDB | Shown as unavailable on a device without the file, with an offer to import it |

An absent file is never grounds to delete metadata or progress, and a metadata delete is never a side effect of a device that lacks the file. Reconciling a re-imported PDF with an already-restored metadata row (today a re-import mints a new id, `js/library.js:683`) is an open design item — OD-17, with the required behaviour specified in `SYNC_AND_DATA_STRATEGY.md` §10.1.

Four states look alike in the UI and must not be confused:

| State | Account | Network | Data location | Label the user sees |
|---|---|---|---|---|
| **Account Sync enabled** | Signed in | Sync active | Device + cloud (approved records) | "Synced · last synced …" |
| **Sync paused on this device** | Signed in | Sync deliberately suspended | Device + cloud, but this device stops exchanging | "Sync paused on this device" |
| **Guest / local-only** | None | Irrelevant | Device only | "On this device only" |
| **Signed out, local copy kept** | None (session ended) | Irrelevant | Device only | "Signed out · your data stays here" |

The paused state exists because a person may want a work phone that does not carry study data; it is not an account downgrade and never deletes anything (`SYNC_AND_DATA_STRATEGY.md` §6.4).

### 4.3 Offline account use

```
start → read cached session + cached entitlements (no network)
      → operate normally; every mutation appends to outbox
      → on connectivity: flush outbox in order, pull since last cursor,
        merge, apply, advance cursor; retry with exponential backoff and jitter
```

---

## 5. Platform architecture

### 5.1 Keep the shared core and Capacitor

Nothing found in this audit justifies replacing the framework, the build model or Capacitor. Evidence:

- The web app is a plain static bundle; adding a sync client requires no toolchain change.
- Android already ships the same files (`tools/build-www.mjs`), with the service worker deliberately unregistered (`js/pwa.js:14-25`) and assets bundled instead — a clean offline story.
- The native bridge is small and purposeful (`js/native.js`, `MainActivity.java`): insets, system bars, back, share/save, local notifications, plus a WebView-version guard.
- A rewrite would put 27,917 lines of Persian RTL UI, 442 tests and a documented design system at risk for no architectural gain.

**Recommended additions to the platform surface, not replacements:**

| Need | Approach | Why |
|---|---|---|
| Durable local store with transactions | IndexedDB via a thin repository (no new dependency) | Already present and used for blobs; localStorage's 5 MB ceiling and synchronous API are the real risk |
| Secure token storage on Android | Capacitor preference + platform keystore plugin if available; otherwise keep tokens in memory + re-auth | Unverified whether a suitable plugin is compatible with Capacitor 8 — must be checked before committing |
| Background sync reliability | Foreground sync on app resume + explicit "syncing…" state; do not promise background sync | Android background execution is constrained; the current app already exits to background deliberately |

### 5.2 Web and Android divergence to keep explicit

| Concern | Web | Android |
|---|---|---|
| Offline | Service worker shell cache (`sw.js`) | Bundled `www/` assets, no SW, caches cleared (`js/pwa.js`) |
| Notifications | Web Push (disabled) or none | Local notifications plugin |
| File export | `<a download>` | Filesystem (chunked base64) + share sheet (`js/native.js`) |
| Payments | Web gateway (redirect + server verification) | Store billing (store-specific) |
| Updates | Build-keyed cache swap | APK release |

---

## 6. Architectural decisions and trade-offs

### D1 — Keep vanilla ES modules; do not adopt a framework
- **For:** zero build step, tiny bundle, existing tests import modules directly, 442 green tests depend on that property, Capacitor packaging stays trivial.
- **Against:** scaling the view layer by hand becomes harder; the five task surfaces already show the cost.
- **Decision:** keep. Mitigate duplication by extracting shared task-row rendering, not by a framework migration.

### D2 — Local-first, server-as-replica
- **For:** preserves the product promise, keeps the app usable and honest offline, makes sync a background activity.
- **Against:** conflict handling must exist on the client; clocks cannot be trusted.
- **Decision:** adopt. Server timestamps are authoritative for ordering; client clocks are only used for display and for `created`.

### D3 — Backend as a provider-neutral REST service (Node or equivalent) over Postgres
- **For:** no dependency on a specific BaaS; can be hosted domestically if foreign SaaS access or billing is not viable; the team already runs an Express service (`server/`); Postgres suits relational account/device/entitlement data.
- **Against:** more operational work than a managed BaaS; migrations, backups and monitoring are on us.
- **Alternatives considered:**

| Option | Strengths | Weaknesses for this product | Verdict |
|---|---|---|---|
| Managed BaaS (e.g. Supabase-style) | Fast start, built-in auth, row-level security | Provider lock-in; the team's own comments already assume it, which is a doc-only assumption; hosting/availability from Iran must be verified | Viable fallback, not the plan |
| Firebase-style | Mature auth + offline SDKs | Opinionated client SDK, poor fit for a no-dependency vanilla client; same regional availability question | Not recommended |
| Self-hosted REST + Postgres | Full control, domestic hosting possible, no client SDK, matches existing Express experience | We own ops and security | **Recommended** |
| Serverless edge (D1-style) | Cheap, low ops | Couples the backend to one vendor's runtime; harder to relocate | Possible later |

**No backend provider is selected by this audit.** The single strongest input is host viability in the target market, which cannot be settled from the source tree.

### D4 — Sync granularity: record-level with per-record `updatedAt` + tombstone
- **For:** simple to reason about, cheap to store, merges naturally with the existing per-key policy in `js/backup.js`.
- **Against:** whole-record conflicts on fields that changed on two devices.
- **Decision:** record-level, with field-group merge for the two records that actually need it (tasks: completion vs. edits; books: progress floors vs. titles).

### D5 — Entitlements are server-authoritative, client-cached
- **For:** a purchase made on the web must unlock on Android; refunds and expiries must take effect.
- **Decision:** client never grants a product itself. It renders from a signed entitlement snapshot with a timestamp and a grace window.

### D6 — Analytics must be a separate, opt-in subsystem with no content
- **For:** keeps the claim that analytics carries no personal content true and auditable.
- **Decision:** a closed event vocabulary, no free-text fields, no identifiers beyond a rotating installation id, opt-in, and off by default — see `PRIVACY_AND_ANALYTICS_POLICY.md`.

### D7 — Do not repurpose the existing `server/` for accounts
- The push server is a single-purpose Express app with an admin key and a JSON file store (`server/push-server.js`). It is not a base for identity, sync or payments. Treat it as a separate, optional component; if Web Push is retired, retire the directory with it.

### D8 — Synchronisation is free for every registered account [APPROVED]
- **Decision:** an account is optional for local use and enables sync; sync is never a paid feature and never expires.
- **For:** registration is the conversion event for every later commercial action; a paid gate in front of sync would suppress exactly the account base that payments and analytics depend on, in a low-ARPU market.
- **Against:** the server cost of sync is not directly monetised. Accepted: it is treated as the cost of holding an account, and Plus sells depth instead (`MONETIZATION_STRATEGY.md`).
- **What this forbids:** a sync SKU in the product catalogue, a sync trial, a device-count limit described as a paid upgrade, and any copy that implies data continuity is a premium feature.

### D9 — Standard transport and at-rest encryption, explicitly not E2EE [APPROVED]
- **Decision:** TLS in transit; standard encryption at rest for stored data and backups; keys managed separately from data and code; no secrets or tokens in logs; per-account authorization.
- **For:** it is achievable now, auditable, and compatible with server-side support, account recovery and purchase verification — all of which the product needs.
- **Against:** the operator can technically read synced content, so the privacy claim must be stated precisely instead of maximised.
- **Decision:** the narrower, true claim. E2EE is out of scope and must not be implied anywhere.

---

## 7. What must be true before this architecture is buildable

1. The working copy has a written read-only baseline and a verified, restorable backup. No version control exists today, and adopting one is an owner decision with its own write operations — the authorized backlog deliberately does not perform or prescribe any.
2. The record model gains `updatedAt` and deletion markers, and every delete path is routed through the repository (today: `js/tasks.js:622` is a bare filter).
3. A decision is made on hosting region/provider viability in the target market.
4. The privacy statement that ships today is rewritten before any server-side feature ships, and it must describe transport and at-rest protection without claiming E2EE.
5. Guest mode is proven to survive every new flow — enforced by tests, not by intention.
6. Transport, at-rest, key-management, token-handling and per-account authorization requirements are implemented and tested before the first account release — none of them exists today.
