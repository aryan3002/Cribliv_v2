import { normalizeE164 } from "./phone";
import { normName } from "./excel-source";
import type { OwnerSource } from "./types";

/** Dedicated fallback owner account for listings with no resolvable phone. */
export const IMPORT_FALLBACK_PHONE = "+910000000001";
export const IMPORT_FALLBACK_NAME = "Cribliv Import";

export function resolveOwnerPhone(
  doc: { ownerPhone?: string | number; nameListing?: string },
  excelByName: Map<string, string>
): { phone: string | null; source: OwnerSource } {
  const fromMongo = normalizeE164(doc.ownerPhone);
  if (fromMongo) return { phone: fromMongo, source: "mongo" };
  const fromExcel = excelByName.get(normName(doc.nameListing ?? ""));
  if (fromExcel) return { phone: fromExcel, source: "excel" };
  return { phone: null, source: "import_fallback" };
}

/** Idempotent upsert of an owner by phone. Returns users.id. */
export async function upsertOwner(
  client: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  phoneE164: string,
  fullName: string | null
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO users (phone_e164, role, full_name, preferred_language)
     VALUES ($1, 'owner'::user_role, $2, 'en')
     ON CONFLICT (phone_e164) DO UPDATE SET
       role = 'owner',
       is_blocked = false,
       full_name = COALESCE(users.full_name, EXCLUDED.full_name)
     RETURNING id::text`,
    [phoneE164, fullName]
  );
  return rows[0].id;
}
