/** Additive schema. Runtime refreshes only write rows in these stable tables. */
export const projectionSchemaStatements = [
  `CREATE SCHEMA IF NOT EXISTS metadata_projection`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.generation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    format_version integer NOT NULL DEFAULT 1 CHECK (format_version=1),
    source_mode text NOT NULL CHECK (source_mode IN ('archive','legacy')),
    metadata_release_id text,
    state text NOT NULL CHECK (state IN ('building','ready','failed','retired')),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    published_at timestamptz,
    retired_at timestamptz,
    validation jsonb,
    failure_reason text
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.active (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    current_id bigint REFERENCES metadata_projection.generation(id),
    previous_id bigint REFERENCES metadata_projection.generation(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(current_id IS NULL OR current_id IS DISTINCT FROM previous_id)
  )`,
  `INSERT INTO metadata_projection.active(singleton) VALUES(true) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.search (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    LIKE metadata.token_search INCLUDING DEFAULTS INCLUDING STORAGE,
    PRIMARY KEY(generation_id,collection,token_id,lifecycle)
  ) WITH (vacuum_truncate=false, toast.vacuum_truncate=false)`,
  `CREATE INDEX IF NOT EXISTS projection_search_collection_available_idx
    ON metadata_projection.search(generation_id,collection,metadata_available,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_raw_collection_desc_idx
    ON metadata_projection.search(generation_id,collection,rarity_points DESC NULLS LAST,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_raw_collection_asc_idx
    ON metadata_projection.search(generation_id,collection,rarity_points ASC NULLS LAST,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_capped_collection_desc_idx
    ON metadata_projection.search(generation_id,collection,rarity_points_capped DESC NULLS LAST,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_capped_collection_asc_idx
    ON metadata_projection.search(generation_id,collection,rarity_points_capped ASC NULLS LAST,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_raw_all_desc_idx
    ON metadata_projection.search(generation_id,rarity_points DESC NULLS LAST,token_id,collection,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_raw_all_asc_idx
    ON metadata_projection.search(generation_id,rarity_points ASC NULLS LAST,token_id,collection,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_capped_all_desc_idx
    ON metadata_projection.search(generation_id,rarity_points_capped DESC NULLS LAST,token_id,collection,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_search_capped_all_asc_idx
    ON metadata_projection.search(generation_id,rarity_points_capped ASC NULLS LAST,token_id,collection,lifecycle)`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.trait (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    LIKE metadata.token_trait INCLUDING DEFAULTS INCLUDING STORAGE,
    PRIMARY KEY(generation_id,collection,token_id,lifecycle,trait_type,value)
  ) WITH (vacuum_truncate=false, toast.vacuum_truncate=false)`,
  `CREATE INDEX IF NOT EXISTS projection_trait_filter_idx
    ON metadata_projection.trait(generation_id,collection,trait_type,value,token_id,lifecycle)`,
  `CREATE INDEX IF NOT EXISTS projection_trait_numeric_idx
    ON metadata_projection.trait(generation_id,collection,trait_type,value_numeric,token_id,lifecycle)
    WHERE value_numeric IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.revision (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    LIKE metadata.projection_revision INCLUDING DEFAULTS INCLUDING STORAGE,
    PRIMARY KEY(generation_id,collection,token_id,lifecycle)
  ) WITH (vacuum_truncate=false, toast.vacuum_truncate=false)`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.facet (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    LIKE metadata.trait_facet INCLUDING DEFAULTS INCLUDING STORAGE,
    PRIMARY KEY(generation_id,scope,trait_type)
  ) WITH (vacuum_truncate=false, toast.vacuum_truncate=false)`,
  `CREATE TABLE IF NOT EXISTS metadata_projection.facet_status (
    generation_id bigint NOT NULL REFERENCES metadata_projection.generation(id),
    LIKE metadata.trait_facet_status INCLUDING DEFAULTS INCLUDING STORAGE,
    PRIMARY KEY(generation_id,scope)
  ) WITH (vacuum_truncate=false, toast.vacuum_truncate=false)`
] as const;
