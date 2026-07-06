import { auth } from "@/auth";
import { redirect } from "next/navigation";
import PgSalesAssistLeadForm from "./PgSalesAssistLeadForm";

export default async function Page({ params }: { params: { locale: string } }) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);

  return <PgSalesAssistLeadForm />;
}
