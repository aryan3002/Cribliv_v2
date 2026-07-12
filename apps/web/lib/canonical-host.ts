/**
 * The production origin is the ONLY host that should be indexed. Every other
 * host the app answers on — the `*.vercel.app` production alias, branch
 * previews, localhost — must be kept out of Google's index so they don't
 * compete with cribliv.com for the same content during/after the v1→v2 cutover.
 *
 * Exact-match (not suffix) so a look-alike like `cribliv.com.evil.com` is never
 * treated as canonical.
 */
const CANONICAL_HOSTS = new Set(["cribliv.com", "www.cribliv.com"]);

export function isCanonicalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const bare = host.split(":")[0].trim().toLowerCase(); // strip port
  return CANONICAL_HOSTS.has(bare);
}
