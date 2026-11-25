# گزارش فنی اسپرینت ۲.۲: بک‌اند Express + SQLite، احراز هویت مهمان-محور و API همگام‌سازی

**نسخه:** `v3.5.0` | **شماره ساخت:** `v211`  
**تاریخ:** ۲۵ نوامبر ۲۰۲۶ (۴ آذر ۱۴۰۵)  
**وضعیت:** موفق (Pass: 511/511 Tests)

---

## ۱. خلاصه تغییرات (Summary of Changes)

در اسپرینت ۲.۲، بک‌اند سبک، خودمیزبان (Self-Hosted) و بدون وابستگی ابری برای پشتیبانی از احراز هویت اختیاری بدون رمز (OTP) و همگام‌سازی ابری انتخابی (Selective Cloud Sync) در پوشه `server/` پیاده‌سازی شد. این سرویس در کنار `server/push-server.js` بدون نیاز به کامپایل ابزارهای بومی C++ (Zero-Native-Build) روی سرورهای ایران قابل اجراست.

| فایل | نوع تغییر | شرح تغییرات |
| :--- | :---: | :--- |
| `server/db.js` | **جدید** | لایه دسترسی SQLite مبتنی بر ماژول داخلی `node:sqlite` (`DatabaseSync`) با حالت WAL و پشتیبانی `:memory:` |
| `server/auth.js` | **جدید** | ماژول احراز هویت OTP (ایمیل و موبایل ایران)، هش نمکی SHA-256، توکن نشست Bearer و آداپتور قابل تعویض `sendOtp` |
| `server/sync.js` | **جدید** | اندپوینت‌های `POST /api/sync/push` (Idempotent + Revision Guard) و `POST /api/sync/pull` (Cursor Pagination) |
| `server/api-server.js` | **جدید** | فکتوری `createApp`، پیکربندی CORS، محدودیت نرخ، هدرهای امنیتی، لاگینگ امن و اجراکننده مستقل سرور |
| `server/package.json` | اصلاح | افزودن اسکریپت `"api": "node api-server.js"` در کنار سرور پوش فعلی |
| `tests/backend-sync.test.mjs` | **جدید** | ۱۰ تست جامع یکپارچه‌سازی و امنیت با دیتابیس `:memory:` و تست WAL فایل |
| `docs/reports/SPRINT_2_2_REPORT.md` | **جدید** | گزارش فنی تکمیل اسپرینت ۲.۲ |

---

## ۲. ساختار پایگاه داده و انتخاب موتور ذخیره‌سازی (Database Schema & Storage Choice)

### انتخاب موتور: `node:sqlite` (`DatabaseSync`)
محیط اجرای سرور روی **Node.js `v24.19.0`** قرار دارد که ماژول داخلی **`node:sqlite`** (`DatabaseSync`) را به‌صورت بومی ارائه می‌دهد. انتخاب `node:sqlite` به جای `better-sqlite3` مزایای زیر را برای استقرار روی سرورهای ایران فراهم می‌کند:
- **صفر اصطکاک بیلد:** بدون نیاز به `node-gyp`، Python یا کامپایلر C++ روی سرور مقصد.
- **عملکرد همگام و تراکنشی:** پشتیبانی کامل از `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` و `PreparedStatement`.
- **حالت WAL و تست ایزوله:** برای دیتابیس فایلی، حالت `PRAGMA journal_mode = WAL`، `PRAGMA synchronous = NORMAL` و `PRAGMA busy_timeout = 5000` فعال می‌شود؛ در حالی که `:memory:` اجرای بسیار سریع و ایزوله تست‌ها را ممکن می‌سازد.
- **یکپارچگی ارجاعی:** `PRAGMA foreign_keys = ON` روی تمامی اتصال‌ها فعال است.

### جداول و ایندکس‌ها
1. **`users`**:
   - ستون‌ها: `id TEXT PRIMARY KEY` (UUID v4)، `identifier TEXT NOT NULL UNIQUE` (ایمیل کوچک‌شده یا موبایل نرمال‌شده با فرمت `+989xxxxxxxxx`)، `created_at INTEGER NOT NULL`، `updated_at INTEGER NOT NULL`.
2. **`otp_codes`**:
   - ستون‌ها: `identifier TEXT PRIMARY KEY`، `code_hash TEXT NOT NULL` (فرمت `${saltHex}:${sha256Hex}` — هرگز متن خام ذخیره نمی‌شود)، `expires_at INTEGER NOT NULL` (TTL پنج دقیقه‌ای)، `attempts INTEGER NOT NULL DEFAULT 0`، `created_at INTEGER NOT NULL`.
3. **`sessions`**:
   - ستون‌ها: `token_hash TEXT PRIMARY KEY` (SHA-256 توکن Bearer)، `user_id TEXT NOT NULL` (FK به `users`)، `device_name TEXT`، `created_at INTEGER NOT NULL`، `expires_at INTEGER NOT NULL`، `revoked_at INTEGER`.
   - ایندکس: `idx_sessions_user_id ON sessions(user_id)`.
