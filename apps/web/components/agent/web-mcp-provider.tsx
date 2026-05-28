"use client";

import { useEffect } from "react";

/**
 * Registers Cribliv's in-page tool surface with the WebMCP API
 * (`navigator.modelContext.provideContext`). Tools are intentionally
 * read-only — they navigate the active tab to a Cribliv URL so the human
 * user always sees and consents to any state change.
 *
 * Spec: https://webmachinelearning.github.io/webmcp/
 * Chrome support note: https://developer.chrome.com/blog/webmcp-epp
 */

type JsonSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

declare global {
  interface Navigator {
    modelContext?: {
      provideContext?: (ctx: { tools: WebMcpTool[] }) => unknown;
    };
  }
}

function getLocale(): "en" | "hi" {
  if (typeof window === "undefined") return "en";
  const m = window.location.pathname.match(/^\/(en|hi)(\/|$)/);
  return (m?.[1] as "en" | "hi") ?? "en";
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function WebMcpProvider() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ctx = navigator.modelContext;
    if (!ctx?.provideContext) return;

    const locale = getLocale();

    const tools: WebMcpTool[] = [
      {
        name: "search_listings",
        description:
          "Search Cribliv rental listings. Navigates the current tab to a filtered search results page.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City slug, e.g. lucknow, gurugram" },
            intent: {
              type: "string",
              description: "Intent slug, e.g. flat-on-rent, pg-for-students, family-housing"
            },
            budget_max: { type: "number", description: "Max monthly rent in INR" },
            budget_min: { type: "number", description: "Min monthly rent in INR" },
            bhk: { type: "string", description: "1, 2, 3 or 4+" },
            locality: { type: "string", description: "Locality slug within the city" }
          },
          required: ["city"]
        },
        execute: async (args) => {
          const url = buildUrl(`/${locale}/search`, {
            city: args.city as string,
            intent: args.intent as string | undefined,
            budget_min: args.budget_min as number | undefined,
            budget_max: args.budget_max as number | undefined,
            bhk: args.bhk as string | undefined,
            locality: args.locality as string | undefined
          });
          window.location.assign(url);
          return { ok: true, url };
        }
      },
      {
        name: "open_listing",
        description: "Open a Cribliv listing detail page by listing UUID.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "Listing UUID" } },
          required: ["id"]
        },
        execute: async ({ id }) => {
          const url = buildUrl(`/${locale}/listing/${encodeURIComponent(String(id))}`);
          window.location.assign(url);
          return { ok: true, url };
        }
      },
      {
        name: "list_pgs",
        description:
          "List PGs (paying-guest accommodations) for a city + tenant type. Navigates to a filtered search results page.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
            tenant_type: {
              type: "string",
              description: "students | working_professionals | family"
            },
            gender: { type: "string", description: "male | female | unisex" }
          },
          required: ["city"]
        },
        execute: async (args) => {
          const url = buildUrl(`/${locale}/search`, {
            city: args.city as string,
            intent: "pg",
            tenant_type: args.tenant_type as string | undefined,
            gender: args.gender as string | undefined
          });
          window.location.assign(url);
          return { ok: true, url };
        }
      },
      {
        name: "open_pg",
        description: "Open a PG detail page by PG UUID.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        execute: async ({ id }) => {
          const url = buildUrl(`/${locale}/pg/${encodeURIComponent(String(id))}`);
          window.location.assign(url);
          return { ok: true, url };
        }
      },
      {
        name: "navigate",
        description:
          "Navigate the current tab to any Cribliv URL (relative path). Use sparingly — only for paths documented in the agent skills index.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Path beginning with /" } },
          required: ["path"]
        },
        execute: async ({ path }) => {
          const safe = String(path);
          if (!safe.startsWith("/")) return { ok: false, error: "path must start with /" };
          const url = buildUrl(safe);
          window.location.assign(url);
          return { ok: true, url };
        }
      }
    ];

    try {
      ctx.provideContext({ tools });
    } catch (err) {
      // WebMCP is still draft — failures must never break the page.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[WebMCP] provideContext failed", err);
      }
    }
  }, []);

  return null;
}
