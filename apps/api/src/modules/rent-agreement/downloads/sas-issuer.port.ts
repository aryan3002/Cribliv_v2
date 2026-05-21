// Port for issuing a time-limited, read-only, HTTPS-only Azure Blob SAS URL.
// In-memory adapter for Phase 9 tests; Azure adapter for Phase 13 wiring.
// Spec: [[PDF-Pipeline]] §Download flow steps 2c.

export interface SasIssueInput {
  blobPath: string;
  ttlSeconds: number;
  /** UTC instant used as the SAS validity window's start. */
  now: Date;
}

export interface SasIssueResult {
  sasUrl: string;
  expiresAt: Date;
}

export interface SasIssuerPort {
  issue(input: SasIssueInput): Promise<SasIssueResult>;
}
