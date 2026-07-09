import { describe, it, expect } from "vitest";
import { extractV1ObjectId, cloudinaryUrl, extFromContentType } from "../v1-url";

describe("extractV1ObjectId", () => {
  it("pulls the trailing 24-hex ObjectId", () => {
    expect(
      extractV1ObjectId(
        "https://cribliv.com/properties/3-bhk-for-rent-near-krishna-nagar-alambagh-69940773dd3811521305c48c"
      )
    ).toBe("69940773dd3811521305c48c");
  });
  it("handles the slug-format-drift variant", () => {
    expect(
      extractV1ObjectId(
        "https://cribliv.com/properties/3bhk-for-rent-near-rashmi-khand-bangla-bazaar-699805342d0966d6047925b0"
      )
    ).toBe("699805342d0966d6047925b0");
  });
  it("returns null when no ObjectId is present", () => {
    expect(extractV1ObjectId("https://cribliv.com/about")).toBeNull();
  });
});

describe("cloudinaryUrl", () => {
  it("builds the delivery URL", () => {
    expect(cloudinaryUrl("dia01qg8p", "cribliv/properties/abc/img.png")).toBe(
      "https://res.cloudinary.com/dia01qg8p/image/upload/cribliv/properties/abc/img.png"
    );
  });
});

describe("extFromContentType", () => {
  it("maps mimes", () => {
    expect(extFromContentType("image/jpeg")).toBe("jpg");
    expect(extFromContentType("image/png")).toBe("png");
    expect(extFromContentType("image/webp")).toBe("webp");
    expect(extFromContentType("application/octet-stream")).toBe("bin");
  });
});
