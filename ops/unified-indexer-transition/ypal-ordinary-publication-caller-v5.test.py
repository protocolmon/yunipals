"""Publication factory/current-source integration; no production or SQL effects."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).parent.resolve()
def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-publication-caller-v5.py')


class Controls(unittest.TestCase):
 def active(self,inverse):
  fixture=load('ypal-ordinary-source-authority-v1.test.py');g=fixture.m
  a,native,calls=fixture.Controls().guard();a.binding.update(runtimeReceiptSha256='1'*64,runtimeInputSha256='2'*64,sourceActorQualified=True)
  if inverse:
   with patch.object(g,'public',return_value=(HERE/m.GUARD.name).read_bytes()):cls=m.inverse_active_authority(g)
   a.__class__=cls
  phase=object.__new__(m.SourcePhase);phase.refs={'resultSha256':'1'*64,'inputSha256':'2'*64};phase.inverse=inverse;phase.g=g
  phase.authority=a;phase.prepared=True;phase.kind='inverse-active'if inverse else'forward-active'
  return phase,native,g
 def test_actual_forward_and_inverse_active_predicates_are_distinct_no_terminal_claim(self):
  forward,native,g=self.active(False)
  with patch.object(g,'financial_current',return_value={}):
   self.assertTrue(forward.current()['currentWriterQualified'])
   with self.assertRaisesRegex(RuntimeError,'explicit_inverse_session'):forward.current(True)
   native['app']['is_ready']=0
   with self.assertRaisesRegex(RuntimeError,'fresh_live_ready'):forward.current()
  inverse,native,g=self.active(True);native['app']['is_ready']=0
  with patch.object(g,'financial_current',return_value={}):
   value=inverse.current(True);self.assertTrue(value['inverseActiveOnly']);self.assertTrue(value['currentWriterQualified'])
   self.assertEqual(inverse.authority.last_observation['native']['app']['is_ready'],0);self.assertNotIn('frameworkReadyAtCapture',value)
   self.assertFalse(value['terminalInverseOnly']);self.assertEqual(value['operatorSha256'],m.own_sha())
   native['schemaOid']='foreign'
   with self.assertRaises(RuntimeError):inverse.current(True)
   with self.assertRaisesRegex(RuntimeError,'cannot_dispatch_a_forward'):inverse.current(False)
 def test_genuine_3bf_terminal_body_requires_actual_stop_journal_and_current_terminal_proof(self):
  runtime=load('ypal-alchemy-ordinary-runtime-v1.py');o=object.__new__(runtime.Owner);calls=[];stopped=[True];escaped=[False]
  o.has=lambda name:False;o.digest=lambda name:'1'*64
  def journal(name):
   if name=='source-stopped.json':
    if not stopped[0]:raise RuntimeError('actual_owned_stop_ACK_missing')
    calls.append('actual-stop-ack');return{'sourceProcessesTerminal':True}
   return{'mode':'paid'}
  o.journal=journal;o.static=lambda:calls.append('static');o.retired_current=lambda:calls.append('retired');o.loaded_source=lambda mode:calls.append('loaded-'+mode);o.known_source=lambda:[{'pid':101,'startTicks':20}]
  def terminal(*args):
   calls.append('terminal-kernel')
   if escaped[0]:raise RuntimeError('escaped_owned_process_or_backend')
  o.terminal=terminal;o.record=lambda **values:{'inputSha256':'2'*64,**values}
  data={'sourceRelease':'release','manifestHash':'manifest','schema':'native','schemaOid':'75963410','buildId':'71e2a7f3b7'}
  native={'schemaOid':data['schemaOid'],'tables':{'actual44':'identity'},'cache':{'actual':'cache'},'app':{'build_id':data['buildId']}}
  o.h=types.SimpleNamespace(source=types.SimpleNamespace(native=lambda:native,query=lambda _:None));o.original={'native':native}
  p=object.__new__(m.SourcePhase);p.inverse=True;p.owner=o;p.refs={'resultSha256':'1'*64,'inputSha256':'2'*64};p.g=types.SimpleNamespace(RUNTIME_SHA=runtime.own_sha())
  p.authority=types.SimpleNamespace(intake=types.SimpleNamespace(DATA=data,registration=lambda _:calls.append('registered12')))
  p.prepared=True;p.kind='inverse-owned-terminal'
  value=p.current(True);self.assertTrue(value['terminalInverseOnly']);self.assertFalse(value['currentWriterQualified']);self.assertFalse(value['sourceActorQualified'])
  self.assertIn('actual-stop-ack',calls);self.assertIn('terminal-kernel',calls);self.assertEqual(value['schemaOid'],data['schemaOid'])
  escaped[0]=True
  with self.assertRaisesRegex(RuntimeError,'escaped'):p.current(True)
  escaped[0]=False;stopped[0]=False
  with self.assertRaisesRegex(RuntimeError,'stop_ACK_missing'):p.current(True)
  with self.assertRaisesRegex(RuntimeError,'terminal_source_is_inverse_only'):p.current(False)
 def test_real_387c_factory_receives_typed_dispatch_and_retains_commit_inverse_bodies(self):
  test=load('ypal-ordinary-read-cache-v5.test.py');entry=types.SimpleNamespace(**test.m.__dict__);calls=[]
  data=load('ypal-alchemy-ordinary-consumer-context-v1.py').DATA
  def current(inverse=False):calls.append(inverse);return{'validated':True,**data,'currentWriterQualified':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
  factory=types.FunctionType(test.m.namespace.__code__,entry.__dict__,test.m.namespace.__name__,test.m.namespace.__defaults__)
  entry.namespace=lambda config:factory(config,source_guard=current)
  fixture=types.FunctionType(test.namespace.__code__,{**test.namespace.__globals__,'m':entry},test.namespace.__name__,test.namespace.__defaults__)
  n=fixture();runtime=n.cache_runtime();original=load('ypal-cache-guard-owner-v1.py')
  for name in['commit','inverse','reconcile_commit','reconcile_inverse','drain']:
   self.assertEqual(getattr(runtime,name).__code__.co_code,getattr(original,name).__code__.co_code)
  source=next(cell.cell_contents for cell in n.static_read_host.__closure__ if callable(cell.cell_contents)and getattr(cell.cell_contents,'__name__','')=='source_current')
  with patch.object(test.c,'intake',return_value=types.SimpleNamespace(DATA=data)):
   source(False);source(True);self.assertEqual(calls,[False,True])
 def test_proof_subclass_changes_only_public_phase_constructor(self):
  calls=[];provider=object()
  class Original:
   def module_context(self,role):calls.append(role);return types.SimpleNamespace(__file__=str(m.PROVIDER))if role=='phase'else role
   def protected(self,path):return b'provider-fixture'
   def initialize(self,context,inputs):context.phase='original-complete-phase';context.inputs=inputs
  with patch.object(m,'sha',return_value=m.PROVIDER_SHA):
   Proof=m.bind_proof(Original,provider);proof=Proof();self.assertIs(proof.module_context('phase'),provider);self.assertEqual(proof.module_context('observer'),'observer')
  self.assertEqual(calls,['phase','observer']);self.assertFalse(hasattr(Original,'source_guard'))
 def test_preconstructed_metadata_runs_genuine_whole_business_body_and_fresh_refreshes(self):
  original=load('ypal-restored-metadata-handover-v1.py');calls=[];p={'readConfig':{'admissionSha256':'read'},'admission_ref':{'receiptSha256':'read'}}
  candidate={'readAdmissionSha256':'read','metadataOperationSha256':'operation'};selection={'selected':True,'nativeActor':{'actual':'actor'},'boot':{'actual':'boot'}}
  h=types.SimpleNamespace(admission_pin='read',actor=lambda *a:{'actual':'actor'},database=lambda:{'probe':True,'scan':{'ingestion_mode':'native'},'remainingPublished':0},
   publication_proof=lambda:{'allPublishedCanonical':True,'officialSqlSha256':'sql'},query=lambda sql:{'marker':'actual'},refresh=lambda:calls.append('live-refresh'),
   s=types.SimpleNamespace(document=lambda path:selection,protected=lambda path:b'actual-metadata-producer'))
  fn=original.metadata;globals={**fn.__globals__,'operation':lambda *a:{'actual':'op'},'link':lambda path:selection['boot']}
  n=types.SimpleNamespace(metadata=types.FunctionType(fn.__code__,globals,fn.__name__,fn.__defaults__))
  slot=object.__new__(m.PreparedMetadata);slot.n=n;slot.p=p;slot.host=h;slot.inverse=False;slot.sql='target';slot.target={'marker':'actual'};slot.paths=set();slot.records={}
  slot.g=types.SimpleNamespace(file_frame=lambda paths:{},read_data_identity=lambda value:value)
  refresh=lambda:None
  value=slot.invoke(candidate,refresh,selection);self.assertTrue(value['currentNativeMetadataQualified']);self.assertEqual(calls,['live-refresh','live-refresh'])
  h.database=lambda:{'probe':True,'scan':{'ingestion_mode':'native'},'remainingPublished':1}
  with self.assertRaisesRegex(RuntimeError,'full_published_provenance'):slot.invoke(candidate,refresh,selection)
  h.query=lambda sql:{'marker':'foreign'}
  with self.assertRaisesRegex(RuntimeError,'current_V5_marker'):slot.invoke(candidate,refresh,selection)
 def test_inverse_metadata_constructor_waits_for_actual_post_cache_prefix(self):
  calls=[];phase=types.SimpleNamespace(host=types.SimpleNamespace(config={'metadataInputSha256':'actual-input'}),generation=lambda:(None,{'actual':'candidate'},None,None))
  source=types.SimpleNamespace(inverse=True);proof=types.SimpleNamespace(pins={'ypal-ordinary-metadata-handover-v5.py':'actual-pin'},metadata_refresh=lambda *a:calls.append('actual-inverse-prefix'))
  guard=types.SimpleNamespace(module=lambda *a:types.SimpleNamespace(namespace=lambda pin:types.SimpleNamespace()))
  class Slot:
   def __init__(self,n,p,refresh,inverse,g):self.refresh=refresh;calls.append('construct-inverse-host');refresh()
   def invoke(self,*a):return{'inverseOnly':True}
  with patch.object(m,'PreparedMetadata',Slot):
   wrapped=m.ReaderPhase(phase,proof,object(),source,guard);self.assertEqual(calls,[])
   self.assertTrue(wrapped.metadata_inverse_context()['inverseOnly']);self.assertEqual(calls,['construct-inverse-host','actual-inverse-prefix'])
   wrapped.metadata_inverse_context();self.assertEqual(len(calls),2)
 def test_forward_reader_phase_dispatches_real_metadata_method_not_namespace_attribute(self):
  calls=[];candidate={'actual':'candidate'};selection={'selected':True}
  phase=types.SimpleNamespace(host=types.SimpleNamespace(config={'metadataInputSha256':'actual-input','metadataSelectionSha256':'actual-selection'},new_read=types.SimpleNamespace(document=lambda *a:selection)),cache=types.SimpleNamespace(META=Path('/actual-metadata')),generation=lambda:(None,candidate,None,None))
  source=types.SimpleNamespace(inverse=False);proof=types.SimpleNamespace(pins={'ypal-ordinary-metadata-handover-v5.py':'actual-pin'},metadata_refresh=lambda *a:calls.append('actual-forward-refresh'))
  namespace=types.ModuleType('actual-new-metadata-namespace');guard=types.SimpleNamespace(module=lambda *a:types.SimpleNamespace(namespace=lambda pin:namespace))
  class Slot:
   def __init__(self,n,p,refresh,inverse,g):self.asserted=(n is namespace and not inverse);refresh()
   def invoke(self,value,refresh,selected):
    calls.append('whole-metadata-body');return{'sameActualCandidate':value is candidate,'sameActualSelection':selected is selection}
  with patch.object(m,'PreparedMetadata',Slot):
   wrapped=m.ReaderPhase(phase,proof,object(),source,guard)
   self.assertTrue(callable(wrapped.metadata));value=wrapped.metadata()
   self.assertTrue(value['sameActualCandidate']);self.assertTrue(value['sameActualSelection']);self.assertEqual(calls,['actual-forward-refresh','whole-metadata-body'])
 def test_exact_prepared_callback_save_is_only_redirected_not_COMMIT_or_predicates(self):
  raw=(HERE/'ypal-cache-guard-owner-v1.py').read_bytes();calls=[]
  host=types.SimpleNamespace(read=types.SimpleNamespace(acl_catalog=lambda v:v),read_rehearsal={'after':{'actual':'baseline'}},private=lambda:calls.append('private'))
  committed={'resultJson':'actual-json'};scope={'need':m.need,'sha':m.sha,'host':host,'committed':committed,'validate_reads':lambda h:calls.append('full-current-graph')}
  fn=m.prepared_callback(raw,'inverse','prepared',scope,'sql-inverse-prepared.json',lambda label,value:calls.append(label))
  value={'mode':'inverse','planSha256':m.sha(b'actual-json'),'postProof':{'catalog':{'actual':'baseline'}}}
  fn(value);self.assertEqual(calls,['full-current-graph','private','sql-inverse-prepared.json'])
  value['postProof']['catalog']={'foreign':'column-or-edge'}
  with self.assertRaises(RuntimeError):fn(value)
 def test_protected_timing_domains_bind_direction_inputs_source_and_real_limits(self):
  session=types.SimpleNamespace(key={'target':'cache','direction':'forward','inputSha256':'actual'},g=types.SimpleNamespace(public=lambda *a:m.encoded(receipt)))
  receipt={'binding':m.timing_key(session,'cache-prepared'),'completed':True,'elapsedNanoseconds':100,'reservedEffectNanoseconds':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'syntheticTimingInputOnly':True}
  ref={'captureId':'actual-capture','sha256':'1'*64};self.assertEqual(m.require_timing(session,ref,'cache-prepared'),receipt)
  for changed in[{'elapsedNanoseconds':15_000_000_000},{'binding':{**receipt['binding'],'mode':'cache-inverse'}},{'databaseWrites':1}]:
   prior=copy.deepcopy(receipt);receipt.update(changed)
   with self.assertRaises(RuntimeError):m.require_timing(session,ref,'cache-prepared')
   receipt.clear();receipt.update(prior)
 def test_no_timing_no_effect_entry_and_no_automatic_unknown_COMMIT_resend(self):
  calls=[];cache=types.SimpleNamespace(**{name:(lambda *args:calls.append('effect'))for name in['review','rehearsal','drain','reconcile_stop','commit','reconcile_commit','prepare_ack','inspect','inverse_review','inverse','finish_inverse','reconcile_inverse']})
  session=types.SimpleNamespace(cache=cache,host=object(),source=types.SimpleNamespace(inverse=False),key={'target':'cache'})
  with self.assertRaises(RuntimeError):m.execute_cache(session,'commit',[],'new-attempt')
  self.assertEqual(calls,[])
 def test_real_audit_directories_fsync_each_parent_before_durable_effect_intent(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=Path(tmp)/'caller';calls=[];mkdir=Path.mkdir;sync=m.sync
   def created(path,*args,**kwargs):
    value=mkdir(path,*args,**kwargs);calls.append(('mkdir',path.name));return value
   def synced(path):sync(path);calls.append(('sync',Path(path).name))
   with patch.object(m,'BASE',base),patch.object(Path,'mkdir',created),patch.object(m,'sync',synced):
    folder=m.directory('attempts','actual-local-attempt')
   self.assertEqual(calls,[('mkdir','caller'),('sync',Path(tmp).name),('mkdir','attempts'),('sync','caller'),('mkdir','actual-local-attempt'),('sync','attempts')])
   self.assertEqual(folder.stat().st_mode&0o777,0o700)
 def test_unsupported_reader_inverse_is_closed_but_full_bound_original_path_remains(self):
  root=types.SimpleNamespace(inverse=lambda *a:'actual-original-inverse')
  session=types.SimpleNamespace(source=types.SimpleNamespace(inverse=True,prepared=True),root=root,proof=object(),context=object())
  self.assertEqual(m.reader_inverse_core(session),(root,session.proof,session.context))
  session.source.inverse=False
  with self.assertRaises(RuntimeError):m.reader_inverse_core(session)


if __name__=='__main__':unittest.main(verbosity=2)
