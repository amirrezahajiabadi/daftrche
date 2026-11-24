# Product Maturity Audit — Daftarche

- **Scope:** the working copy at `D:\Project\NewDaftrche`
- **Version audited:** `3.5.0`, build `v203` (`js/version.js`)
- **Nature of this document:** investigation only. No source file, configuration, dependency, asset or database was modified to produce it.
- **Evidence rule:** every claim below is tied to a file path and, where practical, a line or symbol. Anything that could not be verified from the source is marked **Unverified**.

Status labels used throughout all audit documents:

| Label | Meaning |
|---|---|
| **Verified** | The behaviour exists in the source and was read directly. |
| **Partial** | Some of the mechanism exists; named parts are missing. |
| **Doc-only** | A document, comment or changelog claims it; no implementation was found. |
| **Missing** | No implementation and no meaningful stub. |
| **Unverified** | Could not be established from the source alone. |

---

## 0. Product-owner decisions taken after this audit

Recorded here so that the three decisions are not mistaken for findings. They were approved **after** the investigation below was completed, and **none of them is implemented**.

| # | Approved decision | Status in the code |
|---|---|---|
| 1 | **Synchronisation is free for every registered account.** An account is optional for local use and enables sync and commercial actions. A signed-in user works fully offline with changes queued until connectivity returns. Guests are never forced or repeatedly pressured to register. | **Missing** — no account, no session, no sync, no queue (§4.1, §4.2) |
| 2 | **Data protection:** valid HTTPS/TLS in transit; standard encryption at rest for stored data and backups; keys managed separately from application data and source code; no credentials, tokens or secrets in logs; per-account authorization so one account cannot read another's records. **Explicitly not E2EE**, and no claim that the operator cannot read stored data. | **Missing** — no server-side storage exists yet, so no control exists to verify |
| 3 | **PDF synchronisation is limited to book metadata and reading progress.** PDF files, PDF highlights, PDF notes and uploaded music never enter the sync pipeline. A book record may exist on a device without its file, and a missing local file must never delete metadata or progress. | **Missing** — no sync; the existing PDF pack is a manual file the user carries (`js/library.js` `exportBookPack`) |

How to read the rest of this document:

- §3 to §9 remain a description of the **current** product. Nothing there has been upgraded to assume the decisions above, because nothing was implemented.
- The approved model does **not** repair the claim the audit already found fragile: the draft policy in `docs/android-publishing.md:72-95` still states that no data is collected and no central server exists. That text must be rewritten before any account release.
- Decision 2 must never be summarised in product copy as end-to-end encryption. The accurate claim is transport protection, at-rest protection and account-level authorization — with operator-side access technically possible.
- The version-control gap in §8.5 is **still open**. This revision is documentation-only: no repository was initialised, no commit, tag or history operation was performed. The backlog now records a read-only baseline plus backup verification instead of a commit.

---

## 1. Executive summary

Daftarche today is a **single-device, local-only Persian productivity PWA with a real, working Decision Engine and an unusually deep personalisation layer**, packaged for Android through Capacitor. It is much more mature than a prototype in product breadth and internal discipline (442 passing unit tests, documented design rules, a coherent design system), and much less mature than a shipping platform product in the dimensions the product strategy now depends on: **there is no account, no server-side user identity, no synchronisation, no entitlement/purchase system, no analytics, and no conflict-resolution infrastructure beyond a JSON backup merge.**

The strategic direction in the brief — guest-first free usage, optional accounts, cross-device sync, subscriptions and one-time purchases — describes a product that **does not exist yet in any form**; the decisions in §0 set the target and change nothing about that sentence. The current application is, in effect, *already* the guest mode the strategy asks for, minus the parts that only make sense once an account exists (sync, purchases, account-dependent services). That is a favourable starting point: nothing has to be removed to get guest-first behaviour; a great deal has to be added around it.

Four findings dominate the maturity assessment:

