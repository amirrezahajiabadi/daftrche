# Theme redesign — Working Copy notes

## Scope
This is a local Working Copy based on the supplied project archive. No production files were changed and nothing was deployed.

## Changes
- Added the new always-available light theme `daftarche` and made it the default for new or unconfigured sessions.
- Kept the existing `kashi`, `cobalt`, and `aurora` palette values unchanged.
- Redesigned `lajvard` around mineral blue and muted brass.
- Redesigned `graphite` around warm charcoal and muted earth tones.
- Changed only the accent family of `rasadkhane` to a restrained sky-cyan to distinguish it from `shabgard`.
- Added a very subtle notebook ruling to the open canvas of `daftarche`.
- Updated the theme boot script, CSP hash, manifest colors, theme-count copy, design documentation, and theme tests.
- Rebuilt `www/` and synchronized the web assets in the Android source tree.

## Verification
- `node --test`: 357 tests passed.
- Theme tests include palette completeness, theme registration, boot fallback, and contrast floors.
- Browser regression checks were not run because Playwright is not installed in this environment.

## Important
The palette choices are a first implementation pass, not a substitute for visual review on real devices. Existing users with an explicitly stored theme retain that choice; `daftarche` is the default when no valid theme is stored. Production remains unchanged until this Working Copy is reviewed and manually promoted.
