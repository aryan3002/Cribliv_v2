import Script from "next/script";

/**
 * Microsoft Clarity — session replays, heatmaps, and UX-insight signals
 * (rage clicks, dead clicks, quick-backs, JS errors).
 *
 * Loads only when NEXT_PUBLIC_CLARITY_ID is set, so local dev (id unset)
 * records nothing and doesn't pollute the project. The clarity.ms origins are
 * allow-listed in next.config.mjs CSP (script-src + connect-src) — without that
 * the browser silently blocks the tag.
 */
export function ClarityAnalytics() {
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;
  if (!clarityId) return null;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarityId}");`}
    </Script>
  );
}
