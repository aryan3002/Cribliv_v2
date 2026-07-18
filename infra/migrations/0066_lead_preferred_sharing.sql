-- 0066: record the sharing type a tenant asked about when expressing interest,
-- so the operator sees which room the lead wants. Nullable = unspecified ("Any");
-- every existing lead stays null. The app layer validates the value against the
-- canonical PgSharingKind set (single|double|triple|quad|dorm) before writing.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS preferred_sharing text;
