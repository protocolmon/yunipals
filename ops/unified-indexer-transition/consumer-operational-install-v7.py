#!/usr/bin/env python3
"""One final consumer unit admission, or exact owned inverse; no source selection."""
import argparse,copy,hashlib,json,os,re,socket,stat,time,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-consumer-operational-install-v7-20261022')
FORMAT='yunipals-consumer-operational-install-v7'
ACL_SHA='f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d'
PREVIEW_SHA='447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777'
SERVICES={'main':'yunipals-api.service','collector':'yunipals-collector-api.service','cache':'yunipals-read-cache.service','islands':'yunipals-islands-api.service'}
def fail(code):raise RuntimeError(code)
def modules(artifact_file,artifact_sha):
 path=OPS/'consumer-operational-owner-v6.py'
 for p in [*path.parents,path]:
  x=p.lstat()
  if stat.S_ISLNK(x.st_mode)or x.st_uid!=0 or x.st_mode&0o022:fail('protected_owner_required')
 if not path.is_file()or path.stat().st_size>100000:fail('bounded_owner_required')
 raw=path.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=ACL_SHA:fail('frozen_operational_owner_changed')
 a=types.ModuleType('final_consumer_owner');a.__file__=str(path);exec(compile(raw,str(path),'exec'),a.__dict__)
 p=a.load(OPS/'consumer-operational-preview-v6.py',PREVIEW_SHA);a,owner,helper,frozen,scope,old=p.modules(artifact_file,artifact_sha)
 return a,p,old,owner,helper,frozen,scope

def definition(helper,unit):
 raw=helper.run(['/usr/bin/systemctl','show',unit,'--property=FragmentPath,DropInPaths'],timeout=5);v=dict(s.split('=',1)for s in raw.splitlines()if'='in s)
 if set(v)!={'FragmentPath','DropInPaths'}or not v['FragmentPath'].startswith('/etc/systemd/system/'):fail('fixed_installed_consumer_definition_required')
 return [v['FragmentPath'],*v['DropInPaths'].split()]

def file_hashes(a,paths):return {p:a.sha(a.protected(Path(p),2000000))for p in paths}
def private_files(a,old,selectors):
 result=[]
 for name,optional in old.ordered_files(selectors):
  if optional and not os.path.lexists(name):result.append({'path':name,'optional':True,'sha256':None});continue
  result.append({'path':name,'optional':optional,'sha256':a.sha(a.protected(Path(name),4000000))})
 return result

def check_files(a,rows):
 for r in rows:
  if r['sha256']is None:
   if os.path.lexists(r['path']):fail('absent_optional_input_appeared')
  elif a.sha(a.protected(Path(r['path']),4000000))!=r['sha256']:fail('retained_private_input_changed')

def installed_other(a,helper,unit,role,oid):
 directory=BASE/role
 if role=='yunipals_unified_collector'and not os.path.lexists(directory):
  proof=a.owned_booster.ensure()
  return {'role':role,'featureAdmissionSha256':proof['receiptSha256'],'finalCollectorAdmitted':False}
 result=a.document(directory/'result.json',a.sha(a.protected(directory/'result.json')))
 if result.get('format')!=FORMAT or not result.get('applied')or result.get('role')!=role or result.get('roleOid')!=oid or result.get('operatorSha256')!=a.sha(a.protected(Path(__file__).absolute())):fail('other_LOGIN_role_requires_owned_final_admission')
 reviewed=a.document(directory/'review.json',result['reviewFileSha256']);b=reviewed['binding'];current=helper.state(unit)
 if reviewed['reviewHash']!=a.sha(a.encoded(b))or result['reviewHash']!=reviewed['reviewHash']:fail('other_admission_review_binding_changed')
 if current['InvocationID']!=result['invocation']or current['ActiveState']!='active'or current['User']!=role or current['Group']!=role:fail('other_admitted_unit_identity_changed')
 if file_hashes(a,definition(helper,unit))!=result['installedDefinitionHashes']:fail('other_admitted_definition_changed')
 check_files(a,b['privateFiles'])
 for key,text in [('privateDatabaseOverlay',b['databaseOverlay']),('publicSelectorOverlay',b['publicOverlay'])]:
  if a.protected(Path(b['target'][key]))!=text.encode():fail('other_owned_selector_changed')
 if role=='yunipals_unified_collector':
  a.owned_booster.candidate_started(unit,result['invocation'],{**result['installedDefinitionHashes'],**{path:a.sha(text.encode())for path,text in [(b['target']['privateDatabaseOverlay'],b['databaseOverlay']),(b['target']['publicSelectorOverlay'],b['publicOverlay'])]}})
 return {'role':role,'resultSha256':a.sha(a.protected(directory/'result.json')),'invocation':result['invocation']}

