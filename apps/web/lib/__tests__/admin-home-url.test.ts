import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminHomePublicUrl, copyAdminHomeUrl } from "../admin-home-url";

const publicPath = "/en/listing/11111111-1111-4111-8111-111111111111";
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
});

function mockExecCommand(copied: boolean) {
  const execCommand = vi.fn().mockReturnValue(copied);
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true
  });
  return execCommand;
}

describe("admin home public URLs", () => {
  it("builds an absolute production URL without using window.location", () => {
    expect(adminHomePublicUrl(publicPath)).toBe(
      "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111"
    );
  });

  it("uses NEXT_PUBLIC_SITE_URL and normalizes leading and trailing slashes", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.cribliv.com///";

    expect(adminHomePublicUrl(publicPath.slice(1))).toBe(
      "https://preview.cribliv.com/en/listing/11111111-1111-4111-8111-111111111111"
    );
  });
});

describe("copyAdminHomeUrl", () => {
  it("copies with navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await copyAdminHomeUrl(publicPath);

    expect(writeText).toHaveBeenCalledWith(
      "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111"
    );
  });

  it("falls back to a temporary textarea when clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true
    });
    const execCommand = mockExecCommand(true);

    await copyAdminHomeUrl(publicPath);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to a temporary textarea when clipboard is absent", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = mockExecCommand(true);

    await copyAdminHomeUrl(publicPath);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("throws when both clipboard strategies fail", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mockExecCommand(false);

    await expect(copyAdminHomeUrl(publicPath)).rejects.toThrow("copy_failed");

    expect(document.querySelector("textarea")).toBeNull();
  });
});
