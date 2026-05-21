import { randomUUID } from "node:crypto";
import type { SasIssueInput, SasIssueResult, SasIssuerPort } from "./sas-issuer.port";

// In-memory SAS issuer for tests. Returns a stub:// URL — never reachable in
// production. Phase 13 swaps the real AzureSasIssuer via DI.
export class InMemorySasIssuer implements SasIssuerPort {
  async issue(input: SasIssueInput): Promise<SasIssueResult> {
    const token = randomUUID();
    const sasUrl = `stub://blob/${input.blobPath}?token=${token}`;
    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    return { sasUrl, expiresAt };
  }
}
