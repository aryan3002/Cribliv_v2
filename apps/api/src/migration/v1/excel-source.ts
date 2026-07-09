import { normalizeE164 } from "./phone";
const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const XLSX = requireFromApi("xlsx");

export function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Property Name (normalized) → E.164 phone, from the "Property Master" sheet. */
export function loadOwnerPhoneByName(excelPath: string): Map<string, string> {
  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets["Property Master"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const map = new Map<string, string>();
  for (const r of rows) {
    const name = normName(r["Property Name"]);
    const phone = normalizeE164(r["Owner Mobile"]);
    if (name && phone && !map.has(name)) map.set(name, phone);
  }
  return map;
}
