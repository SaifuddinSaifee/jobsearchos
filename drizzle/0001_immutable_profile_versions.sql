-- pgvector is used from Stage 5 (embeddings); enabling it now keeps later migrations simple.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE FUNCTION profile_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'profile_versions rows are immutable (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER profile_versions_no_update_delete
BEFORE UPDATE OR DELETE ON profile_versions
FOR EACH ROW EXECUTE FUNCTION profile_versions_immutable();
