// Azure Blob Storage configuration for rent-agreement PDFs.
//
// `.env` carries AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY (no
// connection string). `AzurePdfStorage` / `BlobServiceClient.fromConnectionString`
// need a connection string, so build one from the name + key.

export const DEFAULT_RENT_AGREEMENT_CONTAINER = "rent-agreements";

export function buildAzureConnectionString(accountName: string, accountKey: string): string {
  return (
    `DefaultEndpointsProtocol=https;AccountName=${accountName};` +
    `AccountKey=${accountKey};EndpointSuffix=core.windows.net`
  );
}

export interface AzureStorageConfig {
  accountName: string;
  accountKey: string;
  containerName: string;
  /** True only when both the account name and key are configured. */
  present: boolean;
}

export function readAzureStorageConfig(env: NodeJS.ProcessEnv = process.env): AzureStorageConfig {
  const accountName = (env.AZURE_STORAGE_ACCOUNT_NAME ?? "").trim();
  const accountKey = (env.AZURE_STORAGE_ACCOUNT_KEY ?? "").trim();
  const containerName =
    (env.RENT_AGREEMENT_AZURE_CONTAINER ?? "").trim() || DEFAULT_RENT_AGREEMENT_CONTAINER;
  return {
    accountName,
    accountKey,
    containerName,
    present: accountName !== "" && accountKey !== ""
  };
}
