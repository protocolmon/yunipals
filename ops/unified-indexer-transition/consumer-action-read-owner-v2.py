#!/usr/bin/env python3
"""Two main-role action-evidence SELECTs, preserving the accepted86 read graph."""
import argparse,copy,hashlib,json,os,re,socket,stat,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-consumer-action-reads-v2-20261021')
FORMAT='yunipals-consumer-action-reads-v2'
ACL_SHA='2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b'
HISTORY_SHA='722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92'
SOURCE='41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b'
RELATIONS=['unified_shadow_20261020_7e7375b0.transaction_candidate','yunipals_indexer_control.transaction_evidence']
SOURCE_PINS={'action-evidence-routes.ts':'1f0ef948242879fb6b7fc64f77092bffb0183d1282023fbabb7e6ebf22c0b451','action-evidence.ts':'1abaea641e2dda87ef9d9ed5f640ea690ee79e6a238cddfb8de82816fbf8794b'}
def fail(code):raise RuntimeError(code)
def modules():
 path=OPS/'consumer-operational-owner-v2.py'
 for item in [*path.parents,path]:
  s=item.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_frozen_owner_required')
 raw=path.read_bytes()
 if len(raw)>100000 or hashlib.sha256(raw).hexdigest()!=ACL_SHA:fail('exact_accepted86_owner_required')
 a=types.ModuleType('accepted_action_read_primitives');a.__file__=str(path);exec(compile(raw,str(path),'exec'),a.__dict__)
 owner,helper,frozen,scope=a.modules()
 for name,pin in SOURCE_PINS.items():
  if a.sha(a.protected(OPS/'consumer-action-read-sources-v1'/name,100000))!=pin:fail('exact_action_reader_source_required')
 return a,owner,helper,frozen,scope

def accepted86(a,owner,path,pin,scope,frozen):
 v=a.document(path,pin);saved=a.document(Path(path).parent/'review.json',v['reviewFileSha256'])
 if(v.get('format')!=a.FORMAT or v.get('operatorSha256')!=ACL_SHA or not v.get('applied')or v.get('transactionOutcome')!='commit_confirmed'or v['reviewHash']!=saved['reviewHash']or saved['reviewHash']!=a.sha(a.encoded(saved['binding']))or v['afterSha256']!=a.sha(a.encoded(saved['binding']['after']))):fail('exact_accepted86_receipt_required')
 history=a.load(OPS/'consumer-accepted-staking-acl-v1.py',HISTORY_SHA)
 current=a.capture(owner,scope,frozen)
 if current!=history.upgrade(a,owner,saved['binding']['after']):fail('only_exact_accepted_staking_delta_may_follow86')
 return v,saved,current

def expanded(scope):
 value=copy.deepcopy(scope);value['retainedReads'].append({'role':'yunipals_unified_api','schemas':[],'functions':[],'relations':RELATIONS})
 return value

def acknowledged(a,path,pin):
 v=a.document(path,pin);saved=a.document(Path(path).parent/'review.json',v['reviewFileSha256']);b=saved['binding']
 if(v.get('format')!=FORMAT or v.get('operatorSha256')!=a.sha(a.protected(Path(__file__).absolute()))or not v.get('applied')or v.get('transactionOutcome')!='commit_confirmed'or v['reviewHash']!=saved['reviewHash']or saved['reviewHash']!=a.sha(a.encoded(b))or v['afterSha256']!=a.sha(a.encoded(b['after']))):fail('actual_owned_two_read_receipt_required')
 return v,saved

