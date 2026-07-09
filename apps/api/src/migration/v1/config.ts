export type Collection = "properties" | "pgs" | "both";

export interface MigrationConfig {
  databaseUrl: string;
  mongoUrl: string;
  mongoDb: string;
  cloudinaryCloud: string;
  excelPath?: string;
  azure: { account: string; key: string; container: string };
  apply: boolean;
  skipPhotos: boolean;
  purge: boolean;
  collection: Collection;
  maskedDbHost: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v)
    throw new Error(
      `Missing required env ${name} (pass it explicitly; this script never reads .env)`
    );
  return v;
}

export function maskDbHost(url: string): string {
  return url.replace(/:\/\/[^@]*@/, "://***@").replace(/\?.*$/, "");
}

export function loadConfig(): MigrationConfig {
  const databaseUrl = required("DATABASE_URL");
  const collectionArg = (arg("collection") ?? "both") as Collection;
  if (!["properties", "pgs", "both"].includes(collectionArg)) {
    throw new Error(`--collection must be properties | pgs | both (got "${collectionArg}")`);
  }
  // Azure Blob is NOT transactional — an upload sticks even on dry-run ROLLBACK.
  // Skip photos for LOCAL validation so prod Azure stays clean until cutover.
  const skipPhotos = hasFlag("skip-photos");
  // Azure creds only required when we actually copy photos (i.e. NOT --skip-photos).
  const azureReq = skipPhotos ? (name: string) => process.env[name]?.trim() || "" : required;
  return {
    databaseUrl,
    mongoUrl: required("MONGO_URL"),
    mongoDb: process.env.MONGO_DB?.trim() || "test",
    cloudinaryCloud: required("CLOUDINARY_CLOUD_NAME"),
    excelPath: process.env.EXCEL_PATH?.trim() || undefined,
    azure: {
      account: azureReq("AZURE_STORAGE_ACCOUNT_NAME"),
      key: azureReq("AZURE_STORAGE_ACCOUNT_KEY"),
      container: process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos"
    },
    apply: hasFlag("apply"),
    skipPhotos,
    purge: hasFlag("purge"),
    collection: collectionArg,
    maskedDbHost: maskDbHost(databaseUrl)
  };
}