1. **The data layer is not sync-ready.** Records carry stable ids and creation timestamps but **no modification stamps, no per-record version, and no deletion markers**. Deletion is a hard array filter (`js/tasks.js:622`). Cross-device synchronisation cannot be layered on this without a data-model change.
2. **The application assumes one device is the only source of truth**, explicitly and by design (`js/backup.js:1-15`). The only conflict-resolution logic that exists is the backup *merge* path, which is thoughtful, tested and key-specific — and is the single best asset the sync work can build on.
3. **There is no monetisation surface at all.** Themes and worlds are unlocked by achievements, not purchased (`js/theme.js:65` `isThemeUnlocked` → `rewardFor` → `hasReward`). No billing plugin, no entitlement record, no price, no receipt handling exists.
4. **There is no analytics, no consent mechanism and no privacy policy in the product** — only a draft policy text inside a publishing guide (`docs/android-publishing.md:72-95`) that asserts "no data is collected and no central server exists". That statement is already fragile (an optional push server exists in `server/`) and becomes false the moment accounts, sync or analytics ship.

The Decision Layer — the product's central question, *"what exactly should I do right now?"* — **exists and is verifiable**, but consumes roughly four of the six signals the brief lists. It has no notion of *available time now* and no awareness of *existing commitments today*; the planned time span that tasks already carry (`timeFrom`/`timeTo`) is **not read by the ranking engine at all**.

---

## 2. Method and what was executed

Read-only inspection plus one read-only test run.

| Action | Command | Result |
|---|---|---|
| Test suite | `node --test` (Node v24.19.0) | **442 tests, 442 pass, 0 fail, 0 skipped**, ~1.92 s, exit 0 |
| Structure | `ls`, `glob`, `wc -l js/*.js` | 74 JS modules, 27,917 lines in `js/`; 25 CSS files; `index.html` 116,179 bytes |
| Version control | `git status` | **`fatal: not a git repository`** — the working copy has no Git metadata |
| Browser regression | `npm run test:browser` | **Not run.** The script needs Playwright, which is not a dependency (`tests/browser/regress.mjs:1-16` says so explicitly); the brief forbids installing dependencies. |

**Important caveat on the test run:** a green suite here proves that the *pure logic* covered by `tests/*.test.mjs` is consistent. It is **not** evidence of production readiness. `docs/roadmap.md:24-27` states that DOM-bound modules (`tasks.js` move path, `today.js`, `planner.js`) have no automated coverage, and the browser regression is a separate on-demand script.

---

## 3. Verified current capabilities

### 3.1 Navigation and shell

| Capability | Status | Evidence |
|---|---|---|
| Nine page sections in one document | Verified | `index.html` — `#page-today` (278), `#page-tasks` (364), `#page-stats` (478), `#page-achv` (566), `#page-library` (586), `#page-focus` (954), `#page-profile` (1022), `#page-settings` (1095), `#page-calendar` (1396) |
| Four primary destinations + "more" sheet | Verified | `js/constants.js` `PRIMARY_PAGES = ['today','tasks','focus','library']`, `MORE_PAGES = ['calendar','stats','achv','profile','settings']`; markup at `index.html:1451-1552` |
| Trail-based back navigation shared by UI, browser and Android gesture | Verified | `js/app.js:51-90`; native path `android/.../MainActivity.java` back callback |

### 3.2 Tasks

| Capability | Status | Evidence |
|---|---|---|
| Task record with id, text, priority, category, due date, duration, planned span, created/done stamps | Verified | `js/state.js` `normalizeTask` |
| Per-record forward migration of old fields (`due` → `dueDate`) | Verified | `js/state.js` |
| Task creation, editing, reordering, completion | Verified | `js/tasks.js`, `js/taskedit.js`, `js/quickadd.js` |
| **Deletion is hard delete (no tombstone)** | Verified | `js/tasks.js:622` `state.tasks = tasks.filter(t => t.id !== id)` |
| Persian natural-language quick add (date, time span, hashtag, duration) | Verified | `js/quickadd.js`; covered by `tests/quickadd.test.mjs` |

### 3.3 Decision Layer ("what should I do right now?")

