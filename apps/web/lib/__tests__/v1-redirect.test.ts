import { describe, it, expect } from "vitest";
import { extractV1ObjectId, resolveV1RedirectWith, type V1RedirectMap } from "../v1-redirect";

const MAP: V1RedirectMap = {
  "69940773dd3811521305c48c": {
    t: "listing",
    id: "11111111-1111-1111-1111-111111111111",
    city: "lucknow"
  },
  "699805342d0966d6047925b0": {
    t: "pg",
    id: "22222222-2222-2222-2222-222222222222",
    city: "gurugram"
  }
};

describe("extractV1ObjectId", () => {
  it("pulls the trailing 24-hex id from a slug URL", () => {
    expect(extractV1ObjectId("/properties/3-bhk-near-alambagh-69940773dd3811521305c48c")).toBe(
      "69940773dd3811521305c48c"
    );
  });

  it("pulls the id from a bare /pgs/<id> URL with a trailing slash", () => {
    expect(extractV1ObjectId("/pgs/699805342d0966d6047925b0/")).toBe("699805342d0966d6047925b0");
  });

  it("returns null when there is no ObjectId", () => {
    expect(extractV1ObjectId("/properties/just-a-slug")).toBeNull();
  });
});

describe("resolveV1RedirectWith", () => {
  it("301-targets a migrated flat to /en/listing/<uuid>", () => {
    expect(
      resolveV1RedirectWith("/properties/3-bhk-near-alambagh-69940773dd3811521305c48c", MAP)
    ).toBe("/en/listing/11111111-1111-1111-1111-111111111111");
  });

  it("301-targets a migrated PG to /en/pg/<city>/<uuid>", () => {
    expect(resolveV1RedirectWith("/pgs/699805342d0966d6047925b0", MAP)).toBe(
      "/en/pg/gurugram/22222222-2222-2222-2222-222222222222"
    );
  });

  it("falls back to the city landing page for an unmapped v1 URL", () => {
    expect(resolveV1RedirectWith("/properties/old-unverified-aaaaaaaaaaaaaaaaaaaaaaaa", MAP)).toBe(
      "/en/city/lucknow"
    );
  });

  it("falls back for a /properties path that has no id at all", () => {
    expect(resolveV1RedirectWith("/properties/just-a-slug", MAP)).toBe("/en/city/lucknow");
  });

  it("returns null for paths that are not v1 URLs", () => {
    expect(resolveV1RedirectWith("/en/listing/whatever", MAP)).toBeNull();
    expect(resolveV1RedirectWith("/en/search", MAP)).toBeNull();
    expect(resolveV1RedirectWith("/", MAP)).toBeNull();
  });
});
