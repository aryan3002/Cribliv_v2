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
type ErrorContext = "listings" | "leads" | "propertyManagement";

const EMPTY_LISTINGS: ListingData = { items: [], total: 0 };
const EMPTY_LEADS: LeadData = { items: [], total: 0 };
const SEVEN_DAYS_MS = 604_800_000;

function formatCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function getGreeting(loc: Locale): string {
  const h = new Date().getHours();
  if (h < 12) return t(loc, "ownerOverviewGreetingMorning");
  if (h < 17) return t(loc, "ownerOverviewGreetingAfternoon");
  return t(loc, "ownerOverviewGreetingEvening");
}

function dateValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(status: OwnerListingVm["status"], loc: Locale): string {
  const keys: Record<OwnerListingVm["status"], string> = {
    active: "active",
    archived: "archived",
    draft: "draft",
    paused: "paused",
    pending_review: "pendingReview",
    rejected: "rejected"
  };
  return t(loc, keys[status]);
}

function leadStatusLabel(status: LeadVm["status"], loc: Locale): string {
  const keys: Record<LeadVm["status"], string> = {
    contacted: "ownerOverviewLeadStatusContacted",
    deal_done: "ownerOverviewLeadStatusDealDone",
    lost: "ownerOverviewLeadStatusLost",
    new: "ownerOverviewLeadStatusNew",
    visit_scheduled: "ownerOverviewLeadStatusVisitScheduled"
  };
  return t(loc, keys[status]);
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

function rawErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "";
}

function isUnauthorizedError(err: unknown): boolean {
  const message = rawErrorMessage(err).toLowerCase();
  return message.includes("unauthorized") || message.includes("status 401");
}

function isNetworkError(err: unknown): boolean {
  const message = rawErrorMessage(err).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("load failed")
  );
}

