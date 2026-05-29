import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/pg-operator-api";
import PgWizardClient from "./PgWizardClient";

export default async function Page({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: { draftId?: string };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const accessToken = (s as any)?.accessToken ?? null;

  let existingPgPropertyId: string | null = null;
  let existingPropertySeed:
    | { display_name?: string; city_slug?: string; locality_slug?: string }
    | undefined;
  try {
    const me = await getMe(accessToken ?? undefined);
    const primary = me.properties.find((p) => p.is_primary) ?? me.properties[0];
    if (primary) {
      existingPgPropertyId = primary.id;
      // city_id/locality_id are ints — we don't have the slug back; let the operator re-type or
      // surface from properties' display_name only. Slug stays empty so they confirm before publish.
      existingPropertySeed = { display_name: primary.display_name };
    }
  } catch {
    /* tolerated — wizard still works for needs_property */
  }

  return (
    <PgWizardClient
      locale={params.locale}
      draftId={searchParams.draftId}
      accessToken={accessToken}
      existingPgPropertyId={existingPgPropertyId}
      existingPropertySeed={existingPropertySeed}
    />
  );
}
