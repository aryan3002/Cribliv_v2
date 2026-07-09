export const CITY_SEED: Record<
  string,
  { name_en: string; name_hi: string; state_en: string; state_hi: string }
> = {
  gurugram: { name_en: "Gurugram", name_hi: "गुरुग्राम", state_en: "Haryana", state_hi: "हरियाणा" },
  lucknow: {
    name_en: "Lucknow",
    name_hi: "लखनऊ",
    state_en: "Uttar Pradesh",
    state_hi: "उत्तर प्रदेश"
  },
  varanasi: {
    name_en: "Varanasi",
    name_hi: "वाराणसी",
    state_en: "Uttar Pradesh",
    state_hi: "उत्तर प्रदेश"
  }
};

/** v1 free-text city → canonical v2 slug (trims the "Lucknow " variant). */
export function normalizeCitySlug(rawCity: string): string | null {
  const key = (rawCity ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const direct = key.replace(/\s+/g, "");
  if (CITY_SEED[direct]) return direct;
  const byName = Object.entries(CITY_SEED).find(
    ([slug, v]) => v.name_en.toLowerCase() === key || slug === direct
  );
  return byName ? byName[0] : null;
}

/**
 * Ensure every seed city exists; returns slug → cities.id. Idempotent
 * (ON CONFLICT (slug) DO NOTHING). Adds Varanasi, which v2 lacks.
 */
export async function ensureCities(client: {
  query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }>;
}): Promise<Map<string, number>> {
  for (const [slug, c] of Object.entries(CITY_SEED)) {
    await client.query(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, c.name_en, c.name_hi, c.state_en, c.state_hi]
    );
  }
  const { rows } = await client.query(`SELECT id, slug FROM cities`);
  return new Map(rows.map((r: { id: number; slug: string }) => [r.slug, r.id]));
}
