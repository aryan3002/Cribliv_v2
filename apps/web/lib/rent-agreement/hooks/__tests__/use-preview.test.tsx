import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../../auth/auth-provider";
import { FlagsProvider } from "../../flags/flags-provider";
import { usePreview } from "../use-preview";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <FlagsProvider>
        <AuthProvider>{children}</AuthProvider>
      </FlagsProvider>
    </QueryClientProvider>
  );
}

function Probe() {
  const q = usePreview("draft-1");
  if (q.isLoading) return <div>loading</div>;
  if (q.isError) return <div>error</div>;
  return <div>bytes:{q.data?.byteLength ?? 0}</div>;
}

// URL-aware mock — the auth adapter fires its own request before /preview.
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/preview")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 body").buffer,
        json: async () => ({})
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePreview", () => {
  it("returns the PDF bytes from GET /:id/preview", async () => {
    render(
      <Wrapper>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => expect(screen.getByText(/^bytes:/)).toBeInTheDocument());
    expect(screen.getByText("bytes:13")).toBeInTheDocument();
  });
});
