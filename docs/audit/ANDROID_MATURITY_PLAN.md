# Android Maturity Plan — Daftarche

**Status:** assessment only. The Android project was inspected, not modified.

---

## 1. Current Android implementation (verified)

| Item | Value | Evidence |
|---|---|---|
| Framework | Capacitor 8 (`@capacitor/core`, `@capacitor/android` `^8.5.3`) | `package.json` devDependencies |
| App id / package | `com.Amirreza.daftarche` | `capacitor.config.json`, `android/app/build.gradle` (`applicationId`, `namespace`) |
| App name | `دَفتَرچه` | `capacitor.config.json` |
| Web root | `www/` (generated) | `capacitor.config.json` `webDir` |
| minSdk | 26 | `android/variables.gradle` |
| compileSdk / targetSdk | 36 / 36 | `android/variables.gradle` |
| Version name / code | `3.5.0` / `20300` | `android/version-code.json`; derived from `js/version.js` build (`v203` × 100) in `tools/build-www.mjs` |
| Signing | `android/keystore.properties` + `android/daftarche-release.jks` present in the working copy; release signing enabled only if the properties file exists | `android/app/build.gradle` |
| Min WebView | 111 declared, plus a runtime capability check | `capacitor.config.json`; `js/native.js` `checkMinWebViewVersion` |
| Mixed content | Disallowed | `capacitor.config.json` |
| WebView debugging | Disabled | `capacitor.config.json` |
| Minification / ProGuard | `minifyEnabled false` | `android/app/build.gradle` |
| Built artifacts present | `dist/daftarche.apk` (7.3 MB), `dist/daftarche-debug.apk` | `dist/` |

### 1.1 Native code surface

The entire native layer is **one file**: `android/app/src/main/java/com/Amirreza/daftarche/MainActivity.java`. It extends `BridgeActivity` and does four things:

1. **Edge-to-edge insets** — measures system bars in dp and writes `--sat`, `--sab`, `--inset-top`, `--inset-bottom` onto the document root, because `env(safe-area-inset-*)` on Android reports only cutouts, not bars.
2. **WebView storage guarantees** — explicitly enables DOM storage, database and JavaScript, and sets `textZoom = 100`.
3. **Cache invalidation on upgrade** — compares `BuildConfig.VERSION_CODE` with a SharedPreferences value and calls `clearCache(true)` when the app was updated.
4. **Back handling** — an `OnBackPressedCallback` that evaluates a JS chain: close top dialog → close overlay/sheet → close reader → step back along the app's own `history.state.trail` → `web.canGoBack()` → system back.
5. Plus a `@JavascriptInterface` bridge (`AndroidBridge`) exposing `getTopInset`, `getBottomInset`, `setSystemBars`.

This is small, purposeful and well-commented — an asset, not a liability.

### 1.2 Offline and storage model

| Concern | Behaviour | Evidence |
|---|---|---|
| Offline shell | Bundled `www/` assets; the service worker is **deliberately unregistered** on native and `daftarche-*` caches are deleted | `js/pwa.js:14-25` |
| Web storage durability | DOM storage explicitly enabled | `MainActivity.java` |
| Android auto-backup | **Disabled** (`android:allowBackup="false"`) | `AndroidManifest.xml` |
| Persistent storage request | `navigator.storage.persist()` requested when the user adds a task or imports a book | `js/store.js` `requestPersistentStorage`, called from `js/tasks.js` / `js/library.js` |
| Data-loss warning | Storage errors surface as a user-visible message | `js/store.js` `STORAGE_ERROR_EVENT` → `js/storagewarn.js` |
| Export/share | Filesystem (chunked base64, 1 MB slices) + native share sheet | `js/native.js` `saveAndShareBlob` |

**Consequence of `allowBackup="false"`:** uninstalling the app, or moving to a new phone, loses everything unless the user exported a backup. This is the correct privacy choice and simultaneously a **release-readiness gap** unless the export path is made prominent (today: a periodic nudge, `js/backup-nudge.js`).

### 1.3 Permissions

| Permission | Declared | Purpose | Assessment |
|---|---|---|---|
| `INTERNET` | Yes | Version check, (dormant) push | Required |
| `VIBRATE` | Yes | Focus-session haptics | Low risk |
| `POST_NOTIFICATIONS` | Yes | Task reminders | Required on Android 13+; runtime prompt handled in `js/native.js` |
| `SCHEDULE_EXACT_ALARM` | **Explicitly removed** (`tools:node="remove"`) | — | **See §3.1** |