def acl_current(a,owner,helper,scope,frozen,path,pin,selected_role):
 result=a.document(path,pin);saved=a.document(Path(path).parent/'review.json',result['reviewFileSha256'])
 if (result.get('format'),result.get('operatorSha256'))not in {(a.OLDER_FORMAT,a.OLDER_OWNER_SHA),(a.PREVIOUS_FORMAT,a.PREVIOUS_OWNER_SHA),a.HISTORICAL_V4,a.HISTORICAL_V5,(a.FORMAT,ACL_SHA)}or not result.get('applied')or result.get('transactionOutcome')!='commit_confirmed'or saved['reviewHash']!=a.sha(a.encoded(saved['binding']))or result.get('reviewHash')!=saved['reviewHash']or result.get('afterSha256')!=a.sha(a.encoded(saved['binding']['after']))or result.get('rollback'):fail('actual_operational_ACL_receipt_required')
 if selected_role!='yunipals_unified_collector'and os.path.lexists(BASE/'yunipals_unified_collector'):
  installed_other(a,helper,'yunipals-collector-api.service','yunipals_unified_collector',73187672)
 current=a.capture(owner,scope,frozen);a.validate_catalog(current,scope,frozen,allow_login=True);normalized=copy.deepcopy(current);admitted=[]
 for r in current['roles']:
  if r['name']=='yunipals_unified_collector':
   if r['login']is not True:fail('owned_feature_collector_LOGIN_required')
   if r['name']!=selected_role:admitted.append(installed_other(a,helper,'yunipals-collector-api.service',r['name'],int(r['oid'])))
   continue
  if r['login']:
   if r['name']==selected_role:fail('selected_role_must_start_NOLOGIN')
   unit=next(row['unit']for row in scope['units']if row['role']==r['name']);admitted.append(installed_other(a,helper,unit,r['name'],int(r['oid'])))
  next(x for x in normalized['roles']if x['name']==r['name'])['login']=False
 if normalized!=a.accepted_history(owner,saved['binding']['after']):fail('ACLs_or_unowned_role_attributes_changed')
 return result,saved,current,admitted

def write(a,path,raw,mode):
 with path.open('xb')as f:os.fchmod(f.fileno(),mode);f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)

def parent_directory(path,mode):
 if os.path.lexists(path):
  x=path.lstat()
  if not stat.S_ISDIR(x.st_mode)or x.st_uid!=0 or x.st_mode&0o022:fail('root_owned_install_directory_required')
 else:
  parent_directory(path.parent,0o755);path.mkdir(mode=mode)

BOOTSTRAP_SHA='69ef867b33e64663476d8513b9969b2a9bbdc3a3c2382bbccc7e8d1a221ac55b'
CACHE_WAIT_SECONDS=1800

def cache_proof(a,owner,helper,target):
 module=a.load(OPS/'consumer-generation-v4-proof-v2.py',BOOTSTRAP_SHA)
 return module.cache_proof(a,owner,helper,target,require_fresh=False)

def final_cache_generation(owner,helper,proof):
 actual=owner.json_sql(helper.cache.generation_sql());helper.cache.generation(actual)
 if actual['id']!=proof['generationId'] or actual['ownershipReadIdentity']!=proof['readIdentity']:
  fail('selected_current_generation_changed_during_install')



