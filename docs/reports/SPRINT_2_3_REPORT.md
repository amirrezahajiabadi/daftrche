# گزارش فنی اسپرینت ۲.۳: احراز هویت سمت کلاینت، موتور همگام‌سازی دوطرفه (Push/Pull) و رابط کاربری مهمان-محور

**نسخه:** `v3.5.0` | **شماره ساخت:** `v212`  
**تاریخ:** ۲۵ نوامبر ۲۰۲۶ (۴ آذر ۱۴۰۵)  
**وضعیت:** موفق (Pass: 516/516 Tests)

---

## ۱. خلاصه تغییرات و ارتقای ساخت (Summary of Changes)

در اسپرینت ۲.۳، چرخه همگام‌سازی دوطرفه سمت کلاینت با رعایت کامل اصول **Local-First** و **Guest-First** پیاده‌سازی و به بک‌اند Express + SQLite متصل شد. شناسه ساخت اپلیکیشن در `js/version.js` از `v211` به **`v212`** ارتقا یافت و ماژول‌های جدید در لیست کش آفلاین `SHELL` در `sw.js` ثبت شدند.

| فایل | نوع تغییر | شرح تغییرات |
| :--- | :---: | :--- |
| `js/auth-client.js` | **جدید** | مدیریت نشست OTP (`requestOtp`, `verifyOtp`, `fetchMe`, `logout`, `getAuthState`) و ذخیره کرسر همگام‌سازی |
| `js/sync-client.js` | **جدید** | هماهنگ‌کننده دوطرفه `pushPendingChanges`, `pullRemoteChanges`, `syncNow`، قفل تک‌اجرا، ادغام بدون لوپ و تریگرهای `online` / boot |
| `js/backup.js` | اصلاح | افزودن کلیدهای نشست و همگام‌سازی به `EXCLUDED` و اکسپورت `pickTask` برای ادغام یکپارچه |
| `index.html` | اصلاح | افزودن کارت غیرتهاجمی «همگام‌سازی ابری و حساب کاربری» در بخش تنظیمات عمومی (`#cloudSyncCard`) |
| `css/settings.css` | اصلاح | استایل‌دهی کارت همگام‌سازی با توکن‌های `--color-*` و خصوصیت‌های منطقی RTL به همراه قوانین `[hidden]` |
| `js/settings.js` | اصلاح | پیاده‌سازی `renderCloudSyncSection`، مدیریت فرم دو مرحله‌ای OTP، دکمه «همگام‌سازی اکنون» و «خروج از حساب» |
| `js/app.js` | اصلاح | راه‌اندازی غیرمسدودکننده `initSyncTriggers` در فاز deferred و رفرش لیست تسک‌ها روی رویداد `daftarche:sync-updated` |
| `sw.js` | اصلاح | افزودن `js/auth-client.js` و `js/sync-client.js` به آرایه کش آفلاین `SHELL` |
| `js/version.js` | اصلاح | ارتقای `self.DAFTARCHE_BUILD` از `v211` به `v212` |
| `tests/sync-e2e.test.mjs` | **جدید** | ۵ تست جامع End-to-End در برابر سرور واقعی Express + SQLite (`:memory:`) |
| `docs/reports/SPRINT_2_3_REPORT.md` | **جدید** | گزارش فنی تکمیل اسپرینت ۲.۳ |

---

## ۲. جریان همگام‌سازی، ادغام بدون اکو و بازیابی خطای ۴۰۱ (Client Sync & Merge Flow)

### ۱. گارد مهمان و قفل تک‌اجرا (Single-Flight Lock)
- برای کاربرانی که وارد حساب نشده‌اند (`!isSyncEnabled()` یا `!getAuthState().isLoggedIn`)، فراخوانی `syncNow()` و `initSyncTriggers()` بلافاصله با `{ ok: true, skipped: true, reason: 'guest' }` بازمی‌گردند و **صفر درخواست شبکه** ارسال می‌شود.
- متغیر `isSyncing` تضمین می‌کند در صورت فراخوانی همزمان (مثلاً اتصال مجدد شبکه همزمان با کلیک کاربر)، دو چرخه همگام‌سازی روی هم نیفتند.

### ۲. فاز ارسال (`pushPendingChanges`)
- با استفاده از `peekBatch(50)` از `js/outbox.js`، تغییرات فشرده‌شده را در دسته‌های حداکثر ۵۰ تایی به `POST /api/sync/push` با هدرهای `Authorization: Bearer <token>` و `X-Client-Build: v212` ارسال می‌کند.
- تابع `ackBatch(res.ackedOpIds)` **صرفاً پس از دریافت پاسخ تاییدشده `200 OK`** فراخوانی می‌شود تا تغییرات حین پرواز (In-Flight Edits) ایمن بمانند.

### ۳. فاز دریافت و ادغام بدون لوپ (`pullRemoteChanges` & `applyRemoteChanges`)
- حلقه `while (hasMore)` اندپوینت `POST /api/sync/pull` را با `{ sinceCursor, limit: 100 }` فراخوانی کرده و `nextCursor` را پس از هر صفحه در `daftarche_sync_cursor_v1` ذخیره می‌کند.
- **ادغام تسک‌ها (`mergeRemoteTask`):** بر پایه قوانین توم‌استون `pickTask` در `js/backup.js` و مقایسه `version` / `updatedAt` انجام می‌شود، ضمن حفظ فیلد محلی `notifiedStatus`.
- **ادغام کتاب‌ها (`mergeRemoteBook`):** فقط متادیتای پیشرفت مطالعه (`lastPage`, `numPages`, `goal.pagesPerDay`, `updatedAt`) را برای کتاب‌ها ادغام می‌کند و هیچ‌گاه به فایل‌های PDF در IndexedDB دست نمی‌زند.
- **صفر لوپ بازگشتی (Zero Echo Loop):** متد `applyRemoteChanges` مستقیماً `state.tasks` و `store.js` را به‌روزرسانی کرده و `invalidateAllBuckets()` و `notify()` را صدا می‌زند، بدون فراخوانی متدهای `taskRepo` یا `appendChange` در `js/outbox.js`.

