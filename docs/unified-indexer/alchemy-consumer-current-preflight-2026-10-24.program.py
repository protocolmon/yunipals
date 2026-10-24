import hashlib,importlib.util,json,os,signal,stat,sys,time
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
PINS={'completion':('ypal-alchemy-source-completion-v1.py','0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0'),'static':('ypal-restored-metadata-context-v1.py','fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'),'read':('ypal-restored-read-admission-v1.py','91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4')}
ACK='dd98ef06f05d88c1e0af0ff7bf9329f79bfb171cce1e10690a628c678f7e2ea6'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def digest(x):return hashlib.sha256((json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest()
def module(key):
 name,pin=PINS[key];p=OPS/name
 for parent in [*p.parents,p]:
  s=parent.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_fixed_public_source_required')
 before=p.lstat();need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<200000,'bounded_fixed_public_source_required')
 b=p.read_bytes();need(hashlib.sha256(b).hexdigest()==pin and before==p.lstat(),'fixed_public_source_hash_required')
 m=type(sys)(key);m.__file__=str(p);exec(compile(b,str(p),'exec'),m.__dict__);return m
RETRY='all_required_backends_need_unique_positive_stable_kernel_attribution'
def current(c):
 for attempt in range(3):
  try:
   v=c.current();need(v['validated']is True and v['completionResultSha256']==ACK and v['currentWriterQualified']is True and v['original440PaidStartAcknowledged']is False,'actual_completion_current_required');return v
  except RuntimeError as e:
   if str(e)!=RETRY or attempt==2:raise
   time.sleep(.25)
def main():
 need(os.geteuid()==0,'root_readonly_preflight_required');signal.alarm(240)
 completion=module('completion');c=completion.load();need(c.digest('result.json')==ACK,'actual_source_ack_required')
 first=current(c);static=module('static');parts=static.query_components();read=module('read')
 columns=read.protected(read.COLUMNS,read.COLUMNS_SHA).decode().strip();sql=read.combined_sql(parts['catalogSql'],columns)
 h=parts['privilegedSourcePrimitives']['host']
 catalog=h.sdk.peer_query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='12s';SET LOCAL lock_timeout='1s';"+sql+';ROLLBACK;')
 plan=parts['historicalReadPlan'];effective={x['role']:x for x in catalog['read']['effective']};missing={};present={}
 for edge in plan['missingPermissions']:
  role=effective[edge['role']]
  bit=role['schemas'][edge['name']]['usage']if edge['kind']=='schema'else(role['relations'][edge['name']]['select']if edge['kind']=='relation'else role['functions'][edge['name']])
  need(type(bit)is bool,'exact_effective_read_bit_required');target=present if bit else missing;target[edge['role']]=target.get(edge['role'],0)+1
 overlap=[];wanted={(str(e['object']),str(e['grantee']))for e in plan['missingPermissions']if e['kind']=='relation'and e['privilege']=='SELECT'}
 for col in catalog['allColumnAcl']:
  for edge in col['edges']:
   if(str(col['relation']),str(edge['grantee']))in wanted and edge['privilege']=='SELECT':overlap.append(1)
 summary=h.query("SELECT jsonb_build_object('stakingRole',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'limit',rolconnlimit,'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=pg_roles.oid OR roleid=pg_roles.oid),'sessions',(SELECT count(*)FROM pg_stat_activity WHERE usesysid=pg_roles.oid))FROM pg_roles WHERE rolname='yunipals_islands_staking'),'arenaRoles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'oid',oid::text,'login',rolcanlogin)ORDER BY rolname)FROM pg_roles WHERE rolname='arena_native_reader'OR rolname LIKE 'yunipals_arena_native_%'),'stakingCurrentReadFunctions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid::text,'owner',proowner::text,'invoker',NOT prosecdef,'config',proconfig,'bodySha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),'stakingCanExecute',has_function_privilege((SELECT oid FROM pg_roles WHERE rolname='yunipals_islands_staking'),oid,'EXECUTE'))ORDER BY proname)FROM pg_proc WHERE oid IN(to_regprocedure('yunipals_ownership_4e77f52b_v4.source_boundary(text)'),to_regprocedure('yunipals_ownership_4e77f52b_v4.source_probe(text)'))))")
 second=current(c);need(first['completionResultSha256']==second['completionResultSha256']and first['sourcePID']==second['sourcePID'],'source_epoch_changed_during_readonly_preflight')
 print(json.dumps({'format':'yunipals-current-consumer-readonly-preflight-v1','completed':True,'sourceCompletionSha256':ACK,'sourcePID':second['sourcePID'],'sourceReadinessQualified':second['sourceReadinessQualified'],'sameRegisteredNative44':len(parts['nativeIdentity']['tables'])==44,'nativeIdentitySha256':digest(parts['nativeIdentity']),'historicalReadScopeCount':len(plan['missingPermissions']),'currentMissingReadCount':sum(missing.values()),'currentPresentReadCount':sum(present.values()),'missingByExistingRole':missing,'presentByExistingRole':present,'columnOverlapCount':len(overlap),'catalogSha256':digest(catalog),'allColumnAclSha256':digest(catalog['allColumnAcl']),'stakingRole':summary['stakingRole'],'arenaNativeRoleCount':len(summary['arenaRoles']or[]),'arenaNativeLoginCount':sum(x['login']for x in(summary['arenaRoles']or[])),'stakingCurrentReadFunctions':summary['stakingCurrentReadFunctions'],'actualNewAdmissionQualified':False,'canonicalCoverageQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True))
try:main()
except BaseException as e:
 print(json.dumps({'format':'yunipals-current-consumer-readonly-preflight-v1','completed':False,'fixedCode':str(e)if type(e)is RuntimeError and str(e).replace('_','').isalnum()else type(e).__name__,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));sys.exit(1)
