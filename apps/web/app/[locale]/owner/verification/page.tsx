"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchVerificationStatus,
  listOwnerListings,
  submitElectricityVerification,
  submitVideoVerification,
  type VerificationAttemptVm,
  type VerificationStatusVm
} from "../../../../lib/owner-api";
import { readAuthSession } from "../../../../lib/client-auth";
import { trackEvent } from "../../../../lib/analytics";
import { t, type Locale } from "../../../../lib/i18n";

interface ListingOption {
  id: string;
  title: string;
}

const RESULT_COPY: Record<
  string,
  { heading: string; description: string; headingHi: string; descHi: string }
> = {
  verified: {
    heading: "Verification Passed",
    description: "Your identity is verified. Tenants will see a Verified badge on your listing.",
    headingHi: "वेरिफिकेशन पास",
    descHi: "आपकी पहचान वेरिफाइड है। किरायेदारों को आपकी लिस्टिंग पर Verified बैज दिखेगा।"
  },
  failed: {
    heading: "Verification Failed",
    description: "We could not verify this listing. Re-submit with clearer details.",
    headingHi: "वेरिफिकेशन फेल",
    descHi: "हम इस लिस्टिंग को वेरिफाई नहीं कर सके। कृपया स्पष्ट जानकारी के साथ दोबारा सबमिट करें।"
  },
  pending: {
    heading: "Verification In Progress",
    description: "Your submission is being reviewed.",
    headingHi: "वेरिफिकेशन प्रक्रिया में",
    descHi: "आपकी सबमिशन की समीक्षा चल रही है।"
  },
  unverified: {
    heading: "Get Verified",
    description: "Complete verification to build trust and improve lead quality.",
    headingHi: "वेरिफाइड हों",
    descHi: "भरोसा बढ़ाने और बेहतर लीड पाने के लिए वेरिफिकेशन पूरा करें।"
  }
};

function getAttemptLabel(attempt: VerificationAttemptVm) {
  return attempt.verificationType === "video_liveness" ? "Video selfie" : "Electricity bill";
}

function resultToOverall(result: "pending" | "pass" | "fail" | "manual_review") {
  if (result === "pass") {
    return "verified" as const;
  }
  if (result === "fail") {
    return "failed" as const;
  }
  return "pending" as const;
}

