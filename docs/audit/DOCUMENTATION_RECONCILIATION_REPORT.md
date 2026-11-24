# Documentation Reconciliation Report — Daftarche Phase 0

- **Nature of this document:** reconciliation record for a documentation-only correction pass over the seven Phase 0 audit documents.
- **Working copy:** `D:\Project\NewDaftrche`, documentation directory `docs/audit/`.
- **Date of this pass:** 17 November 2026; amended 18 November 2026 by Correction G (Sync versus local-export wording), and again on 19 November 2026 by the residual-wording pass recorded in Correction G (continued).
- **Version audited by the Phase 0 documents:** `3.5.0`, build `v203` (`js/version.js`). No version was changed by this pass.

Status labels used in the Phase 0 set are unchanged: **Verified**, **Partial**, **Doc-only**, **Missing**, **Unverified**.

---

## 1. Scope

### 1.1 Documents reviewed (all seven)

| # | Document | Path |
|---|---|---|
| 1 | Product Maturity Audit | `docs/audit/PRODUCT_MATURITY_AUDIT.md` |
| 2 | Target Architecture | `docs/audit/TARGET_ARCHITECTURE.md` |
| 3 | Sync and Data Strategy | `docs/audit/SYNC_AND_DATA_STRATEGY.md` |
| 4 | Implementation Backlog | `docs/audit/IMPLEMENTATION_BACKLOG.md` |
| 5 | Monetization Strategy | `docs/audit/MONETIZATION_STRATEGY.md` |
| 6 | Privacy and Analytics Policy | `docs/audit/PRIVACY_AND_ANALYTICS_POLICY.md` |
| 7 | Android Maturity Plan | `docs/audit/ANDROID_MATURITY_PLAN.md` |

### 1.2 Documents modified

Six of the seven: `TARGET_ARCHITECTURE.md`, `SYNC_AND_DATA_STRATEGY.md`, `PRIVACY_AND_ANALYTICS_POLICY.md`, `PRODUCT_MATURITY_AUDIT.md`, `IMPLEMENTATION_BACKLOG.md`, `MONETIZATION_STRATEGY.md`.

`ANDROID_MATURITY_PLAN.md` was reviewed and **not modified**. Its only statements in this area are that the app must never queue or upload a PDF file, annotation, cover or music track (§3.11) and that no such payload may appear in any request during a full sync (§4). Both remain correct and consistent with the canonical classification, and the document makes no claim about focus history, birthday data, preferences or music export.

A later documentation-only pass on 18 November 2026 (Correction G) modified four of those six again — `SYNC_AND_DATA_STRATEGY.md`, `PRIVACY_AND_ANALYTICS_POLICY.md`, `TARGET_ARCHITECTURE.md` and `IMPLEMENTATION_BACKLOG.md` — and updated this report. `PRODUCT_MATURITY_AUDIT.md`, `MONETIZATION_STRATEGY.md` and `ANDROID_MATURITY_PLAN.md` were not modified in that pass; they were read and searched only.

A further documentation-only pass on 19 November 2026 corrected three residual statements that Correction G had missed, and is recorded in §2 as Correction G (continued). It modified `SYNC_AND_DATA_STRATEGY.md` and `PRIVACY_AND_ANALYTICS_POLICY.md` again, plus one adjacent row in the same privacy section, and updated this report. `TARGET_ARCHITECTURE.md`, `IMPLEMENTATION_BACKLOG.md`, `PRODUCT_MATURITY_AUDIT.md`, `MONETIZATION_STRATEGY.md` and `ANDROID_MATURITY_PLAN.md` were read and searched in that pass and were **not** modified.

### 1.3 Boundary confirmation

No source code, dependency, package file, build configuration, asset, database file or application behaviour was changed by this pass. No Git write operation was performed. Nothing was built, deployed, released, published or uploaded. The approved product decisions recorded in Phase 0 were preserved as approved, and no new product decision was introduced.

---

## 2. Correction inventory

### Correction A — Focus history: migration and Sync scope

**Original inconsistency.** `TARGET_ARCHITECTURE.md` §4.1 listed focus history inside the bullet labelled "Scope of the snapshot **[APPROVED]**", while `SYNC_AND_DATA_STRATEGY.md` §5.2 classified focus history as **?** under OD-05. The architecture document therefore treated an undecided record as part of an approved migration, and a reader could also infer it was in the Sync scope.

