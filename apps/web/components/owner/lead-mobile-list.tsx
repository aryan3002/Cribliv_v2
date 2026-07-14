"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { updateLeadStatus, type LeadStatus, type LeadVm } from "../../lib/owner-api";
import { t, type Locale } from "../../lib/i18n";
import { track } from "../../lib/track";
import { LeadCard } from "./lead-card";

const STATUS_LABEL_KEYS: Record<LeadStatus | "all", string> = {
  all: "ownerLeadStatusAll",
  new: "ownerLeadStatusNew",
  contacted: "ownerLeadStatusContacted",
  visit_scheduled: "ownerLeadStatusVisitScheduled",
  deal_done: "ownerLeadStatusDealDone",
  lost: "ownerLeadStatusLost"
};

function leadMatchesSearch(lead: LeadVm, query: string) {
  if (!query) return true;
  const haystack = [
    lead.tenantName,
    lead.listingTitle,
    lead.tenantPhoneMasked ?? "",
    lead.tenantPhone ?? "",
    lead.ownerNotes ?? ""
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function LeadMobileList(props: {
  accessToken: string;
  locale: Locale;
  leads: LeadVm[];
  searchQuery: string;
  status: LeadStatus | "all";
  onLeadsChange(next: LeadVm[]): void;
}): JSX.Element {
  const { accessToken, locale, leads, searchQuery, status, onLeadsChange } = props;
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; isError?: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  const visibleLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return leads.filter(
      (lead) => (status === "all" || lead.status === status) && leadMatchesSearch(lead, query)
    );
  }, [leads, searchQuery, status]);

  function showNotice(message: string, isError = false) {
    setNotice({ message, isError });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 5000 : 3000);
  }

  function handleLeadPatch(leadId: string, patch: Partial<LeadVm>) {
    onLeadsChange(leads.map((lead) => (lead.id === leadId ? { ...lead, ...patch } : lead)));
  }

  async function handleStatusChange(leadId: string, newStatus: LeadStatus, notes?: string) {
    const previous = leads;
    const from = leads.find((lead) => lead.id === leadId)?.status;
    const next = leads.map((lead) =>
      lead.id === leadId
        ? {
            ...lead,
            status: newStatus,
            ownerNotes: notes ?? lead.ownerNotes,
            statusChangedAt: new Date().toISOString()
          }
        : lead
    );

    onLeadsChange(next);
    setUpdatingLeadId(leadId);
    setNotice(null);

    try {
      await updateLeadStatus(accessToken, leadId, newStatus, notes);
      track("lead_status_changed", {
        lead_id: leadId,
        from_status: from,
        to_status: newStatus,
        surface: "mobile_list"
      });
      showNotice(
        t(locale, "ownerLeadsMovedTo").replace("{status}", t(locale, STATUS_LABEL_KEYS[newStatus]))
      );
    } catch {
      onLeadsChange(previous);
      showNotice(t(locale, "ownerLeadsUpdateFailed"), true);
    } finally {
      setUpdatingLeadId(null);
    }
  }

  return (
    <div className="lml" data-testid="lead-mobile-list">
      {notice ? (
        <div
          className={`alert ${notice.isError ? "alert--error" : "alert--success"}`}
          role="status"
        >
          {notice.message}
        </div>
      ) : null}

      {visibleLeads.length === 0 ? (
        <div className="lml__empty">
          <span className="lml__empty-icon" aria-hidden="true">
            <Inbox size={20} />
          </span>
          <h2>{t(locale, "ownerOverviewNoLeadsYet")}</h2>
          <p>
            {searchQuery.trim() || status !== "all"
              ? t(locale, "ownerLeadsFilterEmpty")
              : t(locale, "ownerOverviewNoLeadsYetBody")}
          </p>
        </div>
      ) : (
        <div className="lml__list" aria-label="Leads">
          {visibleLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              locale={locale}
              onStatusChange={handleStatusChange}
              updating={updatingLeadId === lead.id}
              accessToken={accessToken}
              onLeadPatch={handleLeadPatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
