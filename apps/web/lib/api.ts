export const DEFAULT_API_BASE_URL = "http://localhost:4000/v1";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, input: { status: number; code?: string; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

export function getApiBaseUrl() {
  const raw = (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");

  return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

export async function fetchApi<T>(
  path: string,
  init: RequestInit = {},
  opts: { server?: boolean; revalidate?: number } = {}
): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers ?? {});
  const isFormDataBody = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("Content-Type") && init.body && !isFormDataBody) {
    headers.set("Content-Type", "application/json");
  }

  // Cache strategy for server-side (RSC) fetches:
  //   - opts.revalidate: ISR-cache this fetch for N seconds. This is what lets a
  //     page with generateStaticParams stay static/ISR — its data revalidates in
  //     the background instead of the fetch forcing the whole route dynamic.
  //     THIS is how "the page's ISR revalidation governs freshness" is actually
  //     achieved; `no-store` defeats it (opts the route into per-request SSR).
  //   - opts.server (no revalidate): no-store — never cached, forces the route
  //     dynamic. Only for pages that must be per-request fresh (search, authed).
  const cacheInit: RequestInit =
    typeof opts.revalidate === "number"
      ? { next: { revalidate: opts.revalidate } }
      : { cache: opts.server ? "no-store" : init.cache };

  const response = await fetch(url, {
    ...init,
    headers,
    ...cacheInit
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = payload?.error ?? payload ?? {};
    const message = errorPayload?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, {
      status: response.status,
      code: errorPayload?.code,
      details: errorPayload?.details
    });
  }

  return payload.data as T;
}

export function buildSearchQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  return search.toString();
}
