"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  fetchVerificationStatus,
  friendlyVerificationArtifactUploadError,
  isVerificationUploadAbortError,
  listOwnerListings,
  submitElectricityVerification,
  submitVideoVerification,
  uploadVerificationArtifact,
  type VerificationAttemptVm,
  type VerificationStatusVm
} from "../../lib/owner-api";
import { trackEvent } from "../../lib/analytics";
import { t, type Locale } from "../../lib/i18n";
import {
  VerificationArtifactField,
  type VerificationArtifactFieldCopy
} from "./verification-artifact-field";

type VerificationMethod = "video" | "electricity";
type ArtifactStatus = "idle" | "uploading" | "ready" | "error";

interface ListingOption {
  id: string;
  title: string;
}

interface ArtifactState {
  file: File | null;
  status: ArtifactStatus;
  progress: number;
  blobPath?: string;
  error?: string;
}

const EMPTY_ARTIFACT: ArtifactState = {
  file: null,
  status: "idle",
  progress: 0
};

function resultToOverall(result: VerificationAttemptVm["result"]) {
  if (result === "pass") return "verified" as const;
  if (result === "fail") return "failed" as const;
  return "pending" as const;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function requestErrorCopy(locale: Locale, fallbackKey: string, error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  if (status === 401 || message.includes("unauthorized")) return t(locale, "loginRequired");
  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("offline")
  ) {
    return t(locale, "verificationErrorNetwork");
  }
  return t(locale, fallbackKey);
}

function attemptLabel(locale: Locale, attempt: VerificationAttemptVm) {
  return attempt.verificationType === "video_liveness"
    ? t(locale, "verificationHistoryVideo")
    : t(locale, "verificationHistoryElectricity");
}

function resultLabel(locale: Locale, result: VerificationAttemptVm["result"]) {
  const keys: Record<VerificationAttemptVm["result"], string> = {
    pending: "verificationResultPending",
    pass: "pass",
    fail: "fail",
    manual_review: "manualReview"
  };
  return t(locale, keys[result]);
}

function statusLabel(locale: Locale, status: VerificationStatusVm["overallStatus"]) {
  const keys: Record<VerificationStatusVm["overallStatus"], string> = {
    unverified: "unverified",
    pending: "verificationResultPending",
    verified: "verified",
    failed: "verificationStatusFailed"
  };
  return t(locale, keys[status]);
}

function resultStatusCopy(locale: Locale, overall: VerificationStatusVm["overallStatus"]) {
  const copy: Record<
    VerificationStatusVm["overallStatus"],
    { heading: string; description: string }
  > = {
    verified: {
      heading: t(locale, "verificationPassedTitle"),
      description: t(locale, "verificationPassedBody")
    },
    failed: {
      heading: t(locale, "verificationFailedTitle"),
      description: t(locale, "verificationFailedBody")
    },
    pending: {
      heading: t(locale, "verificationPendingTitle"),
      description: t(locale, "verificationPendingBody")
    },
    unverified: {
      heading: t(locale, "verificationUnverifiedTitle"),
      description: t(locale, "verificationUnverifiedBody")
    }
  };
  return copy[overall] ?? copy.unverified;
}

