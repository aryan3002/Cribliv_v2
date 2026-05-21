import { createHash } from "node:crypto";

// SHA-256 of `${ip}${salt}` per [[Security]] §IP address handling. Original IP is
// never stored anywhere — only this hash is written to rent_agreement_downloads.ip_hash.
// Salt rotates yearly: old hashes remain auditable but cannot be cross-referenced
// post-rotation.
export function hashIp(ip: string, salt?: string): string {
  const resolved = salt ?? process.env.RENT_AGREEMENT_IP_SALT;
  if (!resolved || resolved.length === 0) {
    throw new Error("RENT_AGREEMENT_IP_SALT is not set");
  }
  return createHash("sha256").update(`${ip}${resolved}`).digest("hex");
}
