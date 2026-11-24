# Phase 1 — Data Inventory

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.1
**Document status:** inventory of the current working copy plus the proposed future classification. Nothing here is implemented.
**Date of inspection:** 19 November 2026

Every row is read from the source named in its evidence column. Where the writer or reader of a key could not be located in this pass, the row says so rather than guessing.

Classification codes are the canonical ones from `SYNC_AND_DATA_STRATEGY.md` §5.2 and are reproduced here **only as a summary**; that table remains the single source of truth:

| Code | Meaning |
|---|---|
| **S** | Approved for account Sync; also included in the guest→account migration snapshot |
| **D** | Device-local; never synchronised, never migrated |
| **P** | Preference; optional sync pending **OD-06** — inactive until decided |
| **X** | Excluded binary; never enters Sync, migration or the outbox |
| **?** | Pending owner decision; inactive until decided |

**APPROVED DECISION.** The classification column of this inventory restates decisions already recorded. It introduces no new classification and decides no pending question.

---

## 1. Identity of the inventory

| Item | Value |
|---|---|
| Application release inspected | `DAFTARCHE_RELEASE = '3.5.0'`, `DAFTARCHE_BUILD = 'v203'` (`js/version.js`) |
| localStorage keys in use | 43 distinct keys plus 6 legacy keys |
| IndexedDB databases | 2 (`daftarche-books` v1, `daftarche-audio` v1) |
| Cache Storage buckets | 2, build-keyed (replaceable, not records) |
| Backup container | `{app, format: 1, release, exportedAt, data{key: string}}` |
| Record types with an identifier | tasks, books, focus-history sessions, highlights, notes, audio tracks |
| Record types without an identifier | mood per day, day-open history (day key is the identity), ledger day bucket, preferences |

---

## 2. localStorage — activity records

| Key | Owner module | Shape (CURRENT STATE) | Identifier | Timestamps | Writers | Readers | Backup | Sync |
|---|---|---|---|---|---|---|---|---|
| `daftarche-v1` | `js/tasks.js` via `saveTasks` | Array of task records (§3.1) | `id` | `created`, `doneAt` | `tasks.js` `save()`, `notifications.js` through `bindPersistence`, `settings.js` `hydrateStateAfterRestore` (reload), `backup.js` apply/merge, `store.js` `migrateStorage` | `state.js` at boot, `daycache.js`, `ledger.js`, `stats.js`, `backup.js`, `settings.js` | Included | **S** |
| `daftarche-history` | `js/week.js` | Array of `YYYY-MM-DD` | day key | — | `week.js` `recordDay` | `state.history`, `daycache.js`, `backup.js` | Included | **S** |
| `daftarche-moods` | `js/week.js` | Object `{ 'YYYY-MM-DD': 1..5 }` | day key | — | `week.js` mood picker | `state.moods`, `daycache.js`, `stats.js`, `backup.js` | Included | **S** |
| `daftarche-ledger` | `js/ledger.js` | `{ v: 1, seededAt, days: { 'YYYY-MM-DD': {done, focusMin, sessions} } }` | day key | `seededAt` | `ledger.js` `writeLedger` (via `bumpDay`) | `ledger.js` `readLedger`, `daycache.js` `getLedgerDays` | Included, merged by floor | **S** |
| `daftarche-achievements` | `js/achievementsview.js` | `{ v: 1, baselineAt, unlocked{ id: {tier, at} }, recSeen{ key: day } }` | achievement id | `baselineAt`, `at` | `achievementsview.js` `saveAchv` | `achievementsview.js`, `achievements.js`, `theme.js` (reward gate) | Included, merged by tier | **S** |
| `daftarche-focus-history` | `js/focushistory.js` | Array of session records (§3.2), **capped at 100** | `id` | `startedAt`, `endedAt` | `focushistory.js` `addSessionToHistory` | `ledger.js`, `daycache.js`, `stats.js`, `insights.js`, `backup.js` | Included, union by id then re-capped | **?** (OD-05) |
| `daftarche-focus-session` | `js/focus.js` | Live/paused/cancelled session object or `''` | `id` | `startedAt`, `endedAt`, `runStartedAt` | `focus.js` `persist()` (`saveSession`) | `focus.js` `initFocusPage` (`loadSession`) | Included | **D** |
| `daftarche-birthday` | `js/birthday.js` through store | `'MM-DD'` (Jalali month-day, no year) | — | — | `store.js` `saveBirthday` | `birthday.js`, `theme.js` | Included | **?** (OD-08) |
| `daftarche-birthday-candle` | `js/birthday.js` | Stamp of the day the candle was blown | — | encoded in value | `store.js` `saveBirthdayCandle` | `birthday.js` | Included | **?** (OD-08) |
| `daftarche-birthday-wishes` | `js/birthday.js` | Object of annual wish capsules (user-written text) | year key | — | `store.js` `saveBirthdayWishes` | `birthday.js` | Included, merged by key | **?** (OD-08) |
| `daftarche-books-meta` | `js/library.js` | Array of book records (§3.3) | `id` | `addedAt`, `lastReadAt`, per-day `stats` keys | `library.js` `saveMeta()`, `updateBook`, import, soft delete | `library.js` `getBooks`, `daycache.js`, `ledger.js`, `stats.js`, `today.js`, `backup.js` | Included, merged per field | **S** for the nine allowlisted fields only |

