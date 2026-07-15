import { describe, it, expect } from "vitest";

import { buildListing } from "../structured-data";

describe("buildListing", () => {
  it("builds a RealEstateListing with a monthly Offer, address and geo", () => {
    const ld = buildListing({
      url: "https://cribliv.test/en/pg/lucknow/abc",
      name: "Boys PG in Narhi",
      description: "Verified PG with food",
      price: 3000,
      addressLocality: "Narhi",
      addressRegion: "Lucknow",
      lat: 26.85,
      lng: 80.95,
      images: ["https://img.test/1.jpg", "/relative/2.jpg"]
    });

    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("RealEstateListing");
    expect(ld.name).toBe("Boys PG in Narhi");
    expect(ld.url).toBe("https://cribliv.test/en/pg/lucknow/abc");
    expect(ld.description).toBe("Verified PG with food");

    // Only absolute image URLs survive.
    expect(ld.image).toEqual(["https://img.test/1.jpg"]);

    expect(ld.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "Narhi",
      addressRegion: "Lucknow",
      addressCountry: "IN"
    });

    expect(ld.geo).toMatchObject({
      "@type": "GeoCoordinates",
      latitude: 26.85,
      longitude: 80.95
    });

    const offer = ld.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe(3000);
    expect(offer.priceCurrency).toBe("INR");
    expect(offer.availability).toBe("https://schema.org/InStock");

    // Rent is recurring — a UnitPriceSpecification communicates "per month".
    const spec = offer.priceSpecification as Record<string, unknown>;
    expect(spec["@type"]).toBe("UnitPriceSpecification");
    expect(spec.price).toBe(3000);
    expect(spec.priceCurrency).toBe("INR");
    expect(spec.unitCode).toBe("MON");
  });

  it("omits offer, image, geo and description when that data is missing", () => {
    const ld = buildListing({
      url: "https://cribliv.test/en/listing/x",
      name: "Studio room",
      addressRegion: "Noida"
    });

    expect(ld.offers).toBeUndefined();
    expect(ld.image).toBeUndefined();
    expect(ld.geo).toBeUndefined();
    expect(ld.description).toBeUndefined();
    expect(ld.address).toMatchObject({
      "@type": "PostalAddress",
      addressRegion: "Noida",
      addressCountry: "IN"
    });
  });

  it("drops the image field when no absolute URLs are supplied", () => {
    const ld = buildListing({
      url: "https://cribliv.test/en/listing/x",
      name: "Studio room",
      images: ["/a.jpg", "b.jpg"]
    });

    expect(ld.image).toBeUndefined();
  });

  it("omits address entirely when neither locality nor region is known", () => {
    const ld = buildListing({ url: "https://cribliv.test/en/listing/x", name: "Studio room" });

    expect(ld.address).toBeUndefined();
  });

  it("marks an unavailable listing as OutOfStock", () => {
    const ld = buildListing({
      url: "https://cribliv.test/en/listing/x",
      name: "Studio room",
      price: 5000,
      available: false
    });

    const offer = ld.offers as Record<string, unknown>;
    expect(offer.availability).toBe("https://schema.org/OutOfStock");
  });

  it("resolves a relative page url against SITE_URL", () => {
    const ld = buildListing({ url: "/en/listing/x", name: "Studio room" });

    expect(String(ld.url)).toContain("/en/listing/x");
    expect(String(ld.url).startsWith("http")).toBe(true);
  });
});
