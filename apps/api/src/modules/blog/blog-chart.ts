import type { BlogDataPoint } from "./blog.types";

// Inline-SVG "Data Desk" chart baked into a post's body at generation time:
// server-rendered, crawlable, zero client JS, and portable (renders the same in
// the public article and the admin preview). All colours are inline so it does
// not depend on any stylesheet.

const RED = "#c2301c";
const INK = "#1c1b17";
const SOFT = "#6b6659";
const RULE = "#e2ddd0";

export interface ChartBar {
  label: string;
  value: number;
}

const RENT_LABELS: Record<string, string> = {
  median_rent_1bhk: "1 BHK",
  median_rent_2bhk: "2 BHK",
  median_rent_3bhk: "3 BHK",
  median_rent_pg: "PG"
};
const RENT_ORDER = ["median_rent_1bhk", "median_rent_2bhk", "median_rent_3bhk", "median_rent_pg"];

// Pull the rent-median facts (the values that share a ₹/mo unit) into ordered
// chart bars. Counts and other facts are ignored here.
export function rentBarsFromFacts(facts: BlogDataPoint[]): ChartBar[] {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const bars: ChartBar[] = [];
  for (const key of RENT_ORDER) {
    const fact = byKey.get(key);
    if (fact && typeof fact.value === "number" && fact.value > 0) {
      bars.push({ label: RENT_LABELS[key], value: fact.value });
    }
  }
  return bars;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      default:
        return "&quot;";
    }
  });
}

// Indian digit grouping (12,34,567) without relying on Intl/ICU, so output is
// deterministic across runtimes and tests.
function groupIndian(n: number): string {
  const s = String(Math.round(n));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}
function rupees(v: number): string {
  return `₹${groupIndian(v)}`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function buildRentChartSvg(bars: ChartBar[], title: string): string {
  if (bars.length === 0) return "";
  const W = 660;
  const H = 380;
  const padL = 20;
  const padR = 20;
  const padT = 64;
  const padB = 58;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const top = niceCeil(Math.max(...bars.map((b) => b.value)));
  const slot = plotW / bars.length;
  const barW = Math.min(slot * 0.56, 92);

  let grid = "";
  for (let i = 0; i <= 4; i += 1) {
    const gy = padT + plotH - (plotH * i) / 4;
    const gv = (top * i) / 4;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`;
    grid += `<text x="${padL}" y="${(gy - 5).toFixed(1)}" font-size="11" fill="${SOFT}" font-family="system-ui,sans-serif">${i === 0 ? "0" : rupees(gv)}</text>`;
  }

  let barsSvg = "";
  bars.forEach((b, i) => {
    const h = (b.value / top) * plotH;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + plotH - h;
    const cx = (x + barW / 2).toFixed(1);
    barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${RED}"/>`;
    barsSvg += `<text x="${cx}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-size="17" font-weight="700" fill="${INK}" font-family="Georgia,serif">${rupees(b.value)}</text>`;
    barsSvg += `<text x="${cx}" y="${(padT + plotH + 22).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}" font-family="system-ui,sans-serif">${escapeXml(b.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto;display:block" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}"><text x="${padL}" y="26" font-size="12" letter-spacing="1.4" font-weight="700" fill="${RED}" font-family="system-ui,sans-serif">CRIBLIV TIMES · DATA DESK</text><text x="${padL}" y="48" font-size="19" font-weight="700" fill="${INK}" font-family="Georgia,serif">${escapeXml(title)}</text>${grid}<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${INK}" stroke-width="1.5"/>${barsSvg}</svg>`;
}
