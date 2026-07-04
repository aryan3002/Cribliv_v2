import { describe, it, expect, vi } from "vitest";
import {
  buildGeocodeUrl,
  parseGeocodeResponse,
  verifyPlace,
  GeocodeAbortError,
  type VerifiedPlace,
} from "../../../data/seeds/generate-city-helpers";

/** Helper to create a Response-like object */
function jsonResponse(
  body: unknown,
  ok: boolean = true,
  status: number = 200
): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("generate-city-verify", () => {
  describe("buildGeocodeUrl", () => {
    it("contains maps.googleapis.com/maps/api/geocode/json", () => {
      const url = buildGeocodeUrl("Delhi", "test-key");
      expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
    });

    it("URL-encodes the address parameter", () => {
      const url = buildGeocodeUrl("Sector 62", "test-key");
      expect(url).toContain("address=Sector+62");
    });

    it("includes the API key parameter", () => {
      const url = buildGeocodeUrl("Delhi", "my-secret-key");
      expect(url).toContain("key=my-secret-key");
    });
  });

  describe("parseGeocodeResponse", () => {
    it("returns VerifiedPlace for OK status with valid result", () => {
      const body = {
        status: "OK",
        results: [
          {
            formatted_address: "Sector 62, Noida, UP 201309, India",
            geometry: {
              location: {
                lat: 28.6266,
                lng: 77.3723,
              },
            },
          },
        ],
      };
      const result = parseGeocodeResponse(body);
      expect(result).toEqual({
        canonical_name: "Sector 62, Noida, UP 201309, India",
        lat: 28.6266,
        lng: 77.3723,
      });
    });

    it("returns null for ZERO_RESULTS status", () => {
      const body = {
        status: "ZERO_RESULTS",
        results: [],
      };
      expect(parseGeocodeResponse(body)).toBeNull();
    });

    it("returns null for malformed body (null)", () => {
      expect(parseGeocodeResponse(null)).toBeNull();
    });

    it("returns null when results array exists but first result is missing required fields", () => {
      const body = {
        status: "OK",
        results: [{}],
      };
      expect(parseGeocodeResponse(body)).toBeNull();
    });

    it("returns null when status is OK but results is missing", () => {
      const body = {
        status: "OK",
      };
      expect(parseGeocodeResponse(body)).toBeNull();
    });

    it("returns 'abort' for REQUEST_DENIED status", () => {
      const body = {
        status: "REQUEST_DENIED",
        error_message: "The provided API key is invalid.",
      };
      expect(parseGeocodeResponse(body)).toBe("abort");
    });

    it("returns 'abort' for OVER_QUERY_LIMIT status", () => {
      const body = {
        status: "OVER_QUERY_LIMIT",
        error_message: "You have exceeded your daily request quota.",
      };
      expect(parseGeocodeResponse(body)).toBe("abort");
    });

    it("returns null for unknown status", () => {
      const body = {
        status: "INVALID_REQUEST",
      };
      expect(parseGeocodeResponse(body)).toBeNull();
    });
  });

  describe("verifyPlace", () => {
    it("returns VerifiedPlace on successful geocode", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OK",
          results: [
            {
              formatted_address: "Sector 62, Noida",
              geometry: { location: { lat: 28.6266, lng: 77.3723 } },
            },
          ],
        })
      );

      const result = await verifyPlace("Sector 62", "key", mockFetch);
      expect(result).toEqual({
        canonical_name: "Sector 62, Noida",
        lat: 28.6266,
        lng: 77.3723,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("maps.googleapis.com")
      );
    });

    it("returns null for ZERO_RESULTS", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "ZERO_RESULTS",
          results: [],
        })
      );

      const result = await verifyPlace("InvalidPlace", "key", mockFetch);
      expect(result).toBeNull();
    });

    it("returns null when fetch rejects", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const result = await verifyPlace("Sector 62", "key", mockFetch);
      expect(result).toBeNull();
    });

    it("returns null on HTTP 500 error", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({}, false, 500));

      const result = await verifyPlace("Sector 62", "key", mockFetch);
      expect(result).toBeNull();
    });

    it("throws GeocodeAbortError on REQUEST_DENIED", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "REQUEST_DENIED",
          error_message: "The API key is invalid.",
        })
      );

      await expect(verifyPlace("Sector 62", "key", mockFetch)).rejects.toThrow(
        GeocodeAbortError
      );
      const error = new GeocodeAbortError("REQUEST_DENIED");
      expect(error.status).toBe("REQUEST_DENIED");
    });

    it("throws GeocodeAbortError on OVER_QUERY_LIMIT", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OVER_QUERY_LIMIT",
          error_message: "Daily quota exceeded.",
        })
      );

      await expect(verifyPlace("Sector 62", "key", mockFetch)).rejects.toThrow(
        GeocodeAbortError
      );
      const error = new GeocodeAbortError("OVER_QUERY_LIMIT");
      expect(error.status).toBe("OVER_QUERY_LIMIT");
    });
  });
});
