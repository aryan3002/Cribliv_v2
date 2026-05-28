import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../../auth/auth-provider";
import { FlagsProvider } from "../../flags/flags-provider";
import { usePlans } from "../use-plans";

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
  const q = usePlans();
  if (q.isLoading) return <div>loading</div>;
  if (q.isError) return <div>error</div>;
  return <div>plans:{q.data?.length ?? 0}</div>;
}

// D4: URL-aware mock. The auth adapter fires its own request (NextAuth
// session probe, or /_dev/bootstrap) BEFORE usePlans hits /plans, so a single
// mockResolvedValueOnce would be consumed by the wrong call. Dispatch on URL.
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/rent-agreement/plans")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "basic" }, { id: "standard" }, { id: "premium" }] })
      } as Response);
    }
    if (url.includes("/_dev/bootstrap")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            access_token: "acc_test",
            refresh_token: "ref_test",
            user: { id: "u1", role: "tenant" }
          }
        })
      } as Response);
    }
    // NextAuth session probe (or anything else) — benign empty payload.
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePlans", () => {
  it("renders the plan count from the GET /plans response", async () => {
    render(
      <Wrapper>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => expect(screen.getByText(/^plans:/)).toBeInTheDocument());
    expect(screen.getByText("plans:3")).toBeInTheDocument();
  });
});
