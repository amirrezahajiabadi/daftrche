# Phase 1 — Backup Compatibility

**Phase:** 1 — Architecture & Data Foundation
**Stage:** 1.3
**Document status:** analysis plus proposed compatibility rules. Nothing is implemented.
**Date:** 19 November 2026

The manual local backup is the only recovery path a guest has today. Every change in this phase must leave it working, both ways: a new build must read every file an old build produced, and an old build must not be corrupted by a file a new build produced.

**APPROVED DECISION.** Manual local backup/export, automatic account Sync and account data export are three separate mechanisms with three separate scopes (`SYNC_AND_DATA_STRATEGY.md` §7.6). Nothing in this document widens Sync; nothing here narrows the backup.

---

## 1. The format as it exists

```
{
  "app": "daftarche",
  "format": 1,
  "release": "3.5.0",
  "exportedAt": "2026-11-19T…Z",
  "data": {
    "daftarche-v1": "<JSON string>",
    "daftarche-books-meta": "<JSON string>",
    "theme": "<string>",
    …
  }
}
```

| Property | Value | Evidence |
|---|---|---|
| `BACKUP_APP` | `'daftarche'` | `js/backup.js` |
| `BACKUP_FORMAT` | `1` | same |
| Key eligibility | `theme` or any key starting with `daftarche-`, except `daftarche-seen-version` and `daftarche-birthday-seen` | `isBackupKey`, `EXCLUDED` |
| Value type | **String only.** Every value is the raw stored string | `parseBackup` rejects non-strings |
| Shape checks | Eight keys, `array` or `object` | `SHAPES` |
| Size cap | 5 MB of text | `BACKUP_MAX_CHARS` |
| Newer file | Refused with a readable reason | `format > BACKUP_FORMAT` |
| Restore semantics | Replace: remove eligible keys, write the file's keys, roll back on failure | `applyBackup` |
| Merge semantics | Per-key; unknown keys keep the local value (`local ?? v`) | `mergeBackup`, `MERGERS` |

---

## 2. Compatibility hazards introduced by this phase

### H-1 — New `daftarche-*` keys travel automatically

**CURRENT STATE.** `isBackupKey` accepts any key with the `daftarche-` prefix. A new support key (`daftarche-schema`, `daftarche-installation`, `daftarche-migration-journal`, `daftarche-migration-snapshot`, `daftarche-sync-meta`) would therefore be **collected into every future backup** without anyone deciding that it should be.

**Consequence if unaddressed:**

| Key | Effect in a backup |
|---|---|
| `daftarche-schema` | Restored into an older build, claiming versions it cannot honour |
| `daftarche-installation` | The installation id travels to another device, so two devices share one idempotency identity — a sync correctness bug |
| `daftarche-migration-journal` / `-snapshot` | Could make a fresh device believe a migration was interrupted |
| `daftarche-sync-meta` | Would carry a cursor to a device that has never synced |

**Required rule.** Every support key is added to `EXCLUDED` **in the same change that introduces it**. The exclusion list becomes a registry of "device facts", not a two-item special case.

### H-2 — Unknown keys keep the local value on merge

**CURRENT STATE.** `mergeBackup` applies `MERGERS[k]` when one exists, else `local ?? v`. A structured key added later has no merger, so merging a file silently ignores the file's value.

**Consequence.** If a future structured record is not given a merger, "merge my backup" will appear to succeed while discarding the incoming half. Silent data loss on a path the user believes is additive.

**Required rule.** A test enumerates backup-eligible keys and fails when a key classified as a record has no entry in `MERGERS`. Preferences and scalars are explicitly exempt by being listed.

### H-3 — Restore removes keys the file does not contain

**CURRENT STATE.** `applyBackup` removes **every** backup-eligible key before writing the file's. A file made by an older build therefore deletes data added by a newer one.

**Consequence after this phase.** Restoring an old backup would delete envelope fields (they live inside the values, so they are replaced wholesale — acceptable) but also any *new key* the newer build created and that is backup-eligible.

**Required rule.** The new support keys are excluded (H-1), so they survive. Every other eligible key is a user record or preference whose replacement is the point of "replace". The rule is therefore satisfied **only if** H-1 is implemented first.

### H-4 — The registry must be invalidated by a restore

**PROPOSED DESIGN.** After any restore or merge, the schema registry describes the *pre-restore* data. Two of the five failure cases in `DATA_SCHEMA_REGISTRY.md` §5 collide here.

**Required rule.** `applyBackup` and `mergeBackup` invalidate the registry (delete `daftarche-schema`) after a successful write, and the migration runner rebuilds it on the next boot. Deleting a derived key is safe; trusting a stale one is not.

### H-5 — Envelope fields inside stored values

