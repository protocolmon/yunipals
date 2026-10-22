#!/usr/bin/env python3
"""Finite operational ACL owner; no LOGIN, service or source-selection changes."""
import argparse,copy,fcntl,hashlib,json,os,re,secrets,socket,stat,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-consumer-operational-owner-v2-20261021')
LOCK=Path('/run/lock/yunipals-unified-consumer-api-preview.lock')
FORMAT='yunipals-consumer-operational-owner-v2'
OWNER_SHA='6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80'
SCOPE_SHA='ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0'
SCOPE_FILE='consumer-operational-admission-v1.review.json'
RETAINED_SHA='bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db'
ROLES={'yunipals_unified_api':73187671,'yunipals_unified_collector':73187672,'yunipals_unified_read_cache':73187673,'yunipals_unified_islands_api':73187674}
KINDS={'schema':'USAGE','relation':'SELECT','function':'EXECUTE'}
PRIVS={'schema':['USAGE','CREATE'],'relation':['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'],'function':['EXECUTE']}
def fail(code):raise RuntimeError(code)
def failure(error):
 frames=[];codes=[];tb=error.__traceback__
 while tb:
  code=tb.tb_frame.f_code
  if Path(code.co_filename).name.startswith('consumer-'):
   frames.append({'file':Path(code.co_filename).name,'function':code.co_name,'line':tb.tb_lineno})
   if error.args and isinstance(error.args[0],str)and error.args[0]in code.co_consts:codes.append(error.args[0])
  tb=tb.tb_next
 return {'errorClass':type(error).__name__,'fixedCodes':sorted(set(codes)),'publicFrames':frames[-8:],'rawMessageExported':False}
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def quoted(v):return "'"+str(v).replace("'","''")+"'"
def protected(path,cap=2000000):
 path=Path(path)
 if not path.is_absolute()or'..'in path.parts:fail('protected_absolute_input_required')
 for p in [*path.parents,path]:
  x=p.lstat()
  if stat.S_ISLNK(x.st_mode)or x.st_uid!=0 or(x.st_mode&0o022 and not(stat.S_ISDIR(x.st_mode)and x.st_mode&stat.S_ISVTX)):fail('protected_input_ancestry_required')
 x=path.stat()
 if not stat.S_ISREG(x.st_mode)or x.st_size>cap:fail('bounded_regular_input_required')
 raw=path.read_bytes();y=path.stat()
 if (x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns)!=(y.st_dev,y.st_ino,y.st_size,y.st_mtime_ns,y.st_ctime_ns):fail('input_changed_while_reading')
 return raw

def load(path,pin):
 raw=protected(path)
 if sha(raw)!=pin:fail('frozen_dependency_changed')
 m=types.ModuleType(path.stem.replace('-','_'));m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def modules():
 owner=load(OPS/'ownership-readview-owner-v1.py',OWNER_SHA);helper,frozen,_=owner.load_inputs()
 raw=protected(OPS/SCOPE_FILE)
 if sha(raw)!=SCOPE_SHA:fail('fixed_operational_scope_changed')
 scope=json.loads(raw);features=document(OPS/'consumer-retained-read-dependencies-v1.json',RETAINED_SHA)
 observed=document(features['actualSelectorsFile'],features['actualSelectorsSha256'])
 if observed.get('format')!='yunipals-consumer-retained-selectors-v1'or observed.get('completed')is not True or {r['unit']:r['flags']for r in observed['services']}!=features['retainedFlags']:fail('actual_retained_feature_selectors_required')
 for name,pin in features['sourcePins'].items():
  if sha(protected(helper.ROOT/name))!=pin:fail('retained_route_public_source_changed')
 scope['retainedReads']=features['groups'];scope['retainedFeatureDependencySha256']=RETAINED_SHA;scope['retainedSelectors']=observed
 return owner,helper,frozen,scope

def document(path,pin):
 raw=protected(path,2000000)
 if sha(raw)!=pin:fail('protected_receipt_changed')
 return json.loads(raw)