| Document | Section | Change |
|---|---|---|
| `TARGET_ARCHITECTURE.md` | §4.1 "Scope of the snapshot [APPROVED]" | Focus history removed from the migrated set. The bullet now states that focus history stays outside both Sync and migration until OD-05 is resolved, and points to `SYNC_AND_DATA_STRATEGY.md` §5.2, §5.4 and §7.4. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 status codes, **?** row | Now states that a pending record must not be synchronized **or migrated**. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 table, Focus history row | Status remains **?**, and now reads "Pending and inactive: not synced, not migrated, not queued, and no merge rule runs for it, until OD-05 is decided". |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 consequences (new consequence 3) | Added the general rule that a **P** or **?** row may not enter the projection, the migration snapshot or the outbox, and no conflict rule may run for it. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.4 merge table | The focus-history union rule is now labelled **dormant / proposed / Backup-only** and explicitly "not an active Sync rule". A paragraph after the table explains that a dormant rule must not be read as approval. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.4 migration table | Row now reads "Pending and inactive: cap, retention and Plus boundary unresolved". |
| `IMPLEMENTATION_BACKLOG.md` | Critical path note; dependency note 10 | Restated as "neither synchronised nor migrated" before OD-05. FND-09 already required OD-05 and remains outside the critical path. |
| `MONETIZATION_STRATEGY.md` | §3 Plus table; retention paragraph | The candidate benefit no longer claims history "the account already holds"; it is framed as whatever history exists **once OD-05 settles what that is**, and the paragraph adds that history is neither synchronised nor migrated in the meantime. |
| `PRODUCT_MATURITY_AUDIT.md` | §10.1, OD-05 row | "Why it matters" and "Affects" now record that focus history is not in the approved Sync scope or the migration snapshot while the decision is open. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2 data map; §2.1 | Row reads "Not synced and not migrated. Pending and inactive"; §2.1 adds that pending means inactive. |

The retention limit, the local cap and the subscription boundary remain undecided. None of them was chosen here.

### Correction B — Birthday data: Backup exclusion is not Sync classification

**Original inconsistency.** `PRIVACY_AND_ANALYTICS_POLICY.md` §8 argued that `daftarche-birthday` "is **not** in `EXCLUDED`, so it would sync". That used a Backup-only exclusion list to draw a Sync conclusion, contradicting the canonical **?** classification in `SYNC_AND_DATA_STRATEGY.md` §5.2.

| Document | Section | Change |
|---|---|---|
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §8 minors table, birthday row | Rewritten: birthday data is optional and local, is not synchronised, and would only become server-side data if OD-08 approved inclusion. It now cites the canonical Sync classification and states that absence from the Backup `EXCLUDED` set is a Backup fact only. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2 data map, birthday row | Now reads "Not synced and not migrated. Pending and inactive pending decision (OD-08); Backup classification does not imply Sync". |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2.1 | States explicitly that these records are not in the approved set and that pending means inactive. §11 item 3 restated so that birthday data and annual wishes "are **not** synchronised unless and until OD-08 approves their inclusion". |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 birthday rows; consequence 2 | Both rows record pending/inactive status. Consequence 2 was extended with the birthday example: the record is absent from `EXCLUDED` only because the backup carries it, its Sync status is **?**, and Backup and Sync classification are separate questions. |
| `PRODUCT_MATURITY_AUDIT.md` | §10.1, OD-08 row | Records that the record is **?** today, and that the Backup `EXCLUDED` list must never be read as a Sync classification. |

OD-08 was not decided. Birthday data and annual wishes remain outside Sync and outside the migration snapshot.

### Correction C — Preferences: pending means inactive

**Original inconsistency.** `SYNC_AND_DATA_STRATEGY.md` marked preferences **P** under OD-06, but §5.4 still carried a last-write-wins preference rule and §7.2 allowed **P** records into the snapshot "if preference sync is enabled". Both could be read as an active mechanism.

| Document | Section | Change |
|---|---|---|
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 status codes, **P** row | Now reads "Inactive until decided: not synced, not migrated, never queued". |
| `SYNC_AND_DATA_STRATEGY.md` | §5.4 merge table | Preference rule labelled **dormant / proposed**, with "inactive until OD-06: the rule must not run for any **P** field". |
| `SYNC_AND_DATA_STRATEGY.md` | §7.2 step 2 | Snapshot now takes every **S** record "and nothing else — no **P** or **?** record". |
| `SYNC_AND_DATA_STRATEGY.md` | §7.4 migration table | Row now reads "Pending and inactive: no **P** field enters this snapshot until preference sync is approved". |
| `SYNC_AND_DATA_STRATEGY.md` | §12 | Added the statement that approved decisions do not approve any **P** or **?** row. |
| `IMPLEMENTATION_BACKLOG.md` | FND-10 acceptance | Added that a `P` or `?` classification is inactive rather than merely unscheduled, and that no pending field may enter the projection, the snapshot or the outbox until its decision is approved. |
| `TARGET_ARCHITECTURE.md` | §4.1 | States that no pending (`P` or `?`) record, preference values under OD-06 included, may enter a migration snapshot before approval. |

No pending preference field was promoted to an approved field, and OD-06 was not decided. The "streak freeze" economy question remains inside OD-06 as before.

### Correction D — Uploaded music and manual export

**Original inconsistency.** The documents agreed that uploaded music is local-only and outside Sync, but the manual export question was answered in conflicting directions. `SYNC_AND_DATA_STRATEGY.md` §10.2 said a music pack was "missing — must be added or explicitly declined in the UI", which pre-empted a decision, while `IMPLEMENTATION_BACKLOG.md` ACC-08 pointed users at "the local JSON backup and PDF pack" for music, which does not exist. No document recorded this as an owner decision.

