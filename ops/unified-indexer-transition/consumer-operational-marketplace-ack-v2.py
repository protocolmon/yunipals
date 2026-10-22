#!/usr/bin/env python3
"""Fixed acknowledgement entry for the frozen owner/preview/install protocols.

Historical files and receipts remain unchanged. Only the expected ACL history
is supplemented with one exact committed read admission. No policy file or
caller-selected grant exception exists. Commands retain their existing review,
apply and owned inverse arguments; default action remains read-only review.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
HISTORY='consumer-accepted-marketplace-acl-v2.py'
HISTORY_SHA='4fa510efd86714404655403617d46cd597fb099b6ed3d9a003cf293269c34a36'
CORES={
 'owner':('consumer-operational-owner-v6.py','f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d'),
 'preview':('consumer-operational-preview-v6.py','447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777'),
 'install':('consumer-operational-install-v7.py','9a59728a3dbdac9c039d1bd1e0c35557a15ece2ec018c5b6bee25bcfcae7d078')
}


def fail(code):raise RuntimeError(code)
def sha(value):return hashlib.sha256(value).hexdigest()


def protected(path,pin):
 for item in[*path.parents,path]:
  info=item.lstat()
  if stat.S_ISLNK(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:fail('protected_fixed_consumer_code_required')
 if not path.is_file()or path.stat().st_size>100000:fail('bounded_fixed_consumer_code_required')
 raw=path.read_bytes()
 if sha(raw)!=pin:fail('frozen_consumer_core_or_history_changed')
 return raw


def load(path,pin,*,producer=None):
 raw=protected(path,pin);value=types.ModuleType('acknowledged_'+path.stem)
 value.__file__=str(producer or path)
 exec(compile(raw,str(path),'exec'),value.__dict__)
 return value


def history_proof(h,a):
 return {'file':str(h.RESULT),'sha256':h.RESULT_SHA,'historyHelperSha256':HISTORY_SHA,
         'bindings':24,'currentObservationsNormalized':False}


def core(mode):
 if mode not in CORES:fail('fixed_owner_preview_or_install_required')
 h=load(OPS/HISTORY,HISTORY_SHA)
 name,pin=CORES[mode]
 # Install receipts identify this new entry, whose bytes bind both frozen core
 # and exact history helper. Existing owner/preview producer protocols retain
 # their core identity and carry a separately pinned history acknowledgement.
 module=load(OPS/name,pin,producer=Path(__file__).absolute()if mode=='install'else None)
 original_modules=module.modules
 if mode=='install':
  def modules(*args):
   a,p,old,owner,helper,frozen,scope=original_modules(*args)
   a=h.Catalog(a,owner)
   p.action_admission=lambda *values,**options:h.action_admission(p,*values,**options)
   return a,p,old,owner,helper,frozen,scope
  module.modules=modules
  original_review=module.review
  def review(a,*args,**kwargs):
   checked=original_review(a,*args,**kwargs)
   checked['binding']['acknowledgedMarketplaceReadHistory']=history_proof(h,a)
   checked['reviewHash']=a.sha(a.encoded(checked['binding']))
   return checked
  module.review=review
 elif mode=='preview':
  def modules(*args):
   a,owner,helper,frozen,scope,old=original_modules(*args)
   return h.Catalog(a,owner),owner,helper,frozen,scope,old
  module.modules=modules
  module.action_admission=lambda *values,**options:h.action_admission(module,*values,**options)
 else:
  original_history,original_save=module.accepted_history,module.save
  def modules(*args):
   result=original_modules(*args);h.anchor(module,result[0]);return result
  module.modules=modules
  module.accepted_history=lambda owner,catalog:h.upgrade(module,owner,original_history(owner,catalog))
  def save(path,value):
   if isinstance(value,dict)and value.get('format')==module.FORMAT and Path(path).name=='result.json':
    value={**value,'acknowledgedMarketplaceReadHistory':history_proof(h,module)}
   return original_save(path,value)
  module.save=save
 return module


if __name__=='__main__':
 mode=sys.argv.pop(1)if len(sys.argv)>1 and sys.argv[1]in CORES else'install'
 if os.geteuid()!=0:fail('root_consumer_owner_entry_required')
 core(mode).main()
