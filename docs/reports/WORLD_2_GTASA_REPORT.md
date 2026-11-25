# گزارش تکمیل دنیای دوم (Fun World 2/5): GTA: San Andreas — Grove Street (`gtasa-grove`)

## ۱. خلاصهٔ تغییرات و بیلد
- **نسخه و بیلد:** `v3.5.0` — ارتقای بیلد به **`v229`** در [version.js](file:///d:/Project/NewDaftrche/js/version.js) و [auth-client.js](file:///d:/Project/NewDaftrche/js/auth-client.js).
- **فایل‌های جدید:**
  - [world-gtasa-art.js](file:///d:/Project/NewDaftrche/js/world-gtasa-art.js): ماژول خالص هنر SVG اختصاصی دنیای سن آندریاس (بدون وابستگی خارجی و صفر کد hex خام).
  - [world-gtasa.js](file:///d:/Project/NewDaftrche/js/world-gtasa.js): منطق خالص آمار HUD، تشخیص رویداد `MISSION PASSED`، سنتز ۳نتی Web Audio و چرخهٔ حیات بدون نشت.
  - [world-gtasa.css](file:///d:/Project/NewDaftrche/css/world-gtasa.css): استایل ایزوله با دامنهٔ `html[data-world="gtasa-grove"]` و هندسهٔ منوی PS2.
  - [world-gtasa.test.mjs](file:///d:/Project/NewDaftrche/tests/world-gtasa.test.mjs): تست‌های واحد برای رجیستری `fun`، محاسبات HUD، پیش‌شرط `MISSION PASSED`، چرخهٔ حیات و محدودیت‌های GPU/CSS.
- **فایل‌های ویرایش‌شده:** [constants.js](file:///d:/Project/NewDaftrche/js/constants.js)، [base.css](file:///d:/Project/NewDaftrche/css/base.css)، [worlds.js](file:///d:/Project/NewDaftrche/js/worlds.js)، [backup.js](file:///d:/Project/NewDaftrche/js/backup.js)، [i18n.js](file:///d:/Project/NewDaftrche/js/i18n.js)، [index.html](file:///d:/Project/NewDaftrche/index.html)، [_headers](file:///d:/Project/NewDaftrche/_headers) و [sw.js](file:///d:/Project/NewDaftrche/sw.js) (`SHELL`).

---

## ۲. استراتژی دارایی‌های تصویری (Asset Strategy)
- برای حفظ سرعت بالا روی گوشی‌های ضعیف، کارکرد ۱۰۰٪ آفلاین و جلوگیری از وابستگی به لینک‌های خارجی یا تصاویر دارای واترمارک، به‌صورت عمدی از **مسیر جایگزین هنر SVG/CSS لایه‌بندی‌شده (`js/world-gtasa-art.js`)** استفاده شد (بدون دریافت هیچ فایل باینری خارجی):
  1. **صفحهٔ اصلی (`#today` و پیش‌فرض):** غروب طلایی-نارنجی به بنفش لوس سانتوس (`gtasaSunsetSky`)، سیلوئت مرکز شهر لوس سانتوس و درختان نخل گروو استریت (`renderGtasaHomeBackdropSvg`).
  2. **صفحهٔ کارها (`#page-tasks`):** شب مه‌آلود محله و شبکهٔ رادار تاکتیکی لوس سانتوس (`renderGtasaTasksBackdropSvg`).
  3. **صفحهٔ تمرکز و حالت ذِن (`#page-focus` و `#focusZenOverlay`):** اسکلهٔ شبانهٔ ساحل **Santa Maria Beach** با چرخ‌وفلک نورانی روی آب آرام (`renderGtasaBeachZenSvg` و `renderGtasaZenHudMarkup`).

---

## ۳. جزئیات منوی PS2 و ویژگی‌های امضای بازی
- **کارت کلاسیک HUD سن آندریاس در `#today`:**
  - نوار پیشرفت سبز زمردی **Respect** متناسب با کارهای انجام‌شدهٔ امروز.
  - شمارندهٔ امتیاز دلاری با فرمت کلاسیک `$000125` در `calcGtasaHudStats` ($150 به‌ازای هر کار، +$200 برای کارهای مهم، +$10 به‌ازای هر دقیقه تمرکز و +$25 برای ذخیره).
  - **فلاپی‌دیسک ذخیرهٔ بازی (`renderGtasaFloppyDiskSvg`):** کلیک روی دکمهٔ خونهٔ CJ با چیم Web Audio (`playSaveDiskChime`) نوتیفیکیشن «بازی ذخیره شد — خونه CJ» را ثبت می‌کند.
- **بنر شناور `MISSION PASSED! / RESPECT +`:**
  - گوش دادن تمیز به تغییرات `bus.js` (`shouldTriggerMissionPassed`) فقط هنگام فعال‌بودن `gtasa-grove`؛ در زمان تکمیل کار با اولویت بالا یا پایان جلسهٔ تمرکز، بنر طلایی-سفید به مدت `2.8s` همراه با افکت صوتی ۳نتی سنتز‌شده (`playMissionPassedChime`) ظاهر و به‌صورت ایمن محو می‌شود (با احترام کامل به `prefers-reduced-motion` و دکمهٔ `SFX ON/OFF`).

---

## ۴. نتایج تست‌ها و راستی‌آزمایی
- **مجموعهٔ کامل تست (`node --test`):** پیش از World 2 تعداد ۵۴۸ تست وجود داشت؛ با افزودن تست‌های [world-gtasa.test.mjs](file:///d:/Project/NewDaftrche/tests/world-gtasa.test.mjs)، مجموعهٔ کامل با صفر خطا و صفر تست ردشده پاس شد.
- **راستی‌آزمایی مرورگر هدلس (`1280px` و `375px`):** بررسی نمای دسکتاپ و موبایل، سوئیچ خودکار صحنه‌های غروب/رادار/ساحل سانتا ماریا، ثبت ذخیرهٔ خونه CJ، نمایش بنر `MISSION PASSED! / RESPECT +` هنگام تکمیل کار فوری، نبود اسکرول افقی و پاک‌سازی کامل DOM هنگام خروج.
