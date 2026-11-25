# راهنمای استقرار تولید فاز ۲ دَفتَرچه (Single-Origin Nginx + Express/SQLite)

این سند پیکربندی پیشنهادی برای اجرای همزمان PWA استاتیک دَفتَرچه و بک‌اند واحد `server/api-server.js` (شامل Auth، Sync و Web Push) را روی یک سرور لینوکسی (مثلاً سرورهای ابری ایران) ارائه می‌دهد.

---

## ۱. معماری تک‌مبدأ (Single-Origin Architecture)

با قرار دادن فایل‌های PWA و اندپوینت‌های `/api/*` زیر یک دامنهٔ واحد از طریق Nginx:
- سیاست امنیتی **`connect-src 'self'`** در `index.html` و `_headers` بدون هیچ‌گونه تضعیف CSP یا باز کردن CORS روی دامنه‌های اضافی، دست‌نخورده باقی می‌ماند.
- مرورگر و سرویس‌ورکر درخواست‌های `/api/*` را مستقیماً به پروکسی داخلی Nginx می‌فرستند و بدون Preflight اضافه به `127.0.0.1:3200` هدایت می‌شوند.

---

## ۲. پیکربندی آمادهٔ Nginx

فایل نمونه (مثلاً `/etc/nginx/sites-available/daftarche.conf`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name daftarche.example.ir;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name daftarche.example.ir;

    ssl_certificate     /etc/letsencrypt/live/daftarche.example.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/daftarche.example.ir/privkey.pem;

    root /var/www/daftarche;
    index index.html;

    # Security Headers (matching _headers)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-uuLviIUb4Z+V6R8OTnu+USC8c1YWkwfXRr1yJ63pNhA='; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob: data:; connect-src 'self'; frame-src blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" always;

    # Service Worker & HTML must never be stale-cached by HTTP proxy
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        try_files $uri =404;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        try_files $uri =404;
    }

    # Immutable static assets
    location ~* ^/(assets|css|js)/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    # Unified Node.js + SQLite API (Auth, Sync, Push)
    location /api/ {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 300k;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## ۳. متغیرهای محیطی تولید (`server/api-server.js`)

تمام اسرار و تنظیمات محیطی باید فقط از طریق محیط (مانند `systemd` `EnvironmentFile` یا `.env` خارج از مخزن Git) تزریق شوند:

| متغیر | الزامی؟ | پیش‌فرض | توضیح |
| :--- | :---: | :---: | :--- |
| `PORT` | خیر | `3200` | پورت لوکال سرویس `api-server.js` پشت Nginx |
| `NODE_ENV` | بله | `development` | در سرور تولید حتماً برابر `production` قرار گیرد |
| `ALLOWED_ORIGIN` | **بله (در production)** | — | مبدأ دقیق سایت، مثلاً `https://daftarche.example.ir` |
| `DB_PATH` | توصیه‌شده | `./daftarche.sqlite` | مسیر دائمی فایل SQLite (با مجوز نوشتن و پشتیبان‌گیری منظم) |
| `VAPID_PUBLIC_KEY` | برای Web Push | `null` | کلید عمومی VAPID ساخته‌شده با `npm run keys` در `server/` |
| `VAPID_PRIVATE_KEY` | برای Web Push | — | کلید خصوصی VAPID (محرمانه؛ فقط روی سرور، هرگز در کلاینت یا ریپو نه) |
| `VAPID_CONTACT` | توصیه‌شده | `mailto:admin@daftarche.app` | نشانی تماس استاندارد VAPID (ایمیل یا `https://`) |
| `ENABLE_REQUEST_LOG` | خیر | `true` | لاگ امن `method path status latency` بدون ثبت توکن، OTP یا متن کاربر |

---

## ۴. راه‌اندازی سرویس با Node.js و Systemd

```bash
# 1. نصب وابستگی‌های سرور (بدون نیاز به کامپایل C++)
cd server && npm ci --omit=dev

# 2. تولید کلیدهای VAPID (یک‌بار)
npm run keys

# 3. اجرای سرویس API
NODE_ENV=production \
PORT=3200 \
ALLOWED_ORIGIN=https://daftarche.example.ir \
DB_PATH=/var/lib/daftarche/daftarche.sqlite \
VAPID_PUBLIC_KEY=... \
VAPID_PRIVATE_KEY=... \
VAPID_CONTACT=mailto:ops@daftarche.example.ir \
node api-server.js
```

> **نکته:** برای ارسال زمان‌بندی‌شدهٔ اعلان‌های یادآوری سررسید کارها در پس‌زمینه، می‌توانید از `server/push-server.js` با `ADMIN_API_KEY` و کرون‌جاب یا ادغام با جدول `push_subscriptions` استفاده کنید.
