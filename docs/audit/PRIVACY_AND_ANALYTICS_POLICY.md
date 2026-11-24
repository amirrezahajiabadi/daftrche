# Privacy and Analytics Policy — Daftarche

**Status:** assessment and proposal. No analytics code exists today. Nothing here is implemented. **No legal conclusion in this document is authoritative**; every legal question is flagged for professional review.

**Approved and reflected below:** synchronisation is free for every registered account; data is protected with valid HTTPS/TLS in transit and standard encryption at rest, with keys managed separately — **not** end-to-end encryption; PDF synchronisation covers metadata and reading progress only, so PDF files, PDF highlights, PDF notes and uploaded music are never uploaded to or synchronised with the backend (they can still be carried by a user-initiated local export; music is in no export today — OD-18).

---

## 1. Current privacy implementation (verified)

| Area | Finding | Evidence |
|---|---|---|
| Analytics / telemetry | **None.** No SDK, no endpoint, no event pipeline, no cookie, no consent mechanism | Repository-wide search for analytics/telemetry/tracking concepts returns no source matches |
| Third-party scripts | **None at runtime.** PDF.js, previously a CDN dependency, now ships locally | `js/reader.js:25` `PDFJS_BASE = new URL('../assets/vendor/pdfjs', …)` |
| Network calls in the app | Three kinds only: (1) dormant Web Push (`WEB_PUSH_ENABLED = false`, `js/push-service.js:18`), (2) a version check (`js/settings.js:273`), (3) nothing else | — |
| Local content | Tasks, notes, highlights, PDFs, reflections and focus history are **not transmitted to the Daftarche backend today** — there is no account and no Sync implementation. Once accounts ship, a signed-in user transfers only the approved record set. This row is about backend transfer only: user-initiated local exports already exist and carry supported data — the JSON backup (`js/backup.js`), which includes PDF annotations and book covers, and the PDF pack (`js/library.js` `exportBookPack`), which carries the PDF files. Uploaded music is in no local export today, and whether it must be is **OD-18**. Not every category in this row is in every export | `README.md:4-6`; `js/backup.js:1-15` |
| OS-level data leakage surface | Android auto-backup disabled; no storage/camera/location/contact permissions | `AndroidManifest.xml` |
| Error visibility | `console.error` only; no remote reporting | `js/app.js` `safe()` wrapper |
| Content security policy | Strict, meta/header-served; `default-src 'self'`; `object-src 'none'`; `form-action 'none'` | `_headers`; `tests/csp.test.mjs` |
| Still-open CSP holes | `https://cdn.jsdelivr.net` is whitelisted for scripts/workers/fonts although no longer used; `style-src 'unsafe-inline'` remains by design | `_headers`; `docs/roadmap.md` |
| Push server identity model | Stores a push endpoint and keys, **no user identity**, protected admin routes, rate limiting | `server/push-server.js:51-70`, `147`, `265-280` |
| Privacy statement that ships | A **draft** inside a publishing guide, claiming no data collection and no central server | `docs/android-publishing.md:72-95` |

### 1.1 Problems with the current statement already, before any new feature

The draft policy says: *"Daftarche does not collect any personal, statistical, analytical data or user-behaviour logs, and there is no central server storing this information."*

Two inaccuracies exist **today**:

1. An optional push backend exists in `server/`. If enabled it receives and stores push endpoints — technical data about the device, even without content or identity.
2. The Android build performs a version check over the network (`js/settings.js:273`).

Both are defensible in a policy, but only if the policy says so. The current text does not.

---

## 2. Data map (what exists, where it lives, who can see it)

The authoritative field-level classification — including every key that is device-local, pending, or excluded — is `SYNC_AND_DATA_STRATEGY.md` §5.2. This table is the privacy view of that classification; where the two ever differ, §5.2 wins and this table is the defect.

