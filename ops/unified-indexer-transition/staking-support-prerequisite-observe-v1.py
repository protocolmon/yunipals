#!/usr/bin/env python3
"""Finite native staking actor/schema/INVOKER prerequisite capture; no writes."""
import hashlib,json,os,pwd,grp,re,socket,stat,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
ROLE='yunipals_islands_staking'
FORMAT='yunipals-staking-support-prerequisites-v1'
OWNER_SHA='97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8'
PHYSICAL='unified_shadow_20261020_7e7375b0'
READ='yunipals_ownership_35cdcb32_v3'
RELEASE='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
IDENTITY='0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc'
SOURCES={'apps/yunipals-indexer/scripts/staking-support.ts':'a3c5bda351a9476b30517d14a6f8bb834aa45ba628196fbf31fe1b69bd50f5a1','apps/yunipals-indexer/lib/islands/staking-support-worker.ts':'9ff2497b0d22907666b6a23f6c0dcffd59debba14143276eb69fe8a8213c87a9','apps/yunipals-indexer/lib/islands/staking-support-adapter.ts':'54acb75bc23928ecac4319af7e29b48c79f319f9883287bf4e1770bd66129fe7','apps/yunipals-indexer/lib/islands/staking-verifier.ts':'365deb9e8d46a9babfb1fc1259cc2c40821888bf54f970990cfd588ba16c62f3'}
TABLES=['metadata.island_staking_scan','metadata.island_staking_position']
def fail(code):raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def modules():
 p=OPS/'native-metadata-publication-column-v1.py'
 for x in [*p.parents,p]:
  s=x.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_staking_owner_dependency_required')
 raw=p.read_bytes()
 if len(raw)>100000 or sha(raw)!=OWNER_SHA:fail('exact_existing_owner_transport_required')
 o=types.ModuleType('native_staking_owner');o.__file__=str(p);exec(compile(raw,str(p),'exec'),o.__dict__)
 for name,pin in SOURCES.items():
  if sha(o.protected(o.ROOT/name,100000))!=pin:fail('accepted_existing_staking_runtime_required')
 return o,o.primitive()
def target_sql(p,relation):
 if relation not in TABLES:fail('fixed_staking_operational_table_required')
 schema,name=relation.split('.');text=p.target_sql();old="WHERE n.nspname='metadata'AND c.relname='token_publication'"
 if text.count(old)!=1:fail('frozen_catalog_transport_changed')
 return text.replace(old,"WHERE n.nspname='"+schema+"'AND c.relname='"+name+"'")
def capture(o,p):
 targets=','.join(o.literal(n)+',('+target_sql(p,n)+')'for n in TABLES)
 sql="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='8s';SELECT jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'session',session_user,'current',current_user,'port',current_setting('port'),'unix',inet_client_addr()IS NULL,'recovery',pg_is_in_recovery(),'systemId',(SELECT system_identifier::text FROM pg_control_system())),
 'marker',(SELECT to_jsonb(m.*)FROM yunipals_ownership_35cdcb32_v3._unified_read_release m WHERE singleton),
 'release',(SELECT jsonb_build_object('id',id,'physicalSchema',physical_schema,'buildId',build_id)FROM yunipals_indexer_control.release WHERE id='RELEASE'),
 'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit,'passwordNull',rolpassword IS NULL,'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=pg_authid.oid OR roleid=pg_authid.oid),'ownedObjects',(SELECT count(*)FROM pg_class WHERE relowner=pg_authid.oid))FROM pg_authid WHERE rolname='yunipals_islands_staking'),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid::text,'ownerOid',proowner::text,'invoker',NOT prosecdef,'config',proconfig,'sha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'))ORDER BY proname)FROM pg_proc WHERE oid IN(to_regprocedure('yunipals_ownership_35cdcb32_v3.source_boundary(text)'),to_regprocedure('yunipals_ownership_35cdcb32_v3.source_probe(text)'))),
 'tables',jsonb_build_object(TARGETS));ROLLBACK;""".replace('RELEASE',RELEASE).replace('TARGETS',targets)
 value=json.loads(o.psql(sql));i=value['identity'];r=value['release']or{};m=value['marker']or{}
 if any(i.get(k)!=v for k,v in {'database':'yunipals_backfill','session':'postgres','current':'postgres','port':'5432','unix':True,'recovery':False}.items()):fail('exact_main_staking_catalog_identity_required')
 if r!={'id':RELEASE,'physicalSchema':PHYSICAL,'buildId':'bf4939b3ff'}or m.get('identity')!=IDENTITY or m.get('release_id')!=RELEASE:fail('exact_accepted_staking_source_read_identity_required')
 functions=value.get('functions')or[]
 if len(functions)!=2 or any(not f['invoker']or f['config']!=['search_path=pg_catalog']for f in functions):fail('protected_existing_source_INVOKER_functions_required')
 for n,t in value['tables'].items():
  if(t.get('table')or{}).get('kind')!='r'or(t.get('table')or{}).get('persistence')!='p':fail('existing_physical_staking_tables_required')
 return value

def main():
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('exact_root_host_required')
 o,p=modules();value=capture(o,p)
 try:
  u=pwd.getpwnam(ROLE);g=grp.getgrnam(ROLE);os_actor={'exists':True,'uid':u.pw_uid,'gid':u.pw_gid,'restricted':u.pw_uid>0 and u.pw_gid==g.gr_gid and os.getgrouplist(ROLE,u.pw_gid)==[g.gr_gid]and u.pw_shell in {'/usr/sbin/nologin','/sbin/nologin','/bin/false'}}
 except KeyError:os_actor={'exists':False,'restricted':False}
 checked={'format':FORMAT,'operatorSha256':sha(o.protected(Path(__file__).absolute(),100000)),'sourcePins':SOURCES,'catalog':value,'osActor':os_actor};marker=sha(encoded(checked));area=OPS/'staking-support-prerequisites-v1';area.mkdir(mode=0o700,exist_ok=True)
 s=area.lstat()
 if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700:fail('private_staking_prerequisite_evidence_required')
 path=area/(marker+'.json')
 if path.exists():
  if o.protected(path)!=encoded(checked)+b'\n':fail('existing_staking_review_changed')
 else:o.save(path,checked)
 names={c['name']for c in value['tables'][TABLES[0]]['columns']};missing=[n for n in ['ownership_release_id','ownership_read_identity']if n not in names]
 print(json.dumps({'format':FORMAT,'completed':True,'reviewHash':marker,'privateReviewFile':str(path),'privateReviewSha256':sha(o.protected(path)),'dedicatedDbRoleExists':value['role']is not None,'dedicatedOsIdentity':os_actor,'missingNullableScanColumns':missing,'sourceInvokerFunctionsProtected':True,'existingBoundedWorkerSourceAccepted':True,'readonly':True,'DDLExecuted':False,'grantsChanged':False,'providerCalls':0,'stakingReadinessClaimed':False},sort_keys=True))
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(e)if isinstance(e,RuntimeError)and re.fullmatch('[a-zA-Z0-9_]{1,100}',str(e))else'fixed_staking_prerequisite_observation_failed','errorClass':type(e).__name__,'rawDiagnosticsExported':False}));raise SystemExit(1)
