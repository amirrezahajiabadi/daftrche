# گزارش تکمیل دنیای اول (Fun World 1/5): Resident Evil 7: Biohazard — Baker Estate

- **نسخه و بیلد:** `v3.5.0` — ارتقای نهایی به **`v228`** در [version.js](file:///d:/Project/NewDaftrche/js/version.js) و [auth-client.js](file:///d:/Project/NewDaftrche/js/auth-client.js).
- **معماری ماژول و پلتفرم آفلاین:** استایل ایزولهٔ [world-re7.css](file:///d:/Project/NewDaftrche/css/world-re7.css)، ماژول پلاگین [world-re7.js](file:///d:/Project/NewDaftrche/js/world-re7.js)، و هر ۸ دارایی بهینه‌شده در پوشهٔ `assets/worlds/re7/*.webp` درون `SHELL` فایل [sw.js](file:///d:/Project/NewDaftrche/sw.js) ثبت شدند (مجموع کل ۸ تصویر: کمتر از `200 KB`).
- **حذف کامل ساعت مچی کدکس / ECG:** مطابق دستور، هیچ ویجت ساعت مچی یا مانیتور کدکس/ضربان قلبی وجود ندارد و به‌جای آن ویجت پیشرفت **بطری کمک‌های اولیه (`prop-med.webp`)** و **تلفن زوئی (`prop-phone.webp`)** در اتاق سیو ادغام شده‌اند.

---

## ۱. جدول دارایی‌های تصویری بهینه‌شده

| نام / منبع | مسیر نهایی بهینه‌شده | ابعاد نهایی | حجم نهایی | توضیحات بهینه‌سازی و برش آلفا |
| :--- | :--- | :--- | :--- | :--- |
| `تصویر صفحه اصلی.webp` | [bg-home.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/bg-home.webp) | `1024×512` | `58.2 KB` | مقیاس به `1024px` (کاهش مصرف حافظهٔ GPU روی موبایل)، WebP کیفیت `74` |
| `تصویر صفحه کارها.jpg` | [bg-tasks.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/bg-tasks.webp) | `1024×576` | `20.5 KB` | مقیاس به `1024px`، WebP کیفیت `74` |
| `تصویر فوکوس.jpg` | [bg-focus.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/bg-focus.webp) | `1024×576` | `20.6 KB` | مقیاس به `1024×576`، WebP کیفیت `74` |
| کلبهٔ کتابخانه (تولیدشده و بهینه‌شده) | [bg-library.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/bg-library.webp) | `1024×572` | `32.7 KB` | پس‌زمینهٔ اختصاصی صفحهٔ **کتابخانه (`#page-library`)** — دیکد تنبل فقط هنگام بازشدن کتابخانه |
| `بافت.jpg` | [tex-grunge.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/tex-grunge.webp) | `540×360` | `23.3 KB` | **`RGBA` شفاف:** آلفای پخته‌شده برای حذف کامل `mix-blend-mode` و جلوگیری از readback فریم‌بوفر GPU |
| `ضبط صوت.png` | [prop-recorder.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/prop-recorder.webp) | `420×336` | `17.8 KB` | **`RGBA` شفاف:** Flood-Fill از گوشه‌ها + لبه‌نرم‌سازی آلفا بدون قاب مشکی |
| `گیاه درمانی.jpg` | [prop-med.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/prop-med.webp) | `420×336` | `9.5 KB` | **`RGBA` شفاف:** Flood-Fill از گوشه‌ها + لبه‌نرم‌سازی آلفا بدون قاب مشکی |
| تلفن دوار زوئی (تولیدشده و بهینه‌شده) | [prop-phone.webp](file:///d:/Project/NewDaftrche/assets/worlds/re7/prop-phone.webp) | `340×239` | `15.8 KB` | **`RGBA` شفاف:** Flood-Fill دقیق + بستن سایهٔ زیر بدنه + برش فشرده برای تماس تلفنی زوئی |

---

## ۲. غوطه‌وری کامل در دنیای RE7 و مهندسی پرفورمنس (۶۰fps)

- **موسیقی اتاق سیو (روشن در ابتدا + قابل لغو با یک کلیک):**
  - سنتز سبک Web Audio با الگوی کلاسیک گام `F#m` و سرعت `76 BPM` (سلستا + پد نرم مرداب لوئیزیانا) به‌صورت پیش‌فرض در ورود فعال است (و اگر مرورگر پیش از تعامل کاربر `AudioContext` را معلق نگه دارد، با اولین لمس/کلید به‌آرامی محو-پخش می‌شود). با دکمهٔ **`♪ BGM ON/OFF`** قابل خاموش/روشن شدن بوده و با مخفی‌شدن تب (`visibilitychange`) یا خروج از تم فوراً قطع می‌شود.
- **دیالوگ‌های موقعیت‌محور، تلفن زوئی و پرونده‌های `FILES`:**
  - `selectBakerDialogue` نجوای زندهٔ بالای کارت را بر اساس وضعیت واقعی کارهای امروز (جک بیکر هنگام کار عقب‌افتاده، زوئی در کار فوری، ایتن/اتاق سیو در پیشرفت یا طلوع مرداب در وضعیت `SAFE`) تنظیم می‌کند.
  - ویجت **تلفن زوئی (`prop-phone.webp`)** با زنگ دوگانهٔ آنالوگ (`playPhoneRingSound`) راهنمایی خط‌تلفن زوئی را نمایش می‌دهد.
  - مودال `#re7TapeOverlay` دارای دو تب **«TAPES · نوارهای کاست»** (بافر ۵ نوار) و **«FILES · پرونده‌های عمارت»** (۵ پروندهٔ قفل‌شونده با پیشرفت روزانه) است.
- **طراحی دیالوگ‌ها و بهینه‌سازی سخت‌افزارهای ضعیف:**
  - استایل منوی بقاء RE7 روی `.confirm-card`، `.roll-card`، `.toast`، `.sheet` و `.frog-hero` بدون سایهٔ سنگین یا بلور اضافه اعمال شده است.
  - صفر `mix-blend-mode`، صفر `:has()`، صفر `mask-image`/`drop-shadow`، ایزولاسیون `#re7BackdropRoot` با `contain: strict`، `AudioContext` مشترک سشن (`getSharedAudioCtx`)، و پروفایل خودکار `data-re7-perf="lite"` روی دستگاه‌های کم‌رم/کم‌هسته.

---

## ۳. راستی‌آزمایی نهایی

- **تست‌های واحد (`node --test`):** با ۶ مجموعه تست کامل در [world-re7.test.mjs](file:///d:/Project/NewDaftrche/tests/world-re7.test.mjs)، تمام **۵۴۸ از ۵۴۸ تست پاس** شدند (`0` خطا، `0` تست ردشده).
- **راستی‌آزمایی مرورگر هدلس (`1280px` و `375px`):** بارگذاری هر ۸ فایل `.webp`، سوئیچ پس‌زمینه در امروز/کارها/تمرکز/کتابخانه، عملکرد `♪ BGM ON/OFF`، تماس تلفن زوئی، تب `FILES`، نبود کدکس در DOM، اسکرول افقی `۰` و پاک‌سازی کامل DOM هنگام خروج با `errors: []`.
