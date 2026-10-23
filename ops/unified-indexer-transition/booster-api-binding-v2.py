#!/usr/bin/env python3
"""Read-only binding of the actual collection/birth API and ten launch reads.

The old admission remains historical. This module performs no role/ACL or
service actions and does not treat its obsolete API validator as current.
"""
import copy,hashlib,json,os,pwd,re,stat,subprocess
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
ROLE='yunipals_unified_collector'
SCHEMA='yunipals_boosters_launch_v1'
UNIT='yunipals-booster-api.service'
BUNDLE_SHA='b624dc518556756399a26e691bd1d53d319bd46d20134f9d6e1356dae3d96088'
BUNDLE=Path('/opt/yunipals-unified/booster-api-releases')/BUNDLE_SHA/'booster-api.mjs'
UNIT_SHA='b160e4e6c18a9bfae20bf1780d356eeca41350550c31e63bbb9c7a6d78582ec4'
HISTORICAL=Path('/var/backups/yunipals-booster-api-admission-20261022/result.json')
HISTORICAL_SHA='0fa89a0a8ee6cd5a2ca721dd21e6a3480c0b4df43abfaed21fde252281515f08'
HISTORICAL_OPERATOR='c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e'
SOURCE_OIDS={'_ponder_checkpoint':74518322,'_ponder_meta':74518315,'booster_checkpoint':74518510,'booster_engine_state':74518480,'booster_event':74518495,'booster_monster':74518450,'booster_original':74518420,'booster_refund':74518465,'booster_request':74518435,'booster_type':74518405}
SCHEMA_OID=74518314
TABLES=tuple(sorted(SOURCE_OIDS))
CLEAN={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}

def fail(code):raise RuntimeError(code)

def sha(value):return hashlib.sha256(value).hexdigest()

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def protected(path):
 p=Path(path)
 for item in [*reversed(p.parents),p]:
  s=item.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or(s.st_mode&0o022 and not(stat.S_ISDIR(s.st_mode)and s.st_mode&stat.S_ISVTX)):fail('protected_owner_input_required')
 if not p.is_file()or p.stat().st_size>2000000:fail('bounded_owner_input_required')
 return p.read_bytes()

def run(args,data=None,timeout=15):
 r=subprocess.run(args,input=data,capture_output=True,env=CLEAN,timeout=timeout)
 if r.returncode or r.stderr or len(r.stdout)>1000000:fail('bounded_owner_command_failed')
 return r.stdout

def sql(text,*,actor=False):
 args=['/usr/bin/setpriv','--reuid='+('967'if actor else'111'),'--regid='+('961'if actor else'113'),'--clear-groups','/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','/usr/bin/psql','-X','--no-psqlrc','-w','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-p','5432','-U',ROLE if actor else'postgres','-d','yunipals_backfill','-Atq']
 return run(args,text.encode(),timeout=30)

def capture():
 names=','.join("'"+name+"'"for name in TABLES)
 query="""BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT jsonb_build_object(
 'role',(SELECT jsonb_build_object('oid',r.oid::text,'name',r.rolname,'login',r.rolcanlogin,'super',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDatabase',r.rolcreatedb,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,'validUntil',r.rolvaliduntil,'passwordConfigured',(SELECT rolpassword IS NOT NULL FROM pg_authid WHERE oid=r.oid),'memberships',(SELECT coalesce(jsonb_agg(parent.rolname),'[]'::jsonb)FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid))FROM pg_roles r WHERE r.rolname='"""+ROLE+"""'),
 'schema',(SELECT jsonb_build_object('oid',n.oid::text,'owner',n.nspowner::text,'usage',has_schema_privilege('"""+ROLE+"""',n.oid,'USAGE'),'create',has_schema_privilege('"""+ROLE+"""',n.oid,'CREATE'))FROM pg_namespace n WHERE n.nspname='"""+SCHEMA+"""'),
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind,'select',has_table_privilege('"""+ROLE+"""',c.oid,'SELECT'),'writes',has_table_privilege('"""+ROLE+"""',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"""+SCHEMA+"'AND c.relname=ANY(ARRAY["+names+"])), 'sessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='"+ROLE+"'));ROLLBACK;"
 return json.loads(sql(query))

def comparable(value):
 result=copy.deepcopy(value);result.pop('sessions',None);return result