No storage, camera, location, contacts or background-service permissions are requested. That is a strong privacy position and should be preserved.

---

## 2. Native integration status

| Capability | Plugin | Used by | Status |
|---|---|---|---|
| App lifecycle / back | `@capacitor/app` | `js/native.js` `initNativeBackHandler` | Verified |
| Status bar / system bars | `@capacitor/status-bar` | `js/native.js` `syncSystemBars` | Verified |
| Local notifications | `@capacitor/local-notifications` | `js/native.js` `scheduleNativeTaskNotification`, `cancelNativeTaskNotification` | Verified (foreground scheduling only — see §3.1) |
| File write + share | `@capacitor/filesystem`, `@capacitor/share` | `js/native.js` `saveAndShareBlob` | Verified |
| Web Push | — | `js/push-service.js` gated off (`WEB_PUSH_ENABLED = false`) | Dormant |
| Billing / purchases | — | — | **Absent** |
| Crash reporting | — | — | **Absent** |
| Secure credential storage | — | — | **Absent** — an approved requirement for the account release (§3.11), not an existing capability |
| Deep links / app links | — | — | Absent (single `MAIN`/`LAUNCHER` intent filter only) |
| Keyboard handling | Web-side | `interactive-widget=resizes-content` referenced in `MainActivity.java` comments | Partial — see §3.2 |

---

## 3. Reliability gaps

### 3.1 Notification exactness (high)
`SCHEDULE_EXACT_ALARM` is removed from the manifest while task reminders are scheduled at an exact wall-clock time (`scheduleNativeTaskNotification` passes `schedule: { at: new Date(date) }`). On modern Android this generally yields inexact delivery or platform-dependent throttling. Either:
- accept inexact reminders and word the UI honestly ("around 16:00"), or
- use an exact-alarm path with the correct permission request and Play/Store policy justification.

This cannot be resolved from the source alone — it requires device testing.

### 3.2 Keyboard and layout
Edge-to-edge insets are handled carefully, but the keyboard is explicitly *not* treated as an inset; the page is expected to resize. Behaviour on small devices with RTL Persian input, and with the bottom navigation bar, is **unverified** — `docs/roadmap.md:28-31` already lists keyboard behaviour as untested on real devices.

### 3.3 No crash or error reporting
`js/app.js` wraps each section initialisation in `safe(name, fn)` and logs to `console.error`. On a shipped APK, that output is invisible. A release without any error visibility cannot be triaged. Regulatory and quality expectations also increasingly require basic crash telemetry (opt-in, content-free — see `PRIVACY_AND_ANALYTICS_POLICY.md`).

### 3.4 No instrumentation or device tests
- No `androidTest`/`test` source sets beyond the Gradle defaults.
- `tests/android.test.mjs` is a **static assertion suite** over project files (it asserts e.g. `android:allowBackup="false"` at line 102), not a device test.
- No emulator matrix, no smoke test that the APK boots the app shell.

### 3.5 Build process is manual and partly undocumented in one place
`scripts/sync-android.mjs` performs a seven-step sync (relative-path guard → build `www/` → version identity → write build-info → icon sync → `cap sync` → remove `sw.js` → run tests). `scripts/build-apk.mjs` builds the APK. This is good, but:
- there is **no CI**: nothing runs these steps automatically on change;
- `docs/android-publishing.md` still instructs the user to open Android Studio and use *Generate Signed Bundle / APK* manually, which bypasses `build-apk.mjs`;
- the release identity is duplicated between `js/version.js` and `android/version-code.json` (the latter is written by the sync script, but both exist as files and can drift if edited by hand).

### 3.6 Version control and key hygiene (blocking)
- The working copy is **not a Git repository** (`git status` fails). There is no reviewable history for Android changes. Adopting version control is an owner decision: it involves write operations that this work is not authorised to perform. The immediate substitute is a read-only baseline manifest plus a verified, restorable backup (FND-01 in the backlog).
- `android/keystore.properties` and `android/daftarche-release.jks` are physically present. Whether they were ever committed cannot be determined here. If they were, the release key must be rotated and the app republished under a new signing identity, or the store listing must be migrated per store policy.

### 3.7 Storage reliability under pressure
`allowBackup="false"` plus app-private WebView storage is reasonable, but there is no verified behaviour for: OS-initiated storage reclamation, WebView data clearing by the system, or a WebView upgrade that resets DOM storage. `requestPersistentStorage` is best-effort and is not available inside all WebView versions.

