import { auth } from "@/auth";
import PgBecomeClient from "./PgBecomeClient";

export default async function Page({ params }: { params: { locale: string } }) {
  const session = await auth();
  const currentRole = (session?.user?.role ?? "tenant") as
    | "tenant"
    | "owner"
    | "pg_operator"
    | "admin";
  const accessToken = (session as any)?.accessToken ?? null;
  return (
    <PgBecomeClient locale={params.locale} currentRole={currentRole} accessToken={accessToken} />
  );
}