| Capability | Status | Evidence |
|---|---|---|
| Deterministic scoring engine, DOM-free | Verified | `js/decision.js` — `deadlineScore` (50/45/35/28/22/15/8/3), `priorityScore` (30/20/10), `energyFitScore` (energy × 4 duration buckets), `criticalBonus` (+10), session-only skip penalty (−8) |
| Tie-breaks: nearer deadline → shorter duration → oldest | Verified | `js/decision.js` `compareCandidates` |
| History-derived context that may only reorder near-ties | Verified | `js/decisioncontext.js` (`CONTEXT_TIE_GAP = 5`, base score never rewritten); consumed at `js/decision.js` `compareWithContext` |
| Mood → energy mapping (5-step mood to low/normal/high) | Verified | `js/decision.js` `energyFromMood`, used in `js/today.js` |
| Rendered as a primary recommendation + alternatives + human reason | Verified | `js/today.js` `getRecommendation`, `reasonForTask` |
| **Awareness of *available time now*** | **Missing** | No input parameter for remaining time exists in the engine signature; `getRecommendation({tasks, today, energy, skipCounts, context})` |
| **Awareness of planned commitments today (`timeFrom`/`timeTo`)** | **Missing** | `rankTask` reads `dueDate`, `p`, `durationMin`, `created`, skip counts only; the span fields are never consulted |
| Persisted outcome of accepted/skipped recommendations | Missing | Skip counts are `Map`, explicitly session-only (`js/decision.js`) |

**Assessment:** a genuine Decision Layer exists — this is the strongest product asset — but it answers *"what is the best task for the kind of energy I have?"*, not yet *"what fits in the 40 minutes I actually have before my 16:00 commitment?"*. Two of the six signals named in the strategy (available time, existing commitments) are absent.

### 3.4 Focus

| Capability | Status | Evidence |
|---|---|---|
| Pomodoro timer with restorable in-progress session | Verified | `js/focus.js`; `STORAGE_KEYS.session` persisted, restored in `js/state.js`/`js/focus.js` |
| Completed-session archive, validated and capped at 100 | Verified | `js/focushistory.js` (`HISTORY_CAP = 100`, `normalizeHistoryRecord` requires id, start/end, ≥1 min, boolean completion, rating ∈ good/okay/hard) |
| Self-contained history records (task title snapshotted) | Verified | `js/focushistory.js` `toHistoryRecord` |
| Procedural music, ambient sound, user-uploaded tracks | Verified | `js/audio.js`; uploads stored in IndexedDB |
| Focus-session quality rating feeding the Decision Layer | Verified | `js/decisioncontext.js` `getDurationBuckets`, `findDurationPattern` |

### 3.5 Library and reading

| Capability | Status | Evidence |
|---|---|---|
| PDF import, shelf, progress, goals, highlights, notes | Verified | `js/library.js`; metadata in `localStorage` key `daftarche-books-meta`, record shape `{id, title, numPages, lastPage, cover, goal, stats, highlights, notes, completedPages}` (`js/library.js:685-686`) |
| PDF bytes in IndexedDB | Verified | `js/library.js:58-70` — DB `daftarche-books`, store `books`, `keyPath: 'id'` |
| PDF.js loaded **locally** (vendored), lazy, with timeout and retry token | Verified | `js/reader.js:25` `PDFJS_BASE = new URL('../assets/vendor/pdfjs', …)` |
| Page-read tracking, timed reading, freehand pen and highlight strokes | Verified | `js/reader.js` (2,264 lines), `js/week.js` `recordDay` |
| Reading goals surfaced on Today | Verified | `js/library.js` `readingGoalsToday`, imported in `js/today.js` |

### 3.6 Calendar and dates

| Capability | Status | Evidence |
|---|---|---|
| Real Jalali conversion, week starting Saturday, Persian digits | Verified | `js/jalali.js`, `js/jalalical.js`, `js/utils.js`; `tests/jalali.test.mjs`, `tests/jalalical.test.mjs` |
| Month grid + day panel (planner) + week view + occasions | Verified | `js/calendar.js`, `js/planner.js`, `js/week.js`, `js/calendarmodel.js`, `js/calendar-data.js` |

### 3.7 Personalisation, worlds, character

