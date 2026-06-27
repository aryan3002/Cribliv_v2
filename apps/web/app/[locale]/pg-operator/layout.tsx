import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import "./pg-operator.css";
import styles from "./pg-operator.module.css";
import OperatorNavStrip from "@/components/pg-operator/OperatorNavStrip";

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
  return (
    <div className={`pgo-dark ${styles.shell}`} data-context="pg-operator">
      <span className={styles.glowOrb} aria-hidden />
      <OperatorNavStrip locale={params.locale} />
      {children}
    </div>
  );
}