def api_binding(stopped=False):
 raw=run(['/usr/bin/systemctl','show',UNIT,'--property=Id,InvocationID,MainPID,ActiveState,SubState,User,Group,FragmentPath,DropInPaths,Job,ControlGroup,ExecMainStartTimestampMonotonic'])
 value=dict(line.split('=',1)for line in raw.decode().splitlines()if'='in line)
 if(value.get('Id')!=UNIT or value.get('User')!=ROLE or value.get('Group')!=ROLE or not(stopped and value.get('InvocationID')==''or re.fullmatch('[a-f0-9]{32}',value.get('InvocationID','')))or value.get('DropInPaths')or value.get('FragmentPath')!='/etc/systemd/system/'+UNIT):fail('fixed_owned_feature_API_required')
 if stopped:
  if value['MainPID']!='0'or value['ActiveState']not in{'inactive','failed'}or value['SubState']not in{'dead','failed'}or value.get('Job')not in{'','0'}:fail('stop_owned_API_before_inverse')
  group=value.get('ControlGroup','')
  if group:
   if group!='/system.slice/'+UNIT:fail('foreign_API_cgroup')
   procs=Path('/sys/fs/cgroup'+group+'/cgroup.procs')
   if procs.exists()and procs.read_text().strip():fail('owned_API_cgroup_not_empty')
 elif value['ActiveState']!='active'or value['SubState']!='running'or not value['MainPID'].isdigit()or int(value['MainPID'])<1:fail('running_owned_feature_API_required')
 if not re.fullmatch('[1-9][0-9]*',value.get('ExecMainStartTimestampMonotonic','')):fail('retained_API_process_start_required')
 if sha(protected(BUNDLE))!=BUNDLE_SHA or sha(protected(value['FragmentPath']))!=UNIT_SHA:fail('actual_collection_API_bundle_and_unit_required')
 u=pwd.getpwnam(ROLE)
 if(u.pw_uid,u.pw_gid,u.pw_shell)!=(967,961,'/usr/sbin/nologin'):fail('existing_locked_Unix_actor_required')
 if not stopped:
  proc=Path('/proc')/value['MainPID']
  before=proc.joinpath('stat').read_text();ticks=int(before[before.rfind(')')+2:].split()[19])
  status=dict(line.split(':',1)for line in proc.joinpath('status').read_text().splitlines()if':'in line)
  expected=[b'/opt/node-v24.18.1/bin/node',b'--max-old-space-size=256',str(BUNDLE).encode(),b'']
  if(set(status['Uid'].split())!={'967'}or set(status['Gid'].split())!={'961'}or proc.joinpath('cmdline').read_bytes().split(b'\0')!=expected or proc.joinpath('cgroup').read_text().splitlines()!=['0::/system.slice/'+UNIT]):fail('exact_current_API_actor_required')
  after=proc.joinpath('stat').read_text()
  if ticks!=int(after[after.rfind(')')+2:].split()[19]):fail('current_API_actor_changed')
 value['definitionSha256']=sha(protected(value['FragmentPath']));value['environmentSha256']=sha(protected('/etc/yunipals-unified/booster-api.env'));value['bundleSha256']=BUNDLE_SHA
 return value

def expected_launch(receipt):
 if(receipt.get('format')!='yunipals-booster-api-admission' or receipt.get('committed')is not True or receipt.get('operatorSha256')!=HISTORICAL_OPERATOR or receipt.get('role')!=ROLE or receipt.get('roleOid')!='73187672' or receipt.get('noRoleWritesGranted')is not True):fail('actual_original_peer_admission_required')
 expected=copy.deepcopy(receipt['after'])
 rows=expected.get('tables')or[]
 if len(rows)!=9 or any(r['name']=='booster_event'for r in rows):fail('historical_nine_read_baseline_required')
 rows.append({'name':'booster_event','oid':'74518495','owner':'73004621','kind':'r','select':True,'writes':False})
 expected['tables']=sorted(rows,key=lambda r:r['name'])
 return expected

def validate(value,admitted=True):
 if admitted is not True:fail('existing_admitted_peer_only_no_role_transition')
 raw=protected(HISTORICAL)
 if sha(raw)!=HISTORICAL_SHA:fail('original_admission_receipt_changed')
 expected=expected_launch(json.loads(raw))
 if comparable(value)!=expected or {r['name']:r['oid']for r in value.get('tables')or[]}!={k:str(v)for k,v in SOURCE_OIDS.items()}:fail('exact_historical_nine_plus_actual_birth_journal_read_required')
 if type(value.get('sessions'))is not int or not 0<=value['sessions']<=6:fail('existing_six_slot_peer_budget_required')
 return value

if __name__=='__main__':
 print(json.dumps({'validated':bool(validate(capture())),'api':api_binding(),'databaseWrites':0,'serviceActions':0},sort_keys=True))