A new decision ID, **OD-18**, was allocated after checking the register: the existing entries run OD-01 to OD-17, so there is no collision.

| Document | Section | Change |
|---|---|---|
| `SYNC_AND_DATA_STRATEGY.md` | §7.6 | Heading and table restructured to distinguish **automatic account Sync**, **manual local backup**, and **account data export**. A row records that uploaded music is never in Sync, never in the account export, and not in the manual export today with whether it must be as **OD-18**. Three numbered paragraphs define the three paths. A closing paragraph states that uploaded music is outside Sync and outside the account export but not categorically outside the manual export, that whether the manual export must include it is OD-18, and that no music export may be promised or created as an implementation task before the decision. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 consequence 4 | Cross-reference to the three paths and to OD-18. |
| `SYNC_AND_DATA_STRATEGY.md` | §10.2 recovery | Replaced the "must be added or explicitly declined" instruction with a statement that music has no export today, that OD-18 is pending, and that no music export is promised or required until the decision is recorded. |
| `SYNC_AND_DATA_STRATEGY.md` | §12 | OD-18 added to the table of decisions touching this document. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §7.2 export | Adds the three-path distinction as a table, states that the manual export question is OD-18, and separates it from the account export, which can never contain music because the backend never receives it. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2 data map; §11 item 7 | Music row notes OD-18. A new open question 7 asks whether the manual local export must include music tracks. |
| `PRODUCT_MATURITY_AUDIT.md` | §3.10 table; §10.1 | Music-in-export finding now reads "Missing — and not yet decided". New **OD-18** register entry records the question, the affected documents and tasks, a recommendation, and the cost of postponing. |
| `IMPLEMENTATION_BACKLOG.md` | ACC-08 acceptance | The export screen states the music status without promising a music export and without declaring music permanently unexportable. No implementation task for music export was created. |
| `TARGET_ARCHITECTURE.md` | §4.1 | Closes the bullet by stating that music in the manual local export is a separate unresolved decision (OD-18) and not a migration question. |

The existing decision is preserved: uploaded music remains local-only and is never synchronised.

### Correction E — Retention wording and OD-11

**Original inconsistency.** `PRIVACY_AND_ANALYTICS_POLICY.md` described account retention as "Life of account + a short, documented deletion window" (§3) and "Life of account + a short, documented deletion window … must be stated in the policy" (§6), while §7.1 recorded the deletion timing as an open decision (OD-11) with a 14-day window only as a proposal. The retention tables therefore implied an approved window.

| Document | Section | Change |
|---|---|---|
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §3 account data requirements | Retention cell now reads "Life of account; deletion timing and any grace period are pending OD-11 (§6)". |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §6 retention table | Row now reads "Life of account. Deletion timing and any grace period are **pending OD-11**; no window is approved, implemented or promised. Legally required retention obligations, if applicable, must be assessed separately". The note column states the row cannot be finalised until OD-11. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §7.1 deletion, item 4 | Rewritten: account deletion timing is pending OD-11; no specific window is approved, and none may be described to users, implemented or implied before the decision is recorded. Legally required retention is to be assessed on its own merits and disclosed if it applies. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §9 required policy updates, item 4 | Now states that account-deletion timing and any grace period await OD-11 and must not be stated before it is decided. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §11 open questions, item 5 | Re-phrased as the OD-11 question without a proposed duration. |

No 14-day grace period is promised anywhere in the seven documents, and no retention window is presented as approved. OD-11 was not decided.

### Correction F — Cross-document consistency

The seven documents were reviewed together after the five corrections. Topics checked and the outcome are recorded in §4 below. Two wording changes came out of that review beyond the specific items above:

| Document | Section | Change |
|---|---|---|
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 consequence 4 | Added, so the three paths are stated in the canonical section and not only in §7.6. |
| `MONETIZATION_STRATEGY.md` | §3 | Removed the implication that Plus analysis would run on history the account already holds. |

No new product decision was introduced to make the set appear complete. Where a conflict needed an owner decision, it is recorded as unresolved against its OD identifier in §3 of this report.

### Correction G — Sync versus local export: naming the mechanism

**Original inconsistency.** The documents used "never leaves the device" and "nothing leaves the device" to mean "never sent to the Daftarche backend". Those sentences are inaccurate, because the same PDF files, PDF annotations and book cover images are carried by user-initiated local exports: the PDF pack (`js/library.js` `exportBookPack`) and the JSON backup (`js/backup.js`). `SYNC_AND_DATA_STRATEGY.md` §7.6 also said uploaded music "sits outside all three", which reads as a permanent export prohibition rather than as today's implementation.

