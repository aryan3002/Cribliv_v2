import { NextResponse } from "next/server";
import { buildSkillsIndex } from "../../../../lib/agent-skills";

/**
 * Agent Skills Discovery RFC v0.2.0 index.
 * https://github.com/cloudflare/agent-skills-discovery-rfc
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  const skills = buildSkillsIndex();
  const body = {
    $schema: "https://agentskills.io/schemas/index-v0.2.0.json",
    version: "0.2.0",
    generated_at: new Date().toISOString().slice(0, 10),
    skills
  };

  return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
