import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock sharp BEFORE importing the SUT. sharp is a native module; we never want it
// running in unit tests. Each test customizes the mock via vi.mocked() below.
vi.mock("sharp", () => {
  const sharpMock = vi.fn();
  return { default: sharpMock };
});

import sharp from "sharp";

import {
  SignatureGuardError,
  validateAndReencodeSignatureImage
} from "../../signatures/image.guard";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function pngBuf(payloadSize = 64): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(payloadSize, 0)]);
}

function jpegBuf(payloadSize = 64): Buffer {
  return Buffer.concat([JPEG_MAGIC, Buffer.alloc(payloadSize, 0)]);
}

interface MockSharpOptions {
  metadata?: { width?: number; height?: number };
  reencoded?: Buffer;
  metadataThrows?: Error;
  toBufferThrows?: Error;
}

function mockSharp(opts: MockSharpOptions = {}) {
  const reencoded = opts.reencoded ?? Buffer.from("reencoded-bytes");
  const chain = {
    metadata: vi.fn(async () => {
      if (opts.metadataThrows) throw opts.metadataThrows;
      return opts.metadata ?? { width: 100, height: 100 };
    }),
    png: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(async () => {
      if (opts.toBufferThrows) throw opts.toBufferThrows;
      return reencoded;
    })
  };
  vi.mocked(sharp).mockReturnValue(chain as unknown as ReturnType<typeof sharp>);
  return chain;
}

beforeEach(() => {
  vi.mocked(sharp).mockReset();
});

/* ─── Happy path ──────────────────────────────────────────────────────── */

describe("validateAndReencodeSignatureImage: happy path", () => {
  it("accepts a valid PNG ≤ 500 KB ≤ 2 MP and returns re-encoded bytes + sha256", async () => {
    mockSharp({ metadata: { width: 800, height: 600 } });
    const raw = pngBuf();

    const result = await validateAndReencodeSignatureImage(raw, "image/png");

    expect(result.contentType).toBe("image/png");
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a valid JPEG and returns content_type 'image/jpeg'", async () => {
    mockSharp({ metadata: { width: 100, height: 100 } });
    const raw = jpegBuf();

    const result = await validateAndReencodeSignatureImage(raw, "image/jpeg");

    expect(result.contentType).toBe("image/jpeg");
  });

  it("sha256 is stable across two calls with the same re-encoded bytes", async () => {
    mockSharp({ reencoded: Buffer.from("stable") });
    const raw = pngBuf();
    const a = await validateAndReencodeSignatureImage(raw, "image/png");
    mockSharp({ reencoded: Buffer.from("stable") });
    const b = await validateAndReencodeSignatureImage(raw, "image/png");
    expect(a.sha256).toBe(b.sha256);
  });

  it("calls sharp().png() for PNG input (re-encode strips EXIF)", async () => {
    const chain = mockSharp();
    await validateAndReencodeSignatureImage(pngBuf(), "image/png");
    expect(chain.png).toHaveBeenCalled();
  });

  it("calls sharp().jpeg() for JPEG input", async () => {
    const chain = mockSharp();
    await validateAndReencodeSignatureImage(jpegBuf(), "image/jpeg");
    expect(chain.jpeg).toHaveBeenCalled();
  });
});

/* ─── Raw size cap ─────────────────────────────────────────────────────── */

describe("validateAndReencodeSignatureImage: raw size", () => {
  it("rejects raw bytes > 500 KB with code RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW", async () => {
    const raw = Buffer.concat([PNG_MAGIC, Buffer.alloc(500 * 1024)]);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      name: "SignatureGuardError",
      code: "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW"
    });
  });

  it("accepts raw bytes exactly at the 500 KB boundary", async () => {
    mockSharp({ metadata: { width: 10, height: 10 } });
    const raw = Buffer.alloc(500 * 1024);
    PNG_MAGIC.copy(raw, 0);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).resolves.toBeDefined();
  });

  it("does not call sharp when raw size exceeds limit (fast path)", async () => {
    const raw = Buffer.concat([PNG_MAGIC, Buffer.alloc(600 * 1024)]);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toBeDefined();
    expect(sharp).not.toHaveBeenCalled();
  });
});

