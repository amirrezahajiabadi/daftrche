# آرشیو — دارایی‌های بازنشسته

این پوشه فقط برای نگه‌داشتن اطلاعات است، نه برای بارگذاری در برنامه. هیچ‌کدام از فایل‌های اینجا در
`SHELL` در `sw.js` یا `index.html` نیستند، پس حذف‌شان رفتار برنامه را عوض نمی‌کرد؛ به‌جای حذف،
نسخهٔ اصلی نگه داشته شد تا تاریخ طراحی و خط تولید آیکون/کاراکتر قابل بازبینی بماند.

| مسیر در آرشیو | جای اصلی | چرا بازنشسته شد |
|---|---|---|
| `fonts/Bricolage_Grotesque/` | `assets/fonts/` | هیچ‌جای CSS، JS یا HTML این خانوادهٔ قلم را نمی‌خواند؛ رابط فقط از Estedad استفاده می‌کند. |
| `fonts/Manrope/` | `assets/fonts/` | همان وضعیت؛ قلم لاتین بی‌استفاده از یک بازطراحی قبلی. |
| `characters/qorqori.svg` | `assets/characters/qorqori/` | اسپرایت قدیمی قورقوری. اپ `qorqori.png` را می‌خواند و `tests/character.test.mjs` مطمئن می‌شود هیچ فایلی به این SVG اشاره نکند. |
| `icons/master-logo-dark.jpg` | `assets/icons/` | نسخهٔ تیرهٔ مستر آیکون؛ خط تولید `scripts/generate-icons.py` فقط `master-logo.jpg` را می‌خواند. |
| `notes/theme-redesign-notes.md` | ریشهٔ پروژه | یادداشت موقتِ Working Copy دربارهٔ بازطراحی تم‌ها. محتوای منتشرشدهٔ همان تغییر در `CHANGELOG.md` و `js/changelog.js` ثبت شده است. |

## بازگرداندن

ستون دوم هر ردیف جای اصلی فایل است؛ فایل را به همان مسیر برگردانید. دو نکته:

- اگر قلمی دوباره در رابط استفاده شد، هم `@font-face` در `css/base.css` و هم ورودی‌اش در `SHELL`
  (`sw.js`) لازم است، وگرنه نسخهٔ آفلاین آن را ندارد.
- اگر `qorqori.svg` برگشت، تست `tests/character.test.mjs` می‌شکند؛ آن تست عمداً تضمین می‌کند
  اسپرایت بازنشسته برنگردد.

## کپی‌های عمدی که حذف نشدند

این‌ها شبیه هم هستند ولی هر کدام جای خودشان را در خط تولید دارند:

| کپی | چرا هر دو می‌مانند |
|---|---|
| `assets/icons/icon-512.png` = `assets/icons/daftarche-squircle.png` | بایت‌به‌بایت یکی‌اند، چون `scripts/generate-icons.py` هر دو را از همان کاتاوت شفاف می‌سازد. اولی در `manifest.webmanifest` لازم است و دومی مستر دسکتاپ است. |
| `assets/icons/android/mipmap-*/` = `android/app/src/main/res/mipmap-*/` | اندروید آیکون را فقط از `res/` برمی‌دارد؛ اولی خروجی خط تولید است و دومی کپی لازم پلتفرم. |
| `www/` و `android/app/src/main/assets/public/` | خروجی ساخت (`npm run build:www` و `cap sync`). `tests/android.test.mjs` به `www/build-info.json` تکیه دارد، پس این‌ها باید سر جایشان بمانند. |