### ۴. بازیابی ایمن خطای `401 Unauthorized`
- در صورت دریافت پاسخ `401` در هر یک از اندپوینت‌های `fetchMe`، `pushPendingChanges` یا `pullRemoteChanges`:
  - متد `clearAuthSession()` توکن نشست و کرسر همگام‌سازی را پاک کرده و `setSyncEnabled(false)` را اجرا می‌کند.
  - **تمام تسک‌ها، کتاب‌ها و داده‌های محلی کاربر ۱۰۰٪ دست‌نخورده باقی می‌مانند** و برنامه بدون کرش به حالت مهمان بازمی‌گردد.

---

## ۳. ایمنی پشتیبان‌گیری و حریم خصوصی (Backup & Privacy Safety)

- کلیدهای حساس و مخصوص دستگاه شامل `daftarche_auth_v1`، `daftarche_sync_cursor_v1`، `daftarche_last_sync_at_v1`، `daftarche_outbox_v1` و `daftarche_sync_enabled` در مجموعه `EXCLUDED` در `js/backup.js` قرار گرفتند.
- تمام نوشتن‌ها در `localStorage` از طریق `safeSet` / `safeRemove` / `scheduleSave` در `js/store.js` انجام می‌شود.
- تابع `isBackupKey()` برای تمام کلیدهای بالا `false` برمی‌گرداند و خروجی JSON پشتیبان (`collectBackup`) هرگز توکن احراز هویت یا کرسر همگام‌سازی را شامل نمی‌شود.
- سیاست CSP در `index.html` و `_headers` با `connect-src 'self'` و بدون شل‌کردن `script-src` یا افزودن CDN جدید حفظ شده است.

---

## ۴. نتایج آزمون‌ها (Test Results)

| معیار | پیش از اسپرینت ۲.۳ | پس از اسپرینت ۲.۳ |
| :--- | :---: | :---: |
| **تعداد کل تست‌ها (`node --test`)** | ۵۱۱ | **۵۱۶** (۵۱۱ قبلی + ۵ تست E2E جدید) |
| **تعداد تست‌های پاس‌شده (Pass)** | ۵۱۱ | **۵۱۶** |
| **تعداد تست‌های ناموفق (Fail)** | ۰ | **۰** |
| **مدت زمان کل اجرا (`node --test`)** | ۳۰۳۷.۷۳ میلی‌ثانیه | **۲۴۰۷.۵۳ میلی‌ثانیه** |

### سناریوهای تاییدشده در `tests/sync-e2e.test.mjs`:
1. **حالت مهمان:** صفر فراخوانی شبکه و صفر سربار در `outbox` هنگام ساخت تسک و فراخوانی `syncNow` / `initSyncTriggers`.
2. **چرخه کامل Auth + Push + Logout:** ورود OTP، ایجاد/ویرایش/حذف موقت تسک با `taskrepo.js`، ارسال به بک‌اند واقعی و تخلیه `outbox`، سپس خروج و حفظ کامل داده‌های محلی.
3. **شبیه‌سازی دو دستگاه (Device A ↔ Device B):** ارسال تسک، توم‌استون و پیشرفت کتاب از دستگاه A، دریافت روی دستگاه B بدون اکو در `outbox` و همگام‌سازی ویرایش‌های بعدی تسک باز.
4. **بازیابی `401`:** ابطال نشست در SQLite و اطمینان از پاک‌شدن امن نشست و غیرفعال‌شدن همگام‌سازی بدون حذف داده‌های محلی.
5. **ایمنی Backup:** اطمینان از عدم حضور توکن، کرسر و صف `outbox` در خروجی `collectBackup`.

---

## ۵. نکات و چک‌لیست آمادگی برای اسپرینت ۲.۴ (Notes for Sprint 2.4)

برای فعال‌سازی `WEB_PUSH_ENABLED` و نهایی‌سازی فاز ۲ در اسپرینت ۲.۴:
1. **اتصال Web Push به حساب کاربری / سرور:**
   - بررسی وضعیت `WEB_PUSH_ENABLED` در `js/push-service.js` و اتصال اشتراک پوش به `server/push-server.js` (یا یکپارچه‌سازی روترهای پوش و sync روی یک پورت در استقرار).
   - ارسال خودکار یا زمان‌بندی‌شده یادآوری کارهای سررسیددار بدون افشای داده‌های حساس در لاگ‌ها.
2. **پیکربندی آدرس API و پروکسی معکوس در استقرار:**
   - تنظیم Nginx / Caddy برای سرو کردن PWA و پروکسی `/api/*` روی همان مبدأ (`'self'`) تا نیازی به تغییر `connect-src 'self'` نباشد (یا افزودن مبدأ صریح سرور در `ALLOWED_ORIGIN` و CSP در صورت استفاده از ساب‌دامین جداگانه).
3. **تست مرورگر و ساخت اندروید:**
   - اجرای `npm run test:browser` و همگام‌سازی خروجی وب برای بیلد نهایی فاز ۲ (`npm run build:www`).
4. **پاکسازی دوره‌ای توم‌استون‌ها و همگام‌سازی پس‌زمینه:**
   - هماهنگی `purgeOldTombstones(30)` با `lastSyncCursor` پس از تایید همگام‌سازی موفق.
