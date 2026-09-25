-- Source-side evaluation preserves the catalog's exact ->> text semantics,
-- including numbers, booleans, nulls, repeated attributes and malformed arrays.
-- This depends only on token_metadata, not the hourly swapped search/trait tables.
CREATE OR REPLACE VIEW metadata.market_catalog_attribute AS
SELECT m.collection,m.token_id,m.lifecycle,
  attribute->>'trait_type' AS trait_type,
  coalesce(attribute->>'value','null') AS value
FROM metadata.token_metadata m,
  jsonb_array_elements(CASE WHEN jsonb_typeof(m.attributes)='array'
    THEN m.attributes ELSE '[]'::jsonb END) attribute;
