import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

export default async function PgOperatorLayout({
  children,
  params
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const session = await auth();
  if (!session) redirect(`/${params.locale}/auth/login?from=/pg-operator/dashboard`);
  return <>{children}</>;
}
