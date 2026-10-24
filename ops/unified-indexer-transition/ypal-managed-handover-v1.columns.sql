-- Supplemental NEW authority observation. The historical cd1 seven-role
-- catalog did not capture all-grantee column ACLs. No rows/owners of NFTs return.
WITH scope AS (
  SELECT oid, nspname, nspowner
  FROM pg_namespace
  WHERE nspname IN (
    'unified_ypal_20261023_v1',
    'yunipals_ownership_4e77f52b_v4',
    'yunipals_indexer_control'
  )
), relations AS (
  SELECT c.oid, c.relnamespace, c.relname, c.relowner, c.relkind,
         n.nspname
  FROM pg_class c JOIN scope n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f')
)
SELECT jsonb_build_object(
  'format','yunipals-ypal-managed-all-column-acl-v1',
  'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
  'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'oid',oid::text,'name',nspname,'owner',nspowner::text
  ) ORDER BY nspname),'[]'::jsonb) FROM scope),
  'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schemaOid',c.relnamespace::text,'schema',c.nspname,
    'relationOid',c.oid::text,'relation',c.relname,
    'owner',c.relowner::text,'kind',c.relkind,
    'attnum',a.attnum,'name',a.attname,'typeOid',a.atttypid::text,
    'typeModifier',a.atttypmod,'collationOid',a.attcollation::text,
    'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'grantee',e.grantee::text,'grantor',e.grantor::text,
      'privilege',e.privilege_type,'grantable',e.is_grantable
    ) ORDER BY e.grantee,e.grantor,e.privilege_type,e.is_grantable),'[]'::jsonb)
      FROM aclexplode(a.attacl) e)
  ) ORDER BY c.nspname,c.relname,a.attnum),'[]'::jsonb)
  FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid
  WHERE a.attnum>0 AND NOT a.attisdropped)
);
