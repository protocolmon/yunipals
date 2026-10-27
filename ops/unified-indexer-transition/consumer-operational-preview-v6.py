#!/usr/bin/env python3
"""One readonly positive selected-source preview, restoring its exact prior LOGIN state."""
import argparse,copy,hashlib,json,os,re,socket,stat,time,types,urllib.error,urllib.request,urllib.parse
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-consumer-operational-preview-v6-20261022')
FORMAT='yunipals-consumer-operational-preview-v6'
ACL_SHA='f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d'
PREVIEW_SHA='f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c'
SERVICES={'main':('yunipals-api.service','yunipals_unified_api',9101),'collector':('yunipals-collector-api.service','yunipals_unified_collector',9112),'islands':('yunipals-islands-api.service','yunipals_unified_islands_api',9115)}
def fail(code):raise RuntimeError(code)
def modules(artifact_file,artifact_sha):
 path=OPS/'consumer-operational-owner-v6.py'
 for item in [*path.parents,path]:
  info=item.lstat()
  if stat.S_ISLNK(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:fail('protected_operational_owner_required')
 if not path.is_file()or path.stat().st_size>100000:fail('bounded_owner_required')
 raw=path.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=ACL_SHA:fail('frozen_operational_owner_changed')
 a=types.ModuleType('operational_acl');a.__file__=str(path);exec(compile(raw,str(path),'exec'),a.__dict__)
 owner,helper,frozen,scope=a.modules();p=a.load(OPS/'consumer-api-preview-v5.py',PREVIEW_SHA)
 runtime=a.load(OPS/'consumer-topic-runtime-v1.py','d064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc');helper=runtime.Runtime(a,helper,artifact_file,artifact_sha);scope=helper.scope(scope)
 view=a.load(OPS/'consumer-v4-read-runtime-v1.py','993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b');helper=view.Runtime(a,owner,helper);scope=helper.scope(scope);a=view.Catalog(a,helper)
 return a,owner,helper,frozen,scope,p

def witness(a,path,pin):
 v=a.document(path,pin);b=v.get('binding',{});s=v.get('acceptance',{})
 if(v.get('format')!='yunipals-fixed-boundary-witness-v1'or v.get('completed')is not True or v.get('legacyBaselineUnchanged')is not True or
  s.get('qualified')is not True or s.get('exactDataParityRecomputed')is not True or s.get('allSavedLegacyHashesMatched')is not True or
  b.get('plan',{}).get('sourceRoot')!='/opt/yunipals-unified/releases/008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'):
  fail('actual_fixed_boundary_data_and_canonical_qualification_required')
 return {'file':str(path),'sha256':pin,'qualification':s['qualification'],'legacyHashesNotRecorded':s['legacyHashesNotRecorded']}

def installed(a,helper,row):
 value=helper.check_current()
 if a.sha(a.protected(helper.ROOT/'apps/yunipals-indexer'/helper.ENTRYPOINTS[row['unit']]))!=row['proposed']['entrypointManifestSha256']or a.sha(a.protected(Path(helper.NODE),150000000))!='f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a':fail('accepted_final_consumer_entrypoint_changed')
 return {**value,'entrypointSha256':row['proposed']['entrypointManifestSha256']}

def input_fingerprints(a,p,selectors):
 rows=[]
 for name,optional in p.ordered_files(selectors):
  if optional and not os.path.lexists(name):rows.append({'path':name,'optional':True,'sha256':None})
  else:rows.append({'path':name,'optional':optional,'sha256':a.sha(a.protected(Path(name),4000000))})
 return rows

def review(a,owner,helper,frozen,scope,p,plan):
 if plan['service']not in SERVICES or not re.fullmatch(r'20261022-[a-z0-9-]{1,32}',plan['runId']):fail('fixed_service_and_fresh_run_required')
 receipt,saved,current=a.applied(owner,plan['aclFile'],plan['aclSha256'],scope,frozen)
 if receipt['phase']!='features'or receipt.get('rollback'):fail('complete_retained_feature_read_admission_required')
 a.validate_catalog(current,scope,frozen);unit,role,port=SERVICES[plan['service']];row=next(r for r in helper.matrix()['services']if r['unit']==unit)
 parity=witness(a,plan['witnessFile'],plan['witnessSha256']);runtime=installed(a,helper,row)
 state=helper.state(unit);public=helper.public_unit(row,state)
 if not all(public[k]for k in ['active','invocationId','knownPublicArgvMatches','knownWorkingDirectoryMatches','orderedEnvironmentSelectorsMatchBaseline','knownOsIdentityMatches']):fail('retained_selected_unit_changed')
 identity=helper.os_identity(role);catalog=helper.sql(helper.catalog_sql());room=helper.capacity(catalog['capacity'])
 if not identity['restricted']or not helper.hba_compatible(role,catalog)or not room['sequentialPreviewHeadroomObserved']:fail('dedicated_peer_identity_and_capacity_required')
 if any(helper.sockets()[str(v[2])]for v in SERVICES.values()):fail('sequential_preview_ports_must_be_free')
 directory=BASE/(plan['runId']+'-'+plan['service'])
 if os.path.lexists(directory)or p.own_state(helper,p.unit_name(plan))['LoadState']!='not-found':fail('fresh_preview_selector_required')
 env=p.environment(plan,helper,row)
 observed=next(r for r in scope['retainedSelectors']['services']if r['unit']==unit)
 if observed['invocationId']!=public['invocationId']or observed['orderedEnvironmentFileSelectors']!=state['EnvironmentFilesEntries']:fail('actual_retained_feature_observation_must_still_match')
 flags=observed['flags']
 for key,value in flags.items():
  if value is not None:env[key]=value
 if saved['binding']['mainCacheEnabled']and plan['service']=='main':env['YUNIPALS_READ_CACHE']='1'
 action=action_request(a,plan,scope)if plan['service']=='main'else None
 action_reads=action_admission(a,owner,helper,frozen,scope,plan)if action else None
 binding={'actionReadReceipt':action_reads,'actionFixture':{'file':plan['actionFile'],'sha256':plan['actionSha256'],'requestSha256':a.sha(a.encoded(action))}if action else None,'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'plan':plan,'aclAfterSha256':receipt['afterSha256'],'witness':parity,'runtime':runtime,'role':role,'roleOid':a.ROLES[role],'dedicatedOs':identity,'public':public,'definitions':p.definitions(helper,row),'selectors':state['EnvironmentFilesEntries'],'privateInputHashes':input_fingerprints(a,p,state['EnvironmentFilesEntries']),'environment':env,'before':current,'roleLoginBefore':next(r['login']for r in current['roles']if r['name']==role),'ownedBoosterReader':a.owned_booster.ensure(),'collectorPoolBudget':a.owned_booster.policy.collector_connection_budget()if role=='yunipals_unified_collector'else None,'common':a.unchanged_common(owner,helper,frozen)}
 return {'format':FORMAT,'reviewHash':a.sha(a.encoded(binding)),'binding':binding},row,directory

def role_sql(a,owner,helper,scope,frozen,before,role,enabled):
 after=copy.deepcopy(before);r=next(r for r in after['roles']if r['name']==role)
 if role=='yunipals_unified_collector':
  if enabled is not True or r['login']is not True:fail('owned_feature_collector_LOGIN_must_remain_true')
  a.owned_booster.ensure()
  if a.capture(owner,scope,frozen)!=before:fail('owned_noop_LOGIN_catalog_changed')
  return after
 if r['login']is enabled:fail('selected_role_not_in_exact_expected_login_state')
 r['login']=enabled;query=a.catalog_sql(scope,frozen);feature=a.owned_booster.sql_graph_guard();body=a.session_guard([role])+'\n'+feature+'\nIF ('+query+')IS DISTINCT FROM '+a.quoted(json.dumps(before,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'role_admission_catalog_changed';END IF;\nALTER ROLE "+role+(' LOGIN;'if enabled else' NOLOGIN;')+'\n'+feature+'\nIF ('+query+')IS DISTINCT FROM '+a.quoted(json.dumps(after,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'only_exact_owned_LOGIN_change_allowed';END IF;"
 tag='$role_'+a.sha(body.encode())[:16]+'$'
 if tag in body:fail('inert_login_SQL_required')
 text="BEGIN;SET LOCAL search_path=pg_catalog;SET LOCAL standard_conforming_strings=on;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='1500ms';SELECT pg_advisory_xact_lock(178858,9062);DO "+tag+' BEGIN\n'+body+'\nEND '+tag+';COMMIT;'
 owner.sql(text,write=True)
 if a.capture(owner,scope,frozen)!=after:fail('actual_login_postcheck_changed')
 return after

def http_get(p,port,path,seconds,ports):
 if seconds<=0:fail('positive_HTTP_deadline_required')
 if port not in ports or not path.startswith('/')or'\r'in path or'\n'in path:fail('fixed_loopback_GET_required')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),p.NoRedirect());request=urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers={'accept':'application/json'},method='GET');started=time.monotonic()
 try:r=opener.open(request,timeout=min(5,seconds))
 except urllib.error.HTTPError as e:r=e
 with r:
  raw=r.read(1000001)
  if len(raw)>1000000:fail('bounded_response_required')
  try:value=json.loads(raw)
  except(ValueError,UnicodeError):value=None
  return {'status':r.code,'bytes':len(raw),'sha256':p.sha(raw),'releaseHeader':r.headers.get('X-Indexer-Release'),'elapsedMs':round((time.monotonic()-started)*1000,2)},value

def get(p,port,path,seconds):return http_get(p,port,path,seconds,{v[2]for v in SERVICES.values()})
def get_final(p,port,path,seconds):return http_get(p,port,path,seconds,{9011,9012,9015})

def positive(service,path,item,value,release,owner=None):
 if item['status']!=200 or not isinstance(value,dict)or'error'in value:return False
 solana='chain=solana'in path or path=='/v1/indexer/status'
 if not solana and item['releaseHeader']!=release:return False
 if path in {'/health','/ready?chain=base','/ready'}:return path=='/health'or value.get('ready')is True or value.get('status')=='ready'
 if '/staking-status'in path:return value.get('enabled')is True and value.get('ready')is True
 if path=='/v1/indexer/status':return value.get('evm',{}).get('available')is True and value['evm'].get('releaseId')==release and value.get('solana',{}).get('available')is True and value['solana'].get('enabled')is True
 if path.startswith('/legacy-meta/meta?'):return bool(value.get('name'))and bool(value.get('image'))
 items=value.get('items')
 if not isinstance(items,list)or not items or not all(isinstance(r,dict)for r in items):return False
 if path.startswith('/v1/traits'):return value.get('chain')=='base'and all(isinstance(r.get('traitType'),str)for r in items)
 if path.startswith('/v1/leaderboards/'):return value.get('chain')=='base'and all(re.fullmatch('0x[0-9a-fA-F]{40}',str(r.get('owner','')))for r in items)
 if 'chain=solana'in path:return value.get('chain')=='solana'and value.get('historyMode')=='observed_changes'and bool(value.get('ownershipObservedAt'))
 if path.startswith('/v1/owners/'):return value.get('chain')=='ethereum'
 if service=='collector':return value.get('chain')=='base'and str(value.get('owner','')).lower()==owner
 try:total=int(value.get('total',0))
 except(TypeError,ValueError):return False
 return total>0 and(service!='main'or value.get('chain')=='base')

def routes(owner,helper,service):
 owner_value=None
 if service=='collector':
  selected=owner.json_sql("SELECT jsonb_build_object('owner',t.owner,'color',f.value)FROM "+helper.READ_SCHEMA+".token t JOIN metadata_projection.trait f ON f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle AND f.generation_id=(SELECT current_id FROM metadata_projection.active WHERE singleton)WHERE t.collection='base'AND NOT t.burned AND f.trait_type='Color'AND NOT EXISTS(SELECT 1 FROM metadata.token_visibility v WHERE v.collection=t.collection AND v.token_id=t.token_id::numeric)LIMIT 1")
  owner_value=selected.get('owner')
  if not isinstance(owner_value,str)or not re.fullmatch('0x[0-9a-fA-F]{40}',owner_value):fail('actual_nonempty_Base_owner_required')
  owner_value=owner_value.lower()
 paths={'main':['/ready','/v1/tokens?chain=base&limit=1&metadata=all','/v1/traits?chain=base','/v1/leaderboards/total-rarity?chain=base&limit=1','/v1/tokens?chain=solana&limit=1&metadata=all','/v1/indexer/status'],
  'collector':['/ready?chain=base','/v2/owners/'+str(owner_value)+'/tokens?chain=base&limit=1'],
  'islands':['/ready','/v2/collections/base-islands-v2/tokens?limit=1','/v2/collections/ethereum-islands/staking-status']}[service]
 if service=='main':
  selected=owner.json_sql("SELECT jsonb_build_object('alias',(SELECT alias FROM metadata_source.lookup_alias WHERE namespace='legacy-meta'AND alias~'^[0-9]{1,78}$'LIMIT 1),'ens',(SELECT e.name FROM metadata.ens_identity e JOIN "+helper.READ_SCHEMA+".token t ON t.owner=e.address AND t.collection='ethereum'AND NOT t.burned WHERE e.verified AND e.chain_id=1 LIMIT 1))")
  if not isinstance(selected.get('alias'),str)or not re.fullmatch('[0-9]{1,78}',selected['alias'])or not isinstance(selected.get('ens'),str)or not re.fullmatch('[a-z0-9.-]{1,255}',selected['ens']):fail('actual_legacy_alias_and_verified_owned_ENS_fixture_required')
  paths+=['/legacy-meta/meta?id='+selected['alias'],'/v1/owners/'+selected['ens']+'/tokens?chain=ethereum&limit=1']
 if service=='collector':
  color=selected.get('color')
  if not isinstance(color,str)or not 1<=len(color)<=80:fail('actual_owned_Color_filter_fixture_required')
  paths.append(paths[-1]+'&'+urllib.parse.urlencode({'t.Color':color}))
 labels={'main':['ready','tokens_base','traits_base','leaderboard_base_ENS_join','tokens_solana','project_indexer_status','legacy_metadata','ENS_owner_tokens'],
  'collector':['ready','wallet_tokens','wallet_Color_filter'],'islands':['ready','Base_Islands_tokens','Ethereum_staking_status']}[service]
 return paths,labels,owner_value

ACTION_ACL_FILE='/var/backups/yunipals-consumer-action-reads-v2-20261021/apply-/ea70e9da19134652f1b43832d9e89a9f39d0d179a8074bf4a64da37626994a4e/result.json'
ACTION_ACL_SHA='06408abd4c435979747b3a035e20ea8544cd9f4b2f40a86fa3ec28a69c663608'
def action_admission(a,owner,helper,frozen,scope,plan,strict_catalog=True):
 if plan.get('actionAclFile')!=ACTION_ACL_FILE or plan.get('actionAclSha256')!=ACTION_ACL_SHA:fail('actual_committed_two_read_receipt_required')
 module=a.load(OPS/'consumer-action-read-owner-v2.py','7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f')
 receipt,saved=module.acknowledged(a,plan['actionAclFile'],plan['actionAclSha256'])
 if receipt.get('rollback')or receipt.get('selectBindings')!=2 or receipt.get('loginChanged')is not False or receipt.get('dmlGranted')is not False:fail('actual_only_two_read_admission_required')
 full=module.expanded(scope);current=a.capture(owner,full,frozen);a.validate_catalog(current,full,frozen,allow_login=not strict_catalog)
 wanted=[r for r in saved['binding']['after']['objects']if r['kind']=='relation'and r['name']in module.RELATIONS]
 actual=[r for r in current['objects']if r['kind']=='relation'and r['name']in module.RELATIONS]
 if len(wanted)!=2 or actual!=wanted or strict_catalog and current!=a.accepted_history(owner,saved['binding']['after']):fail('committed_action_read_graph_changed')
 return {'file':plan['actionAclFile'],'sha256':plan['actionAclSha256'],'operatorSha256':'7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f','selectBindings':2}

ACTION_PATH='/v1/indexer/action-evidence'
def action_request(a,plan,scope):
 if not plan.get('actionFile')or not plan.get('actionSha256'):fail('protected_actual_known_bnb_action_required')
 v=a.document(plan['actionFile'],plan['actionSha256']);r=v.get('request',{});act=r.get('action',{})
 if set(v)!={'format','request'}or v['format']!='yunipals-consumer-known-bnb-action-v1'or set(r)!={'version','releaseId','readIdentity','chainId','transactionHash','blockNumber','blockHash','action'}or r['version']!=1 or type(r['version'])is not int or type(r['chainId'])is not int or r['chainId']!=56 or r['releaseId']!=scope['readView']['releaseId']or r['readIdentity']!=scope['readView']['identity']or not re.fullmatch('0|[1-9][0-9]{0,77}',str(r['blockNumber']))or not isinstance(r['blockNumber'],str):fail('exact_selected_bnb_action_fixture_required')
 if set(act)!={'kind','orderHash','offerer'}or act['kind']not in {'bnb-validate','bnb-cancel'}or not re.fullmatch('0x[0-9a-f]{40}',str(act['offerer']))or any(not re.fullmatch('0x[0-9a-f]{64}',str(x))for x in [r['transactionHash'],r['blockHash'],act['orderHash']]):fail('actual_bnb_action_shape_required')
 return r

def action_selection(value,release,identity,manifest,build):
 return isinstance(value,dict)and value.get('version')==1 and value.get('identity')=={'releaseId':release,'readIdentity':identity,'manifestHash':manifest,'buildId':build}and set(value.get('supportedActions',[]))=={'bnb-validate','bnb-cancel','booster-request-created'}

def action_positive(a,value,request,selection):
 if not isinstance(value,dict):return False
 proof=value.get('proof')or{};events=proof.get('events')or[];coverage=value.get('coverage')or{}
 return (value.get('version')==1 and value.get('state')=='indexed'and value.get('reason')=='action_indexed'and value.get('expectationHash')=='0x'+a.sha(a.encoded(request))and value.get('identity')==selection['identity']and value.get('transaction')=={'chainId':56,'hash':request['transactionHash'],'blockNumber':request['blockNumber'],'blockHash':request['blockHash']}and
  coverage.get('sourceId')=='marketplace:bnb:seaport'and coverage.get('policy')=='latest'and proof.get('kind')=='canonical_event_and_full_receipt'and proof.get('receiptRequirement')=='full'and re.fullmatch('0x[0-9a-f]{64}',str(proof.get('receiptPayloadHash','')))is not None and 1<=len(events)<=256 and all(isinstance(e,dict)and e.get('name')==('OrderValidated'if request['action']['kind']=='bnb-validate'else'OrderCancelled')and type(e.get('logIndex'))is int and e['logIndex']>=0 for e in events)and value.get('application')=={'state':'not_evaluated','component':'marketplace'})

def action_checks(a,p,port,plan,scope,deadline,attempts):
 request=action_request(a,plan,scope)
 item,selection=http_get(p,port,ACTION_PATH,deadline-time.monotonic(),{9101,9011});view=scope['readView'];good=item['releaseHeader']==view['releaseId']and item['status']==200 and action_selection(selection,view['releaseId'],view['identity'],view['manifestHash'],view['buildId'])
 attempts.append({**item,'route':'action_selection','positiveShape':good,'method':'GET'})
 if not good:fail('positive_selected_action_identity_required')
 if len(attempts)>=30 or time.monotonic()>=deadline:fail('bounded_action_request_deadline')
 raw=a.encoded(request)
 if len(raw)>8192:fail('bounded_action_request_body_required')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),p.NoRedirect());req=urllib.request.Request('http://127.0.0.1:'+str(port)+ACTION_PATH,data=raw,headers={'accept':'application/json','content-type':'application/json'},method='POST');started=time.monotonic()
 try:response=opener.open(req,timeout=min(5,deadline-started))
 except urllib.error.HTTPError as e:response=e
 with response:
  body=response.read(1000001)
  if len(body)>1000000:fail('bounded_response_required')
  try:value=json.loads(body)
  except(ValueError,UnicodeError):value=None
  good=response.code==200 and response.headers.get('X-Indexer-Release')==view['releaseId']and action_positive(a,value,request,selection)
  attempts.append({'status':response.code,'bytes':len(body),'sha256':a.sha(body),'releaseHeader':response.headers.get('X-Indexer-Release'),'elapsedMs':round((time.monotonic()-started)*1000,2),'route':'known_bnb_action','method':'POST','requestSha256':a.sha(raw),'positiveShape':bool(good),'applicationVerified':False})
 if not good:fail('actual_indexed_bnb_action_with_full_receipt_required')

