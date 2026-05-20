import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import type { SasIssueInput, SasIssueResult, SasIssuerPort } from "./sas-issuer.port";

// Real Azure Blob SAS issuer. Read-only ('r'), HTTPS-only, expiry = now + ttlSeconds,
// scoped to a single blob. Phase 13 wires this via DI behind SasIssuerPort.
// Spec: [[PDF-Pipeline]] §Download flow step 2c.

interface AzureSasIssuerOpts {
  /** Storage account name (the `<account>` in `<account>.blob.core.windows.net`). */
  accountName: string;
  /** Base64-encoded storage account key. */
  accountKey: string;
  /** Container that holds rendered agreement PDFs. Default container per spec: `rent-agreements`. */
  containerName: string;
}

export class AzureSasIssuer implements SasIssuerPort {
  private readonly credential: StorageSharedKeyCredential;
  private readonly accountName: string;
  private readonly containerName: string;

  constructor(opts: AzureSasIssuerOpts) {
    if (!opts.accountKey || opts.accountKey.length === 0) {
      throw new Error("Azure account key is required");
    }
    this.accountName = opts.accountName;
    this.containerName = opts.containerName;
    this.credential = new StorageSharedKeyCredential(opts.accountName, opts.accountKey);
  }

  async issue(input: SasIssueInput): Promise<SasIssueResult> {
    const expiresOn = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: input.blobPath,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn: input.now,
        expiresOn
      },
      this.credential
    ).toString();
    const sasUrl =
      `https://${this.accountName}.blob.core.windows.net/` +
      `${this.containerName}/${input.blobPath}?${sas}`;
    return { sasUrl, expiresAt: expiresOn };
  }
}