| Document | Section | Change |
|---|---|---|
| `SYNC_AND_DATA_STRATEGY.md` | §7.6 closing paragraph | Replaced "sits outside all three". It now states separately that uploaded music is excluded from Automatic Account Sync, excluded from Account Data Export, absent from the current Manual Local Backup/Export implementation, and that future inclusion in the manual export is **OD-18** and unresolved. It adds that absent today is not the same as impossible. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.6 table, uploaded-music row | Re-checked, unchanged in substance: "Not included today" refers to the manual export, "Never — status **X**" to Sync, and "Can never appear" to the account export, which the backend cannot fill. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.3 PDF bytes row | "Approved: the file never leaves the device" replaced with exclusion from upload and Sync, plus a pointer to the PDF pack that carries the file. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.5 migration promise | "your notes stay on this device too" narrowed to "your notes are not uploaded — they stay on this device", so the promise is about upload, not about export. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | Summary; §2 data map, music row | The summary now says the excluded items are never uploaded to or synchronised with the backend, with the local-export caveat and **OD-18**. The music row separates "never uploaded or synchronised" from "not in the manual export today; pending OD-18". |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2 design-intent paragraph; §2.1 | Removed "never leaves the device at all". The §2.1 "Never transferred" list is now "Never transferred to the account" and names which of those items a local export does carry. The wording-consequence paragraph now says the flat claim is wrong in both states and requires naming the mechanism. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §9 item 3; §11 settled summary | Item 3 distinguishes backend transmission from local export and marks the music question as **OD-18**. The settled summary keeps "never sync" and adds that it is a backend-transfer statement only. |
| `TARGET_ARCHITECTURE.md` | §2.4 consequence bullet | "nothing leaves the device unless the user registers" replaced: a guest session sends nothing to the backend, an authenticated user transfers only approved Sync records while Sync is enabled, Manual Local Backup/Export is separate and account-free, local exports may include PDF files, annotations and covers, music is not in the current manual export (**OD-18**), and the excluded items are not transferred through Sync or the account export. |
| `IMPLEMENTATION_BACKLOG.md` | ACC-10 acceptance | "What never leaves the device" replaced by "what is never sent to Daftarche's servers, and therefore never synchronised", with a fourth question covering what a Manual Local Backup/Export can contain and the music limitation as **OD-18**. No new task was created and ACC-10's scope is unchanged. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.4 PDF files row | "the file stays on the device" replaced with exclusion from upload and migration, plus a pointer to the PDF pack that carries it. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §4 guest-mode bullet | "Nothing leaves the device" narrowed to "Nothing is sent to the Daftarche backend", so the guest claim is about backend contact rather than about export, which the same section calls the only backup. |
| `TARGET_ARCHITECTURE.md` | §4.2 restore paragraph; D6 rationale | The PDF is described as not synchronised rather than as merely staying on the device, and the analytics rationale no longer quotes "no personal content leaves the device". |
| `DOCUMENTATION_RECONCILIATION_REPORT.md` | This section, §1.2, §4, §5, §6, §7 | Updated to record this pass. |

No approved decision was changed. Guest mode, optional registration, the free-Sync rule, the approved classification, TLS with encryption at rest, the explicit non-E2EE decision, and the PDF and music exclusions from backend Sync all stand as before. **OD-18** was not decided, and no document treats its proposed outcome as approved.

### Correction G (continued) — statements missed on 18 November

**Why this subsection exists.** The Correction G pass recorded that every remaining occurrence of the old wording had been inspected in context and either reworded or confirmed correct. That statement was too strong. Three statements that still tied an exclusion from Sync to an inability to leave the device survived that pass, because the search was built around the phrase "leaves the device" and these sentences used different words: a data-map row said the content "never leaves the device **today**", and the two Sync merge-table cells said annotations "never leave the device". They are corrected here, and the earlier claim is withdrawn rather than repeated.

| Document | Section | Change |
|---|---|---|
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §1 table, "Local content" row | "never leave the device **today**" replaced. The row now says these records are **not transmitted to the Daftarche backend today**, because there is no account and no Sync implementation, and that a signed-in user would transfer only the approved record set. It states that this is a statement about backend transfer only, that user-initiated local exports already carry supported data — the JSON backup (`js/backup.js`), including PDF annotations and book covers, and the PDF pack (`js/library.js` `exportBookPack`), carrying the PDF files — that uploaded music is in no local export today with its inclusion pending **OD-18**, and that not every category in the row is in every export. |
| `PRIVACY_AND_ANALYTICS_POLICY.md` | §2 data map, "PDF files" row | "**Device only** — never uploaded" now reads "never uploaded to the backend; carried off the device only by the user-initiated PDF pack export", so the cell cannot be read as an export prohibition. This row was not named in the request but is the same residual statement in the same table and was corrected with it. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 table, `highlights[]` row | "Approved: annotations never leave the device" replaced with four explicit statements: excluded from Automatic Account Sync; never transferred to the Daftarche backend; included in the existing user-initiated JSON backup (§7.6); annotation continuity through account Sync is not offered. |
| `SYNC_AND_DATA_STRATEGY.md` | §5.2 table, `notes[]` row | "Same" expanded into the same four statements, so the row stands on its own instead of inheriting a phrase that was itself wrong. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.4 table, PDF annotations row | The exclusion is now stated as an exclusion from Sync and migration **and** explicitly not from export, with a pointer to the JSON backup in §7.6. The approved rule — annotations do not transfer through migration or Automatic Sync — is unchanged. |
| `SYNC_AND_DATA_STRATEGY.md` | §7.5 migration promise | "your notes are not uploaded — they stay on this device" replaced by: "Your PDF annotations are not uploaded to your account. They remain available in your local data and can be included in your JSON backup." A following sentence requires the promise to name the backend transfer it describes, forbids reading it as an export prohibition, and forbids implying that migration carries annotations. |
| `DOCUMENTATION_RECONCILIATION_REPORT.md` | This subsection; §1.2, §4, §5, §6 | Updated to record this pass, the exact corrections and the withdrawn overclaim. |