def stop_owned(a,p,helper,plan,invocation,hash_value,unit_file,content):
 current=p.own_state(helper,p.unit_name(plan))
 if a.protected(unit_file,20000)!=content.encode()or current['Description']!=p.marker(hash_value):fail('refuse_changed_preview_owner')
 if current['InvocationID']!=invocation:
  if current['InvocationID']or current['ActiveState']not in {'inactive','failed'}or current['MainPID']!='0':fail('refuse_foreign_preview_invocation')
 elif current['ActiveState']not in {'inactive','failed'}:helper.run(['/usr/bin/systemctl','stop',p.unit_name(plan)],timeout=15)
 if p.own_state(helper,p.unit_name(plan))['MainPID']!='0':fail('owned_preview_not_stopped')
 unit_file.unlink();helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15)

def run(a,owner,helper,frozen,scope,p,plan,expected):
 with a.lease():
  checked,row,directory=review(a,owner,helper,frozen,scope,p,plan)
  if checked['reviewHash']!=expected:fail('exact_fresh_preview_review_required')
  BASE.mkdir(mode=0o700,exist_ok=True)
  if BASE.is_symlink()or BASE.stat().st_uid!=0 or BASE.stat().st_mode&0o077:fail('private_preview_evidence_required')
  directory.mkdir(mode=0o700);a.save(directory/'review.json',checked);b=checked['binding'];role=b['role'];port=SERVICES[plan['service']][2]
  overlay=directory/'preview.env';raw=p.env_content(b['environment']).encode()
  with overlay.open('xb')as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
  content=p.unit_content(plan,helper,row,overlay,expected,b['selectors'])+'AmbientCapabilities=\nCapabilityBoundingSet=\n';unit_file=p.UNIT_DIRECTORY/p.unit_name(plan);enabled=False;created=False;invocation=None;error=None;cleanup=None;attempts=[];passed=False;started=time.monotonic()
  try:
   a.save(directory/'login-intent.json',{'role':role,'oid':a.ROLES[role],'enable':True});enabled=True
   after=role_sql(a,owner,helper,scope,frozen,b['before'],role,True);a.save(directory/'login-ack.json',{'role':role,'login':True})
   if not helper.peer_identity(role,b['dedicatedOs'])['verified']:fail('actual_restricted_peer_identity_required')
   with unit_file.open('x')as f:created=True;f.write(content)
   helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15);helper.run(['/usr/bin/systemctl','start',p.unit_name(plan)],timeout=10)
   invocation=p.own_state(helper,p.unit_name(plan))['InvocationID']
   if not re.fullmatch('[0-9a-f]{32}',invocation):fail('actual_preview_start_ACK_required')
   deadline=started+90
   first='/ready?chain=base'if plan['service']=='collector'else'/health'
   for n in range(18):
    if time.monotonic()>min(deadline,started+45):fail('bounded_preview_startup_expired')
    try:item,value=get(p,port,first,deadline-time.monotonic());attempts.append({**item,'route':'startup'});break
    except (OSError,urllib.error.URLError):time.sleep(1.5)
   else:fail('actual_preview_listener_unavailable')
   if role=='yunipals_unified_collector':
    p.verify_preview(plan,helper,row,invocation,expected,b['selectors'],overlay,raw)
    a.owned_booster.candidate_started(p.unit_name(plan),invocation,{str(unit_file):a.sha(content.encode()),str(overlay):a.sha(raw)})
   paths,labels,owner_value=routes(owner,helper,plan['service'])
   for index,path in enumerate(paths):
    if len(attempts)>=30 or time.monotonic()>=deadline:fail('preview_request_deadline_reached')
    item,value=get(p,port,path,deadline-time.monotonic());attempts.append({**item,'route':labels[index],'positiveShape':positive(plan['service'],path,item,value,scope['readView']['releaseId'],owner_value)})
    if not attempts[-1]['positiveShape']:fail('positive_selected_data_response_required')
    p.verify_preview(plan,helper,row,invocation,expected,b['selectors'],overlay,raw)
   if plan['service']=='main':
    action_checks(a,p,port,plan,scope,deadline,attempts);p.verify_preview(plan,helper,row,invocation,expected,b['selectors'],overlay,raw)
   if p.definitions(helper,row)!=b['definitions']or helper.public_unit(row,helper.state(row['unit']))!=b['public']or input_fingerprints(a,p,b['selectors'])!=b['privateInputHashes']or a.unchanged_common(owner,helper,frozen)!=b['common']:fail('retained_service_or_source_changed')
   passed=True
  except BaseException as e:error=a.failure(e)
  finally:
   try:
    if created:
     if role=='yunipals_unified_collector':a.owned_booster.candidate_stopping(p.unit_name(plan))
     stop_owned(a,p,helper,plan,invocation,expected,unit_file,content)
   except BaseException as e:cleanup=type(e).__name__
   try:
    if enabled:
     for _ in range(15):
      if not a.session_count(owner,role):break
      time.sleep(1)
     if role=='yunipals_unified_collector':a.owned_booster.candidate_finished(p.unit_name(plan))
     current=a.capture(owner,scope,frozen);row_role=next(r for r in current['roles']if r['name']==role)
     if row_role['login']is not b['roleLoginBefore']:role_sql(a,owner,helper,scope,frozen,current,role,b['roleLoginBefore'])
     if a.capture(owner,scope,frozen)!=b['before']:fail('exact_preview_role_ACL_restore_required')
   except BaseException as e:cleanup=type(e).__name__
   result={'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'reviewHash':expected,'aclResultSha256':plan['aclSha256'],'witness':b['witness'],'service':plan['service'],'artifactFile':plan['artifactFile'],'artifactSha256':plan['artifactSha256'],'actionReadReceipt':b['actionReadReceipt'],'actionFixture':b['actionFixture'],'runtime':b['runtime'],'role':role,'roleOid':a.ROLES[role],'previewUnit':p.unit_name(plan),'invocation':invocation,'requests':attempts,'elapsedSeconds':round(time.monotonic()-started,3),'positiveSelectedServing':passed and error is None and cleanup is None,'roleRestoredNoLogin':cleanup is None and not b['roleLoginBefore'],'roleStateRestored':cleanup is None,'roleLoginBefore':b['roleLoginBefore'],'roleLoginAfter':b['roleLoginBefore']if cleanup is None else None,'loginChangedByThisOperator':enabled and not b['roleLoginBefore'],'ownedBoosterReader':b['ownedBoosterReader'],'error':error,'cleanupError':cleanup,'databaseDmlAllowed':False,'sourceSelectionChanged':False,'responseRowsExported':False,'productionLatencyAccepted':False}
   pin=a.save(directory/'result.json',result)
  return {'format':FORMAT,'positiveSelectedServing':result['positiveSelectedServing'],'roleRestoredNoLogin':result['roleRestoredNoLogin'],'roleStateRestored':result['roleStateRestored'],'roleLoginBefore':result['roleLoginBefore'],'roleLoginAfter':result['roleLoginAfter'],'evidenceDirectory':str(directory),'resultSha256':pin,'error':error,'cleanupError':cleanup}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--service',choices=list(SERVICES),required=True);p.add_argument('--run-id',required=True);p.add_argument('--acl-file',required=True);p.add_argument('--acl-sha',required=True);p.add_argument('--witness-file',required=True);p.add_argument('--witness-sha',required=True);p.add_argument('--artifact-file',required=True);p.add_argument('--artifact-sha',required=True);p.add_argument('--action-acl-file',default=ACTION_ACL_FILE);p.add_argument('--action-acl-sha',default=ACTION_ACL_SHA);p.add_argument('--action-file');p.add_argument('--action-sha');p.add_argument('--apply');args=p.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_main_required')
 a,owner,helper,frozen,scope,old=modules(args.artifact_file,args.artifact_sha);plan={'service':args.service,'runId':args.run_id,'aclFile':args.acl_file,'aclSha256':args.acl_sha,'witnessFile':args.witness_file,'witnessSha256':args.witness_sha,'artifactFile':args.artifact_file,'artifactSha256':args.artifact_sha,'actionFile':args.action_file,'actionSha256':args.action_sha,'actionAclFile':args.action_acl_file,'actionAclSha256':args.action_acl_sha}
 if args.apply:result=run(a,owner,helper,frozen,scope,old,plan,args.apply)
 else:
  with a.lease():checked,_,_=review(a,owner,helper,frozen,scope,old,plan)
  result={'format':FORMAT,'reviewHash':checked['reviewHash'],'service':args.service,'started':False}
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
