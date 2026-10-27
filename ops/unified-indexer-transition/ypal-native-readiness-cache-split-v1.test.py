"""New phase contract controls; original Source/SQL/SDK observations are explicit I/O fixtures."""
import ast,copy,importlib.util,json
from pathlib import Path
import tempfile,types,unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
def load(name):
 s=importlib.util.spec_from_file_location(name,HERE/name);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
m=load('ypal-native-readiness-cache-split-v1.py');old=load('ypal-cache-guard-owner-v1.test.py');direct=load('ypal-native-readiness-direct-commit-v1.test.py');local=direct.gt.context_tests.local

def state(epoch='17'):
 return{'guards':[],'tables':[],'columnAcl':[],'acl':[],'functions':[],'triggers':[],
  'epochs':[{'collection':k,'revision':epoch}for k in ['base','bnb','ethereum','polygon']]}
def snapshot():
 return{'release':'actual-release-fixture','identity':'actual-read-identity-fixture','state':'ready','implementation':'actual-approved-code-fixture','errorCode':None,'frontier':'actual-event-frontier-fixture',
  'frameFrontier':'actual-event-frontier-fixture','probe':True,'nativeMode':True,'canonical':True}

class Controls(unittest.TestCase):
 def setUp(self):self.enterContext(patch.object(m,'public',side_effect=local))
 def context(self):
  c=m.Context.__new__(m.Context);c.original_plan=old.plan();c.original_plan_json=m.js_encoded(c.original_plan).decode();before,after=old.catalogs()
  c.before={'catalog':{'postProof':{'catalog':before,'allColumnAcl':[]}},'binding':{'prerequisites':{'actualFullMetadataFixture':True},'consumerFrame':{'actualPrivateConsumerFrameFixture':True}}}
  c.cache=types.SimpleNamespace(read_extension=old.m.read_extension);c.gates={};c.observations={};c.inputs=lambda:{'explicitImmutableInputIOFixture':True}
  c.preparation={'receiptSha256':'a'*64,'result':{'after':state('1')},'resultJson':'{"actualOriginalNodeReceiptFixture":true}'}
  c.verification={'fence':{'format':m.SQL_FORMAT+'-verification-fence','epochs':state()['epochs'],'approvalSemantic':{k:snapshot()[k]for k in m.SEMANTIC},'fullVerificationSha256':'b'*64}}
  return c,before,after

 def packet(self,c,stage,graph):
  plan=c.plan(stage);after=state();contract={'format':m.SQL_FORMAT+'-commit-boundary','phase':stage,'originalPlanSha256':m.sha(m.canonical(c.original_plan)),
   'catalogSha256':m.sha(m.canonical(c.catalog(after))),'epochs':after['epochs'],'fullHeldCallbackClaimed':False,'oldC54CommitClaimed':False}
  if stage=='activate-reads':contract.update(approval={'snapshot':snapshot(),'policyTTLSeconds':120,'literalACKReserveSeconds':5,'producerApprovalWrittenByThisGate':False,
   'ageNanoseconds':'1000000','queryNanoseconds':'1000','remainingNanoseconds':'119998999000','capturedMonotonicNanoseconds':'999999999999999999999'},
   verificationFenceSha256=m.sha(m.canonical(c.verification['fence'])))
  return plan,{'mode':'apply','event':'commit-prepared','xid':'17621038','planSha256':m.sha(m.canonical(plan)),'before':state(),'after':after,
   'postProof':{'phaseContract':contract,'catalog':graph,'allColumnAcl':[]}}

 def test_actual_complete_source_and_SQL_closed_before_any_child(self):
  m.authenticate();self.assertTrue(m.SQL_SOURCE_REVIEWED);self.assertEqual(m.RECONCILIATION_PRODUCER_SHA,'caea00d91f690822b5f042ec4fbf9547b74961060354f68c931e4f61538b497b')
  c,_,_=self.context()
  with patch.object(m,'SQL_SOURCE_REVIEWED',False):
   with self.assertRaisesRegex(RuntimeError,'reviewed_actual_two_phase'):c.sql_sources()
  self.assertEqual(m.encoded({})[-1],10);self.assertEqual(m.canonical({}),b'{}')

 def test_actual_phase_packet_full_original_READ_delta_and_clock_domains(self):
  c,before,after=self.context();saved=[];c.gates['prepare-guards']={'capturedMonotonicNanoseconds':0,'remainingNanoseconds':120_000_000_000}
  c.value=types.SimpleNamespace(check_deadline=lambda gate:None)
  with patch.object(m,'save',side_effect=lambda *args:saved.append(args)),patch.object(m.time,'monotonic',return_value=10):
   plan,packet=self.packet(c,'prepare-guards',before);c.packet(Path('/explicit/prep'),'prepare-guards',plan,packet);self.assertEqual(c.packet_deadline,15)
   plan,packet=self.packet(c,'activate-reads',after);c.packet(Path('/explicit/activate'),'activate-reads',plan,packet);self.assertEqual(c.packet_deadline,15)
   # Child hrtime is deliberately incomparable to parent seconds; no conversion
   # or shared origin is assumed. Actual child independently enforces its bound.
   self.assertEqual(len(saved),2)
   packet['postProof']['catalog']['roles'][0]['login']=False
   with self.assertRaises(RuntimeError):c.packet(Path('/explicit/activate'),'activate-reads',plan,packet)

 def test_canonical_false_semantic_epoch_or_old_whole_claim_refuses(self):
  for kind in ['canonical','frontier','epoch','whole']:
   c,_,after=self.context();plan,packet=self.packet(c,'activate-reads',after)
   if kind=='canonical':packet['postProof']['phaseContract']['approval']['snapshot']['canonical']=False
   if kind=='frontier':packet['postProof']['phaseContract']['approval']['snapshot']['frontier']='foreign'
   if kind=='epoch':packet['before']['epochs'][0]['revision']='18'
   if kind=='whole':packet['postProof']['phaseContract']['oldC54CommitClaimed']=True
   with self.subTest(kind=kind),patch.object(m,'save',side_effect=AssertionError('no ACK journal for refused packet')):
    with self.assertRaises(RuntimeError):c.packet(Path('/explicit/activate'),'activate-reads',plan,packet)

 def test_verification_executes_original_long_predicates_outside_SQL_and_binds_current_epochs(self):
  c,_,_=self.context();events=[];c.binding=lambda:{'actualOwnedBindingFixture':True};c.config={};c.input_sha='d'*64
  prep=copy.deepcopy(c.preparation);seen={'inspected':True,'databaseWrites':0,'state':state('17')};gate={'snapshot':snapshot()}
  def observe(host,mode):self.assertEqual(mode,'inspect');events.append('readonly-catalog');return copy.deepcopy(seen)
  c.transport=lambda area,stage:observe;c.session=types.SimpleNamespace(source=types.SimpleNamespace(current=lambda:events.append('full-source')or{'actualSourceProofFixture':True}),metadata_epoch=types.SimpleNamespace(binding=lambda:{'actualImmutableEpochFixture':True}))
  c.host=types.SimpleNamespace(h=object(),refresh=lambda:events.append('full-refresh'),prerequisites=lambda:events.append('full-prerequisites')or c.before['binding']['prerequisites'])
  c.cache.stopped=lambda host:events.append('actual-terminal-private');c.cache.legacy_http=lambda host,fallback:events.append('actual-legacy-HTTP')or{'actualHTTPFixture':True}
  c.host.read=types.SimpleNamespace(consumer_frame=lambda _:c.before['binding']['consumerFrame']);c.authority=types.SimpleNamespace(approval_snapshot=lambda host:copy.deepcopy(gate))
  with tempfile.TemporaryDirectory()as folder,patch.object(m,'BASE',Path(folder)),patch.object(m,'acknowledgement',return_value=prep),patch.object(m,'save',return_value='e'*64):
   value=c.verify()
  self.assertEqual(events,['readonly-catalog','full-source','actual-terminal-private','full-refresh','full-prerequisites','actual-legacy-HTTP','full-source','readonly-catalog'])
  self.assertEqual(value['fence']['epochs'],state('17')['epochs']);self.assertNotEqual(value['fence']['epochs'],prep['result']['after']['epochs'])
  self.assertEqual(value['fence']['fullVerificationSha256'],m.sha(m.canonical(value['full'])))

 def test_original_V6_parent_and_kernel_protocol_body_preserved_with_two_owned_hooks(self):
  owner=unittest.TestCase();self.addCleanup(owner.doCleanups);owner.enterContext(patch.object(direct.gt.m,'public',side_effect=local))
  session,family=direct.actual_session(owner);c=m.Context.__new__(m.Context);c.cache,c.host=session.cache,session.host;c.value=family.authority_context.value
  c.sql_sources=lambda:{'entrySha256':'a'*64,'driverSha256':'b'*64,'componentSha256':'c'*64,'manifestSha256':'d'*64}
  actual=c.transport(Path('/explicit/new-owned-area'),'prepare-guards');raw=c.value.original_parent_ast();counts=[0,0]
  for node in ast.walk(raw):
   for field,body in ast.iter_fields(node):
    if not isinstance(body,list):continue
    result=[]
    for item in body:
     if isinstance(item,ast.Assign)and isinstance(item.value,ast.Call)and ast.unparse(item.value.func)=='subprocess.Popen':result+=ast.parse('_split_launch(host,mode)').body;counts[0]+=1
     if isinstance(item,ast.Expr)and isinstance(item.value,ast.Call)and ast.unparse(item.value.func)=='proc.stdin.write'and any(isinstance(v,ast.Constant)and v.value=='commit-authorized'for v in ast.walk(item)):result+=ast.parse('deadline=min(deadline,_split_ack(host,mode))').body;counts[1]+=1
     result.append(item)
    setattr(node,field,result)
  expected=c.value.compiled_parent(raw,dict(session.cache._sql_child.__globals__),session.cache._sql_child.__defaults__,session.cache._sql_child.__closure__)
  self.assertEqual(counts,[1,1]);self.assertEqual(c.value.code_identity(actual.__code__),c.value.code_identity(expected.__code__))
  self.assertEqual(actual.__globals__['BASE'],Path('/explicit/new-owned-area'));self.assertEqual(actual.__globals__['ENTRY'],m.ENTRY)
  self.assertIn('openedSha256',str(actual.__code__.co_consts));self.assertIn('preparedSha256',str(actual.__code__.co_consts))

 def test_real_current_READ_and_Host_refresh_keep_complete_body_under_one_owned_receipt_branch(self):
  owner=unittest.TestCase();self.addCleanup(owner.doCleanups);owner.enterContext(patch.object(direct.gt.m,'public',side_effect=local))
  session,family=direct.actual_session(owner);c=m.Context.__new__(m.Context);c.cache,c.host=session.cache,session.host;c.family=family;c.value=family.authority_context.value
  c.binding=lambda:{'explicitOwnedActivatedBindingFixture':True};c.inputs=lambda:None
  original=c.cache.validate_reads.__globals__['current_reads_new'];refresh=c.host.refresh.__func__.__code__;validate=c.cache.validate_reads.__code__
  actual=c.current_reads_function();original_ast=ast.parse(local(m.OPS/'ypal-restored-read-cache-provider-v1.py'))
  fn=next(x for x in original_ast.body if isinstance(x,ast.FunctionDef)and x.name=='current_reads');counts={'catalog':0};fn=family.readiness.transform_catalog_node(fn,counts)
  branch=next(x for x in fn.body if isinstance(x,ast.If)and ast.unparse(x.test)=='cache_reads')
  self.assertEqual(counts,{'catalog':1});self.assertIn('saved',ast.unparse(branch))
  current=c.bind_host_current();self.assertEqual(c.host.refresh.__func__.__code__,refresh);self.assertEqual(c.cache.validate_reads.__code__,validate)
  self.assertIsNot(c.cache.validate_reads.__globals__['current_reads_new'],original);self.assertIs(c.cache.validate_reads.__globals__['current_reads_new'],current)
  with self.assertRaisesRegex(RuntimeError,'one_owned_split_current'):c.bind_host_current()

 def test_actual_sealed_public_FD_transport_launches_new_entry_and_exact_import_map(self):
  c=m.Context.__new__(m.Context);c.config={'sqlRefs':m.SQL_REFS};original=m.load
  def source(name):
   value=original(name)
   if name=='ypal-ordinary-cache-peer-v6.py':
    primitive=original('ypal-reader-peer-runtime-v1.py');primitive.public_bytes=local
    value.primitives=lambda:primitive
   return value
  with patch.object(m,'SQL_SOURCE_REVIEWED',True),patch.object(m,'load',side_effect=source):
   with c.peer_transport()as transport:
    self.assertEqual(transport.node_arguments()[-1],str(m.ENTRY))
    self.assertGreaterEqual(len(transport.pass_fds),4)
    import os,fcntl
    for fd in transport.pass_fds:
     self.assertTrue(fcntl.fcntl(fd,fcntl.F_GET_SEALS)&fcntl.F_SEAL_WRITE)
    descriptor=int(transport.environment['YUNIPALS_READER_PUBLIC_FD']);rows=json.loads(os.pread(descriptor,1000000,0))['files']
    self.assertEqual({row['name']for row in rows},{name for name in m.document(m.SQL_MANIFEST,m.SQL_REFS['manifestSha256'])['files']if name.endswith('.mjs')})
    for row in rows:self.assertEqual(m.sha(os.pread(row['fd'],row['bytes'],0)),row['sha256'])
   for fd in transport.pass_fds:
    with self.assertRaises(OSError):os.fstat(fd)

 def test_pure_consumer_uses_genuine_Host_and_Context_without_cache_target_session(self):
  owner=unittest.TestCase();self.addCleanup(owner.doCleanups);owner.enterContext(patch.object(direct.gt.m,'public',side_effect=local))
  session,family=direct.actual_session(owner);host,cache=session.host,session.cache
  before={'binding':{'config':host.config}};rehearsal={'sql':{'resultJson':m.js_encoded(old.plan()).decode()}}
  activation={'binding':{'format':m.FORMAT,'actualOwnedActivationFixture':True},'transactionId':'17621038'}
  cfg={'nativePolicyRefs':family.readiness.refs};inputsha='a'*64
  original=m.document
  with patch.object(m,'document',side_effect=lambda path,digest=None:cfg if Path(path)==m.INPUT else original(path,digest)),patch.object(m,'acknowledgement',return_value=activation),   patch.object(cache,'owned',return_value=(before,rehearsal)),patch.object(cache,'xact_status',return_value='committed'):
   current=m.bind_current(cache,host,inputsha,family.readiness)
   self.assertTrue(callable(current));self.assertEqual(host.native_readiness_split_current,activation['binding'])
   self.assertIs(m.bind_current(cache,host,inputsha,family.readiness),current)
   with patch.object(cache,'xact_status',return_value='aborted'):
    host2=type('ForeignHost',(),{'config':host.config,'cache':cache,'inverse_mode':False})()
    with self.assertRaises(RuntimeError):m.bind_current(cache,host2,inputsha,family.readiness)

 def test_pure_prepared_ACK_requires_exact_all_phase_and_verification_bindings(self):
  cfg={'actualSidecarFixture':True};input_sha=m.sha(m.encoded(cfg));binding={'inputSha256':input_sha,'actualConstructorScopeFixture':'one'}
  prep={'binding':copy.deepcopy(binding),'receiptSha256':'a'*64};activation={'binding':copy.deepcopy(binding),'receiptSha256':'b'*64,'sqlCommittedSha256':'c'*64}
  verification={'binding':copy.deepcopy(binding),'preparationReceiptSha256':prep['receiptSha256']}
  before={'binding':{'config':{'unchangedCacheConfigFixture':True}}};before_path=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026/before.json')
  data={m.INPUT:m.encoded(cfg),m.BASE/'verification.json':m.encoded(verification),before_path:m.encoded(before)}
  value={'format':m.FORMAT+'-prepared','prepared':True,'operatorSha256':m.sha(local(m.FILE)),'manifestSha256':m.sha(local(m.MANIFEST)),
   'binding':copy.deepcopy(binding),'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False,'nativeWorkerStarted':False,'nativeGenerationPublished':False,
   'preparationReceiptSha256':prep['receiptSha256'],'activationReceiptSha256':activation['receiptSha256'],'additionalReadAcknowledgementSha256':activation['sqlCommittedSha256'],
   'additionalReadCount':4,'verificationSha256':m.sha(data[m.BASE/'verification.json']),'originalBeforeFile':str(before_path),
   'beforeSha256':m.sha(data[before_path]),'config':before['binding']['config'],'originalProviderSha256':m.SOURCE_PINS['ypal-ordinary-read-cache-continue-v6.py']}
  data[m.BASE/'prepared.json']=m.encoded(value);prepared_sha=m.sha(data[m.BASE/'prepared.json'])
  def public(path,digest=None):
   raw=data.get(Path(path))
   if raw is None:return local(path,digest)
   if digest is not None and m.sha(raw)!=digest:raise RuntimeError('exact_actual_immutable_fixture_SHA_required')
   return raw
  with patch.object(m,'public',side_effect=public),patch.object(m,'acknowledgement',side_effect=lambda cfg,sha,stage:copy.deepcopy(prep if stage=='prepare-guards'else activation)):
   self.assertTrue(m.prepared_acknowledgement(prepared_sha,input_sha)['immutableAcknowledgementOnly'])
   for phase in [prep,activation]:
    original=phase['binding'];phase['binding']={**binding,'actualConstructorScopeFixture':'different-valid-scope'}
    try:
     with self.assertRaisesRegex(RuntimeError,'same_complete_owned_preparation'):m.prepared_acknowledgement(prepared_sha,input_sha)
    finally:phase['binding']=original

 def test_accept_fresh_already_bound_consumer_reuses_route_and_keeps_every_current_check(self):
  c,_,_=self.context();binding={'actualOwnedBindingFixture':True};c.binding=lambda:copy.deepcopy(binding);c.config={};c.input_sha='a'*64
  c.before['reviewHash']='b'*64;c.before['binding']['operatorSha256']=m.SOURCE_PINS['ypal-ordinary-read-cache-continue-v6.py'];events=[]
  c.host=types.SimpleNamespace(config={'actualUnchangedConfigFixture':True,'readAdmissionSha256':'e'*64},native_readiness_split_current=copy.deepcopy(binding),h=object(),
   refresh=lambda:events.append('refresh'),prerequisites=lambda:events.append('all-prerequisites')or c.before['binding']['prerequisites'])
  c.host.read=types.SimpleNamespace(consumer_frame=lambda _:events.append('private-consumer-frame')or c.before['binding']['consumerFrame'])
  c.cache.BASE=Path('/explicit/immutable-old-base');c.cache.stopped=lambda host:events.append('terminal-private')or(c.before,{}, {})
  c.cache.validate_reads=lambda host:events.append('whole-current-READ')or{'preservation':{'actualCompleteCurrentProofFixture':True}}
  c.cache.legacy_http=lambda host,fallback:events.append('all-legacy-HTTP')or{'actualHTTPFixture':True}
  c.bind_host_current=lambda:self.fail('must reuse actual already bound consumer, never bind twice')
  activation={'sqlCommittedSha256':'c'*64,'receiptSha256':'d'*64};saved={};original=local
  def public(path,digest=None):
   if Path(path).name in{'before.json','receipt.json','verification.json'}:return m.encoded({'actualOwnedImmutableIOFixture':str(path)})
   return original(path,digest)
  def save(area,name,value):saved[name]=copy.deepcopy(value);return m.sha(m.encoded(value))
  with patch.object(m,'public',side_effect=public),patch.object(m,'acknowledgement',return_value=activation),patch.object(m,'save',side_effect=save),patch.object(m.os.path,'lexists',return_value=False):
   value=c.accept()
  self.assertEqual(events,['terminal-private','whole-current-READ','refresh','all-prerequisites','private-consumer-frame','all-legacy-HTTP','private-consumer-frame'])
  self.assertTrue(value['prepared']);self.assertFalse(value['oldCachePreparedACKClaimed']);self.assertFalse(value['oldC54WholeValidatorPassed'])
  self.assertEqual(saved['prepared.json']['binding'],binding)

 def test_complete_Context_constructor_accepts_actual_recon_header_before_or_after_guard_prep_without_old_catalog(self):
  owner=unittest.TestCase();self.addCleanup(owner.doCleanups);owner.enterContext(patch.object(direct.gt.m,'public',side_effect=local))
  session,family=direct.actual_session(owner);cache,host=session.cache,session.host
  reconciliation=json.loads((HERE.parents[1]/'docs/unified-indexer/cont6-failed-cache-reconciliation2-production-2026-10-26.json').read_bytes())
  reconciliation.pop('resultSha256');recon_sha=m.sha(m.encoded(reconciliation))
  self.assertEqual(recon_sha,'85a2f77a7b2fd0b4d72a8694eb5a597577bcb6402ba4a2985b3b9ec30bc72398')
  cfg={'format':m.FORMAT+'-input','nativePolicyRefs':family.readiness.refs,'forwardAuthorityInputSha256':family.authority_context.input_sha,
   'forwardBaselineCapture':{'captureId':'cont6-baseline-20261026-4','resultSha256':'b'*64},'failedCommitRootSha256':'c'*64,
   'reconciliationRootSha256':recon_sha,'captureClassifierRefs':m.CLASSIFIER_REFS,'sqlRefs':m.SQL_REFS}
  before={'binding':{'config':host.config}};rehearsal={'sql':{'resultJson':m.js_encoded(old.plan()).decode()}}
  raw_before=m.encoded(before);failed={'completed':False,'commitInvoked':True,'commitReturned':False,'heldTestWaived':True,'automaticRetryAllowed':False}
  cfg['failedCommitRootSha256']=m.sha(m.encoded(failed));reconciliation=copy.deepcopy(reconciliation);reconciliation['failedCommitResultSha256']=cfg['failedCommitRootSha256']
  cfg['reconciliationRootSha256']=m.sha(m.encoded(reconciliation));input_sha=m.sha(m.encoded(cfg))
  files={m.INPUT:m.encoded(cfg),m.RECONCILIATION_ROOT:m.encoded(reconciliation),m.FAILED_ROOT:m.encoded(failed),cache.BASE/'before.json':raw_before}
  original=m.load;private_reads=[]
  def public(path,digest=None):
   path=Path(path)
   if path in files:
    raw=files[path]
    if digest is not None and m.sha(raw)!=digest:raise RuntimeError('actual_owned_constructor_fixture_hash_required')
    return raw
   if path.parent==m.RECONCILIATION_ROOT.parent:
    private_reads.append((path.name,digest));return b'explicit-authenticated-server-private-proof-IO-fixture'
   return local(path,digest)
  def source(name):
   if name=='ypal-native-metadata-approval-inverse-v3.py':
    def capture(actual):
     self.assertEqual(actual['upgradeRefs'],session.metadata_epoch.refs);self.assertEqual(actual['nativePolicyRefs'],family.readiness.refs)
     return{'result':{'beforeSha256':m.sha(raw_before)},'immutableForwardAncestryOnly':True}
    return types.SimpleNamespace(forward_capture=capture)
   return original(name)
  original_iter=Path.iterdir;original_lstat=Path.lstat
  fixture_dir=owner.enterContext(tempfile.TemporaryDirectory());fixture_before=Path(fixture_dir)/'before.json';fixture_before.write_bytes(raw_before);before_stat=fixture_before.lstat()
  def files_in(path):return iter([cache.BASE/'before.json'])if path==cache.BASE else original_iter(path)
  def file_stat(path):return before_stat if path==cache.BASE/'before.json'else original_lstat(path)
  with patch.object(m,'public',side_effect=public),patch.object(m,'load',side_effect=source),patch.object(cache,'stopped',return_value=(before,rehearsal,{})),   patch.object(cache,'document',return_value={'mode':'apply','xid':'17621037'}),patch.object(cache,'xact_status',return_value='aborted'),patch.object(cache,'child_gone')as terminal,   patch.object(Path,'iterdir',files_in),patch.object(Path,'lstat',file_stat),patch.object(family.authority_context.value,'original_catalog',side_effect=AssertionError('no old guard catalog success may be claimed')):
   first=m.Context(session,input_sha)
   # Projection-only DDL has no input to this ctor. No old transition catalogue
   # validator is invoked. Complete current READ/Source bodies run in verify().
   second=m.Context(session,input_sha)
  self.assertEqual(first.config,second.config);self.assertEqual(terminal.call_count,2);self.assertTrue(private_reads)

if __name__=='__main__':unittest.main()
