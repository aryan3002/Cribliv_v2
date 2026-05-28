import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// pdf.js cannot run in jsdom (no real canvas / worker). Mock it — this is a
// render-level test; the real page rendering is verified manually in a browser.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 0, getPage: vi.fn() })
  })
}));

import { PdfPreview } from "../PdfPreview";

describe("PdfPreview", () => {
  it("renders zoom controls", () => {
    render(<PdfPreview bytes={new ArrayBuffer(8)} />);
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeTruthy();
  });

  it("renders a labelled preview region", () => {
    render(<PdfPreview bytes={new ArrayBuffer(8)} />);
    expect(screen.getByLabelText(/agreement preview/i)).toBeTruthy();
  });
});
