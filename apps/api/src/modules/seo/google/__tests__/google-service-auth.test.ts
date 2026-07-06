import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { GoogleServiceAuth } from "../google-service-auth";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const FAKE_KEY = {
  type: "service_account",
  project_id: "cribliv-seo",
  private_key_id: "abc123",
  private_key: privateKey,
  client_email: "seo-worker@cribliv-seo.iam.gserviceaccount.com",
  client_id: "111222333444"
};

describe("GoogleServiceAuth", () => {
  const originalEnv = process.env.GSC_SERVICE_ACCOUNT_JSON;

  beforeEach(() => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv;
  });

  it("mints an access token by POSTing a signed JWT to the Google token endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      return {
        ok: true,
        json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
      } as Response;
    });

    const auth = new GoogleServiceAuth(fetchMock as unknown as typeof fetch);
    const token = await auth.getAccessToken(["https://www.googleapis.com/auth/indexing"]);

    expect(token).toBe("ya29.fake-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches the token for the same scopes and does not re-fetch until near expiry", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
    })) as unknown as typeof fetch;

    const auth = new GoogleServiceAuth(fetchMock);
    const scopes = ["https://www.googleapis.com/auth/indexing"];

    await auth.getAccessToken(scopes);
    await auth.getAccessToken(scopes);
    await auth.getAccessToken(scopes);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches for a different scope set (separate cache key)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
    })) as unknown as typeof fetch;

    const auth = new GoogleServiceAuth(fetchMock);
    await auth.getAccessToken(["https://www.googleapis.com/auth/indexing"]);
    await auth.getAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when GSC_SERVICE_ACCOUNT_JSON is missing", async () => {
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    const auth = new GoogleServiceAuth(vi.fn() as unknown as typeof fetch);

    await expect(auth.getAccessToken(["scope"])).rejects.toThrow(
      /GSC_SERVICE_ACCOUNT_JSON is not configured/
    );
  });

  it("throws when the token endpoint returns a non-OK response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid_grant"
    })) as unknown as typeof fetch;

    const auth = new GoogleServiceAuth(fetchMock);

    await expect(auth.getAccessToken(["https://www.googleapis.com/auth/indexing"])).rejects.toThrow(
      /token_status_401/
    );
  });
});
