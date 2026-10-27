#!/usr/bin/env python3
"""Fixed read-only inventory before finite Arena operational/source grants."""
import hashlib,json,os,pwd,re,signal,socket,subprocess,traceback,types
from pathlib import Path
from urllib.parse import urlsplit,unquote,parse_qsl

FORMAT='yunipals-arena-operational-role-inventory-v1'
OPS=Path('/opt/yunipals-unified/operations/arena-role-inventory-20261021')
PACKAGE=Path('/opt/yunipals-unified/operations/arena-consumer-package-20261021')
OBSERVER=Path('/opt/yunipals-unified/operations/free-replay-20261020/arena-config-observer-v4.py')
OBSERVER_SHA='88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba'
CAP_SHA='9bd85a36a402571bf71b7ab81de360a8a6a6b2ffef5bc77431046e433a1e0527'
GRANT_SHA='b5e69cbae17bc07cf109e458c62344647b8d9bb6ad0049caa6352483a70cfb57'
PROPOSAL_SHA='6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e'
MIGRATIONS_SHA='f6f8c50c7242671f8736acdedb724df7dfd6bf0fb510343af5482e2794cf8f5b'
BASE=Path('/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d')
PHYSICAL='unified_shadow_20261020_7e7375b0'
CONTROL='yunipals_indexer_control'
RELEASE='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
DEPLOYMENT='8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca'
NO_PASSWORD=Path('/run/yunipals-arena-role-inventory-v1-no-password')
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
PRIVATE_TABLES=['submission','fighter_snapshot','frozen_input','admission','provider_task','transaction_intent','adjudication','media_job']
PHASE='initial'

