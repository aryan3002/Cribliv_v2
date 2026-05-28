"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global unhandled error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <section
          style={{ padding: "2rem", textAlign: "center", maxWidth: "600px", margin: "0 auto" }}
        >
          <h1>Something went wrong</h1>
          <p style={{ color: "#666", marginBottom: "1.5rem" }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.75rem 2rem",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "1rem"
            }}
          >
            Try again
          </button>
        </section>
      </body>
    </html>
  );
}
