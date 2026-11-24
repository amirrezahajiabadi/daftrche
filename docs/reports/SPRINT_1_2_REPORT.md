# گزارش اتمام اسپرینت ۱.۲ — لایه دسترسی به داده (DAL)، حذف نرم (Tombstones) و متادیتای همگام‌سازی
# Sprint 1.2 Completion Report — Data Access Layer (DAL), Soft Deletes & Sync-Ready Metadata

**پروژه:** دفترچه (Daftarche v3.5.0)  
**شماره بیلد:** `v208` (ارتقا یافته از `v207`)  
**تاریخ تکمیل:** ۴ آذر ۱۴۰۵ (24 November 2026)  
**وضعیت آزمون‌ها:** ۴۶۵ آزمون موفق از ۴۶۵ آزمون (`node --test` بدون شکست)  
**نقش:** سرپرست معماری و مهندسی فرانت‌اند (Lead Frontend Architect & Engineer)  

---

## ۱. خلاصه مدیریتی و اهداف اسپرینت (Executive Summary & Objectives)

در اسپرینت ۱.۲، هدف اصلی برقراری زیرساخت داده‌ای استاندارد و پایه‌ای برای همگام‌سازی ابری آتی (Phase 2 Sync Engine) بدون برهم‌زدن معماری محلی‌محور (Local-First)، بدون افزودن فریم‌ورک‌های سنگین خارجی، و با حفظ کامل پایداری ۱۰۰٪ برنامه بود.

پیش از این اسپرینت:
- وظایف (`tasks`) مستقیماً از طریق دستکاری مستقیم آرایه `state.tasks` با توابعی نظیر `push`، `splice`، `filter` و جهش مستقیم فیلدها ویرایش می‌شدند.
- حذف کارها به صورت فیزیکی (Hard Delete) بود؛ در نتیجه سابقه حذف وجود نداشت و قابلیت بازگشت (Undo) به یک صف درون‌حافظه‌ای ۵ ثانیه‌ای محدود می‌شد.
- فیلدهای نسخه (`version` / `rev`)، زمان ویرایش (`updatedAt`) و نشانگر حذف نرم (`deletedAt`) وجود نداشتند، که این امر امکان ردیابی تضادها (Conflict Resolution) در همگام‌سازی چنددستگاهی را غیرممکن می‌ساخت.

در این اسپرینت، کلیه اهداف با موفقیت پیاده‌سازی شدند:
1. **پاکت متادیتا (Metadata Envelope):** تعریف و استانداردسازی فیلدهای `updatedAt` (میلی‌ثانیه یونیکس)، `version` (عدد صحیح مثبت با شروع از ۱ و نام مستعار `rev`) و `deletedAt` (میلی‌ثانیه زمان حذف برای نشانگر قبر/Tombstone یا `null` برای کارهای فعال).
2. **ماژول مخزن وظایف (`js/taskrepo.js`):** ایجاد یک Data Access Layer مرکزی و استاندارد به عنوان مرجع یگانه (Single Source of Truth) برای تمام عملیات خواندن و نوشتن وظایف.
3. **حذف نرم و بازیابی (Soft Delete & Restore):** تبدیل حذف قطعی به نشانه‌گذاری با `deletedAt`، ارتقای نسخه، و امکان بازیابی مطمئن داده‌ها.
4. **مهاجرت شفاف و بدون تخریب داده‌های گذشته:** تضمین ارتقای خودکار داده‌های قدیمی بدون فیلدهای متادیتا در زمان بارگذاری بدون تغییر در یکپارچگی یا از دست رفتن داده‌ها.
5. **ارتقای موتور ادغام پشتیبان (`js/backup.js`):** حل تعارضات نشانگرهای حذف (Tombstone Conflict Resolution) بر مبنای برتری نسخه و زمان، با حفظ اصل غیرقابل بازگشت بودن تکمیل کارها (Fact of Completion).
6. **بازنویسی مبادی فراخوانی (Call-Site Migration):** ارتقای تمامی بخش‌های برنامه (`tasks.js`, `today.js`, `calendar.js`, `planner.js`, `focus.js`, `decision.js`, `stats.js`, `daycache.js`, `ledger.js`, `progress.js`, `notifications.js` و غیره) برای تفکیک کارهای زنده از نشانگرهای حذف.
7. **آزمون‌های خودکار جامع:** نگارش ۱۴ آزمون تخصصی جدید در `tests/taskrepo.test.mjs` و پاس شدن تمام ۴۶۵ آزمون کل پروژه.

