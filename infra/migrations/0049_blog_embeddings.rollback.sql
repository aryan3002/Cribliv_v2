-- Rollback for 0049_blog_embeddings.sql
DROP INDEX IF EXISTS idx_blog_embeddings_hnsw;
DROP TABLE IF EXISTS blog_embeddings;
