"use client";
/**
 * MotionGallery — live, in-repo showcase of the Cribliv motion kit.
 * The codebase home of "Motion Kit Gallery.dc.html". Dev/preview surface (noindex).
 * Every panel drives real components from components/motion/* so this doubles as a smoke test.
 */
import * as React from "react";
import { useReducedMotion } from "framer-motion";
import {
  MayaOrb,
  Waveform,
  MicOrbSwap,
  useRotatingPlaceholder,
  HeroMotion,
  MapFade,
  GlowBloom,
  GlassRise,
  HeadlineStagger,
  ParallaxPins,
  PricePin,
  LockChip,
  RollingCount,
  VerifiedStamp,
  LiveCounter,
  RentReveal,
  SafetyRow,
  MotionButton,
  Toggle,
  Tabs,
  Skeleton,
  SkeletonSwap,
  useToasts,
  ToastViewport,
  FieldFill,
  StrengthMeter,
  ConfirmChip,
  PublishCelebration,
  type FieldStatus,
  SmartQueryBar,
  MapHandoff,
  ListingCard,
  StickyVisitBar,
  type ParsedChip,
  type MapPinData,
  MayaDock,
  MayaHeroIntro,
  type OrbState
} from "@/components/motion";

const INK = "#1a1a2e",
  SEC = "#64748b",
  LINE = "#e4e7ec";
const DUSK = "linear-gradient(160deg,#070b16 0%,#0b1226 100%)";
const GRADIENT = "linear-gradient(120deg,#0066ff 0%,#5b57ff 46%,#ff5a5f 100%)";
const ORB_STATES: OrbState[] = ["idle", "listening", "thinking", "speaking", "ended"];

/* ── layout helpers ──────────────────────────────────────────────────── */
function Section({
  n,
  title,
  blurb,
  dark,
  children
}: {
  n: string;
  title: string;
  blurb: string;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        borderRadius: 28,
        padding: "26px 26px 30px",
        marginBottom: 22,
        background: dark ? DUSK : "#fff",
        border: `1px solid ${dark ? "transparent" : LINE}`,
        color: dark ? "#f4f7ff" : INK,
        boxShadow: dark
          ? "0 30px 80px -40px rgba(7,11,22,.8)"
          : "0 8px 26px -18px rgba(26,26,46,.25)"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 800,
            fontSize: 13,
            color: "#5b57ff"
          }}
        >
          {n}
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: "Manrope, Inter, sans-serif",
            fontWeight: 800,
            fontSize: 21,
            letterSpacing: "-.02em"
          }}
        >
          {title}
        </h2>
      </div>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13.5,
          color: dark ? "rgba(244,247,255,.6)" : SEC,
          maxWidth: 620,
          lineHeight: 1.5
        }}
      >
        {blurb}
      </p>
      {children}
    </section>
  );
}
function Tile({
  label,
  children,
  minWidth = 200,
  dark
}: {
  label?: string;
  children: React.ReactNode;
  minWidth?: number;
  dark?: boolean;
}) {
  return (
    <div
      style={{
        flex: `1 1 ${minWidth}px`,
        minWidth,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 18,
        borderRadius: 16,
        background: dark ? "rgba(255,255,255,.04)" : "#f8f9fb",
        border: `1px solid ${dark ? "rgba(255,255,255,.08)" : LINE}`
      }}
    >
      {children}
      {label && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: dark ? "rgba(244,247,255,.5)" : SEC
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
const Row = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", ...style }}>
    {children}
  </div>
);
function Pill({
  active,
  onClick,
  children
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: 9999,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "inherit",
        border: `1px solid ${active ? "#5b57ff" : LINE}`,
        background: active ? "#efeeff" : "#fff",
        color: active ? "#4340c4" : SEC
      }}
    >
      {children}
    </button>
  );
}

