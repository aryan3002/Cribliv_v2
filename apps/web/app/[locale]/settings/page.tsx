import type { Metadata } from "next";
import { SettingsClient } from "../../../components/settings-client";

export const metadata: Metadata = {
  title: "Account Settings"
};

export default function SettingsPage({ params }: { params: { locale: string } }) {
  return <SettingsClient locale={params.locale} />;
}