**Documents re-searched and not modified.** `TARGET_ARCHITECTURE.md` was searched again across the whole document for this class of statement and needed no edit: §2.3 states the backend's non-responsibility for binaries and annotations, §2.4 names Manual Local Backup/Export as a separate mechanism with its contents, and §4.2 already says the PDF "is not synchronised … and travels only in a user-initiated local export". `IMPLEMENTATION_BACKLOG.md` ACC-08 and ACC-10 already put the local JSON backup and PDF pack beside the exclusions, so no wording there implies an export prohibition. `ANDROID_MATURITY_PLAN.md` speaks only about not queueing or uploading these payloads, which remains correct.

**One phrase left in place, deliberately.** `MONETIZATION_STRATEGY.md` §3 says the PDF files "themselves stay on the device". Read in context it describes what a Plus row does not offer (sync continuity), not an export restriction, and the file is outside the authorised scope of this pass. It was therefore not edited and is recorded here as the only remaining phrase of this family in the Phase 0 set, so that a later pass can decide whether it is worth rewording.

**Approved decisions unchanged.** Guest mode, optional registration, the free-Sync rule, the approved **S** classification, TLS with encryption at rest, the explicit non-E2EE decision, and the exclusion of PDF files, annotations, covers and music from Automatic Account Sync and from the migration snapshot all stand as before. Nothing in this pass made a pending decision approved: **OD-05**, **OD-06**, **OD-08**, **OD-11** and **OD-18** remain open, and **OD-18** in particular is still unanswered — uploaded music is in no local export today, and no music export is promised or forbidden.

---

## 3. Owner decisions still pending

None of these was decided by this pass. Each blocks at least one document statement or task.

| ID | Question | What cannot proceed until it is decided |
|---|---|---|
| **OD-05** | Does focus history sync at all, how long is it retained locally and server-side, and is long-range analysis over it a Plus benefit? | Focus history cannot enter Sync or the guest→account migration snapshot, no merge rule for it may be activated, FND-09 cannot start, and any Plus description of analysis over history is provisional. The 100-record local cap remains destructive and undisclosed in an account context. |
| **OD-06** | Do preferences follow the account or stay per device? | No **P** field may enter the migration snapshot, the outbox or Sync, the preference conflict rule stays dormant, ACC-10's "what synchronises" copy cannot be finalised, and FND-10 keeps a frozen **P** tier. |
| **OD-08** | Do the birthday record and annual wishes sync? | Birthday data and annual wishes stay local. The privacy section on minors cannot be completed, the per-device difference in the birthday feature must remain stated rather than resolved, and any Sync or migration inclusion is prohibited. |
| **OD-11** | Is account deletion immediate, or after a disclosed grace period, and how long? | The retention tables and deletion screen cannot be finalised. No grace period may be implemented or promised, and no window may be disclosed, until this is recorded. |
| **OD-18** | Must the manual local export include uploaded music tracks? | The export copy cannot say whether uploaded music is recoverable, no music pack may be promised, and no implementation task for one may be created. Music remains local-only and outside Sync regardless of the answer. |

Two further decisions in the same neighbourhood remain open and are recorded here because they are cited by the corrected passages, even though this pass did not change their substance:

- **OD-09** — what "reflections" are and whether they sync. The record still has no identified storage key, so it cannot be classified.
- **OD-10** — whether the profile photo follows the account. It remains **?**, and a data URL image is still not a record.

Also unresolved and unchanged: OD-01 through OD-04, OD-07, OD-12 through OD-17, including the premium boundary (OD-16) that the Plus tables depend on.

---

## 4. Cross-document consistency check

