"use client";
/**
 * MotionPreview — "how it looks on the real site" before/after for two kits:
 * TrustMotion (on the real ListingCard + a listing-detail trust block) and MicroKit
 * (against the site's real .btn / .skeleton classes). Dev/preview surface (noindex).
 */
import * as React from "react";
import { motion, useReducedMotion, MotionConfig } from "framer-motion";
import { ShieldCheck, MapPin, BedDouble, Sofa } from "lucide-react";
import { Badge } from "@cribliv/ui";
import { ListingCardItem, type ListingCardData } from "@/components/listing-card";
import cardStyles from "@/components/listing-card.module.css";
import {
  RentReveal,
  SafetyRow,
  VerifiedStamp,
  LiveCounter,
  MotionButton,
  Toggle,
  Tabs,
  Skeleton,
  SkeletonSwap,
  useToasts,
  ToastViewport
} from "@/components/motion";

const INK = "#1a1a2e",
  SEC = "#64748b",
  GREEN = "#0d9f4f",
  LINE = "#e4e7ec";
const POP = { type: "spring", stiffness: 420, damping: 24, mass: 0.7 } as const;

const photo = (a: string, b: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='400' height='300' fill='url(#g)'/></svg>`
  );

const SAMPLES: (ListingCardData & { rentNum: number })[] = [
  {
    id: "s1",
    title: "Sunlit 2 BHK near Hazratganj",
    locality: "Hazratganj",
    city: "lucknow",
    listing_type: "flat_house",
    monthly_rent: 18000,
    rentNum: 18000,
    bhk: 2,
    furnishing: "semi_furnished",
    area_sqft: 950,
    verification_status: "verified",
    cover_photo: photo("#e7eefc", "#cdd9f0")
  },
  {
    id: "s2",
    title: "Furnished 1 BHK in Gomti Nagar",
    locality: "Gomti Nagar",
    city: "lucknow",
    listing_type: "flat_house",
    monthly_rent: 14500,
    rentNum: 14500,
    bhk: 1,
    furnishing: "fully_furnished",
    area_sqft: 620,
    verification_status: "verified",
    cover_photo: photo("#eaf6ee", "#cfe9d8")
  }
];

/* Faithful copy of the real card (same CSS module) with the TrustMotion treatment:
   verified pill pops in + one-shot ring pulse, rent counts up + amber underline,
   and a SafetyRow strip makes verification feel earned. */
function TrustCard({ listing, rentNum }: { listing: ListingCardData; rentNum: number }) {
  const reduced = useReducedMotion();
  const fLabel =
    listing.furnishing === "fully_furnished"
      ? "Fully Furnished"
      : listing.furnishing === "semi_furnished"
        ? "Semi-Furnished"
        : "Unfurnished";
  return (
    <article className={cardStyles.card}>
      <div className={cardStyles.media}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={listing.cover_photo ?? ""} alt={listing.title} className={cardStyles.img} />
        <span className={cardStyles.scrim} aria-hidden="true" />
        <div className={cardStyles.badgeRow}>
          <span style={{ position: "relative", display: "inline-flex" }}>
            {!reduced && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.5, scale: 1 }}
                animate={{ opacity: 0, scale: 1.9 }}
                transition={{ duration: 0.7, ease: "easeOut", delay: 0.32 }}
                style={{
                  position: "absolute",
                  inset: -2,
                  borderRadius: 9999,
                  border: `2px solid ${GREEN}`
                }}
              />
            )}
            <motion.span
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...POP, delay: 0.15 }}
            >
              <Badge
                tone="verified"
                style={{
                  background: "rgba(255,255,255,0.94)",
                  boxShadow: "var(--shadow-sm)",
                  backdropFilter: "blur(6px)"
                }}
              >
                <ShieldCheck size={12} aria-hidden="true" /> Verified
              </Badge>
            </motion.span>
          </span>
          <span />
        </div>
        <span className={cardStyles.typePill}>Flat / House</span>
      </div>
      <div className={cardStyles.body}>
        <h3 className={cardStyles.title}>{listing.title}</h3>
        <div className={cardStyles.loc}>
          <MapPin size={13} aria-hidden="true" />
          <span className={cardStyles.locText}>{listing.locality}, Lucknow</span>
        </div>
        <div className={cardStyles.metaRow}>
          <span className={cardStyles.metaChip}>
            <BedDouble size={12} />
            {listing.bhk} BHK
          </span>
          <span className={cardStyles.metaChip}>
            <Sofa size={12} />
            {fLabel}
          </span>
        </div>
        <div className={cardStyles.priceRow}>
          <span style={{ fontSize: 18 }}>
            <RentReveal rent={rentNum} per="/month" />
          </span>
          <Badge tone="neutral" style={{ fontSize: 11, padding: "4px 8px" }}>
            <ShieldCheck size={12} aria-hidden="true" /> Live details
          </Badge>
        </div>
      </div>
      {/* the "feels earned" strip */}
      <div style={{ padding: "0 14px 14px", marginTop: -2 }}>
        <SafetyRow items={["Verified owner", "Real photos", "No brokerage"]} style={{ gap: 12 }} />
      </div>
    </article>
  );
}

function Panel({
  title,
  sub,
  children,
  dark
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      style={{
        flex: "1 1 300px",
        minWidth: 300,
        borderRadius: 20,
        padding: 20,
        background: dark ? "#0b1226" : "#fff",
        border: `1px solid ${dark ? "transparent" : LINE}`
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: dark ? "#5b57ff" : "#c3c9d4"
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: dark ? "rgba(244,247,255,.7)" : SEC
          }}
        >
          {title}
        </span>
      </div>
      {sub && (
        <p
          style={{
            margin: "0 0 16px 16px",
            fontSize: 12.5,
            color: dark ? "rgba(244,247,255,.5)" : SEC
          }}
        >
          {sub}
        </p>
      )}
      <div style={{ marginLeft: 16 }}>{children}</div>
    </div>
  );
}

function Section({
  n,
  title,
  blurb,
  children
}: {
  n: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontWeight: 800,
            fontSize: 13,
            color: "#5b57ff",
            fontVariantNumeric: "tabular-nums"
          }}
        >
          {n}
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: "Manrope, Inter, sans-serif",
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: "-.02em",
            color: INK
          }}
        >
          {title}
        </h2>
      </div>
      <p
        style={{
          margin: "4px 0 18px 25px",
          fontSize: 13.5,
          color: SEC,
          maxWidth: 680,
          lineHeight: 1.5
        }}
      >
        {blurb}
      </p>
      <div style={{ marginLeft: 25 }}>{children}</div>
    </section>
  );
}

export function MotionPreview() {
  const [skelLoading, setSkelLoading] = React.useState(true);
  const [toggle, setToggle] = React.useState(true);
  const [tab, setTab] = React.useState("Rent");
  const [busy, setBusy] = React.useState(false);
  const [still, setStill] = React.useState(false);
  const { toasts, push } = useToasts();

  return (
    <MotionConfig reducedMotion={still ? "always" : "user"}>
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f5f7",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
        }}
      >
        <header
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "26px 24px 6px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap"
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: "Manrope, Inter, sans-serif",
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: "-.02em",
                color: INK
              }}
            >
              Motion in context — before / after
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: SEC }}>
              The real Cribliv components on the left, the same thing with the motion kit on the
              right.
            </p>
          </div>
          <button
            onClick={() => setStill((v) => !v)}
            className="btn btn--secondary btn--sm"
            style={{ marginTop: 8, whiteSpace: "nowrap" }}
          >
            {still ? "▶ Play motion" : "⏸ Show final frame"}
          </button>
        </header>

        <main style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 24px 120px" }}>
          {/* Trust — listing cards */}
          <Section
            n="01"
            title="Trust motion — on your real listing cards"
            blurb="Same card, same styles. The verified pill springs in with a single ring pulse, the ₹ rent counts up as an amber underline wipes beneath it, and a calm 'verified owner · real photos · no brokerage' strip makes the verification feel earned — one pulse, never a loop."
          >
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <Panel title="Current — live site">
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr" }}>
                  {SAMPLES.map((s) => (
                    <ListingCardItem
                      key={s.id}
                      listing={s}
                      locale="en"
                      heartSlot={<span aria-hidden />}
                    />
                  ))}
                </div>
              </Panel>
              <Panel title="With TrustMotion">
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr" }}>
                  {SAMPLES.map((s) => (
                    <TrustCard key={s.id} listing={s} rentNum={s.rentNum} />
                  ))}
                </div>
              </Panel>
            </div>
          </Section>

          {/* Trust — listing detail */}
          <Section
            n="02"
            title="Trust motion — on the listing detail page"
            blurb="The verification block at the top of a listing. Left is a plain static block; right taps the shield in, rolls a live counter with a soft amber glow, counts the rent up, and staggers the safety checks."
          >
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <Panel title="Current — static">
                <div style={{ display: "grid", gap: 12 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 13,
                      fontWeight: 700,
                      color: GREEN
                    }}
                  >
                    <ShieldCheck size={16} /> Verified 18 Jul 2026
                  </span>
                  <div
                    style={{
                      fontFamily: "Manrope, Inter, sans-serif",
                      fontWeight: 800,
                      fontSize: 28,
                      color: INK
                    }}
                  >
                    ₹18,000<span style={{ fontSize: 14, fontWeight: 500, color: SEC }}>/month</span>
                  </div>
                  <div style={{ fontSize: 13, color: SEC }}>
                    Verified owner · Real photos · No brokerage
                  </div>
                  <div style={{ fontSize: 13, color: SEC }}>• 1,240 homes live this week</div>
                </div>
              </Panel>
              <Panel title="With TrustMotion">
                <div style={{ display: "grid", gap: 18 }}>
                  <VerifiedStamp date="18 Jul 2026" size={30} />
                  <div style={{ fontSize: 32 }}>
                    <RentReveal rent={18000} per="/month" />
                  </div>
                  <SafetyRow items={["Verified owner", "Real photos", "No brokerage"]} />
                  <div style={{ paddingTop: 6, borderTop: `1px solid ${LINE}` }}>
                    <LiveCounter from={0} to={1240} suffix=" homes live this week" />
                  </div>
                </div>
              </Panel>
            </div>
          </Section>

          {/* MicroKit */}
          <Section
            n="03"
            title="MicroKit — buttons, skeletons, toasts"
            blurb="The everyday interaction layer, against the site's real .btn and .skeleton classes. Gradient buttons get a press-tuck + sheen and a Maya-orb spinner while working; skeletons crossfade into content; toasts settle in calmly."
          >
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <Panel title="Current — .btn / .skeleton">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
                  <button className="btn btn--primary btn--lg">Request to book</button>
                  <button className="btn btn--secondary">Secondary</button>
                  <button className="btn btn--ghost">Ghost</button>
                </div>
                <div style={{ display: "grid", gap: 8, maxWidth: 240 }}>
                  <span className="skeleton skeleton--line" style={{ height: 14, width: "70%" }} />
                  <span className="skeleton skeleton--line" style={{ height: 12, width: "90%" }} />
                  <span className="skeleton skeleton--line" style={{ height: 12, width: "45%" }} />
                </div>
              </Panel>
              <Panel title="With MicroKit">
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 18,
                    alignItems: "center"
                  }}
                >
                  <MotionButton
                    variant="primary"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      setTimeout(() => {
                        setBusy(false);
                        push("success", "Request sent");
                      }, 1400);
                    }}
                  >
                    Request to book
                  </MotionButton>
                  <MotionButton variant="secondary">Secondary</MotionButton>
                  <MotionButton variant="tertiary">Tertiary</MotionButton>
                </div>
                <div
                  style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}
                >
                  <div style={{ minWidth: 220 }}>
                    <SkeletonSwap
                      loading={skelLoading}
                      skeleton={
                        <div style={{ display: "grid", gap: 8 }}>
                          <Skeleton height={14} width="70%" />
                          <Skeleton height={12} width="90%" />
                          <Skeleton height={12} width="45%" />
                        </div>
                      }
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontWeight: 700, color: INK }}>2 BHK · Hazratganj</div>
                        <div style={{ fontSize: 13, color: SEC }}>Semi-furnished · ₹18,000/mo</div>
                      </div>
                    </SkeletonSwap>
                    <button
                      onClick={() => setSkelLoading((v) => !v)}
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: 10 }}
                    >
                      toggle load
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      alignItems: "flex-start"
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <Toggle checked={toggle} onChange={setToggle} label="demo" />
                      <Tabs items={["Rent", "PG", "Buy"]} value={tab} onChange={setTab} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <MotionButton
                        variant="secondary"
                        onClick={() => push("success", "Saved to shortlist")}
                      >
                        ✓ toast
                      </MotionButton>
                      <MotionButton
                        variant="tertiary"
                        onClick={() => push("error", "Something went wrong")}
                      >
                        ✕ toast
                      </MotionButton>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          </Section>
        </main>
        <ToastViewport toasts={toasts} />
      </div>
    </MotionConfig>
  );
}