| Data | Stored in | Personal content? | Guest | Registered account (sync enabled) |
|---|---|---|---|---|
| Task text, titles, categories, priorities, planned spans, completion | `localStorage` (`daftarche-v1`) | **Yes** | Device only | **Synchronised** |
| Book metadata: title, page count, current page, last read, completed pages, per-day reading counters, goal | `localStorage` (`daftarche-books-meta`) | **Yes** — title and goal text are typed by the user | Device only | **Synchronised** |
| Book cover thumbnail (`cover`) | `localStorage` (`daftarche-books-meta`) | Image rendered from the document | Device only | **Device only** — excluded from sync |
| PDF highlights and notes | `localStorage` (`daftarche-books-meta`) | **Yes** | Device only | **Device only** — excluded by decision |
| PDF files | IndexedDB (`daftarche-books`) | **Yes** — the user's own documents | Device only | **Device only** — never uploaded to the backend; carried off the device only by the user-initiated PDF pack export |
| Uploaded music | IndexedDB (`daftarche-audio`) | **Yes** | Device only | **Device only** — never uploaded or synchronised; not included in the manual local export today, and whether it must be is pending (OD-18) |
| Focus history (task title snapshots) | `localStorage` (`daftarche-focus-history`) | **Yes** | Device only | **Not synced and not migrated.** Pending and inactive pending owner decision on sync, retention and the Plus boundary (OD-05) |
| Moods | `localStorage` (`daftarche-moods`) | **Yes** | Device only | **Synchronised** |
| Birthday record and annual wishes | `localStorage` (`daftarche-birthday`, `daftarche-birthday-wishes`) | **Yes** — wishes are user-written | Device only | **Not synced and not migrated.** Pending and inactive pending decision (OD-08); Backup classification does not imply Sync |
| Reflections | `localStorage` (no dedicated key identified) | **Yes** | Device only | **Not synchronized.** Pending identification, then decision (OD-09) |
| Day book / ledger counters | `localStorage` (`daftarche-ledger`) | Aggregated behaviour | Device only | **Synchronised** |
| Day-open history, unlocked achievements | `localStorage` (`daftarche-history`, `daftarche-achievements`) | Aggregated behaviour | Device only | **Synchronised** |
| Display name, avatar choice | `localStorage` | **Yes** | Device only | Optional preference sync, pending decision (OD-06) |
| Profile photo (data URL) | `localStorage` (`daftarche-photo`) | **Yes** | Device only | **Not synchronized.** Pending decision (OD-10) |
| Theme, text size, motion, week goal, pomodoro length | `localStorage` | No | Device only | Optional preference sync, pending decision (OD-06) |
| Live focus session, tour markers, backup stamps, seen-version | `localStorage` | No | Device only | Device only — never synced |
| Push subscription (only if Web Push is enabled) | Server (`subscriptions.json`) | Technical device data | Sent if enabled | Sent if enabled |
| Version check request | Transient | IP + user agent (normal HTTP) | Sent | Sent |

**Design intent to preserve:** what the product sends to the Daftarche backend must stay minimal. In neither user state are **PDF files, PDF highlights, PDF notes, book cover images or uploaded music** uploaded to or synchronized with the backend. That sentence is about backend transfer, not about the user's own copy: the same items are carried by user-initiated local exports where the existing export behaviour covers them — PDF files by the PDF pack (`js/library.js` `exportBookPack`), PDF annotations and book covers by the JSON backup (`js/backup.js`) — and uploaded music is in no export today, with its future inclusion pending (OD-18). What an account adds is a defined set of records, not a copy of the user's library.

### 2.1 Exactly what synchronisation transfers (approved scope)

To a registered account, and only while sync is enabled on a device:

- **Tasks** — every field of the task record (`js/state.js` `normalizeTask`), including the user's own text.
- **Book metadata and reading progress** — `id`, `title`, `addedAt`, `numPages`, `lastPage`, `lastReadAt`, `completedPages`, `stats` (per-day pages and minutes) and `goal` (`pagesPerDay` and its optional text). Verified field set: `js/library.js:685-686`, `js/reader.js:1822`, `:1904-1914`.
- **Activity records** — day-open history, moods, ledger counters and achievements.