| Topic | Documents checked | Result |
|---|---|---|
| Approved migration scope | `TARGET_ARCHITECTURE.md` §4.1; `SYNC_AND_DATA_STRATEGY.md` §5.2, §7.2, §7.4; `PRIVACY_AND_ANALYTICS_POLICY.md` §2.1; `IMPLEMENTATION_BACKLOG.md` GST-02, FND-10 | Consistent. The snapshot contains **S** records only: tasks, the nine allowlisted book fields, day-open history, moods, ledger and achievements. Focus history, birthday data, reflections, the profile photo and preference values are excluded. |
| Active versus pending Sync fields | `SYNC_AND_DATA_STRATEGY.md` §5.2, §5.4, §7.2, §7.4, §12; `PRIVACY_AND_ANALYTICS_POLICY.md` §2, §2.1 | Consistent. **S** is active; **P** and **?** are inactive in Sync, migration and the outbox; the two dormant merge rules are labelled. |
| Guest-mode behaviour | `TARGET_ARCHITECTURE.md` §3; `SYNC_AND_DATA_STRATEGY.md` §6.1, §6.3; `PRIVACY_AND_ANALYTICS_POLICY.md` §4; `IMPLEMENTATION_BACKLOG.md` GST-01; `MONETIZATION_STRATEGY.md` §2 | Consistent. Guest mode is complete, account-free and never time-limited; no login wall; guest mutations create no remote work. |
| Guest-to-account migration | `TARGET_ARCHITECTURE.md` §4.1; `SYNC_AND_DATA_STRATEGY.md` §7; `IMPLEMENTATION_BACKLOG.md` GST-02; `MONETIZATION_STRATEGY.md` §6 | Consistent. Local data is never deleted by migration; resumption is idempotent; scope is **S** only; the screen must not describe the account as a full library backup. |
| Backup versus automatic Sync | `SYNC_AND_DATA_STRATEGY.md` §5.2 consequence 2, §7.6; `PRIVACY_AND_ANALYTICS_POLICY.md` §7.2; `IMPLEMENTATION_BACKLOG.md` FND-07, ACC-08 | Consistent, and now explicitly three-way: Sync, manual local backup, account data export. Backup is never used to infer Sync scope, and no backup capability was weakened in the description. |
| Account deletion and retention | `PRIVACY_AND_ANALYTICS_POLICY.md` §3, §6, §7.1, §9; `SYNC_AND_DATA_STRATEGY.md` §10; `IMPLEMENTATION_BACKLOG.md` ACC-08; `PRODUCT_MATURITY_AUDIT.md` OD-11 | Consistent after correction E. No grace period is presented as approved. Deletion completeness (server rows, tombstones, cursors, migrations, devices, entitlements, analytics ids) and the separate device-wipe choice agree across documents. |
| Data export | `PRIVACY_AND_ANALYTICS_POLICY.md` §7.2; `SYNC_AND_DATA_STRATEGY.md` §7.6, §10.2; `IMPLEMENTATION_BACKLOG.md` ACC-08; `MONETIZATION_STRATEGY.md` §3.2; `PRODUCT_MATURITY_AUDIT.md` OD-18 | Consistent. Export stays free. Account export covers server-held data only. Music in the manual local export is OD-18 pending, not promised and not excluded permanently. |
| Sync versus local export wording | `SYNC_AND_DATA_STRATEGY.md` §5.2, §5.3, §7.4, §7.5, §7.6; `PRIVACY_AND_ANALYTICS_POLICY.md` summary, §1, §2, §2.1, §4, §7.2, §9, §11; `TARGET_ARCHITECTURE.md` §2.3, §2.4, §4.2, D6; `IMPLEMENTATION_BACKLOG.md` ACC-08, ACC-10 | Consistent **after Correction G (continued)**, not after Correction G alone. The statements about PDF files, annotations, covers and music now name the mechanism — upload to the backend, account data export, or user-initiated local export — in every passage inspected, including the four that the earlier pass left in place: privacy §1, privacy §2's PDF row, and the two Sync §5.2 annotation rows. One phrase of this family remains in `MONETIZATION_STRATEGY.md` §3 ("the PDF files themselves stay on the device"), untouched because that file was outside this pass's scope; it refers to Sync continuity rather than export. Music in the manual export remains **OD-18** pending. |
| Privacy and analytics exclusions | `PRIVACY_AND_ANALYTICS_POLICY.md` §2, §5.5; `TARGET_ARCHITECTURE.md` D6; `IMPLEMENTATION_BACKLOG.md` PRV-01/02 | Consistent. Analytics is opt-in, off by default, closed-vocabulary and content-free; no content field is permitted anywhere in the event schema. |
| Subscription boundaries | `MONETIZATION_STRATEGY.md` §2, §3, §3.1; `TARGET_ARCHITECTURE.md` D8; `ANDROID_MATURITY_PLAN.md` §3.11; `IMPLEMENTATION_BACKLOG.md` PAY-01, PAY-02 | Consistent. Sync is free with every account, is absent from the catalogue, and no Plus row is presented as approved. Plus analysis over history stays provisional under OD-05. |
| Android maturity and release readiness | `ANDROID_MATURITY_PLAN.md` §3.11, §4, §5; `IMPLEMENTATION_BACKLOG.md` Phase 6 | Consistent and unchanged. The security requirements in §3.11 are marked approved-but-not-implemented, and the device matrix remains unexecuted. |
| Existing earned unlocks and free Sync | `MONETIZATION_STRATEGY.md` §1, §2, §3.1, PAY-01; `PRODUCT_MATURITY_AUDIT.md` §10; `TARGET_ARCHITECTURE.md` D8 | Consistent. Earned worlds and themes are never revoked or paywalled; Sync is never a paid product or trial. |
| Encryption wording and the non-E2EE model | `TARGET_ARCHITECTURE.md` §2.3, §2.4, D9; `ANDROID_MATURITY_PLAN.md` §3.11; `PRIVACY_AND_ANALYTICS_POLICY.md` §9 item 3a, §11; `SYNC_AND_DATA_STRATEGY.md` §0; `IMPLEMENTATION_BACKLOG.md` SEC-01 | Consistent. TLS in transit, standard encryption at rest, separately managed keys, per-account authorization, operator-side access technically possible, and no E2EE claim anywhere. |

