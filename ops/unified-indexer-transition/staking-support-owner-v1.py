#!/usr/bin/env python3
"""Bind the actual staking catalog to one official DDL/NOLOGIN/grant transaction."""
import argparse,copy,fcntl,hashlib,json,os,re,socket,stat,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-staking-support-owner-v1-20261021')
FORMAT='yunipals-staking-support-owner-v1'
OBSERVER_SHA='d80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135'
CAPTURE_SHA='bcdc70533a592c89ee4b7c7863fd5ce6259d4c21bda40ec27ac07fba7e6ee014'
CAPTURE=OPS/'staking-support-prerequisites-v1/91d3112872349a2baa20414cf4c5a199ba3b7e31d46ec157268966feb1cfceb2.json'
SQL_SHA='a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950'
ROLE='yunipals_islands_staking'
PHYSICAL='unified_shadow_20261020_7e7375b0'
READ='yunipals_ownership_35cdcb32_v3'
SCHEMAS=['metadata',PHYSICAL,READ,'yunipals_indexer_control']
RELATIONS=[PHYSICAL+'.'+n for n in ['_ponder_meta','_ponder_checkpoint','indexer_source','chain_block','transfer_event']]+['yunipals_indexer_control.release','yunipals_indexer_control.chain_status',READ+'._unified_read_release',READ+'.transfer_event','metadata.island_staking_scan','metadata.island_staking_position']
FUNCTIONS=[READ+'.source_boundary(text)',READ+'.source_probe(text)']
ADD=['ownership_release_id','ownership_read_identity']
def fail(code):raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def literal(v):return "'"+str(v).replace("'","''")+"'"
def load(path,pin):
 for p in [*path.parents,path]:
  s=p.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_staking_owner_input_required')
 if not path.is_file()or path.stat().st_size>100000:fail('bounded_staking_owner_input_required')
 raw=path.read_bytes()
 if sha(raw)!=pin:fail('frozen_staking_owner_dependency_changed')
 m=types.ModuleType(path.stem.replace('-','_'));m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def closure_sql(*,without_actor=False,new_actor_only=False):
 pairs=[('schema',n)for n in SCHEMAS]+[('relation',n)for n in RELATIONS]+[('function',n)for n in FUNCTIONS]
 values=','.join('('+literal(k)+','+literal(n)+')'for k,n in pairs)
 filter_sql='a.grantee<>oid_actor'if without_actor else'a.grantee=oid_actor'if new_actor_only else'true'
 prefix="WITH wanted(kind,name)AS(VALUES "+values+"),o AS(SELECT w.*,CASE w.kind WHEN 'schema'THEN n.oid WHEN 'relation'THEN c.oid ELSE p.oid END AS oid,CASE w.kind WHEN 'schema'THEN n.nspowner WHEN 'relation'THEN c.relowner ELSE p.proowner END AS owner,CASE w.kind WHEN 'schema'THEN COALESCE(n.nspacl,acldefault('n',n.nspowner))WHEN 'relation'THEN COALESCE(c.relacl,acldefault('r',c.relowner))ELSE COALESCE(p.proacl,acldefault('f',p.proowner))END AS acl,CASE WHEN w.kind='function'THEN encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')WHEN c.relkind='v'THEN encode(sha256(convert_to(pg_get_viewdef(c.oid,false),'UTF8')),'hex')END AS body FROM wanted w LEFT JOIN pg_namespace n ON w.kind='schema'AND n.oid=to_regnamespace(w.name)LEFT JOIN pg_class c ON w.kind='relation'AND c.oid=to_regclass(w.name)LEFT JOIN pg_proc p ON w.kind='function'AND p.oid=to_regprocedure(w.name)) "
 if new_actor_only:
  return prefix+"SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',o.kind,'name',o.name,'privilege',a.privilege_type,'grantable',a.is_grantable,'grantorIsOwner',a.grantor=o.owner)ORDER BY o.kind COLLATE \"C\",o.name COLLATE \"C\",a.privilege_type COLLATE \"C\"),'[]'::jsonb)FROM o CROSS JOIN LATERAL aclexplode(o.acl)a WHERE "+filter_sql
 return prefix+"SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'oid',oid::text,'owner',owner::text,'bodySha256',body,'acl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantor',a.grantor::text,'grantee',a.grantee::text,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)FROM aclexplode(o.acl)a WHERE "+filter_sql+"))ORDER BY kind,name)FROM o"

