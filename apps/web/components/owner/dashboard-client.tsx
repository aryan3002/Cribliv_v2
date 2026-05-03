"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { motion } from "framer-motion";
import {
  createSalesLead,
  type ListingStatus,
  makeIdempotencyKey,
  type OwnerListingVm,
  type LeadVm,
  listOwnerListings,
  fetchOwnerLeads
} from "../../lib/owner-api";
import { trackEvent } from "../../lib/analytics";
import { track } from "../../lib/track";
import { t, type Locale } from "../../lib/i18n";
import { LeadStatsWidget } from "./lead-stats-widget";
import { LeadsPipeline } from "./leads-pipeline";
import { LeadKanban, LeadKanbanSkeleton } from "./lead-kanban";
import { BoostModal } from "./boost-modal";
import { ListingCardLuxe } from "./listing-card-luxe";
import {
  Plus,
  Settings,
  ShieldCheck,
  Building,
  AlertTriangle,
  Home,
  BarChart3,
  ArrowRight,
  Layers,
  LayoutGrid,
  List,
  Search,
  Download,
  Sparkles
} from "lucide-react";

type Tab = "listings" | "leads";
type ViewMode = "board" | "list";
const VIEW_KEY = "cribliv:owner_leads_view";

const STATUS_FILTERS: Array<{ value: ListingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_review", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
  { value: "paused", label: "Paused" }
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>("board");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY) as ViewMode | null;
      if (saved === "board" || saved === "list") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const update = useCallback((next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
    track("kanban_view_toggled", { view: next });
  }, []);
  return [view, update];
}

function useCanDrag(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)");
    const update = () => setCan(m.matches);
    update();
    m.addEventListener?.("change", update);
    return () => m.removeEventListener?.("change", update);
  }, []);
  return can;
}

interface Props {
  locale: string;
  initialTab?: Tab;
}

