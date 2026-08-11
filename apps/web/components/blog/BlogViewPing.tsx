"use client";

import { useEffect, useRef } from "react";
import { getApiBaseUrl } from "../../lib/api";

/**
 * Fire-and-forget reader-view tally for CRIBLIV TIMES articles. Client-side
 * because the article page is ISR-cached — the server renders once per cache
 * window, but every reader mounts this. sendBeacon survives immediate
 * navigation; the fetch fallback is keepalive for the same reason. Renders
 * nothing and must never affect the reading experience.
 */
export function BlogViewPing({ slug }: { slug: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    try {
      const url = `${getApiBaseUrl()}/blog/${encodeURIComponent(slug)}/view`;
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        navigator.sendBeacon(url);
      } else {
        fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch {
      // a tally must never break an article
    }
  }, [slug]);
  return null;
}