## 3. localStorage — preferences, identity and device facts

| Key | Shape | Purpose | Writer | Sync |
|---|---|---|---|---|
| `theme` (**no `daftarche-` prefix**) | theme key string | Current theme | `theme.js` `saveTheme` | **P** |
| `daftarche-theme-modes` | `{light, dark}` | Last theme used per half | store `saveThemeModes` | **P** |
| `daftarche-theme-auto` | `'true'` / `'false'` | Follow system appearance | store `saveThemeAuto` | **P** |
| `daftarche-text-size` | size id | Text size | `textsize.js` | **P** |
| `daftarche-motion` | `'reduced'` | Reduced motion | `motion.js` | **P** |
| `daftarche-stats-range` | range key | Stats window | `stats.js:426` | **P** |
| `daftarche-card-style` | JSON pair | Share-card template | store `saveCardStyle` (calling UI not traced in this pass) | **P** |
| `daftarche-goal` | `'tasks' \| 'books' \| 'focus'` | Onboarding answer | store `saveGoal` | **P** |
| `daftarche-lang` | `'fa' \| 'en'` | Language | store `saveLang` | **P** |
| `daftarche-name` | string | Display name | `app.js:738`, onboarding | **P** |
| `daftarche-avatar` | `{type:'char', id}` | Chosen companion | `profile.js` | **P** |
| `daftarche-photo` | JPEG data URL (≤256 px square) | Profile photo | `profile.js` | **?** (OD-10) |
| `daftarche-pomo` | minutes as string | Focus length | `focus.js:626` | **P** |
| `daftarche-week-goal` | integer as string | Weekly goal | `worlds.js:626` | **P** |
| `daftarche-streak-freeze` | `'on'` / `'off'` | Freeze availability | store `saveFreeze` (calling UI not traced in this pass) | **P** |
| `daftarche-scene` | scene key | Focus ambience | `focus.js:289` | **D** |
| `daftarche-ambsound` | `'1'` / `'0'` | Ambience on/off | `focus.js:296` | **D** |
| `daftarche-music` | `'none'` / `'user:<id>'` / genre | Music selection | `focus.js:255` | **D** |
| `daftarche-vol-music` | number as string | Volume | `audio.js:43` (debounced) | **D** |
| `daftarche-vol-amb` | number as string | Volume | `audio.js:48` (debounced) | **D** |
| `daftarche-pen-width` | width key | Reader pen width | `reader.js:341` | **D** |
| `daftarche-birthday-seen` | Jalali stamp | Greeting shown today | store `saveBirthdaySeen` | **D** (excluded from backup) |
| `daftarche-birthday-theme-off` | Jalali stamp | Birthday theme dismissed | store `saveBirthdayThemeOff` | **?** (OD-08) |
| `daftarche-tour-complete` | `'yes'` | Tour finished | store `saveTourDone` | **D** |
| `daftarche-tour-awarded` | `'yes'` | Tour reward granted | store `saveTourAwarded` | **D** |
| `daftarche-first-seen` | day key | First run, used by backup nudge | `backup-nudge.js:31` | **D** |
| `daftarche-firstseen` | day key | "Member since" on the profile | `profile.js:260-261` | **D** |
| `daftarche-seen-version` | release string | Release notes shown | `changelog.js:468` | **D** (excluded from backup) |
| `daftarche-ios-guide-dismissed` | `'1'` | iOS install guide | `app.js:854` | **D** |
| `daftarche-frog-dismissed` | flag | Daily-frog dismissal | declared in `STORAGE_KEYS`; writer not traced in this pass | **D** |
| `daftarche-backup-at` | epoch ms | Last manual backup | `backup-nudge.js` `markBackupDone` | **D** |
| `daftarche-backup-nudge` | epoch ms | Last nudge shown | `backup-nudge.js` | **D** |

