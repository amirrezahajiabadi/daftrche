# گزارش فنی اسپرینت ۳.۳: جریان کاری دانشگاهی و دانشجویی (درس‌ها، ترم، برنامهٔ کلاسی، شمارشگر امتحان و اتصال کار/PDF)

**نسخه:** `v3.5.0` | **شماره ساخت:** `v220` (ارتقا از `v219` پس از بهینه‌سازی UX مطابق ۱۰ اصل نیلسن)  
**تاریخ:** ۲۵ نوامبر ۲۰۲۶ (۴ آذر ۱۴۰۵)  
**وضعیت:** موفق (Pass: 539/539 Tests)

---

## ۱. خلاصه تغییرات و ارتقای ساخت (Summary of Changes)

در اسپرینت ۳.۳، فضای کاری اختصاصی دانشجویان (**«درس و ترم»** در `#page-study` از طریق منوی «بیشتر» و نوار کناری دسکتاپ) بدون شلوغ‌کردن نوار پایین موبایل پیاده‌سازی شد. فایل‌های جدید در `SHELL` فایل `sw.js` ثبت شده و شناسهٔ ساخت در `js/version.js` (و `js/auth-client.js`) به **`v219`** ارتقا یافت.

| فایل | نوع تغییر | شرح تغییرات |
| :--- | :---: | :--- |
| `js/study-logic.js` | **جدید** | منطق خالص و بدون DOM: نرمال‌سازی ترم و درس‌ها (`normalizeStudyData`, `normalizeCourse`, `validateSession`)، شمارشگر امتحان‌ها (`getUpcomingExams`)، برنامهٔ کلاسی با شروع هفته از شنبه (`getTodayClasses`)، آمار اتصال (`computeCourseStats`) و ادغام پشتیبان (`mergeStudyData`) |
| `js/study.js` | **جدید** | کنترلر صفحهٔ `#page-study`: ویرایش نام ترم، نوار امتحان‌های پیش رو، سوئیچ برنامهٔ امروز/هفتگی، شبکهٔ کارت درس‌ها، مودال جزئیات درس (با افزودن کار متصل و باز/متصل‌کردن PDF در کتابخانه) و مودال افزودن/ویرایش درس با انتخابگر تاریخ شمسی (`openDuePicker`) |
| `css/study.css` | **جدید** | استایل صفحهٔ «درس و ترم»، نوار امتحان، جدول هفتگی و مودال‌ها با توکن‌های `--color-*` (بدون hex مستقیم)، خصوصیت‌های منطقی RTL و قوانین کاهش حرکت |
| `js/constants.js` & `js/i18n.js` | اصلاح | افزودن `STORAGE_KEYS.study = 'daftarche-study'` و ثبت `'study'` در `MORE_PAGES` و ترجمه‌های فارسی/انگلیسی |
| `js/store.js`, `js/state.js`, `js/settings.js` | اصلاح | افزودن `loadStudy()` / `saveStudy()`، فیلد اختیاری `courseId` در `normalizeTask`، نگهداری `state.study` و بازیابی پس از بازگردانی پشتیبان |
| `js/taskrepo.js`, `js/taskedit.js`, `js/tasks.js` | اصلاح | پشتیبانی از `courseId` در ایجاد و ویرایش کارها و نمایش انتخابگر اختیاری **«درس مرتبط»** در `#taskEditOverlay` تنها زمانی که حداقل یک درس فعال وجود دارد |
| `js/library.js` | اصلاح | نمایش نشان درس روی کارت کتاب در صورت اتصال و افزودن گزینهٔ **«اتصال به درس»** به منوی سه‌نقطهٔ کتاب (`bookCard`) بدون کپی کردن باینری PDF |
| `js/sync-projection.js` & `js/backup.js` | اصلاح | افزودن `courseId` به `projectTaskForSync` و `projectBookProgressForSync` و ثبت `'daftarche-study': 'object'` در `SHAPES` و `mergeStudyData` در `MERGERS` |
| `index.html`, `js/app.js`, `sw.js` | اصلاح | افزودن `#page-study`، `#studyCourseDetailOverlay`، `#studyCourseFormOverlay`، `#teCourseWrap`، راه‌اندازی تنبل در `ensurePageReady`/`reflect` و ثبت فایل‌های جدید در `SHELL` |
| `js/version.js` & `js/auth-client.js` | اصلاح | ارتقای شناسهٔ ساخت به **`v220`** |
| `tests/study.test.mjs` | **جدید** | ۶ تست جامع برای نرمال‌سازی، شمارشگر امتحان، هفتهٔ شمسی از شنبه، آمار اتصال، ادغام پشتیبان، `taskrepo`/`sync-projection` و `backup` |
| `docs/reports/SPRINT_3_3_REPORT.md` | **جدید** | گزارش فنی تکمیل اسپرینت ۳.۳ |

---

## ۲. مدل دادهٔ دانشگاهی و اتصال یکپارچه (`courseId`)