def objects(scope,frozen):
 wanted={k:set()for k in KINDS}
 for r in frozen['roles']:
  for k in wanted:wanted[k].update(r[{'schema':'schemas','relation':'relations','function':'functions'}[k]])
 for r in scope['remainingReads']+[scope['conditionalMainCacheReads']]+scope.get('retainedReads',[]):
  for k in wanted:wanted[k].update(r[{'schema':'schemas','relation':'relations','function':'functions'}[k]])
 for r in scope['separateWrites']:
  wanted['relation'].update(t['name']for t in r['relations'])
 wanted['relation'].update(['metadata.chain_readiness','metadata.island_verification'])
 return {k:sorted(v)for k,v in wanted.items()}

def mutations(scope,phase,main_cache):
 if phase=='features':return[(r['role'],k,n,KINDS[k])for r in scope['retainedReads']for k in KINDS for n in r[{'schema':'schemas','relation':'relations','function':'functions'}[k]]]
 if phase=='reads':
  rows=[(r['role'],k,n,KINDS[k])for r in scope['remainingReads']for k in KINDS for n in r[{'schema':'schemas','relation':'relations','function':'functions'}[k]]]
  if main_cache:
   r=scope['conditionalMainCacheReads'];rows +=[(r['role'],k,n,KINDS[k])for k in KINDS for n in r[{'schema':'schemas','relation':'relations','function':'functions'}[k]]]
  return rows
 row=next(r for r in scope['separateWrites']if r['phase']=={'visibility':'main_signed_visibility','cache':'read_cache_worker'}[phase])
 return[(row['role'],'relation',r['name'],p)for r in row['relations']for p in r['privileges']if not(scope.get('retainedReads')and r['name']=='metadata.wallet_visibility_nonce'and p=='SELECT')]

def catalog_sql(scope,frozen):
 targets=objects(scope,frozen);values=','.join('('+quoted(k)+','+quoted(n)+')'for k,names in targets.items()for n in names)
 roles=','.join('('+quoted(r)+')'for r in ROLES);schemas=','.join(quoted(n)for n in targets['schema'])
 # Full ACLs only for the finite existing dependency graph; no application rows.
 return """WITH wanted(kind,name)AS(VALUES VALUES_TARGET), roles AS(SELECT a.* FROM pg_authid a WHERE rolname IN(VALUES_ROLES)),
 obj AS(SELECT w.*,CASE w.kind WHEN 'schema'THEN n.oid WHEN 'function'THEN p.oid ELSE c.oid END AS oid,
 CASE w.kind WHEN 'schema'THEN n.nspowner WHEN 'function'THEN p.proowner ELSE c.relowner END AS owner,
 CASE w.kind WHEN 'schema'THEN COALESCE(n.nspacl,acldefault('n',n.nspowner))WHEN 'function'THEN COALESCE(p.proacl,acldefault('f',p.proowner))ELSE COALESCE(c.relacl,acldefault('r',c.relowner))END AS acl,
 c.relkind,p.prosecdef,p.proconfig,CASE WHEN p.oid IS NOT NULL THEN encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')WHEN c.relkind='v'THEN encode(sha256(convert_to(pg_get_viewdef(c.oid,false),'UTF8')),'hex')END AS body
 FROM wanted w LEFT JOIN pg_namespace n ON w.kind='schema'AND n.oid=to_regnamespace(w.name)
 LEFT JOIN pg_proc p ON w.kind='function'AND p.oid=to_regprocedure(w.name)
 LEFT JOIN pg_class c ON w.kind='relation'AND c.oid=to_regclass(w.name))
 SELECT jsonb_build_object('identity',jsonb_build_object('database',current_database(),'port',current_setting('port'),'socket',inet_server_addr()IS NULL),
 'marker',(SELECT to_jsonb(x.*)FROM yunipals_ownership_35cdcb32_v3._unified_read_release x WHERE singleton),
 'objects',(SELECT jsonb_agg(jsonb_build_object('kind',o.kind,'name',o.name,'oid',o.oid::text,'owner',o.owner::text,'relationKind',o.relkind,'securityDefiner',o.prosecdef,'config',o.proconfig,'bodySha256',o.body,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor::text,'grantee',a.grantee::text,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable)FROM aclexplode(o.acl)a),
 'rights',(SELECT jsonb_object_agg(r.rolname,(SELECT jsonb_object_agg(privilege,CASE o.kind WHEN 'schema'THEN has_schema_privilege(r.oid,o.oid,privilege)WHEN 'function'THEN has_function_privilege(r.oid,o.oid,privilege)ELSE has_table_privilege(r.oid,o.oid,privilege)END)FROM unnest(CASE o.kind WHEN 'schema'THEN ARRAY['USAGE','CREATE']WHEN 'function'THEN ARRAY['EXECUTE']ELSE ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']END)privilege))FROM roles r))ORDER BY o.kind,o.name)FROM obj o),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'oid',r.oid::text,'login',r.rolcanlogin,'inherit',r.rolinherit,'super',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'limit',r.rolconnlimit,'passwordNull',r.rolpassword IS NULL,
 'membershipEdges',(SELECT count(*)FROM pg_auth_members a WHERE a.member=r.oid OR a.roleid=r.oid),'databaseCreate',has_database_privilege(r.oid,current_database(),'CREATE'),
 'ownedObjects',(SELECT count(*)FROM pg_class c WHERE c.relowner=r.oid),
 'definerExecute',(SELECT count(*)FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN(SCHEMAS)AND p.prosecdef AND has_schema_privilege(r.oid,n.oid,'USAGE')AND has_function_privilege(r.oid,p.oid,'EXECUTE')),
 'schemaCreate',(SELECT count(*)FROM pg_namespace n WHERE n.nspname IN(SCHEMAS)AND has_schema_privilege(r.oid,n.oid,'CREATE')),
 'writeRights',(SELECT COALESCE(jsonb_agg(jsonb_build_object('relation',n.nspname||'.'||c.relname,'privilege',v.privilege)ORDER BY n.nspname,c.relname,v.privilege),'[]'::jsonb)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])v(privilege)WHERE n.nspname IN(SCHEMAS)AND CASE WHEN c.relkind IN('r','p','v','m','f')THEN has_table_privilege(r.oid,c.oid,v.privilege)ELSE false END),
 'sequenceWrites',(SELECT count(*)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(SCHEMAS)AND CASE WHEN c.relkind='S'THEN has_sequence_privilege(r.oid,c.oid,'USAGE,UPDATE')ELSE false END))ORDER BY r.rolname)FROM roles r))""".replace('VALUES_TARGET',values).replace('VALUES_ROLES',','.join(quoted(r)for r in ROLES)).replace('SCHEMAS',schemas)

