/* ═══ World 2 Bespoke Inline SVG Art: GTA: San Andreas — Grove Street ═══
   Zero external images, zero raw hex codes, zero top-level DOM side effects.
   Provides:
   1. Home (`#today` / default): Los Santos golden-orange-to-violet sunset + palms + Downtown skyline
   2. Tasks (`#tasks`): Moody dusk Grove Street cul-de-sac + Los Santos radar street grid
   3. Focus & Zen Mode (`#focus` / `#focusZenOverlay`): Serene Santa Maria Beach Pier + Ferris Wheel
   4. Grove Street Safe House Save Floppy Disk SVG & Respect Shield Crest */

/**
 * Home backdrop: Los Santos PS2 golden-orange-to-purple sunset with Downtown skyline & palms.
 * @returns {string}
 */
export function renderGtasaHomeBackdropSvg() {
  return `
    <svg class="gtasa-scene-svg gtasa-scene-home" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="gtasaSunsetSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(18,12,34)"/>
          <stop offset="34%" stop-color="rgb(78,28,62)"/>
          <stop offset="68%" stop-color="rgb(198,92,28)"/>
          <stop offset="100%" stop-color="rgb(245,176,65)"/>
        </linearGradient>
        <radialGradient id="gtasaSunHalo" cx="62%" cy="54%" r="32%">
          <stop offset="0%" stop-color="rgb(255,214,112)" stop-opacity="0.72"/>
          <stop offset="45%" stop-color="rgb(245,148,44)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="rgb(245,148,44)" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="gtasaHazeFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(13,17,14)" stop-opacity="0.28"/>
          <stop offset="60%" stop-color="rgb(13,17,14)" stop-opacity="0.62"/>
          <stop offset="100%" stop-color="rgb(10,14,11)" stop-opacity="0.96"/>
        </linearGradient>
      </defs>

      <rect width="1200" height="720" fill="url(#gtasaSunsetSky)"/>
      <rect width="1200" height="720" fill="url(#gtasaSunHalo)"/>
      <circle cx="744" cy="392" r="88" fill="rgb(255,208,104)" fill-opacity="0.46"/>

      <!-- Vinewood foothills ridge -->
      <path d="M0 442 Q150 388 300 422 T640 404 T980 424 L1200 398 L1200 720 L0 720 Z" fill="rgb(24,18,32)" fill-opacity="0.62"/>

      <!-- Downtown Los Santos Skyline (US Bank / Maze Bank cylindrical tower silhouette) -->
      <g fill="rgb(13,15,17)" fill-opacity="0.88">
        <rect x="210" y="388" width="54" height="170"/>
        <rect x="278" y="346" width="44" height="212"/>
        <rect x="336" y="405" width="68" height="153"/>
        <rect x="424" y="312" width="48" height="246"/>
        <!-- Iconic tiered cylindrical tower -->
        <rect x="488" y="218" width="66" height="340" rx="4"/>
        <rect x="498" y="196" width="46" height="24"/>
        <rect x="512" y="176" width="18" height="22"/>
        <rect x="568" y="330" width="56" height="228"/>
        <rect x="640" y="366" width="44" height="192"/>
        <rect x="812" y="358" width="52" height="200"/>
        <rect x="878" y="392" width="66" height="166"/>
      </g>

      <!-- Warm golden horizon glow strips on skyline -->
      <g fill="rgb(245,176,65)" fill-opacity="0.28">
        <rect x="504" y="236" width="4" height="18"/>
        <rect x="520" y="236" width="4" height="18"/>
        <rect x="536" y="236" width="4" height="18"/>
        <rect x="440" y="330" width="5" height="14"/>
        <rect x="586" y="348" width="6" height="14"/>
      </g>

      <!-- Grove Street silhouettes & California Washingtonia Palms -->
      <g fill="rgb(9,13,10)" fill-opacity="0.95">
        <rect x="0" y="534" width="1200" height="186"/>
        <!-- Left tall palms -->
        <path d="M118 548 Q126 370 144 218 L153 220 Q138 370 132 548 Z"/>
        <path d="M148 220 C110 198 76 212 52 246 C86 228 118 222 148 226 Z"/>
        <path d="M148 218 C122 178 144 150 186 156 C158 176 150 198 148 218 Z"/>
        <path d="M149 220 C186 198 222 214 238 248 C206 230 176 224 149 226 Z"/>
        <path d="M146 224 C106 232 76 266 72 296 C100 268 124 244 146 232 Z"/>

        <!-- Right Grove Street twin palms -->
        <path d="M1054 548 Q1038 390 1018 232 L1009 234 Q1026 390 1040 548 Z"/>
        <path d="M1014 234 C976 210 940 226 918 258 C952 240 982 236 1014 240 Z"/>
        <path d="M1014 232 C1000 188 1036 162 1072 178 C1044 192 1026 210 1014 232 Z"/>
        <path d="M1016 236 C1054 220 1088 242 1102 276 C1070 254 1042 244 1016 242 Z"/>
        <path d="M1012 240 C980 258 958 290 956 320 C978 286 998 258 1012 246 Z"/>
      </g>

      <rect width="1200" height="720" fill="url(#gtasaHazeFade)"/>
    </svg>`;
}