| Capability | Status | Evidence |
|---|---|---|
| 18 theme entries (17 selectable + hidden birthday theme) | Verified | `js/constants.js` `THEMES`, `PICKER_THEMES` |
| Themes unlocked by **achievements**, not purchases | Verified | `js/theme.js:65` `isThemeUnlocked` → `rewardFor('theme', key)` → `hasReward`; reward table `js/achievements.js` `REWARDS` |
| 10 "world" themes each adding a Today card | Verified | `js/worlds.js`, `js/worlds-data.js`, `js/constants.js` (`family: 'world'`) |
| Avatar / character selection | Verified | `index.html:1382` (`#avatarTitle`), `js/profile.js`, `js/qorqori.js` |

### 3.8 Statistics, insights, reflection

| Capability | Status | Evidence |
|---|---|---|
| Day book with monotonic floors per metric | Verified | `js/ledger.js` `collectTotals`, `bumpDay`, streak with freeze |
| Stats page, insights, achievements page | Verified | `js/stats.js`, `js/insights.js`, `js/achievementsview.js` |
| Shareable statistic card rendered to canvas | Verified | `js/sharecard.js` |

### 3.9 Notifications

| Capability | Status | Evidence |
|---|---|---|
| Android local notifications for task reminders | Verified | `js/native.js` `scheduleNativeTaskNotification` via `@capacitor/local-notifications` |
| Web Push client + optional server | **Partial / dormant** | Client gated by `js/push-service.js:18` `WEB_PUSH_ENABLED = false`; server exists (`server/push-server.js`, Express + `web-push`, `ADMIN_API_KEY`, rate limits, `subscriptions.json`) |
| Background reminders | Missing | Requires an external scheduler; acknowledged in `docs/roadmap.md:6` |

### 3.10 Settings and data control

| Capability | Status | Evidence |
|---|---|---|
| Settings with three tabs (general, themes, updates) | Verified | `index.html:1107-1116`, `js/settings.js` |
| JSON backup export/import, all-or-nothing restore with rollback | Verified | `js/backup.js` `collectBackup`, `parseBackup`, `applyBackup`, `mergeBackup` |
| Separate PDF pack export/import (files, not metadata) | Verified | `js/library.js` `exportBookPack`/`importBookPack`, `js/pdfpack.js` |
| Clear all data (localStorage + library IndexedDB) | Verified | `js/settings.js:734-737` `clearLibraryData()` + `clearAll()` |
| Music uploads included in any export | **Missing — and not yet decided** | `js/backup.js:13-15` states PDFs and uploaded music are excluded; no music pack exists. Music never synchronises either way; whether the *manual local* export must include it is OD-18 |

---

## 4. Missing and incomplete capabilities

### 4.1 Account and identity — **Missing entirely**

- No sign-up, sign-in, session, token or identity of any kind in `js/`. A repository-wide search for authentication and account concepts returns only unrelated words (e.g. "account" inside prose).
- No user record, no profile beyond a display name (`daftarche-name`) and an avatar key (`daftarche-avatar`), both device-local.
- `js/store.js:1` carries the comment *"localStorage for now — Supabase will replace it later"* and `js/achievements.js:467` mentions *"a Supabase table"* for a future friends league. **Doc-only.** No Supabase client, dependency or endpoint exists.

### 4.2 Synchronisation — **Missing entirely**

- No network call in the application except: the optional push service, a version check in `js/settings.js:273`, and (previously) the PDF runtime — now local.
- No sync queue, cursor, device id, change log, merge endpoint or retry policy.
- Cross-device movement is manual: export a JSON file, import it on the other device (`js/backup.js`).

### 4.3 Monetisation and entitlements — **Missing entirely**

- No billing plugin in `package.json` devDependencies (Capacitor android/app/cli/core/filesystem/local-notifications/share/status-bar only).
- No product catalogue, price, receipt, entitlement, subscription state or restore-purchase path.
- Unlocking is entirely achievement-driven (`js/theme.js`, `js/achievements.js`).
- Consequence for the strategy: **the premium boundary is currently "earned", not "paid"**. Moving worlds behind payment later would take away something existing users have already earned.

### 4.4 Analytics and consent — **Missing entirely**

- No analytics SDK, no event pipeline, no telemetry endpoint, no consent record, no age gate.
- The only outbound data path is the dormant push subscription (endpoint + keys), stored server-side without any user identity.

### 4.5 Data and sync prerequisites — **Missing**