def required_new_rights():
 rights=[{'kind':k,'name':n,'privilege':p,'grantable':False,'grantorIsOwner':True}for k,names,p in [('schema',SCHEMAS,'USAGE'),('relation',RELATIONS,'SELECT'),('function',FUNCTIONS,'EXECUTE')]for n in names]
 rights +=[{'kind':'relation','name':n,'privilege':p,'grantable':False,'grantorIsOwner':True}for n,privs in [('metadata.island_staking_scan',['INSERT','UPDATE']),('metadata.island_staking_position',['INSERT','DELETE'])]for p in privs]
 return sorted(rights,key=lambda r:(r['kind'],r['name'],r['privilege']))

def expected_tables(before):
 after=copy.deepcopy(before)
 for name in ADD:
  row=after['metadata.island_staking_scan'];row['table']['attributes']+=1
  row['columns'].append({'number':row['table']['attributes'],'name':name,'type':'text','notNull':False,'default':None,'identity':'','generated':'','hasMissing':False,'missingValue':None,'acl':None})
 return after

def table_query(r,p):return 'SELECT jsonb_build_object('+','.join(literal(n)+',('+r.target_sql(p,n)+')'for n in r.TABLES)+')'
def functions_query():return "SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid::text,'ownerOid',proowner::text,'invoker',NOT prosecdef,'config',proconfig,'sha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'))ORDER BY proname)FROM pg_proc WHERE oid IN("+','.join('to_regprocedure('+literal(n)+')'for n in FUNCTIONS)+')'

def prepare(r,o,p,actual,raw):
 if actual.get('format')!=r.FORMAT or actual.get('catalog',{}).get('role')is not None or actual.get('osActor')!={'exists':False,'restricted':False}or actual.get('sourcePins')!=r.SOURCES:fail('exact_actual_absent_staking_actor_capture_required')
 before=actual['catalog'];names={c['name']for c in before['tables'][r.TABLES[0]]['columns']}
 if any(n in names for n in ADD):fail('both_actual_missing_staking_scan_columns_required')
 if sha(raw)!=SQL_SHA:fail('exact_staking_admission_SQL_required')
 # Extract only the existing official ALTER statements from the accepted file.
 source=o.protected(o.ROOT/'apps/yunipals-indexer/lib/islands/staking-verifier.ts',100000).decode()
 for name in ADD:
  statement='ALTER TABLE metadata.island_staking_scan ADD COLUMN IF NOT EXISTS '+name+' text'
  if source.count('`'+statement+'`')!=1 or raw.decode().count(statement+';')!=1:fail('exact_two_official_staking_alters_required')
 before_guard="IF(SELECT system_identifier::text FROM pg_control_system())<>"+literal(before['identity']['systemId'])+" THEN RAISE EXCEPTION 'staking_cluster_identity_changed';END IF;\nIF("+table_query(r,p)+")IS DISTINCT FROM "+literal(encoded(before['tables']).decode())+"::jsonb THEN RAISE EXCEPTION 'staking_actual_table_catalog_changed';END IF;\nIF("+functions_query()+")IS DISTINCT FROM "+literal(encoded(before['functions']).decode())+"::jsonb THEN RAISE EXCEPTION 'staking_actual_source_functions_changed';END IF;\nSELECT x.value INTO before_acl FROM("+closure_sql()+")x(value);"
 post_columns="IF("+table_query(r,p)+")IS DISTINCT FROM "+literal(encoded(expected_tables(before['tables'])).decode())+"::jsonb THEN RAISE EXCEPTION 'staking_only_two_nullable_no_rewrite_columns_allowed';END IF;"
 post_acl="IF("+closure_sql(without_actor=True)+")IS DISTINCT FROM before_acl THEN RAISE EXCEPTION 'staking_existing_object_OIDs_owners_ACLs_changed';END IF;\nIF("+closure_sql(new_actor_only=True)+")IS DISTINCT FROM "+literal(encoded(required_new_rights()).decode())+"::jsonb THEN RAISE EXCEPTION 'staking_only_exact_new_role_grants_allowed';END IF;"
 text=raw.decode()
 for marker,value in [("RAISE EXCEPTION 'reviewed_staking_owner_capture_required'; -- OWNED_CAPTURE_GUARD",before_guard),("RAISE EXCEPTION 'exact_staking_nullable_catalog_required'; -- OWNED_COLUMN_POSTCHECK",post_columns),("RAISE EXCEPTION 'exact_staking_new_actor_ACL_required'; -- OWNED_ACL_POSTCHECK",post_acl)]:
  if text.count(marker)!=1:fail('one_exact_staking_capture_guard_required')
  text=text.replace(marker,value)
 if len(text)>150000:fail('bounded_staking_owner_SQL_required')
 return text

