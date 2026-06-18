/**
 * Serialize a value for safe embedding inside a
 * `<script type="application/ld+json">…</script>` block.
 *
 * Plain `JSON.stringify` does NOT escape `<`, `>`, `&`, so any user-controlled
 * field (e.g. a listing title) containing `</script>` can break out of the
 * script element → stored XSS on a public, SEO-indexed page (audit SEC-H2).
 *
 * Escaping those three characters to their `\uXXXX` JSON forms keeps the output
 * valid JSON-LD for crawlers while making it impossible to terminate the script
 * tag or open an HTML entity. (U+2028/U+2029 are not escaped: JSON-LD is parsed
 * as JSON, not executed as JS, so they are not an injection vector here.)
 */
export function jsonLdSafe(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