export default function OwnerVerificationPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;

  const [listings, setListings] = useState<ListingOption[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<string>("");

  const [status, setStatus] = useState<VerificationStatusVm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [videoArtifactPath, setVideoArtifactPath] = useState("");
  const [videoVendorReference, setVideoVendorReference] = useState("");

  const [consumerId, setConsumerId] = useState("");
  const [addressText, setAddressText] = useState("");
  const [billArtifactPath, setBillArtifactPath] = useState("");

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!selectedListingId) {
      setStatus(null);
      return;
    }

    void loadStatus(selectedListingId);
  }, [selectedListingId]);

  async function initialize() {
    setLoading(true);
    setError(null);

    const session = readAuthSession();
    const token = session?.access_token;

    if (!token) {
      setError(t(locale, "loginRequired"));
      setLoading(false);
      return;
    }

    try {
      const response = await listOwnerListings(token);
      const mappedListings = response.items.map((listing) => ({
        id: listing.id,
        title: listing.title
      }));

      setListings(mappedListings);
      const firstId = mappedListings[0]?.id ?? "";
      setSelectedListingId(firstId);

      if (!firstId) {
        setError("Create a listing first, then complete owner verification.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listings";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatus(listingId: string) {
    const token = readAuthSession()?.access_token;
    if (!token) {
      setError(t(locale, "loginRequired"));
      return;
    }

    try {
      const response = await fetchVerificationStatus(token, listingId);
      setStatus(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load verification status";
      setError(message);
      setStatus(null);
    }
  }

  async function onSubmitVideo() {
    const token = readAuthSession()?.access_token;
    if (!token) {
      setError(t(locale, "loginRequired"));
      return;
    }

    if (!selectedListingId || !videoArtifactPath.trim()) {
      setError("Select listing and provide artifact path for video verification.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(null);

    try {
      const result = await submitVideoVerification(token, {
        listingId: selectedListingId,
        artifactBlobPath: videoArtifactPath.trim(),
        vendorReference: videoVendorReference.trim() || undefined
      });

      trackEvent("verification_video_submitted", {
        attempt_id: result.attemptId,
        result: result.result
      });
      setSubmitSuccess("Video verification submitted.");
      await loadStatus(selectedListingId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Video submission failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitElectricity() {
    const token = readAuthSession()?.access_token;
    if (!token) {
      setError(t(locale, "loginRequired"));
      return;
    }

    if (!selectedListingId || !consumerId.trim() || !addressText.trim()) {
      setError("Select listing, consumer ID, and address for electricity verification.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(null);

    try {
      const result = await submitElectricityVerification(token, {
        listingId: selectedListingId,
        consumerId: consumerId.trim(),
        addressText: addressText.trim(),
        billArtifactBlobPath: billArtifactPath.trim() || undefined
      });

      trackEvent("verification_bill_submitted", {
        attempt_id: result.attemptId,
        address_match_score: result.addressMatchScore,
        result: result.result
      });
      setSubmitSuccess(`Electricity verification submitted (score: ${result.addressMatchScore}%).`);
      await loadStatus(selectedListingId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Electricity submission failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const latestAttempt = status?.attempts?.[0];
  const latestScore = useMemo(() => {
    const electricityAttempt = status?.attempts.find(
      (attempt) => attempt.addressMatchScore != null
    );
    return electricityAttempt?.addressMatchScore ?? null;
  }, [status?.attempts]);

  const threshold = latestAttempt?.threshold ?? 85;
  const overall = status?.overallStatus ?? "unverified";
  const copy = RESULT_COPY[overall] ?? RESULT_COPY.unverified;

  const uiStatus = latestAttempt ? resultToOverall(latestAttempt.result) : overall;
  const scoreClass =
    uiStatus === "verified"
      ? "score-bar__fill--pass"
      : uiStatus === "failed"
        ? "score-bar__fill--fail"
        : "score-bar__fill--review";

  if (loading) {
    return (
      <section className="hero">
        <h1>{t(locale, "verification")}</h1>
        <div aria-busy="true">
          <div className="skeleton skeleton--card" />
          <div className="skeleton skeleton--card" />
        </div>
      </section>
    );
  }

  return (
    <section className="hero">
      <h1>{t(locale, "verification")}</h1>

      {error ? (
        <div className="panel warning-box" role="alert">
          {error}
        </div>
      ) : null}

      {submitSuccess ? (
        <div className="success-box" role="status">
          {submitSuccess}
        </div>
      ) : null}

      <div className="panel">
        <div className="form-group">
          <label className="form-label" htmlFor="verification-listing">
            Listing
          </label>
          <select
            id="verification-listing"
            className="form-select"
            value={selectedListingId}
            onChange={(event) => setSelectedListingId(event.target.value)}
          >
            <option value="">Select listing...</option>
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        <div className="card-row">
          <div>
            <h3 style={{ margin: 0 }}>{locale === "hi" ? copy.headingHi : copy.heading}</h3>
            <p className="muted-text">{locale === "hi" ? copy.descHi : copy.description}</p>
          </div>
          <span className={`status-pill status-pill--${uiStatus}`}>{uiStatus}</span>
        </div>

        {latestScore != null ? (
          <div className="score-bar-wrap">
            <div className="score-bar">
              <div
                className={`score-bar__fill ${scoreClass}`}
                style={{ width: `${Math.min(latestScore, 100)}%` }}
              />
              <div
                className="score-bar__threshold"
                style={{ left: `${threshold}%` }}
                title={`Threshold: ${threshold}%`}
              />
            </div>
            <div className="score-bar__label">
              <span>Score: {latestScore}%</span>
              <span>Threshold: {threshold}%</span>
            </div>
          </div>
        ) : (
          <p className="muted-text">No address match score yet. Threshold is fixed at 85%.</p>
        )}
      </div>

      <div className="panel">
        <h3>Video verification</h3>
        <div className="form-group">
          <label className="form-label" htmlFor="video-artifact-path">
            Artifact blob path
          </label>
          <input
            id="video-artifact-path"
            className="form-input"
            value={videoArtifactPath}
            onChange={(event) => setVideoArtifactPath(event.target.value)}
            placeholder="verification-artifacts/video-selfie.mp4"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="video-vendor-ref">
            Vendor reference (optional)
          </label>
          <input
            id="video-vendor-ref"
            className="form-input"
            value={videoVendorReference}
            onChange={(event) => setVideoVendorReference(event.target.value)}
            placeholder="vendor-ref-123"
          />
        </div>
        <button
          type="button"
          className="primary"
          onClick={onSubmitVideo}
          disabled={submitting || !selectedListingId}
        >
          {submitting ? "Submitting..." : "Submit Video Verification"}
        </button>
      </div>

      <div className="panel">
        <h3>Electricity verification</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="consumer-id">
              Consumer ID
            </label>
            <input
              id="consumer-id"
              className="form-input"
              value={consumerId}
              onChange={(event) => setConsumerId(event.target.value)}
              placeholder="Consumer ID"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="bill-artifact-path">
              Bill artifact path (optional)
            </label>
            <input
              id="bill-artifact-path"
              className="form-input"
              value={billArtifactPath}
              onChange={(event) => setBillArtifactPath(event.target.value)}
              placeholder="verification-artifacts/electricity-bill.pdf"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="address-text">
            Address text
          </label>
          <textarea
            id="address-text"
            className="form-textarea"
            value={addressText}
            onChange={(event) => setAddressText(event.target.value)}
            placeholder="Enter bill address text for fuzzy match"
          />
          <p className="form-hint">Address match threshold is 85%.</p>
        </div>

        <button
          type="button"
          className="primary"
          onClick={onSubmitElectricity}
          disabled={submitting || !selectedListingId}
        >
          {submitting ? "Submitting..." : "Submit Electricity Verification"}
        </button>
      </div>

      {status && status.attempts.length > 0 ? (
        <div className="panel">
          <h3>Submission history</h3>
          <div className="verification-timeline">
            {status.attempts.map((attempt) => (
              <div key={attempt.id} className="timeline-item">
                <div
                  className={`timeline-dot ${
                    attempt.result === "pass"
                      ? "timeline-dot--done"
                      : attempt.result === "fail"
                        ? "timeline-dot--fail"
                        : "timeline-dot--active"
                  }`}
                >
                  {attempt.result === "pass" ? "✓" : attempt.result === "fail" ? "✗" : "..."}
                </div>
                <div className="timeline-content">
                  <h4>{getAttemptLabel(attempt)}</h4>
                  <p>
                    Status:{" "}
                    <span className={`status-pill status-pill--${attempt.result}`}>
                      {attempt.result}
                    </span>
                  </p>
                  {attempt.addressMatchScore != null ? (
                    <p>Address match score: {attempt.addressMatchScore}%</p>
                  ) : null}
                  {attempt.livenessScore != null ? (
                    <p>Liveness score: {attempt.livenessScore}%</p>
                  ) : null}
                  <p>
                    Submitted:{" "}
                    {new Date(attempt.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