Nothing else is transferred today. Focus history, the birthday record and wishes, reflections, the profile photo and preference values are **not** in the approved set; each waits on the owner decision named in `SYNC_AND_DATA_STRATEGY.md` §5.2. **Pending means inactive:** while a decision is open, the corresponding record or field may not enter Sync, the migration snapshot or the outbox, and the canonical classification — not this table's wording — decides that.

**Never transferred to the account:** the PDF file, PDF highlights, PDF notes, the book cover image, uploaded music, the live focus-timer state, and any device-local marker. Some of these are nevertheless recoverable from a user-initiated local export: PDF files from the PDF pack, PDF annotations and book covers from the JSON backup. Uploaded music is in no export today, and whether the manual export must carry it is the pending OD-18.

The consequence for wording: a flat claim that "no user content ever leaves the device" is wrong in both states, for two different reasons — a signed-in user's approved records go to the backend, and a user-initiated local export moves content off the device by the user's own choice in either state. The policy must name the mechanism, and where it matters the state the reader is in: what is never sent to the backend, what is never synchronised, and what a local export does and does not include.

---

## 3. Account-related data requirements (what accounts will add)

Account creation introduces legitimately mandatory processing, which is **separate from analytics consent**. The product must not bundle them.

| Data | Purpose | Mandatory for an account? | Retention |
|---|---|---|---|
| Identifier (email or phone) | Authentication, account recovery | Yes | Life of account |
| Password hash (server, never the password) | Authentication | Yes | Life of account |
| Session/refresh tokens | Staying signed in | Yes | Until rotated/revoked |
| Device records (label, platform, last seen) | Device list, remote sign-out | Yes | Life of account / until device removed |
| Synced content (tasks; book metadata and reading progress; activity records — see §2.1) | The service the user asked for; free with every account | Yes, if sync is enabled on that device | Life of account; deletion timing and any grace period are pending OD-11 (§6) |
| Entitlements and purchase references | Delivering and restoring what was bought | Yes, if anything is purchased | Life of account; invoice retention may be legally mandated (unresolved) |
| Analytics events | Product improvement | **No — opt-in, separate** | Short (see §6) |

**Rule:** creating an account must **not** enable analytics. Account creation enables synchronisation — that is the purpose the user accepted — but the consent for analytics is a distinct, revocable choice with its own timestamp and its own surface. Bundling them would make "you agreed to have an account" into "you agreed to be measured".

---

## 4. Guest-mode privacy implications

Guest mode is the strongest privacy position the product can offer and should be advertised as such, precisely because it is true:

- Nothing is sent to the Daftarche backend (beyond the optional version check and, if ever enabled, a push subscription). This is a statement about the **guest state**; a signed-in user with sync is in a different state, and the product must not blur the two.
- No identity, no account, no email.
- The only optional server contact is the version check (and push, if ever enabled).
- Uninstalling the app removes the data (Android `allowBackup="false"`), so **export is the only backup** — which makes the backup nudge a privacy-adjacent responsibility, not just a convenience.

What the product must **not** do:
- Show a login wall for features that work locally.
- Treat guest users as unverified second-class users in copy.
- Silently create an account or a shadow identity server-side.

---

## 5. Proposed analytics architecture (minimal, consent-based, content-free)

### 5.1 Principles
1. **Off by default.** No event is sent before an explicit opt-in.
2. **Separate from account consent.** Declining analytics must never block account creation, and accepting the account terms must never enable analytics.
3. **Closed vocabulary.** An event is one of a fixed list, with a fixed schema. No free-text field, ever.
4. **No content, no identifiers of people.** No task text, no book titles, no notes, no file names, no email, no phone, no precise location, no advertising id.
5. **Coarse and aggregated by design.** Counts, buckets, booleans — not values the user typed.
6. **Revocable.** Turning it off stops sending immediately and marks the installation id for deletion.
7. **Auditable.** The event schema is a constant in the source, so a reviewer can read the complete list of what can be sent.

### 5.2 Proposed event vocabulary (illustrative, deliberately blunt)