### ۱. ساختار ذخیره‌سازی (`daftarche-study`)
```js
{
  activeSemester: "پاییز ۱۴۰۵",
  courses: [
    {
      id, name, code, instructor, colorToken, credits,
      examDate, examTime,
      sessions: [{ dayOfWeek, timeFrom, timeTo, room }], // dayOfWeek: 0=شنبه .. 6=جمعه
      updatedAt, version, deletedAt
    }
  ]
}
```
- **رنگ‌های معنایی بدون hex:** نشانگر رنگی هر درس (`colorToken`) به شش توکن استاندارد `--color-*` محدود است (`accent`، `success`، `warning`، `danger`، `accent-strong`، `text-secondary`).
- **تقویم هفتگی ایرانی:** تابع `iranianWeekdayFromKey` روزهای هفته را دقیقاً از **شنبه = ۰ تا جمعه = ۶** نگاشت می‌کند و `getTodayClasses` جلسات همان روز را بر اساس ساعت شروع مرتب می‌نماید.

### ۲. اتصال عقب‌رو-سازگار به کارها و کتابخانه
- کارهای قدیمی بدون فیلد `courseId` در `normalizeTask` مقدار ایمن `null` می‌گیرند.
- در مودال ویرایش کار (`#taskEditOverlay`) بخش **«درس مرتبط»** (`#teCourseWrap`) تا زمانی که کاربری هیچ درسی نساخته پنهان می‌ماند تا رابط کاربری برای کاربران غیردانشجو بدون تغییر بماند.
- در کتابخانه (`js/library.js`)، `courseId` صرفاً روی متادیتای سبک `daftarche-books-meta` ذخیره می‌شود و فایل‌های PDF درون IndexedDB (`daftarche-books`) بدون هیچ تکرار یا تغییر ساختاری از مودال جزئیات درس قابل بازشدن با یک کلیک هستند.

---

## ۳. سازگاری پشتیبان و همگام‌سازی (`js/backup.js` & `js/sync-projection.js`)

- کلید `daftarche-study` در `collectBackup` و `applyBackup` پشتیبانی و با `'object'` در `SHAPES` اعتبارسنجی می‌شود.
- تابع `mergeStudyData` بر اساس `id` درس‌ها و مقایسهٔ `version`، سپس `updatedAt` و سپس tombstone (`deletedAt`) ادغام را انجام می‌دهد.
- هر دو تابع نگاشت همگام‌سازی (`projectTaskForSync` و `projectBookProgressForSync`) اکنون فیلد اختیاری `courseId` را حمل می‌کنند و قرارداد فعلی `SYNC_KINDS = ['task', 'book']` کاملاً محفوظ مانده است.

---

## ۴. نتایج آزمون‌ها (Test Results)

| معیار | پیش از اسپرینت ۳.۳ | پس از اسپرینت ۳.۳ |
| :--- | :---: | :---: |
| **تعداد کل تست‌ها (`node --test`)** | ۵۳۳ | **۵۳۹** (۵۳۳ قبلی + ۶ تست جدید `study.test.mjs`) |
| **تعداد تست‌های پاس‌شده (Pass)** | ۵۳۳ | **۵۳۹** |
| **تعداد تست‌های ناموفق (Fail)** | ۰ | **۰** |
| **مدت زمان کل اجرا (`node --test`)** | ۲۶۷۷.۷۷ میلی‌ثانیه | **۲۷۶۱.۷۵ میلی‌ثانیه** |

- همچنین بررسی مرورگر کروم (Headless Chrome `412×844`) نمایش نوار شمارشگر امتحان («فردا»)، برنامهٔ کلاسی امروز و نمای هفتگی، افزودن کار متصل به درس، اتصال کتاب PDF از کتابخانه، پشتهٔ صحیح `#dueOverlay` روی مودال افزودن درس و نمایان شدن انتخابگر «درس مرتبط» در ویرایش کار را بدون هیچ خطای کنسولی (`CONSOLE ERRORS: []`) تأیید کرد.

---

## ۵. نکات آمادگی برای اسپرینت ۳.۴ (Online Co-Focus Rooms & Daftarche Stickers)

1. **زیرساخت هم‌تمرکز آنلاین روی `server/api-server.js`:**
   - افزودن مسیرهای سبک SSE/WebSocket برای اتاق‌های مطالعهٔ گروهی (Co-Focus Rooms) با کد اتاق کوتاه، وضعیت حضور ناشناس/اختیاری (Guest-friendly) و هم‌زمانی تایمر پومودورو بدون الزام ثبت‌نام.
2. **استیکرها و تعامل آرام (Daftarche Stickers):**
   - استفاده از SVGهای خطی و شخصیت‌های بومی دَفتَرچه (`qorqori`, `rizolo`, `khabalo`, `fekrbaz`, `jingool`) با توکن‌های `--color-*` برای حفظ هویت بصری یکپارچه و بدون وابستگی بیرونی.
3. **مدیریت وضعیت آفلاین:**
   - جداسازی وضعیت شبکهٔ Co-Focus در لایهٔ کلاینت به‌گونه‌ای که کاربران آفلاین یا مهمان هیچ درخواست شبکهٔ ناخواسته‌ای دریافت نکنند.
