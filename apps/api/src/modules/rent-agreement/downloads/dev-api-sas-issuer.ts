import type { SasIssueInput, SasIssueResult, SasIssuerPort } from "./sas-issuer.port";

// Dev-only SAS issuer. Returns a URL pointing at this same API's dev pdf-bytes
// endpoint instead of an Azure-signed blob URL — the frontend can open it in a
// new tab and see the PDF without any Azure infrastructure. Production swaps in
// AzureSasIssuer. NEVER use this in production: the dev endpoint has no token
// verification.

export interface DevApiSasIssuerOpts {
  baseUrl?: string;
}

export class DevApiSasIssuer implements SasIssuerPort {
  private readonly baseUrl: string;

  constructor(opts: DevApiSasIssuerOpts = {}) {
    this.baseUrl = opts.baseUrl ?? "";
  }

  async issue(input: SasIssueInput): Promise<SasIssueResult> {
    const encoded = encodeURIComponent(input.blobPath);
    const sasUrl = `${this.baseUrl}/v1/rent-agreement/_dev/pdf-bytes/${encoded}`;
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { sasUrl, expiresAt };
  }
}
