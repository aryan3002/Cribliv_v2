import { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast/toast-provider";
import "./pg-operator.css";
import styles from "./pg-operator.module.css";

export default async function PgOperatorLayout({
  children,
  params
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return (
    <div className={`pgo-dark ${styles.shell}`} data-context="pg-operator">
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