export function DashboardClient({ locale, initialTab = "listings" }: Props) {
  const loc = locale as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userName = nextAuthSession?.user?.name ?? "";
  const userRole = nextAuthSession?.user?.role as "owner" | "pg_operator" | undefined;
  const isPgOperator = userRole === "pg_operator";
  const createListingLabel = isPgOperator ? "Add PG" : t(loc, "createListing");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newListingHref = `/${locale}/owner/listings/new${isPgOperator ? "?type=pg" : ""}` as any;

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [listings, setListings] = useState<OwnerListingVm[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "all">("all");
  const [pmRequesting, setPmRequesting] = useState(false);
  const [pmNotice, setPmNotice] = useState<string | null>(null);
  const [boostTarget, setBoostTarget] = useState<OwnerListingVm | null>(null);
  const [boostNotice, setBoostNotice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Leads state
  const [leads, setLeads] = useState<LeadVm[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [view, setView] = useViewMode();
  const canDrag = useCanDrag();

  // Sync activeTab → URL
  useEffect(() => {
    const current = searchParams?.get("tab");
    const wanted = activeTab === "leads" ? "leads" : null;
    if (wanted === current) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (wanted) params.set("tab", wanted);
    else params.delete("tab");
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}` as never, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // React to ?tab= changes (deep-link)
  useEffect(() => {
    const tabParam = searchParams?.get("tab");
    const next: Tab = tabParam === "leads" ? "leads" : "listings";
    setActiveTab((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  // Load listings whenever filter or auth changes
  useEffect(() => {
    void loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, accessToken]);

  // Load leads once we have a token
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLeadsLoading(true);
    setLeadsError(null);
    fetchOwnerLeads(accessToken, { pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setLeads(res.items);
        setLeadsTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load leads";
        if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setLeadsError(msg);
      })
      .finally(() => {
        if (!cancelled) setLeadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function loadListings() {
    setLoadingListings(true);
    setListingsError(null);
    if (!accessToken) {
      setListingsError(t(loc, "loginRequired"));
      setLoadingListings(false);
      return;
    }
    try {
      const response = await listOwnerListings(
        accessToken,
        statusFilter === "all" ? undefined : statusFilter
      );
      setListings(response.items);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listings";
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setListingsError(message);
    } finally {
      setLoadingListings(false);
    }
  }

  async function requestPropertyManagementAssist() {
    if (!accessToken) {
      setPmNotice(t(loc, "loginRequired"));
      return;
    }
    setPmRequesting(true);
    setPmNotice(null);
    try {
      await createSalesLead(accessToken, {
        source: "property_management",
        notes: "Property management consultation requested from owner dashboard",
        metadata: { locale, listing_count: listings.length },
        idempotencyKey: makeIdempotencyKey("pm-assist")
      });
      setPmNotice("Request submitted. Our team will contact you shortly.");
      trackEvent("property_management_requested", { listing_count: listings.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit request";
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setPmNotice(message);
    } finally {
      setPmRequesting(false);
    }
  }

  /* Derived */
  const hasUnverified = listings.some(
    (l) => l.verificationStatus !== "verified" && l.status === "active"
  );
  const allListings = listings;
  const statusCounts = allListings.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});
  const activeCount = statusCounts.active ?? 0;
  const pendingCount = statusCounts.pending_review ?? 0;
  const draftCount = statusCounts.draft ?? 0;

  // Lead delta math
  const leadDelta = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thisWeek = leads.filter((l) => now - new Date(l.createdAt).getTime() <= sevenDays).length;
    const lastWeek = leads.filter((l) => {
      const ts = new Date(l.createdAt).getTime();
      return now - ts > sevenDays && now - ts <= 2 * sevenDays;
    }).length;
    return { thisWeek, delta: thisWeek - lastWeek };
  }, [leads]);

  const handleListingStatusChange = useCallback((id: string, newStatus: "active" | "paused") => {
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, status: newStatus } : l)));
  }, []);

  return (
    <div className="dlx">
      {/* ─── HERO ─────────────────────────────────────────────────────── */}
      <header className="dlx-hero">
        <div className="dlx-hero__aurora" aria-hidden="true" />
        <div className="dlx-hero__noise" aria-hidden="true" />
        <div className="container container--narrow dlx-hero__inner">
          <motion.div
            className="dlx-hero__copy"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <p className="dlx-hero__eyebrow">
              {isPgOperator ? "PG Operator" : "Owner"} workspace
              {lastUpdated && (
                <span className="dlx-hero__time">
                  {" · "}
                  Synced{" "}
                  {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </p>
            <h1 className="dlx-hero__title">
              {getGreeting()}
              {userName ? `, ${userName.split(" ")[0]}` : ""}
              <span className="dlx-hero__title-dot">.</span>
            </h1>
            <p className="dlx-hero__sub">
              {allListings.length === 0
                ? "Your first listing is two minutes away."
                : `${allListings.length} listings under your roof. ${leadsTotal} tenants reaching out.`}
            </p>
          </motion.div>

          <motion.div
            className="dlx-hero__actions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <Link href={newListingHref} className="dlx-cta">
              <Plus size={16} aria-hidden="true" />
              {createListingLabel}
            </Link>
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={`/${locale}/settings` as any}
              className="dlx-icon-btn"
              title="Account settings"
              aria-label="Account settings"
            >
              <Settings size={17} />
            </Link>
          </motion.div>
        </div>
      </header>

      {/* ─── STAT CARD (bridges hero into canvas) ──────────────────────── */}
      <div className="container container--narrow dlx-stats-wrap">
        <motion.div
          className="dlx-stats"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <StatChip tone="brand" label="Active" value={activeCount} help="Visible to tenants" />
          <StatChip
            tone="amber"
            label="Pending review"
            value={pendingCount}
            help="With Cribliv team"
          />
          <StatChip tone="slate" label="Drafts" value={draftCount} help="Not yet submitted" />
          <div className="dlx-stats__divider" aria-hidden="true" />
          <StatChip
            tone="trust"
            label="New leads (7d)"
            value={leadDelta.thisWeek}
            help={
              leadDelta.delta === 0
                ? "Steady"
                : `${leadDelta.delta > 0 ? "▲" : "▼"} ${Math.abs(leadDelta.delta)} vs prior 7d`
            }
            helpTone={leadDelta.delta > 0 ? "trust" : leadDelta.delta < 0 ? "danger" : undefined}
          />
          <StatChip
            tone="ghost"
            label="Total listings"
            value={allListings.length}
            help="All statuses"
          />
        </motion.div>
      </div>

      {/* ─── BODY ─────────────────────────────────────────────────────── */}
      <div className="container container--narrow dlx-body">
        {/* Verification banner */}
        {hasUnverified && activeTab === "listings" && (
          <div className="dlx-banner" role="alert">
            <span className="dlx-banner__icon">
              <AlertTriangle size={14} aria-hidden="true" />
            </span>
            <p className="dlx-banner__text">
              Some active listings aren&rsquo;t verified yet.{" "}
              <Link href={`/${locale}/owner/verification`} className="dlx-banner__link">
                Complete verification
              </Link>{" "}
              to earn the Verified badge and stronger tenant trust.
            </p>
            <Link href={`/${locale}/owner/verification`} className="dlx-banner__cta">
              Verify now <ArrowRight size={13} />
            </Link>
          </div>
        )}

        {boostNotice && activeTab === "listings" && (
          <div className="dlx-toast dlx-toast--success" role="status">
            <Sparkles size={14} aria-hidden="true" /> {boostNotice}
          </div>
        )}

        {/* Tabs */}
        <div className="dlx-tabs" role="tablist" aria-label="Dashboard sections">
          <TabButton
            active={activeTab === "listings"}
            onClick={() => setActiveTab("listings")}
            label="Listings"
            icon={<Layers size={15} aria-hidden="true" />}
            badge={allListings.length || undefined}
          />
          <TabButton
            active={activeTab === "leads"}
            onClick={() => setActiveTab("leads")}
            label="Leads"
            icon={<BarChart3 size={15} aria-hidden="true" />}
            badge={leadsTotal || undefined}
          />
        </div>

        {/* ── LISTINGS TAB ─────────────────────────────────────────── */}
        {activeTab === "listings" && (
          <section className="dlx-section">
            {/* Filter chips */}
            {allListings.length > 0 && (
              <div className="dlx-filter-row">
                {STATUS_FILTERS.map((filter) => {
                  const count =
                    filter.value === "all" ? allListings.length : (statusCounts[filter.value] ?? 0);
                  if (filter.value !== "all" && count === 0) return null;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      className={`dlx-chip${statusFilter === filter.value ? " dlx-chip--active" : ""}`}
                      onClick={() => setStatusFilter(filter.value)}
                    >
                      {filter.label}
                      {count > 0 && <span className="dlx-chip__count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {loadingListings ? (
              <div className="dlx-grid dlx-grid--listings">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="lcl lcl--skeleton" aria-hidden="true" />
                ))}
              </div>
            ) : listingsError ? (
              <div className="alert alert--error" role="alert">
                {listingsError}
              </div>
            ) : listings.length === 0 ? (
              <EmptyListings
                locale={locale}
                isPgOperator={isPgOperator}
                statusFilter={statusFilter}
                createListingLabel={createListingLabel}
                newListingHref={newListingHref}
              />
            ) : (
              <div className="dlx-grid dlx-grid--listings">
                {listings.map((listing) => (
                  <ListingCardLuxe
                    key={listing.id}
                    listing={listing}
                    locale={locale}
                    accessToken={accessToken}
                    onStatusChange={handleListingStatusChange}
                    onBoost={(l) => setBoostTarget(l)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── LEADS TAB ────────────────────────────────────────────── */}
        {activeTab === "leads" && (
          <section className="dlx-section dlx-leads">
            {!accessToken ? (
              <div className="alert alert--error">Please log in to view leads.</div>
            ) : (
              <>
                <div className="dlx-leads__toolbar">
                  <div>
                    <h2 className="dlx-leads__title">Your leads</h2>
                    <p className="dlx-leads__sub">
                      <b>{leadsTotal}</b> total · <b>{leadDelta.thisWeek}</b> this week
                      {leadDelta.delta !== 0 && (
                        <span
                          className={`dlx-leads__delta ${
                            leadDelta.delta > 0 ? "dlx-leads__delta--up" : "dlx-leads__delta--down"
                          }`}
                        >
                          {leadDelta.delta > 0 ? "▲" : "▼"} {Math.abs(leadDelta.delta)} vs last 7d
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="dlx-leads__actions">
                    <div className="dlx-search">
                      <Search size={15} className="dlx-search__icon" aria-hidden="true" />
                      <input
                        type="search"
                        placeholder="Search tenant, listing, phone…"
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        aria-label="Search leads"
                      />
                    </div>

                    <div className="dlx-toggle" role="group" aria-label="View mode">
                      <button
                        type="button"
                        aria-pressed={view === "board"}
                        onClick={() => setView("board")}
                      >
                        <LayoutGrid size={13} aria-hidden="true" /> Board
                      </button>
                      <button
                        type="button"
                        aria-pressed={view === "list"}
                        onClick={() => setView("list")}
                      >
                        <List size={13} aria-hidden="true" /> List
                      </button>
                    </div>

                    <a
                      href="/v1/owner/leads/export"
                      className="dlx-export"
                      download
                      onClick={() => track("lead_csv_exported")}
                    >
                      <Download size={13} aria-hidden="true" /> Export
                    </a>
                  </div>
                </div>

                <LeadStatsWidget accessToken={accessToken} />

                <div className="dlx-leads__board">
                  {leadsError ? (
                    <div className="alert alert--error" role="alert">
                      {leadsError}
                    </div>
                  ) : leadsLoading ? (
                    <LeadKanbanSkeleton />
                  ) : view === "board" ? (
                    <LeadKanban
                      accessToken={accessToken}
                      leads={leads}
                      onLeadsChange={setLeads}
                      searchQuery={leadSearch}
                      enableDrag={canDrag}
                    />
                  ) : (
                    <LeadsPipeline accessToken={accessToken} />
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ─── FOOTER CARDS ────────────────────────────────────────── */}
        <div className="dlx-footer">
          <div className="dlx-footer__card">
            <span className="dlx-footer__icon dlx-footer__icon--trust">
              <ShieldCheck size={18} />
            </span>
            <div className="dlx-footer__text">
              <span className="dlx-footer__label">{t(loc, "verification")}</span>
              <span className="dlx-footer__sub">Earn the verified badge in under 3 minutes.</span>
            </div>
            <Link className="dlx-footer__btn" href={`/${locale}/owner/verification`}>
              Verify <ArrowRight size={13} />
            </Link>
          </div>

          <div className="dlx-footer__card">
            <span className="dlx-footer__icon dlx-footer__icon--brand">
              <Building size={18} />
            </span>
            <div className="dlx-footer__text">
              <span className="dlx-footer__label">Property management</span>
              <span className="dlx-footer__sub">
                Hands-off onboarding & operations support from our team.
              </span>
            </div>
            <button
              type="button"
              className="dlx-footer__btn"
              onClick={() => void requestPropertyManagementAssist()}
              disabled={pmRequesting}
            >
              {pmRequesting ? "Sending…" : "Get help"} <ArrowRight size={13} />
            </button>
          </div>

          {pmNotice && (
            <p className="dlx-footer__notice" role="status">
              {pmNotice}
            </p>
          )}
        </div>
      </div>

      {boostTarget && accessToken && (
        <BoostModal
          listingId={boostTarget.id}
          listingTitle={boostTarget.title}
          accessToken={accessToken}
          isOpen={true}
          onClose={() => setBoostTarget(null)}
          onSuccess={(paymentId) => {
            setBoostTarget(null);
            setBoostNotice(`Boost activated. Payment ID: ${paymentId.slice(0, 12)}…`);
            setTimeout(() => setBoostNotice(null), 8000);
          }}
        />
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function StatChip({
  tone,
  label,
  value,
  help,
  helpTone
}: {
  tone: "brand" | "trust" | "amber" | "slate" | "ghost";
  label: string;
  value: number;
  help?: string;
  helpTone?: "trust" | "danger";
}) {
  return (
    <div className={`dlx-stat dlx-stat--${tone}`}>
      <span className="dlx-stat__num">{value}</span>
      <span className="dlx-stat__label">{label}</span>
      {help && (
        <span className={`dlx-stat__help${helpTone ? ` dlx-stat__help--${helpTone}` : ""}`}>
          {help}
        </span>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  badge
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`dlx-tab${active ? " dlx-tab--active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 && <span className="dlx-tab__badge">{badge}</span>}
      {active && (
        <motion.span
          className="dlx-tab__underline"
          layoutId="dlx-tab-underline"
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
        />
      )}
    </button>
  );
}

function EmptyListings({
  locale,
  isPgOperator,
  statusFilter,
  createListingLabel,
  newListingHref
}: {
  locale: string;
  isPgOperator: boolean;
  statusFilter: ListingStatus | "all";
  createListingLabel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newListingHref: any;
}) {
  const loc = locale as Locale;
  return (
    <div className="dlx-empty">
      <div className="dlx-empty__art" aria-hidden="true">
        <Home size={26} />
      </div>
      <h3 className="dlx-empty__title" style={{ fontFamily: "var(--font-display)" }}>
        {statusFilter === "all" ? "Your portfolio starts here." : "Nothing in this lane yet."}
      </h3>
      <p className="dlx-empty__desc">
        {isPgOperator
          ? "Add your first PG to start receiving verified tenant enquiries."
          : statusFilter === "all"
            ? t(loc, "noListingsDescription")
            : "Switch filters or create a new listing to fill this lane."}
      </p>
      <Link href={newListingHref} className="dlx-cta dlx-cta--quiet">
        <Plus size={15} /> {createListingLabel}
      </Link>
    </div>
  );
}
