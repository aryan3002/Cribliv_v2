"use client";
import Link from "next/link";
import type { Route } from "next";
import { useMyDrafts } from "@/lib/rent-agreement/hooks/use-my-drafts";
import { statusLabel } from "@/lib/rent-agreement/state/status-machine";

export default function Page({ params }: { params: { locale: string } }) {
  const drafts = useMyDrafts();
  const base = `/${params.locale}/rent-agreement`;
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rent agreements</h1>
        <Link href={`${base}/new` as Route} className="underline text-blue-700">
          New draft
        </Link>
      </header>
      {drafts.isLoading && <p>Loading…</p>}
      {drafts.isError && <p>Failed to load drafts.</p>}
      <ul className="divide-y border rounded">
        {drafts.data?.map((d) => (
          <li key={d.id} className="p-3 flex justify-between">
            <div>
              <Link href={`${base}/${d.id}` as Route} className="font-mono text-sm underline">
                {d.id}
              </Link>
              <p className="text-xs text-gray-600">
                {d.plan_id} · step {d.current_step} · {statusLabel(d.status)}
              </p>
            </div>
            <span className="text-xs text-gray-500">{new Date(d.updated_at).toLocaleString()}</span>
          </li>
        ))}
        {drafts.data?.length === 0 && <li className="p-3 text-gray-500">No drafts yet.</li>}
      </ul>
    </div>
  );
}
