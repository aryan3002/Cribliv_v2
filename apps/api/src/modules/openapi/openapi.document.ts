/**
 * Public OpenAPI 3.1 document for Cribliv's read API.
 *
 * Only includes endpoints that are safe for unauthenticated agent discovery:
 * health, listings/PG search, listing detail, locality SEO data, OTP send/verify
 * (so agents can document the auth handshake even though they cannot complete it).
 *
 * Authenticated owner/admin/tenant routes are intentionally excluded.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || `${SITE_URL}/v1`;

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cribliv Public API",
      version: "0.1.0",
      summary: "Read-only discovery surface for the Cribliv rentals platform.",
      description:
        "Public endpoints for searching listings and PGs, fetching a single listing, retrieving SEO metadata, checking service health, and starting the phone-OTP login challenge. Owner/admin/tenant mutations are not documented here and require an authenticated bearer token (obtained via /auth/otp/verify).",
      contact: { name: "Cribliv", url: SITE_URL },
      license: { name: "Proprietary" }
    },
    servers: [{ url: API_BASE, description: "Production / current environment" }],
    tags: [
      { name: "health", description: "Service liveness and database status" },
      { name: "search", description: "Listing and PG search" },
      { name: "listings", description: "Individual listing detail" },
      { name: "seo", description: "Locality and city SEO metadata" },
      { name: "auth", description: "Phone OTP authentication handshake" }
    ],
    paths: {
      "/health": {
        get: {
          tags: ["health"],
          summary: "Service health",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Healthy",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthEnvelope" }
                }
              }
            }
          }
        }
      },
      "/listings/search": {
        get: {
          tags: ["search"],
          summary: "Search listings",
          operationId: "searchListings",
          parameters: [
            {
              name: "city",
              in: "query",
              schema: { type: "string" },
              description: "City slug, e.g. lucknow"
            },
            { name: "locality", in: "query", schema: { type: "string" } },
            {
              name: "intent",
              in: "query",
              schema: { type: "string" },
              description: "e.g. flat-on-rent, pg-for-students"
            },
            { name: "budget_min", in: "query", schema: { type: "integer", minimum: 0 } },
            { name: "budget_max", in: "query", schema: { type: "integer", minimum: 0 } },
            { name: "bhk", in: "query", schema: { type: "string", description: "1, 2, 3, 4+" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            {
              name: "page_size",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50, default: 20 }
            }
          ],
          responses: {
            "200": {
              description: "Paginated listings",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ListingSearchEnvelope" }
                }
              }
            }
          }
        }
      },
      "/listings/search/suggest": {
        get: {
          tags: ["search"],
          summary: "Typeahead suggestions for the search bar",
          operationId: "suggestSearch",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Suggestions" } }
        }
      },
      "/listings/search/popular-localities": {
        get: {
          tags: ["search"],
          summary: "Top localities for a city",
          operationId: "popularLocalities",
          parameters: [{ name: "city", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "List of localities with listing counts" } }
        }
      },
      "/listings/{listing_id}": {
        get: {
          tags: ["listings"],
          summary: "Fetch a single listing",
          description:
            "Records a `view` event for non-owner viewers — this is the only place a listing view is persisted. Pass `track_view=0` for reads that are not a user looking at the listing (embedded cards, metadata generation) so owners' view metrics stay honest.",
          operationId: "getListing",
          parameters: [
            {
              name: "listing_id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" }
            },
            {
              name: "ref",
              in: "query",
              required: false,
              description:
                "Traffic-source tag stored as view-event metadata. Only `blog-*` refs are accepted.",
              schema: { type: "string" }
            },
            {
              name: "track_view",
              in: "query",
              required: false,
              description:
                "Set to `0` or `false` to suppress the view event. The response payload is identical either way. Defaults to tracking.",
              schema: { type: "string", enum: ["0", "1", "true", "false"] }
            }
          ],
          responses: {
            "200": {
              description: "Listing detail",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ListingEnvelope" }
                }
              }
            },
            "404": { description: "Not found" }
          }
        }
      },
      "/listings/{listing_id}/similar": {
        get: {
          tags: ["listings"],
          summary: "Similar listings",
          operationId: "getSimilarListings",
          parameters: [
            {
              name: "listing_id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          responses: { "200": { description: "Up to 10 similar listings" } }
        }
      },
      "/seo/localities/{citySlug}": {
        get: {
          tags: ["seo"],
          summary: "All localities for a city (SEO)",
          operationId: "getLocalitiesByCity",
          parameters: [
            { name: "citySlug", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: { "200": { description: "Locality list" } }
        }
      },
      "/seo/localities/{citySlug}/{localitySlug}": {
        get: {
          tags: ["seo"],
          summary: "Locality detail (SEO)",
          operationId: "getLocality",
          parameters: [
            { name: "citySlug", in: "path", required: true, schema: { type: "string" } },
            { name: "localitySlug", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: { "200": { description: "Locality copy + stats" } }
        }
      },
      "/auth/otp/send": {
        post: {
          tags: ["auth"],
          summary: "Send a phone OTP challenge",
          description:
            "Initiates the OTP-based login flow. Returns a challenge_id which is exchanged for a session bearer token via /auth/otp/verify. Bearer tokens have the form `acc_<uuid>` and must be passed as `Authorization: Bearer acc_<uuid>` on protected requests.",
          operationId: "sendOtp",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["phone_e164", "purpose"],
                  properties: {
                    phone_e164: { type: "string", example: "+919999999901" },
                    purpose: { type: "string", enum: ["login", "signup"] }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Challenge issued" } }
        }
      },
      "/auth/otp/verify": {
        post: {
          tags: ["auth"],
          summary: "Verify an OTP and exchange for a session token",
          operationId: "verifyOtp",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["challenge_id", "otp_code"],
                  properties: {
                    challenge_id: { type: "string", format: "uuid" },
                    otp_code: { type: "string", pattern: "^[0-9]{4,8}$" }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Session token + user payload" } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque",
          description: "Opaque session token issued by /auth/otp/verify, format `acc_<uuid>`."
        }
      },
      schemas: {
        Envelope: {
          type: "object",
          properties: {
            ok: { type: "boolean", const: true },
            data: { description: "Endpoint-specific payload" }
          },
          required: ["ok", "data"]
        },
        HealthEnvelope: {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    status: { type: "string", const: "ok" },
                    db: { type: "string", enum: ["up", "down", "disabled"] },
                    ts: { type: "string", format: "date-time" }
                  },
                  required: ["status", "db", "ts"]
                }
              }
            }
          ]
        },
        Listing: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            price_inr: { type: "integer" },
            bhk: { type: "string" },
            address: { type: "string" },
            city_slug: { type: "string" },
            locality_slug: { type: "string" },
            photos: { type: "array", items: { type: "string", format: "uri" } },
            verified: { type: "boolean" }
          },
          required: ["id", "title", "price_inr"]
        },
        ListingSearchEnvelope: {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    results: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
                    total: { type: "integer" },
                    page: { type: "integer" },
                    page_size: { type: "integer" }
                  }
                }
              }
            }
          ]
        },
        ListingEnvelope: {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            {
              type: "object",
              properties: { data: { $ref: "#/components/schemas/Listing" } }
            }
          ]
        }
      }
    }
  };
}
