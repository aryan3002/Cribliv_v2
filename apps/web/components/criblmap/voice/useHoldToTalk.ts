"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => unknown) | null;
  onend: ((ev: Event) => unknown) | null;
  onerror: ((ev: { error: string }) => unknown) | null;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => unknown)
    | null;
}
type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type HoldToTalkState = "idle" | "listening" | "denied" | "error";
export interface HoldToTalkApi {
  supported: boolean;
  state: HoldToTalkState;
  start: () => void;
  stop: () => void;
}

export function useHoldToTalk(opts: {
  lang: string;
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
}): HoldToTalkApi {
  const [state, setState] = useState<HoldToTalkState>("idle");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const ctor = getCtor();
  const supported = ctor !== null;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const start = useCallback(() => {
    if (!ctor) {
      setState("error");
      return;
    }
    const rec = new ctor();
    rec.lang = optsRef.current.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setState("listening");
    rec.onend = () => setState((s) => (s === "listening" ? "idle" : s));
    rec.onerror = (e) => setState(e.error === "not-allowed" ? "denied" : "error");
    rec.onresult = (e) => {
      let interim = "",
        final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text;
        else interim += text;
      }
      if (interim) optsRef.current.onInterim(interim);
      if (final) optsRef.current.onFinal(final);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState("error");
    }
  }, [ctor]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    },
    []
  );

  return { supported, state, start, stop };
}