---

## ۲. طراحی طرح‌واره و متادیتای حذف نرم (Schema & Tombstone Design)

طرح‌واره جدید وظایف بر مبنای قرارداد معماری سند `DATA_CONTRACT.md` تنظیم شده و به صورت کاملاً سازگار با گذشته (Backward-Compatible) پیاده‌سازی گردید:

```javascript
{
  id: "1795531448770a1b2c3",     // شناسه یکتا و پایدار کلاینت
  text: "متن کار",                 // عنوان کار (پاکسازی‌شده با esc هنگام رندر)
  done: false,                     // وضعیت انجام
  p: "mid",                        // اولویت: 'low' | 'mid' | 'high'
  cat: "misc",                     // دسته‌بندی
  dueDate: "2026-10-01",           // مهلت شمسی معادل به فرمت YYYY-MM-DD یا null
  durationMin: 30,                 // مدت زمان تقریبی به دقیقه (۱ تا ۴۸۰) یا null
  timeFrom: 840,                   // دقیقه از نیمه‌شب (۱۴:۰۰)
  timeTo: 960,                     // دقیقه از نیمه‌شب (۱۶:۰۰)
  created: 1795531448770,          // زمان ساخت به میلی‌ثانیه
  doneAt: null,                    // زمان انجام به میلی‌ثانیه یا null
  notify: false,                   // یادآوری فعال
  notifiedStatus: "none",          // وضعیت یادآوری دستگاهی: 'none' | 'soon' | 'overdue'

  /* ── پاکت متادیتای اسپرینت ۱.۲ ── */
  updatedAt: 1795531448770,        // زمان آخرین تغییر (epoch ms)
  version: 1,                      // شماره بازنگری عددی (≥ 1، افزایشی در هر تغییر)
  rev: 1,                          // نام مستعار version مطابق قرارداد Phase 1
  deletedAt: null                  // زمان حذف نرم (epoch ms) یا null برای کارهای فعال
}
```

### رفتارهای کلیدی نشانگر حذف (Tombstones):
- **حذف نرم (`softDeleteTask`):** به جای حذف فیزیکی از آرایه، فیلد `deletedAt` با برچسب زمان جاری پر شده و `version` یک واحد افزایش می‌یابد.
- **پنهان‌سازی از دید کاربر:** متدهای خواندن عادی (`getActiveTasks()`، `visible()`، `todayPending()`، `syncPlan()`، `getRecommendation()`) کارهایی که `deletedAt` دارند را نادیده می‌گیرند.
- **بازیابی (`restoreTask`):** فیلد `deletedAt` به `null` بازگردانده شده و `version` مجدداً افزایش می‌یابد. در نتیجه کار به جایگاه اصلی بازمی‌گردد و قابلیت بازگردانی (Undo) حتی پس از رفرش صفحه نیز معتبر است.
- **پاکسازی دوره‌ای قبرستان داده‌ها (`purgeOldTombstones`):** تابعی برای حذف فیزیکی نشانگرهای قدیمی‌تر از ۳۰ روز (یا مدت دلخواه) جهت جلوگیری از افزایش بی‌رویه حجم ذخیره‌سازی محلی.

---

## ۳. مشخصات رابط مخزن وظایف (Task Repository API Specification)

ماژول جدید در فایل مسطح `js/taskrepo.js` پیاده‌سازی شده و مطابق قوانین `AGENTS.md` در فهرست `SHELL` سرویس‌ورکر (`sw.js`) ثبت شده است.

### توابع خواندن (Read Methods — همگام و 0ms Latency):
- `getActiveTasks(): Array<Task>`: بازگرداندن آرایه کارهای فعال و زنده‌ای که حذف نشده‌اند (`!t.deletedAt`).
- `getAllTasksIncludingDeleted(): Array<Task>`: بازگرداندن کلیه رکوردها شامل نشانگرهای حذف، ویژه لایه‌های پشتیبان‌گیری، همگام‌سازی و بازیافت.
- `getTaskById(id: string, options?: { includeDeleted: boolean }): Task | null`: یافتن رکورد با شناسه یکتا. به طور پیش‌فرض فقط کارهای فعال را برمی‌گرداند؛ در صورت ارسال `includeDeleted: true`، نشانگرهای حذف نیز قابل دریافت خواهند بود.

