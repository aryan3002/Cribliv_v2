-- Rollback 0051: remove repaired listing embeddings infrastructure.
DROP INDEX IF EXISTS idx_listing_embeddings_hnsw;
DROP TABLE IF EXISTS listing_embeddings;
