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
    <section className="hero">
      <div className="panel warning-box">
        <h2>Something went wrong</h2>
        <p>An unexpected error occurred. Please try again.</p>
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </section>
  );
}
