"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { parseQuery, type ParsedChip } from "../lib/smart-parser";
import {
  buildHeroCountPath,
  buildMapHandoffUrl,
  pinMatchesChips,
  type HeroPin
} from "../lib/hero-query";
import { HOME_CITY_COOKIE, type HomeCityConfig } from "../lib/home-city-config";
import { projectToBounds } from "../lib/geo";
import { fetchApi } from "../lib/api";
import { t, type Locale } from "../lib/i18n";
import { track } from "../lib/track";
import { VoiceSearchButton } from "./voice-search-button";
import type { VoiceStage } from "./voice-search-types";
import { MayaOrb, RollingCount, type OrbState } from "./motion/ListeningHeroMotion";

interface HomeListeningHeroProps {
  locale: Locale;
  city: HomeCityConfig;
  pins: HeroPin[];
  totalCount: number | null;
  showCount: boolean;
  /** Additive motion layer (Maya orb in the bar + rolling count). Default off. */
  motionV2?: boolean;
}

interface CountResponse {
  items: unknown[];
  total: number;
}

const COUNT_DEBOUNCE_MS = 400;
const PLACEHOLDER_ROTATE_MS = 4000;

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

function chipKey(chip: ParsedChip): string {
  return `${chip.kind}:${chip.value}`;
}

