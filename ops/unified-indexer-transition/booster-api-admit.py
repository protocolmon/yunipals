#!/usr/bin/env python3
"""Finite existing collector peer admission for the booster API; no service jobs."""
import argparse,copy,hashlib,json,os,pwd,re,stat,subprocess
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-booster-api-admission-20261022')
ROLE='yunipals_unified_collector'
SCHEMA='yunipals_boosters_launch_v1'
UNIT='yunipals-booster-api.service'
BUNDLE=Path('/opt/yunipals-unified/booster-api-releases/d0e269b0f3d43cc0cea2bcf53cc3b390357576e8901988942d17ffeb11f5cc4a/booster-api.mjs')
BUNDLE_SHA='d0e269b0f3d43cc0cea2bcf53cc3b390357576e8901988942d17ffeb11f5cc4a'
SOURCE_OIDS={'_ponder_checkpoint': 74518322, '_ponder_meta': 74518315, 'booster_checkpoint': 74518510, 'booster_engine_state': 74518480, 'booster_monster': 74518450, 'booster_original': 74518420, 'booster_refund': 74518465, 'booster_request': 74518435, 'booster_type': 74518405}
SCHEMA_OID=74518314
REHEARSAL_SHA='69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42'
INVERSE_SHA='e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526'
TABLES=('_ponder_checkpoint','_ponder_meta','booster_checkpoint','booster_engine_state','booster_monster','booster_original','booster_refund','booster_request','booster_type')
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
def write(path,value):
 raw=value if isinstance(value,bytes)else encoded(value)
 with path.open('xb')as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
 return sha(raw)
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

def validate(value,admitted=False):
 if not SOURCE_OIDS or SCHEMA_OID is None or REHEARSAL_SHA is None or INVERSE_SHA is None:fail('actual_launch_schema_OID_freeze_required')
 r=value.get('role')or{}
 expected={'oid':'73187672','name':ROLE,'login':admitted,'super':False,'inherit':False,'createRole':False,'createDatabase':False,'replication':False,'bypassRls':False,'connectionLimit':6,'validUntil':None,'passwordConfigured':False,'memberships':[]}
 if r!=expected or value.get('schema')!={'oid':str(SCHEMA_OID),'owner':'73004621','usage':admitted,'create':False}:fail('exact_frozen_collector_and_source_namespace_required')
 rows=value.get('tables')or[]
 if len(rows)!=9 or {row['name']:row['oid']for row in rows}!={k:str(v)for k,v in SOURCE_OIDS.items()}:fail('exact_nine_source_table_OIDs_required')
 if any(row['owner']!='73004621'or row['kind']!='r'or row['select']is not admitted or row['writes']is not False for row in rows):fail('exact_finite_source_read_admission_required')
 return value

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
 if sha(protected(BUNDLE))!=BUNDLE_SHA:fail('frozen_feature_API_bundle_required')
 u=pwd.getpwnam(ROLE)
 if(u.pw_uid,u.pw_gid,u.pw_shell)!=(967,961,'/usr/sbin/nologin'):fail('existing_locked_Unix_actor_required')
 value['definitionSha256']=sha(protected(value['FragmentPath']));value['environmentSha256']=sha(protected('/etc/yunipals-unified/booster-api.env'));value['bundleSha256']=BUNDLE_SHA
 return value

def inputs():
 files={name:protected(OPS/name)for name in('booster-api-collector-rehearsal.sql','booster-api-collector-inverse.sql')}
 if sha(files['booster-api-collector-rehearsal.sql'])!=REHEARSAL_SHA or sha(files['booster-api-collector-inverse.sql'])!=INVERSE_SHA:fail('frozen_finite_admission_SQL_required')
 if not files['booster-api-collector-rehearsal.sql'].rstrip().endswith(b'ROLLBACK;'):fail('rollback_rehearsal_required')
 return files

def rehearse():
 if BASE.exists():fail('reconcile_existing_admission_attempt_before_retry')
 before=validate(capture());api=api_binding();files=inputs()
 BASE.mkdir(mode=0o700)
 if before['sessions']!=0:fail('dormant_collector_sessions_must_be_zero')
 binding={'format':'yunipals-booster-api-admission','operatorSha256':sha(protected(__file__)),'sourceSchema':SCHEMA,'sourceNamespaceOid':SCHEMA_OID,'tableOids':SOURCE_OIDS,'api':api,'before':comparable(before),'rehearsalSqlSha256':REHEARSAL_SHA,'inverseSqlSha256':INVERSE_SHA}
 write(BASE/'rehearsal-intent.json',binding)
 raw=sql(files['booster-api-collector-rehearsal.sql'].decode());write(BASE/'rehearsal.private',raw)
 after=validate(capture())
 if comparable(after)!=comparable(before)or after['sessions']!=0 or api_binding()!=api:fail('actual_rehearsal_did_not_restore_bound_state')
 binding['actualRollbackRehearsed']=True;binding['rehearsalOutputSha256']=sha(raw)
 pin=sha(encoded(binding));write(BASE/'review.json',{'binding':binding,'reviewHash':pin})
 return {'rehearsed':True,'reviewHash':pin,'reviewFile':str(BASE/'review.json'),'schemaOid':SCHEMA_OID,'tableOids':SOURCE_OIDS,'roleRestoredNoLogin':True,'serviceChanges':0}

