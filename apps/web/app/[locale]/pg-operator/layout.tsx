import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import "./pg-operator.css";

export default async function PgOperatorLayout({
  children,
  params
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const session = await auth();
  if (!session)
    redirect(`/${params.locale}/auth/login?from=/${params.locale}/pg-operator/dashboard`);
  return <div className="pgo-dark">{children}</div>;
}
