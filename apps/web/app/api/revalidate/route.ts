import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * On-demand ISR revalidation for programmatic SEO pages after an admin copy
 * change, so edits show immediately instead of waiting for the 24h window.
 *
 * Authorization: the admin UI passes its bearer token; we verify it maps to an
 * admin via the API's /auth/me before busting any cache. This route only ever
 * revalidates root-relative paths — it never fetches or returns page content.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: { code: "unauthorized" } }, 401);

  let role: string | undefined;
  try {
    const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as { data?: { role?: string } } | null;
      role = payload?.data?.role;
    }
  } catch {
    role = undefined;
  }
  if (role !== "admin") return json({ error: { code: "forbidden" } }, 403);

  const body = (await req.json().catch(() => ({}))) as { paths?: unknown };
  if (!Array.isArray(body.paths)) return json({ error: { code: "invalid_paths" } }, 400);

  const revalidated: string[] = [];
  for (const p of body.paths) {
    if (typeof p === "string" && p.startsWith("/")) {
      revalidatePath(p);
      revalidated.push(p);
    }
  }
  return json({ data: { revalidated } });
}
