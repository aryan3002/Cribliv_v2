export const DEFAULT_API_BASE_URL = "http://localhost:4000/v1";

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
  opts: { server?: boolean } = {}
): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: opts.server ? "no-store" : init.cache
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
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