### 3.8 Timer behaviour when backgrounded
The focus timer is persisted across reloads (`daftarche-focus-session`) and the reader pauses its clock when the tab is hidden. There is no foreground service, so a locked screen is not guaranteed to keep audio playing or to fire an exact completion cue. Behaviour on real devices is **unverified**.

### 3.9 Network-failure behaviour
The app is offline-first, so most failures are invisible. Two exceptions should be audited before a networked release: the version check in `js/settings.js:273` and (once enabled) any sync call. Neither currently has a user-visible degraded state, because no user-facing network feature exists yet.

### 3.10 Battery and performance
Heavy assets: `css/base.css` 101 KB, `js/` 27,917 lines, character art, and backdrop-filter-based glass themes. `docs/roadmap.md:28-31` flags glass-theme performance on weak phones and world-background animation smoothness as untested on real hardware. On a mid-range Android device this is the most likely source of "the app feels slow" reports.

### 3.11 Security requirements for the account release [APPROVED — not implemented, not verified]

The product owner has approved the protection model below. **Nothing in this table exists today**: there is no account, no session, no token and no backend storage. It is recorded here as a release requirement with the test that would prove it, so that "we encrypt it" is never claimed before it is measured.

Synchronisation is part of every registered account and is never billed (`MONETIZATION_STRATEGY.md` §2.1). Nothing in this section depends on a payment channel: the Android account/sync release must ship without one.

| Requirement | Concrete obligation on the Android build | How it is proven |
|---|---|---|
| Encryption in transit | Only `https://` to the API origin; cleartext already disabled in `capacitor.config.json` and must stay disabled; no mixed content in the WebView; certificate validation never bypassed | Build/network inspection: every request is HTTPS; a deliberately plaintext call fails rather than falling back |
| Encryption at rest (server) | Database, backups and object storage encrypted by the platform mechanism | Provider/bucket configuration review plus a restore test |
| Key management | Keys in a secret manager, separated from data and from the source tree; rotation documented | Configuration review; no key material in the repository or in `www/` |
| Token protection on the device | Tokens kept in a platform-protected store if a Capacitor 8-compatible plugin is available, otherwise in memory with re-authentication; never in a URL, a log or an analytics payload | Inspection of the storage location and of the log output during sign-in and sync |
| No secrets or credentials in logs | Session tokens, passwords, receipt payloads and secrets never printed; the existing `console.warn`/`console.error` calls must be reviewed before any network code lands | A test that drives sign-in and sync with logging captured and asserts no token appears |
| Account-level authorization | The server derives `userId` from the session, never from a client parameter; one account cannot read another's records | Two-account test on device: account B cannot pull, overwrite or delete account A's records |
| Scope enforcement on the device | The app never attempts to queue or upload a PDF file, PDF annotation, cover image or music track | Network/log inspection during a full sync with a library containing PDFs |
| Honest wording | No screen or store listing says "end-to-end encrypted" or "only you can read this" | Copy review |

The model is **standard encryption, not E2EE**. The operator can technically read synced records, and the Android UI must not imply otherwise.

---

## 4. Testing requirements before a store release

| Test | Why | Minimum evidence |
|---|---|---|
| APK boots to Today on a clean install, offline (airplane mode) | The core promise | Screenshot/log from one physical device |
| Upgrade over a previous version keeps tasks and books | Cache clearing on `VERSION_CODE` change touches the WebView cache | Data present after upgrade |
| Add task → kill app → reopen | Persistence guarantee | Task present |
| Export backup → factory-clean install → import | The only recovery path | Round trip verified |
| PDF import, open, highlight, reopen | PDF.js is loaded at runtime from bundled assets | Book opens offline |
| Focus timer across screen lock and app background | No foreground service exists | Documented behaviour, not a guess |
| Notification arrives at the requested minute (or the UI is reworded) | §3.1 | Device log with alarm timing |
| Back gesture unwinds: dialog → sheet → reader → page → background | Implemented in two places (Java and JS) that must agree | Manual pass |
| RTL Persian input with keyboard open on a small screen | Untested per `docs/roadmap.md` | Manual pass at 360×640 |
| Storage pressure: fill device, confirm the storage-error message appears and nothing is silently lost | `safeSet` returns false and emits an event | Manual pass |
| Two devices, same account (after sync ships) | Conflict behaviour | Later phase |
| Second device signs in while holding its own local data | Explicit choice presented, nothing silently overwritten | Later phase |
| Two accounts on the same device, then account B signs in | Account B sees none of A's records; A's server data is untouched | Later phase — blocking for the account release |
| Airplane mode while signed in: create, edit, delete tasks; then reconnect | Queue flushes in order, no duplicate, no loss; local use never blocked | Later phase |
| Session expired while offline | App stays fully usable, sync pauses with a soft explanation, no forced sign-out | Later phase |
| Full sync of a library containing PDFs, with network capture running | No PDF bytes, no annotation payload, no cover image, no music in any request | Later phase — proves the approved scope, not just states it |
| Sign-in and sync with logging captured | No token, password, receipt or secret appears in log output or analytics | Later phase |
| Plaintext HTTP attempt to the API origin | Rejected; the app does not fall back to cleartext | Later phase |
| Signed in on a second device without the PDF | Book shows metadata and progress, and is clearly marked unavailable for reading until the file is imported | Later phase |