/* ─── Magic-byte sniff ─────────────────────────────────────────────────── */

describe("validateAndReencodeSignatureImage: magic bytes", () => {
  it("rejects SVG payload (starts with '<svg') with BAD_MAGIC_BYTES", async () => {
    const raw = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("rejects HTML/JS payload with BAD_MAGIC_BYTES", async () => {
    const raw = Buffer.from("<!DOCTYPE html><script>fetch('/admin/delete')</script>");
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("rejects GIF magic bytes (GIF89a)", async () => {
    const raw = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("rejects WebP magic bytes (RIFF...WEBP)", async () => {
    const raw = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WEBP"),
      Buffer.alloc(64)
    ]);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("rejects PDF magic bytes (%PDF-)", async () => {
    const raw = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64)]);
    await expect(validateAndReencodeSignatureImage(raw, "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("rejects empty buffer", async () => {
    await expect(
      validateAndReencodeSignatureImage(Buffer.alloc(0), "image/png")
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES" });
  });

  it("rejects buffer too short to contain magic bytes", async () => {
    await expect(
      validateAndReencodeSignatureImage(Buffer.from([0x89, 0x50]), "image/png")
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES" });
  });
});

/* ─── Content-type mismatch ────────────────────────────────────────────── */

describe("validateAndReencodeSignatureImage: declared content-type cross-check", () => {
  it("rejects PNG magic bytes with declared image/jpeg", async () => {
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/jpeg")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH"
    });
  });

  it("rejects JPEG magic bytes with declared image/png", async () => {
    await expect(validateAndReencodeSignatureImage(jpegBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH"
    });
  });

  it("rejects unsupported declared content_type (image/gif) even when bytes are PNG", async () => {
    await expect(
      validateAndReencodeSignatureImage(pngBuf(), "image/gif" as unknown as "image/png")
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH" });
  });

  it("rejects unsupported declared content_type (image/svg+xml)", async () => {
    await expect(
      validateAndReencodeSignatureImage(pngBuf(), "image/svg+xml" as unknown as "image/png")
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH" });
  });
});

/* ─── Decoded pixel cap (2 MP) ─────────────────────────────────────────── */

describe("validateAndReencodeSignatureImage: decoded dimensions", () => {
  it("rejects image whose width*height > 2,000,000 with TOO_LARGE_DECODED", async () => {
    mockSharp({ metadata: { width: 2000, height: 1500 } });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_DECODED"
    });
  });

  it("accepts image exactly at 2 MP boundary (2,000,000 px)", async () => {
    mockSharp({ metadata: { width: 2000, height: 1000 } });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).resolves.toBeDefined();
  });

  it("rejects when sharp.metadata() returns no width", async () => {
    mockSharp({ metadata: { height: 100 } });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED"
    });
  });

  it("rejects when sharp.metadata() returns no height", async () => {
    mockSharp({ metadata: { width: 100 } });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED"
    });
  });

  it("rejects with DECODE_FAILED when sharp throws (e.g. corrupted image)", async () => {
    mockSharp({ metadataThrows: new Error("invalid image format") });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED"
    });
  });

  it("rejects with DECODE_FAILED when sharp.toBuffer() throws during re-encode", async () => {
    mockSharp({
      metadata: { width: 100, height: 100 },
      toBufferThrows: new Error("re-encode failed")
    });
    await expect(validateAndReencodeSignatureImage(pngBuf(), "image/png")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED"
    });
  });
});

/* ─── Error shape ──────────────────────────────────────────────────────── */

describe("SignatureGuardError", () => {
  it("is a real Error subclass with name 'SignatureGuardError' and a string code", async () => {
    try {
      await validateAndReencodeSignatureImage(Buffer.from("not-an-image"), "image/png");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureGuardError);
      expect((err as SignatureGuardError).name).toBe("SignatureGuardError");
      expect(typeof (err as SignatureGuardError).code).toBe("string");
      expect((err as SignatureGuardError).message).toBeTruthy();
      return;
    }
    throw new Error("expected SignatureGuardError to be thrown");
  });
});
