-- Exact text pairs for an expression index on current metadata. Build filter
-- keys with jsonb_build_array(type::text,value::text)::text on the server too.
-- This function does not read the periodically rebuilt token_trait table.
CREATE FUNCTION metadata.market_attribute_keys(attributes jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT ARRAY(
    SELECT jsonb_build_array(attribute->>'trait_type',
      coalesce(attribute->>'value','null'))::text
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(attributes)='array'
      THEN attributes ELSE '[]'::jsonb END) WITH ORDINALITY AS a(attribute,ordinal)
    WHERE attribute->>'trait_type' IS NOT NULL
    ORDER BY ordinal
  )
$function$;
