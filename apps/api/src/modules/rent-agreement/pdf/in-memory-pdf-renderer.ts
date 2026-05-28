import type { PdfRendererPort, RenderInput } from "./pdf-renderer.port";

// Phase 8a stub. Returns a deterministic fake buffer so worker tests can assert
// the renderer→storage→callback round-trip. Phase 8b replaces with Puppeteer +
// Handlebars.

export class InMemoryPdfRenderer implements PdfRendererPort {
  private renderCount = 0;

  async render(input: RenderInput): Promise<Buffer> {
    this.renderCount += 1;
    return Buffer.from(`PDF-FAKE-${input.row.id}-${input.locale}`);
  }

  get callCount(): number {
    return this.renderCount;
  }
}