def worker_outcomes(helper,unit,invocation):
 raw=helper.run(['/usr/bin/journalctl','--no-pager','--output=json','--output-fields=MESSAGE,_SYSTEMD_INVOCATION_ID',
     '--unit='+unit,'_SYSTEMD_INVOCATION_ID='+invocation,'--lines=4000'],timeout=8)
 rows=raw.splitlines()
 if len(rows)>=4000 or len(raw)>1500000:fail('bounded_owned_worker_journal_required')
 failures={};built=0
 for line in rows:
  row=json.loads(line)
  if row.get('_SYSTEMD_INVOCATION_ID')!=invocation:fail('foreign_worker_journal_invocation')
  try:event=json.loads(row.get('MESSAGE',''))
  except(ValueError,TypeError):continue
  if not isinstance(event,dict):continue
  if event.get('event')=='read_cache_refresh_failed':
   code=event.get('code');code=code if isinstance(code,str) and re.fullmatch('[A-Z0-9]{5}|refresh_failed',code)else'other'
   failures[code]=failures.get(code,0)+1
  if event.get('event')=='read_cache_built':built+=1
 return {'failureCounts':failures,'buildEvents':built,'journalEntries':len(rows),
         'statementTimeoutCauseProven':False,'privateMessagesExported':False}


def wait_for_cache(a,old,owner,helper,b,invocation,directory):
 started=time.monotonic();deadline=started+CACHE_WAIT_SECONDS;polls=0;signals=None;outcome='pending';error=None
 try:
  while True:
   if time.monotonic()>=deadline:fail('bounded_cache_build_still_pending')
   verify_installed(a,helper,old,owner,b,invocation)
   final_cache_generation(owner,helper,b['cacheProof'])
   signals=worker_outcomes(helper,b['target']['unit'],invocation)
   if signals['failureCounts'].get('57014',0)>=2:fail('repeated_owned_worker_query_canceled')
   if sum(signals['failureCounts'].values())>=2:fail('repeated_owned_worker_refresh_failure')
   actual=json.loads(helper.run(helper.peer_args(b['role'],b['peerIdentity']),
      data='BEGIN READ ONLY;\n'+b['cacheProof']['sql']+';\nROLLBACK;',timeout=15));polls+=1
   if actual=={'fresh':True}:
    final_cache_generation(owner,helper,b['cacheProof']);verify_installed(a,helper,old,owner,b,invocation)
    outcome='fresh';break
   if actual!={'fresh':False}:fail('actual_cache_freshness_boolean_required')
   remaining=deadline-time.monotonic()
   if remaining<=0:fail('bounded_cache_build_still_pending')
   time.sleep(min(15,remaining))
 except BaseException as failure:
  error=a.failure(failure);outcome='unacknowledged';raise
 finally:
  state=helper.state(b['target']['unit'])
  a.save(directory/'cache-wait-result.json',{'outcome':outcome,'freshAccepted':outcome=='fresh',
     'elapsedSeconds':round(time.monotonic()-started,3),'maximumWaitSeconds':CACHE_WAIT_SECONDS,
     'polls':polls,'workerOutcomes':signals,'error':error,'expectedInvocation':invocation,
     'observedProcess':{k:state.get(k)for k in ('Id','InvocationID','MainPID','ActiveState','SubState')},
     'generationId':b['cacheProof']['generationId'],'automaticRestartOrRetry':False,
     'processPreservedForOwnedRollback':outcome!='fresh','sourceOrProviderActions':0})