function formatDate(value: string, locale: Locale) {
  return new Date(value).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function VerificationClient({ locale }: { locale: Locale }) {
  const searchParams = useSearchParams();
  const requestedListingId = searchParams.get("listing") ?? "";
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const accessToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;

  const [listings, setListings] = useState<ListingOption[]>([]);
  const [selectedListingId, setSelectedListingId] = useState("");
  const [status, setStatus] = useState<VerificationStatusVm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [method, setMethod] = useState<VerificationMethod>("video");
  const [submitting, setSubmitting] = useState(false);

  const [videoArtifact, setVideoArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);
  const [billArtifact, setBillArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);
  const [videoVendorReference, setVideoVendorReference] = useState("");
  const [consumerId, setConsumerId] = useState("");
  const [addressText, setAddressText] = useState("");
  const videoUploadControllerRef = useRef<AbortController | null>(null);
  const billUploadControllerRef = useRef<AbortController | null>(null);

  const artifactCopy: VerificationArtifactFieldCopy = {
    selectFile: t(locale, "verificationSelectFile"),
    retry: t(locale, "verificationRetryUpload"),
    remove: t(locale, "verificationRemoveFile"),
    ready: t(locale, "verificationUploadReady"),
    noFile: t(locale, "verificationNoFileSelected"),
    uploaded: t(locale, "verificationUploaded")
  };

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError(null);

      if (!accessToken) {
        setError(t(locale, "loginRequired"));
        setLoading(false);
        return;
      }

      try {
        const response = await listOwnerListings(accessToken);
        if (!active) return;
        const mapped = response.items.map((listing) => ({
          id: listing.id,
          title: listing.title
        }));
        setListings(mapped);
        const requested = mapped.find((listing) => listing.id === requestedListingId)?.id;
        const firstId = requested ?? mapped[0]?.id ?? "";
        setSelectedListingId(firstId);
        if (!firstId) setError(t(locale, "verificationCreateListingFirst"));
      } catch (err) {
        if (active) setError(requestErrorCopy(locale, "verificationErrorLoadListings", err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [accessToken, locale, requestedListingId]);

  const loadStatus = useCallback(
    async (listingId: string) => {
      if (!accessToken) {
        setError(t(locale, "loginRequired"));
        return;
      }

      try {
        const response = await fetchVerificationStatus(accessToken, listingId);
        setStatus(response);
      } catch (err) {
        setStatus(null);
        setError(requestErrorCopy(locale, "verificationErrorLoadStatus", err));
      }
    },
    [accessToken, locale]
  );

  const abortArtifactUpload = useCallback((kind: "video_liveness" | "electricity_bill") => {
    const ref = kind === "video_liveness" ? videoUploadControllerRef : billUploadControllerRef;
    ref.current?.abort();
    ref.current = null;
  }, []);

  const abortAllArtifactUploads = useCallback(() => {
    videoUploadControllerRef.current?.abort();
    videoUploadControllerRef.current = null;
    billUploadControllerRef.current?.abort();
    billUploadControllerRef.current = null;
  }, []);

  useEffect(() => () => abortAllArtifactUploads(), [abortAllArtifactUploads]);

  const resetArtifactState = useCallback(() => {
    abortAllArtifactUploads();
    setVideoArtifact(EMPTY_ARTIFACT);
    setBillArtifact(EMPTY_ARTIFACT);
    setVideoVendorReference("");
    setConsumerId("");
    setAddressText("");
    setSubmitSuccess(null);
  }, [abortAllArtifactUploads]);

  useEffect(() => {
    if (!selectedListingId) {
      setStatus(null);
      return;
    }
    resetArtifactState();
    void loadStatus(selectedListingId);
  }, [loadStatus, resetArtifactState, selectedListingId]);

  async function uploadArtifact(kind: "video_liveness" | "electricity_bill", file: File) {
    if (!accessToken || !selectedListingId) {
      setError(t(locale, "verificationSelectListingFirst"));
      return;
    }

    const update = kind === "video_liveness" ? setVideoArtifact : setBillArtifact;
    const controllerRef =
      kind === "video_liveness" ? videoUploadControllerRef : billUploadControllerRef;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    update({ file, status: "uploading", progress: 0 });
    setError(null);
    setSubmitSuccess(null);

    try {
      const result = await uploadVerificationArtifact(accessToken, {
        listingId: selectedListingId,
        kind,
        file,
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted || controllerRef.current !== controller) return;
          update((current) =>
            current.file === file ? { ...current, progress, status: "uploading" } : current
          );
        }
      });
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      update((current) =>
        current.file === file
          ? {
              file,
              status: "ready",
              progress: 100,
              blobPath: result.blobPath
            }
          : current
      );
    } catch (err) {
      if (controller.signal.aborted || isVerificationUploadAbortError(err)) return;
      if (controllerRef.current !== controller) return;
      update((current) =>
        current.file === file
          ? {
              ...current,
              status: "error",
              error: friendlyVerificationArtifactUploadError(err, locale)
            }
          : current
      );
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }

  function removeArtifact(kind: "video_liveness" | "electricity_bill") {
    abortArtifactUpload(kind);
    if (kind === "video_liveness") {
      setVideoArtifact(EMPTY_ARTIFACT);
      return;
    }
    setBillArtifact(EMPTY_ARTIFACT);
  }

  async function onSubmitVideo() {
    if (!accessToken) {
      setError(t(locale, "loginRequired"));
      return;
    }
    if (!selectedListingId || videoArtifact.status !== "ready" || !videoArtifact.blobPath) {
      setError(t(locale, "verificationVideoRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(null);

    try {
      const result = await submitVideoVerification(accessToken, {
        listingId: selectedListingId,
        artifactBlobPath: videoArtifact.blobPath,
        vendorReference: videoVendorReference.trim() || undefined
      });
      trackEvent("verification_video_submitted", {
        attempt_id: result.attemptId,
        result: result.result
      });
      setSubmitSuccess(t(locale, "verificationVideoSubmitted"));
      await loadStatus(selectedListingId);
    } catch (err) {
      setError(requestErrorCopy(locale, "verificationErrorSubmitVideo", err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitElectricity() {
    if (!accessToken) {
      setError(t(locale, "loginRequired"));
      return;
    }
    if (!selectedListingId || !consumerId.trim() || !addressText.trim()) {
      setError(t(locale, "verificationElectricityRequired"));
      return;
    }
    if (billArtifact.file && (billArtifact.status !== "ready" || !billArtifact.blobPath)) {
      setError(t(locale, "verificationBillUploadRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(null);

    try {
      const result = await submitElectricityVerification(accessToken, {
        listingId: selectedListingId,
        consumerId: consumerId.trim(),
        addressText: addressText.trim(),
        billArtifactBlobPath: billArtifact.blobPath
      });
      trackEvent("verification_bill_submitted", {
        attempt_id: result.attemptId,
        address_match_score: result.addressMatchScore,
        result: result.result
      });
      setSubmitSuccess(t(locale, "verificationElectricitySubmitted"));
      await loadStatus(selectedListingId);
    } catch (err) {
      setError(requestErrorCopy(locale, "verificationErrorSubmitElectricity", err));
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
  const overall = status?.overallStatus ?? "unverified";
  const uiStatus = latestAttempt ? resultToOverall(latestAttempt.result) : overall;
  const copy = resultStatusCopy(locale, overall);
  const awaitingAdmin = Boolean(status?.attempts.length) && overall === "pending";
  const threshold = latestAttempt?.threshold ?? 85;
  const scoreClass =
    uiStatus === "verified"
      ? "score-bar__fill--pass"
      : uiStatus === "failed"
        ? "score-bar__fill--fail"
        : "score-bar__fill--review";

  const videoReady =
    selectedListingId.length > 0 &&
    videoArtifact.status === "ready" &&
    Boolean(videoArtifact.blobPath);
  const electricityReady =
    selectedListingId.length > 0 &&
    consumerId.trim().length > 0 &&
    addressText.trim().length > 0 &&
    (!billArtifact.file || (billArtifact.status === "ready" && Boolean(billArtifact.blobPath)));

  if (sessionStatus === "loading" || loading) {
    return (
      <section className="ovc" aria-busy="true">
        <div className="ovc-hero">
          <div>
            <p className="ovo-eyebrow">{t(locale, "ownerVerify")}</p>
            <h1 className="ovc-title">{t(locale, "verification")}</h1>
          </div>
        </div>
        <div className="ovc-card ovc-skeleton" />
        <div className="ovc-card ovc-skeleton" />
      </section>
    );
  }

  return (
    <section className="ovc">
      <div className="ovc-hero">
        <div className="ovc-hero__copy">
          <p className="ovo-eyebrow">{t(locale, "ownerVerify")}</p>
          <h1 className="ovc-title">{t(locale, "verification")}</h1>
          <p className="ovc-subtitle">{t(locale, "verificationDescription")}</p>
        </div>
      </div>

      {error ? (
        <div className="ovc-alert ovc-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {submitSuccess ? (
        <div className="ovc-alert ovc-alert--success" role="status">
          {submitSuccess}
        </div>
      ) : null}

      <div className="ovc-card">
        <label className="ovc-field-label" htmlFor="verification-listing">
          {t(locale, "verificationListingLabel")}
        </label>
        <select
          id="verification-listing"
          className="ovc-input"
          value={selectedListingId}
          onChange={(event) => setSelectedListingId(event.target.value)}
        >
          <option value="">{t(locale, "verificationSelectListing")}</option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.title}
            </option>
          ))}
        </select>
      </div>

      <section className="ovc-card" data-testid="verification-current-status">
        <div className="ovc-status">
          <div className="ovc-status__copy">
            <p className="ovc-section-kicker">{t(locale, "verificationCurrentStatus")}</p>
            <h2>{copy.heading}</h2>
            <p>{copy.description}</p>
            {awaitingAdmin ? <p>{t(locale, "verificationAwaitingAdmin")}</p> : null}
            {latestAttempt?.provider ? (
              <p className="ovc-provider-line">
                {t(locale, "verificationProvider")}: <span>{latestAttempt.provider}</span>
              </p>
            ) : null}
          </div>
          <span className={`status-pill status-pill--${uiStatus}`}>
            {statusLabel(locale, uiStatus)}
          </span>
        </div>

        {latestScore != null ? (
          <div className="score-bar-wrap">
            <div className="score-bar">
              <div
                className={`score-bar__fill ${scoreClass}`}
                style={{ width: `${Math.min(latestScore, 100)}%` }}
              />
            </div>
            <div className="score-bar__label">
              <span>
                {formatTemplate(t(locale, "verificationMatchScore"), { score: latestScore })}
              </span>
              <span>{formatTemplate(t(locale, "verificationThreshold"), { threshold })}</span>
            </div>
          </div>
        ) : (
          <p className="ovc-muted">{t(locale, "verificationNoScore")}</p>
        )}
      </section>

      <section className="ovc-card ovc-methods" data-testid="verification-methods">
        <div className="ovc-methods__header">
          <div>
            <p className="ovc-section-kicker">{t(locale, "verificationMethodLabel")}</p>
            <h2>{t(locale, "verificationChooseMethod")}</h2>
          </div>
          <div
            className="ovc-segmented"
            role="group"
            aria-label={t(locale, "verificationMethodLabel")}
          >
            <button
              type="button"
              className={
                method === "video"
                  ? "ovc-segmented__button ovc-segmented__button--active"
                  : "ovc-segmented__button"
              }
              aria-pressed={method === "video"}
              onClick={() => setMethod("video")}
            >
              {t(locale, "verificationMethodVideo")}
            </button>
            <button
              type="button"
              className={
                method === "electricity"
                  ? "ovc-segmented__button ovc-segmented__button--active"
                  : "ovc-segmented__button"
              }
              aria-pressed={method === "electricity"}
              onClick={() => setMethod("electricity")}
            >
              {t(locale, "verificationMethodElectricity")}
            </button>
          </div>
        </div>

        {method === "video" ? (
          <div className="ovc-method-panel">
            <h3>{t(locale, "verificationVideoTitle")}</h3>
            <p>{t(locale, "verificationVideoBody")}</p>
            <VerificationArtifactField
              accept="video/mp4,video/webm,video/quicktime"
              label={t(locale, "verificationVideoArtifactLabel")}
              file={videoArtifact.file}
              status={videoArtifact.status}
              progress={videoArtifact.progress}
              error={videoArtifact.error}
              copy={artifactCopy}
              onSelect={(file) => void uploadArtifact("video_liveness", file)}
              onRetry={() => {
                if (videoArtifact.file) void uploadArtifact("video_liveness", videoArtifact.file);
              }}
              onRemove={() => removeArtifact("video_liveness")}
            />
            <label className="ovc-field-label" htmlFor="video-vendor-ref">
              {t(locale, "verificationVideoReferenceLabel")}
            </label>
            <input
              id="video-vendor-ref"
              className="ovc-input"
              value={videoVendorReference}
              onChange={(event) => setVideoVendorReference(event.target.value)}
              placeholder={t(locale, "verificationVideoReferencePlaceholder")}
            />
            <button
              type="button"
              className="ovc-primary-action"
              onClick={onSubmitVideo}
              disabled={submitting || !videoReady}
            >
              {submitting
                ? t(locale, "verificationSubmitting")
                : t(locale, "verificationSubmitVideo")}
            </button>
          </div>
        ) : (
          <div className="ovc-method-panel">
            <h3>{t(locale, "verificationElectricityTitle")}</h3>
            <p>{t(locale, "verificationElectricityBody")}</p>
            <div className="ovc-grid">
              <div>
                <label className="ovc-field-label" htmlFor="consumer-id">
                  {t(locale, "verificationConsumerIdLabel")}
                </label>
                <input
                  id="consumer-id"
                  className="ovc-input"
                  value={consumerId}
                  onChange={(event) => setConsumerId(event.target.value)}
                  placeholder={t(locale, "verificationConsumerIdPlaceholder")}
                />
              </div>
              <VerificationArtifactField
                accept="application/pdf,image/jpeg,image/png,image/webp"
                label={t(locale, "verificationBillArtifactLabel")}
                file={billArtifact.file}
                status={billArtifact.status}
                progress={billArtifact.progress}
                error={billArtifact.error}
                copy={artifactCopy}
                onSelect={(file) => void uploadArtifact("electricity_bill", file)}
                onRetry={() => {
                  if (billArtifact.file) void uploadArtifact("electricity_bill", billArtifact.file);
                }}
                onRemove={() => removeArtifact("electricity_bill")}
              />
            </div>
            <label className="ovc-field-label" htmlFor="address-text">
              {t(locale, "verificationAddressTextLabel")}
            </label>
            <textarea
              id="address-text"
              className="ovc-textarea"
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
              placeholder={t(locale, "verificationAddressTextPlaceholder")}
            />
            <button
              type="button"
              className="ovc-primary-action"
              onClick={onSubmitElectricity}
              disabled={submitting || !electricityReady}
            >
              {submitting
                ? t(locale, "verificationSubmitting")
                : t(locale, "verificationSubmitElectricity")}
            </button>
          </div>
        )}
      </section>

      {status && status.attempts.length > 0 ? (
        <section className="ovc-card" data-testid="verification-history">
          <p className="ovc-section-kicker">{t(locale, "verificationHistoryKicker")}</p>
          <h2>{t(locale, "verificationHistoryTitle")}</h2>
          <div className="ovc-history">
            {status.attempts.map((attempt) => (
              <article key={attempt.id} className="ovc-history__item">
                <div
                  className={`timeline-dot ${
                    attempt.result === "pass"
                      ? "timeline-dot--done"
                      : attempt.result === "fail"
                        ? "timeline-dot--fail"
                        : "timeline-dot--active"
                  }`}
                  aria-hidden="true"
                >
                  {attempt.result === "pass" ? "✓" : attempt.result === "fail" ? "!" : "..."}
                </div>
                <div className="ovc-history__content">
                  <h3>{attemptLabel(locale, attempt)}</h3>
                  <HistoryRow
                    label={t(locale, "verificationHistoryStatus")}
                    value={
                      <span className={`status-pill status-pill--${attempt.result}`}>
                        {resultLabel(locale, attempt.result)}
                      </span>
                    }
                  />
                  {attempt.machineResult ? (
                    <HistoryRow
                      label={t(locale, "verificationHistoryMachineResult")}
                      value={
                        <span className={`status-pill status-pill--${attempt.machineResult}`}>
                          {resultLabel(locale, attempt.machineResult)}
                        </span>
                      }
                    />
                  ) : null}
                  {attempt.addressMatchScore != null ? (
                    <HistoryRow
                      label={t(locale, "verificationHistoryAddressScore")}
                      value={`${attempt.addressMatchScore}%`}
                    />
                  ) : null}
                  {attempt.livenessScore != null ? (
                    <HistoryRow
                      label={t(locale, "verificationHistoryLivenessScore")}
                      value={`${attempt.livenessScore}%`}
                    />
                  ) : null}
                  {attempt.provider ? (
                    <HistoryRow
                      label={t(locale, "verificationProvider")}
                      value={attempt.provider}
                    />
                  ) : null}
                  {attempt.providerReference ? (
                    <HistoryRow
                      label={t(locale, "verificationProviderReference")}
                      value={attempt.providerReference}
                    />
                  ) : null}
                  {attempt.providerResultCode ? (
                    <HistoryRow
                      label={t(locale, "verificationProviderResultCode")}
                      value={attempt.providerResultCode}
                    />
                  ) : null}
                  {attempt.reviewReason ? (
                    <HistoryRow
                      label={t(locale, "verificationReviewReason")}
                      value={attempt.reviewReason}
                    />
                  ) : null}
                  {attempt.retryable ? (
                    <p className="ovc-muted">{t(locale, "verificationRetryableProvider")}</p>
                  ) : null}
                  <HistoryRow
                    label={t(locale, "verificationSubmittedAt")}
                    value={formatDate(attempt.createdAt, locale)}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function HistoryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="ovc-history__row">
      <span className="ovc-history__label">{label}</span>
      <span className="ovc-history__value">{value}</span>
    </p>
  );
}
