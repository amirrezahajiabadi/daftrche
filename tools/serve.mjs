/* ═══ Local Test Server for Daftarche ═══
   Serves static assets with exact MIME types and no-store cache headers.
   Supports custom port via argument or falls back to an open port.
*/

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const cleanPath = decodeURIComponent(url.pathname);
    const rel = (cleanPath === '/' || cleanPath === '') ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const filePath = join(ROOT, rel);
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
  }
});

const DEFAULT_PORT = parseInt(process.env.PORT || process.argv[2], 10) || 8080;

function listenOn(port) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n==============================================`);
    console.log(`  دفتَرچه — سرور تست محلی اجرا شد:`);
    console.log(`  صفحه اصلی:  http://localhost:${port}/`);
    console.log(`  صفحه تقویم: http://localhost:${port}/#calendar`);
    console.log(`==============================================\n`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`پورت ${port} مشغول بود؛ در حال تلاش روی پورت ${port + 1}...`);
      listenOn(port + 1);
    } else {
      console.error('خطای سرور:', err);
    }
  });
}

listenOn(DEFAULT_PORT);

