import { Injectable } from "@nestjs/common";
import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";

function parseConnStringAccount(raw: string | undefined) {
  const values = new Map<string, string>();
  for (const part of (raw ?? "").split(";")) {
    const entry = part.trim();
    if (!entry.includes("=")) continue;
    const [key, ...rest] = entry.split("=");
    values.set(key.toLowerCase(), rest.join("="));
  }
  return {
    accountName: (values.get("accountname") ?? "").trim(),
    accountKey: (values.get("accountkey") ?? "").trim()
  };
}

/**
 * Mints read-only, short-lived SAS URLs for verification artifacts (liveness
 * video / electricity bill) stored in the private verification-artifacts
 * container. Mirrors rent-agreement/downloads/azure-sas-issuer.ts.
 */
@Injectable()
export class VerificationArtifactSasIssuer {
  private readonly accountName: string;
  private readonly accountKey: string;
  private readonly containerName: string;

  constructor() {
    const conn = parseConnStringAccount(process.env.AZURE_STORAGE_CONNECTION_STRING);
    this.accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim() || conn.accountName;
    this.accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim() || conn.accountKey;
    this.containerName =
      process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS?.trim() ||
      "verification-artifacts";
  }

  issue(blobPath: string, ttlSeconds = 600): { url: string; expiresAt: string } | null {
    if (!this.accountName || !this.accountKey || !blobPath) return null;
    const credential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + ttlSeconds * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn
      },
      credential
    ).toString();
    const url =
      `https://${this.accountName}.blob.core.windows.net/` +
      `${this.containerName}/${blobPath}?${sas}`;
    return { url, expiresAt: expiresOn.toISOString() };
  }
}
