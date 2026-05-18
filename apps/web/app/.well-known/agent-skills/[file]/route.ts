import { NextResponse } from "next/server";
import { loadSkill } from "../../../../lib/agent-skills";

/**
 * Serves an individual skill markdown file. Slugs are restricted to
 * `[a-z0-9-]+` and must end in `.md`. Anything else 404s.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET(_req: Request, { params }: { params: { file: string } }) {
  const file = params.file;
  if (!file.endsWith(".md")) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const name = file.slice(0, -3);
  const skill = loadSkill(name);
  if (!skill) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return new NextResponse(skill.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Digest: `sha-256=${skill.sha256}`,
      "X-Content-Sha256": skill.sha256
    }
  });
}
