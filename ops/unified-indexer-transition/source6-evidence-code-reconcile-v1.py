#!/usr/bin/env python3
"""Finish the observed two-of-three evidence proxy transition, once, without restarting the source."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import signal
import stat
import time
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-source6-evidence-code-reconcile-v1-20261022')
FORMAT='yunipals-source6-evidence-code-reconcile-v1'
OLD_HELPER=OPS/'source6-evidence-code-route-v1.py'
OLD_HELPER_SHA='83056c7f0b5a6941ca21bdffdda5d48a6cf6a2592cde57f09200012f77084f0f'
OLD_BASE=Path('/var/backups/yunipals-source6-evidence-code-route-v1-20261022')
FAILED_SHA='edfca295342fd06f995e6ec3278e8bde1d12c560ef0500a901a7e1a66afc006f'
INTENT_SHA='5507396378022bdf480d0f68b4ef318765d7e9f7c4c19dabd8b5221209cc66a6'
REVIEW_SHA='556b5af92d7f631084847a6e7b9c7f70969b6315314f24e9ceea28be80cfd988'
OLD_JOURNAL_SHA='7d53aebee284d7a8f8757ff686092c6c9d7eda1fdbd48d0dfcf428de82711fba'
CHAINS=('base','ethereum','polygon')
OBSERVED={'base':('e18b38a23e70438a90619a5fe94c8ab7',350603,66092519294247),
 'ethereum':('da24c237ebcb4211bc9203646d76a3f5',352361,66092580871448),
 'polygon':('d98d979cde0f40f28010174d2d913632',3664523,66035975349293)}
OLD_LAUNCH_UNIT='yunipals-source6-evidence-code-v1-apply.service'
TIMEOUT_START_US=90000000
TIMEOUT_STOP_US=30000000
RESTART_SECONDS=130


def fail(code):raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()


def modules():
 for path in [*OLD_HELPER.parents,OLD_HELPER]:
  info=path.lstat()
  if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:fail('protected_frozen_route_required')
 raw=OLD_HELPER.read_bytes()
 if len(raw)>200000 or sha(raw)!=OLD_HELPER_SHA:fail('exact_frozen_route_required')
 old=types.ModuleType('failed_evidence_route');old.__file__=str(OLD_HELPER)
 exec(compile(raw,str(OLD_HELPER),'exec'),old.__dict__)
 d=old.modules();d.evidence_route=old
 return d


def read(d,path,pin=None):return d.evidence_route.read(d,path,pin)
def journal(d):return d.live.journal_for(d.q,BASE)


def old_attempt(d):
 r=d.evidence_route
 failed=read(d,OLD_BASE/'failed.json',FAILED_SHA)
 intent=read(d,OLD_BASE/'intent.json',INTENT_SHA)
 reviewed=read(d,OLD_BASE/'review.json',REVIEW_SHA)
 if (failed.get('manualReconcileRequired') is not True or failed.get('automaticRetryAllowed') is not False or
     intent.get('reviewHash')!=REVIEW_SHA or intent.get('parentRuntimeSha256')!=r.PARENT_SHA or
     intent.get('sourceInvocation')!=r.PARENT_INVOCATION or intent.get('automaticRetryAllowed') is not False or
     reviewed.get('operatorSha256')!=OLD_HELPER_SHA or reviewed.get('changedChains')!=list(CHAINS) or
     reviewed.get('candidate')!=r.candidate(d) or reviewed.get('diagnosisReceiptSha256')!=r.DIAGNOSIS):
  fail('exact_failed_partial_transition_required')
 if any(os.path.lexists(OLD_BASE/name) for name in ['runtime.json','evidence-code-handover-released.json',
     'rollback-intent.json','rollback-runtime.json','rollback-failed.json','recovery-completed.json']):
  fail('failed_transition_must_not_have_ACK_or_reversal')
 # The original operation is terminal, rather than merely unobserved by its launcher.
 text=d.q.run(['/usr/bin/systemctl','show','--all',OLD_LAUNCH_UNIT,
  '--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=Job'],timeout=5)
 if len(text)>4096:fail('bounded_original_operator_observation_required')
 p=dict(line.split('=',1)for line in text.strip().splitlines())
 if (set(p)!={'LoadState','ActiveState','SubState','MainPID','Job'}or p['MainPID']!='0'or
     p['ActiveState']not in{'inactive','failed'}or p['SubState']not in{'dead','failed'}or p['Job']not in{'','0'}or
     p['LoadState']not in{'loaded','not-found'}):
  fail('original_operator_must_be_terminal')
 if sha(d.q.protected(OLD_BASE/'journal.jsonl',1000000))!=OLD_JOURNAL_SHA:fail('same_failed_operator_journal_required')
 return reviewed


def fresh():
 if os.path.lexists(BASE):
  info=BASE.lstat()
  if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700 or any(BASE.iterdir()):
   fail('one_fresh_finish_only_reconciliation_required')


def process(d,name):
 r=d.evidence_route;p=d.qe.observed(d.v,r.unit(name))
 values={k:d.qe.bus_property(r.unit(name),'org.freedesktop.systemd1.Service',k,t) for k,t in
  [('ExecMainStartTimestampMonotonic','t'),('TimeoutStartUSec','t'),('TimeoutStopUSec','t'),('NRestarts','u'),('Result','s')]}
 if (p.get('ActiveState')!='active' or p.get('SubState')!='running' or not p.get('MainPID','').isdigit() or
     int(p['MainPID'])<2 or r.job(d,name) or values['TimeoutStartUSec']!=TIMEOUT_START_US or
     values['TimeoutStopUSec']!=TIMEOUT_STOP_US or values['NRestarts']!=0 or values['Result']!='success' or
     type(values['ExecMainStartTimestampMonotonic']) is not int):fail('exact_healthy_proxy_and_service_timeout_bounds_required')
 return {'invocation':p['InvocationID'],'pid':int(p['MainPID']),'startMonotonicUs':values['ExecMainStartTimestampMonotonic']}


def observed_process(name):
 invocation,pid,started=OBSERVED[name]
 return {'invocation':invocation,'pid':pid,'startMonotonicUs':started}


def partial(d,parent):
 r=d.evidence_route;result={}
 for name in CHAINS:
  selected,metadata,present,terminal=r.classify(d,parent,name)
  wanted=name!='polygon'
  if selected!=wanted or present!=[wanted,wanted] or terminal or process(d,name)!=observed_process(name):
   fail('exact_observed_two_completed_one_untouched_proxies_required')
  r.metrics(d,parent,name);result[name]=metadata
 return result


def recovery_evidence(d):
 """Root-private stat identity supplements the complete archive hash checked once by the parent validator."""
 directory=d.recovery.BASE;archive=directory/'bnb-native-before.copy.gz'
 for path in [*directory.parents,directory,archive]:
  info=path.lstat()
  if stat.S_ISLNK(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:fail('protected_recovery_evidence_required')
 info=archive.lstat()
 if not stat.S_ISREG(info.st_mode)or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:fail('protected_complete_recovery_archive_required')
 receipts={name:sha(d.q.protected(directory/name,2000000))for name in
  ['backup.json','result.json','commit-intent.json','recovery-definition.json','start-intent.json','runtime.json','handover-released.json']}
 backup=read(d,directory/'backup.json',receipts['backup.json'])
 if backup.get('path')!=str(archive)or backup.get('compressedBytes')!=info.st_size:fail('same_recovery_archive_size_required')
 return {'receipts':receipts,'archive':{'path':str(archive),'device':info.st_dev,'inode':info.st_ino,'size':info.st_size,
  'mtimeNs':info.st_mtime_ns,'ctimeNs':info.st_ctime_ns,'sha256':backup['sha256']}}


def live_source(d,reviewed,parent,evidence):
 """Post-mutation checks use the already fully verified parent; no repeated archive scan."""
 r=d.evidence_route
 if recovery_evidence(d)!=evidence:fail('same_fully_verified_recovery_evidence_required')
 if read(d,r.PARENT,r.PARENT_SHA)!=parent:fail('same_acknowledged_source_parent_required')
 ancestor,_=d.selective.inherited(d)
 if (parent['financialHandoff']!=ancestor['financialHandoff'] or
     d.selective.historical_overlay(d)!=reviewed['historicalOverlay'] or
     parent['definition']!=d.selective.render_definition(d,ancestor,parent['clock'],parent['repairReceiptSha256'],
         'selective',parent['definition']['maximumRuntimeSeconds'])):fail('unchanged_source_finance_inputs_and_original_cutoff_required')
 actual=d.selective.runtime(d,parent['definition'],parent['clock'],'selective',saved=parent['ordinaryRuntime'])
 if d.recovery.source_job(d):fail('no_source_job_during_proxy_reconciliation')
 d.ordinary.source_health()
 peer=d.recovery.source_state(d.q,d.qe,d.native,parent['sourceRole'],running=True)
 prior=read(d,d.header.PARENT,d.header.PARENT_SHA)
 if d.header.proxy(d,prior,True)!=parent['proxies']['bnb']['metadata'] or d.header.job(d):fail('same_BNB_proxy_required')
 d.header.metrics(d,prior,True)
 return {'ordinaryRuntime':actual,'checkpoints':peer['checkpoints'],'sourceRole':peer['role']}


def review(d):
 fresh();r=d.evidence_route;reviewed=old_attempt(d)
 evidence=recovery_evidence(d)
 parent,source=r.captured_source(d,reviewed)
 if recovery_evidence(d)!=evidence:fail('recovery_evidence_changed_during_full_validation')
 if parent['clock']['originalRuntimeExpiresMonotonicMicroseconds']-d.selective.monotonic_us()<600000000:
  fail('original_source_deadline_reconciliation_headroom_required')
 states=partial(d,parent);r.support_unchanged(d,reviewed['supportAtTransition'])
 return {'format':FORMAT,'operatorSha256':sha(d.q.protected(Path(__file__).absolute(),200000)),
  'failedOperatorSha256':OLD_HELPER_SHA,'failedReceiptSha256':FAILED_SHA,'failedIntentSha256':INTENT_SHA,
  'failedReviewSha256':REVIEW_SHA,'observedJournalSha256':OLD_JOURNAL_SHA,
  'sourceIdentity':source['ordinaryRuntime'],'clock':parent['clock'],'financialHandoff':parent['financialHandoff'],'recoveryEvidence':evidence,
  'completedProxyMetadata':states,'observedProcesses':{name:observed_process(name)for name in CHAINS},
  'changedChains':['polygon'],'adoptedChains':['base','ethereum'],'maximumRestartSeconds':RESTART_SECONDS,
  'supportAtTransition':reviewed['supportAtTransition'],'freeOnly':True,'paidAuthority':False,'permitIds':[],
  'sourceSelectionChanged':False,'sourceRestartAllowed':False,'supportRestartAllowed':False,'automaticRetryAllowed':False}


def restart(d,name):
 r=d.evidence_route
 if name not in CHAINS or r.job(d,name):fail('fixed_proxy_with_no_pending_job_required')
 for key,expected in [('TimeoutStartUSec',TIMEOUT_START_US),('TimeoutStopUSec',TIMEOUT_STOP_US)]:
  if d.qe.bus_property(r.unit(name),'org.freedesktop.systemd1.Service',key,'t')!=expected:
   fail('observed_service_timeout_bounds_required')
 result=d.q.run([*r.DBUS,'RestartUnit','ss',r.unit(name),'fail'],timeout=5)
 match=re.fullmatch(r'o "(/org/freedesktop/systemd1/job/([1-9][0-9]*))"\s*',result)
 if not match:fail('exact_owned_restart_job_response_required')
 owned=int(match[2]);journal(d).emit('proxy_restart_job_created',chain=name,jobId=owned)
 try:
  end=time.monotonic()+RESTART_SECONDS
  while time.monotonic()<end:
   current=r.job(d,name)
   if current==0:return
   if current!=owned:fail('foreign_proxy_job_blocks_reconciliation')
   time.sleep(0.2)
  fail('bounded_proxy_restart_expired')
 except BaseException:
  if r.job(d,name)==owned:
   journal(d).emit('proxy_restart_job_cancel_intent',chain=name,jobId=owned)
   try:d.q.run([*r.DBUS,'CancelJob','u',str(owned)],timeout=5)
   except Exception:
    if r.job(d,name)==owned:fail('owned_proxy_job_cancellation_failed')
  raise


def completed_peers(d,parent):
 r=d.evidence_route
 for name in ('base','ethereum'):
  if process(d,name)!=observed_process(name):fail('adopted_proxy_must_not_restart')
  r.proxy(d,parent,name,True);r.metrics(d,parent,name)


def acknowledge(d,checked,reviewed,parent,source,mode,support_check=None):
 r=d.evidence_route;selected=mode=='evidence-code'
 proxies=r.current_proxies(d,parent,selected)
 r.check_support(d,reviewed,support_check)
 source=live_source(d,reviewed,parent,checked['recoveryEvidence'])
 if source['ordinaryRuntime']!=checked['sourceIdentity']:fail('source_process_must_not_restart')
 if selected:completed_peers(d,parent)
 if r.current_proxies(d,parent,selected)!=proxies:fail('stable_proxy_identities_before_ACK_required')
 value={'format':FORMAT,'mode':mode,'reviewFile':str(BASE/'review.json'),'reviewSha256':sha(encoded(checked)),
  'failedOperatorSha256':OLD_HELPER_SHA,'failedReceiptSha256':FAILED_SHA,'failedReviewSha256':REVIEW_SHA,
  'parentRuntimeFile':str(r.PARENT),'parentRuntimeSha256':r.PARENT_SHA,'ordinaryRuntime':source['ordinaryRuntime'],
  'sourceDefinitionSha256':parent['definition']['sha256'],'clock':parent['clock'],'financialHandoff':parent['financialHandoff'],
  'effectiveRuntime':{'sourceRuntime':parent['effectiveRuntime'],'evidenceProxyEntries':{
   name:r.ENTRY_SHA if selected else r.original_entry(d,name)[1] for name in CHAINS}},
  'proxies':proxies,'proxyProcesses':{name:process(d,name)for name in CHAINS},'changedChains':list(CHAINS),
  'supportAtTransition':reviewed['supportAtTransition'],'freeOnly':True,'paidAuthority':False,'permitIds':[],
  'sourceSelectionChanged':False,'sourceRestarted':False,'checkpointsAtAcknowledgment':source['checkpoints'],
  **{k:parent[k]for k in ['sourceDigest','schema','nativeBuild','profile','parentReferences','runtimeScope']}}
 r.check_support(d,reviewed,support_check)
 path=BASE/('runtime.json'if selected else'rollback-runtime.json');pin=d.q.save(path,value)
 journal(d).emit(mode+'_runtime_acknowledged',receiptFile=str(path),receiptSha256=pin)
 return path,pin


def released(d,mode,path,pin):
 p=BASE/(mode+'-handover-released.json')
 release=d.q.save(p,{'runtimeReceiptSha256':pin,'sourceAndProxyHandoverLeasesReleased':True})
 return {'format':FORMAT,'mode':mode,'runtimeReceiptFile':str(path),'runtimeReceiptSha256':pin,
  'leaseReleasedFile':str(p),'leaseReleasedSha256':release,'sourceStarted':False,'sourceRestarted':False,
  'paidAuthority':False,'sourceSelectionChanged':False}


def apply(d,expected):
 r=d.evidence_route
 with ExitStack()as locks:
  locks.enter_context(d.c.source_lease())
  for name in CHAINS:locks.enter_context(d.v.chain_lock(name))
  checked=review(d)
  if sha(encoded(checked))!=expected:fail('exact_fresh_partial_transition_review_required')
  reviewed=old_attempt(d);parent=read(d,r.PARENT,r.PARENT_SHA)
  BASE.mkdir(mode=0o700,exist_ok=True);d.q.sync_directory(BASE.parent)
  d.q.save(BASE/'review.json',checked)
  d.q.save(BASE/'intent.json',{'reviewSha256':expected,'failedReceiptSha256':FAILED_SHA,
   'earliestStartMonotonicUs':d.selective.monotonic_us(),'bootId':d.selective.boot_id(),'automaticRetryAllowed':False})
  try:
   partial(d,parent);r.support_unchanged(d,reviewed['supportAtTransition'])
   public,drop,body,text=r.files('polygon')
   d.ordinary.public_write(d.q,public,body);d.ordinary.public_write(d.q,drop,text)
   d.q.run(['/usr/bin/systemctl','daemon-reload']);restart(d,'polygon')
   actual=r.proxy(d,parent,'polygon',True)
   if actual['invocation']==OBSERVED['polygon'][0]:fail('new_Polygon_proxy_invocation_required')
   d.v.retry(lambda:r.metrics(d,parent,'polygon'))
   path,pin=acknowledge(d,checked,reviewed,parent,None,'evidence-code')
  except BaseException as error:
   d.q.save(BASE/'failed.json',{'failure':d.normal.failure(error),'manualReconcileRequired':True,'automaticRetryAllowed':False})
   raise
 return released(d,'evidence-code',path,pin)


def validate_with(d,receipt_file,receipt_sha):
 r=d.evidence_route;path=Path(receipt_file);selected=path==BASE/'runtime.json';mode='evidence-code'if selected else'rollback'
 if path not in{BASE/'runtime.json',BASE/'rollback-runtime.json'}:fail('fixed_reconciled_runtime_receipt_required')
 value=read(d,path,receipt_sha);checked=read(d,BASE/'review.json',value['reviewSha256']);reviewed=old_attempt(d)
 if (value.get('format')!=FORMAT or value.get('mode')!=mode or checked.get('operatorSha256')!=sha(d.q.protected(Path(__file__).absolute(),200000)) or
     value.get('failedReceiptSha256')!=FAILED_SHA or value.get('failedOperatorSha256')!=OLD_HELPER_SHA or value.get('failedReviewSha256')!=REVIEW_SHA or
     value.get('reviewFile')!=str(BASE/'review.json') or value.get('freeOnly')is not True or value.get('paidAuthority')is not False or
     value.get('permitIds')!=[] or value.get('sourceRestarted')is not False or value.get('sourceSelectionChanged')is not False or
     os.path.lexists(BASE/'rollback-failed.json')or(selected and any(os.path.lexists(BASE/n)for n in['failed.json','rollback-intent.json']))):
  fail('successful_unsuperseded_reconciliation_required')
 release=read(d,BASE/(mode+'-handover-released.json'))
 if release!={'runtimeReceiptSha256':receipt_sha,'sourceAndProxyHandoverLeasesReleased':True}:fail('actual_reconciled_lease_release_required')
 ack=journal(d).latest(mode+'_runtime_acknowledged')
 if ack is None or ack.get('receiptFile')!=str(path)or ack.get('receiptSha256')!=receipt_sha:fail('actual_reconciled_runtime_ACK_required')
 if not selected and os.path.lexists(BASE/'failed.json'):
  if read(d,BASE/'recovery-completed.json')!={'failedSha256':sha(d.q.protected(BASE/'failed.json',100000)),'runtimeReceiptSha256':receipt_sha}:
   fail('actual_reconciled_recovery_ACK_required')
 parent,source=r.captured_source(d,reviewed)
 if recovery_evidence(d)!=checked['recoveryEvidence']:fail('same_fully_verified_recovery_evidence_required')
 if (value['ordinaryRuntime']!=source['ordinaryRuntime']or checked['sourceIdentity']!=source['ordinaryRuntime']or
     value['clock']!=parent['clock']or value['financialHandoff']!=parent['financialHandoff']or
     value['parentRuntimeFile']!=str(r.PARENT)or value['parentRuntimeSha256']!=r.PARENT_SHA or
     value['sourceDefinitionSha256']!=parent['definition']['sha256']or
     value['effectiveRuntime']!={'sourceRuntime':parent['effectiveRuntime'],'evidenceProxyEntries':{
      name:r.ENTRY_SHA if selected else r.original_entry(d,name)[1]for name in CHAINS}}or
     value['proxies']!=r.current_proxies(d,parent,selected)or value['proxyProcesses']!={name:process(d,name)for name in CHAINS}or
     value['supportAtTransition']!=reviewed['supportAtTransition']or value['changedChains']!=list(CHAINS)or
     any(value[k]!=parent[k]for k in['sourceDigest','schema','nativeBuild','profile','parentReferences','runtimeScope'])):
  fail('same_reconciled_source_and_proxy_authority_required')
 if selected:completed_peers(d,parent)
 return {**value,'checkpoints':source['checkpoints'],'leaseReleasedFile':str(BASE/(mode+'-handover-released.json')),
  'leaseReleasedSha256':sha(encoded(release))}


def validate_current(receipt_file,receipt_sha):return validate_with(modules(),receipt_file,receipt_sha)


def restore(d,expected,recovery,support_check=None):
 r=d.evidence_route
 with ExitStack()as locks:
  locks.enter_context(d.c.source_lease())
  for name in CHAINS:locks.enter_context(d.v.chain_lock(name))
  if any(os.path.lexists(BASE/n)for n in['rollback-intent.json','rollback-runtime.json','rollback-failed.json']):fail('one_reconciled_proxy_restoration_only')
  if recovery:
   failed=read(d,BASE/'failed.json',expected)
   if failed.get('manualReconcileRequired')is not True or failed.get('automaticRetryAllowed')is not False:fail('exact_reconciliation_failure_required')
  else:validate_with(d,str(BASE/'runtime.json'),expected)
  reviewed=old_attempt(d);checked=read(d,BASE/'review.json',read(d,BASE/'intent.json')['reviewSha256'])
  parent,source=r.captured_source(d,reviewed);r.check_support(d,reviewed,support_check)
  before={name:r.classify(d,parent,name)for name in CHAINS}
  d.q.save(BASE/'rollback-intent.json',{'inputSha256':expected,'recovery':recovery,'before':before})
  try:
   for name in reversed(CHAINS):
    r.check_support(d,reviewed,support_check)
    if r.classify(d,parent,name)!=before[name]:fail('proxy_changed_before_restoration')
    selected,_,present,terminal=before[name];public,drop,body,text=r.files(name)
    for exists,p,raw in[(present[1],drop,text),(present[0],public,body)]:
     if exists:
      if d.q.protected(p,2000)!=raw:fail('foreign_restore_bytes')
      p.unlink();d.q.sync_directory(p.parent)
    d.q.run(['/usr/bin/systemctl','daemon-reload'])
    if selected or terminal:restart(d,name)
    r.proxy(d,parent,name,False);d.v.retry(lambda:r.metrics(d,parent,name));r.check_support(d,reviewed,support_check)
   path,pin=acknowledge(d,checked,reviewed,parent,source,'rollback',support_check)
   if recovery:d.q.save(BASE/'recovery-completed.json',{'failedSha256':expected,'runtimeReceiptSha256':pin})
  except BaseException as error:
   d.q.save(BASE/'rollback-failed.json',{'failure':d.normal.failure(error),'manualReconcileRequired':True,'automaticRetryAllowed':False})
   raise
 return released(d,'rollback',path,pin)


def main():
 parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group()
 for name in['apply','rollback','recover','validate']:group.add_argument('--'+name)
 args=parser.parse_args();d=modules()
 if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_production_root_required')
 d.q.actual_root_capabilities();os.umask(0o077)
 def interrupted(*_):raise InterruptedError('bounded_reconciliation_interrupted')
 for sig in[signal.SIGALRM,signal.SIGTERM,signal.SIGINT]:signal.signal(sig,interrupted)
 signal.alarm(600)
 try:
  if args.apply:result=apply(d,args.apply)
  elif args.rollback:result=restore(d,args.rollback,False)
  elif args.recover:result=restore(d,args.recover,True)
  elif args.validate:result=validate_with(d,str(BASE/'runtime.json'),args.validate)
  else:
   checked=review(d);result={'reviewHash':sha(encoded(checked)),'binding':checked}
  print(json.dumps(result,sort_keys=True))
 finally:signal.alarm(0)


if __name__=='__main__':main()
