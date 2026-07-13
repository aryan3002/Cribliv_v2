"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Home,
  Plus,
  RefreshCw,
  Users
} from "lucide-react";
import {
  createSalesLead,
  fetchOwnerLeads,
  listOwnerListings,
  makeIdempotencyKey,
  type LeadVm,
  type OwnerListingVm
} from "../../lib/owner-api";
import { trackEvent } from "../../lib/analytics";
import { t, type Locale } from "../../lib/i18n";

type LoadState<T> =
  | { status: "loading"; data: T }
  | { status: "ready"; data: T }
  | { status: "error"; data: T; message: string };

type ListingData = { items: OwnerListingVm[]; total: number };
type LeadData = { items: LeadVm[]; total: number };
type PmState = "idle" | "loading" | "success" | "error";

const EMPTY_LISTINGS: ListingData = { items: [], total: 0 };
const EMPTY_LEADS: LeadData = { items: [], total: 0 };
const SEVEN_DAYS_MS = 604_800_000;

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dateValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(status: OwnerListingVm["status"]): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function leadStatusLabel(status: LeadVm["status"]): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRent(value?: number): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function sortByRecent<T extends { createdAt?: string }>(items: T[]) {
  return [...items].sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function OwnerOverviewClient({ locale }: { locale: string }): JSX.Element {
  const loc = locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userName = nextAuthSession?.user?.name ?? "";
  const firstName = userName ? userName.split(" ")[0] : "";
  const createListingLabel = t(loc, "createListing");

  const [listingState, setListingState] = useState<LoadState<ListingData>>({
    status: "loading",
    data: EMPTY_LISTINGS
  });
  const [leadState, setLeadState] = useState<LoadState<LeadData>>({
    status: "loading",
    data: EMPTY_LEADS
  });
  const [pmState, setPmState] = useState<PmState>("idle");
  const [pmNotice, setPmNotice] = useState<string | null>(null);

  const loadListings = useCallback(() => {
    if (!accessToken) {
      setListingState({
        status: "error",
        data: EMPTY_LISTINGS,
        message: t(loc, "loginRequired")
      });
      return;
    }

    setListingState((prev) => ({ status: "loading", data: prev.data }));
    listOwnerListings(accessToken)
      .then((response) => {
        setListingState({
          status: "ready",
          data: { items: response.items, total: response.total }
        });
      })
      .catch((err) => {
        const message = errorMessage(err, "Failed to load listings");
        if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setListingState((prev) => ({ status: "error", data: prev.data, message }));
      });
  }, [accessToken, loc]);

  const loadLeads = useCallback(() => {
    if (!accessToken) {
      setLeadState({
        status: "error",
        data: EMPTY_LEADS,
        message: t(loc, "loginRequired")
      });
      return;
    }

    setLeadState((prev) => ({ status: "loading", data: prev.data }));
    fetchOwnerLeads(accessToken, { pageSize: 200 })
      .then((response) => {
        setLeadState({
          status: "ready",
          data: { items: response.items, total: response.total }
        });
      })
      .catch((err) => {
        const message = errorMessage(err, "Failed to load leads");
        if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setLeadState((prev) => ({ status: "error", data: prev.data, message }));
      });
  }, [accessToken, loc]);

  useEffect(() => {
    loadListings();
    loadLeads();
  }, [loadListings, loadLeads]);

  const listings = listingState.data.items;
  const leads = leadState.data.items;

  const active = listings.filter((item) => item.status === "active").length;
  const pending = listings.filter((item) => item.status === "pending_review").length;
  const drafts = listings.filter((item) => item.status === "draft").length;
  const newLeads7d = leads.filter(
    (lead) => Date.now() - Date.parse(lead.createdAt) <= SEVEN_DAYS_MS
  ).length;
  const hasUnverifiedActive = listings.some(
    (item) => item.status === "active" && item.verificationStatus !== "verified"
  );

  const recentListings = useMemo(() => sortByRecent(listings).slice(0, 3), [listings]);
  const recentLeads = useMemo(() => sortByRecent(leads).slice(0, 3), [leads]);

  async function requestPropertyManagementAssist() {
    if (!accessToken) {
      setPmState("error");
      setPmNotice(t(loc, "loginRequired"));
      return;
    }

    setPmState("loading");
    setPmNotice(null);
    try {
      await createSalesLead(accessToken, {
        source: "property_management",
        notes: "Property management consultation requested from owner dashboard",
        metadata: { locale, listing_count: listings.length },
        idempotencyKey: makeIdempotencyKey("pm-assist")
      });
      setPmState("success");
      setPmNotice("Request submitted. Our team will contact you shortly.");
      trackEvent("property_management_requested", { listing_count: listings.length });
    } catch (err) {
      const message = errorMessage(err, "Failed to submit request");
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setPmState("error");
      setPmNotice(message);
    }
  }

  return (
    <div className="ovo">
      <header className="ovo-hero">
        <div className="ovo-hero__copy">
          <p className="ovo-eyebrow">Owner overview</p>
          <h1 className="ovo-title">
            {getGreeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="ovo-subtitle">
            {listings.length === 0
              ? "Start with one listing, then track every lead from here."
              : `${listingState.data.total} listings in your portfolio, ${leadState.data.total} tenant leads tracked.`}
          </p>
        </div>
        <Link href={`/${locale}/owner/listings/new`} className="ovo-add-listing">
          <Plus size={16} aria-hidden="true" />
          {createListingLabel}
        </Link>
      </header>

      <section className="ovo-headline" aria-label="Owner headline metrics">
        <MetricCard
          testId="overview-metric-active"
          icon={<Home size={18} aria-hidden="true" />}
          label="Active listings"
          value={active}
          help="Visible to tenants"
        />
        <MetricCard
          testId="overview-metric-leads-7d"
          icon={<Users size={18} aria-hidden="true" />}
          label="New leads (7d)"
          value={newLeads7d}
          help={leadState.status === "error" ? "Lead refresh failed" : "Fresh tenant interest"}
        />
      </section>

      <section className="ovo-secondary" aria-label="Portfolio summary">
        <CompactMetric label="Pending" value={pending} />
        <CompactMetric label="Drafts" value={drafts} />
        <CompactMetric label="Total" value={listingState.data.total} />
      </section>

      <section className="ovo-actions" aria-label="Priority work">
        {hasUnverifiedActive ? (
          <div className="ovo-task ovo-task--urgent">
            <span className="ovo-task__icon" aria-hidden="true">
              <AlertTriangle size={17} />
            </span>
            <div className="ovo-task__body">
              <h2>Verification needs attention</h2>
              <p>Complete verification for active listings to improve tenant trust.</p>
            </div>
            <Link href={`/${locale}/owner/verification`} className="ovo-link-action">
              Complete verification <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="ovo-task">
            <span className="ovo-task__icon ovo-task__icon--ok" aria-hidden="true">
              <CheckCircle2 size={17} />
            </span>
            <div className="ovo-task__body">
              <h2>No urgent verification work</h2>
              <p>Your active portfolio has no verification blockers.</p>
            </div>
            <Link href={`/${locale}/owner/verification`} className="ovo-link-action">
              View verification <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        )}

        <div className="ovo-task">
          <span className="ovo-task__icon ovo-task__icon--brand" aria-hidden="true">
            <Building2 size={17} />
          </span>
          <div className="ovo-task__body">
            <h2>Portfolio management</h2>
            <p>Jump into focused pages for listing updates and tenant follow-up.</p>
          </div>
          <div className="ovo-task__links">
            <Link href={`/${locale}/owner/listings`} className="ovo-link-action">
              Manage listings <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link href={`/${locale}/owner/leads`} className="ovo-link-action">
              Review leads <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <div className="ovo-panels">
        <section className="ovo-section" aria-labelledby="recent-listings-title">
          <div className="ovo-section__header">
            <div>
              <p className="ovo-section__eyebrow">Portfolio</p>
              <h2 id="recent-listings-title">Recent listings</h2>
            </div>
            <Link href={`/${locale}/owner/listings`} className="ovo-text-link">
              Manage listings
            </Link>
          </div>

          {listingState.status === "error" ? (
            <ErrorBlock message={listingState.message} onRetry={loadListings} />
          ) : listingState.status === "loading" && listings.length === 0 ? (
            <LoadingRows label="Loading listings" />
          ) : recentListings.length === 0 ? (
            <EmptyBlock
              title="No listings yet"
              body="Create your first listing to start receiving tenant interest."
            />
          ) : (
            <div className="ovo-row-list">
              {recentListings.map((listing) => {
                const rent = formatRent(listing.monthlyRent);
                return (
                  <article key={listing.id} className="ovo-row" data-testid="overview-listing-row">
                    <div className="ovo-row__main">
                      <Link
                        href={`/${locale}/owner/listings/${listing.id}`}
                        className="ovo-row__title"
                      >
                        {listing.title}
                      </Link>
                      <p>
                        {[listing.locality, listing.city, rent].filter(Boolean).join(" · ") ||
                          "Location details pending"}
                      </p>
                    </div>
                    <span className={`ovo-pill ovo-pill--${listing.status}`}>
                      {statusLabel(listing.status)}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="ovo-section" aria-labelledby="recent-leads-title">
          <div className="ovo-section__header">
            <div>
              <p className="ovo-section__eyebrow">Tenant interest</p>
              <h2 id="recent-leads-title">Recent leads</h2>
            </div>
            <Link href={`/${locale}/owner/leads`} className="ovo-text-link">
              Review leads
            </Link>
          </div>

          {leadState.status === "error" ? (
            <ErrorBlock message={leadState.message} onRetry={loadLeads} />
          ) : leadState.status === "loading" && leads.length === 0 ? (
            <LoadingRows label="Loading leads" />
          ) : recentLeads.length === 0 ? (
            <EmptyBlock title="No leads yet" body="New tenant enquiries will appear here." />
          ) : (
            <div className="ovo-row-list">
              {recentLeads.map((lead) => (
                <article key={lead.id} className="ovo-row" data-testid="overview-lead-row">
                  <div className="ovo-row__main">
                    <Link href={`/${locale}/owner/leads`} className="ovo-row__title">
                      {lead.tenantName}
                    </Link>
                    <p>{lead.listingTitle}</p>
                  </div>
                  <span className={`ovo-pill ovo-pill--lead-${lead.status}`}>
                    {leadStatusLabel(lead.status)}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="ovo-management" aria-label="Property management assistance">
        <div>
          <p className="ovo-section__eyebrow">Secondary action</p>
          <h2>Need help managing properties?</h2>
          <p>Ask the Cribliv team for hands-off onboarding and operations support.</p>
        </div>
        <button
          type="button"
          className="ovo-secondary-action"
          onClick={() => void requestPropertyManagementAssist()}
          disabled={pmState === "loading"}
        >
          {pmState === "loading"
            ? "Sending request..."
            : pmState === "error"
              ? "Retry management help"
              : "Request management help"}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        {pmNotice && (
          <p
            className={`ovo-management__notice${
              pmState === "error" ? " ovo-management__notice--error" : ""
            }`}
            role={pmState === "error" ? "alert" : "status"}
          >
            {pmNotice}
          </p>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  testId,
  icon,
  label,
  value,
  help
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  help: string;
}) {
  return (
    <div className="ovo-metric" data-testid={testId}>
      <span className="ovo-metric__icon">{icon}</span>
      <span className="ovo-metric__value">{value}</span>
      <span className="ovo-metric__label">{label}</span>
      <span className="ovo-metric__help">{help}</span>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="ovo-compact-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ovo-error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div className="ovo-row-list" aria-label={label}>
      {[1, 2, 3].map((item) => (
        <div key={item} className="ovo-row ovo-row--loading" />
      ))}
    </div>
  );
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="ovo-empty">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