### توابع نوشتن (Write Methods — همراه با برچسب‌زنی، ذخیره و اعلان):
کلیه توابع تغییردهنده از الگوی قرارداد عدم پرتاب خطا (`{ ok: true, record }` یا `{ ok: false, error }`) پیروی می‌کنند:
- `createTask(data: Object): { ok: boolean, record?: Task, error?: string }`: اعتبارسنجی فیلدها، مقداردهی پاکت نسخه ۱، درج در سرلیست حافظه، زمان‌بندی ذخیره در `store.js` و ارسال اعلان `notify()` به اتوبوس رویدادها.
- `updateTask(id: string, patch: Object): { ok: boolean, record?: Task, error?: string }`: اعمال تغییرات جزئی روی فیلدهای مجاز، افزایش `version` و `rev`، ثبت `updatedAt = Date.now()`، ذخیره و اعلان.
- `toggleTaskDone(id: string, forcedState?: boolean)`: تغییر یا تنظیم وضعیت انجام کار و هماهنگ‌سازی `doneAt`.
- `softDeleteTask(id: string)`: نشانه‌گذاری رکورد به عنوان حذف‌شده با ثبت `deletedAt`، افزایش نسخه، ذخیره و اعلان.
- `restoreTask(id: string)`: پاک کردن `deletedAt` و بازگرداندن رکورد به چرخه کاری.
- `reorderTasks(orderedIds: string[])`: بازچینی ترتیبی کارهای فعال با حفظ جایگاه ردیف‌های فیلترشده بر مبنای `reorderSubset`.
- `purgeOldTombstones(maxAgeDays?: number)`: بازیافت حافظه و حذف فیزیکی نشانگرهای قدیمی‌تر از آستانه تعیین‌شده.
- `hydrateTasks(tasks: Array<Object>)`: بازسازی امن و نرمال‌سازی آرایه کارهای حافظه پس از بازیابی فایل پشتیبان یا تنظیمات.

### نام‌های مستعار منطبق با قرارداد سند REPOSITORY_CONTRACTS:
برای سازگاری با معماری آینده، نام‌های کوتاه زیر نیز در دسترس هستند:
`all` (معادل `getActiveTasks`)، `get` (معادل `getTaskById`)، `create` (معادل `createTask`)، `update` (معادل `updateTask`)، `setDone`، و `reorder`. همچنین آبجکت `taskRepo` شامل تمامی این متدها صادر شده است.

---

## ۴. ممیزی و مهاجرت مبادی فراخوانی (Call-Site Migration Audit)

تمامی فایل‌های جاوااسکریپت پروژه مورد بازبینی قرار گرفته و دستکاری‌های مستقیم به شرح زیر به لایه مخزن منتقل شدند:

