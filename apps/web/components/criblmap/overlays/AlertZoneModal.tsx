"use client";

import { useState, useCallback } from "react";
import { X, Bell, Loader2, MessageSquare, Mail } from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { fetchApi } from "../../../lib/api";

interface AlertZoneModalProps {
  onClose: () => void;
}

const BHK_OPTIONS = [1, 2, 3, 4];

export function AlertZoneModal({ onClose }: AlertZoneModalProps) {
  const { drawnBounds } = useMapState();
  const dispatch = useMapDispatch();

  const [label, setLabel] = useState("My Alert Zone");
  const [bhkFilter, setBhkFilter] = useState<number[]>([]);
  const [maxRent, setMaxRent] = useState<number | undefined>(undefined);
  const [listingType, setListingType] = useState<string | undefined>(undefined);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const toggleBhk = useCallback((bhk: number) => {
    setBhkFilter((prev) => (prev.includes(bhk) ? prev.filter((b) => b !== bhk) : [...prev, bhk]));
  }, []);

  const handleSave = useCallback(async () => {
    if (!drawnBounds || submitting) return;
    setSubmitting(true);

    try {
      await fetchApi("/map/alert-zones", {
        method: "POST",
        body: JSON.stringify({
          sw_lat: drawnBounds.sw_lat,
          sw_lng: drawnBounds.sw_lng,
          ne_lat: drawnBounds.ne_lat,
          ne_lng: drawnBounds.ne_lng,
          label,
          filters: {
            ...(bhkFilter.length > 0 && { bhk: bhkFilter }),
            ...(maxRent && { max_rent: maxRent }),
            ...(listingType && { listing_type: listingType }),
            ...(verifiedOnly && { verified_only: true })
          },
          notify_whatsapp: notifyWhatsapp,
          notify_email: notifyEmail
        })
      });

      setSubmitted(true);
      setTimeout(() => {
        onClose();
        dispatch({ type: "CLEAR_DRAW" });
      }, 2000);
    } catch {
      /* handle silently */
    } finally {
      setSubmitting(false);
    }
  }, [
    drawnBounds,
    label,
    bhkFilter,
    maxRent,
    listingType,
    verifiedOnly,
    notifyWhatsapp,
    notifyEmail,
    submitting,
    onClose,
    dispatch
  ]);

  if (!drawnBounds) {
    return (
      <div className="cmap-modal-backdrop" onClick={onClose}>
        <div className="cmap-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cmap-modal__header">
            <Bell size={20} />
            <h2>Alert Zone</h2>
            <button className="cmap-panel__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="cmap-modal__body">
            <p>Draw an area on the map first using the Area Stats tool.</p>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="cmap-modal-backdrop" onClick={onClose}>
        <div className="cmap-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cmap-modal__body" style={{ textAlign: "center", padding: "2rem" }}>
            <Bell size={32} style={{ color: "var(--brand)", marginBottom: 12 }} />
            <h3 style={{ color: "var(--cmap-text)", marginBottom: 8 }}>Alert Zone Saved!</h3>
            <p style={{ color: "var(--cmap-text-secondary)", fontSize: 13 }}>
              You&apos;ll be notified when new listings match your criteria in this area.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cmap-modal-backdrop" onClick={onClose}>
      <div className="cmap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmap-modal__header">
          <Bell size={20} />
          <h2>Save Alert Zone</h2>
          <button className="cmap-panel__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="cmap-modal__body">
          <div className="cmap-seeker-form__field">
            <label>Alert Name</label>
            <input
              type="text"
              className="cmap-topbar__input"
              style={{ borderRadius: 8, paddingLeft: 12 }}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Hauz Khas 2BHK Zone"
            />
          </div>

          <div className="cmap-seeker-form__field">
            <label>BHK Filter</label>
            <div className="cmap-seeker-form__chips">
              {BHK_OPTIONS.map((bhk) => (
                <button
                  key={bhk}
                  className={`cmap-filter-chip${bhkFilter.includes(bhk) ? " cmap-filter-chip--active" : ""}`}
                  onClick={() => toggleBhk(bhk)}
                >
                  {bhk} BHK
                </button>
              ))}
            </div>
          </div>

          <div className="cmap-seeker-form__field">
            <label>Max Rent</label>
            <div className="cmap-seeker-form__budget-input" style={{ maxWidth: 200 }}>
              <span>₹</span>
              <input
                type="number"
                value={maxRent ?? ""}
                onChange={(e) => setMaxRent(e.target.value ? Number(e.target.value) : undefined)}
                min={1000}
                step={1000}
                placeholder="Any"
              />
            </div>
          </div>

          <div className="cmap-seeker-form__field">
            <label>Type</label>
            <div className="cmap-seeker-form__chips">
              <button
                className={`cmap-filter-chip${!listingType ? " cmap-filter-chip--active" : ""}`}
                onClick={() => setListingType(undefined)}
              >
                Any
              </button>
              <button
                className={`cmap-filter-chip${listingType === "flat_house" ? " cmap-filter-chip--active" : ""}`}
                onClick={() => setListingType("flat_house")}
              >
                Flat / House
              </button>
              <button
                className={`cmap-filter-chip${listingType === "pg" ? " cmap-filter-chip--active" : ""}`}
                onClick={() => setListingType("pg")}
              >
                PG
              </button>
            </div>
          </div>

          <div className="cmap-seeker-form__field">
            <label>
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
              />{" "}
              Verified listings only
            </label>
          </div>

          <div className="cmap-seeker-form__field">
            <label>Notify via</label>
            <div className="cmap-alert-notify">
              <label
                className={`cmap-alert-notify__option${notifyWhatsapp ? " cmap-alert-notify__option--active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={notifyWhatsapp}
                  onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                />
                <MessageSquare size={14} />
                WhatsApp
              </label>
              <label
                className={`cmap-alert-notify__option${notifyEmail ? " cmap-alert-notify__option--active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                />
                <Mail size={14} />
                Email
              </label>
            </div>
          </div>

          <button
            className="cmap-listing__cta cmap-listing__cta--primary"
            onClick={handleSave}
            disabled={submitting}
          >
            {submitting ? <Loader2 size={14} className="cmap-spin" /> : <Bell size={14} />}
            {submitting ? "Saving..." : "Save Alert Zone"}
          </button>
        </div>
      </div>
    </div>
  );
}
