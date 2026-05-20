// Defensive guard for user-supplied signature images. Caller passes raw bytes +
// declared content-type. We sniff magic bytes (PNG/JPEG only), cross-check the
// declared type, cap raw size at 500 KB, decode via sharp to verify ≤ 2 MP, and
// re-encode to strip EXIF/ICC/comments. SHA-256 is computed over the re-encoded
// bytes (what gets persisted). All other formats — SVG, HTML, GIF, WebP, PDF —
// are rejected. See [[Security]] §Signature images.

import { createHash } from "node:crypto";

import sharp from "sharp";

const MAX_RAW_BYTES = 500 * 1024;
const MAX_DECODED_PIXELS = 2_000_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export type SignatureContentType = "image/png" | "image/jpeg";

export interface SignatureGuardResult {
  bytes: Buffer;
  contentType: SignatureContentType;
  sha256: string;
}

export type SignatureGuardErrorCode =
  | "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW"
  | "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
  | "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH"
  | "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_DECODED"
  | "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED";

export class SignatureGuardError extends Error {
  readonly code: SignatureGuardErrorCode;
  constructor(code: SignatureGuardErrorCode, message: string) {
    super(message);
    this.name = "SignatureGuardError";
    this.code = code;
  }
}

function sniff(raw: Buffer): SignatureContentType | null {
  if (raw.length >= PNG_MAGIC.length && raw.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return "image/png";
  }
  if (raw.length >= JPEG_MAGIC.length && raw.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return "image/jpeg";
  }
  return null;
}

export async function validateAndReencodeSignatureImage(
  raw: Buffer,
  declaredContentType: string
): Promise<SignatureGuardResult> {
  if (raw.length > MAX_RAW_BYTES) {
    throw new SignatureGuardError(
      "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW",
      `Signature image exceeds ${MAX_RAW_BYTES} bytes (got ${raw.length})`
    );
  }

  const sniffed = sniff(raw);
  if (!sniffed) {
    throw new SignatureGuardError(
      "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES",
      "Signature image must be PNG or JPEG (magic-byte sniff failed)"
    );
  }

  if (declaredContentType !== sniffed) {
    throw new SignatureGuardError(
      "RENT_AGREEMENT_SIGNATURE_CONTENT_TYPE_MISMATCH",
      `Declared content-type '${declaredContentType}' does not match sniffed type '${sniffed}'`
    );
  }

  let reencoded: Buffer;
  try {
    const pipeline = sharp(raw);
    const meta = await pipeline.metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) {
      throw new SignatureGuardError(
        "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED",
        "Could not read decoded image dimensions"
      );
    }
    if (width * height > MAX_DECODED_PIXELS) {
      throw new SignatureGuardError(
        "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_DECODED",
        `Decoded image exceeds ${MAX_DECODED_PIXELS} pixels (${width}×${height})`
      );
    }
    const reencoder = sniffed === "image/png" ? pipeline.png() : pipeline.jpeg();
    reencoded = await reencoder.toBuffer();
  } catch (err) {
    if (err instanceof SignatureGuardError) throw err;
    throw new SignatureGuardError(
      "RENT_AGREEMENT_SIGNATURE_DECODE_FAILED",
      err instanceof Error ? err.message : "sharp pipeline failed"
    );
  }

  const sha256 = createHash("sha256").update(reencoded).digest("hex");
  return { bytes: reencoded, contentType: sniffed, sha256 };
}