**CURRENT STATE — duplicate device fact.** `daftarche-first-seen` and `daftarche-firstseen` are different keys written by different modules for two similar purposes. Both are device-local and neither should be consolidated without an owner-visible note, because consolidation would change what the profile shows.

## 4. localStorage — legacy keys

| Key | Handling |
|---|---|
| `daftarche-state`, `daftarche_state`, `daftarche_app_state`, `daftarche-all`, `daftarche-store` | Monolithic pre-shard blobs. `store.js` `migrateStorage()` merges `tasks`, `history`, `moods`, `focusHistory`, `books`, `userName`, `theme`, `ledger`, `achievements` into the sharded keys, then removes the legacy key. `backup.js` `normalizeBackupData()` performs the same merge for a backup file |
| `daftarche-tasks` | Unversioned task array; merged into `daftarche-v1` by id, then removed |

None of these keys is synchronised. Their merge is idempotent by construction (existing ids win, unknown ids are appended).

## 5. IndexedDB

| Database | Version | Store | Key path | Record | Approximate size driver | Sync |
|---|---|---|---|---|---|---|
| `daftarche-books` | 1 | `books` | `id` | `{ id, blob }` | The PDF itself; can be hundreds of MB | **X** |
| `daftarche-audio` | 1 | `tracks` | `id` | `{ id, name, blob }` | Uploaded music | **X** |

Both are outside Sync, outside migration and outside the JSON backup. The PDF pack moves book files; music has no export today (OD-18).

## 6. Cache Storage and generated trees

| Store | Nature | Consequence for this phase |
|---|---|---|
| `daftarche-static-${BUILD}` / `daftarche-runtime-${BUILD}` (`sw.js`) | Cached copies of the shell and runtime assets, keyed by build | Replaced wholesale on a build change; never a record |
| `www/` | Generated Capacitor web root (`tools/build-www.mjs`) | Contains a copy of every module; a repository-wide search must exclude it |
| `android/app/src/main/assets/public/` | Generated copy inside the Android project | Same, plus build outputs |

## 7. Record shapes (CURRENT STATE)

### 7.1 Task — `js/state.js` `normalizeTask`

```
id            string   `Date.now()-random` (`utils.js:64`)
text          string
done          boolean
p             'low' | 'mid' | 'high'
cat           one of six category keys (default 'misc' at render time)
dueDate       'YYYY-MM-DD' | null      (legacy field `due` migrated on read)
durationMin   1..480 | null
timeFrom      minutes past midnight | null   (paired with timeTo)
timeTo        minutes past midnight | null
created       epoch ms
doneAt        epoch ms | null
notify        boolean
notifiedStatus 'none' | 'soon' | 'overdue'
```

No `updatedAt`, no `rev`, no `deletedAt`, no owner or workspace field. Unknown fields survive normalisation because it spreads the stored object.

### 7.2 Focus session — `js/focushistory.js` `normalizeHistoryRecord`

```
id, taskId | null, taskTitle | null (snapshot), startedAt, endedAt,
plannedDurationMin | null, actualDurationMin (≥1 integer),
taskCompleted (boolean), rating ('good' | 'okay' | 'hard')
```

Invalid records are dropped, not repaired. The live session in `daftarche-focus-session` has additional fields (`activeMs`, `runStartedAt`, `status`) and is discarded by `normalizeHistoryRecord`.

