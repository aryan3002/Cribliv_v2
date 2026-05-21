// Renderer port. Phase 8a uses in-memory stub; Phase 8b lands the real Puppeteer +
// Handlebars implementation behind this same interface.

import type { RentAgreementRow } from "../drafts/draft-summary.mapper";

export interface SignatureProjection {
  party: "owner" | "tenant";
  content_type: "image/png" | "image/jpeg";
  image_bytes: Buffer;
}

export interface RenderInput {
  row: RentAgreementRow;
  signatures: SignatureProjection[];
  locale: string;
}

export interface PdfRendererPort {
  render(input: RenderInput): Promise<Buffer>;
}
