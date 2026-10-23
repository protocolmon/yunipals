#!/usr/bin/env python3
"""Existing consumer protocols with the explicit current ten-read feature guard.

This entry composes the frozen marketplace acknowledgement and unchanged core
algorithms. It builds the new Guard directly, never claims the old d0e/nine-read
Guard passed, and binds its own producer in new installation receipts.
"""
import hashlib
from pathlib import Path
import types
import sys

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
ENTRY='consumer-operational-marketplace-ack-v2.py'
ENTRY_SHA='9a5190ee5bbb74ea72bd128359e1c14ead3083148b430210515119d82851ef4d'
RUNTIME='consumer-owned-booster-runtime-v3.py'
RUNTIME_SHA='5f42dccc1e632848594c763ff2490d56fbb063f32e0e022a72f88e07fe9b7811'


def load(name,pin):
 path=OPS/name
 for item in[*path.parents,path]:
  info=item.lstat()
  if item.is_symlink()or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('protected_current_consumer_code_required')
 raw=path.read_bytes()
 if len(raw)>100000 or hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError('exact_current_consumer_dependency_required')
 module=types.ModuleType('current_'+path.stem.replace('-','_'));module.__file__=str(path)
 exec(compile(raw,str(path),'exec'),module.__dict__)
 return module


def proof():
 return {'format':'yunipals-current-booster-feature-binding-v1',
  'entrySha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
  'runtimeSha256':RUNTIME_SHA,
  'rolloutReceiptSha256':'91e6496cb4efc7548671318beeb63b2592602d545ab884dd3f6bb3f539f70fb8',
  'apiBundleSha256':'b624dc518556756399a26e691bd1d53d319bd46d20134f9d6e1356dae3d96088',
  'apiUnitSha256':'b160e4e6c18a9bfae20bf1780d356eeca41350550c31e63bbb9c7a6d78582ec4',
  'launchReadCount':10,'currentObservationsNormalized':False}


def owner_modules(a):
 # Same fixed scope, source pins and ownership adapter as owner6.modules;
 # the only new producer is the explicitly loaded ten-read runtime below.
 owner=a.load(OPS/'ownership-readview-owner-v1.py',a.OWNER_SHA)
 helper,frozen,_=owner.load_inputs()
 scope=a.document(OPS/a.SCOPE_FILE,a.SCOPE_SHA)
 features=a.document(OPS/'consumer-retained-read-dependencies-v1.json',a.RETAINED_SHA)
 observed=a.document(features['actualSelectorsFile'],features['actualSelectorsSha256'])
 if(observed.get('format')!='yunipals-consumer-retained-selectors-v1'or observed.get('completed')is not True or{r['unit']:r['flags']for r in observed['services']}!=features['retainedFlags']):a.fail('actual_retained_feature_selectors_required')
 for name,pin in features['sourcePins'].items():
  if a.sha(a.protected(helper.ROOT/name))!=pin:a.fail('retained_route_public_source_changed')
 scope['retainedReads']=features['groups'];scope['retainedFeatureDependencySha256']=a.RETAINED_SHA;scope['retainedSelectors']=observed
 runtime=load(RUNTIME,RUNTIME_SHA)
 primitives=types.SimpleNamespace(load=a.load,document=a.document,protected=a.protected,sha=a.sha,encoded=a.encoded,objects=a.objects,ROLES=a.ROLES,quoted=a.quoted)
 a.owned_booster=runtime.Guard(primitives,owner,helper,scope,frozen)
 adapter=a.load(OPS/'ownership-readview-owned-booster-v1.py',a.OWNERSHIP_ADAPTER_SHA)
 return adapter.Owner(owner,a.owned_booster),helper,frozen,scope


def core(mode):
 if mode not in{'owner','preview','install'}:raise RuntimeError('fixed_consumer_mode_required')
 previous=load(ENTRY,ENTRY_SHA)
 module=previous.core(mode)
 if mode=='owner':
  def modules():
   result=owner_modules(module)
   previous.load(OPS/previous.HISTORY,previous.HISTORY_SHA).anchor(module,result[0])
   return result
  module.modules=modules
 elif mode=='preview':
  def modules(artifact_file,artifact_sha):
   a=core('owner');owner,helper,frozen,scope=a.modules()
   p=a.load(OPS/'consumer-api-preview-v5.py',module.PREVIEW_SHA)
   runtime=a.load(OPS/'consumer-topic-runtime-v1.py','d064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc')
   helper=runtime.Runtime(a,helper,artifact_file,artifact_sha);scope=helper.scope(scope)
   view=a.load(OPS/'consumer-v4-read-runtime-v1.py','993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b')
   helper=view.Runtime(a,owner,helper);scope=helper.scope(scope);a=view.Catalog(a,helper)
   h=previous.load(OPS/previous.HISTORY,previous.HISTORY_SHA)
   return h.Catalog(a,owner),owner,helper,frozen,scope,p
  module.modules=modules
 else:
  module.__file__=str(Path(__file__).absolute())
  def modules(artifact_file,artifact_sha):
   p=core('preview');a,owner,helper,frozen,scope,old=p.modules(artifact_file,artifact_sha)
   return a,p,old,owner,helper,frozen,scope
  module.modules=modules
 old_review=module.review
 def review(*args,**kwargs):
  returned=old_review(*args,**kwargs)
  checked=returned[0]if isinstance(returned,tuple)else returned
  checked['binding']['acknowledgedCurrentBoosterFeature']=proof()
  # Both core encodings are explicit: owner6 has no newline; install/preview
  # use the returned owner's canonical encoded function as before.
  a=module if mode=='owner'else args[0]
  checked['reviewHash']=a.sha(a.encoded(checked['binding']))
  return (checked,*returned[1:])if isinstance(returned,tuple)else checked
 module.review=review
 old_save=module.save if hasattr(module,'save')else None
 if old_save is not None:
  def save(path,value):
   if isinstance(value,dict)and Path(path).name=='result.json'and value.get('format')in{'yunipals-consumer-operational-owner-v6','yunipals-consumer-operational-preview-v6','yunipals-consumer-operational-install-v7'}:
    value={**value,'acknowledgedCurrentBoosterFeature':proof()}
   return old_save(path,value)
  module.save=save
 return module


if __name__=='__main__':
 mode=sys.argv.pop(1)if len(sys.argv)>1 and sys.argv[1]in{'owner','preview','install'}else'install'
 core(mode).main()