- No `updatedAt`/`rev` on any record (verified by repository search for `updatedAt`, `tombstone`, `deletedAt` — no matches in `js/`).
- No deletion markers; deletes are destructive (`js/tasks.js:622`).
- No schema/version marker for the store as a whole; migrations are ad-hoc key moves (`js/store.js` `migrateStorage`) plus per-record normalisation (`js/state.js` `normalizeTask`).
- No account deletion, no server-side export, no device list.

### 4.6 Academic workflows — **Partial**

The app is student-friendly in tone and building blocks (study category, Jalali calendar, reading, focus, moods), but there is **no** academic object model: no courses, semesters, timetable, exam schedule, assignment/deadline types, grade tracking or class-session awareness. The brief's phase 4 has essentially no foundation beyond generic tasks.

### 4.7 Notifications depth — **Partial**

Per-task reminder flags exist (`notify`, `notifiedStatus` in `js/state.js`), native scheduling exists, but **background delivery requires the app or an external job**: the Web Push path is disabled, and `SCHEDULE_EXACT_ALARM` is explicitly removed from the manifest (`AndroidManifest.xml`, `tools:node="remove"`), which affects exactness of scheduled alarms on modern Android.

---

## 5. Product strengths

1. **A real Decision Engine, not a label.** Scoring weights, tie-breaks, a bounded context modifier and a separate reason engine are implemented and unit-tested (`tests/decision.test.mjs`). The context layer is deliberately conservative: it cannot rewrite the base score and says so in code.
2. **Data-loss awareness is unusually good for this class of app.** Guarded writes (`safeSet` never throws, emits `STORAGE_ERROR_EVENT` → `js/storagewarn.js`), debounced persistence with flush on `pagehide`/`visibilitychange`/`beforeunload`, `navigator.storage.persist()` requests from both entry points, soft-delete-with-undo for books, all-or-nothing restore with rollback, and a backup nudge (`js/backup-nudge.js`).
3. **The backup merge rules are a genuine conflict-resolution asset.** `js/backup.js:180-240` documents per-key merge semantics (completion is a fact and wins; pages read only grow; moods are one choice per day; achievement tier is monotone). This is exactly the domain policy a sync engine needs, already written down and tested.
4. **Accessibility and design discipline are codified.** Logical CSS properties, measured contrast floors in `tests/themes.test.mjs`, 11px type floor, 40px touch targets, `prefers-reduced-motion` and reduced-transparency handling.
5. **Offline is real, not aspirational.** A full shell cache keyed by build (`sw.js` `SHELL`, `daftarche-static-<BUILD>`), one-whole-build activation, and on Android the service worker is deliberately unregistered and replaced by bundled assets (`js/pwa.js` isNative branch).
6. **Release identity is single-sourced** (`js/version.js`) and consumed by the page, the service worker and the Gradle build (`tools/build-www.mjs`).
7. **Zero runtime dependencies.** No framework, no bundler; the web app is plain ES modules over static files.

---

## 6. Product weaknesses

1. **Five overlapping surfaces for the same object.** Tasks are rendered and edited in `today.js`, `tasks.js`, `planner.js` (day panel), `calendar.js` (month) and `week.js`. `js/planner.js:1-15` explicitly argues there is no fourth notion of "when", which is good data discipline — but the *user-facing* duplication is real and each surface has its own layout and affordances.
2. **The Decision Layer lives on one page.** It is the product's differentiator, yet it appears only on Today. Tasks, calendar and focus do not use it, and there is no "start this" hand-off from recommendation into a pre-filled focus session.
3. **No cross-surface continuity.** A recommendation cannot be scheduled into a free slot; a focus session cannot be launched at the recommended duration; a skipped recommendation leaves no trace beyond the session.
4. **Gamification is the only progression economy.** Achievements unlock worlds; there is no other reward loop and no way for a user to obtain a locked world except by behaviour change, which is a hard constraint on any future paid offering.
5. **Analytics-free means change is unmeasurable.** There is currently no way to know whether the recommendation is accepted, how often sync-like export/import is used, or where onboarding is abandoned.
6. **Very large modules.** `js/reader.js` (2,264 lines), `js/sharecard.js`, `js/tasks.js`, `js/birthday.js` (58.8 KB) are single-file domains with no test coverage for their DOM half. `docs/roadmap.md:24-27` correctly flags `reader.js`, but the actual size is larger than the document states (~1,500 lines claimed).
7. **Documentation drift.** `docs/roadmap.md` still describes pdf.js as loaded from jsDelivr with a pinned version; the code ships it locally (`js/reader.js:25`). The Content-Security-Policy in `_headers` still whitelists `https://cdn.jsdelivr.net` for scripts, workers and fonts, which is no longer needed and is a standing third-party execution permission.
8. **No in-product privacy surface.** No privacy screen, no data inventory shown to the user, no consent history — only settings toggles and a backup panel.

