"use client";
import Link from "next/link";
import type { Route } from "next";
import { FilePlus, FileText } from "lucide-react";
import { useMyDrafts } from "@/lib/rent-agreement/hooks/use-my-drafts";
import { statusLabel } from "@/lib/rent-agreement/state/status-machine";
import { draftName, formatDateTime } from "./_components/ui-copy";
import { StatusBadge } from "./_components/StatusBadge";

export default function Page({ params }: { params: { locale: string } }) {
  const drafts = useMyDrafts();
  const base = `/${params.locale}/rent-agreement`;
  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${params.locale}` as Route}>Home</Link>
          <span>/</span>
          <span>Rent agreements</span>
        </nav>
      </div>

      <header className="ra-page-header">
        <div>
          <h1 className="ra-page-title">Rent agreements</h1>
          <p className="ra-page-copy">
            Create, finish, and download legally formatted rent agreements from your active drafts.
          </p>
        </div>
        <Link href={`${base}/new` as Route} className="ra-button">
          <FilePlus size={17} aria-hidden="true" />
          New draft
        </Link>
      </header>

      {drafts.isLoading && <p className="ra-loading">Loading agreements…</p>}
      {drafts.isError && <p className="ra-error">Failed to load drafts.</p>}
      {!drafts.isLoading && !drafts.isError && (
        <ul className="ra-draft-list">
          {drafts.data?.length === 0 && (
            <li className="ra-empty">
              No drafts yet. Start with a plan, then fill the agreement step by step.
            </li>
          )}
          {drafts.data?.map((d) => (
            <li key={d.id} className="ra-draft-item">
              <div className="ra-draft-main">
                <Link href={`${base}/${d.id}` as Route} className="ra-draft-link">
                  <FileText size={15} aria-hidden="true" />
                  {draftName(d)}
                </Link>
                <p className="ra-meta">
                  <span>{d.id}</span>
                  <span>{d.plan_id}</span>
                  <span>Step {d.current_step}</span>
                  <span>{statusLabel(d.status)}</span>
                </p>
              </div>
              <div className="ra-actions">
                <StatusBadge status={d.status} />
                <span className="ra-muted">{formatDateTime(d.updated_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
