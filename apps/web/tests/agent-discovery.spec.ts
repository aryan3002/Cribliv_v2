import { expect, test } from "@playwright/test";

const WELL_KNOWN_ROUTES = [
  { path: "/robots.txt", contentType: /text\/plain/ },
  { path: "/.well-known/api-catalog", contentType: /application\/linkset\+json/ },
  { path: "/.well-known/agent-skills/index.json", contentType: /application\/json/ },
  { path: "/.well-known/mcp/server-card.json", contentType: /application\/json/ }
];

test.describe("agent discovery surface", () => {
  for (const r of WELL_KNOWN_ROUTES) {
    test(`${r.path} returns expected content-type`, async ({ request }) => {
      const res = await request.get(r.path);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(r.contentType);
    });
  }

  test("robots.txt includes Content-Signal directive", async ({ request }) => {
    const res = await request.get("/robots.txt");
    const body = await res.text();
    expect(body).toMatch(/Content-Signal:\s*search=yes/);
    expect(body).toMatch(/ai-train=no/);
    expect(body).toMatch(/ai-input=yes/);
    expect(body).toMatch(/Sitemap:/);
  });

  test("api-catalog has the required linkset structure", async ({ request }) => {
    const res = await request.get("/.well-known/api-catalog");
    const body = await res.json();
    expect(Array.isArray(body.linkset)).toBe(true);
    const entry = body.linkset[0];
    expect(entry.anchor).toBeTruthy();
    expect(entry["service-desc"]?.[0]?.href).toMatch(/\/v1\/openapi\.json$/);
    expect(entry["status"]?.[0]?.href).toMatch(/\/v1\/health$/);
  });

  test("agent-skills index lists skills with sha256 digests", async ({ request }) => {
    const res = await request.get("/.well-known/agent-skills/index.json");
    const body = await res.json();
    expect(body.skills?.length).toBeGreaterThan(0);
    for (const skill of body.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.type).toBe("text/markdown");
      expect(skill.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(skill.url).toMatch(/^\/\.well-known\/agent-skills\//);
    }
  });

  test("individual skill files render markdown with sha256 header", async ({ request }) => {
    const indexRes = await request.get("/.well-known/agent-skills/index.json");
    const index = await indexRes.json();
    const first = index.skills[0];
    const res = await request.get(first.url);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/markdown/);
    expect(res.headers()["x-content-sha256"]).toBe(first.sha256);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(50);
  });

  test("mcp server card declares webmcp transport", async ({ request }) => {
    const res = await request.get("/.well-known/mcp/server-card.json");
    const body = await res.json();
    expect(body.serverInfo?.name).toBe("cribliv");
    expect(body.transport?.type).toBe("webmcp");
    expect(Array.isArray(body.capabilities?.tools)).toBe(true);
  });

  test("homepage advertises agent-discoverable Link header", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    const link = res.headers()["link"];
    expect(link).toBeTruthy();
    expect(link).toMatch(/rel="api-catalog"/);
    expect(link).toMatch(/rel="service-desc"/);
    expect(link).toMatch(/rel="service-doc"/);
  });

  test("homepage returns markdown when Accept: text/markdown", async ({ request }) => {
    const res = await request.get("/", {
      headers: { Accept: "text/markdown" },
      maxRedirects: 0
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/markdown/);
    expect(res.headers()["x-markdown-tokens"]).toMatch(/^\d+$/);
    const body = await res.text();
    expect(body).toMatch(/^#\s+Cribliv/m);
  });

  test("static page returns markdown when negotiated", async ({ request }) => {
    const res = await request.get("/en/faq", { headers: { Accept: "text/markdown" } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/markdown/);
    const body = await res.text();
    expect(body).toMatch(/Frequently Asked Questions/i);
  });

  test("HTML is still default with Accept: text/html", async ({ request }) => {
    const res = await request.get("/en");
    expect(res.headers()["content-type"]).toMatch(/text\/html/);
  });
});