function overviewErrorMessage(err: unknown, loc: Locale, context: ErrorContext): string {
  if (isUnauthorizedError(err)) return t(loc, "ownerOverviewErrorUnauthorized");
  if (isNetworkError(err)) return t(loc, "ownerOverviewErrorNetwork");

  const keys: Record<ErrorContext, string> = {
    listings: "ownerOverviewErrorListings",
    leads: "ownerOverviewErrorLeads",
    propertyManagement: "ownerOverviewErrorPm"
  };
  return t(loc, keys[context]);
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
        const message = overviewErrorMessage(err, loc, "listings");
        if (isUnauthorizedError(err)) void signOut({ redirect: false });
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
        const message = overviewErrorMessage(err, loc, "leads");
        if (isUnauthorizedError(err)) void signOut({ redirect: false });
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
      setPmNotice(t(loc, "ownerOverviewRequestSubmitted"));
      trackEvent("property_management_requested", { listing_count: listings.length });
    } catch (err) {
      const message = overviewErrorMessage(err, loc, "propertyManagement");
      if (isUnauthorizedError(err)) void signOut({ redirect: false });
      setPmState("error");
      setPmNotice(message);
    }
  }

  return (
    <div className="ovo">
      <header className="ovo-hero">
        <div className="ovo-hero__copy">
          <p className="ovo-eyebrow">{t(loc, "ownerOverviewEyebrow")}</p>
          <h1 className="ovo-title">
            {getGreeting(loc)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="ovo-subtitle">
            {listings.length === 0
              ? t(loc, "ownerOverviewEmptySubtitle")
              : formatCopy(t(loc, "ownerOverviewPortfolioSubtitle"), {
                  listings: listingState.data.total,
                  leads: leadState.data.total
                })}
          </p>
        </div>
        <Link href={`/${locale}/owner/listings/new`} className="ovo-add-listing">
          <Plus size={16} aria-hidden="true" />
          {createListingLabel}
        </Link>
      </header>

      <section className="ovo-headline" aria-label={t(loc, "ownerOverviewHeadlineMetrics")}>
        <MetricCard
          testId="overview-metric-active"
          icon={<Home size={18} aria-hidden="true" />}
          label={t(loc, "ownerOverviewActiveListings")}
          value={active}
          help={t(loc, "ownerOverviewVisibleTenants")}
        />
        <MetricCard
          testId="overview-metric-leads-7d"
          icon={<Users size={18} aria-hidden="true" />}
          label={t(loc, "ownerOverviewNewLeads7d")}
          value={newLeads7d}
          help={
            leadState.status === "error"
              ? t(loc, "ownerOverviewLeadRefreshFailed")
              : t(loc, "ownerOverviewFreshInterest")
          }
        />
      </section>

      <section className="ovo-secondary" aria-label={t(loc, "ownerOverviewPortfolioSummary")}>
        <CompactMetric label={t(loc, "ownerOverviewPending")} value={pending} />
        <CompactMetric label={t(loc, "ownerOverviewDrafts")} value={drafts} />
        <CompactMetric label={t(loc, "ownerOverviewTotal")} value={listingState.data.total} />
      </section>

      <section className="ovo-actions" aria-label={t(loc, "ownerOverviewPriorityWork")}>
        {hasUnverifiedActive ? (
          <div className="ovo-task ovo-task--urgent">
            <span className="ovo-task__icon" aria-hidden="true">
              <AlertTriangle size={17} />
            </span>
            <div className="ovo-task__body">
              <h2>{t(loc, "ownerOverviewVerificationAttention")}</h2>
              <p>{t(loc, "ownerOverviewVerificationAttentionBody")}</p>
            </div>
            <Link href={`/${locale}/owner/verification`} className="ovo-link-action">
              {t(loc, "ownerOverviewCompleteVerification")}{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="ovo-task">
            <span className="ovo-task__icon ovo-task__icon--ok" aria-hidden="true">
              <CheckCircle2 size={17} />
            </span>
            <div className="ovo-task__body">
              <h2>{t(loc, "ownerOverviewNoUrgentVerification")}</h2>
              <p>{t(loc, "ownerOverviewNoUrgentVerificationBody")}</p>
            </div>
            <Link href={`/${locale}/owner/verification`} className="ovo-link-action">
              {t(loc, "ownerOverviewViewVerification")} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        )}

        <div className="ovo-task">
          <span className="ovo-task__icon ovo-task__icon--brand" aria-hidden="true">
            <Building2 size={17} />
          </span>
          <div className="ovo-task__body">
            <h2>{t(loc, "ownerOverviewPortfolioManagement")}</h2>
            <p>{t(loc, "ownerOverviewPortfolioManagementBody")}</p>
          </div>
          <div className="ovo-task__links">
            <Link href={`/${locale}/owner/listings`} className="ovo-link-action">
              {t(loc, "ownerOverviewManageListings")} <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link href={`/${locale}/owner/leads`} className="ovo-link-action">
              {t(loc, "ownerOverviewReviewLeads")} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <div className="ovo-panels">
        <section className="ovo-section" aria-labelledby="recent-listings-title">
          <div className="ovo-section__header">
            <div>
              <p className="ovo-section__eyebrow">{t(loc, "ownerOverviewPortfolio")}</p>
              <h2 id="recent-listings-title">{t(loc, "ownerOverviewRecentListings")}</h2>
            </div>
            <Link href={`/${locale}/owner/listings`} className="ovo-text-link">
              {t(loc, "ownerOverviewManageListings")}
            </Link>
          </div>

          {listingState.status === "error" ? (
            <ErrorBlock message={listingState.message} onRetry={loadListings} locale={loc} />
          ) : listingState.status === "loading" && listings.length === 0 ? (
            <LoadingRows label={t(loc, "ownerOverviewLoadingListings")} />
          ) : recentListings.length === 0 ? (
            <EmptyBlock
              title={t(loc, "ownerOverviewNoListingsYet")}
              body={t(loc, "ownerOverviewNoListingsYetBody")}
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
                          t(loc, "ownerOverviewLocationPending")}
                      </p>
                    </div>
                    <span className={`ovo-pill ovo-pill--${listing.status}`}>
                      {statusLabel(listing.status, loc)}
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
              <p className="ovo-section__eyebrow">{t(loc, "ownerOverviewTenantInterest")}</p>
              <h2 id="recent-leads-title">{t(loc, "ownerOverviewRecentLeads")}</h2>
            </div>
            <Link href={`/${locale}/owner/leads`} className="ovo-text-link">
              {t(loc, "ownerOverviewReviewLeads")}
            </Link>
          </div>

          {leadState.status === "error" ? (
            <ErrorBlock message={leadState.message} onRetry={loadLeads} locale={loc} />
          ) : leadState.status === "loading" && leads.length === 0 ? (
            <LoadingRows label={t(loc, "ownerOverviewLoadingLeads")} />
          ) : recentLeads.length === 0 ? (
            <EmptyBlock
              title={t(loc, "ownerOverviewNoLeadsYet")}
              body={t(loc, "ownerOverviewNoLeadsYetBody")}
            />
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
                    {leadStatusLabel(lead.status, loc)}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section
        className="ovo-management"
        aria-label={t(loc, "ownerOverviewPropertyManagementAssistance")}
      >
        <div>
          <p className="ovo-section__eyebrow">{t(loc, "ownerOverviewSecondaryAction")}</p>
          <h2>{t(loc, "ownerOverviewManagementTitle")}</h2>
          <p>{t(loc, "ownerOverviewManagementBody")}</p>
        </div>
        <button
          type="button"
          className="ovo-secondary-action"
          onClick={() => void requestPropertyManagementAssist()}
          disabled={pmState === "loading"}
        >
          {pmState === "loading"
            ? t(loc, "ownerOverviewSendingRequest")
            : pmState === "error"
              ? t(loc, "ownerOverviewRetryHelp")
              : t(loc, "ownerOverviewRequestHelp")}
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

function ErrorBlock({
  message,
  onRetry,
  locale
}: {
  message: string;
  onRetry: () => void;
  locale: Locale;
}) {
  return (
    <div className="ovo-error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        {t(locale, "ownerOverviewRetry")}
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
