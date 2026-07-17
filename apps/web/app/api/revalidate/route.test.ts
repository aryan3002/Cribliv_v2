import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePathMock(p) }));

import { POST } from "./route";

function makeReq(body: unknown, token?: string) {
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function meResponse(role: string) {
  return new Response(JSON.stringify({ data: { role } }), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/revalidate", () => {
  it("401 when there is no bearer token", async () => {
    const res = await POST(makeReq({ paths: ["/en/x"] }));
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("403 when the caller is not an admin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(meResponse("tenant"));
    const res = await POST(makeReq({ paths: ["/en/x"] }, "tok"));
    expect(res.status).toBe(403);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("403 when /auth/me is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const res = await POST(makeReq({ paths: ["/en/x"] }, "tok"));
    expect(res.status).toBe(403);
  });

  it("revalidates each valid path for an admin caller", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(meResponse("admin"));
    const res = await POST(
      makeReq({ paths: ["/en/city/lucknow/x", "/hi/city/lucknow/x", "not-a-path"] }, "tok")
    );
    expect(res.status).toBe(200);
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/city/lucknow/x");
    expect(revalidatePathMock).toHaveBeenCalledWith("/hi/city/lucknow/x");
    expect(revalidatePathMock).not.toHaveBeenCalledWith("not-a-path");
    const json = await res.json();
    expect(json.data.revalidated).toEqual(["/en/city/lucknow/x", "/hi/city/lucknow/x"]);
  });

  it("400 when paths is not an array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(meResponse("admin"));
    const res = await POST(makeReq({ paths: "nope" }, "tok"));
    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