Browser-side: `npm run test:browser` exists (`tests/browser/regress.mjs`) but needs Playwright, which is **not** a project dependency and was **not run** in this audit.

---

## 5. Release-readiness checklist

**Must be true (blocking)**
- [ ] A read-only baseline manifest of the working copy exists and an independent backup has been restored and hash-compared at least once. (Version control remains an owner decision; this plan performs no Git write operation.)
- [ ] Signing material is confirmed out of version control; rotate if exposure is suspected.
- [ ] One physical mid-range Android device passes the smoke matrix in §4.
- [ ] Notification exactness resolved one way or the other (§3.1) and the UI worded to match.
- [ ] Backup/export prominence reviewed, given `allowBackup="false"`.
- [ ] Privacy statement in the store listing matches what the app actually does (`docs/android-publishing.md:72-95` currently overstates isolation and will need rewriting before any account work ships).
- [ ] For an account release only: transport, at-rest, key-management, token and authorization requirements in §3.11 implemented and proven by the tests in §4. None of them exists today.

**Should be true (before public release)**
- [ ] Crash/error visibility with opt-in consent and no user content.
- [ ] A repeatable build-and-test gate that runs `node --test` and a build on every change (hosted CI once a version-control decision is made).
- [ ] A documented release procedure that uses `scripts/build-apk.mjs` rather than manual Android Studio steps.
- [ ] `version-code.json` and `js/version.js` proven to stay in step (a test already exists for release identity — extend it to the Android ledger).
- [ ] Glass-theme and world-animation performance measured on real hardware; a reduced-motion / reduced-transparency fallback verified.

**Nice to have**
- [ ] Instrumentation smoke test for app boot.
- [ ] Deep-link support for opening a specific page (useful for reminders and, later, purchase returns).
- [ ] Store-specific billing integration (see `MONETIZATION_STRATEGY.md`).

---

## 6. Prioritized Android improvements

| Priority | Improvement | Rationale |
|---|---|---|
| **P0** | Read-only baseline manifest plus a verified, restorable backup; verify key hygiene | There is no review or rollback today, and a single lost disk would take the only copy |
| **P0** (account release) | Transport/at-rest/key/token/authorization controls in §3.11, with the two-account isolation test | Approved requirements; storing user records without them is not acceptable |
| **P0** | Resolve notification exactness and align the copy | A reminder that arrives late is a broken promise in a planning app |
| **P1** | Device smoke matrix on one real phone, recorded in `docs/` | The single cheapest way to convert "unverified" into "known" |
| **P1** | Automated gate: tests + `www` build + APK build on every change (CI when version control exists) | Prevents silent release drift |
| **P1** | Make the backup path prominent on Android specifically (first-run + periodic) | `allowBackup="false"` makes export the only safety net |
| **P2** | Opt-in, content-free crash visibility | Needed to operate a released app |
| **P2** | Foreground/lock-screen behaviour for the focus timer, decided and documented | Users expect a timer to survive a locked screen |
| **P2** | Performance pass on glass themes and world animations on low-end hardware | Most likely source of negative reviews |
| **P3** | Deep links, startup instrumentation test, minification hardening | Polish once the foundation is stable |

---

## 7. What this audit did **not** establish

- Whether the APK builds successfully today (no build was run; the brief forbids installing dependencies, and `npx cap`/Gradle may require network and an Android SDK).
- Whether the existing signed APKs in `dist/` correspond to the current source.
- Any runtime behaviour on a device, an emulator or a browser — no application was launched.
- Whether the signing key has ever been committed anywhere (no Git metadata exists in the working copy).
- Any security property in §3.11. No TLS configuration, at-rest encryption, key management, token storage or authorization check was inspected, because none exists yet.
