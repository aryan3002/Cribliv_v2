import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface SkillEntry {
  name: string;
  type: "text/markdown";
  description: string;
  url: string;
  sha256: string;
  bytes: number;
}

const SKILLS_DIR = join(process.cwd(), "content", "agent-skills");

// Pull "description" from the YAML front-matter; if missing, return the first
// non-empty paragraph.
function extractDescription(raw: string, name: string): string {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const descLine = fm.split("\n").find((l) => l.startsWith("description:"));
    if (descLine) return descLine.replace(/^description:\s*/, "").trim();
  }
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const firstPara = body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#"));
  return firstPara?.trim() ?? `Agent skill: ${name}`;
}

function listSkillFiles(): string[] {
  try {
    return readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

export function loadSkill(name: string): { content: string; bytes: number; sha256: string } | null {
  const safe = name.replace(/[^a-z0-9-]/gi, "");
  if (!safe || safe !== name) return null;
  try {
    const raw = readFileSync(join(SKILLS_DIR, `${safe}.md`), "utf-8");
    const buf = Buffer.from(raw, "utf-8");
    return {
      content: raw,
      bytes: buf.byteLength,
      sha256: createHash("sha256").update(buf).digest("hex")
    };
  } catch {
    return null;
  }
}

export function buildSkillsIndex(): SkillEntry[] {
  return listSkillFiles().map((file) => {
    const name = file.replace(/\.md$/, "");
    const raw = readFileSync(join(SKILLS_DIR, file), "utf-8");
    const buf = Buffer.from(raw, "utf-8");
    return {
      name,
      type: "text/markdown" as const,
      description: extractDescription(raw, name),
      url: `/.well-known/agent-skills/${name}.md`,
      sha256: createHash("sha256").update(buf).digest("hex"),
      bytes: buf.byteLength
    };
  });
}