4. **`sync_entities`**:
   - کلید اصلی ترکیبی: `PRIMARY KEY (user_id, kind, entity_id)` با قید `kind IN ('task', 'book')` و `action IN ('upsert', 'delete')` و `rev >= 1`.
   - ستون‌ها: `action`، `rev`، `server_cursor INTEGER NOT NULL` (یکتا و صعودی اکید برای هر کاربر)، `payload_json TEXT NOT NULL`، `updated_at INTEGER NOT NULL`.
   - ایندکس دلتا: `idx_sync_entities_user_cursor ON sync_entities(user_id, server_cursor)`.
5. **`sync_ops`**:
   - کلید اصلی ترکیبی: `PRIMARY KEY (user_id, op_id)` + `processed_at INTEGER NOT NULL` برای تضمین Idempotency در ارسال‌های تکراری.

---

## ۳. اندپوینت‌های API و سخت‌افزاری/امنیتی (API Endpoints & Security Hardening)

### اندپوینت‌ها
| مسیر | متد | احراز هویت | توضیح |
| :--- | :---: | :---: | :--- |
| `/api/health` | `GET` | عمومی | بررسی سلامت سرویس و اجرای `SELECT 1` روی SQLite |
| `/api/auth/request-otp` | `POST` | عمومی | نرمال‌سازی ایمیل/موبایل، تولید OTP ۶ رقمی با `crypto.randomInt`، ذخیره هش نمکی و ارسال از طریق `sendOtp` |
| `/api/auth/verify-otp` | `POST` | عمومی | مقایسه زمان‌ثابت `crypto.timingSafeEqual`، سقف ۵ تلاش ناموفق، ایجاد کاربر و صدور توکن ۳۰ روزه |
| `/api/auth/me` | `GET` | `requireAuth` | بازگرداندن `{ ok: true, user: { id, identifier } }` |
| `/api/auth/logout` | `POST` | `requireAuth` | باطل‌سازی نشست فعلی (`revoked_at`) |
| `/api/sync/push` | `POST` | `requireAuth` | دریافت حداکثر ۱۰۰ پاکت در هر درخواست، اعتبارسنجی قرارداد سیمی، Idempotency با `sync_ops` و گارد `rev >= existing.rev` |
| `/api/sync/pull` | `POST` | `requireAuth` | دریافت تغییرات `server_cursor > sinceCursor` با ترتیب صعودی و صفحه‌بندی (`limit` محدود به `1..200`، `hasMore`، `nextCursor`) |

### سخت‌سازی امنیتی
- **میان‌افزار `requireAuth`:** استخراج `Authorization: Bearer <token>`، محاسبه SHA-256، بررسی عدم ابطال (`revoked_at IS NULL`) و عدم انقضا (`expires_at > now`) و ایزوله‌سازی کامل داده‌ها بر اساس `req.auth.userId`.
- **محدودیت نرخ درون‌حافظه‌ای (Rate Limiting):**
  - `auth-request-otp-ip`: ۱۵ درخواست در دقیقه به ازای هر IP.
  - `auth-request-otp-id`: ۵ درخواست در دقیقه به ازای هر شناسه (هش‌شده).
  - `auth-verify-otp-ip`: ۳۰ درخواست در دقیقه به ازای هر IP (به‌علاوه سقف سخت ۵ تلاش اشتباه برای هر کد OTP).
  - `sync-push` / `sync-pull`: ۶۰ درخواست در دقیقه به ازای هر کاربر.
- **محدودیت بدنه و هدرها:** سقف بدنه `256kb` (`express.json({ limit: '256kb' })`)، غیرفعال‌سازی `x-powered-by`، اعمال هدرهای `X-Content-Type-Options: nosniff`، `Referrer-Policy: no-referrer`، `Cache-Control: no-store` و اعتبارسنجی CORS.
- **لاگینگ امن (Privacy-Safe):** ثبت صرفاً `method`، `path`، `statusCode` و زمان پاسخ؛ بدون ثبت توکن، کد OTP، شناسه خام یا متن تسک‌ها.

### متغیرهای محیطی برای استقرار پروداکشن
- `PORT`: پورت گوش دادن سرور (پیش‌فرض: `3200`).
- `NODE_ENV`: روی `production` تنظیم شود.
- `ALLOWED_ORIGIN`: مبدأ دقیق کلاینت (الزامی در `production`؛ در نبود آن سرور بالا نمی‌آید).
- `DB_PATH`: مسیر فایل دیتابیس SQLite (پیش‌فرض: `server/daftarche.sqlite`).
- `ENABLE_REQUEST_LOG`: اختیاری (`true` / `false`).
- *(اختیاری در آینده)* کلیدهای آداپتور پیامک/ایمیل (مانند Kavenegar API Key یا SMTP) فقط از محیط سرور تزریق می‌شوند.

---

## ۴. نتایج آزمون‌ها (Test Results)