### 4.1 Remaining contradictions and ambiguities

Full consistency is **not** claimed. The following remain open by design, because resolving them would require a product decision this pass was not authorised to make:

1. **Focus history retention and the Plus boundary (OD-05).** History is now consistently outside Sync and migration, but the local 100-record cap still trims data silently, and the documents still describe several possible retention answers without choosing one. `SYNC_AND_DATA_STRATEGY.md` §4 F3 remains a list of options, not a decision.
2. **Preference scope (OD-06).** The **P** tier is frozen consistently, but the tier boundary itself — which appearance fields versus identity fields follow the account — is still undecided, so ACC-10's copy cannot be finalised.
3. **Birthday data (OD-08).** Consistently not synchronised. Whether the birthday feature should ever synchronise, and how it behaves per device in the meantime, stays a policy wording question rather than a resolved behaviour.
4. **Account deletion timing (OD-11).** Consistently pending. Because no answer exists, the privacy policy can state what deletion removes but not when, and the retention table's final row cannot be closed.
5. **Music export (OD-18).** Consistently pending. Users today have no music export at all, and the documents now say so instead of promising or forbidding one.
6. **Reflections (OD-09) and the profile photo (OD-10).** Both remain **?** and unclassified because the underlying record question is unanswered. The privacy data map continues to name a category ("reflections") that has no identified storage key.
7. **Premium boundary (OD-16).** All Plus rows remain candidates. This is unchanged from Phase 0 and not a new conflict.
8. **Backup `EXCLUDED` set.** Verified against the source: `js/backup.js:39` defines `EXCLUDED` as `daftarche-seen-version` and `daftarche-birthday-seen`. `daftarche-birthday` is not a member, which is why the earlier wording misfired. All references now treat that set as Backup-only. This is a wording resolution, not a code finding; no code was changed.

---

## 5. Change inventory

| File | Status | Nature |
|---|---|---|
| `docs/audit/DOCUMENTATION_RECONCILIATION_REPORT.md` | **Created**, then amended | This report; Correction G added on 18 November 2026, and Correction G (continued) added on 19 November 2026. |
| `docs/audit/TARGET_ARCHITECTURE.md` | Modified | Corrections A and D: migration snapshot scope bullet in §4.1. Correction G: §2.4 security-boundary consequence bullet, §4.2 restore paragraph, D6 rationale. |
| `docs/audit/SYNC_AND_DATA_STRATEGY.md` | Modified | Corrections A, B, C, D: §5.2 status codes, table rows and consequences; §5.4 merge table and dormant-rule paragraph; §7.2 step 2; §7.4 rows; §7.6 heading, table and three-path explanation; §10.2 recovery; §12 settled note and OD table. Correction G: §5.3 PDF bytes row; §7.4 PDF files row; §7.5 migration promise; §7.6 closing paragraph. Correction G (continued): §5.2 `highlights[]` and `notes[]` rows; §7.4 annotations row; §7.5 promise rewritten again. |
| `docs/audit/PRIVACY_AND_ANALYTICS_POLICY.md` | Modified | Corrections A, B, D, E: §2 data map, §2.1, §3 retention cell, §6 retention row, §7.1 item 4, §7.2 export section, §8 minors row, §9 item 4, §11 items 3, 5 and 7. Correction G: summary, §2 data map music row, §2 design-intent paragraph, §2.1 upload-scope paragraphs, §4 guest-mode bullet, §9 item 3, §11 settled summary. Correction G (continued): §1 table "Local content" row; §2 data map "PDF files" row. |
| `docs/audit/PRODUCT_MATURITY_AUDIT.md` | Modified | Corrections A, B, D: §3.10 music row; §10.1 rows OD-05, OD-08; new OD-18 register row. |
| `docs/audit/IMPLEMENTATION_BACKLOG.md` | Modified | Corrections A, C, D: critical-path note, FND-09 note, FND-10 acceptance, ACC-08 acceptance. Correction G: ACC-10 acceptance. |
| `docs/audit/MONETIZATION_STRATEGY.md` | Modified | Corrections A and F: §3 Plus table row and retention paragraph. |
| `docs/audit/ANDROID_MATURITY_PLAN.md` | Reviewed, unchanged | No inconsistency found in the corrected areas. |

