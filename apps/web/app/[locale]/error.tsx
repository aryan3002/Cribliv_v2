"use client";

import { useEffect } from "react";

export default function LocaleError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO: Send to error tracking service (Sentry / Application Insights)
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      <div className="alert alert--error">
        <h2>Something went wrong</h2>
        <p>An unexpected error occurred. Please try again.</p>
        <button className="btn btn--primary" onClick={reset}>
          Try again
        </button>
      </div>
    </section>
  );
}
