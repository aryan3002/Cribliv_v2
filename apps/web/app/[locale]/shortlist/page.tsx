import type { Metadata } from "next";
import { ShortlistClient } from "../../../components/shortlist-client";

export const metadata: Metadata = {
  title: "Saved Homes | Cribliv"
};

export default function ShortlistPage({ params }: { params: { locale: string } }) {
  return (
    <div
      className="container"
      style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-16)" }}
    >
      <ShortlistClient locale={params.locale} />
    </div>
  );
}