/* ── the gallery ─────────────────────────────────────────────────────── */
export function MotionGallery({ locale: initialLocale = "en" }: { locale?: "en" | "hi" }) {
  const reduced = !!useReducedMotion();
  const [locale, setLocale] = React.useState<"en" | "hi">(initialLocale);
  const [replayKey, setReplayKey] = React.useState(0);
  const replay = () => setReplayKey((k) => k + 1);

  /* Maya orb state driver */
  const [orbState, setOrbState] = React.useState<OrbState>("listening");
  const [micActive, setMicActive] = React.useState(false);

  /* chips + rolling count */
  const allChips = ["Hazratganj", "2 BHK", "≤ ₹18k", "Semi-furnished"];
  const [chipCount, setChipCount] = React.useState(2);
  const shownChips = allChips.slice(0, chipCount);
  const matchCount = [420, 214, 86, 37, 12][chipCount] ?? 12;

  /* micro-interactions */
  const [btnLoading, setBtnLoading] = React.useState(false);
  const [toggle, setToggle] = React.useState(true);
  const [tab, setTab] = React.useState("Rent");
  const [skelLoading, setSkelLoading] = React.useState(true);
  const { toasts, push } = useToasts();

  /* voice listing */
  const fields = React.useMemo(
    () => [
      { label: locale === "hi" ? "इलाका" : "Locality", value: "Hazratganj, Lucknow" },
      { label: locale === "hi" ? "प्रकार" : "Type", value: "2 BHK · Apartment" },
      { label: locale === "hi" ? "किराया" : "Rent", value: "₹18,000 / mo" },
      { label: locale === "hi" ? "फर्निशिंग" : "Furnishing", value: "Semi-furnished" }
    ],
    [locale]
  );
  const [fillIndex, setFillIndex] = React.useState(-1);
  const strength = fillIndex < 0 ? 0 : Math.min(1, fillIndex / fields.length);
  const [showConfirm, setShowConfirm] = React.useState(true);
  const [confirmMsg, setConfirmMsg] = React.useState("");
  const [publish, setPublish] = React.useState(false);

  /* journey */
  const [query, setQuery] = React.useState("2 BHK near Hazratganj under ₹18k");
  const journeyChips: ParsedChip[] = [
    { id: "b", kind: "bhk", label: "2 BHK" },
    { id: "l", kind: "locality", label: "Hazratganj" },
    { id: "u", kind: "budget", label: "≤ ₹18,000" }
  ];
  const [mapActive, setMapActive] = React.useState(true);
  const pins: MapPinData[] = [
    { id: "1", x: 32, y: 40, label: "₹14k", matched: true },
    { id: "2", x: 54, y: 30, label: "₹18k", featured: true, matched: true },
    { id: "3", x: 68, y: 52, label: "₹16k", matched: true },
    { id: "4", x: 44, y: 62, label: "₹27k", matched: false },
    { id: "5", x: 78, y: 38, count: 6, matched: true },
    { id: "6", x: 24, y: 66, label: "₹22k", matched: false }
  ];

  /* sticky bar + Maya intro replay */
  const [showSticky, setShowSticky] = React.useState(false);
  const [introKey, setIntroKey] = React.useState(0);
  const replayIntro = () => {
    try {
      sessionStorage.removeItem("cribliv.maya.intro");
    } catch {
      /* noop */
    }
    setIntroKey((k) => k + 1);
  };

  const rotating = useRotatingPlaceholder(
    locale === "hi"
      ? [
          "हज़रतगंज के पास 2 BHK, ₹18k तक",
          "गोमती नगर में 1 BHK फर्निश्ड",
          "आलमबाग में लड़कों का PG"
        ]
      : [
          "2 BHK near Hazratganj under ₹18k",
          "Furnished 1 BHK in Gomti Nagar",
          "Boys PG in Alambagh with meals"
        ],
    3000,
    micActive
  );

  const t = (en: string, hi: string) => (locale === "hi" ? hi : en);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f7",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        color: INK
      }}
    >
      <MayaHeroIntro key={`intro-${introKey}`} locale={locale} />

      {/* header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(245,245,247,.82)",
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${LINE}`
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap"
          }}
        >
          <MayaOrb state="idle" size={30} />
          <div style={{ marginRight: "auto" }}>
            <div
              style={{
                fontFamily: "Manrope, Inter, sans-serif",
                fontWeight: 800,
                fontSize: 16,
                letterSpacing: "-.01em"
              }}
            >
              Cribliv Motion Kit
            </div>
            <div style={{ fontSize: 11.5, color: SEC }}>
              components/motion ·{" "}
              {reduced
                ? t("reduced-motion ON — final frames only", "reduced-motion ON")
                : t("live", "लाइव")}
            </div>
          </div>
          <Pill active={locale === "en"} onClick={() => setLocale("en")}>
            EN
          </Pill>
          <Pill active={locale === "hi"} onClick={() => setLocale("hi")}>
            हिं
          </Pill>
          <button
            onClick={replay}
            style={{
              padding: "8px 16px",
              borderRadius: 9999,
              border: "none",
              cursor: "pointer",
              background: GRADIENT,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: "inherit"
            }}
          >
            ↻ {t("Replay", "फिर चलाएँ")}
          </button>
        </div>
      </header>

      <main
        style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 24px 120px" }}
        key={`main-${replayKey}`}
      >
        {/* 01 · Maya */}
        <Section
          n="01"
          title={t("Maya — the liquid-mercury orb", "Maya — तरल-पारा ऑर्ब")}
          dark
          blurb={t(
            "One orb, five states. Breath + audio-reactive bulge over a 14-anchor Catmull-Rom path; pearl fill, indigo halo, fixed specular. She flows — never bounces.",
            "एक ऑर्ब, पाँच अवस्थाएँ। साँस + आवाज़-प्रतिक्रियाशील उभार।"
          )}
        >
          <Row style={{ gap: 26 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                padding: "8px 20px"
              }}
            >
              <div
                style={{ position: "relative", height: 132, display: "flex", alignItems: "center" }}
              >
                <MayaOrb state={orbState} size={120} />
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 20 }}>
                {orbState === "listening" && (
                  <>
                    <span className="lhm-listening-dot" />
                    <Waveform bars={6} />
                  </>
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: orbState === "listening" ? "#f59e0b" : "rgba(244,247,255,.55)"
                  }}
                >
                  {orbState}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ORB_STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => setOrbState(s)}
                  style={{
                    padding: "9px 18px",
                    borderRadius: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13.5,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    border: `1px solid ${orbState === s ? "#5b57ff" : "rgba(255,255,255,.14)"}`,
                    background: orbState === s ? "rgba(91,87,255,.22)" : "rgba(255,255,255,.04)",
                    color: "#f4f7ff",
                    minWidth: 150
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <Tile dark label={t("small · button spinner", "छोटा")} minWidth={120}>
              <Row>
                <MayaOrb state="idle" size={22} />
                <MayaOrb state="thinking" size={30} />
                <MayaOrb state="speaking" size={44} />
              </Row>
            </Tile>
          </Row>
        </Section>

        {/* 02 · Listening hero */}
        <Section
          n="02"
          title={t("Listening hero — page-load choreography", "लिसनिंग हीरो")}
          blurb={t(
            "Beats 1–2: backdrop fades, the signature glow blooms behind the glass, the panel rises 12px, headline words stagger 40ms apart, ₹-pins pop (spring) and drift ~3px with your pointer. Hit Replay to re-run.",
            "backdrop fade, glow bloom, glass rise, staggered headline, ₹-pins pop + parallax।"
          )}
        >
          <HeroMotion style={{ borderRadius: 20, minHeight: 300, background: DUSK, padding: 24 }}>
            <MapFade
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(120% 90% at 50% 8%, rgba(91,87,255,.18), transparent 60%)"
              }}
            />
            <GlowBloom
              style={{
                width: 380,
                height: 220,
                left: "50%",
                top: 40,
                transform: "translateX(-50%)",
                opacity: 0.4
              }}
              opacity={0.4}
            />
            <ParallaxPins strength={3}>
              <PricePin index={0} style={{ left: "12%", top: "24%" }}>
                ₹14k
              </PricePin>
              <PricePin index={1} featured style={{ left: "70%", top: "18%" }}>
                ★ ₹18k
              </PricePin>
              <PricePin index={2} style={{ left: "78%", top: "56%" }}>
                ₹16k
              </PricePin>
              <PricePin index={3} style={{ left: "18%", top: "66%" }}>
                ₹22k
              </PricePin>
              <PricePin index={4} featured style={{ left: "40%", top: "76%" }}>
                ★ ₹15k
              </PricePin>
            </ParallaxPins>
            <div style={{ position: "relative", textAlign: "center", paddingTop: 16 }}>
              <HeadlineStagger
                as="h1"
                text={t("Find a home you can trust", "भरोसे का घर खोजें")}
                style={{
                  display: "inline-block",
                  fontFamily: "Manrope, Inter, sans-serif",
                  fontWeight: 800,
                  fontSize: 30,
                  letterSpacing: "-.03em",
                  color: "#f4f7ff",
                  margin: "0 0 18px"
                }}
              />
              <GlassRise style={{ maxWidth: 460, margin: "0 auto" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#fff",
                    borderRadius: 16,
                    padding: "10px 12px",
                    boxShadow: "0 24px 60px -24px rgba(0,0,0,.6)"
                  }}
                >
                  <MicOrbSwap
                    active={micActive}
                    orbState="listening"
                    size={38}
                    icon={
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#64748b"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="M21 21l-4.3-4.3" />
                      </svg>
                    }
                  />
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      fontSize: 15,
                      color: micActive ? "#b45309" : "#94a0b3",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {micActive ? t("Listening…", "सुन रही हूँ…") : rotating}
                  </span>
                  <button
                    onClick={() => setMicActive((v) => !v)}
                    aria-pressed={micActive}
                    style={{
                      width: 40,
                      height: 40,
                      flex: "none",
                      borderRadius: 9999,
                      cursor: "pointer",
                      border: `1px solid ${micActive ? "#f59e0b" : "#dfe3ea"}`,
                      background: micActive ? "#fef3e2" : "#fff",
                      color: micActive ? "#b45309" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </button>
                </div>
              </GlassRise>
            </div>
          </HeroMotion>
        </Section>

        {/* 03 · Parser lock — chips + rolling count */}
        <Section
          n="03"
          title={t("Parser lock — chips + live count", "पार्सर लॉक — chips + लाइव गिनती")}
          blurb={t(
            "Beat 4: as Maya locks locality / BHK / budget, each chip snaps in with a playful pop and the amber match-count rolls (tabular) to the new number. Add/remove chips to watch it roll.",
            "हर chip pop करता है और amber गिनती नए नंबर तक roll होती है।"
          )}
        >
          <Row style={{ gap: 18 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                minHeight: 40
              }}
            >
              {shownChips.map((c) => (
                <LockChip
                  key={c}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "6px 13px",
                    borderRadius: 9999,
                    fontSize: 13,
                    fontWeight: 700,
                    background: "#ebf3ff",
                    color: "#0052cc",
                    border: "1px solid #bcd6ff",
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {c}
                </LockChip>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: SEC }}>
              <RollingCount value={matchCount} /> {t("homes match", "घर मैच")}
            </div>
          </Row>
          <Row style={{ marginTop: 18 }}>
            <Pill onClick={() => setChipCount((c) => Math.min(allChips.length, c + 1))}>
              + {t("add chip", "chip जोड़ें")}
            </Pill>
            <Pill onClick={() => setChipCount((c) => Math.max(0, c - 1))}>
              − {t("remove chip", "हटाएँ")}
            </Pill>
          </Row>
        </Section>

        {/* 04 · Trust motion */}
        <Section
          n="04"
          title={t("Trust motion — verification feels earned", "ट्रस्ट मोशन")}
          blurb={t(
            "Calm, one pulse, never a loop. The stamp taps in with a ring pulse, counters roll with a soft amber glow on settle, the ₹ figure counts up as its underline wipes, safety points stagger.",
            "शांत, एक pulse. Stamp, live counters, ₹ reveal, safety row।"
          )}
        >
          <Row style={{ gap: 24, alignItems: "stretch" }}>
            <Tile label="VerifiedStamp">
              <VerifiedStamp date={locale === "hi" ? "12 जुल 2026" : "12 Jul 2026"} size={34} />
            </Tile>
            <Tile label="LiveCounter">
              <LiveCounter from={0} to={1240} suffix={t(" homes live", " घर लाइव")} />
            </Tile>
            <Tile label="RentReveal">
              <div style={{ fontSize: 30 }}>
                <RentReveal rent={18000} />
              </div>
            </Tile>
            <Tile label="SafetyRow" minWidth={280}>
              <SafetyRow
                items={
                  locale === "hi"
                    ? ["सत्यापित मालिक", "असली फ़ोटो", "कोई ब्रोकरेज नहीं"]
                    : ["Verified owner", "Real photos", "No brokerage"]
                }
              />
            </Tile>
          </Row>
        </Section>

        {/* 05 · MicroKit */}
        <Section
          n="05"
          title={t("MicroKit — the everyday interaction layer", "MicroKit")}
          blurb={t(
            "Buttons (gradient + sheen, press-tuck, orb spinner), a springy toggle, sliding tab pill, shimmer skeletons that crossfade to content, and calm toasts.",
            "बटन, toggle, tabs, skeleton, toasts — रोज़मर्रा की interactions।"
          )}
        >
          <Row style={{ gap: 24, alignItems: "flex-start" }}>
            <Tile label="MotionButton" minWidth={240}>
              <Row>
                <MotionButton
                  variant="primary"
                  loading={btnLoading}
                  onClick={() => {
                    setBtnLoading(true);
                    setTimeout(() => {
                      setBtnLoading(false);
                      push("success", t("Request sent", "भेज दिया"));
                    }, 1400);
                  }}
                >
                  {t("Request to book", "बुक करें")}
                </MotionButton>
                <MotionButton
                  variant="secondary"
                  onClick={() => push("error", t("Try again", "फिर कोशिश करें"))}
                >
                  {t("Secondary", "सेकंडरी")}
                </MotionButton>
                <MotionButton variant="tertiary">{t("Tertiary", "टर्शियरी")}</MotionButton>
              </Row>
            </Tile>
            <Tile label="Toggle · Tabs" minWidth={220}>
              <Row>
                <Toggle checked={toggle} onChange={setToggle} label="demo" />
                <Tabs
                  items={[t("Rent", "किराया"), "PG", t("Buy", "खरीदें")]}
                  value={tab}
                  onChange={setTab}
                />
              </Row>
            </Tile>
            <Tile label="Skeleton → content" minWidth={220}>
              <div style={{ width: "100%" }}>
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
                    <div style={{ fontWeight: 700 }}>2 BHK · Hazratganj</div>
                    <div style={{ fontSize: 13, color: SEC }}>
                      {t("Semi-furnished · ₹18,000/mo", "सेमी-फर्निश्ड · ₹18,000/mo")}
                    </div>
                  </div>
                </SkeletonSwap>
                <div style={{ marginTop: 10 }}>
                  <Pill onClick={() => setSkelLoading((v) => !v)}>
                    {t("toggle load", "लोड टॉगल")}
                  </Pill>
                </div>
              </div>
            </Tile>
            <Tile label="Toasts" minWidth={180}>
              <Row>
                <Pill
                  onClick={() => push("success", t("Saved to shortlist", "शॉर्टलिस्ट में सेव"))}
                >
                  ✓ success
                </Pill>
                <Pill onClick={() => push("error", t("Something went wrong", "कुछ गड़बड़"))}>
                  ✕ error
                </Pill>
              </Row>
            </Tile>
          </Row>
        </Section>

        {/* 06 · Voice listing */}
        <Section
          n="06"
          title={t("Voice listing — Maya fills it as you talk", "वॉइस लिस्टिंग")}
          dark
          blurb={t(
            "Fields flash amber and type themselves in, a green check taps on each, the strength meter springs amber→green, an ambiguity chip confirms, and publishing gets one restrained gradient ring.",
            "फ़ील्ड खुद भरते हैं, strength meter बढ़ता है, publish पर एक ring।"
          )}
        >
          <Row style={{ gap: 24, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 320px", minWidth: 320, display: "grid", gap: 10 }}>
              {fields.map((f, i) => {
                const status: FieldStatus =
                  fillIndex < 0
                    ? "empty"
                    : i < fillIndex
                      ? "done"
                      : i === fillIndex
                        ? "filling"
                        : "empty";
                return (
                  <FieldFill
                    key={f.label + locale}
                    label={f.label}
                    value={f.value}
                    status={status}
                    onFilled={() => setFillIndex((idx) => (idx === i ? i + 1 : idx))}
                  />
                );
              })}
              <Row style={{ marginTop: 4 }}>
                <button
                  onClick={() => setFillIndex(0)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 9999,
                    border: "none",
                    cursor: "pointer",
                    background: GRADIENT,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: "inherit"
                  }}
                >
                  🎙 {t("Watch Maya fill it", "Maya भरे देखें")}
                </button>
                <Pill onClick={() => setFillIndex(-1)}>{t("reset", "रीसेट")}</Pill>
              </Row>
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 280, display: "grid", gap: 20 }}>
              <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 16, padding: 18 }}>
                <StrengthMeter
                  value={strength}
                  label={t("Listing strength", "लिस्टिंग स्ट्रेंथ")}
                />
              </div>
              <div style={{ minHeight: 52 }}>
                {showConfirm ? (
                  <ConfirmChip
                    question={t("Boys or girls PG?", "लड़के या लड़कियाँ?")}
                    yes={t("✓ Boys", "✓ लड़के")}
                    no={t("✓ Girls", "✓ लड़कियाँ")}
                    onYes={() => {
                      setShowConfirm(false);
                      setConfirmMsg(t("Locked: Boys PG", "सेट: लड़कों का PG"));
                    }}
                    onNo={() => {
                      setShowConfirm(false);
                      setConfirmMsg(t("Locked: Girls PG", "सेट: लड़कियों का PG"));
                    }}
                  />
                ) : (
                  <Row>
                    <span style={{ fontSize: 13.5, color: "rgba(244,247,255,.7)" }}>
                      {confirmMsg}
                    </span>
                    <Pill onClick={() => setShowConfirm(true)}>{t("replay chip", "फिर")}</Pill>
                  </Row>
                )}
              </div>
              <button
                onClick={() => setPublish(true)}
                style={{
                  justifySelf: "start",
                  padding: "10px 20px",
                  borderRadius: 9999,
                  border: "none",
                  cursor: "pointer",
                  background: "#0d9f4f",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: "inherit"
                }}
              >
                {t("Publish listing", "लिस्टिंग पब्लिश करें")}
              </button>
            </div>
          </Row>
        </Section>

        {/* 07 · Journey */}
        <Section
          n="07"
          title={t("Journey — search → map → listing", "जर्नी")}
          blurb={t(
            "The SmartQueryBar carries Maya + chips + a rolling count; pins bloom outward from center and non-matches dim to 15%; result cards rise and reveal an Ask-Maya button on hover.",
            "SmartQueryBar, नक्शे पर pins खिलते हैं, cards ऊपर आते हैं।"
          )}
        >
          <div style={{ display: "grid", gap: 18 }}>
            <SmartQueryBar
              value={query}
              onChange={setQuery}
              chips={journeyChips}
              count={214}
              orbState={micActive ? "listening" : "idle"}
              onMicToggle={() => setMicActive((v) => !v)}
              placeholder={t("2 BHK near Hazratganj under ₹18k", "हज़रतगंज के पास 2 BHK, ₹18k तक")}
            />
            <MapHandoff
              pins={pins}
              active={mapActive}
              center={{ x: 54, y: 30 }}
              style={{ height: 300, borderRadius: 20, background: DUSK }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(90% 70% at 54% 30%, rgba(91,87,255,.22), transparent 55%)"
                }}
              />
            </MapHandoff>
            <Row>
              <Pill active={mapActive} onClick={() => setMapActive((v) => !v)}>
                {mapActive ? t("pins in", "pins अंदर") : t("pins out", "pins बाहर")}
              </Pill>
              <span style={{ fontSize: 12.5, color: SEC }}>
                {t(
                  "Dimmed pins = out of budget. Cluster bubble = 6 homes.",
                  "धुँधले pins = बजट के बाहर।"
                )}
              </span>
            </Row>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 16
              }}
              key={`cards-${replayKey}`}
            >
              {[
                {
                  title: t("Sunny 2 BHK", "धूपदार 2 BHK"),
                  locality: "Hazratganj, Lucknow",
                  rent: 18000,
                  verified: true,
                  replyTime: t("Replies in ~1h", "~1घं में जवाब")
                },
                {
                  title: t("Cozy 1 BHK", "आरामदेह 1 BHK"),
                  locality: "Gomti Nagar, Lucknow",
                  rent: 14500,
                  verified: true,
                  replyTime: t("Replies fast", "जल्दी जवाब")
                },
                {
                  title: t("Boys PG · meals", "लड़कों का PG"),
                  locality: "Alambagh, Lucknow",
                  rent: 8500,
                  verified: false
                }
              ].map((c, i) => (
                <ListingCard
                  key={c.title}
                  index={i}
                  locale={locale}
                  {...c}
                  onClick={() => {}}
                  onAskMaya={() => push("success", t("Maya is on it", "Maya देख रही है"))}
                />
              ))}
            </div>
          </div>
        </Section>

        {/* 08 · Presence */}
        <Section
          n="08"
          title={t("Presence — Maya, everywhere", "प्रेज़ेंस — Maya हर जगह")}
          blurb={t(
            "The MayaDock (bottom-right) is live on this page — tap it. Replay her once-per-session mercury-assemble intro, or raise the sticky visit bar.",
            "MayaDock नीचे-दाएँ लाइव है। Intro दोबारा चलाएँ या visit bar दिखाएँ।"
          )}
        >
          <Row>
            <button
              onClick={replayIntro}
              style={{
                padding: "10px 18px",
                borderRadius: 9999,
                border: "none",
                cursor: "pointer",
                background: GRADIENT,
                color: "#fff",
                fontWeight: 700,
                fontSize: 13.5,
                fontFamily: "inherit"
              }}
            >
              ✨ {t("Replay Maya intro", "Maya intro दोबारा")}
            </button>
            <Pill active={showSticky} onClick={() => setShowSticky((v) => !v)}>
              {t("sticky visit bar", "visit bar")}
            </Pill>
            <span style={{ fontSize: 12.5, color: SEC }}>
              {t("Look bottom-right for the dock →", "नीचे-दाएँ dock देखें →")}
            </span>
          </Row>
        </Section>

        <footer style={{ textAlign: "center", color: SEC, fontSize: 12.5, padding: "10px 0 0" }}>
          {t(
            "Every component honors prefers-reduced-motion — try it in your OS settings and reload.",
            "हर कॉम्पोनेंट reduced-motion का सम्मान करता है।"
          )}
        </footer>
      </main>

      <ToastViewport toasts={toasts} />
      {showSticky && (
        <StickyVisitBar
          locale={locale}
          onCta={() => push("success", t("Visit requested", "विज़िट रिक्वेस्ट"))}
        />
      )}
      {publish && (
        <PublishCelebration
          show={publish}
          onDone={() => setPublish(false)}
          title={t("You're live ✨", "आप लाइव हैं ✨")}
          card={
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "14px 18px",
                boxShadow: "0 20px 60px -20px rgba(26,26,46,.35)",
                fontWeight: 700
              }}
            >
              2 BHK · Hazratganj · ₹18,000/mo
            </div>
          }
        />
      )}
      <MayaDock
        locale={locale}
        onSubmit={(text) => push("success", `${t("Searching", "खोज रही हूँ")}: ${text}`)}
      />
    </div>
  );
}
