import { redirect } from "next/navigation";

interface PageProps {
  params: { locale: string };
}

export default function OwnerLeadsPage({ params }: PageProps) {
  redirect(`/${params.locale}/owner/dashboard?tab=leads`);
}
