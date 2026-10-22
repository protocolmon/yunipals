#!/usr/bin/env python3
"""Deterministic historical ACL addition from the exact accepted staking receipt."""
import copy
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
RESULT=Path('/var/backups/yunipals-staking-support-owner-v1-20261021/apply-54a72d21fe74020dea60244616de0f7323984b859614c3a368432b4a70c9d374/result.json')
RESULT_SHA='7316e6c79792f373865f3f1ae8d276b12c804f52c9f3e65780cc9cf30fd0680a'
OWNER_SHA='6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f'
OID='73765879'
def fail(code):raise RuntimeError(code)

def anchor(a,owner):
 staking=a.load(OPS/'staking-support-owner-v1.py',OWNER_SHA)
 receipt=a.document(RESULT,RESULT_SHA);review=a.document(RESULT.parent/'review.json',a.sha(a.protected(RESULT.parent/'review.json')))
 proof=staking.validate_proof(a.document(RESULT.parent/'proof.json',receipt['proofSha256']))
 if(receipt.get('format')!=staking.FORMAT or receipt.get('applied')is not True or receipt.get('transactionOutcome')!='commit_confirmed'or receipt.get('roleOid')!=OID or proof['roleOid']!=OID or review.get('operatorSha256')!=OWNER_SHA or receipt['reviewHash']!=a.sha(a.encoded(review))or review.get('exactGrantBindings')!=staking.required_new_rights()):fail('exact_accepted_staking_commit_required')
 if owner.json_sql("SELECT jsonb_build_object('oid',oid::text)FROM pg_roles WHERE rolname='yunipals_islands_staking'")!={'oid':OID}:fail('current_accepted_staking_OID_required')
 return staking.required_new_rights()

def expected(catalog,rights):
 # This constructs an expected catalog from the protected prior receipt. It
 # never removes or ignores fields from the current observation.
 if len(rights)!=21 or len({(r['kind'],r['name'],r['privilege'])for r in rights})!=21 or any(r['grantable']is not False or r['grantorIsOwner']is not True for r in rights):fail('exact_21_owner_granted_staking_bindings_required')
 out=copy.deepcopy(catalog)
 for obj in out['objects']:
  wanted=[r for r in rights if(r['kind'],r['name'])==(obj['kind'],obj['name'])];acl=obj['acl']or[]
  allowed=[{'grantor':obj['owner'],'grantee':OID,'privilege':r['privilege'],'grantable':False}for r in wanted]
  if any(r not in allowed for r in acl if r['grantee']==OID):fail('unaccepted_historical_staking_acl_entry')
  for row in allowed:
   if row not in acl:acl.append(row)
  obj['acl']=sorted(acl,key=lambda r:(int(r['grantor']),int(r['grantee']),r['privilege'],r['grantable']))or None
 return out

def upgrade(a,owner,catalog):return expected(catalog,anchor(a,owner))