---

## 7. UX and workflow gaps

| Gap | Why it matters | Evidence |
|---|---|---|
| No "how much time do I have?" input anywhere | The central question cannot be answered well; the engine assumes the user's energy but not their calendar | `js/decision.js` entry signature |
| Planned spans are decorative | `timeFrom`/`timeTo` are captured and displayed but never used for planning or conflict detection | `js/state.js` (fields), `js/decision.js` (unused), `js/planner.js` (display only) |
| No "busy now" awareness | Two tasks can be planned into the same 16:00–18:00 window with no warning | `js/planner.js`, `js/calendar.js` |
| Recommendation → action is one hop short | No "start a 25-minute session on this task" path from Today | `js/today.js` vs `js/focus.js` |
| Guest state is implicit | The user is never told whether their data is local-only or backed up; the only signal is a periodic nudge | `js/backup-nudge.js`, `js/settings.js` |
| Academic vocabulary absent | Students see generic "درس/پروژه" categories, not courses, exams or semesters | `js/constants.js` `CATS` |
| Onboarding teaches three steps, then a tour | Reasonable, but there is no re-entry point explaining "where is my data stored?" | `js/onboarding.js`, `js/tour.js` |

---

## 8. Critical product risks

1. **Data-model lock-in to single-device.** Adding sync later requires touching every record shape (no version/tombstone) and every deletion path. The longer this waits, the more migration surface accumulates.
2. **Trust collapse on account introduction.** The product's entire promise is "your data stays on your device". Introducing accounts without an explicit, visible local-first guarantee (and without guest mode surviving intact) risks being read as a reversal. The current absence of any account UI is an advantage only if the transition is designed deliberately.
3. **Monetisation conflict with earned progression.** Worlds are already earned; selling them retroactively is a reputational and support hazard. The premium boundary must be defined on *new* value, not on existing unlocks.
4. **`docs/android-publishing.md` privacy text is a liability.** It promises "no data collection, no central server". Once sync or analytics ship, publishing under that statement is inaccurate.
5. **No version control in the working copy.** `git status` fails; there is no history, no branch, no revert path. Every phase of the roadmap below assumes the ability to review and roll back changes. This is a **P0 process risk**. It is mitigated for now by a read-only baseline manifest plus a verified, restorable backup (FND-01); adopting version control remains an owner decision, because initialising a repository and committing are write operations outside the authorized scope of this work.
6. **Single-maintainer bus factor with a 27,900-line hand-written codebase and no CI.** No `.github/` workflows exist; correctness rests on a manually run `node --test`.
7. **Secret material present in the working copy.** `android/keystore.properties` and `android/daftarche-release.jks` exist on disk. Whether they are tracked in a remote cannot be verified here (no Git metadata); if they ever were, the release key must be considered compromised.

---

## 9. Maturity assessment by area

Scale: **Absent → Prototype → Partial → Working → Solid**.

