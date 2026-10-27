SELECT coalesce(jsonb_agg(jsonb_build_object(
  'relation',c.oid::text,'namespace',n.oid::text,'name',n.nspname||'.'||c.relname,
  'column',a.attnum,'columnName',a.attname,'type',a.atttypid::text,
  'acl',a.attacl::text,'edges',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'grantee',x.grantee::text,'grantor',x.grantor::text,
    'privilege',x.privilege_type,'grantable',x.is_grantable)
    ORDER BY x.grantee,x.grantor,x.privilege_type,x.is_grantable),'[]'::jsonb)
    FROM aclexplode(a.attacl) x)) ORDER BY c.oid,a.attnum),'[]'::jsonb)
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
