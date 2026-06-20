// Fetch the Cribliv brand fonts (Inter + Manrope, latin subset) as self-hosted
// woff2 from Google Fonts (both OFL-licensed), matching apps/web's next/font
// config, and emit a self-contained @font-face stylesheet for design-sync's
// cfg.extraFonts. Output: .design-sync/fonts/{*.woff2, cribliv-fonts.css}.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OUT = ".design-sync/fonts";
mkdirSync(OUT, { recursive: true });

// Weights match apps/web/app/layout.tsx next/font/google config.
const families = [
  { name: "Inter", weights: [400, 500, 600, 700] },
  { name: "Manrope", weights: [500, 600, 700, 800] }
];

const faceRules = [];
for (const fam of families) {
  const url = `https://fonts.googleapis.com/css2?family=${fam.name}:wght@${fam.weights.join(";")}&display=swap`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`css fetch failed ${fam.name}: ${res.status}`);
  const css = await res.text();
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const ur = (body.match(/unicode-range:\s*([^;]+);/) || [])[1] || "";
    if (!ur.includes("U+0000-00FF")) continue; // latin block only
    const weight = (body.match(/font-weight:\s*([0-9]+)/) || [])[1];
    const style = (body.match(/font-style:\s*([a-z]+)/) || [])[1] || "normal";
    const srcUrl = (body.match(/src:\s*url\(([^)]+)\)/) || [])[1];
    if (!weight || !srcUrl) continue;
    const fres = await fetch(srcUrl.replace(/['"]/g, ""), { headers: { "User-Agent": UA } });
    if (!fres.ok) throw new Error(`woff2 fetch failed ${fam.name} ${weight}: ${fres.status}`);
    const buf = Buffer.from(await fres.arrayBuffer());
    const fname = `${fam.name}-${weight}.woff2`;
    writeFileSync(join(OUT, fname), buf);
    faceRules.push(
      `@font-face {\n  font-family: '${fam.name}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('./${fname}') format('woff2');\n}`
    );
    console.error(`  ${fam.name} ${weight} -> ${fname} (${buf.length} bytes)`);
  }
}

const header =
  "/* Cribliv brand fonts -- Inter (body) + Manrope (headings).\n" +
  "   Self-hosted woff2 (latin subset) from Google Fonts (OFL), matching\n" +
  "   apps/web next/font/google config. Shipped via design-sync cfg.extraFonts. */\n";
writeFileSync(join(OUT, "cribliv-fonts.css"), header + faceRules.join("\n\n") + "\n");
console.error(`\nwrote ${OUT}/cribliv-fonts.css with ${faceRules.length} @font-face rules`);
if (faceRules.length !== 8) throw new Error(`expected 8 faces, got ${faceRules.length}`);