def review(a,p,old,owner,helper,frozen,scope,plan):
 unit=SERVICES[plan['service']];row=next(r for r in helper.matrix()['services']if r['unit']==unit);target=next(r for r in scope['units']if r['unit']==unit);role=target['role']
 receipt,saved,current,admitted=acl_current(a,owner,helper,scope,frozen,plan['aclFile'],plan['aclSha256'],role)
 probe=a.document(plan['previewFile'],plan['previewSha256']);expected_service='main'if plan['service']=='cache'else plan['service']
 if(probe.get('format')!=p.FORMAT or probe.get('operatorSha256')!=PREVIEW_SHA or probe.get('positiveSelectedServing')is not True or probe.get('roleStateRestored')is not True or probe.get('roleLoginAfter')is not(expected_service=='collector') or probe.get('service')!=expected_service or probe.get('cleanupError')is not None):fail('actual_matching_positive_retained_route_preview_required')
 feature_receipt=plan['aclSha256']if receipt['phase']=='features'else saved['binding']['acceptedReadReceiptSha256']
 if probe.get('artifactFile')!=plan['artifactFile']or probe.get('artifactSha256')!=plan['artifactSha256']:fail('positive_preview_uses_different_final_artifact')
 if probe['aclResultSha256']!=feature_receipt:fail('positive_preview_uses_different_ACL_ancestry')
 for r,k,n,priv in a.mutations(scope,'visibility'if plan['service']=='main'else'cache',True)if plan['service']in {'main','cache'}else[]:
  obj=next(o for o in current['objects']if(o['kind'],o['name'])==(k,n))
  if not obj['rights'][r][priv]:fail('matching_final_operational_write_slice_not_admitted')
 state=helper.state(unit);public=helper.public_unit(row,state);definitions=definition(helper,unit);expected_defs=[row['observed']['FragmentPath'],*row['observed']['DropInPaths'].split()]
 if definitions!=expected_defs or not public['active']or not public['knownPublicArgvMatches']or not public['orderedEnvironmentSelectorsMatchBaseline']:fail('retained_original_unit_must_match_before_final_install')
 selectors=old.ordered_files(state['EnvironmentFilesEntries'])
 if [s for s,_ in selectors]!=target['recordedEnvironmentFiles']:fail('complete_actual_private_selector_order_required')
 if not helper.os_identity(role)['restricted']or not helper.hba_compatible(role,helper.sql(helper.catalog_sql())):fail('dedicated_current_OS_peer_identity_required')
 if not helper.capacity(helper.sql(helper.catalog_sql())['capacity'])['sequentialPreviewHeadroomObserved']:fail('fresh_aggregate_connection_headroom_required')
 if a.session_count(owner,role):fail('selected_role_sessions_must_be_zero')
 if plan['service']=='main':
  reads=probe.get('actionReadReceipt')or{};p.action_admission(a,owner,helper,frozen,scope,{'actionAclFile':reads.get('file'),'actionAclSha256':reads.get('sha256')},False)
 preview_row=next(r for r in helper.matrix()['services']if r['unit']==SERVICES[expected_service])
 if probe.get('runtime')!=p.installed(a,helper,preview_row):fail('positive_preview_uses_different_topic_runtime')
 p.installed(a,helper,row)
 overlay_paths=[Path(target[k])for k in ['privateDatabaseOverlay','publicSelectorOverlay','dropIn']]
 if any(os.path.lexists(v)for v in overlay_paths)or os.path.lexists(BASE/role):fail('fresh_owned_final_install_selectors_required')
 observed=next((r for r in scope['retainedSelectors']['services']if r['unit']==unit),None)
 if observed and(observed['invocationId']!=public['invocationId']or observed['orderedEnvironmentFileSelectors']!=state['EnvironmentFilesEntries']):fail('actual_retained_feature_observation_must_still_match')
 flags=observed['flags']if observed else{};public_env=dict(target['publicSelectors'])
 for key,value in flags.items():
  if value is not None:public_env[key]=value
 if plan['service']=='islands'and public_env.get('API_ISLAND_STAKING_ENABLED')!='true':fail('retained_enabled_staking_must_not_be_disabled')
 db=target['databaseOverlayContent'].encode();env=old.env_content(public_env).encode();drop=target['dropInTemplate']
 # Rebuild only the EnvironmentFile lines using freshly verified optional flags.
 prefix=drop[:drop.index('EnvironmentFile=')];suffix=drop[drop.index('ExecStart='):]
 drop=prefix+'EnvironmentFile=\n'+''.join('EnvironmentFile='+('-'if optional else'')+name+'\n'for name,optional in selectors)+'EnvironmentFile='+target['privateDatabaseOverlay']+'\nEnvironmentFile='+target['publicSelectorOverlay']+'\n'+suffix+'NoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nKillMode=control-group\nTimeoutStopSec=60\nUMask=0077\n'
 if any(Path(v).name>=Path(target['dropIn']).name for v in definitions[1:]):fail('new_owned_dropin_must_be_last')
 cache=cache_proof(a,owner,helper,target)if plan['service']=='cache'else None
 binding={'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'plan':plan,'role':role,'roleOid':a.ROLES[role],'target':target,'before':current,'roleLoginBefore':next(r['login']for r in current['roles']if r['name']==role),'ownedBoosterReader':a.owned_booster.ensure(),'retainedOriginalState':state,'retainedOriginalDefinitionHashes':file_hashes(a,definitions),'privateFiles':private_files(a,old,state['EnvironmentFilesEntries']),'peerIdentity':helper.os_identity(role),'otherAdmissions':admitted,'common':a.unchanged_common(owner,helper,frozen),'databaseOverlay':db.decode(),'publicOverlay':env.decode(),'dropIn':drop,'actionReadReceipt':probe.get('actionReadReceipt'),'actionFixture':probe.get('actionFixture'),'positivePreviewSha256':plan['previewSha256'],'scope':'all_currently_enabled_retained_features','cacheProof':cache,'cacheAdmissionMaximumWaitSeconds':CACHE_WAIT_SECONDS if cache else None}
 return {'format':FORMAT,'reviewHash':a.sha(a.encoded(binding)),'binding':binding}

def verify_installed(a,helper,old,owner,b,invocation):
 target=b['target'];unit=target['unit'];role=b['role'];state=helper.state(unit);expected=[helper.NODE,'--import','tsx',str(helper.ROOT/'apps/yunipals-indexer'/helper.ENTRYPOINTS[unit])]
 if(state['InvocationID']!=invocation or state['ActiveState']!='active'or state['SubState']!='running'or state['User']!=role or state['Group']!=role or state['WorkingDirectory']!=str(helper.ROOT/'apps/yunipals-indexer')or re.findall(r'argv\[\]=(.*?)\s+;',state['ExecStart'])!=[' '.join(expected)]):fail('exact_final_candidate_process_required')
 expected_definitions={**b['retainedOriginalDefinitionHashes'],target['dropIn']:a.sha(b['dropIn'].encode())}
 paths=definition(helper,unit)
 if paths!=list(expected_definitions)or file_hashes(a,paths)!=expected_definitions:fail('original_or_owned_final_definition_changed')
 old_files=old.ordered_files(b['retainedOriginalState']['EnvironmentFilesEntries'])
 if old.ordered_files(state['EnvironmentFilesEntries'])!=old_files+[(target['privateDatabaseOverlay'],False),(target['publicSelectorOverlay'],False)]:fail('final_private_selector_order_changed')
 check_files(a,b['privateFiles'])
 for path,text in [(target['privateDatabaseOverlay'],b['databaseOverlay']),(target['publicSelectorOverlay'],b['publicOverlay']),(target['dropIn'],b['dropIn'])]:
  if a.protected(Path(path))!=text.encode():fail('owned_final_input_changed')
 if not helper.peer_identity(role,b['peerIdentity'])['verified']:fail('actual_final_peer_identity_required')
 status=Path('/proc')/state['MainPID']/'status';lines=dict(x.split(':',1)for x in status.read_text().splitlines()if':'in x)
 if(any(int(lines[k],16)!=0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])or lines['NoNewPrivs'].strip()!='1'or
  any(int(v)!=b['peerIdentity']['uid']for v in lines['Uid'].split())or any(int(v)!=b['peerIdentity']['gid']for v in lines['Gid'].split())or
  set(map(int,lines['Groups'].split()))-{b['peerIdentity']['gid']}):fail('actual_final_process_must_have_zero_capabilities')
 return state