| Event | Allowed properties | Explicitly excluded |
|---|---|---|
| `app_open` | platform (web/android), app_version, build, is_guest (bool), ui_language | any content |
| `onboarding_step` | step_index (1–3), completed (bool), skipped (bool) | name, goal text |
| `task_created` | has_due (bool), has_duration (bool), has_span (bool), priority_bucket, category_key | task text |
| `task_completed` | was_overdue (bool), age_bucket_days | task text |
| `recommendation_shown` | energy_level, candidate_count_bucket | task text |
| `recommendation_accepted` | accepted (bool), reason_code | task text |
| `focus_started` / `focus_completed` | planned_minutes_bucket, actual_minutes_bucket, rating_key, task_linked (bool) | task title |
| `book_imported` | page_count_bucket, file_size_bucket | file name, title |
| `sync_result` | outcome (ok/conflict/error), pending_ops_bucket, duration_bucket | record payloads |
| `paywall_shown` / `purchase_result` | product_id, channel, outcome_code | payment details |
| `error` | error_code, module_key, app_version | stack traces with user data, URLs with query strings |

Bucketing rules (e.g. `duration_bucket`: `<5, 5–15, 16–30, 31–60, 60+`) must be defined in one module so the whole vocabulary is reviewable in one file.

### 5.3 Consent architecture

```
First run: no consent prompt at all (the app is fully usable, nothing is sent).
Settings → "Privacy" screen:
   [ ] Share anonymous usage statistics   (default: off)
       - what is sent, with the exact event list
       - what is never sent (content)
       - link to the full policy
   [ ] (later, optional) crash reports     (default: off)
Consent record: { analytics: on|off, version, timestamp, policyHash }
```

Rules:
- No cookie-style banner; a settings-based opt-in is calmer and matches the product's tone.
- If the product owner ever requires an exit-intent prompt, it must appear only after the user has experienced value, never at first launch.
- Consent state is stored locally and sent as an explicit flag with each batch; the server must reject events from installations whose consent is not recorded.
- Withdrawal deletes the installation id and stops retention.

### 5.4 Transport and identity
- One endpoint, one POST per batch, no third-party analytics SDK.
- Installation id: random UUID stored locally, regenerated on withdrawal, **never** derived from hardware identifiers.
- No user id in analytics events. If cohort analysis is ever needed, use a **separate, salted, rotating** pseudonym — never the account id, never the email.
- Retention: raw events ≤ 90 days; aggregates kept longer. Documented and enforced server-side.

### 5.5 What analytics must never collect (explicit prohibition list)

The brief is unambiguous, and this list should be enforced by a schema allowlist plus a code review rule:

- Task titles, task descriptions, category labels the user typed
- Personal notes, reflections, mood text, birthday wishes
- Book titles, author names, file names, PDF contents
- Reading highlights, annotations, handwritten strokes
- Search queries typed in the app
- Clipboard contents, contacts, location, photos
- Email addresses, phone numbers, names
- Advertising identifiers or cross-site identifiers
- Screenshots or view hierarchies

A single free-text field anywhere in the event schema is a defect, not a feature request.

---

## 6. Retention

| Data | Retention | Notes |
|---|---|---|
| Local user content | Until the user deletes it or uninstalls | Never expires on its own |
| Backup files | On the user's own storage | Outside our control after export |
| Push subscriptions (if enabled) | Until unsubscribed; drop on 404/410 | Existing behaviour in `server/push-server.js` |
| Account + synced content | Life of account. Deletion timing and any grace period are **pending OD-11**; no window is approved, implemented or promised. Legally required retention obligations, if applicable, must be assessed separately | Cannot be finalised until OD-11 is decided |
| Deleted-record tombstones | 90 days (proposal), then hard delete | Needed for sync correctness; must be disclosed |
| Entitlements | Life of account; revoked on refund, not deleted | Invoice retention obligations are unresolved |
| Analytics raw events | ≤ 90 days | Opt-in only |
| Server logs | Shortest operationally viable (proposal: 30 days), IP truncated | Needs a written policy |
| Crash reports | ≤ 90 days, content-free | Opt-in only |