def validate_proof(value):
 if(value.get('applied')is not True or value.get('roleLogin')is not False or value.get('connectionLimit')!=2 or not re.fullmatch('[1-9][0-9]*',value.get('roleOid',''))or any(value.get(n)is not False for n in ['sourceWrites','sourceSelectionChanged','oldScannerChanged','workerExecuted'])):fail('exact_staking_NOLOGIN_grant_proof_required')
 for kind in ['scan','position']:
  a=value[kind+'RowsBefore'];b=value[kind+'RowsAfter']
  if a!=b or set(a)!={'count','sha256'}or type(a['count'])is not int or a['count']<0 or not re.fullmatch('[0-9a-f]{64}',a['sha256']):fail('strict_unchanged_staking_operational_rows_required')
 return value

def main():
 args=argparse.ArgumentParser(description=__doc__);args.add_argument('--apply');a=args.parse_args();os.umask(0o077)
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('exact_root_host_required')
 r=load(OPS/'staking-support-prerequisite-observe-v1.py',OBSERVER_SHA);o,p=r.modules();capture_raw=o.protected(CAPTURE,1000000)
 if sha(capture_raw)!=CAPTURE_SHA:fail('exact_actual_staking_prerequisite_receipt_required')
 actual=json.loads(capture_raw);raw=o.protected(OPS/'staking-support-admission-v1.sql',50000);text=prepare(r,o,p,actual,raw)
 body={'format':FORMAT,'operatorSha256':sha(o.protected(Path(__file__).absolute(),100000)),'actualCaptureFile':str(CAPTURE),'actualCaptureSha256':CAPTURE_SHA,'sqlFileSha256':SQL_SHA,'preparedSqlSha256':sha(text.encode()),'newRole':ROLE,'login':False,'connectionLimit':2,'nullableColumns':ADD,'exactGrantBindings':required_new_rights(),'sourceWrites':False,'workerExecuted':False};marker=sha(encoded(body))
 BASE.mkdir(mode=0o700,exist_ok=True);s=BASE.lstat()
 if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700:fail('private_staking_owner_evidence_required')
 if not a.apply:
  path=BASE/('review-'+marker+'.json')
  if not path.exists():o.save(path,body)
  elif json.loads(o.protected(path))!=body:fail('existing_staking_owner_review_changed')
  print(json.dumps({'format':FORMAT,'reviewHash':marker,'applied':False,'newRoleNoLogin':True,'nullableColumns':2,'grantBindings':len(required_new_rights()),'privateReviewFile':str(path),'privateReviewSha256':sha(o.protected(path)),'workerExecuted':False}));return
 if a.apply!=marker:fail('exact_reviewed_staking_owner_marker_required')
 fd=os.open(o.LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'a')as lock:
  s=os.fstat(lock.fileno())
  if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_mode&0o077:fail('exact_staking_owner_lease_required')
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);directory=BASE/('apply-'+marker);directory.mkdir(mode=0o700);o.save(directory/'review.json',body);o.save(directory/'prepared.json',{'sql':text,'sqlSha256':sha(text.encode()),'automaticRetry':False});result={'format':FORMAT,'reviewHash':marker,'applied':False,'transactionOutcome':'unconfirmed_requires_catalog_reconcile','workerExecuted':False,'loginEnabled':False,'sourceSelectionChanged':False,'error':None}
  try:
   proof=validate_proof(json.loads(o.psql(text,write=True,timeout=20)));o.save(directory/'proof.json',proof);result.update(applied=True,transactionOutcome='commit_confirmed',roleOid=proof['roleOid'],proofSha256=sha(o.protected(directory/'proof.json')),oldRowsUnchanged=True)
  except BaseException as e:result['error']={'class':type(e).__name__,'fixedCode':str(e)if isinstance(e,RuntimeError)and re.fullmatch('[a-zA-Z0-9_]{1,100}',str(e))else None,'rawDiagnosticsExported':False}
  o.save(directory/'result.json',result);print(json.dumps({**result,'resultSha256':sha(o.protected(directory/'result.json')),'evidenceDirectory':str(directory)},sort_keys=True))
  if not result['applied']:raise SystemExit(1)
if __name__=='__main__':main()