/**
 * Tasks backdrop: Moody dusk/night Grove Street + Los Santos tactical radar map grid.
 * @returns {string}
 */
export function renderGtasaTasksBackdropSvg() {
  return `
    <svg class="gtasa-scene-svg gtasa-scene-tasks" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="gtasaRadarBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(10,16,12)"/>
          <stop offset="100%" stop-color="rgb(14,24,18)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="720" fill="url(#gtasaRadarBg)"/>

      <!-- Los Santos Street Grid & Grove Cul-de-Sac Waypoint Lines -->
      <g stroke="rgb(63,185,100)" stroke-opacity="0.11" fill="none" stroke-width="1.4">
        <path d="M0 160 H1200 M0 320 H1200 M0 480 H1200"/>
        <path d="M220 0 V720 M480 0 V720 M760 0 V720 M1000 0 V720"/>
        <path d="M100 0 L840 720 M1120 40 L420 720" stroke-opacity="0.08"/>
        <!-- Grove Street Cul-de-sac Circle -->
        <circle cx="600" cy="370" r="140" stroke-opacity="0.14" stroke-width="2"/>
        <circle cx="600" cy="370" r="84" stroke-dasharray="8 8" stroke-opacity="0.16"/>
        <line x1="600" y1="510" x2="600" y2="720" stroke-width="2.5" stroke-opacity="0.16"/>
      </g>

      <!-- Subtle Sunset Horizon Glow at street end -->
      <ellipse cx="600" cy="700" rx="520" ry="180" fill="rgb(63,185,100)" fill-opacity="0.08"/>
    </svg>`;
}

/**
 * Focus & Zen backdrop: Serene nighttime Santa Maria Beach Pier with glowing Ferris Wheel.
 * @returns {string}
 */