class InventoryFailure(RuntimeError):pass
def fail(code):raise InventoryFailure(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def literal(v):return"'"+str(v).replace("'","''")+"'"
def command(argv,*,data=None,timeout=8):
 r=subprocess.run(argv,input=data,capture_output=True,env=ENV,timeout=timeout)
 if r.returncode or r.stderr or len(r.stdout)>500000:fail('bounded_clean_peer_operation_failed')
 return r.stdout
def observer():
 raw=OBSERVER.read_bytes()
 if sha(raw)!=OBSERVER_SHA:fail('fixed_observer_changed')
 m=types.ModuleType('arena_role_inventory_observer');m.__file__=str(OBSERVER);exec(compile(raw,str(OBSERVER),'exec'),m.__dict__)
 m.read(OBSERVER,100000);return m
def pinned(o,path,pin,maximum=500000):
 raw,_=o.read(path,maximum)
 if sha(raw)!=pin:fail('reviewed_public_input_changed')
 return raw
def connect(o,port,database,sql):
 if (port,database)not in{(15438,'yunipals_arena'),(5432,'yunipals_backfill')}:fail('fixed_peer_target_required')
 if os.path.lexists(NO_PASSWORD):fail('fixed_no_password_path_must_be_absent')
 user=pwd.getpwnam('postgres')
 if user.pw_uid<=0 or user.pw_gid<=0:fail('existing_nonroot_postgres_peer_required')
 argv=['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i','PATH=/usr/bin:/bin','PGHOST=/var/run/postgresql','PGPORT='+str(port),'PGDATABASE='+database,'PGUSER=postgres','PGPASSFILE='+str(NO_PASSWORD),'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000','/usr/bin/psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1']
 value=json.loads(command(argv,data=sql.encode(),timeout=8))
 if os.path.lexists(NO_PASSWORD)or value.get('readOnly')is not True or value.get('isolation')!='repeatable read':fail('fixed_readonly_snapshot_required')
 return value
def grants(proposal,source=False):
 rows=[]
 if source:
  graph=proposal['sourceReadGrant']['connection'];role='arena_native_reader'
  for schema,key in[(PHYSICAL,'physicalRelations'),(CONTROL,'controlRelations')]:
   rows.extend({'role':role,'relation':schema+'.'+name,'privilege':'SELECT','attribute':None}for name in graph[key])
  return[role],rows,[PHYSICAL,CONTROL]
 for worker in proposal['workers']:
  role=worker['operationalRoleProposal'];g=worker['operationalGraph']
  if not re.fullmatch('yunipals_arena_native_[a-z_]+',role)or g['execute']or g['schemaUsage']!=['yunipals_arena']:fail('exact_finite_operational_graph_required')
  for privilege in['select','insert','delete']:
   rows.extend({'role':role,'relation':'yunipals_arena.'+name,'privilege':privilege.upper(),'attribute':None}for name in g[privilege])
  for name,columns in g['update'].items():rows.extend({'role':role,'relation':'yunipals_arena.'+name,'privilege':'UPDATE','attribute':column}for column in columns)
 roles=[w['operationalRoleProposal']for w in proposal['workers']]
 if len(roles)!=8 or len(set(roles))!=8:fail('exact_eight_operational_roles_required')
 return roles,rows,['yunipals_arena']
def catalog_sql(roles,expected,schemas,markers="'{}'::jsonb"):
 rjson=literal(json.dumps(roles));ejson=literal(json.dumps(expected));sjson=literal(json.dumps(schemas))
 return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog;
WITH names AS(SELECT jsonb_array_elements_text({rjson}::jsonb) AS name),
w AS(SELECT n.name,r.oid,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolconnlimit FROM names n LEFT JOIN pg_roles r ON r.rolname=n.name),
scope AS(SELECT n.* FROM pg_namespace n WHERE n.nspname IN(SELECT jsonb_array_elements_text({sjson}::jsonb))),
relations AS(SELECT n.nspname||'.'||c.relname AS name,c.oid,c.relowner,c.relkind,c.relrowsecurity,c.relacl FROM pg_class c JOIN scope n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p','v','m','f','S')),
expected AS(SELECT * FROM jsonb_to_recordset({ejson}::jsonb) AS e(role text,relation text,privilege text,attribute text)),
checks AS(SELECT e.*,c.oid::bigint AS relation_oid,a.attnum,COALESCE(CASE WHEN e.attribute IS NULL THEN has_table_privilege(w.oid,c.oid,e.privilege) ELSE has_column_privilege(w.oid,c.oid,a.attnum,e.privilege)END,false) AS effective
 FROM expected e JOIN w ON w.name=e.role LEFT JOIN relations c ON c.name=e.relation AND c.relkind<>'S' LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=e.attribute AND a.attnum>0 AND NOT a.attisdropped),
extra AS(SELECT w.name,c.name AS relation,p.privilege FROM w CROSS JOIN relations c CROSS JOIN(VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'))p(privilege)
 WHERE CASE WHEN c.relkind<>'S' THEN COALESCE(has_table_privilege(w.oid,c.oid,p.privilege),false) ELSE false END AND NOT EXISTS(SELECT 1 FROM expected e WHERE e.role=w.name AND e.relation=c.name AND e.privilege=p.privilege AND e.attribute IS NULL)),
extra_columns AS(SELECT w.name,c.name AS relation,a.attname,p.privilege FROM w CROSS JOIN relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN(VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES'))p(privilege)
 WHERE CASE WHEN c.relkind<>'S' THEN COALESCE(has_column_privilege(w.oid,c.oid,a.attnum,p.privilege),false) ELSE false END AND NOT EXISTS(SELECT 1 FROM expected e WHERE e.role=w.name AND e.relation=c.name AND e.privilege=p.privilege AND(e.attribute IS NULL OR e.attribute=a.attname)))
SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',w.name,'oid',w.oid::bigint,'exists',w.oid IS NOT NULL,
 'attributes',jsonb_build_object('login',w.rolcanlogin,'superuser',w.rolsuper,'inherit',w.rolinherit,'createDb',w.rolcreatedb,'createRole',w.rolcreaterole,'replication',w.rolreplication,'bypassRls',w.rolbypassrls,'connectionLimit',w.rolconnlimit),
 'membershipEdges',(SELECT count(*) FROM pg_auth_members m WHERE m.roleid=w.oid OR m.member=w.oid),
 'sessions',(SELECT count(*) FROM pg_stat_activity a WHERE a.usename=w.name),
 'databaseConnect',COALESCE(has_database_privilege(w.oid,current_database(),'CONNECT'),false),'databaseCreate',COALESCE(has_database_privilege(w.oid,current_database(),'CREATE'),false),'databaseTemp',COALESCE(has_database_privilege(w.oid,current_database(),'TEMP'),false),
 'schemaPrivileges',(SELECT jsonb_object_agg(n.nspname,jsonb_build_object('oid',n.oid::bigint,'usage',COALESCE(has_schema_privilege(w.oid,n.oid,'USAGE'),false),'create',COALESCE(has_schema_privilege(w.oid,n.oid,'CREATE'),false),'owns',n.nspowner=w.oid)) FROM scope n),
 'requiredGrants',(SELECT jsonb_agg(to_jsonb(c)-'role' ORDER BY c.relation,c.privilege,c.attribute) FROM checks c WHERE c.role=w.name),
 'extraTablePrivilegeCount',(SELECT count(*) FROM extra e WHERE e.name=w.name),'extraColumnPrivilegeCount',(SELECT count(*) FROM extra_columns e WHERE e.name=w.name),
 'ownedRelationCount',(SELECT count(*) FROM relations c WHERE c.relowner=w.oid),
 'ownedFunctionCount',(SELECT count(*) FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace WHERE p.proowner=w.oid),
 'sequencePrivilegeCount',(SELECT count(*) FROM relations c WHERE CASE WHEN c.relkind='S' THEN COALESCE(has_sequence_privilege(w.oid,c.oid,'USAGE,SELECT,UPDATE'),false) ELSE false END),
 'functionExecuteCount',(SELECT count(*) FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace WHERE COALESCE(has_function_privilege(w.oid,p.oid,'EXECUTE'),false)),
 'securityDefinerExecuteCount',(SELECT count(*) FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace WHERE p.prosecdef AND COALESCE(has_function_privilege(w.oid,p.oid,'EXECUTE'),false)),
 'directSchemaAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,'grantorOid',a.grantor::bigint,'granteeOid',a.grantee::bigint,'privilege',a.privilege_type,'grantOption',a.is_grantable) ORDER BY n.nspname,a.grantee,a.privilege_type),'[]'::jsonb) FROM scope n CROSS JOIN LATERAL aclexplode(n.nspacl)a WHERE a.grantee IN(0,w.oid)),
 'functionAclIncludingDefaults',(SELECT COALESCE(jsonb_agg(jsonb_build_object('functionOid',p.oid::bigint,'grantorOid',a.grantor::bigint,'granteeOid',a.grantee::bigint,'privilege',a.privilege_type,'grantOption',a.is_grantable,'defaultAcl',p.proacl IS NULL) ORDER BY p.oid,a.grantee,a.privilege_type),'[]'::jsonb) FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee IN(0,w.oid)),
 'directColumnAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('relation',c.name,'relationOid',c.oid::bigint,'attribute',t.attname,'attributeNumber',t.attnum,'grantorOid',a.grantor::bigint,'granteeOid',a.grantee::bigint,'privilege',a.privilege_type,'grantOption',a.is_grantable) ORDER BY c.name,t.attnum,a.grantee,a.privilege_type),'[]'::jsonb) FROM relations c JOIN pg_attribute t ON t.attrelid=c.oid AND t.attnum>0 AND NOT t.attisdropped CROSS JOIN LATERAL aclexplode(t.attacl)a WHERE a.grantee IN(0,w.oid)),
 'directRelationAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('relation',c.name,'oid',c.oid::bigint,'grantorOid',a.grantor::bigint,'granteeOid',a.grantee::bigint,'privilege',a.privilege_type,'grantOption',a.is_grantable) ORDER BY c.name,a.grantee,a.privilege_type),'[]'::jsonb) FROM relations c CROSS JOIN LATERAL aclexplode(c.relacl)a WHERE a.grantee IN(0,w.oid))) ORDER BY w.name) FROM w),
 'relations',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',c.name,'oid',c.oid::bigint,'ownerOid',c.relowner::bigint,'kind',c.relkind,'rowSecurity',c.relrowsecurity,'columns',(SELECT jsonb_object_agg(a.attname,a.atttypid::int) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.name),'[]'::jsonb) FROM relations c),
 'publicExecutableFunctions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',p.oid::bigint,'securityDefiner',p.prosecdef) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace WHERE EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')),
 'markers',{markers});
ROLLBACK;
"""
def shape(catalog,name,columns):
 rows=[r for r in catalog['relations']if r['name']=='yunipals_arena.'+name]
 return len(rows)==1 and rows[0]['kind']in{'r','p'} and all(rows[0]['columns'].get(k)==v for k,v in columns.items())
def marker_sql(catalog,migrations):
 parts=[];ready=shape(catalog,'operational_migration',{'version':23,'checksum':25})
 if ready:
  values=','.join('('+str(r['version'])+','+literal(r['checksum'])+')'for r in migrations['markers'])
  parts.extend(["'migrationTablePresent',true","'migrations',(SELECT jsonb_agg(jsonb_build_object('version',e.version,'present',m.version IS NOT NULL,'checksumMatches',m.checksum=e.checksum) ORDER BY e.version) FROM(VALUES"+values+")e(version,checksum) LEFT JOIN yunipals_arena.operational_migration m USING(version))","'unexpectedMigrationVersionCount',(SELECT count(*) FROM yunipals_arena.operational_migration WHERE version NOT BETWEEN 1 AND 12)","'duplicateMigrationVersionCount',(SELECT count(*) FROM(SELECT version FROM yunipals_arena.operational_migration GROUP BY version HAVING count(*)>1)d)"])
 else:parts.append("'migrationTablePresent',false")
 dep=literal(DEPLOYMENT)
 if shape(catalog,'deployment',{'id':25,'contract':25,'start_block':20,'halted':16,'indexer_mode':25}):
  parts.append("'deployment',(SELECT jsonb_build_object('rows',count(*),'nativeMode',COALESCE(bool_and(indexer_mode='unified'),false),'halted',COALESCE(bool_and(halted),false),'contractMatches',COALESCE(bool_and(contract='0xebd141b6ae36f74fe70b9139b262ee9771b72aca'),false),'startMatches',COALESCE(bool_and(start_block=52648146),false)) FROM yunipals_arena.deployment WHERE id="+dep+")")
 if shape(catalog,'tournament_identity',{'deployment':25,'incarnation':25,'bound_release_id':25,'cipher_context':25}):
  parts.append("'identity',(SELECT jsonb_build_object('rows',count(*),'legacyRows',count(*) FILTER(WHERE incarnation='legacy'),'nativeBoundRows',count(*) FILTER(WHERE bound_release_id="+literal(RELEASE)+"),'missingCipherContextRows',count(*) FILTER(WHERE cipher_context IS NULL OR cipher_context='')) FROM yunipals_arena.tournament_identity WHERE deployment="+dep+")")
 counts=[]
 for name in PRIVATE_TABLES:
  columns={'deployment':25,'incarnation':25}
  if name=='transaction_intent':columns['purpose']=25
  if shape(catalog,name,columns):
   predicate="incarnation IS NULL OR incarnation='legacy'"
   if name=='transaction_intent':predicate="incarnation='legacy' OR(incarnation IS NULL AND purpose<>'open-lobby')"
   counts.append(literal(name)+",(SELECT jsonb_build_object('rows',count(*),'legacyOrUnboundRows',count(*) FILTER(WHERE "+predicate+")) FROM yunipals_arena."+name+" WHERE deployment="+dep+")")
 parts.append("'privateStateCounts',jsonb_build_object("+','.join(counts)+")")
 if shape(catalog,'source_selection',{'deployment':25,'kind':25,'source_id':25,'epoch':2950,'review_hash':25})and shape(catalog,'source_switch_history',{'deployment':25,'epoch':2950,'review_hash':25}):
  parts.append("'selection',(SELECT jsonb_build_object('rows',count(*),'nativeSelected',COALESCE(bool_and(kind='unified' AND source_id="+literal(RELEASE)+"),false),'historyBound',COALESCE(bool_and(EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h WHERE h.deployment=s.deployment AND h.epoch=s.epoch AND h.review_hash=s.review_hash)),false)) FROM yunipals_arena.source_selection s WHERE deployment="+dep+")")
 return'jsonb_build_object('+','.join(parts)+')'
def next_actions(operational,source):
 result=[]
 for scope,doc in[('operational',operational),('source',source)]:
  absent=[r['name']for r in doc['roles']if not r['exists']]
  if absent:result.append({'scope':scope,'action':'create_reviewed_nonowner_roles_then_finite_grants','roles':absent})
  existing=[r['name']for r in doc['roles']if r['exists']]
  if existing:result.append({'scope':scope,'action':'bind_existing_oids_and_review_exact_observed_authority_before_reuse','roles':existing})
 markers=operational.get('markers',{})
 if not markers.get('migrationTablePresent')or markers.get('unexpectedMigrationVersionCount',0)or markers.get('duplicateMigrationVersionCount',0)or any(not r['present']or not r['checksumMatches']for r in markers.get('migrations',[])):result.append({'action':'owner_review_official_missing_or_mismatched_migrations_no_worker_startup_migration'})
 if markers.get('identity',{}).get('legacyRows',0)>0 or any(v['legacyOrUnboundRows']for v in markers.get('privateStateCounts',{}).values()):result.append({'action':'explicit_owner_origin_adoption_and_private_state_retention_review_after_canonical_source_ready'})
 if not markers.get('selection',{}).get('nativeSelected'):result.append({'action':'existing_guarded_source_switch_after_readiness_and_role_acceptance'})
 return result
def stable_catalog(doc):
 return{**{k:v for k,v in doc.items()if k not in{'markers','roles'}},'roles':[{k:v for k,v in r.items()if k!='sessions'}for r in doc['roles']]}
def observe():
 global PHASE
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_root_host_only')
 PHASE='fixed_public_inputs';o=observer()
 capabilities=json.loads(pinned(o,OPS/'capabilities.v1.json',CAP_SHA));pinned(o,OPS/'grant-proposal.sql.txt',GRANT_SHA)
 proposal=json.loads(pinned(o,PACKAGE/'proposal.v1.json',PROPOSAL_SHA));migrations=json.loads(pinned(o,OPS/'operational-migrations.v1.json',MIGRATIONS_SHA))
 old={w['id']:w['operational']for w in capabilities['workers']}
 if any(w['operationalGraph']!=old[w['id']]for w in proposal['workers']):fail('historical_finite_graph_changed')
 for row in migrations['sourceFiles']:pinned(o,BASE/row['path'],row['sha256'])
 PHASE='configured_operational_target';raw,metadata=o.read(Path('/etc/yunipals-arena/database.env'),65536,private=True);env=o.parse_env(raw)
 u=urlsplit(env.get('ARENA_DATABASE_URL',''))
 if u.scheme not in{'postgres','postgresql'}or u.hostname not in{'127.0.0.1','localhost','::1'}or u.port!=15438 or unquote(u.path)!='/yunipals_arena'or u.fragment or any(k not in{'application_name','sslmode','connect_timeout','statement_timeout'}for k,v in parse_qsl(u.query,keep_blank_values=True)):fail('existing_operational_target_mismatch')
 PHASE='operational_catalog';roles,expected,schemas=grants(proposal);before=connect(o,15438,'yunipals_arena',catalog_sql(roles,expected,schemas))
 PHASE='operational_markers';after=connect(o,15438,'yunipals_arena',catalog_sql(roles,expected,schemas,marker_sql(before,migrations)))
 if stable_catalog(before)!=stable_catalog(after):fail('operational_authority_or_shape_changed')
 PHASE='source_reader_catalog';source_roles,source_expected,source_schemas=grants(proposal,True);source=connect(o,5432,'yunipals_backfill',catalog_sql(source_roles,source_expected,source_schemas))
 raw_after,metadata_after=o.read(Path('/etc/yunipals-arena/database.env'),65536,private=True)
 if raw_after!=raw or metadata_after!=metadata:fail('existing_operational_config_changed')
 return{'format':FORMAT,'status':'observed_readonly','proposalSha256':PROPOSAL_SHA,'historicalCapabilitiesSha256':CAP_SHA,'historicalGrantTextSha256':GRANT_SHA,'migrationExpectationsSha256':MIGRATIONS_SHA,'configuredOperationalRoleSha256':sha(unquote(u.username or'').encode()),'operationalConfigSha256':sha(raw),'operational':after,'sourceReader':source,'nextOwnerActions':next_actions(after,source),'inventorySha256':sha(encoded({'operational':after,'sourceReader':source})),'qualification':{'catalogAndAggregateMarkersOnly':True,'canonicalOriginAdoptionVerified':False,'effectiveRightsOutsideFixedSchemasInspected':False,'passwordsOrConfigValuesExported':False,'runtimeImported':False,'rolesAutomaticallyAdopted':False},'roleChanges':0,'grants':0,'loginChanges':0,'migrations':0,'privateStateWrites':0,'sourceSelectionChanges':0,'providerCalls':0,'serviceJobs':0}
def main():
 os.environ.clear();os.environ.update(ENV);signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(60)
 try:print(json.dumps(observe(),sort_keys=True))
 except BaseException as error:
  print(json.dumps({'format':FORMAT,'status':'failed','phase':PHASE,'errorClass':type(error).__name__,'fixedCode':str(error)if isinstance(error,InventoryFailure)and re.fullmatch('[a-z0-9_]{1,100}',str(error))else'fixed_readonly_operation_failed','knownPublicSourceFrames':[{'source':Path(__file__).name,'function':f.name,'line':f.lineno}for f in traceback.extract_tb(error.__traceback__)if f.filename==__file__][-6:],'rawMessagesExported':False,'productionWrites':0}));raise SystemExit(1)
 finally:signal.alarm(0)
if __name__=='__main__':main()