| فایل | محل تغییر | رفتار قبلی | رفتار جدید پس از مهاجرت |
|---|---|---|---|
| `js/tasks.js` | `addTask()` | درج دستی در `state.tasks.unshift` | استفاده از `createTask` مخزن با دریافت رکورد نرمال‌شده |
| `js/tasks.js` | `collapse()` | فیلتر فیزیکی `state.tasks = filter(...)` | استفاده از `softDeleteTask(id)` و حفظ سابقه برای Undo |
| `js/tasks.js` | `performUndo()` | درج با `splice` | فراخوانی `restoreTask(task.id)` جهت احیای وضعیت کار |
| `js/tasks.js` | `setTaskDone()` | ویرایش مستقیم `task.done` | فراخوانی `updateTask(id, { done })` |
| `js/tasks.js` | `moveTaskToDay()` | ویرایش مستقیم `task.dueDate` | فراخوانی `updateTask(id, { dueDate, notifiedStatus: 'none' })` |
| `js/tasks.js` | `applyEdits()` | تغییر خصوصیات دستی | فراخوانی `updateTask(task.id, patch)` |
| `js/tasks.js` | `syncOrder()` | جایگزینی دستی آرایه | فراخوانی `reorderTasks(order)` |
| `js/tasks.js` | تراشه‌ها و درگ | تغییر مستقیم در `initTasks` | هدایت به `updateTask` با بسته‌های تغییراتی دقیق |
| `js/tasks.js` | `visible()` | فیلتر بر اساس فیلترهای نمایش | اضافه شدن شرط `!t.deletedAt` برای ممانعت از رندر قبرها |
| `js/today.js` | `isTodayPending` و `isDoneToday` | بررسی وضعیت `done` | اضافه شدن فیلتر `!t.deletedAt` جهت پاکسازی لیست امروز |
| `js/today.js` | `getRecommendation` | ارسال کل `state.tasks` | فیلتر کارهای بدون `deletedAt` برای ارسال به موتور تصمیم‌گیری |
| `js/calendar.js` | `syncPlan` و اثرانگشت | پیمایش تمام کارها | حذف رکوردهای دارای `deletedAt` از تجمیع تقویم |
| `js/planner.js` | برنامه‌ریزی روزها | واکشی از `state.tasks` | نادیده گرفتن رکوردهای حذف نرم در خط زمانی و جدول |
| `js/focus.js` | انتخاب کار تمرکز | نمایش تمام کارهای ناتمام | نادیده گرفتن رکوردهای حذف نرم در کارت‌های تمرکز |
| `js/decision.js` | رتبه‌بندی کارها | بررسی وضعیت فعال بودن | نادیده گرفتن قطعی کارهای دارای `deletedAt` در نامزدها |
| `js/progress.js` | شمارنده‌های پاورقی | شمارش خام کل کارها | تفکیک کارهای زنده از نشانگرهای حذف در محاسبات آماری |
| `js/stats.js` | فوت‌پرینت و محاسبات | محاسبه بازه‌ها | لحاظ کردن انحصاری کارهای فاقد `deletedAt` |
| `js/daycache.js` | ایندکس روزها و امروز | شمارش تمام کارها | شمارش صرفاً کارهای بدون `deletedAt` |
| `js/ledger.js` | ثبت کف‌های روزانه | بررسی وضعیت کارهای روز | عدم احتساب کارهای حذف‌شده در ارتقای روزانه کف دستاوردها |
| `js/notifications.js` | هشدارهای موعد | بررسی کارهای ثبت‌شده | جلوگیری از انتشار نوتیفیکیشن برای کارهای حذف نرم شده |

---

## ۵. سازگاری رو به عقب و موتور ادغام (Compatibility & Merge Engine)

### ۱. ارتقای داده‌های محلی در زمان بارگذاری (Load-Time Normalization):
در فایل `js/state.js`، تابع `normalizeTask(t)` به گونه‌ای ارتقا یافت که هر وظیفه قدیمی بدون فیلدهای پاکت، به محض خوانده شدن مقادیر معتبر پیش‌فرض دریافت کند:
- اگر `updatedAt` نامعتبر باشد، از `task.doneAt || task.created || Date.now()` استفاده می‌شود.
- اگر `version` یا `rev` موجود نباشد، با عدد صحیح `1` مقداردهی اولیه می‌شود.
- اگر `deletedAt` نامعتبر یا منفی باشد، به صورت امن برابر `null` قرار می‌گیرد.
- فرآیند به صورت کاملاً غیرتخریبی (Non-Destructive) انجام شده و هیچ فیلد یا داده‌ای از کاربر حذف نمی‌گردد.

### ۲. حل تعارضات در موتور ادغام فایل پشتیبان (`js/backup.js`):
تابع `pickTask(local, incoming)` با منطق همگام‌سازی نشانگرهای حذف بازنویسی شد:
1. **اگر هر دو نسخه حذف شده باشند:** نسخه‌ای که شماره `version` بالاتری دارد برنده است؛ در صورت برابری نسخه‌ها، زمان حذف جدیدتر (`deletedAt`) انتخاب می‌شود.
2. **اگر یکی حذف و دیگری فعال باشد:**
   - اگر نسخه قبر بزرگ‌تر از نسخه فعال باشد (`delV > actV`)، نشانگر حذف پیروز است (کار در دستگاه دیگر حذف شده).
   - اگر نسخه فعال بزرگ‌تر باشد (`actV > delV`)، نسخه فعال پیروز است (کار پس از حذف، بازیابی یا ویرایش شده).
   - در صورت برابری نسخه‌ها یا عدم وجود متادیتا در بکاپ‌های قدیمی، زمان حذف با زمان ویرایش کار فعال مقایسه می‌شود (`delTime >= actTime`).