def apply(a,p,old,owner,helper,frozen,scope,plan,expected):
 with a.lease():
  checked=review(a,p,old,owner,helper,frozen,scope,plan)
  if checked['reviewHash']!=expected:fail('exact_fresh_final_install_review_required')
  b=checked['binding'];role=b['role'];unit=b['target']['unit'];parent_directory(BASE,0o700);directory=BASE/role;directory.mkdir(mode=0o700);a.save(directory/'review.json',checked);invocation=None;error=None;phase='prepare_owned_files';created=[];login=False;requests=[]
  try:
   for path,text in [(b['target']['privateDatabaseOverlay'],b['databaseOverlay']),(b['target']['publicSelectorOverlay'],b['publicOverlay']),(b['target']['dropIn'],b['dropIn'])]:
    path=Path(path);parent_directory(path.parent,0o700 if path.parent==Path('/etc/yunipals-unified/consumers')else 0o755);write(a,path,text.encode(),0o600 if path.suffix=='.env'else 0o644);created.append(str(path))
   phase='owned_LOGIN';a.save(directory/'login-intent.json',{'role':role,'oid':b['roleOid']});login=True;after_login=p.role_sql(a,owner,helper,scope,frozen,b['before'],role,True);a.save(directory/'login-ack.json',{'login':True,'role':role})
   phase='single_owned_restart';a.save(directory/'start-requested.json',{'unit':unit,'beforeInvocationId':b['retainedOriginalState']['InvocationID'],'newDropInSha256':a.sha(b['dropIn'].encode())})
   helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15);helper.run(['/usr/bin/systemctl','restart',unit],timeout=70);invocation=helper.state(unit)['InvocationID']
   if not re.fullmatch('[0-9a-f]{32}',invocation)or invocation==b['retainedOriginalState']['InvocationID']:fail('fresh_actual_candidate_restart_ACK_required')
   a.save(directory/'start-ack.json',{'unit':unit,'invocation':invocation});phase='actual_positive_final_serving'
   for _ in range(30):
    try:verify_installed(a,helper,old,owner,b,invocation);break
    except RuntimeError:
     if helper.state(unit)['ActiveState']!='active':raise
     time.sleep(1)
   else:fail('actual_final_identity_not_ready')
   if role=='yunipals_unified_collector':
    a.owned_booster.candidate_started(unit,invocation,{**file_hashes(a,definition(helper,unit)),b['target']['privateDatabaseOverlay']:a.sha(b['databaseOverlay'].encode()),b['target']['publicSelectorOverlay']:a.sha(b['publicOverlay'].encode())})
   if plan['service']!='cache':
    port=helper.LIVE_PORTS[unit];paths,labels,owner_value=p.routes(owner,helper,plan['service']);deadline=time.monotonic()+90
    first='/ready?chain=base'if plan['service']=='collector'else'/health'
    for attempt in range(20):
     try:p.get_final(old,port,first,min(5,deadline-time.monotonic()));break
     except OSError:
      if time.monotonic()>=deadline:raise
      time.sleep(1.5)
    else:fail('bounded_final_listener_startup_failed')
    for path,label in zip(paths,labels):
     if time.monotonic()>=deadline:fail('bounded_final_positive_route_deadline')
     item,value=p.get_final(old,port,path,min(5,deadline-time.monotonic()));good=p.positive(plan['service'],path,item,value,scope['readView']['releaseId'],owner_value);requests.append({**item,'route':label,'positiveShape':good})
     if not good:fail('positive_final_retained_serving_required')
   if plan['service']=='main':
    fixture=b['actionFixture']or{};p.action_checks(a,old,helper.LIVE_PORTS[unit],{'actionFile':fixture.get('file'),'actionSha256':fixture.get('sha256')},scope,deadline,requests)
   verify_installed(a,helper,old,owner,b,invocation)
   if plan['service']=='main':
    reads=b['actionReadReceipt'];p.action_admission(a,owner,helper,frozen,scope,{'actionAclFile':reads['file'],'actionAclSha256':reads['sha256']},False)
   if plan['service']=='cache':
    phase='building_actual_v4_cache';wait_for_cache(a,old,owner,helper,b,invocation,directory)
   if a.capture(owner,scope,frozen)!=after_login or a.unchanged_common(owner,helper,frozen)!=b['common']:fail('final_role_graph_or_common_source_changed')
  except BaseException as e:error=a.failure(e)
  result={'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'reviewHash':expected,'reviewFileSha256':a.sha(a.protected(directory/'review.json')),'role':role,'roleOid':b['roleOid'],'unit':unit,'invocation':invocation,'applied':error is None,'phase':phase,'createdFiles':created,'loginAttempted':login,'loginChangedByThisOperator':login and not b['roleLoginBefore'],'roleLoginBefore':b['roleLoginBefore'],'ownedBoosterReader':b['ownedBoosterReader'],'requests':requests,'error':error,'installedDefinitionHashes':file_hashes(a,definition(helper,unit))if invocation else None,'sourceSelectionChanged':False,'automaticRetryAllowed':False,'rollbackRequired':error is not None,'fullFeatureLatencyAcceptanceClaimed':False,'cacheWaitResultSha256':a.sha(a.protected(directory/'cache-wait-result.json'))if os.path.lexists(directory/'cache-wait-result.json')else None}
  pin=a.save(directory/'result.json',result);return {'format':FORMAT,'applied':result['applied'],'role':role,'unit':unit,'invocation':invocation,'phase':phase,'error':error,'resultSha256':pin,'evidenceDirectory':str(directory)}

def rollback(a,p,old,owner,helper,frozen,scope,path,pin,expected=None):
 result=a.document(path,pin);checked=a.document(Path(path).parent/'review.json',result['reviewFileSha256']);b=checked['binding'];unit=b['target']['unit'];role=b['role']
 if result.get('format')!=FORMAT or result.get('operatorSha256')!=a.sha(a.protected(Path(__file__).absolute()))or checked['reviewHash']!=a.sha(a.encoded(b)):fail('owned_final_install_result_required')
 for name,text in [(b['target']['dropIn'],b['dropIn']),(b['target']['publicSelectorOverlay'],b['publicOverlay']),(b['target']['privateDatabaseOverlay'],b['databaseOverlay'])]:
  if name in result['createdFiles']and a.protected(Path(name))!=text.encode():fail('refuse_changed_owned_final_input')
 check_files(a,b['privateFiles']);now=helper.state(unit)
 if role!='yunipals_unified_collector'and os.path.lexists(BASE/'yunipals_unified_collector'):
  installed_other(a,helper,'yunipals-collector-api.service','yunipals_unified_collector',73187672)
 if role=='yunipals_unified_collector'and result['invocation']and now.get('InvocationID')==result['invocation']:
  verify_installed(a,helper,old,owner,b,result['invocation'])
  a.owned_booster.candidate_started(unit,result['invocation'],{**file_hashes(a,definition(helper,unit)),b['target']['privateDatabaseOverlay']:a.sha(b['databaseOverlay'].encode()),b['target']['publicSelectorOverlay']:a.sha(b['publicOverlay'].encode())})
 if result['invocation']is None or now['InvocationID']!=result['invocation']:fail('unacknowledged_or_foreign_final_actor_requires_manual_reconcile')
 owned_feature=a.owned_booster.ensure()
 marker=a.sha(a.encoded({'installResultSha256':pin,'unit':unit,'invocation':now['InvocationID'],'originalDefinitions':b['retainedOriginalDefinitionHashes'],'ownedBoosterReader':owned_feature}))
 if expected is None:return {'format':FORMAT,'rollbackReviewHash':marker,'unit':unit,'rollbackApplied':False}
 if marker!=expected:fail('exact_fresh_rollback_review_required')
 with a.lease():
  if a.owned_booster.ensure()!=owned_feature:fail('fresh_owned_API_identity_required_before_inverse')
  if helper.state(unit)['InvocationID']!=result['invocation']or file_hashes(a,definition(helper,unit))!=result['installedDefinitionHashes']:fail('rollback_actor_or_definition_changed_after_review')
  a.save(Path(path).parent/'rollback-intent.json',{'installResultSha256':pin,'reviewHash':expected,'unit':unit,'invocation':result['invocation']})
  if role=='yunipals_unified_collector':a.owned_booster.candidate_stopping(unit)
  helper.run(['/usr/bin/systemctl','stop',unit],timeout=70)
  if helper.state(unit)['MainPID']!='0':fail('owned_candidate_not_stopped')
  for _ in range(15):
   if not a.session_count(owner,role):break
   time.sleep(1)
  if role=='yunipals_unified_collector':a.owned_booster.candidate_finished(unit)
  current=a.capture(owner,scope,frozen);a.validate_catalog(current,scope,frozen,allow_login=True);allowed=copy.deepcopy(b['before']);next(r for r in allowed['roles']if r['name']==role)['login']=True
  for r in current['roles']:
   if r['login']and r['name']!=role:
    other_unit=next(x['unit']for x in scope['units']if x['role']==r['name']);installed_other(a,helper,other_unit,r['name'],int(r['oid']));next(x for x in allowed['roles']if x['name']==r['name'])['login']=True
  if current!=allowed:fail('rollback_requires_unchanged_owned_ACL_and_role_graph')
  if next(r['login']for r in current['roles']if r['name']==role)is not b['roleLoginBefore']:
   p.role_sql(a,owner,helper,scope,frozen,current,role,b['roleLoginBefore'])
  for name in result['createdFiles']:Path(name).unlink()
  if file_hashes(a,b['retainedOriginalDefinitionHashes'])!=b['retainedOriginalDefinitionHashes']:fail('original_definition_changed')
  helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15);helper.run(['/usr/bin/systemctl','start',unit],timeout=70)
  restored=helper.state(unit)
  if not restored['MainPID'].isdigit()or restored['MainPID']=='0'or restored['ActiveState']!='active':fail('actual_original_unit_not_restored')
  outcome={'format':FORMAT,'rollbackApplied':True,'unit':unit,'roleRestoredNoLogin':not b['roleLoginBefore'],'roleStateRestored':True,'roleLoginAfter':b['roleLoginBefore'],'ownedBoosterReader':a.owned_booster.ensure(),'restoredInvocation':restored['InvocationID'],'operationalRowsChanged':False,'grantsRevoked':False,'installResultSha256':pin}
  pin=a.save(Path(path).parent/'rollback-result.json',outcome);return {**outcome,'rollbackResultSha256':pin}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--service',choices=list(SERVICES));parser.add_argument('--acl-file');parser.add_argument('--acl-sha');parser.add_argument('--preview-file');parser.add_argument('--preview-sha');parser.add_argument('--artifact-file',required=True);parser.add_argument('--artifact-sha',required=True);parser.add_argument('--apply');parser.add_argument('--rollback-file');parser.add_argument('--rollback-sha');args=parser.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_main_required')
 a,p,old,owner,helper,frozen,scope=modules(args.artifact_file,args.artifact_sha)
 if args.rollback_file:result=rollback(a,p,old,owner,helper,frozen,scope,args.rollback_file,args.rollback_sha,args.apply)
 else:
  if not args.service or not all([args.acl_file,args.acl_sha,args.preview_file,args.preview_sha]):fail('one_exact_service_and_protected_admission_receipts_required')
  plan={'service':args.service,'aclFile':args.acl_file,'aclSha256':args.acl_sha,'previewFile':args.preview_file,'previewSha256':args.preview_sha,'artifactFile':args.artifact_file,'artifactSha256':args.artifact_sha}
  if args.apply:result=apply(a,p,old,owner,helper,frozen,scope,plan,args.apply)
  else:
   with a.lease():checked=review(a,p,old,owner,helper,frozen,scope,plan)
   result={'format':FORMAT,'reviewHash':checked['reviewHash'],'unit':SERVICES[args.service],'applied':False}
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