| معیار | پیش از اسپرینت ۲.۲ | پس از اسپرینت ۲.۲ |
| :--- | :---: | :---: |
| **تعداد کل تست‌ها (`node --test`)** | ۵۰۱ | **۵۱۱** (۵۰۱ کلاینت/هسته + ۱۰ تست جدید بک‌اند) |
| **تعداد تست‌های پاس‌شده (Pass)** | ۵۰۱ | **۵۱۱** |
| **تعداد تست‌های ناموفق (Fail)** | ۰ | **۰** |
| **مدت زمان اجرا (`tests/backend-sync.test.mjs`)** | — | **۱۲۲۷.۳۰ میلی‌ثانیه** |
| **مدت زمان کل مجموعه (`node --test`)** | ۲۲۳۶–۳۸۸۶ میلی‌ثانیه | **۳۰۳۷.۷۳ میلی‌ثانیه** |

### پوشش تست‌های جدید (`tests/backend-sync.test.mjs`):
1. فعال‌سازی حالت `WAL` در فایل واقعی SQLite و ساخت هر ۵ جدول.
2. نرمال‌سازی ایمیل و فرمت‌های مختلف موبایل ایران (شامل ارقام فارسی) و رد ورودی‌های نامعتبر.
3. چرخه کامل Auth: درخواست OTP، بررسی ذخیره‌سازی هش نمکی (بدون متن خام)، رد کد اشتباه، تایید کد صحیح، بررسی هش توکن در DB، فراخوانی `/me`، `/logout` و رد توکن ابطال‌شده.
4. قفل شدن OTP پس از ۵ تلاش ناموفق، انقضای زمانی و محدودیت نرخ درخواست OTP.
5. انقضای دقیق OTP پس از پایان TTL.
6. ارسال موفق پاکت‌های `task` و `book` (ساخته‌شده با `js/sync-projection.js`)، تست Idempotency (`opId` تکراری) و گارد `rev` قدیمی.
7. اعتبارسنجی دقیق Push: عدم احراز هویت (`401`)، پاکت‌های ناقص (`400`)، سقف ۱۰۰تایی دسته (`400`) و سقف حجم `256kb` (`413`).
8. صفحه‌بندی Pull (`sinceCursor`، `limit`، `hasMore`، `nextCursor`) و ایزوله‌سازی اکید بین کاربر A و کاربر B.
9. چرخه کامل Tombstone (`action: 'delete'` و بازیابی آن در Pull).
10. سخت‌سازی CORS در `production` (اجبار `ALLOWED_ORIGIN` و رد مبدأ ناشناس با `403`).

---

## ۵. نکات و چک‌لیست آمادگی برای اسپرینت ۲.۳ (Notes for Sprint 2.3)

برای اتصال لایه کلاینت (`js/outbox.js` و `js/backup.js`) به این بک‌اند در اسپرینت ۲.۳:
1. **مدیریت جلسه و توکن مهمان-محور در کلاینت:**
   - افزودن ماژول احراز هویت کلاینت (ذخیره توکن Bearer و `lastSyncCursor` در `localStorage` از طریق `js/store.js` با رعایت کلیدهای device-local در `EXCLUDED` فایل `js/backup.js`).
   - هنگام خروج یا باطل شدن نشست (`401`)، توکن پاک و `setSyncEnabled(false)` اعمال شود بدون آنکه داده‌های محلی کاربر مهمان حذف شوند.
2. **موتور همگام‌سازی (Sync Runner) روی `js/outbox.js`:**
   - اتصال `peekBatch(50)` به `POST /api/sync/push` با ارسال هدر `Authorization: Bearer <token>` و `X-Client-Build`.
   - فراخوانی `ackBatch(res.ackedOpIds)` تنها پس از دریافت پاسخ `200 OK` برای حفظ ایمنی In-Flight.
   - پیاده‌سازی حلقه `while (hasMore)` روی `POST /api/sync/pull` با `sinceCursor` ذخیره‌شده و به‌روزرسانی اتمیک `nextCursor`.
3. **ادغام سمت کلاینت (`js/backup.js` / `js/taskrepo.js`):**
   - ادغام تغییرات دریافتی `task` با قوانین Tombstone و `version`/`updatedAt` (بدون ایجاد لوپ و بدون افزودن عملیات کشیده‌شده به `outbox` — مشابه الگوی `hydrateTasks`).
   - ادغام متادیتای `book` از طریق `currentPage` / `totalPages` / `dailyGoal` بدون دست‌زدن به بلاب‌های PDF محلی در IndexedDB.
4. **اتصال به پیامک/ایمیل واقعی در استقرار:**
   - پیاده‌سازی تابع `sendOtp(identifier, code)` در لایه استقرار (مانند کاوه‌نگار یا سرویس SMTP) و تزریق آن به `createApp({ db, sendOtp })` بدون نیاز به تغییر در `server/auth.js`.
   - هماهنگی `sw.js` (`SHELL`) و ارتقای `DAFTARCHE_BUILD` در `js/version.js` پس از افزودن ماژول‌های جدید کلاینت.