def capture(owner,scope,frozen):return owner.json_sql('SET LOCAL search_path=pg_catalog;\n'+catalog_sql(scope,frozen))

def unchanged_common(owner,helper,frozen):
 actual=owner.json_sql(owner.postcheck_sql(helper,frozen))
 if sha(owner.encoded({k:actual[k]for k in ['relations','functions']}))!='da4ec077ce1c1b7c76d6dbf0e840a457568097b52d9aee8502886fc291ef2937':fail('accepted_common_read_definitions_changed')
 return {'definitionsSha256':'da4ec077ce1c1b7c76d6dbf0e840a457568097b52d9aee8502886fc291ef2937',
  'sourcePeerAcl':owner.validate_source(owner.json_sql(owner.source_acl_sql(helper),role=owner.SOURCE_ROLE)),
  'activeSelector':owner.json_sql(owner.selector_sql())}

def validate_catalog(value,scope,frozen,*,allow_login=False):
 if value['identity']!={'database':'yunipals_backfill','port':'5432','socket':True}:fail('exact_main_Unix_database_required')
 view=scope['readView'];marker=value.get('marker')or{}
 if any(marker.get(k)!=view[v]for k,v in [('identity','identity'),('release_id','releaseId'),('manifest_hash','manifestHash')]):fail('accepted_read_identity_changed')
 if {r['name']:int(r['oid'])for r in value['roles']}!=ROLES:fail('accepted_four_role_OIDs_changed')
 for r in value['roles']:
  if((not allow_login and r['login'])or r['limit']!=6 or not r['passwordNull']or any(r[k]for k in ['inherit','super','createDb','createRole','replication','bypassRls','databaseCreate'])or any(r[k]!=0 for k in ['membershipEdges','ownedObjects','definerExecute','schemaCreate','sequenceWrites'])):fail('dedicated_role_negative_authority_changed')
 target=objects(scope,frozen)
 if {(r['kind'],r['name'])for r in value['objects']}!={(k,n)for k,names in target.items()for n in names}:fail('finite_existing_dependency_graph_required')
 for r in value['objects']:
  if not re.fullmatch('[1-9][0-9]*',r.get('oid')or'')or not re.fullmatch('[1-9][0-9]*',r.get('owner')or''):fail('existing_dependency_OID_owner_required')
  if r['kind']=='relation'and r['relationKind']not in {'r','p','v'}:fail('ordinary_table_or_invoker_view_required')
  if r['kind']=='function'and(r['securityDefiner']or r['config']!=['search_path=pg_catalog']):fail('existing_protected_INVOKER_function_required')
  if any(a['grantable']for a in r['acl']or[]if int(a['grantee'])in ROLES.values()):fail('no_consumer_grant_options_allowed')
 return value

