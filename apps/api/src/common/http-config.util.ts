function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function readTrustProxySetting(raw: string | undefined): boolean | number | string {
  if (!raw || raw.trim() === "") return false;
  const bool = parseBoolean(raw);
  if (bool !== null) return bool;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return raw.trim();
}

export function readCorsAllowedOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain at least one origin");
  }
  if (origins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS cannot include '*' when credentials are enabled");
  }
  return origins;
}
