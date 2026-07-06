import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSearchPerformance = vi.fn();
const fetchSeoCoverage = vi.fn();
const fetchIndexingQueue = vi.fn();
const submitIndexingUrl = vi.fn();
const retryIndexingUrl = vi.fn();
const fetchSearchPerformanceCsv = vi.fn();

vi.mock("../../../../lib/admin-api", () => ({
  fetchSearchPerformance: (...args: unknown[]) => fetchSearchPerformance(...args),
  fetchSeoCoverage: (...args: unknown[]) => fetchSeoCoverage(...args),
  fetchIndexingQueue: (...args: unknown[]) => fetchIndexingQueue(...args),
  submitIndexingUrl: (...args: unknown[]) => submitIndexingUrl(...args),
  retryIndexingUrl: (...args: unknown[]) => retryIndexingUrl(...args),
  fetchSearchPerformanceCsv: (...args: unknown[]) => fetchSearchPerformanceCsv(...args)
}));

import { SearchPerformanceTab } from "../SearchPerformanceTab";

const PERFORMANCE_RESULT = {
  items: [
    {
      keyword: "2bhk noida",
      page: "/en/city/noida",
      locale: "en",
      citySlug: "noida",
      position: 14.2,
      impressions: 320,
      clicks: 18,
      ctr: 0.056,
      capturedAt: "2026-07-06",
      isTarget: false,
      isIgnored: false
    }
  ],
  total: 1,
  totals: { totalImpressions: 320, totalClicks: 18, avgPosition: 14.2 }
};

const QUEUE_RESULT = {
  items: [
    {
      id: "q1",
      url: "https://cribliv.com/en/city/noida",
      status: "failed",
      reason: "city_enabled",
      attempts: 5,
      submittedAt: null,
      updatedAt: "2026-07-06T00:00:00.000Z"
    }
  ],
  total: 1,
  summary: { countsByStatus: { failed: 1 }, submittedToday: 3, dailyQuota: 200 }
};

describe("SearchPerformanceTab", () => {
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSearchPerformance.mockResolvedValue(PERFORMANCE_RESULT);
    fetchSeoCoverage.mockResolvedValue({ indexedCount: 42, submittedCount: 7 });
    fetchIndexingQueue.mockResolvedValue(QUEUE_RESULT);
    fetchSearchPerformanceCsv.mockResolvedValue("keyword,page\n2bhk noida,/en/city/noida\n");
  });

  it("loads and renders rankings, coverage stats, and the indexing queue", async () => {
    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);

    expect(await screen.findByText("2bhk noida")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/cribliv\.com\/en\/city\/noida/)).toBeInTheDocument();
    expect(fetchSearchPerformance).toHaveBeenCalledWith("tok", expect.objectContaining({}));
    expect(fetchIndexingQueue).toHaveBeenCalledWith("tok", expect.objectContaining({}));
  });

  it("toggles to the quick-wins view and re-fetches with quickWins: true", async () => {
    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
    await screen.findByText("2bhk noida");

    fireEvent.click(screen.getByRole("button", { name: /quick wins/i }));

    await waitFor(() => {
      expect(fetchSearchPerformance).toHaveBeenCalledWith(
        "tok",
        expect.objectContaining({ quickWins: true })
      );
    });
  });

  it("downloads CSV through the authenticated admin client", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn(() => "blob:search-performance");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
    await screen.findByText("2bhk noida");

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(fetchSearchPerformanceCsv).toHaveBeenCalledWith("tok", expect.objectContaining({}));
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:search-performance");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalClick;
  });

  it("submits a manual indexing URL and reloads the queue", async () => {
    submitIndexingUrl.mockResolvedValue({
      id: "q2",
      url: "https://cribliv.com/x",
      status: "pending",
      reason: "manual_admin_submit",
      attempts: 0,
      submittedAt: null,
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
    await screen.findByText("2bhk noida");

    fireEvent.change(screen.getByPlaceholderText(/https:\/\/cribliv\.com/i), {
      target: { value: "https://cribliv.com/x" }
    });
    fireEvent.click(screen.getByRole("button", { name: /submit url/i }));

    await waitFor(() => {
      expect(submitIndexingUrl).toHaveBeenCalledWith("tok", "https://cribliv.com/x", undefined);
    });
    await waitFor(() => expect(fetchIndexingQueue).toHaveBeenCalledTimes(2));
    expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/submitted/i), "trust");
  });

  it("retries a failed row", async () => {
    retryIndexingUrl.mockResolvedValue({
      id: "q1",
      url: "https://cribliv.com/en/city/noida",
      status: "pending",
      reason: "city_enabled",
      attempts: 5,
      submittedAt: null,
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
    await screen.findByText("2bhk noida");

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(retryIndexingUrl).toHaveBeenCalledWith("tok", "q1");
    });
  });

  it("shows a danger toast when loading search performance fails", async () => {
    fetchSearchPerformance.mockRejectedValue(new Error("network down"));
    render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith("network down", "danger");
    });
  });
});