| Area | Rating | Justification |
|---|---|---|
| Core task management | **Solid** | Complete CRUD, quick add, spans, categories, priorities, tested pure logic |
| Focus sessions | **Working** | Real timer, persistence, history, ratings, audio; no background precision |
| Reading / PDF | **Working** | Local PDF.js, highlights, notes, goals, progress; no full-file backup, no academic layer |
| Calendar / Jalali | **Solid** | Correct conversions, three zooms, occasions, tests |
| Decision Layer | **Partial** | Verified engine, 4 of 6 signals; no available time, no commitments |
| Personalisation / worlds | **Solid** (as gamification) | 17 themes, 10 worlds, achievement contracts |
| Statistics / reflection | **Working** | Day book with floors, insights, share card |
| Data safety (single device) | **Working** | Guarded writes, backup/merge/rollback, PDF pack |
| Data safety (multi-device) | **Absent** | No sync, no stamps, no tombstones |
| Accounts / identity | **Absent** | Nothing exists |
| Monetisation | **Absent** | Nothing exists |
| Privacy / analytics | **Absent** (policy text only) | Draft text in a publishing guide |
| Android packaging | **Working** | Signed build flow, insets, back handling, local notifications |
| Android release readiness | **Partial** | No test matrix, no crash reporting, no CI, exact-alarm uncertainty |
| Test coverage | **Partial** | 442 pure-logic tests; DOM paths and browser regressions uncovered by default |
| Documentation accuracy | **Partial** | Excellent design docs; `roadmap.md` is behind the code |
| Engineering process | **Absent** | No Git in the working copy, no CI, no review trail |

**Overall:** Daftarche is a **mature single-device product and an immature platform**. It is ready to be *extended*; it is not ready to be *synchronised* or *sold* without the foundational work described in `TARGET_ARCHITECTURE.md`, `SYNC_AND_DATA_STRATEGY.md` and `IMPLEMENTATION_BACKLOG.md`.

---

## 10. Items requiring product-owner decisions

Resolved since this audit and recorded in §0: sync pricing (free with every account), the PDF synchronisation scope (metadata and progress only), and the data-protection standard (TLS plus encryption at rest, not E2EE).

Also settled and not open for revisiting: **existing earned unlocks stay free.** The 17 themes and 10 worlds already unlocked through achievements (`js/theme.js:65` `isThemeUnlocked` → `js/achievements.js` `REWARDS`) must never be revoked, paywalled, or replaced by a purchase. The premium boundary may only be drawn on value that does not exist yet.

### 10.1 Consolidated decision register

Every unresolved item in the seven documents carries one of these IDs. Other documents cite the ID instead of restating the question, so there is one place to change when a decision lands. **A recommendation is advice from this audit, not a decision**; nothing here is approved unless §0 says so.