**Files written during the 18 November 2026 pass:** `docs/audit/SYNC_AND_DATA_STRATEGY.md`, `docs/audit/PRIVACY_AND_ANALYTICS_POLICY.md`, `docs/audit/TARGET_ARCHITECTURE.md`, `docs/audit/IMPLEMENTATION_BACKLOG.md` and this report. No other file was modified by that task.

**Files written during the 19 November 2026 residual pass:** exactly three — `docs/audit/SYNC_AND_DATA_STRATEGY.md`, `docs/audit/PRIVACY_AND_ANALYTICS_POLICY.md` and this report. `TARGET_ARCHITECTURE.md` was **not** modified in this pass: it was read in full and searched specifically for statements implying that data excluded from Sync or migration cannot leave the device, and none required correction. `IMPLEMENTATION_BACKLOG.md`, `PRODUCT_MATURITY_AUDIT.md`, `MONETIZATION_STRATEGY.md` and `ANDROID_MATURITY_PLAN.md` were also read and searched only.

**Files outside the documentation scope:** none were modified by this pass. That statement covers the files written by this task only; it is not a claim about the state of the rest of the working copy, which was not inspected for unrelated changes.

No implementation task was added to the backlog. OD-18 is a decision register entry, not a work item.

---

## 6. Verification status

- **No tests were run.** `node --test` was not executed, and the 442-test figure quoted in the Phase 0 documents was not re-verified.
- **No build was run.** `node tools/build-www.mjs`, the APK build and any Android tooling were not executed.
- **No application was launched.** No browser, emulator or device check was performed.
- **No application behaviour was validated.** This pass changed Markdown only, and nothing in it demonstrates that any described behaviour exists.
- What was verified is limited to text: the seven documents were read, the edits were re-read in place, and targeted searches were run across the documentation directory for remaining references to `deletion window`, `14-day`, `would sync`, `EXCLUDED`, `music pack`, `OD-18` and focus-history statements. The searches returned no stale retention wording and no remaining statement that birthday data synchronises.
- Correction G was verified by text only: the four documents it modified and this report were re-read in place, and all seven documents were searched for `never leaves the device`, `nothing leaves the device`, `leaves the device`, `stays on the device`, `never transferred`, `outside all three`, `never exported`, `device-only` and `never sent`. That pass reported that every remaining occurrence had been inspected in context. **That claim was not accurate:** it missed the three statements now corrected in Correction G (continued), and it is withdrawn rather than restated. Passing a phrase-level search is not the same as checking every sentence that expresses the same idea in other words.
- Correction G (continued) was verified by text only, and the check was designed differently: all seven Phase 0 documents were searched for `never leaves`, `leaves the device`, `stays on the device`, `stay(s) on the device`, `remain on the device`, `device-only`, `never uploaded`, `never transferred`, `not migrated`, `not synchronized` and `not synchronised`, and **every** returned line was then read in its surrounding paragraph or table before being judged. The four statements corrected here were found that way, not by the first search. The outcome is recorded per hit: four passages were reworded (privacy §1, privacy §2 PDF row, sync §5.2 `highlights[]` and `notes[]`), one was restated to name the JSON backup (sync §7.4 annotations row), one was rewritten (sync §7.5), and the remainder were confirmed correct because each describes a specific mechanism — migration scope, tombstone or preference inactivity, absence from the account export, or an Android prohibition on uploading — rather than an inability to leave the device. `MONETIZATION_STRATEGY.md` §3's "stay on the device" is the single phrase left unreworded, because that file was outside this pass's scope.
- The six mechanism questions were re-checked against the corrected text, by reading the documents rather than by trusting the earlier pass: PDF files can be included in the existing PDF pack export; PDF annotations and book covers can be included in the existing JSON backup; those items stay excluded from Automatic Account Sync and can never appear in an Account Data Export; uploaded music stays excluded from Sync and from the account export; uploaded music is absent from the current manual export; and whether it must be included in a future manual export remains **OD-18**, unanswered. No pending decision was promoted to approved by these edits.
- `OD-18` was re-checked across the documents and remains unresolved; no document presents its proposed outcome as approved. No file outside `docs/audit/` and no file other than the five named in §5 was written by this pass.
- The source reference to `js/backup.js` line 39 was read to confirm the `EXCLUDED` membership quoted in the documents. That is a read-only check of an existing file, not a test.

---

## 7. Phase status

**Phase 1 remains blocked.** The corrected documents, this report and the pending decision list require owner review and explicit approval before any implementation begins.

Phase 1 work that is blocked by the decisions above, in addition to any owner approval of the documents themselves:

- FND-09 cannot start before OD-05.
- FND-10 can encode the current classification but cannot finalise the **P** tier before OD-06, and cannot classify reflections or the profile photo before OD-09 and OD-10.
- ACC-10 cannot finalise its privacy copy before OD-06, OD-08 and OD-09, and its music line cannot be finalised before OD-18.
- ACC-08 cannot finalise deletion and export copy before OD-11 and OD-18.

No Phase 1 work — authentication, Sync, payments, analytics, database, Android or any other product functionality — was started, and none should start until the owner has reviewed this pass.