export function renderGtasaBeachZenSvg() {
  return `
    <svg class="gtasa-scene-svg gtasa-scene-beach" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="gtasaBeachSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(7,10,20)"/>
          <stop offset="64%" stop-color="rgb(22,18,44)"/>
          <stop offset="100%" stop-color="rgb(54,32,62)"/>
        </linearGradient>
        <radialGradient id="gtasaPierGlow" cx="72%" cy="56%" r="24%">
          <stop offset="0%" stop-color="rgb(245,176,65)" stop-opacity="0.28"/>
          <stop offset="55%" stop-color="rgb(63,185,100)" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="rgb(10,14,22)" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <rect width="1200" height="720" fill="url(#gtasaBeachSky)"/>
      <rect width="1200" height="720" fill="url(#gtasaPierGlow)"/>

      <!-- Subtle calm night ocean horizon -->
      <rect x="0" y="505" width="1200" height="215" fill="rgb(6,10,18)" fill-opacity="0.92"/>
      <g stroke="rgb(245,176,65)" stroke-opacity="0.24" stroke-width="1.6" stroke-linecap="round">
        <line x1="810" y1="538" x2="906" y2="538"/>
        <line x1="825" y1="564" x2="892" y2="564"/>
        <line x1="842" y1="590" x2="878" y2="590"/>
      </g>

      <!-- Santa Maria Pier deck & pilings -->
      <g fill="rgb(10,13,18)">
        <rect x="580" y="478" width="460" height="14"/>
        <rect x="610" y="492" width="10" height="36"/>
        <rect x="690" y="492" width="10" height="36"/>
        <rect x="770" y="492" width="10" height="36"/>
        <rect x="850" y="492" width="10" height="36"/>
        <rect x="930" y="492" width="10" height="36"/>
        <rect x="1005" y="492" width="10" height="36"/>
      </g>

      <!-- Pacific Park Ferris Wheel on Pier -->
      <g fill="none" stroke-linecap="round">
        <circle cx="858" cy="378" r="82" stroke="rgb(245,176,65)" stroke-opacity="0.58" stroke-width="2.6"/>
        <circle cx="858" cy="378" r="64" stroke="rgb(63,185,100)" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="6 10"/>
        <path d="M858 378 L818 478 M858 378 L898 478 M798 378 H918 M858 296 V460 M800 320 L916 436 M916 320 L800 436" stroke="rgb(20,26,34)" stroke-width="2"/>
        <circle cx="858" cy="378" r="7" fill="rgb(245,176,65)" fill-opacity="0.85"/>
      </g>
    </svg>`;
}

/**
 * Renders the iconic glowing Grove Street Safe House Save Floppy Diskette SVG.
 * @returns {string}
 */
export function renderGtasaFloppyDiskSvg() {
  return `
    <svg class="gtasa-disk-svg" viewBox="0 0 44 44" aria-hidden="true">
      <!-- Outer beveled dark emerald floppy casing -->
      <path class="gtasa-disk-body" d="M6 4h28l6 6v30H6V4z"/>
      <!-- Metallic top shutter window -->
      <rect class="gtasa-disk-shutter" x="13" y="4" width="17" height="12" rx="1"/>
      <rect class="gtasa-disk-notch" x="24" y="6" width="3.5" height="8"/>
      <!-- Classic Grove Street label block -->
      <rect class="gtasa-disk-label" x="10" y="22" width="24" height="15" rx="1.5"/>
      <line class="gtasa-disk-line" x1="13" y1="27" x2="31" y2="27"/>
      <line class="gtasa-disk-line" x1="13" y1="32" x2="26" y2="32"/>
    </svg>`;
}

/**
 * Renders Grove Street Crest icon for the HUD header.
 * @returns {string}
 */
export function renderGtasaGroveCrestSvg() {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l7 4v6c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-4z"/><path d="M12 7l1.5 3.1 3.4.5-2.5 2.4.6 3.4L12 14.8 9 16.4l.6-3.4L7.1 10.6l3.4-.5z"/></svg>`;
}

/**
 * Renders Zen Mode HUD framing (Santa Maria Pier scene + corner Los Santos reticle).
 * @returns {string}
 */
export function renderGtasaZenHudMarkup() {
  return `
    ${renderGtasaBeachZenSvg()}
    <div class="gtasa-zen-frame">
      <div class="gtasa-zen-top">
        <span class="gtasa-zen-loc">SANTA MARIA BEACH · LS</span>
        <span class="gtasa-zen-tag">GROVE ST. FOCUS</span>
      </div>
      <div class="gtasa-zen-foot">NO HUD DISTRACTIONS · LOCKED IN</div>
    </div>`;
}