def review(a,owner,helper,frozen,scope,previous,rollback):
 full=expanded(scope);before=a.capture(owner,full,frozen);a.validate_catalog(before,full,frozen)
 if rollback:
  receipt,saved=acknowledged(a,*rollback)
  if receipt['rollback']or before!=saved['binding']['after']:fail('exact_current_owned_read_delta_required_for_inverse')
  changes=saved['binding']['changes'];accepted=saved['binding']['accepted86'];remove=True
 else:
  if not previous:fail('actual_committed86_read_receipt_required')
  receipt,saved,current=accepted86(a,owner,*previous,scope,frozen)
  if receipt['phase']!='features'or receipt.get('rollback'):fail('both_accepted_read_transactions_required')
  projected=copy.deepcopy(before);projected['objects']=[o for o in projected['objects']if not(o['kind']=='relation'and o['name']in RELATIONS)]
  if projected!=current:fail('accepted86_catalog_changed_during_expansion')
  changes=[('yunipals_unified_api','relation',name,'SELECT')for name in RELATIONS];accepted={'file':str(previous[0]),'sha256':previous[1]};remove=False
 if changes!=[('yunipals_unified_api','relation',name,'SELECT')for name in RELATIONS]and changes!=[['yunipals_unified_api','relation',name,'SELECT']for name in RELATIONS]:fail('exact_two_source_evidence_reads_only')
 if any(a.session_count(owner,r)for r in a.ROLES):fail('dormant_accepted_consumers_required')
 after=a.expected_after(before,changes,remove=remove)
 b={'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'sourceDigest':SOURCE,'sourcePins':SOURCE_PINS,'accepted86':accepted,'rollbackOf':{'file':str(rollback[0]),'sha256':rollback[1]}if rollback else None,'rollback':remove,'changes':changes,'before':before,'after':after,'common':a.unchanged_common(owner,helper,frozen)}
 checked={'format':FORMAT,'reviewHash':a.sha(a.encoded(b)),'binding':b}
 return checked,a.guarded_sql(before,after,changes,a.catalog_sql(full,frozen),remove=remove),full

def apply(a,owner,helper,frozen,full,checked,text,directory):
 a.save(directory/'review.json',checked);a.save(directory/'prepared-sql.json',{'sql':text,'sha256':a.sha(text.encode())});outcome='unconfirmed_requires_catalog_reconcile';error=None
 try:
  owner.sql(text,write=True);outcome='commit_confirmed'
  if a.capture(owner,full,frozen)!=checked['binding']['after']or a.unchanged_common(owner,helper,frozen)!=checked['binding']['common']:fail('exact_two_read_postcheck_required')
 except BaseException as e:error=a.failure(e)
 v={'format':FORMAT,'operatorSha256':a.sha(a.protected(Path(__file__).absolute())),'applied':error is None,'transactionOutcome':outcome,'reviewHash':checked['reviewHash'],'reviewFileSha256':a.sha(a.protected(directory/'review.json')),'afterSha256':a.sha(a.encoded(checked['binding']['after'])),'rollback':checked['binding']['rollback'],'selectBindings':2,'loginChanged':False,'dmlGranted':False,'sourceSelectionChanged':False,'error':error,'automaticRetryAllowed':False}
 pin=a.save(directory/'result.json',v);return {**v,'resultSha256':pin,'evidenceDirectory':str(directory)}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--previous-file');p.add_argument('--previous-sha');p.add_argument('--rollback-file');p.add_argument('--rollback-sha');g=p.add_mutually_exclusive_group();g.add_argument('--apply');g.add_argument('--rehearse',action='store_true');args=p.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_main_required')
 a,owner,helper,frozen,scope=modules();previous=(args.previous_file,args.previous_sha)if args.previous_file and args.previous_sha else None;rollback=(args.rollback_file,args.rollback_sha)if args.rollback_file and args.rollback_sha else None
 if bool(previous)==bool(rollback):fail('exactly_one_accepted86_or_owned_inverse_receipt_required')
 with a.lease():
  checked,text,full=review(a,owner,helper,frozen,scope,previous,rollback)
  if args.rehearse:
   if not text.endswith('COMMIT;\n'):fail('exact_guarded_transaction_ending_required')
   owner.sql(text[:-len('COMMIT;\n')]+'ROLLBACK;\n',write=True)
   if a.capture(owner,full,frozen)!=checked['binding']['before']or a.unchanged_common(owner,helper,frozen)!=checked['binding']['common']:fail('rolled_back_read_rehearsal_must_preserve_catalog')
  if not args.apply:result={'format':FORMAT,'reviewHash':checked['reviewHash'],'rollback':bool(rollback),'selectBindings':2,'applied':False,'transactionRollbackRehearsed':args.rehearse,'sourceDigest':SOURCE,'loginChanged':False,'dmlGranted':False}
  else:
   if args.apply!=checked['reviewHash']:fail('exact_fresh_two_read_review_required')
   BASE.mkdir(mode=0o700,exist_ok=True);s=BASE.lstat()
   if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700:fail('private_owned_read_evidence_required')
   directory=BASE/('rollback-'if rollback else'apply-')/args.apply;directory.parent.mkdir(mode=0o700,exist_ok=True);directory.mkdir(mode=0o700)
   result=apply(a,owner,helper,frozen,full,checked,text,directory)
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as e:
  print(json.dumps({'format':FORMAT,'applied':False,'errorClass':type(e).__name__,'fixedCode':str(e)if e.args and isinstance(e.args[0],str)and re.fullmatch('[a-z0-9_]{1,100}',str(e))else'external_operation_failed','rawMessagesExported':False}));raise SystemExit(1)
