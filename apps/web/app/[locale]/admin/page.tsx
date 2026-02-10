"use client";

import { useEffect, useState } from "react";
import { clearAuthSession, readAuthSession } from "../../../lib/client-auth";
import { trackEvent } from "../../../lib/analytics";
import {
  decideAdminListing,
  decideAdminVerification,
  fetchAdminListings,
  fetchAdminLeads,
  fetchAdminVerifications,
  updateAdminLeadStatus,
  type AdminLeadVm,
  type AdminListingVm,
  type AdminVerificationVm
} from "../../../lib/admin-api";
import { t, type Locale } from "../../../lib/i18n";

type ListingDecision = "approve" | "reject" | "pause";
type VerificationDecision = "pass" | "fail" | "manual_review";
type LeadStatus = "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
type ActiveTab = "listings" | "verifications" | "leads";

export default function AdminDashboardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;

  const [activeTab, setActiveTab] = useState<ActiveTab>("listings");

  const [listings, setListings] = useState<AdminListingVm[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingReasons, setListingReasons] = useState<Record<string, string>>({});
  const [listingErrors, setListingErrors] = useState<Record<string, string>>({});
  const [listingProcessing, setListingProcessing] = useState<Record<string, boolean>>({});

  const [verifications, setVerifications] = useState<AdminVerificationVm[]>([]);
  const [verificationsLoading, setVerificationsLoading] = useState(true);
  const [verificationsError, setVerificationsError] = useState<string | null>(null);
  const [verificationReasons, setVerificationReasons] = useState<Record<string, string>>({});
  const [verificationErrors, setVerificationErrors] = useState<Record<string, string>>({});
  const [verificationProcessing, setVerificationProcessing] = useState<Record<string, boolean>>({});

  const [leads, setLeads] = useState<AdminLeadVm[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [leadReasons, setLeadReasons] = useState<Record<string, string>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [leadProcessing, setLeadProcessing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadListings();
    void loadVerifications();
    void loadLeads();
  }, []);

  function getToken() {
    return readAuthSession()?.access_token ?? null;
  }

  async function loadListings() {
    setListingsLoading(true);
    setListingsError(null);

    const token = getToken();
    if (!token) {
      setListingsError(t(locale, "loginRequired"));
      setListingsLoading(false);
      return;
    }

    try {
      const response = await fetchAdminListings(token);
      setListings(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listings";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setListingsError(message);
    } finally {
      setListingsLoading(false);
    }
  }

  async function loadVerifications() {
    setVerificationsLoading(true);
    setVerificationsError(null);

    const token = getToken();
    if (!token) {
      setVerificationsError(t(locale, "loginRequired"));
      setVerificationsLoading(false);
      return;
    }

    try {
      const response = await fetchAdminVerifications(token);
      setVerifications(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load verifications";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setVerificationsError(message);
    } finally {
      setVerificationsLoading(false);
    }
  }

  async function loadLeads() {
    setLeadsLoading(true);
    setLeadsError(null);

    const token = getToken();
    if (!token) {
      setLeadsError(t(locale, "loginRequired"));
      setLeadsLoading(false);
      return;
    }

    try {
      const response = await fetchAdminLeads(token);
      setLeads(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load leads";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setLeadsError(message);
    } finally {
      setLeadsLoading(false);
    }
  }

  async function handleListingDecision(listingId: string, decision: ListingDecision) {
    if (decision === "reject" || decision === "pause") {
      const reason = (listingReasons[listingId] || "").trim();
      if (!reason) {
        setListingErrors((previous) => ({
          ...previous,
          [listingId]: t(locale, "reasonRequired")
        }));
        return;
      }
    }

    const token = getToken();
    if (!token) {
      return;
    }

    setListingProcessing((previous) => ({ ...previous, [listingId]: true }));
    setListingErrors((previous) => ({ ...previous, [listingId]: "" }));

    try {
      const reason = (listingReasons[listingId] || "").trim();
      await decideAdminListing(token, listingId, decision, reason || undefined);

      trackEvent("admin_listing_decision", {
        listing_id: listingId,
        decision
      });

      setListings((previous) => previous.filter((item) => item.id !== listingId));
      setListingReasons((previous) => {
        const next = { ...previous };
        delete next[listingId];
        return next;
      });
    } catch (err) {
      setListingErrors((previous) => ({
        ...previous,
        [listingId]: err instanceof Error ? err.message : "Decision failed"
      }));
    } finally {
      setListingProcessing((previous) => ({ ...previous, [listingId]: false }));
    }
  }

  async function handleVerificationDecision(attemptId: string, decision: VerificationDecision) {
    if (decision === "fail") {
      const reason = (verificationReasons[attemptId] || "").trim();
      if (!reason) {
        setVerificationErrors((previous) => ({
          ...previous,
          [attemptId]: t(locale, "reasonRequired")
        }));
        return;
      }
    }

    const token = getToken();
    if (!token) {
      return;
    }

    setVerificationProcessing((previous) => ({ ...previous, [attemptId]: true }));
    setVerificationErrors((previous) => ({ ...previous, [attemptId]: "" }));

    try {
      const reason = (verificationReasons[attemptId] || "").trim();
      await decideAdminVerification(token, attemptId, decision, reason || undefined);

      trackEvent("admin_verification_decision", {
        attempt_id: attemptId,
        decision
      });

      setVerifications((previous) => previous.filter((item) => item.id !== attemptId));
      setVerificationReasons((previous) => {
        const next = { ...previous };
        delete next[attemptId];
        return next;
      });
    } catch (err) {
      setVerificationErrors((previous) => ({
        ...previous,
        [attemptId]: err instanceof Error ? err.message : "Decision failed"
      }));
    } finally {
      setVerificationProcessing((previous) => ({ ...previous, [attemptId]: false }));
    }
  }

  async function handleLeadStatus(leadId: string, status: LeadStatus) {
    const token = getToken();
    if (!token) {
      return;
    }

    setLeadProcessing((previous) => ({ ...previous, [leadId]: true }));
    setLeadErrors((previous) => ({ ...previous, [leadId]: "" }));

    try {
      const reason = (leadReasons[leadId] || "").trim();
      await updateAdminLeadStatus(token, leadId, status, reason || undefined);
      trackEvent("admin_lead_status_updated", {
        lead_id: leadId,
        status
      });
      setLeads((previous) =>
        previous.map((lead) => (lead.id === leadId ? { ...lead, status } : lead))
      );
      setLeadReasons((previous) => ({
        ...previous,
        [leadId]: ""
      }));
    } catch (err) {
      setLeadErrors((previous) => ({
        ...previous,
        [leadId]: err instanceof Error ? err.message : "Lead update failed"
      }));
    } finally {
      setLeadProcessing((previous) => ({ ...previous, [leadId]: false }));
    }
  }

  function renderListingQueue() {
    if (listingsLoading) {
      return (
        <div aria-busy="true">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton skeleton--card" />
          ))}
        </div>
      );
    }

    if (listingsError) {
      return (
        <div className="panel warning-box" role="alert">
          {listingsError}
        </div>
      );
    }

    if (listings.length === 0) {
      return (
        <div className="empty-state">
          <h3>No listings pending review</h3>
          <p>All submitted listings have been reviewed.</p>
        </div>
      );
    }

    return (
      <div>
        {listings.map((listing) => {
          const processing = listingProcessing[listing.id] || false;
          const fieldError = listingErrors[listing.id] || "";

          return (
            <div key={listing.id} className="queue-card">
              <div className="queue-card__header">
                <div>
                  <h3 className="queue-card__title">{listing.title || "Untitled"}</h3>
                  <div className="queue-card__meta">
                    {listing.city || "City unknown"} &middot;{" "}
                    {listing.listingType === "pg" ? "PG" : "Flat/House"}
                    {typeof listing.monthlyRent === "number" ? (
                      <> &middot; ₹{listing.monthlyRent.toLocaleString("en-IN")}/month</>
                    ) : null}{" "}
                    &middot; Owner: {listing.ownerUserId}
                  </div>
                </div>
                <span className={`status-pill status-pill--${listing.status}`}>
                  {listing.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="queue-card__meta">
                Submitted:{" "}
                {new Date(listing.createdAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}{" "}
                &middot; Verification:{" "}
                <span className={`status-pill status-pill--${listing.verificationStatus}`}>
                  {listing.verificationStatus}
                </span>
              </div>

              <div>
                <label htmlFor={`reason-listing-${listing.id}`} className="form-label">
                  Reason (required for reject/pause)
                </label>
                <textarea
                  id={`reason-listing-${listing.id}`}
                  className="reason-input"
                  placeholder="Enter reason for rejection or pause..."
                  value={listingReasons[listing.id] || ""}
                  onChange={(event) =>
                    setListingReasons((previous) => ({
                      ...previous,
                      [listing.id]: event.target.value
                    }))
                  }
                />
                {fieldError ? <p className="form-error">{fieldError}</p> : null}
              </div>

              <div className="queue-card__actions">
                <button
                  type="button"
                  className="btn-sm btn-sm--approve"
                  disabled={processing}
                  onClick={() => handleListingDecision(listing.id, "approve")}
                >
                  {t(locale, "approve")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--reject"
                  disabled={processing}
                  onClick={() => handleListingDecision(listing.id, "reject")}
                >
                  {t(locale, "reject")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--warn"
                  disabled={processing}
                  onClick={() => handleListingDecision(listing.id, "pause")}
                >
                  {t(locale, "pause")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderVerificationQueue() {
    if (verificationsLoading) {
      return (
        <div aria-busy="true">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton skeleton--card" />
          ))}
        </div>
      );
    }

    if (verificationsError) {
      return (
        <div className="panel warning-box" role="alert">
          {verificationsError}
        </div>
      );
    }

    if (verifications.length === 0) {
      return (
        <div className="empty-state">
          <h3>No verifications pending review</h3>
          <p>All submitted verifications have been reviewed.</p>
        </div>
      );
    }

    return (
      <div>
        {verifications.map((verification) => {
          const processing = verificationProcessing[verification.id] || false;
          const fieldError = verificationErrors[verification.id] || "";

          return (
            <div key={verification.id} className="queue-card">
              <div className="queue-card__header">
                <div>
                  <h3 className="queue-card__title">
                    {verification.verificationType === "video_liveness"
                      ? "Video Liveness"
                      : "Electricity Bill Match"}
                  </h3>
                  <div className="queue-card__meta">
                    User: {verification.userId}
                    {verification.listingId ? (
                      <> &middot; Listing: {verification.listingId}</>
                    ) : null}
                    {verification.provider ? (
                      <> &middot; Provider: {verification.provider}</>
                    ) : null}
                    {verification.providerResultCode ? (
                      <> &middot; Result code: {verification.providerResultCode}</>
                    ) : null}
                    {verification.providerReference ? (
                      <> &middot; Ref: {verification.providerReference}</>
                    ) : null}
                    {typeof verification.addressMatchScore === "number" ? (
                      <> &middot; Address score: {verification.addressMatchScore}%</>
                    ) : null}
                    {typeof verification.livenessScore === "number" ? (
                      <> &middot; Liveness score: {verification.livenessScore}%</>
                    ) : null}
                    {verification.retryable ? <> &middot; Retryable provider error</> : null}
                  </div>
                </div>
                <span className={`status-pill status-pill--${verification.result}`}>
                  {verification.result.replace(/_/g, " ")}
                </span>
              </div>

              {verification.machineResult ? (
                <div className="queue-card__meta">
                  Machine result:{" "}
                  <span className={`status-pill status-pill--${verification.machineResult}`}>
                    {verification.machineResult.replace(/_/g, " ")}
                  </span>
                </div>
              ) : null}
              {verification.reviewReason ? (
                <div className="queue-card__meta">Review reason: {verification.reviewReason}</div>
              ) : null}

              <div className="queue-card__meta">
                Submitted:{" "}
                {new Date(verification.createdAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>

              <div>
                <label htmlFor={`reason-ver-${verification.id}`} className="form-label">
                  Reason (required for fail)
                </label>
                <textarea
                  id={`reason-ver-${verification.id}`}
                  className="reason-input"
                  placeholder="Enter reason for failure..."
                  value={verificationReasons[verification.id] || ""}
                  onChange={(event) =>
                    setVerificationReasons((previous) => ({
                      ...previous,
                      [verification.id]: event.target.value
                    }))
                  }
                />
                {fieldError ? <p className="form-error">{fieldError}</p> : null}
              </div>

              <div className="queue-card__actions">
                <button
                  type="button"
                  className="btn-sm btn-sm--approve"
                  disabled={processing}
                  onClick={() => handleVerificationDecision(verification.id, "pass")}
                >
                  {t(locale, "pass")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--reject"
                  disabled={processing}
                  onClick={() => handleVerificationDecision(verification.id, "fail")}
                >
                  {t(locale, "fail")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--warn"
                  disabled={processing}
                  onClick={() => handleVerificationDecision(verification.id, "manual_review")}
                >
                  {t(locale, "manualReview")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderLeadQueue() {
    if (leadsLoading) {
      return (
        <div aria-busy="true">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton skeleton--card" />
          ))}
        </div>
      );
    }

    if (leadsError) {
      return (
        <div className="panel warning-box" role="alert">
          {leadsError}
        </div>
      );
    }

    if (leads.length === 0) {
      return (
        <div className="empty-state">
          <h3>No sales leads yet</h3>
          <p>New leads from PG sales assist and property management requests will appear here.</p>
        </div>
      );
    }

    return (
      <div>
        {leads.map((lead) => {
          const processing = leadProcessing[lead.id] || false;
          const fieldError = leadErrors[lead.id] || "";

          return (
            <div key={lead.id} className="queue-card">
              <div className="queue-card__header">
                <div>
                  <h3 className="queue-card__title">
                    {lead.source === "pg_sales_assist"
                      ? "PG Sales Assist Lead"
                      : "Property Management Lead"}
                  </h3>
                  <div className="queue-card__meta">
                    Owner: {lead.createdByUserId}
                    {lead.listingId ? <> &middot; Listing: {lead.listingId}</> : null}
                    {lead.notes ? <> &middot; {lead.notes}</> : null}
                  </div>
                </div>
                <span className={`status-pill status-pill--${lead.status}`}>
                  {lead.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="queue-card__meta">
                Created:{" "}
                {new Date(lead.createdAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
                {" · "}CRM: {lead.crmSyncStatus}
                {lead.lastCrmPushAt ? (
                  <> (last push {new Date(lead.lastCrmPushAt).toLocaleString("en-IN")})</>
                ) : null}
              </div>

              <div>
                <label htmlFor={`reason-lead-${lead.id}`} className="form-label">
                  Note (optional)
                </label>
                <textarea
                  id={`reason-lead-${lead.id}`}
                  className="reason-input"
                  placeholder="Add context for this status change..."
                  value={leadReasons[lead.id] || ""}
                  onChange={(event) =>
                    setLeadReasons((previous) => ({
                      ...previous,
                      [lead.id]: event.target.value
                    }))
                  }
                />
                {fieldError ? <p className="form-error">{fieldError}</p> : null}
              </div>

              <div className="queue-card__actions">
                <button
                  type="button"
                  className="btn-sm btn-sm--warn"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "contacted")}
                >
                  Mark Contacted
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--approve"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "qualified")}
                >
                  Mark Qualified
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "closed_won")}
                >
                  Close Won
                </button>
                <button
                  type="button"
                  className="btn-sm btn-sm--reject"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "closed_lost")}
                >
                  Close Lost
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="hero">
      <h1>{t(locale, "adminDashboard")}</h1>

      <div className="tab-row" role="tablist" aria-label="Admin queues">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "listings"}
          className={`tab-btn${activeTab === "listings" ? " tab-btn--active" : ""}`}
          onClick={() => setActiveTab("listings")}
        >
          {t(locale, "listingReviewQueue")} ({listings.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "verifications"}
          className={`tab-btn${activeTab === "verifications" ? " tab-btn--active" : ""}`}
          onClick={() => setActiveTab("verifications")}
        >
          {t(locale, "verificationQueue")} ({verifications.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "leads"}
          className={`tab-btn${activeTab === "leads" ? " tab-btn--active" : ""}`}
          onClick={() => setActiveTab("leads")}
        >
          Sales Leads ({leads.length})
        </button>
      </div>

      {activeTab === "listings"
        ? renderListingQueue()
        : activeTab === "verifications"
          ? renderVerificationQueue()
          : renderLeadQueue()}
    </section>
  );
}
