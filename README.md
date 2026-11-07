# Daftarche

Daftarche is a Persian, offline-first notebook for tasks, focus sessions and reading —
Jalali calendar, right-to-left throughout, and no runtime dependencies.
Everything lives on the device in `localStorage` and IndexedDB, so it works with the
network gone; an optional Node server in `server/` adds Web Push reminders.
It is a single static PWA: open `index.html` over any static server, or install it
from the browser. Tests run with `node --test` (no setup, no build step).

## Project layout

| Path | What it holds |
|---|---|
| `index.html`, `sw.js`, `manifest.webmanifest` | The app shell: entry document, offline service worker, install manifest |
| `js/` | ES modules — state, views, Jalali calendar, storage (no build step) |
| `css/` | Hand-written styles; every colour token lives in `css/base.css` |
| `assets/` | Shipped fonts, icons, character art and the vendored pdf.js runtime |
| `docs/` | Architecture, design system, roadmap, platform guides, and `screenshots/` |
| `tests/` | `node --test` suites (`*.test.mjs`) |
| `scripts/`, `tools/` | Icon and character pipelines, `www/` build, screenshot and APK tooling |
| `www/` | Generated Capacitor web root — rebuild with `npm run build:www` |
| `android/` | Capacitor Android project |
| `server/` | Optional Web Push backend (off by default) |
| `archive/` | Retired source assets worth keeping; see `archive/README.md` |

## Contributing

Start with `docs/design.md` for the architecture and the release rules. Keep changes
small and in the project's voice: Persian copy, logical CSS properties, colour tokens
instead of raw hex, and user text escaped through `esc()`. Before opening a change, run
`node --test` — it must stay green — and bump `BUILD` in `js/version.js` for any shell
file you touched, then add the release note to `CHANGELOG.md` and `js/changelog.js`.