3. **اگر هر دو فعال باشند:** اصل غیرقابل برگشت بودن تکمیل حفظ می‌شود (کار انجام‌شده بر کار باز غلبه دارد، زمان تکمیل متأخرتر برنده است و برای کارهای باز متادیتا و نسخه محلی حفظ می‌گردد).

---

## ۶. نتایج آزمون‌های خودکار (Automated Test Suite Results)

مجموعه آزمون‌های پروژه با موتور بومی Node.js (`node --test`) اجرا شده و نتایج زیر ثبت شد:

```
✔ catalogue sanity: unique ids, ascending tiers, known family/kind, totals add up
✔ Named imports integrity: every imported symbol must be exported by its target module
✔ sw.js SHELL array includes js/taskrepo.js & js/native.js
✔ round trip: export → parse → apply reproduces the data on a fresh device
✔ merge tasks: a completion is a fact; two open copies keep this device's
✔ createTask: initializes metadata envelope (updatedAt, version 1, deletedAt null)
✔ createTask: rejects empty or invalid payload
✔ updateTask: increments version and stamps updatedAt
✔ updateTask: changes completion and sets/clears doneAt
✔ updateTask: resets notifiedStatus to none when dueDate changes
✔ updateTask: returns error for non-existent id
✔ toggleTaskDone: toggles completion state cleanly
✔ softDeleteTask: creates a tombstone and hides from getActiveTasks
✔ restoreTask: clears tombstone and brings task back to active list
✔ reorderTasks: preserves order and keeps tombstones
✔ purgeOldTombstones: garbage collects tombstones older than maxAgeDays
✔ hydrateTasks: loads and normalizes tasks batch
✔ legacy migration: unversioned tasks receive valid envelope defaults
✔ backup merge: tombstone resolution respects version and updatedAt
...
ℹ tests 465
ℹ suites 0
ℹ pass 465
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2235.6055
```

- **تعداد کل آزمون‌ها:** ۴۶۵ آزمون (۱۴ آزمون جدید اضافه شد).
- **تعداد شکست یا خطا:** ۰ شکست.
- **تأیید صحت یکپارچگی ایمپورت‌ها:** آزمون `app_integrity.test.mjs` با موفقیت تطابق صد در صدی نمادهای ماژول جدید `taskrepo.js` با کدهای مصرف‌کننده را تایید کرد.

---

## ۷. یادداشت‌های معماری برای فاز ۲ (Architectural Notes for Phase 2 Sync Engine)

با استقرار موفقیت‌آمیز لایه دسترسی داده (DAL) و نشانگرهای حذف نرم در اسپرینت ۱.۲، پایه‌های لازم برای اتصال همگام‌سازی ابری فاز ۲ تکمیل شده است:

1. **ارتباط با صندوق خروجی (Outbox Integration):**
   - در فاز ۲، متدهای `createTask`، `updateTask`، `softDeleteTask` و `restoreTask` در `taskrepo.js` یک فراخوانی اختیاری به ماژول آینده `outbox.appendChange({ kind: 'tasks', id, rev, action })` اضافه خواهند کرد.
   - برای کاربران مهمان (بدون لاگین)، صندوق خروجی کاملاً غیرفعال خواهد ماند تا طبق تصمیم سند `DATA_ACCESS_LAYER_DESIGN.md` هیچ بار اضافی یا ترافیک بیهوده‌ای تولید نشود.
2. **نگاشت و پروژکشن داده‌ها (Data Projection):**
   - فیلد `notifiedStatus` یک وضعیت کاملاً وابسته به سخت‌افزار دستگاه محلی است و در بسته‌های همگام‌سازی ابری ارسال نخواهد شد.
   - سایر فیلدهای تسک همراه با `version` و `updatedAt` به عنوان ماهیت‌های همگام‌پذیر دسته‌بندی **S** ارسال خواهند شد.
3. **سازوکار پاکسازی دوره‌ای (Garbage Collection):**
   - متد `purgeOldTombstones(30)` به صورت پس‌زمینه در هنگام بوت برنامه یا پس از تأیید موفقیت همگام‌سازی با سرور قابل اجرا خواهد بود تا داده‌های حذف‌شده خیلی قدیمی به آرامی از حافظه دستگاه پاک شوند.

---
**گزارش تایید و نهایی شد.**  
سرپرست معماری و مهندسی نرم‌افزار — دفترچه v3.5.0 (Build `v208`)
