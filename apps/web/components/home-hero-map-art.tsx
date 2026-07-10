// Stylized dusk street-map backdrop for the listening hero. Pure decoration
// (aria-hidden) — the real geography lives in the pin layer, which projects
// actual listing coordinates. Drawn as inline SVG so it ships with zero
// network cost and no Maps billing; loosely shaped after Lucknow (the Gomti
// sweeping NW→SE, radial arterials, a ring road) so it reads as a city, not
// a texture. If a Google Static Maps asset lands later it can replace this,
// but this is designed to be good enough that it doesn't have to.

const BLOCK_CLUSTERS: Array<{ x: number; y: number; w: number; h: number; o: number }> = [
  { x: 90, y: 120, w: 150, h: 90, o: 0.5 },
  { x: 270, y: 80, w: 110, h: 130, o: 0.4 },
  { x: 150, y: 300, w: 190, h: 120, o: 0.55 },
  { x: 420, y: 200, w: 140, h: 100, o: 0.45 },
  { x: 380, y: 420, w: 170, h: 140, o: 0.5 },
  { x: 620, y: 120, w: 120, h: 90, o: 0.4 },
  { x: 640, y: 320, w: 180, h: 130, o: 0.55 },
  { x: 610, y: 560, w: 150, h: 100, o: 0.45 },
  { x: 880, y: 200, w: 160, h: 110, o: 0.5 },
  { x: 920, y: 430, w: 190, h: 140, o: 0.55 },
  { x: 1150, y: 130, w: 140, h: 100, o: 0.4 },
  { x: 1180, y: 350, w: 160, h: 120, o: 0.5 },
  { x: 1120, y: 600, w: 180, h: 110, o: 0.45 },
  { x: 260, y: 560, w: 140, h: 110, o: 0.4 },
  { x: 850, y: 660, w: 150, h: 100, o: 0.4 }
];

export function HomeHeroMapArt() {
  return (
    <svg
      className="hero-listen__art"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="hero-map-bg" cx="50%" cy="38%" r="85%">
          <stop offset="0%" stopColor="#13203A" />
          <stop offset="55%" stopColor="#0E1930" />
          <stop offset="100%" stopColor="#0A1222" />
        </radialGradient>
        <linearGradient id="hero-map-river" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#173A56" />
          <stop offset="100%" stopColor="#12293F" />
        </linearGradient>
        <pattern id="hero-map-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.2" fill="rgba(148,180,255,0.05)" />
        </pattern>
      </defs>

      <rect width="1440" height="900" fill="url(#hero-map-bg)" />

      {/* district blocks */}
      <g fill="#121E38">
        {BLOCK_CLUSTERS.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="10" opacity={b.o} />
        ))}
      </g>

      {/* minor street grid */}
      <g stroke="#1A2745" strokeWidth="1.6" opacity="0.75" fill="none">
        <path d="M0 190 C 240 176 520 210 780 188 S 1240 150 1440 172" />
        <path d="M0 330 C 300 348 560 300 860 332 S 1260 372 1440 348" />
        <path d="M0 480 C 260 460 540 506 820 478 S 1220 440 1440 468" />
        <path d="M0 640 C 280 664 560 610 880 646 S 1260 690 1440 660" />
        <path d="M0 790 C 320 770 620 812 940 786 S 1280 752 1440 776" />
        <path d="M140 0 C 128 240 168 520 148 900" />
        <path d="M330 0 C 352 260 312 560 340 900" />
        <path d="M540 0 C 522 220 562 500 538 900" />
        <path d="M760 0 C 782 240 742 540 772 900" />
        <path d="M1010 0 C 992 260 1032 560 1002 900" />
        <path d="M1230 0 C 1252 240 1212 520 1244 900" />
      </g>

      {/* arterial roads */}
      <g stroke="#25355C" strokeWidth="4.5" strokeLinecap="round" opacity="0.9" fill="none">
        <path d="M0 260 C 320 232 640 292 960 252 S 1300 210 1440 240" />
        <path d="M0 560 C 300 592 660 520 980 568 S 1300 620 1440 588" />
        <path d="M250 0 C 274 300 226 620 262 900" />
        <path d="M900 0 C 872 280 928 600 886 900" />
        <path d="M1160 0 C 1188 300 1136 640 1176 900" />
      </g>

      {/* ring road */}
      <path
        d="M 430 150
           C 700 90 1030 130 1160 300
           C 1260 440 1230 640 1010 730
           C 780 820 470 790 340 630
           C 230 490 260 240 430 150 Z"
        stroke="#293A64"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.55"
        fill="none"
      />

      {/* city-core arterials (west/center, where listings cluster) */}
      <g stroke="#2A3B66" strokeWidth="3.5" strokeLinecap="round" opacity="0.85" fill="none">
        <path d="M 180 700 C 330 600 430 520 560 470 C 660 432 740 380 800 300" />
        <path d="M 240 380 C 360 430 470 540 560 660" />
        <path d="M 420 300 C 470 420 480 560 450 720" />
      </g>

      {/* the Gomti */}
      <path
        d="M 300 -40 C 420 140 560 220 700 260 C 900 316 1010 420 1060 560 C 1104 682 1180 790 1320 940"
        stroke="url(#hero-map-river)"
        strokeWidth="30"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 300 -40 C 420 140 560 220 700 260 C 900 316 1010 420 1060 560 C 1104 682 1180 790 1320 940"
        stroke="#1E4364"
        strokeWidth="9"
        strokeLinecap="round"
        opacity="0.65"
        fill="none"
      />

      {/* faint locality names — the CriblMap-at-dusk signature */}
      <g
        fill="rgba(150, 182, 255, 0.16)"
        fontSize="15"
        fontWeight="600"
        letterSpacing="0.22em"
        fontFamily="inherit"
      >
        <text x="330" y="560">
          HAZRATGANJ
        </text>
        <text x="560" y="420">
          GOMTI NAGAR
        </text>
        <text x="250" y="250">
          ALIGANJ
        </text>
        <text x="700" y="180">
          INDIRA NAGAR
        </text>
        <text x="220" y="800">
          ALAMBAGH
        </text>
        <text x="950" y="640">
          SUSHANT GOLF CITY
        </text>
      </g>

      {/* faint dot texture on top */}
      <rect width="1440" height="900" fill="url(#hero-map-dots)" />
    </svg>
  );
}