| ID | Question | Why it matters | Affects | Recommendation (if evidence supports one) | Cost of postponing |
|---|---|---|---|---|---|
| **OD-01** | When is an account offered: at first run, at the first sync attempt, or at the first purchase? | Decides whether guest-first is real or a funnel with a form on top | `TARGET_ARCHITECTURE.md` §3, ACC-04, UX-03, `js/onboarding.js` | Offer it at the first sync attempt and at the first purchase; never at first run | Onboarding and the account screen get designed twice |
| **OD-02** | Which hosting region and backend provider constraints apply? | Decides the entire backend technology choice, including whether managed services are reachable from the target market | D3, ACC-01, ACC-02, PRIVACY §11.4 | None — needs market and operational evidence this audit cannot produce | ACC-02 cannot be built with confidence; every later backend task inherits the uncertainty |
| **OD-03** | Is Web Push revived, replaced by an in-app scheduler, or retired? | Three different products hide behind one dormant flag | `js/push-service.js`, `server/`, AND-01, `docs/roadmap.md` | Retire for now; Android local notifications already cover reminders | Dead code and a dormant service keep implying a capability that is switched off |
| **OD-04** | Does the optional `server/` directory stay as a dormant component or leave? | Repository hygiene and the accuracy of the privacy statement | PRIVACY §1.1, FND-02 | Keep until OD-03 is decided, then retire together | The privacy text must keep explaining a component nobody uses |
| **OD-05** | Focus history: does it sync, how long is it retained, and is analysis over it a Plus benefit? | Three separate questions currently collapsed into one, and a destructive 100-record cap sits behind them. Focus history is **not** in the approved Sync scope or the migration snapshot while this is open | FND-09, `TARGET_ARCHITECTURE.md` §4.1, `SYNC` §4/§5.2/§5.4, `MONETIZATION` §3 | Sync it free (it is the user's record), apply a server retention rule, sell analysis rather than history | FND-09 stays blocked and history remains unclassified, so no sync claim can be complete. Until it is decided, history stays outside both Sync and the guest→account migration |
| **OD-06** | Do preferences follow the account or stay per device? | Theme and appearance are personal but cosmetic; identity fields are not | FND-10, ACC-10, `SYNC` §5.2 (**P** tier) | Sync appearance settings only; keep display name and avatar local | Two lists to maintain, and ACC-10 cannot finalise its copy |
| **OD-07** | May a signed-in device remain permanently local-only? | A privacy-positive option that changes what "signed in" promises | ACC-04, ACC-07, `SYNC` §6.4, UX-02 | Allow it — pausing is already defined, permanence is the honest version | The session model keeps an undefined state users will ask about |
| **OD-08** | Do the birthday record and annual wishes sync? | Personal data about a possibly-minor user, with user-written text. The record is **?** in the canonical Sync table, so it does not sync today | FND-10, PRIVACY §2/§8/§11.3, `SYNC` §5.2, `js/birthday.js` | Local-only by default, opt-in later | The birthday feature behaves differently per device, and the policy must say so. Its absence from the Backup `EXCLUDED` set is a backup fact and must never be read as a Sync classification |
| **OD-09** | What exactly are "reflections", and do they sync? | A data category named in the privacy document with no identified storage key | FND-10, `SYNC` §2, PRIVACY §2 | Identify the record first; no classification until then | A policy category with no defined home, and a possible gap in the deletion story |
| **OD-10** | Does the profile photo follow the account? | A data URL image, not a record | FND-10, ACC-10 | No — an image is not a synced record, and the profile works without it | Profile looks different per device unless stated |
| **OD-11** | Is account deletion immediate, or after a disclosed grace period? | Determines what "delete" promises and what must be implemented | ACC-08, PRIVACY §7.1 | Immediate deletion, with export offered first | ACC-08's deletion copy cannot be finalised, and a grace period risks shipping undisclosed |
| **OD-12** | Are permanent purchases restored after account deletion and re-creation? | "Permanent" is bound to an account row that deletion removes | PAY-05, `MONETIZATION` §5.6 | Support-assisted restore until volume justifies automation | The support process is undefined at launch, and refunds arrive |
| **OD-13** | Which store(s) and payment channel(s)? | Channel choice shapes checkout, policy compliance and price display | PAY-03, PAY-04, `MONETIZATION` §7 | Bazaar is the only documented in-app channel for the Android build — confirm before building | PAY-03/04 cannot start, and the catalogue has no channel keys |
| **OD-14** | Subscription first, or one-time packs first? | Renewal, expiry and refund handling are materially harder than a pack | `MONETIZATION` §9, PAY-02 | Packs first; a single validated loop before recurrence | The entitlement model may be over-built before it is proven |
| **OD-15** | What do minors, parental consent, purchases and Iranian obligations require? | Governs whether an age gate, consent flow or purchase restriction is needed at all | PRIVACY §8, onboarding, PAY-03 | Qualified local counsel before any account or purchase release | Neither an age gate nor purchase eligibility can be designed; shipping either without it is a legal risk |
| **OD-16** | Where does the new premium boundary fall, now that earned unlocks and sync are free? | Plus must sell something a free account genuinely cannot do | `MONETIZATION` §3–4, PAY-01 | New worlds/packs plus analysis over the user's own history; never earned content, sync, restore or export | PAY-01 cannot finalise a catalogue |
| **OD-17** | How is a re-imported PDF matched to a restored book record? | Without a rule, restoring metadata on a second device produces duplicate shelf entries | SYN-01, `js/library.js` import path | Explicit attach action with a suggested candidate; never an automatic merge | Second-device restore produces duplicates the user must clean up by hand |
| **OD-18** | Must uploaded music be included in the manual local export? | Uploaded music is local-only and never synchronises, but the manual export currently carries neither the tracks nor a PDF-style pack for them — so the honest wording and the implementation are both unsettled | `SYNC` §7.6/§10.2, PRIVACY §7.2, ACC-08, `js/audio.js`, `js/backup.js:13-15` | Include a separate music pack in the manual local export, kept out of Sync and out of the account export | Export copy cannot state whether music is recoverable, so a user cannot tell what an export actually preserves |
