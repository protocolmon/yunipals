"""Real CONT5 bodies; private reconciliation/OS/DB receipts are explicit fixtures."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent

def source(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
old=source('ypal-ordinary-publication-continue-v4.test.py');meta=source('ypal-ordinary-metadata-current-observation-v1.test.py')
bootstrap=old.Controls();bootstrap.setUp()

def public(path,expected=None,maximum=4000000):return old.public(path,expected,maximum)

def reconciliation_record(refs):
    return{'format':'root-CONT4-held-reconcile-v1','completed':True,
        'callerSha256':'f04a6fde624aa5a3805f6f8b4b3f34fa0d03e1e036f4a8237c88b3261f822d4f',
        'historicalAcceptedCallerSha256':'c4d86df5b1228147f9677db49d76932f4d187b67ffd09172a92f553c835a4f92',
        'currentCallerSourceManifestSha256':'d6fdd6668f73c1bb19574682cbd72e4167c8c990f4da9b6c5ab88e1427c4bbc1',
        'metadataCurrentHelperSha256':'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2',
        'metadataCurrentObserverSha256':'17a24566753c1903e1c4be3a0f9d66f24d44cd9aaee30b16ceedb21cceeb2498',
        'metadataRefsSha256':hashlib.sha256((json.dumps(refs,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest(),
        'transactionId':'16775453','transactionStatus':'aborted','childEpochGone':True,'backendEpochCount':0,
        **{key:True for key in['wholeCatalogRestoredQualified','allColumnACLRestoredQualified','readerGraphRestoredQualified','failedRecordsAndInodesUnchanged']},
        'historicalCurrentProofRelabelled':False,'realCOMMITDispatched':False,'LOGINDispatched':False,'qualificationDispatched':False,
        'databaseWrites':0,'serviceActionsDispatched':0,'baselineRootResultSha256':'1'*64,'baselineReceiptSha256':'2'*64,
        'failedRootResultSha256':'3'*64,'proofHashes':{'whole-current-catalog':'4'*64}}

e=source('ypal-ordinary-metadata-current-effect-v1.py')
def effect_public(path,expected=None,maximum=4000000):
    if Path(path)==e.RECON:
        if expected!=e.RECON_SHA:raise RuntimeError('actual_fixed_recon3_SHA_must_be_passed_to_protected_reader')
        return(json.dumps(reconciliation_record(bootstrap.refs),sort_keys=True,separators=(',',':'))+'\n').encode()
    return public(path,expected,maximum)
e.public=effect_public;e.current_module=lambda:meta.actual
compiler=source('ypal-fresh-forward-epoch-v1.py');native_namespace=compiler.namespace

def namespace(*args,**kwargs):
    n=native_namespace(*args,**kwargs)
    if 'public'in vars(n):n.public=public
    if 'factory'in vars(n):n.factory=lambda:compiler
    if 'utility'in vars(n)and str(getattr(n,'FORMAT','')).startswith('yunipals-ypal-ordinary-cache-continuation-authority'):n.utility=lambda:bootstrap.utility
    return n
compiler.namespace=namespace
actual={'ypal-ordinary-metadata-current-effect-v1.py':e};wrappers={}
for name in ['ypal-ordinary-cache-continuation-authority-v5.py','ypal-ordinary-read-cache-continue-v5.py',
 'ypal-ordinary-reader-continue-v5.py','ypal-ordinary-publication-continue-v5.py','ypal-ordinary-publication-continue-inputs-v5.py']:
 w=source(name);wrappers[name]=w
 with patch.object(w,'public',side_effect=public),patch.object(w,'factory',return_value=compiler):actual[name]=w.composition()
for fn in[actual['ypal-ordinary-cache-continuation-authority-v5.py'].new_identity,actual['ypal-ordinary-publication-continue-v5.py'].composed]:
 for cell in(fn.__closure__ or()):
  value=cell.cell_contents
  if isinstance(value,types.ModuleType)and getattr(value,'FILE',None)==e.FILE:
   value.public=effect_public;value.current_module=lambda:meta.actual
bootstrap.doCleanups()

def load(name):return actual[name]if name in actual else source(name)
# Execute the same retained integration controls with only explicit identities
# and source-loader fixture relocation changed.
raw=(HERE/'ypal-ordinary-publication-continue-v2.test.py').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='2d8008a1dabbf84c129824ddd893689d6d7a6d39a7fa3aca09acc4cf70236eb4'
tree=ast.parse(raw);body=[]
for n in tree.body:
 if isinstance(n,ast.FunctionDef)and n.name=='load':continue
 if isinstance(n,ast.If)and ast.unparse(n.test)=="__name__ == '__main__'":continue
 for item in ast.walk(n):
  if isinstance(item,ast.Constant)and type(item.value)is str:
   item.value=item.value.replace('continue-v2','continue-v5').replace('continue-inputs-v2','continue-inputs-v5').replace('continue-manifest-v2','continue-manifest-v5').replace('authority-v2','authority-v5').replace('metadata-current-epoch-v1','metadata-current-effect-v1')
 body.append(n)
scope={'load':load,'__file__':str(HERE/'ypal-ordinary-publication-continue-v5.test.py'),'__name__':'CONT5_retained_controls'}
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),scope['__file__'],'exec'),scope)
Base=scope['Controls'];PureControls=scope['PureControls']

class Controls(Base):
 def setUp(self):
  super().setUp();self.enterContext(patch.object(meta.actual,'utility',return_value=self.utility))
 def test_actual_caller_timing_binds_complete_metadata_ACK_and_new_epoch_identity(self):
  super().test_actual_caller_timing_binds_complete_metadata_ACK_and_new_epoch_identity()
  caller=actual['ypal-ordinary-publication-continue-v5.py']
  self.assertTrue(str(caller.BASE).endswith('v5-20261026'))
 def test_new_authority_reconciliation_is_in_the_actual_function_globals(self):
  c=actual['ypal-ordinary-cache-continuation-authority-v5.py']
  self.assertIs(c.qualification_key.__globals__['new_identity'],c.new_identity)
  self.assertIs(c.approval_before_launch.__globals__['new_identity'],c.new_identity)
  self.assertIs(c.QualificationScope,c.composition().QualificationScope)
 def test_fresh_namespace_and_strict_original_baseline_requirement_remain(self):
  p=actual['ypal-ordinary-read-cache-continue-v5.py'];self.assertTrue(str(p.BASE).endswith('v5-20261026'))
  n=self.provider();cache=n.cache_runtime();old_cache=source('ypal-cache-guard-owner-v1.py')
  self.assertEqual(cache.metadata_epoch_namespace.metadata_epoch_helper_file,meta.wrapper.FILE)
  for name in['commit','prepare_ack','owned']:
   self.assertEqual(getattr(cache,name).__code__.co_code,getattr(old_cache,name).__code__.co_code)
  self.assertIn('same_metadata_generation_before_cache_commit',cache.commit.__code__.co_consts)
 def test_recon3_fixed_path_and_all_required_positive_flags_refuse_foreign(self):
  self.assertEqual(e.reconciliation(self.refs)['sha256'],e.RECON_SHA)
  record=reconciliation_record(self.refs)
  for key,value in [('completed',False),('wholeCatalogRestoredQualified',False),('allColumnACLRestoredQualified',False),
   ('transactionStatus','committed'),('metadataCurrentHelperSha256','0'*64),('metadataRefsSha256','0'*64)]:
   changed=copy.deepcopy(record);changed[key]=value
   with patch.object(e,'public',return_value=(json.dumps(changed)+'\n').encode()):
    with self.assertRaises(RuntimeError):e.reconciliation(self.refs)
 def test_reconciliation_refusal_precedes_any_caller_source_construction(self):
  caller=actual['ypal-ordinary-publication-continue-v5.py'];binding=next(cell.cell_contents for cell in caller.composed.__closure__
   if isinstance(cell.cell_contents,types.ModuleType)and getattr(cell.cell_contents,'FILE',None)==e.FILE)
  with (patch.object(binding,'reconciliation',side_effect=RuntimeError('fixture_unqualified_reconciliation')),
   patch.object(self.h,'derive',side_effect=AssertionError('source construction after refused recon'))as derive):
   with self.assertRaisesRegex(RuntimeError,'unqualified_reconciliation'):caller.composed(self.manifest_sha,self.refs)
  derive.assert_not_called()

del Base
if __name__=='__main__':unittest.main()