export default function HomeListeningHero({
  locale,
  city,
  pins,
  totalCount,
  showCount,
  motionV2 = false
}: HomeListeningHeroProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<ParsedChip[]>([]);
  const [chipResidual, setChipResidual] = useState("");
  const [chipConfidence, setChipConfidence] = useState(0);
  const [dictionary, setDictionary] = useState<{ cities: string[]; localities: string[] }>({
    cities: [],
    localities: []
  });
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [voiceStage, setVoiceStage] = useState<VoiceStage>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [pinHost, setPinHost] = useState<HTMLElement | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const countAbortRef = useRef<AbortController | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevChipKeysRef = useRef<Set<string>>(new Set());
  const lastChipLabelRef = useRef<string>("");
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cityLabel = city.label[locale] ?? city.label.en;
  const examples = [
    t(locale, "listenHeroExample1"),
    t(locale, "listenHeroExample2"),
    t(locale, "listenHeroExample3")
  ];

  // motionV2: map the Web-Speech voice stage onto Maya's orb state so the
  // search icon morphs into her listening orb while the mic is live (Beat 3).
  const orbState: OrbState =
    voiceStage === "listening" || voiceStage === "transcribing"
      ? "listening"
      : voiceStage === "parsing" || voiceStage === "searching"
        ? "thinking"
        : "idle";

  // Mount: pin portal host, viewed event.
  useEffect(() => {
    setPinHost(document.getElementById("hero-listen-pins"));
    track("listening_hero_viewed", { locale });
  }, [locale]);

  // Dictionary for the local parser (same pattern as SearchHero).
  useEffect(() => {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
      /\/+$/,
      ""
    );
    const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
    fetch(`${base}/listings/search/dictionary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body?.data) return;
        setDictionary({
          cities: Array.isArray(body.data.cities) ? body.data.cities : [],
          localities: Array.isArray(body.data.localities) ? body.data.localities : []
        });
      })
      .catch(() => {
        /* parser still handles BHK/rent/type without the dictionary */
      });
  }, []);

  // Re-parse per keystroke; emit hero_chip_locked for newly locked chips.
  useEffect(() => {
    if (query.trim().length < 2) {
      setChips([]);
      setChipResidual("");
      setChipConfidence(0);
      prevChipKeysRef.current = new Set();
      return;
    }
    const result = parseQuery(query, dictionary.cities, dictionary.localities);
    setChips(result.chips);
    setChipResidual(result.residual);
    setChipConfidence(result.confidence);

    const keys = new Set(result.chips.map(chipKey));
    for (const chip of result.chips) {
      if (!prevChipKeysRef.current.has(chipKey(chip))) {
        track("hero_chip_locked", {
          chip_type: chip.kind,
          chips_count: result.chips.length,
          confidence: result.confidence,
          via: voiceStage === "idle" ? "typed" : "voice"
        });
        lastChipLabelRef.current = chip.label;
        // The debounced count for this new chip set hasn't resolved yet, so
        // announce with the same ellipsis fallback the visible counter uses
        // rather than a blank/stale number. The re-resolve effect below
        // re-announces with the real count once it lands.
        setLiveMessage(
          `${chip.label}, ${fill(t(locale, "listenHeroCountMatching"), {
            n: "…"
          })}`
        );
      }
    }
    prevChipKeysRef.current = keys;
    // matchCount intentionally omitted: live message uses the value at lock time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dictionary, locale, voiceStage]);

  // Re-announce the live region once the debounced match count resolves, so
  // screen-reader users eventually hear the real number instead of the
  // "so far…" placeholder from the chip-lock announcement above.
  useEffect(() => {
    if (chips.length === 0 || matchCount === null) return;
    const label = lastChipLabelRef.current;
    if (!label) return;
    setLiveMessage(
      `${label}, ${fill(t(locale, "listenHeroCountReady"), { n: String(matchCount) })}`
    );
  }, [matchCount, locale, chips.length]);

  // Debounced counter fetch whenever the chip set changes.
  const chipsSignature = chips.map(chipKey).join("|");
  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    if (chips.length === 0) {
      countAbortRef.current?.abort();
      setMatchCount(null);
      return;
    }
    countTimerRef.current = setTimeout(async () => {
      countAbortRef.current?.abort();
      const controller = new AbortController();
      countAbortRef.current = controller;
      try {
        const res = await fetchApi<CountResponse>(buildHeroCountPath(chips, city.slug), {
          signal: controller.signal
        });
        if (!controller.signal.aborted && Number.isFinite(res.total)) {
          setMatchCount(res.total);
        }
      } catch {
        // Network failure → approximate from the local pins instead.
        if (!controller.signal.aborted) {
          setMatchCount(pins.filter((p) => pinMatchesChips(p, chips)).length);
        }
      }
    }, COUNT_DEBOUNCE_MS);
    return () => {
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
      countAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipsSignature, city.slug]);

  // Rotating placeholder (static under reduced motion).
  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % examples.length),
      PLACEHOLDER_ROTATE_MS
    );
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const navigate = useCallback(
    (url: string) => {
      const push = () => router.push(url as never);
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => void;
      };
      if (!reducedMotion && typeof doc.startViewTransition === "function") {
        doc.startViewTransition(push);
      } else {
        push();
      }
    },
    [router, reducedMotion]
  );

  // Submit with an explicit chip set / query / confidence rather than the
  // component's state. The voice path parses the final transcript and calls
  // this synchronously — it must NOT rely on `query`/`chips` state, which the
  // preceding `setQuery(text)` hasn't flushed yet (stale-closure bug).
  const submitWith = useCallback(
    (chipsToUse: ParsedChip[], queryText: string, confidenceToUse: number) => {
      if (submitting) return;
      const trimmed = queryText.trim();
      const url =
        chipsToUse.length > 0
          ? buildMapHandoffUrl(locale, chipsToUse, city, pins)
          : `/${locale}/map?city=${city.slug}&src=hero${
              trimmed ? `&q=${encodeURIComponent(trimmed)}` : ""
            }`;
      track("hero_submitted", {
        chips_count: chipsToUse.length,
        confidence: confidenceToUse,
        source: chipsToUse.length > 0 && confidenceToUse >= 0.7 ? "fastpath" : "regex",
        match_count: matchCount ?? -1,
        query_length: queryText.length
      });
      document.cookie = `${HOME_CITY_COOKIE}=${city.slug};path=/;max-age=${
        60 * 60 * 24 * 90
      };SameSite=Lax`;
      setSubmitting(true);
      rootRef.current?.closest(".hero-listen")?.setAttribute("data-submitting", "true");
      if (reducedMotion) {
        navigate(url);
      } else {
        setTimeout(() => navigate(url), 350);
      }
    },
    [city, locale, matchCount, navigate, pins, reducedMotion, submitting]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      submitWith(chips, query, chipConfidence);
    },
    [submitWith, chips, query, chipConfidence]
  );

  // Counter as JSX so the number gets its own styled span (amber, tabular).
  const counterNode = (() => {
    if (!showCount) return <>{fill(t(locale, "listenHeroGrowing"), { city: cityLabel })}</>;
    let template: string;
    let n: string;
    let numeric: number | null = null;
    if (chips.length === 0) {
      if (totalCount === null) return null;
      template = fill(t(locale, "listenHeroCountIdle"), { city: cityLabel });
      n = String(totalCount);
      numeric = totalCount;
    } else if (matchCount === null) {
      template = t(locale, "listenHeroCountMatching");
      n = "…";
    } else if (matchCount === 0) {
      // "0 homes match" is a small-number confession — never render it.
      return <>{t(locale, "listenHeroCountZero")}</>;
    } else {
      template = t(locale, "listenHeroCountReady");
      n = String(matchCount);
      numeric = matchCount;
    }
    const [before, after = ""] = template.split("{n}");
    // motionV2 rolls a real number up (Beat 4); otherwise the static span.
    const numNode =
      motionV2 && numeric !== null ? (
        <RollingCount
          value={numeric}
          className="hero-listen__counter-num"
          style={{ color: "#f5b04c", fontWeight: 700 }}
        />
      ) : (
        <span className="hero-listen__counter-num">{n}</span>
      );
    return (
      <>
        {before}
        {numNode}
        {after}
      </>
    );
  })();

  // ---- Pin layer (portaled into the server-rendered backdrop container) ----
  const projected = useMemo(
    () =>
      pins
        .map((pin) => ({ pin, pos: projectToBounds(pin.lat, pin.lng, city.bounds) }))
        .filter(({ pos }) => pos.xPct >= 1 && pos.xPct <= 99 && pos.yPct >= 1 && pos.yPct <= 99),
    [pins, city.bounds]
  );
  const labelledIds = useMemo(() => {
    const byRent = [...projected].sort((a, b) => a.pin.monthly_rent - b.pin.monthly_rent);
    const picks = [...byRent.slice(0, 4), ...byRent.slice(-4)];
    return new Set(picks.map(({ pin }) => pin.id));
  }, [projected]);

  const pinLayer =
    pinHost && showCount
      ? createPortal(
          projected.map(({ pin, pos }, i) => {
            const matches = chips.length === 0 || pinMatchesChips(pin, chips);
            return (
              <span
                key={pin.id}
                className={`hero-listen__pin${matches ? "" : " hero-listen__pin--dim"}`}
                style={{
                  left: `${pos.xPct}%`,
                  top: `${pos.yPct}%`,
                  animationDelay: `${Math.min(i, 24) * 45}ms`
                }}
              >
                {labelledIds.has(pin.id) && (
                  <span className="hero-listen__pin-label">
                    ₹{Math.round(pin.monthly_rent / 1000)}k
                  </span>
                )}
              </span>
            );
          }),
          pinHost
        )
      : null;

  return (
    <div className="hero-listen__panel" ref={rootRef}>
      {pinLayer}
      <form className="hero-listen__form" onSubmit={handleSubmit}>
        <label htmlFor="hero-listen-input" className="sr-only">
          {t(locale, "listenHeroTitle")}
        </label>
        <div className="hero-listen__input-row">
          {motionV2 ? (
            // Maya is present in the bar (idle breathing) and morphs to her
            // listening/thinking state while the mic is live — Beat 3, and she
            // stays visible so the hero reads as "Maya listens".
            <span className="hero-listen__input-icon hero-listen__input-orb" aria-hidden="true">
              <MayaOrb state={orbState} size={24} />
            </span>
          ) : (
            <Search size={17} aria-hidden="true" className="hero-listen__input-icon" />
          )}
          <input
            id="hero-listen-input"
            className="hero-listen__input"
            type="text"
            value={query}
            enterKeyHint="search"
            autoComplete="off"
            placeholder={examples[placeholderIdx]}
            readOnly={submitting}
            onChange={(e) => setQuery(e.target.value)}
          />
          <VoiceSearchButton
            locale={locale}
            onTranscript={(text) => setQuery(text)}
            onStageChange={(stage) => {
              setVoiceStage(stage);
              if (stage === "listening") track("hero_voice_started", { path: "webspeech" });
            }}
            onResult={(result) => {
              const text = result.transcription?.text?.trim() ?? "";
              track("hero_voice_transcript", { length: text.length, locale });
              if (text) setQuery(text);
              // Submit with the freshly parsed transcript — not the stale
              // `chips`/`query` state, which the setQuery above hasn't flushed.
              const parsed = parseQuery(text, dictionary.cities, dictionary.localities);
              submitWith(parsed.chips, text, parsed.confidence);
            }}
          />
          <button type="submit" className="hero-listen__submit" disabled={submitting}>
            {t(locale, "navSearch")}
          </button>
        </div>

        {voiceStage !== "idle" && voiceStage !== "error" && (
          <p className="hero-listen__voice-stage">{t(locale, "listenHeroListening")}</p>
        )}

        <div className="hero-listen__chips" aria-hidden="true">
          {chips.map((chip) => (
            <span
              key={chipKey(chip)}
              className={`hero-listen__chip hero-listen__chip--${chip.kind}`}
            >
              {chip.label}
            </span>
          ))}
          {chips.length > 0 && chipConfidence < 0.7 && chipResidual.trim() && (
            <span className="hero-listen__chip hero-listen__chip--refining">…</span>
          )}
        </div>

        {counterNode && (
          <p className="hero-listen__counter" aria-hidden="true">
            {counterNode}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {liveMessage}
        </p>
      </form>
    </div>
  );
}