def baseline_rights(scope,frozen):
 rights={r:{k:set(row[{'schema':'schemas','relation':'relations','function':'functions'}[k]])for k in KINDS}for r,row in [(row['role'],row)for row in frozen['roles']]}
 for r in [*list(ROLES)[:2],list(ROLES)[3]]:rights[r]['schema'].add('metadata');rights[r]['relation'].add('metadata.chain_readiness')
 for r in list(ROLES)[:2]:rights[r]['schema'].update(['metadata_projection','metadata_source']);rights[r]['relation'].update(['metadata_projection.active','metadata_projection.generation','metadata_source.archive_release']);rights[r]['function'].add('yunipals_ownership_35cdcb32_v3.base_metadata_probe()')
 rights[list(ROLES)[3]]['relation'].add('metadata.island_verification')
 return rights

def validate_initial(value,scope,frozen):
 validate_catalog(value,scope,frozen);base=baseline_rights(scope,frozen)
 for o in value['objects']:
  for r,priv in o['rights'].items():
   if priv!={p:(p==KINDS[o['kind']]and o['name']in base[r][o['kind']])for p in PRIVS[o['kind']]}:fail('actual_accepted_baseline_privilege_matrix_changed')
 if any(r['writeRights']for r in value['roles']):fail('no_prior_consumer_DML_allowed')

def expected_after(before,changes,*,remove=False):
 result=copy.deepcopy(before);index={(o['kind'],o['name']):o for o in result['objects']}
 for role,kind,name,priv in changes:
  o=index[kind,name];entry={'grantor':o['owner'],'grantee':str(ROLES[role]),'privilege':priv,'grantable':False}
  acl=o['acl']or[]
  if remove:
   if entry not in acl:fail('exact_owned_grant_delta_missing')
   acl.remove(entry)
  elif entry in acl or o['rights'][role][priv]:fail('no_existing_capability_may_be_adopted')
  else:acl.append(entry)
  o['acl']=sorted(acl,key=lambda a:(int(a['grantor']),int(a['grantee']),a['privilege'],a['grantable']))or None;o['rights'][role][priv]=not remove
  if kind=='relation'and priv!='SELECT':
   r=next(r for r in result['roles']if r['name']==role);v={'relation':name,'privilege':priv}
   if remove:r['writeRights'].remove(v)
   else:r['writeRights'].append(v)
   r['writeRights'].sort(key=lambda x:(x['relation'],x['privilege']))
 return result

def phase_sql(changes,*,remove=False):
 out=[]
 for role,kind,name,priv in changes:
  target='FUNCTION '+name if kind=='function'else'SCHEMA '+name if kind=='schema'else'TABLE '+name
  if not re.fullmatch(r'[a-z_][a-z0-9_.]*(?:\((?:text|boolean)?\))?',name):fail('fixed_object_name_required')
  out.append(('REVOKE 'if remove else'GRANT ')+priv+' ON '+target+(' FROM 'if remove else' TO ')+role+';')
 return out

def session_count(owner,role):
 if role not in ROLES:fail('fixed_affected_role_required')
 value=owner.json_sql("SELECT jsonb_build_object('n',count(*))FROM pg_stat_activity WHERE usename="+quoted(role))
 if not isinstance(value,dict)or set(value)!={'n'}or type(value['n'])is not int or value['n']<0:fail('actual_session_count_JSON_shape_required')
 return value['n']

