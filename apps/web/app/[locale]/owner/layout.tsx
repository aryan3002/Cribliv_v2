import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n";
import { OwnerWorkspaceShell } from "../../../components/owner/workspace-shell";

export default function OwnerLayout({
  children,
  params
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return <OwnerWorkspaceShell locale={params.locale as Locale}>{children}</OwnerWorkspaceShell>;
}