The new fields (`updatedAt`, `rev`, `deletedAt`, `originDevice`, `fieldClock`, `order`) live **inside** the JSON string of `daftarche-v1` and `daftarche-books-meta`. Therefore:

- an **old build** reading a new file gets records with unknown extra fields. `normalizeTask` spreads the stored object, so the fields survive a round trip; the old build ignores them. That is the desired behaviour and it already holds.
- a **new build** reading an old file gets records without envelope fields. The migration runner must be invoked after the restore, or the reader must tolerate their absence. Both are required: tolerance on read, migration on write.

### H-6 — `format` must not be bumped casually

`parseBackup` refuses a newer format outright. Bumping to `2` would make every new file unreadable by every shipped build.

**Rule.** `format` stays `1` for any change that is additive and tolerated by both directions. It is bumped only when an old build would misread a new file, and only together with a documented migration path for files already in users' hands.

---

## 3. Compatibility matrix for the proposed changes

| Change | Old build reads new file | New build reads old file | Format bump? |
|---|---|---|---|
| Envelope fields inside records | Tolerated (unknown fields preserved) | Tolerated (fields absent; migrated on restore) | **No** |
| `order` field on tasks | Tolerated | Missing → derive from array index | **No** |
| `fieldClock` on tasks | Tolerated | Missing → seed from `created` | **No** |
| New support keys | **Must be excluded** (H-1) | Absent → defaults | **No** |
| Registry invalidation on restore | n/a | Required (H-4) | **No** |
| Book `fileState` | Not stored; a read model | n/a | **No** |
| A future change that renames a key | Old build would ignore the new key and keep using the old one | New build would need to read both | **Yes**, with a dual-read step first |
| Music in the backup (if OD-18 approves) | Old build would ignore an unknown key — but a music payload cannot fit in 5 MB | Would need a new container | **Yes** |

**Current recommendation.** Keep `format: 1` through Phase 1. Record in the release note that envelope fields are additive.

---

## 4. PDF pack and music

| Asset | Mechanism | Compatibility |
|---|---|---|
| PDF files | Separate zip (`js/pdfpack.js`), stored method only, `{bookId}.pdf` entries | Unchanged by this phase. A restored file attaches only to a book the metadata list already knows, and only when that book has no file |
| Book cover | Inside the metadata record as a data URL | Travels with the backup (local path), never with Sync |
| Highlights and notes | Inside the metadata record | Travel with the backup; **never** with Sync |
| Uploaded music | No export | **OD-18** open; not promised, not declared impossible |

**OPEN QUESTION PQ-04.** The PDF pack requires the JSON restore to happen first, because a file is only accepted for a known book. A user restoring only the pack gets `unknown` for every entry. The pack's own copy should say "restore the backup first"; whether the app should offer a combined restore is a product question, not a compatibility one.

---

## 5. Proposed exclusions list

```
DEVICE_FACTS (never in a backup):
  daftarche-seen-version          // which release notes this device has shown
  daftarche-birthday-seen         // greeting already shown here
  daftarche-schema                // local storage shapes
  daftarche-installation          // identity of this installation
  daftarche-migration-journal     // local progress of a local migration
  daftarche-migration-snapshot    // local rollback copy
  daftarche-sync-meta             // local cursor and suspension flag
  daftarche-recovery-quarantine   // raw malformed values, device-specific
```

Everything else keeps travelling. In particular the backup must keep carrying PDF annotations and book covers: that is the user's file, and it is the reason the annotations are not lost when they change devices.

**RISK.** A future maintainer sees `EXCLUDED` as a short list and adds "just one more" backup-eligible support key. The mitigation is a test: every key classified **D** in the classification module and marked `deviceFact: true` must be in the exclusion list.

---

## 6. Compatibility tests (specified, not executed)

| # | Test | Asserts |
|---|---|---|
| BC-1 | Collect → parse → apply round trip | Every eligible key survives byte-identically |
| BC-2 | Old file (no envelope) restored into new logic | Migration runs; counts match; content identical |
| BC-3 | New file restored by old logic (envelope present) | Extra fields tolerated; no crash; content identical |
| BC-4 | Support keys present | Absent from `collectBackup` output |
| BC-5 | Merge with an unknown structured key | Fails the completeness test rather than silently ignoring it |
| BC-6 | Restore then read registry | Registry rebuilt; no stale version |
| BC-7 | Rollback on quota failure | Every key byte-identical to before |
| BC-8 | `format: 2` file | Refused with a readable reason |
| BC-9 | 5 MB + 1 file | Refused before parsing |
| BC-10 | Backup of a store with a quarantined record | Quarantine absent; the valid records present |

---

## 7. What this document does not change

- It does not alter `collectBackup`, `parseBackup`, `applyBackup` or `mergeBackup` behaviour.
- It does not add music to the export.
- It does not remove annotations or covers from the backup.
- It does not use the backup as an account export.
- It does not bump the format.
