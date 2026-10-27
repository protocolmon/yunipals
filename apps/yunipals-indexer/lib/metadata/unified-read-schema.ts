export const unifiedReadMigrations = [
  `ALTER TABLE metadata.derived_snapshot ADD COLUMN IF NOT EXISTS ownership_release_id text,
    ADD COLUMN IF NOT EXISTS ownership_read_identity text`
] as const;
