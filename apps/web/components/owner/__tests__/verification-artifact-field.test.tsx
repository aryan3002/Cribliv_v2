import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VerificationArtifactField } from "../verification-artifact-field";

const ownerWorkspaceCss = readFileSync(
  resolve(process.cwd(), "components/owner/owner-workspace.css"),
  "utf8"
);

function fixtureFile(name = "video-proof.mp4", type = "video/mp4") {
  return new File(
    [new Uint8Array([0x00, 0x00, 0x00, 0x14]), "ftypisom", new Uint8Array(2048)],
    name,
    { type, lastModified: 1234 }
  );
}

describe("VerificationArtifactField", () => {
  it("shows the selected filename and upload progress", () => {
    render(
      <VerificationArtifactField
        accept="video/mp4,video/webm,video/quicktime"
        label="Upload verification video"
        file={fixtureFile()}
        status="uploading"
        progress={42}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText(/upload verification video/i, { selector: "input" })
    ).toHaveAttribute("type", "file");
    expect(screen.getByText("video-proof.mp4")).toBeInTheDocument();
    expect(screen.getByText(/2\.1 KB/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /upload verification video/i })).toHaveValue(42);
    expect(screen.getByText("42% uploaded")).toBeInTheDocument();
  });

  it("keeps a failed artifact and offers Retry and Remove", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    render(
      <VerificationArtifactField
        accept="application/pdf,image/jpeg,image/png,image/webp"
        label="Upload electricity bill"
        file={new File(["%PDF-1.7\n"], "bill.pdf", { type: "application/pdf" })}
        status="error"
        progress={63}
        error="The upload was interrupted. Check your connection, then retry."
        onSelect={vi.fn()}
        onRemove={onRemove}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("bill.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/upload was interrupted/i);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/artifact_blob_path|blob_path|verification-artifacts/i)).toBeNull();
  });

  it("keeps the file input accessible and exposes a visible keyboard focus state", () => {
    render(
      <VerificationArtifactField
        accept="video/mp4,video/webm,video/quicktime"
        label="Upload verification video"
        file={null}
        status="idle"
        progress={0}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText(/upload verification video/i, { selector: "input" })
    ).toHaveAttribute("type", "file");
    expect(screen.getByText("Select file")).toBeInTheDocument();
    expect(ownerWorkspaceCss).toMatch(/\.ovc-artifact:focus-within\s+\.ovc-artifact__surface/s);
    expect(ownerWorkspaceCss).toMatch(/\.ovc-artifact__select:focus-visible/s);
  });
});