def session_guard(roles=None):
 roles=list(ROLES)if roles is None else roles
 if not roles or set(roles)-set(ROLES):fail('fixed_affected_roles_required')
 return "IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename IN("+','.join(quoted(r)for r in roles)+"))THEN RAISE EXCEPTION 'consumer_sessions_must_be_zero';END IF;"
def guarded_sql(before,after,changes,query,*,remove=False):
 body='\n'.join([session_guard(),'IF ('+query+')IS DISTINCT FROM '+quoted(json.dumps(before,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'operational_before_catalog_changed';END IF;",*phase_sql(changes,remove=remove),'IF ('+query+')IS DISTINCT FROM '+quoted(json.dumps(after,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'only_exact_operational_ACL_delta_allowed';END IF;"])
 tag='$operational_'+sha(body.encode())[:16]+'$'
 if tag in body:fail('inert_SQL_delimiter_required')
 return "BEGIN;SET LOCAL search_path=pg_catalog;SET LOCAL standard_conforming_strings=on;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='1500ms';\nSELECT pg_advisory_xact_lock(178858,9062);DO "+tag+' BEGIN\n'+body+'\nEND '+tag+';COMMIT;\n'

def applied(owner,path,pin,scope,frozen):
 result=document(path,pin);saved=document(Path(path).parent/'review.json',result['reviewFileSha256'])
 if(result.get('format')!=FORMAT or not result.get('applied')or result.get('transactionOutcome')!='commit_confirmed'or result.get('operatorSha256')!=sha(protected(Path(__file__).absolute()))or saved['reviewHash']!=sha(encoded(saved['binding']))or result['reviewHash']!=saved['reviewHash']or result['afterSha256']!=sha(encoded(saved['binding']['after']))):fail('actual_confirmed_operational_ACL_receipt_required')
 value=capture(owner,scope,frozen)
 if value!=saved['binding']['after']:fail('current_operational_catalog_differs_from_acknowledged_receipt')
 return result,saved,value

def review(owner,helper,frozen,scope,phase,main_cache,previous=None,positive=None,rollback=False):
 before=capture(owner,scope,frozen);validate_catalog(before,scope,frozen);common=unchanged_common(owner,helper,frozen);read_receipt=None
 if scope.get('retainedSelectors')and main_cache is not True:fail('actual_retained_main_cache_flag_requires_its_read_slice')
 if previous:
  receipt,saved,current=applied(owner,*previous,scope,frozen)
  if rollback:
   changes=saved['binding']['changes']
   if phase!=saved['binding']['phase']:fail('exact_owned_rollback_phase_required')
  else:
   if phase not in {'features','visibility','cache'}or receipt['phase']==phase or saved['binding']['rollback']:fail('separate_slice_requires_applied_read_delta')
   if phase=='features'and receipt['phase']!='reads':fail('retained_features_require_applied_original_read_delta')
   if phase in {'visibility','cache'}and receipt['phase']=='reads':fail('full_retained_feature_reads_required_before_write_admission')
   read_receipt=previous[1]if receipt['phase']in {'reads','features'}else saved['binding']['acceptedReadReceiptSha256']
   if main_cache!=saved['binding']['mainCacheEnabled']:fail('retained_cache_selection_changed')
   if phase!='features':
    probe=document(*positive)if positive else{}
    if probe.get('format')!='yunipals-consumer-operational-preview-v1'or probe.get('operatorSha256')!=sha(protected(OPS/'consumer-operational-preview-v1.py'))or probe.get('positiveSelectedServing')is not True or probe.get('cleanupError')is not None or probe.get('roleRestoredNoLogin')is not True or probe.get('aclResultSha256')!=read_receipt or probe.get('service')!='main':fail('positive_main_preview_required_before_write_admission')
   changes=mutations(scope,phase,main_cache)
 else:
  if phase!='reads'or rollback:fail('exact_applied_predecessor_required')
  validate_initial(before,scope,frozen);changes=mutations(scope,phase,main_cache)
 if any(session_count(owner,r)for r in ROLES):fail('dormant_consumers_required')
 after=expected_after(before,changes,remove=rollback)
 binding={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'scopeSha256':SCOPE_SHA,'retainedFeatureDependencySha256':scope.get('retainedFeatureDependencySha256'),'phase':phase,'rollback':rollback,'mainCacheEnabled':main_cache,'previous':previous,'positivePreview':positive,'acceptedReadReceiptSha256':read_receipt,'changes':changes,'before':before,'after':after,'readView':scope['readView'],'common':common}
 return {'format':FORMAT,'reviewHash':sha(encoded(binding)),'binding':binding,'applied':False},guarded_sql(before,after,changes,catalog_sql(scope,frozen),remove=rollback)

def save(path,value):
 raw=encoded(value)+b'\n'
 with path.open('xb')as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
 return sha(raw)

def lease():
 fd=os.open(LOCK,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);x=os.fstat(fd)
 if not stat.S_ISREG(x.st_mode)or x.st_uid!=0 or x.st_mode&0o077:fail('exclusive_consumer_lease_required')
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);return os.fdopen(fd,'a')

def execute(owner,helper,scope,frozen,checked,text,directory):
 save(directory/'review.json',checked);save(directory/'prepared-sql.json',{'sql':text,'sha256':sha(text.encode())});outcome='unconfirmed_requires_catalog_reconcile';error=None
 try:
  owner.sql(text,write=True);outcome='commit_confirmed'
  if capture(owner,scope,frozen)!=checked['binding']['after']:fail('fresh_operational_postcheck_changed')
  if unchanged_common(owner,helper,frozen)!=checked['binding']['common']:fail('common_or_source_peer_changed')
 except BaseException as e:error=failure(e)
 result={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'phase':checked['binding']['phase'],'rollback':checked['binding']['rollback'],'reviewHash':checked['reviewHash'],'reviewFileSha256':sha(protected(directory/'review.json')),'applied':error is None,'transactionOutcome':outcome,'afterSha256':sha(encoded(checked['binding']['after'])),'error':error,'loginEnabled':False,'sourceSelectionChanged':False,'automaticRetryAllowed':False}
 pin=save(directory/'result.json',result)
 return {**{k:result[k]for k in ['format','phase','applied','transactionOutcome','error','loginEnabled','sourceSelectionChanged']},'evidenceDirectory':str(directory),'resultSha256':pin}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--phase',choices=['reads','features','visibility','cache'],default='reads');p.add_argument('--main-cache',action='store_true');p.add_argument('--previous-file');p.add_argument('--previous-sha');p.add_argument('--preview-file');p.add_argument('--preview-sha');p.add_argument('--rollback',action='store_true');p.add_argument('--apply');a=p.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_main_required')
 previous=(a.previous_file,a.previous_sha)if a.previous_file and a.previous_sha else None;positive=(a.preview_file,a.preview_sha)if a.preview_file and a.preview_sha else None
 owner,helper,frozen,scope=modules()
 with lease():
  checked,text=review(owner,helper,frozen,scope,a.phase,a.main_cache,previous,positive,a.rollback)
  if not a.apply:
   BASE.mkdir(mode=0o700,exist_ok=True);x=BASE.lstat()
   if not stat.S_ISDIR(x.st_mode)or x.st_uid!=0 or stat.S_IMODE(x.st_mode)!=0o700:fail('protected_evidence_root_required')
   directory=BASE/('review-'+checked['reviewHash']+'-'+secrets.token_hex(4));directory.mkdir(mode=0o700);save(directory/'review.json',checked);save(directory/'prepared-sql.json',{'sql':text,'sha256':sha(text.encode())})
   print(json.dumps({'format':FORMAT,'reviewHash':checked['reviewHash'],'phase':a.phase,'applied':False,'changes':len(checked['binding']['changes']),'loginEnabled':False,'sourceSelectionChanged':False,'evidenceDirectory':str(directory)},sort_keys=True));return
  if a.apply!=checked['reviewHash']:fail('exact_fresh_review_required')
  BASE.mkdir(mode=0o700,exist_ok=True);x=BASE.lstat()
  if not stat.S_ISDIR(x.st_mode)or x.st_uid!=0 or stat.S_IMODE(x.st_mode)!=0o700:fail('protected_evidence_root_required')
  directory=BASE/('apply-'+a.apply);directory.mkdir(mode=0o700)
  print(json.dumps(execute(owner,helper,scope,frozen,checked,text,directory),sort_keys=True))
if __name__=='__main__':main()