---

## 7. Account deletion and data export

### 7.1 Deletion must be complete and provable
A single "delete my account" action, with a confirmation that lists exactly what will be removed:

1. Server: sessions revoked, records and tombstones deleted, cursors and migrations deleted, device rows deleted, push subscriptions removed, entitlements deleted (subject to any mandatory invoice retention), analytics installation id deleted.
2. Client: a **separate** choice — "also remove this device's copy" → `clearAll()` and `clearLibraryData()` plus the audio database (the existing wipe path is `js/settings.js:734-737`).
3. A receipt screen confirming what was deleted and what the store may still hold (purchases live with the store).
4. Account deletion timing is **pending OD-11**. Whether deletion takes effect immediately or after a grace period — and, if a grace period exists, how long it is — is not decided: no specific window is approved, and none may be described to users, implemented or implied before the decision is recorded. A window or grace period may not be promised as if it were settled. Separately, any legally required retention (for example invoice or tax records) must be assessed on its own merits and disclosed if it applies.

The distinction the UI must make explicit: **deleting the account** removes server-side records; **deleting this device's copy** is a separate, optional action. Neither implies the other.

### 7.2 Export must be complete and free

Three export paths exist or are proposed, and they must not be conflated:

| Path | What it is | Scope |
|---|---|---|
| **Automatic Sync** | Continuous, while signed in | Approved **S** records only — not an export at all |
| **Manual local backup/export** | A file the user exports and keeps | JSON data (`js/backup.js`) and a PDF pack (`js/library.js` `exportBookPack`) |
| **Account data export** | A copy of what the server holds for the account | Entitlements, device list, account metadata and synced records |

Existing exports: JSON (`js/backup.js`) and a PDF pack (`js/library.js` `exportBookPack`). Uploaded music has no export today. Whether the **manual local** export must include uploaded music is an unresolved owner decision, **OD-18**; until it is decided, no music export is promised, required or described as missing functionality. Uploaded music never synchronises and can never appear in an account data export, because the backend never receives it. For accounts, export must additionally include server-held data (entitlements, device list, account metadata) in a machine-readable file. Export must not be a paid feature.

---

## 8. Minor-user considerations (unresolved — requires professional review)

The audience explicitly includes **school pupils**, which means minors may be users. The following questions cannot be answered from the source, and this document deliberately does not answer them (register entry OD-15):

| Question | Why it matters | Current state |
|---|---|---|
| Is an age gate required, and at what threshold? | Determines onboarding flow and account creation | No age collection of any kind exists |
| Is verifiable parental consent required for under-threshold users? | Blocks accounts, purchases and analytics for that group | Nothing exists |
| Can minors make purchases directly? | Store rules and consumer law may require guardian consent or refund rights | No purchase system exists |
| May analytics be collected from minors at all, even with consent? | Many regimes treat minors' data as requiring higher protection | Nothing exists |
| Does the birthday feature (which stores month/day and can infer age) count as collecting a minor's data? | It is optional and local today, and it is not synchronised; it would only become server-side data if OD-08 approved its inclusion in Sync | `js/birthday.js`; the canonical Sync classification in `SYNC_AND_DATA_STRATEGY.md` §5.2 marks `daftarche-birthday` as **?** (OD-08), so it is not synchronised. Its absence from the Backup `EXCLUDED` set is a Backup fact only and says nothing about Sync |
| What does Iranian law require for children's data, content, and in-app purchases? | Governing law for the target market | **Not researched here; requires local counsel** |

Practical mitigations that are safe regardless of jurisdiction:
- Keep analytics off by default (already proposed).
- Do not ask for a birth **year** unless needed; the current design stores month/day only (`js/birthday.js`), which is privacy-favourable.
- Do not enable purchase or analytics for an account marked as a minor until the legal position is settled.
- Publish a child-readable short version of the policy.

---

## 9. Required policy updates

