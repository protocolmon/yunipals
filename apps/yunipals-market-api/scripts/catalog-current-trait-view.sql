-- Test and empty-preview equivalent of the production source-owned table.
-- Production maintains the same rows transactionally with token_metadata.
CREATE OR REPLACE VIEW metadata.market_catalog_trait AS
SELECT DISTINCT m.collection,m.token_id,m.lifecycle,
  attribute->>'trait_type' AS trait_type,
  coalesce(attribute->>'value','null') AS value
FROM metadata.token_metadata m,
  jsonb_array_elements(CASE WHEN jsonb_typeof(m.attributes)='array'
    THEN m.attributes ELSE '[]'::jsonb END) attribute
WHERE attribute->>'trait_type' IS NOT NULL;
