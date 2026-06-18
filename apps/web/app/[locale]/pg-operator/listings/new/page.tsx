import { auth } from "@/auth";
import { redirect } from "next/navigation";
import PgWizardClient from "./PgWizardClient";

export default async function Page({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: { draftId?: string; edit?: string };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const accessToken = (s as any)?.accessToken ?? null;
  // Real operator UUID for the voice/text socket handshake (FK to users on the
  // pg_voice_agent_sessions row).
  const operatorUserId = (s?.user as { id?: string } | undefined)?.id ?? null;

  // 1 listing : 1 property — a new listing no longer reuses an "existing" primary
  // property (every publish mints its own), so we do NOT preload one. The wizard
  // hydrates a committed listing only via ?edit (BUG-M1).
  return (
    <PgWizardClient
      locale={params.locale}
      draftId={searchParams.draftId}
      editListingId={searchParams.edit}
      accessToken={accessToken}
      operatorUserId={operatorUserId}
    />
  );
}
