import { describe, expect, it } from "vitest";
import { readCorsAllowedOrigins, readTrustProxySetting } from "../src/common/http-config.util";

describe("http-config util", () => {
  it("rejects wildcard CORS origin when credentials are enabled", () => {
    expect(() => readCorsAllowedOrigins("*")).toThrow(/cannot include '\*'/i);
  });

  it("parses explicit CORS origins", () => {
    expect(readCorsAllowedOrigins("https://a.example.com, https://b.example.com")).toEqual([
      "https://a.example.com",
      "https://b.example.com"
    ]);
  });

  it("parses trust proxy bool/number/string modes", () => {
    expect(readTrustProxySetting(undefined)).toBe(false);
    expect(readTrustProxySetting("true")).toBe(true);
    expect(readTrustProxySetting("2")).toBe(2);
    expect(readTrustProxySetting("loopback, linklocal, uniquelocal")).toBe(
      "loopback, linklocal, uniquelocal"
    );
  });
});