### 7.3 Book — `js/library.js` import path, extended by `js/reader.js`

```
id              string
title           string
addedAt         epoch ms
numPages        integer, 0 until the document has been rendered
lastPage        integer (current page)
lastReadAt      epoch ms
completedPages  number[]  (pages marked read; treated as a Set)
stats           { 'YYYY-MM-DD': { pages: number, minutes: number } }
goal            { type, text, pagesPerDay } | null
highlights      array of highlight records (§7.4)
notes           array of note records (§7.5)
cover           data URL string, or ''
viewer          'internal' | 'browser' (engine last used)
fallback        boolean
```

### 7.4 Highlight — `js/reader.js` `highlightFromSelection`, `penEnd`

```
id, page, text, color, rects[] (text selection), kind ('draw'|'highlight'),
free (boolean, drawn stroke), pts[] (drawn stroke points), width, scale,
note (string, attached note), createdAt
```

### 7.5 Note — `js/reader.js` `saveNote`

```
id, page, text, createdAt
```

### 7.6 Mood, day-open history, ledger day

```
moods:        { 'YYYY-MM-DD': 1..5 }
history:      ['YYYY-MM-DD', ...]
ledger.days:  { 'YYYY-MM-DD': { done, focusMin, sessions } }   // monotonic floors
```

## 8. Per-entity data-loss risks (CURRENT STATE)

| Entity | Risk | Mechanism |
|---|---|---|
| Tasks | Whole-array rewrite lost when storage is full | `safeSet` reports the failure, but the in-memory list keeps the change, so a reload loses it |
| Tasks | Cross-tab clobbering | No `storage` listener; last writer wins |
| Tasks | Undo window is memory-only | `showUndo` keeps the task in a queue; a reload inside the 5 s loses it |
| Focus history | Silent trim at 100 | `mergeHistory` slices |
| Focus history | Corrupt record dropped | `normalizeHistoryRecord` |
| Books | Metadata deleted while file remains, or file deleted while metadata remains | Two stores, two delete paths; `settlePendingDelete` deletes the blob after 5 s |
| Books | Restore of a JSON backup leaves orphan PDFs in IndexedDB | Restore replaces metadata; the file store is untouched by design |
| Music | No export path | Neither JSON backup nor PDF pack carries it |
| Achievements | Baseline day is written once | A restored backup without `baselineAt` re-baselines to today |
| Preferences | Restore replaces every `daftarche-*` key | `applyBackup` removes keys the file does not contain |

## 9. Proposed additions to the inventory (PROPOSED DESIGN)

These keys do not exist. They are listed so that the classification module can require a status for every key, including future ones.

| Proposed key | Purpose | Status |
|---|---|---|
| `daftarche-schema` | Store-level schema version envelope (see `DATA_SCHEMA_REGISTRY.md`) | **D** — a device fact about this install; excluded from backup and Sync |
| `daftarche-installation` | Random installation id (FND-08) | **D** |
| `daftarche-migration-journal` | Migration progress and rollback snapshot pointer | **D** |
| `daftarche-migration-snapshot` | Single-slot pre-migration copy of affected keys | **D** |
| `daftarche-sync-meta` | Local cursor, device sequence, suspension flag | **D** |
| IndexedDB `daftarche-sync` v1 | `outbox`, `meta`, `conflicts` stores | **D** |

**RISK.** A new `daftarche-*` key is automatically backup-eligible (`isBackupKey`), and `mergeBackup` gives an unknown key the rule "local wins". A structured support key added without an explicit decision would therefore travel inside users' JSON backups and then be ignored on merge. `BACKUP_COMPATIBILITY.md` §5 resolves this by adding every new support key to the backup exclusion list.

## 10. Inventory completeness rule (PROPOSED DESIGN)

A test (specified in `PHASE_1_VALIDATION_PLAN.md`) will import `STORAGE_KEYS` plus a literal list of the non-constant keys found above and fail when a key used by the application is not present in the classification module. The reverse direction is also asserted: every classified key must appear in this inventory. That pair of assertions is what keeps this document from drifting.
