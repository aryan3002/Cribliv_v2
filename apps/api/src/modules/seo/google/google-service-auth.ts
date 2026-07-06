import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class GoogleServiceAuth {
  private readonly cache = new Map<string, CachedToken>();
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    const cacheKey = [...scopes].sort().join(" ");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.accessToken;
    }

    const key = this.loadServiceAccountKey();
    const assertion = this.signJwt(key, cacheKey);
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    });

    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google token exchange failed: token_status_${response.status} ${detail}`);
    }

    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.cache.set(cacheKey, {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + json.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS
    });

    return json.access_token;
  }

  private loadServiceAccountKey(): ServiceAccountKey {
    const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new Error("GSC_SERVICE_ACCOUNT_JSON is not configured");
    }

    try {
      return JSON.parse(raw) as ServiceAccountKey;
    } catch {
      const fileContents = readFileSync(raw, "utf8");
      return JSON.parse(fileContents) as ServiceAccountKey;
    }
  }

  private signJwt(key: ServiceAccountKey, scope: string): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: key.private_key_id };
    const payload = {
      iss: key.client_email,
      scope,
      aud: TOKEN_ENDPOINT,
      iat: nowSec,
      exp: nowSec + 3600
    };

    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = base64url(signer.sign(key.private_key));

    return `${unsigned}.${signature}`;
  }
}
