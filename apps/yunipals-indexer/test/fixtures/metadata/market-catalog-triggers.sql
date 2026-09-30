-- Source: marketplace ops/catalog-current-trait-source.sql
-- Source SHA256: 2c846ec6266a12bae8450e0d1592bf329a93a7195c1386a6b7e44e2ba0b083b6
CREATE TABLE metadata.market_catalog_trait (
  collection text NOT NULL,
  token_id numeric NOT NULL,
  lifecycle integer NOT NULL,
  trait_type text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(collection,trait_type,value,token_id,lifecycle)
);
CREATE INDEX market_catalog_trait_identity_idx
  ON metadata.market_catalog_trait(collection,token_id,lifecycle);
CREATE TABLE metadata.market_catalog_trait_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  ready boolean NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz
);
INSERT INTO metadata.market_catalog_trait_state(singleton,ready) VALUES(true,false);
CREATE TABLE metadata.market_catalog_trait_pending (
  collection text NOT NULL,
  token_id numeric NOT NULL,
  lifecycle integer NOT NULL,
  PRIMARY KEY(collection,token_id,lifecycle)
);
CREATE FUNCTION metadata.sync_market_catalog_trait()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,metadata
AS $function$
DECLARE
  is_ready boolean;
BEGIN
  SELECT ready INTO STRICT is_ready
  FROM metadata.market_catalog_trait_state WHERE singleton;
  IF NOT is_ready THEN
    IF TG_OP<>'INSERT' THEN
      INSERT INTO metadata.market_catalog_trait_pending(collection,token_id,lifecycle)
      VALUES(OLD.collection,OLD.token_id,OLD.lifecycle) ON CONFLICT DO NOTHING;
    END IF;
    IF TG_OP<>'DELETE' THEN
      INSERT INTO metadata.market_catalog_trait_pending(collection,token_id,lifecycle)
      VALUES(NEW.collection,NEW.token_id,NEW.lifecycle) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP<>'INSERT' THEN
    DELETE FROM metadata.market_catalog_trait
    WHERE collection=OLD.collection AND token_id=OLD.token_id AND lifecycle=OLD.lifecycle;
  END IF;
  IF TG_OP<>'DELETE' THEN
    INSERT INTO metadata.market_catalog_trait(collection,token_id,lifecycle,trait_type,value)
    SELECT NEW.collection,NEW.token_id,NEW.lifecycle,
      attribute->>'trait_type',coalesce(attribute->>'value','null')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.attributes)='array'
      THEN NEW.attributes ELSE '[]'::jsonb END) attribute
    WHERE attribute->>'trait_type' IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER market_catalog_trait_insert
AFTER INSERT ON metadata.token_metadata
FOR EACH ROW EXECUTE FUNCTION metadata.sync_market_catalog_trait();
CREATE TRIGGER market_catalog_trait_update
AFTER UPDATE OF collection,token_id,lifecycle,attributes ON metadata.token_metadata
FOR EACH ROW WHEN (OLD.collection IS DISTINCT FROM NEW.collection
  OR OLD.token_id IS DISTINCT FROM NEW.token_id
  OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
  OR OLD.attributes IS DISTINCT FROM NEW.attributes)
EXECUTE FUNCTION metadata.sync_market_catalog_trait();
CREATE TRIGGER market_catalog_trait_delete
AFTER DELETE ON metadata.token_metadata
FOR EACH ROW EXECUTE FUNCTION metadata.sync_market_catalog_trait();