| # | Update | Trigger |
|---|---|---|
| 1 | Replace the draft text in `docs/android-publishing.md:72-95`; it currently overstates isolation | **Now**, and **blocking** before any account/Sync release — the text must be rewritten before the first release that moves a record off the device (it already omits the push server and version check) |
| 2 | Add an in-app Privacy screen with the data map, consent toggles and export/delete entry points | With the first account release |
| 3 | State explicitly: in guest mode nothing is sent to the Daftarche backend; a signed-in user's approved records synchronise, while PDF files, annotations, covers and music are never uploaded or synchronised — and state separately what a user-initiated local export includes and what it does not (music: OD-18) | With sync |
| 3a | State the protection model precisely: TLS in transit and standard encryption at rest, with operator-side access possible — **no E2EE claim** | With sync |
| 4 | Add retention periods and tombstone disclosure; account-deletion timing and any grace period await OD-11 and must not be stated before it is decided | With sync |
| 5 | Add the analytics section (what is sent, what is never sent, retention, withdrawal) | With analytics |
| 6 | Add the minors section and the age/consent stance | Before any purchase or analytics release |
| 7 | Update store data-safety declarations to match | Every release that changes data flow |
| 8 | Publish the exact event vocabulary alongside the policy | With analytics |
| 9 | Describe book progress as synchronised and PDF annotations as local, so "your highlights stay on your phone" remains literally true | With sync |

---

## 10. Technical hardening to schedule with this work

| Item | Reason | Evidence |
|---|---|---|
| Remove `https://cdn.jsdelivr.net` from `script-src`, `worker-src`, `font-src`, `connect-src` | No longer needed; every allowance is attack surface | `_headers`; PDF.js is local at `js/reader.js:25` |
| Add the future API origin to `connect-src` **explicitly** and nothing else | Keeps the policy narrow as the app becomes networked | `_headers` |
| Re-check `Permissions-Policy: … payment=()` | It currently disables the Payment Request API; a web checkout may need it, or may deliberately avoid it | `_headers` |
| Keep `object-src 'none'`, `base-uri 'self'`, `form-action 'none'` | Already correct | `_headers` |
| Ensure no token, password, secret or sensitive value is ever written to a log; tokens kept out of analytics and out of `localStorage` where avoidable, and hashed at rest where the design permits. **Approved requirement, not an implemented control** | Session handling does not exist yet | — |
| Review `daftarche-photo` | A user photo stored as a data URL in `localStorage` is personal content; decide whether it syncs at all | `js/profile.js` usage |
| Add a test that fails if any analytics payload key is not in the allowlist | Makes the prohibition enforceable, not aspirational | New test |

---

## 11. Open questions for the product owner

Each item below maps to a register entry (OD-xx) in `PRODUCT_MATURITY_AUDIT.md` §10, which records why it matters, which documents and tasks depend on it, and what postponing it costs. Nothing here is decided.

1. Is an age gate acceptable at first run, given it adds friction to a guest-first flow?
2. Is there a business need for **any** analytics before the first paid product, or can the first release remain entirely unmeasured?
3. Should the birthday date ever synchronise? It is personal but also a core feature. Birthday data and annual wishes are **not** synchronised unless and until OD-08 approves their inclusion; until then, per-device behaviour must be stated plainly rather than implied.
4. Who is the data controller for synced data, and in which jurisdiction is it hosted?
5. Is account deletion immediate, or does it follow a grace period? No specific window is approved; the timing is OD-11.
6. Does the profile photo (`daftarche-photo`, a data URL image) ever leave the device? Recommendation: no — it is an image, and sync scope is records.
7. Must the manual local export include uploaded music tracks, or remain JSON plus the PDF pack? Music never synchronises either way; the export question is OD-18 and is currently unanswered.

Settled elsewhere and not repeated here: sync is free with an account; PDF files, annotations and music never sync and are never uploaded to the backend; the protection model is TLS plus encryption at rest, explicitly not E2EE. That is a statement about backend transfer only — a user-initiated local export can carry PDF files, annotations and covers, while music is in no export today (OD-18).
