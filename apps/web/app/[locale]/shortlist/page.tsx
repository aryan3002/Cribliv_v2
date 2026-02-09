import { ShortlistClient } from "../../../components/shortlist-client";

export default function ShortlistPage({ params }: { params: { locale: string } }) {
  return <ShortlistClient locale={params.locale} />;
}
