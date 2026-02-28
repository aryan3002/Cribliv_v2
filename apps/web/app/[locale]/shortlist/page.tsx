import { ShortlistClient } from "../../../components/shortlist-client";

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