def document(path,pin=None):
 raw=protected(path)
 if pin is not None and sha(raw)!=pin:fail('exact_owned_receipt_required')
 return json.loads(raw)

def commit(pin):
 review=document(BASE/'review.json');b=review['binding']
 if pin!=review['reviewHash']or pin!=sha(encoded(b))or not b.get('actualRollbackRehearsed')or b['operatorSha256']!=sha(protected(__file__)):fail('actual_frozen_rollback_review_required')
 before=validate(capture());api=api_binding();files=inputs()
 if comparable(before)!=b['before']or before['sessions']!=0 or api!=b['api']:fail('reviewed_source_or_API_changed_before_commit')
 write(BASE/'commit-intent.json',{'reviewHash':pin,'before':before,'api':api})
 text=files['booster-api-collector-rehearsal.sql'].decode();text=re.sub(r'ROLLBACK;\s*$','COMMIT;\n',text)
 write(BASE/'commit.sql',text.encode());raw=sql(text);write(BASE/'commit.private',raw)
 after=validate(capture(),True)
 if api_binding()!=api:fail('owned_API_changed_during_admission')
 positive=sql("BEGIN READ ONLY;SELECT jsonb_build_object('user',current_user,'schemaUsage',has_schema_privilege(current_user,'"+SCHEMA+"','USAGE'),'typeCount',(SELECT count(*)FROM "+SCHEMA+".booster_type),'baseCheckpointReadable',EXISTS(SELECT 1 FROM "+SCHEMA+"._ponder_checkpoint WHERE chain_id=8453));ROLLBACK;",actor=True)
 write(BASE/'peer-positive.private',positive)
 result={'format':'yunipals-booster-api-admission','committed':True,'reviewHash':pin,'operatorSha256':b['operatorSha256'],'sourceSchema':SCHEMA,'namespaceOid':SCHEMA_OID,'tableOids':SOURCE_OIDS,'api':api,'before':b['before'],'after':comparable(after),'transactionSha256':sha(text.encode()),'outputSha256':sha(raw),'positivePeerReadSha256':sha(positive),'role':'yunipals_unified_collector','roleOid':'73187672','unixUid':967,'unixGid':961,'noRoleWritesGranted':True,'serviceChanges':0}
 result_sha=write(BASE/'result.json',result)
 return{'committed':True,'resultFile':str(BASE/'result.json'),'resultSha256':result_sha,'role':ROLE,'namespaceOid':SCHEMA_OID,'tableOids':SOURCE_OIDS,'positivePeerRead':json.loads(positive),'apiInvocation':api['InvocationID']}

def owned_stopped_api(current,saved):
 for key in('Id','User','Group','FragmentPath','DropInPaths','definitionSha256','environmentSha256','bundleSha256','ExecMainStartTimestampMonotonic'):
  if current.get(key)!=saved.get(key):fail('only_owned_stopped_API_may_be_reversed')
 if current.get('InvocationID')not in{'',saved.get('InvocationID')}:fail('foreign_stopped_API_invocation')
 # systemd may clear InvocationID at stop. The preserved positive main-start
 # timestamp binds the last executed process even in that empty-ID case.
 if not re.fullmatch('[1-9][0-9]*',current.get('ExecMainStartTimestampMonotonic','')):fail('recorded_stopped_API_start_required')

def inverse(pin):
 receipt=document(BASE/'result.json',pin);before=validate(capture(),True);api=api_binding(True);files=inputs()
 if not receipt.get('committed')or receipt['operatorSha256']!=sha(protected(__file__))or comparable(before)!=receipt['after']or before['sessions']!=0:fail('unchanged_owned_admission_and_zero_sessions_required')
 owned_stopped_api(api,receipt['api'])
 write(BASE/'inverse-intent.json',{'receiptSha256':pin,'api':api,'before':before})
 raw=sql(files['booster-api-collector-inverse.sql'].decode());write(BASE/'inverse.private',raw)
 after=validate(capture())
 if comparable(after)!=receipt['before']or after['sessions']!=0:fail('inverse_did_not_restore_exact_prior_admission')
 result={'restored':True,'receiptSha256':pin,'roleRestoredNoLogin':True,'noServiceChanges':True};write(BASE/'inverse-result.json',result);return result

def main():
 p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--rehearse',action='store_true');g.add_argument('--commit');g.add_argument('--inverse');a=p.parse_args()
 if os.geteuid()!=0:fail('root_owned_admission_operator_required')
 value=commit(a.commit)if a.commit else inverse(a.inverse)if a.inverse else rehearse()
 print(json.dumps(value,sort_keys=True))
if __name__=='__main__':main()
