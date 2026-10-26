#!/usr/bin/env python3
"""One explicit read-only optimization measurement over genuine CONT5 checks.

Default/import inert. Root review and --run are required. No qualifier,
baseline, COMMIT, grants, LOGIN, native refresh or service dispatch.
Original failed records and accepted baseline remain immutable.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

BASELINE_RESULT=Path('/tmp/yunipals-cont5-construct-only-baseline-production-20261026-3.json')
FAILED_RESULT=Path('/tmp/yunipals-held8-failure-detail-production-20261026-1.json')
# Root and independent full/delta review and 15 controls passed.
BENCHMARK_SOURCE_REVIEWED=True
METADATA_REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
RESULT=Path('/tmp/yunipals-cont5-readonly-refresh-benchmark-production-20261026-4.json')
PRIOR_BENCHMARK_RESULT=Path('/tmp/yunipals-cont5-readonly-refresh-benchmark-production-20261026-1.json')
RECONCILIATION_RESULT=Path('/tmp/yunipals-cont5-held8-reconcile-production-20261026-1.json')
EXPECTED_REFS={
    'mode':'current',
    'resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
    'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
    'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
    'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'
}

REMOTE=r'''import ast,datetime,sys,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,traceback,types,time
os.umask(0o077)
baseline_local=ACTUAL_CONSTRUCT_BASELINE_RESULT
refs=ACTUAL_METADATA_REFS
failed_local=ACTUAL_HELD8_FAILURE
reconciliation_local=ACTUAL_HELD8_RECONCILIATION
prior_benchmark_local=ACTUAL_PRIOR_READONLY_BENCHMARK_RESULT
TIMER_SHA='99b309b0faeefb1aa7a4525639cbfdd9a2fbeb516a406c5fb5e850b926df3646'
MEMO_SHA='432d52299ad7040c2c587cb6db92b6aba4ff6fffd4d0adad499cfe604b08b9a0'
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
TIMER=OPS/'ypal-readonly-run-duration-v2.py'
MEMO=OPS/'ypal-readonly-sha256-memo-v1.py'
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-readonly-refresh-benchmark-20261026-4')
BASELINE_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
BASELINE_CAPTURE='cont5-baseline-20261026-3'
FAILED_CAPTURE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-8')
FAILED_ROOT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-8')
FAILED_SHA='28d884331e5dbfe5cf5387c2f3af8e7bdbfcc25cdedd31729a57ded8b281bab7'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
CALLER=OPS/'ypal-ordinary-publication-continue-v5.py'
CALLER_SHA='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v5.manifest.json'
MANIFEST_SHA='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v5-20261026')
CACHE_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
OWNER=OPS/'ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST=OPS/'ypal-native-metadata-approval-epoch-v3.manifest.json'
def need(value,code):
 if not value:raise RuntimeError(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None

def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)

def write(name,value):
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);return sha(raw)

def protected(path,digest=None,maximum=16000000):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_actual_root_held_input_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_exact_root_held_input_bytes_required')
 return raw

def document(path,digest=None):return json.loads(protected(path,digest))

def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('root_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value

def file_frame(path,digest):
 raw=protected(path,digest);row=path.lstat()
 need(row.st_dev==2049 and stat.S_IMODE(row.st_mode)==0o600,'actual_private_archive_or_capture_device_mode_required')
 return{'sha256':sha(raw),'device':row.st_dev,'inode':row.st_ino,'mode':row.st_mode,'uid':row.st_uid,'gid':row.st_gid,
  'links':row.st_nlink,'bytes':row.st_size,'mtimeNs':row.st_mtime_ns,'ctimeNs':row.st_ctime_ns}

def fixed_cache_frame(cache):
 fixed={'before.json':('5ec18716b53535f022b0d3c7df6ab984f956ba071003bab72321849a3b235b85',2722766),
  'rehearsal-intent.json':('dc37acae4fcadc4c8c18f63c501352e740d3f2d9040df945cd4a2cc6e0efa9d7',2722767),
  'rehearse-sql-child.json':('67109cac93768c98cfd13ab2f6d3c2bbea1cb1619ca53aeb98974eb81e594390',2722757),
  'rehearse-sql-opened.json':('2335e662038ceb66ed8c6f16c78980cfddf0e7c965a12c69aeef8503fc92b29d',2722769),
  'rehearsed.json':('26099574afa5d4d4d70f1f1c346100aebef2a9e99c2ea51437edb3eb791c3edb',2722770),
  'authorization.json':('fc5cc6bedd21c4e253857d5b2af440f57ea56853a2e23f984c32c3d0784acf5b',2722771)}
 need({p.name for p in cache.BASE.iterdir()}==set(fixed),'exact_accepted_six_baseline_cache_files_required')
 value={name:file_frame(cache.BASE/name,digest)for name,(digest,inode)in fixed.items()}
 need(all(value[name]['inode']==inode for name,(digest,inode)in fixed.items()),'actual_accepted_baseline_file_inodes_required')
 return value

def archive_frame(path,expected):
 row=path.lstat();need({k:getattr(row,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode']}==expected['directory']and
  stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700 and
  {p.name for p in path.iterdir()}==set(expected['files'])=={'before.json','rehearsal-intent.json'},'actual_unchanged_archived_directory_and_two_files_required')
 fixed={'before.json':('a3a0c2a48aad184d3093e0b3d0933d3b798e11d3780cc7acc1d3674a3652ef54',2722747,772495),
  'rehearsal-intent.json':('dc37acae4fcadc4c8c18f63c501352e740d3f2d9040df945cd4a2cc6e0efa9d7',2722748,319)}
 for name,(digest,inode,size)in fixed.items():
  current=file_frame(path/name,digest)
  need(current==expected['files'][name]and current['inode']==inode and current['bytes']==size,'actual_archived_partial_bytes_and_inodes_unchanged_required')

def validate_history(value,root,binding):
 need(value['format']=='root-CONT5-metadata-capture-history-v1'and value['outcome']=='success'and value['exceptionCapture']is None and
  value['readOnlyMemorySnapshot']is True and value['currentObservationsPerformed']==0 and
  all(value[k]is False for k in['stableBindingMutated','timingKeyMutated','approvalClockReset'])and
  len(value['epochs'])==2 and {row['label']for row in value['epochs']}=={'sessionEpoch','cacheEpoch'},'actual_both_Epoch_success_history_required')
 for row in value['epochs']:
  need(row['stableBindingSha256']==binding and row['history']and row['lastAttempts']==row['history'][-1]['attempts'],'actual_full_epoch_capture_binding_required')
  for capture in row['history']:
   need(capture['format']=='yunipals-ypal-ordinary-metadata-current-observation-v1-capture'and capture['inverse']is False and
    capture['effectsRetried']is capture['approvalLifetimeReset']is False and 1<=len(capture['attempts'])<=3 and
    capture['attempts'][-1]['completed']is True and capture['attempts'][-1]['discarded']is False and
    all(a['effectsRetried']is a['partialObservationReused']is False for a in capture['attempts']),
    'actual_f536_capture_domain_no_old_helper3_success_alias_required')
 attempts=[a for row in value['epochs']for capture in row['history']for a in capture['attempts']]
 need(root['metadataEpochInstanceCount']==2 and root['exceptionMetadataCaptureCount']==0 and
  root['metadataCaptureCount']==sum(len(row['history'])for row in value['epochs'])and root['metadataCaptureAttemptCount']==len(attempts)and
  root['metadataDiscardedCaptureCount']==sum(a['discarded']is True for a in attempts),'actual_capture_counts_required')

def capture_histories(outcome,error=None):
 # Read memory only. Do not run another current/source observation or mutate a
 # stable binding/timing key while collecting diagnostics.
 epochs=[];state=vars(session)if session is not None else{}
 for label,epoch in [('sessionEpoch',state.get('metadata_epoch')),
  ('cacheEpoch',vars(state['cache']).get('metadata_epoch')if state.get('cache')is not None else None)]:
  if epoch is not None:
   row=vars(epoch)
   epochs.append({'label':label,'history':row.get('current_capture_history',()),
    'lastAttempts':row.get('current_capture_attempts',()),'stableBindingSha256':sha(encoded(epoch.binding()))})
 exception={'history':getattr(error,'metadata_current_capture_history',()),
  'lastAttempts':getattr(error,'metadata_current_capture_attempts',())}if error is not None else None
 payload={'format':'root-CONT5-metadata-capture-history-v1','outcome':outcome,'epochs':epochs,
  'exceptionCapture':exception,'readOnlyMemorySnapshot':True,'currentObservationsPerformed':0,
  'stableBindingMutated':False,'timingKeyMutated':False,'approvalClockReset':False}
 digest=write('metadata-capture-histories-'+outcome+'.private.json',payload)
 attempts=[attempt for epoch in epochs for capture in epoch['history']for attempt in capture['attempts']]
 return{'metadataCaptureHistorySha256':digest,'metadataEpochInstanceCount':len(epochs),
  'metadataCaptureCount':sum(len(epoch['history'])for epoch in epochs),'metadataCaptureAttemptCount':len(attempts),
  'metadataDiscardedCaptureCount':sum(attempt['discarded']is True for attempt in attempts),
  'exceptionMetadataCaptureCount':len(exception['history'])if exception is not None else 0}

def sql_processes(cache):
 target=os.fsencode(str(cache.ENTRY));rows=[]
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():continue
  try:raw=(path/'cmdline').read_bytes()
  except(FileNotFoundError,ProcessLookupError):continue
  if target in raw.split(b'\0'):rows.append({'pid':int(path.name),'commandSha256':sha(raw)})
 return rows

def same_local_remote(local,remote,digest,allow_failure_annotation=False):
 need(type(local)is dict and type(remote)is dict and local.get('resultSha256')==digest and sha(encoded(remote))==digest,'actual_deliberate_observation_canonical_digest_required')
 expected={**remote,'resultSha256':digest}
 if allow_failure_annotation and 'remoteAuditInspectionRequired'not in remote and 'remoteAuditInspectionRequired'in local:
  need(local['remoteAuditInspectionRequired']is True,'only_exact_true_failure_transport_annotation_permitted')
  expected['remoteAuditInspectionRequired']=True
 need(encoded(local)==encoded(expected),'all_shared_actual_predecessor_fields_and_no_unknown_annotations_required')
started=time.monotonic_ns();stage='initial';proof_hashes={};session=None;capture_summary={};catalog_qualified=False

def deadline(_signum,_frame):raise RuntimeError('root_readonly_refresh_benchmark_deadline_expired_no_retry')
def process_epoch_gone(pid,ticks):
 try:raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text()
 except(FileNotFoundError,ProcessLookupError):return True
 actual=int(raw[raw.rfind(')')+2:].split()[19]);need(actual>0,'actual_live_process_start_ticks_required')
 return actual!=ticks

def failed_capture_frame():
 fixed={'actual-prepared-observation.json': ('578d82456d5e9165c632d538efeabb762b82163734ced5868f4e861aa534c0ee', 2722955, 2282765), 'apply-sql-child.json': ('2b43df59ac28f45947024d828f2044a533426715368deffffd1a6c105d1b5692', 2722953, 374), 'apply-sql-opened.json': ('df30dd1eb6112819db5444c20f8fd12a9e339ab29e535e146e9c26c96c7fd0da', 2722954, 448), 'approval-before-launch.json': ('1405860d4c931302d108c4d978960b88b40ee30910b1ff09d5a93a2b14a85408', 2722952, 8260), 'failure.json': ('e751856cbb8aecb48c98f20bf1c903ab19faa50d4bc432e295f8563f781e34de', 2722956, 318), 'intent.json': ('61a33d72e12e47fab4b97a9e3dac2d89f779c1fd46f4b4e64268d2c9ade1f2fc', 2722951, 22299)}
 need({p.name for p in FAILED_CAPTURE.iterdir()}==set(fixed),'exact_held8_six_capture_files_with_observation_without_complete_callback_or_result_required')
 result={name:file_frame(FAILED_CAPTURE/name,digest)for name,(digest,inode,size)in fixed.items()}
 need(all(result[name]['inode']==inode and result[name]['bytes']==size for name,(digest,inode,size)in fixed.items()),
  'actual_failed_held8_private_file_bytes_and_inodes_required')
 return result

def authenticate_failed():
 failed=document(FAILED_ROOT/'result.json',FAILED_SHA);same_local_remote(failed_local,failed,FAILED_SHA)
 need(failed['format']=='root-CONT5-held-rollback-qualification-v6'and failed['completed']is False and
  failed['rootDriverVariant']=='held8-native-renewal-after-exception-v2'and failed['stage']=='qualify-held-rollback-only'and
  failed['qualifierInvoked']is True and failed['qualifierReturned']is False and failed['heldQualification']is None and
  failed['transactionOutcomeQualified']is False and failed['outcomeReconciliationRequired']is True and
  failed['failureCode']=='complete_actual_held_callback_then_refused_COMMIT_ACK_required'and
  failed['caughtInnerErrorObserved']is True and 'afterExceptionWitnessRefused'not in failed and
  failed['afterExceptionWitnessSourceSha256']=='4e610bb84cb86e526cdee8289ef5677c1de99bb1145d1b5fe891e7458f9da62d'and
  failed['priorHeld7ReconciliationSha256']=='3cb418c0811d8fb8a03aef8b79b0e2c06fba01c6f74405e0c79044e049d438b8'and
  failed['priorHeld7FailureSha256']=='ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f'and
  failed['approvalRenewalHelperSha256']=='512bfd101b682d5d3277a19b4ede927ce594cd74db1bbfa64a821afe4083b65b'and
  failed['approvalRenewalSchedulingOnly']is True and failed['approvalRenewalTimingAuthority']is False and
  failed['passiveOriginalRunObserverRetained']is failed['currentSubprocessRunRestored']is True and
  all(failed[key]is False for key in ['liveTraceInstalled','liveProfileInstalled','SQLParentWrapped','SQLParentPopenOrPipeWrapped',
   'SQLTransportObservationInstalled','transportCountInferredFromMissingObserver'])and
  not({'observedSQLTransportCount','privateSQLStderrBytes','qualificationDiagnosticSha256','privateCallProfileSha256','profiledCallCount'}&set(failed))and
  failed['callerSha256']==CALLER_SHA and failed['readerManifestSha256']==MANIFEST_SHA and failed['metadataRefsSha256']==sha(encoded(refs))and
  failed['priorHeld6FailureSha256']=='c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372'and
  failed['priorHeld6ReconciliationSha256']=='23cb35fa68f1c728eb0d1c7e0e90238755832d434875002c1b849664f901c75d'and
  failed['proofHashes']['baseline-root-result']=='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'and
  all(failed[k]is False for k in['automaticRetryAllowed','realCOMMITDispatched','productionCOMMITQualified','productionPreparedACKCreated','LOGINDispatched','providerRefreshRequested'])and
  failed['serviceActionsDispatched']==0,'actual_failed_unprofiled_HELD8_no_invented_transport_count_or_inner_error_required')
 # The actual v2 witness preserved the caught deadline exception after failure.
 # Its private traceback is evidence of refusal, never callback/COMMIT success.
 protected(FAILED_ROOT/'failure.private.txt',failed['privateDiagnosticSha256'])
 witness=document(FAILED_ROOT/'after-exception-witness.private.json',failed['afterExceptionWitnessSha256'])
 need(witness['format']=='yunipals-ypal-cont5-held-after-exception-v2'and
  witness['actualQualifierFrameMatched']is witness['caughtInnerErrorObserved']is witness['authorityFacadeUsed']is
  witness['actualCacheAuthorityObjectPreserved']is witness['composedQualifierGlobalsQualified']is True and
  witness['innerErrorClass']=='RuntimeError'and witness['innerErrorMessage']=='actual_approval_deadline_before_literal_COMMIT_ACK_requires_rollback'and
  witness['originalV1WitnessPassed']is False and witness['timingQualificationClaimed']is witness['sourceOrMetadataQualified']is
  witness['transactionOutcomeQualified']is witness['originalExceptionReplaced']is witness['retryPerformed']is False,
  'actual_working_v2_witness_caught_deadline_refusal_not_callback_or_COMMIT_authority_required')
 phases=document(FAILED_ROOT/'root-phase-observations.private.json',failed['rootPhaseObservationSha256'])
 need(phases['format']=='root-CONT5-coarse-phase-observation-v1'and phases['liveProfileInstalled']is
  phases['originalClocksChanged']is phases['timingQualificationClaimed']is False and
  type(phases['events'])is list and 1<=len(phases['events'])<=32 and all(row['repeated']is False for row in phases['events'])and
  len([row for row in phases['events']if row['label']=='qualify-held-rollback-only'])==1 and
  next(row for row in phases['events']if row['label']=='qualify-held-rollback-only')['returned']is False,
  'actual_unprofiled_coarse_failed_phase_observations_not_success_timing_authority_required')
 commands=document(FAILED_ROOT/'current-subprocess-diagnostic.private.json',failed['currentSubprocessDiagnosticSha256'])
 need(commands['diagnosticSourceSha256']=='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'and
  commands['subprocessRunRestored']is True and commands['argumentsEnvironmentTimeoutAndOriginalResultsChanged']is commands['automaticRetryAllowed']is False and
  len(commands['calls'])==failed['currentSubprocessCommandCount']<=10000 and
  len(commands['failures'])==failed['currentSubprocessFailureCount']<=1000,
  'actual_passive_original_run_failure_diagnostic_without_Popen_or_trace_required')
 for index,row in enumerate(commands['failures'],1):
  payload=document(FAILED_ROOT/('current-failed-command-'+str(index)+'.json'),row['privateEvidenceSha256'])
  need(payload['summary']=={k:v for k,v in row.items()if k!='privateEvidenceSha256'},'same_actual_private_failed_command_record_required')
 protected(FAILED_ROOT/'metadata-capture-histories-failure.private.json',failed['metadataCaptureHistorySha256'])
 protected(FAILED_ROOT/'source-kernel-traceback-private.json',failed['sourceKernelTracebackSha256'])
 fixed={'actual-prior-aborted':'actual-prior-aborted.private.json','authenticated-baseline-archive':'authenticated-baseline-archive.private.json',
  'authenticated-baseline-metadata-histories':'authenticated-baseline-metadata-histories.private.json',
  'authenticated-baseline-proof-hashes':'authenticated-baseline-proof-hashes.private.json',
  'authenticated-deliberate-observation-ancestry':'authenticated-deliberate-observation-ancestry.private.json',
  'authenticated-held5-failure':'authenticated-held5-failure.private.json','authenticated-held6-reconciliation':'authenticated-held6-reconciliation.private.json',
  'baseline-root-result':'authenticated-baseline-root-result.private.json','held5-catalog-reconciliation':'held5-catalog-reconciliation.private.json',
  'new-full-current-prerequisites':'new-full-current-prerequisites.private.json','new-source-preflight':'new-source-preflight.private.json',
  'untraced-dependency-inspection':'untraced-dependency-inspection.private.json',
  'authenticated-held7-reconciliation':'authenticated-held7-reconciliation.private.json',
  'approval-renewal-scheduling':'approval-renewal-scheduling.private.json'}
 need(set(failed['proofHashes'])==set(fixed),'all_fourteen_actual_failed_HELD8_ancestry_nodes_required')
 for key,name in fixed.items():protected(FAILED_ROOT/name,failed['proofHashes'][key])
 ancestry=document(FAILED_ROOT/'authenticated-held6-reconciliation.private.json',failed['proofHashes']['authenticated-held6-reconciliation'])
 recon=pathlib.Path('/var/backups/yunipals-root-cont5-held6-reconcile-20261026-1')
 old=document(recon/'result.json',failed['priorHeld6ReconciliationSha256'])
 need(ancestry['resultSha256']==failed['priorHeld6ReconciliationSha256']and ancestry['rootResult']==old and
  old['format']=='root-CONT5-held6-reconciliation-v1'and old['completed']is True and
  old['failedHeld6RootResultSha256']==failed['priorHeld6FailureSha256']and
  old['acceptedBaselineRootResultSha256']==baseline_local['resultSha256']and
  old['wholeCatalogQualified']is old['allColumnACLQualified']is old['readerGraphQualified']is old['fullSourcePostflightPassed']is True and
  ancestry['newHeldSuccessAuthority']is ancestry['newTimingAuthority']is ancestry['originalFailureRelabelled']is False,
  'actual_23cb_reconciliation_ancestry_remains_separate_from_failed_HELD8')
 names={'actual-failed-held6':'actual-failed-held6.private.json','baseline-root-result':'authenticated-baseline-root-result.private.json',
  **{name:name+'.private.json'for name in ['authenticated-baseline-metadata-histories','authenticated-baseline-proof-hashes',
   'authenticated-baseline-archive','new-source-preflight','new-full-current-prerequisites','whole-catalog-reconciliation','full-source-postflight']}}
 need(set(old['proofHashes'])==set(names)and ancestry['proofHashes']==old['proofHashes'],'all_nine_original_23cb_proof_nodes_required')
 for key,name in names.items():protected(recon/name,old['proofHashes'][key])
 protected(recon/'metadata-capture-histories-success.private.json',old['metadataCaptureHistorySha256'])
 prior7=authenticate_prior_held7()
 need(encoded(document(FAILED_ROOT/'authenticated-held7-reconciliation.private.json',failed['proofHashes']['authenticated-held7-reconciliation']))==encoded(prior7),
  'same_genuine_3cb_full_reconciliation_inside_failed_HELD8_required')
 scheduling=document(FAILED_ROOT/'approval-renewal-scheduling.private.json',failed['proofHashes']['approval-renewal-scheduling'])
 need(scheduling['format']=='root-CONT5-native-approval-renewal-wait-v1'and scheduling['completed']is scheduling['schedulingOnly']is
  scheduling['genuineNativeWorkerRenewalObserved']is True and all(scheduling[key]is False for key in
  ['actualHeldCallbackQualified','SQLApprovalAuthority','sourceOrMetadataCurrentQualified','timingQualificationClaimed',
   'approvalClockReset','queryOrPredicateRetried','effectsRetried'])and scheduling['sampleCount']==len(scheduling['observations'])and
  1<=scheduling['sampleCount']<=90,'actual_scheduling_evidence_never_new_held_timing_or_SQL_authority_required')
 frame=failed_capture_frame();child=document(FAILED_CAPTURE/'apply-sql-child.json',frame['apply-sql-child.json']['sha256'])
 opened=document(FAILED_CAPTURE/'apply-sql-opened.json',frame['apply-sql-opened.json']['sha256'])
 failure=document(FAILED_CAPTURE/'failure.json',frame['failure.json']['sha256'])
 need(failure['completed']is False and failure['rollbackOnly']is True and failure['failureType']=='RuntimeError'and
  failure['productionCOMMITQualified']is failure['transactionOutcomeQualified']is failure['automaticRetryAllowed']is False,
  'actual_owned_authority_failure_receipt_not_qualified_transaction_outcome_required')
 need(child['mode']=='apply'and child['actor']['pid']==child['processGroup']==1729461 and child['rootParentPid']==1721904 and
  child['actor']['startTicks']==6641980364 and opened['childFileSha256']==frame['apply-sql-child.json']['sha256']and
  opened['message']['mode']=='apply'and opened['message']['xid']=='17079057'and opened['message']['event']=='transaction-opened'and
  opened['message']['format']=='yunipals-ypal-cache-guard-sql-v1'and len(opened['sessions'])==1 and
  opened['sessions'][0]['pid']==1729509 and opened['sessions'][0]['backendStart']=='1792993127942108'and
  opened['message']['backend']=={'pid':1729509,'backendStart':'1792993127942108','clientAddress':None,'clientPort':-1,
    'databaseOid':'17584','roleOid':'10','xid':'17079057'},'exact_actual_HELD8_child_opened_backend_and_XID_chain_required')
 return failed,frame,child,opened


def terminal(cache,host,authority):
 need(process_epoch_gone(1721904,6641947974)and process_epoch_gone(1729461,6641980364),
  'actual_failed_held8_root_and_SQL_child_epochs_must_be_gone')
 need(cache.xact_status(host,'17079057')=='aborted','actual_held8_opened_XID_must_be_aborted')
 backend_sql="SELECT count(*)::int FROM pg_stat_activity WHERE pid=1729509 AND (extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text='1792993127942108' AND datid=17584 AND usesysid=10"
 need(host.query(backend_sql)==0 and host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),
  'actual_held8_backend_epoch_all_APP_sessions_and_SQLentry_processes_must_be_absent')
 publication_sql="SELECT count(*)::int FROM pg_stat_activity WHERE datid=17584 AND application_name='ypal_full_publication_readonly'"
 need(host.query(publication_sql)==0,'original_held8_full_publication_peer_must_be_gone')
 return {'transactionId':'17079057','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,
  'backendEpochGone':True,'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}
def failed7_capture_frame():
    fixed = {'apply-sql-child.json': ('f7946a212e4483d1ca764a107670954bf758e22adc4f1e78e12e8a651355dcbb', 2722913, 374), 'apply-sql-opened.json': ('1bdd71a9fe14259b2636039fb34186943ec7585e527d01ff4179f09df80c2881', 2722904, 448), 'approval-before-launch.json': ('a0445fd1f515dd4856495eed204f3c0f1b7c15c1f4c7434946b2b42c4d30e5ee', 2722908, 8260), 'failure.json': ('e751856cbb8aecb48c98f20bf1c903ab19faa50d4bc432e295f8563f781e34de', 2722905, 318), 'intent.json': ('61a33d72e12e47fab4b97a9e3dac2d89f779c1fd46f4b4e64268d2c9ade1f2fc', 2722903, 22299)}
    need({p.name for p in HELD7_CAPTURE.iterdir()} == set(fixed), 'exact_held7_five_capture_files_without_prepared_or_result_required')
    result = {name: file_frame(HELD7_CAPTURE / name, digest) for name, (digest, inode, size) in fixed.items()}
    need(all((result[name]['inode'] == inode and result[name]['bytes'] == size for name, (digest, inode, size) in fixed.items())), 'actual_failed_held7_private_file_bytes_and_inodes_required')
    return result

def authenticate_failed7_ancestry():
    failed = document(HELD7_ROOT / 'result.json', HELD7_SHA)
    same_local_remote(failed7_local, failed, HELD7_SHA)
    need(failed['format'] == 'root-CONT5-held-rollback-qualification-v5' and failed['completed'] is False and (failed['rootDriverVariant'] == 'held7-unprofiled-after-exception-witness') and (failed['stage'] == 'qualify-held-rollback-only') and (failed['qualifierInvoked'] is True) and (failed['qualifierReturned'] is False) and (failed['heldQualification'] is None) and (failed['transactionOutcomeQualified'] is False) and (failed['outcomeReconciliationRequired'] is True) and (failed['failureCode'] == 'complete_actual_held_callback_then_refused_COMMIT_ACK_required') and (failed['afterExceptionWitnessRefused'] is True) and (failed['afterExceptionWitnessSourceSha256'] == 'ba7e2570888811d741be95d53826e9dd1e71ad5beb3d89cb55cdff1e1c4925c1') and (failed['passiveOriginalRunObserverRetained'] is failed['currentSubprocessRunRestored'] is True) and all((failed[key] is False for key in ['liveTraceInstalled', 'liveProfileInstalled', 'SQLParentWrapped', 'SQLParentPopenOrPipeWrapped', 'SQLTransportObservationInstalled', 'transportCountInferredFromMissingObserver'])) and (not {'observedSQLTransportCount', 'privateSQLStderrBytes', 'qualificationDiagnosticSha256', 'privateCallProfileSha256', 'profiledCallCount'} & set(failed)) and (failed['callerSha256'] == CALLER_SHA) and (failed['readerManifestSha256'] == MANIFEST_SHA) and (failed['metadataRefsSha256'] == sha(encoded(refs))) and (failed['priorHeld6FailureSha256'] == 'c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372') and (failed['priorHeld6ReconciliationSha256'] == '23cb35fa68f1c728eb0d1c7e0e90238755832d434875002c1b849664f901c75d') and (failed['proofHashes']['baseline-root-result'] == '2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195') and all((failed[k] is False for k in ['automaticRetryAllowed', 'realCOMMITDispatched', 'productionCOMMITQualified', 'productionPreparedACKCreated', 'LOGINDispatched', 'providerRefreshRequested'])) and (failed['serviceActionsDispatched'] == 0), 'actual_failed_unprofiled_HELD7_no_invented_transport_count_or_inner_error_required')
    protected(HELD7_ROOT / 'failure.private.txt', failed['privateDiagnosticSha256'])
    protected(HELD7_ROOT / 'after-exception-witness-refusal.private.txt', failed['afterExceptionWitnessRefusalSha256'])
    phases = document(HELD7_ROOT / 'root-phase-observations.private.json', failed['rootPhaseObservationSha256'])
    need(phases['format'] == 'root-CONT5-coarse-phase-observation-v1' and phases['liveProfileInstalled'] is phases['originalClocksChanged'] is phases['timingQualificationClaimed'] is False and (type(phases['events']) is list) and (1 <= len(phases['events']) <= 32) and all((row['repeated'] is False for row in phases['events'])) and (len([row for row in phases['events'] if row['label'] == 'qualify-held-rollback-only']) == 1) and (next((row for row in phases['events'] if row['label'] == 'qualify-held-rollback-only'))['returned'] is False), 'actual_unprofiled_coarse_failed_phase_observations_not_success_timing_authority_required')
    commands = document(HELD7_ROOT / 'current-subprocess-diagnostic.private.json', failed['currentSubprocessDiagnosticSha256'])
    need(commands['diagnosticSourceSha256'] == '2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465' and commands['subprocessRunRestored'] is True and (commands['argumentsEnvironmentTimeoutAndOriginalResultsChanged'] is commands['automaticRetryAllowed'] is False) and (len(commands['calls']) == failed['currentSubprocessCommandCount'] <= 10000) and (len(commands['failures']) == failed['currentSubprocessFailureCount'] <= 1000), 'actual_passive_original_run_failure_diagnostic_without_Popen_or_trace_required')
    for index, row in enumerate(commands['failures'], 1):
        payload = document(HELD7_ROOT / ('current-failed-command-' + str(index) + '.json'), row['privateEvidenceSha256'])
        need(payload['summary'] == {k: v for k, v in row.items() if k != 'privateEvidenceSha256'}, 'same_actual_private_failed_command_record_required')
    protected(HELD7_ROOT / 'metadata-capture-histories-failure.private.json', failed['metadataCaptureHistorySha256'])
    protected(HELD7_ROOT / 'source-kernel-traceback-private.json', failed['sourceKernelTracebackSha256'])
    fixed = {'actual-prior-aborted': 'actual-prior-aborted.private.json', 'authenticated-baseline-archive': 'authenticated-baseline-archive.private.json', 'authenticated-baseline-metadata-histories': 'authenticated-baseline-metadata-histories.private.json', 'authenticated-baseline-proof-hashes': 'authenticated-baseline-proof-hashes.private.json', 'authenticated-deliberate-observation-ancestry': 'authenticated-deliberate-observation-ancestry.private.json', 'authenticated-held5-failure': 'authenticated-held5-failure.private.json', 'authenticated-held6-reconciliation': 'authenticated-held6-reconciliation.private.json', 'baseline-root-result': 'authenticated-baseline-root-result.private.json', 'held5-catalog-reconciliation': 'held5-catalog-reconciliation.private.json', 'new-full-current-prerequisites': 'new-full-current-prerequisites.private.json', 'new-source-preflight': 'new-source-preflight.private.json', 'untraced-dependency-inspection': 'untraced-dependency-inspection.private.json'}
    need(set(failed['proofHashes']) == set(fixed), 'all_twelve_actual_failed_HELD7_ancestry_nodes_required')
    for key, name in fixed.items():
        protected(HELD7_ROOT / name, failed['proofHashes'][key])
    ancestry = document(HELD7_ROOT / 'authenticated-held6-reconciliation.private.json', failed['proofHashes']['authenticated-held6-reconciliation'])
    recon = pathlib.Path('/var/backups/yunipals-root-cont5-held6-reconcile-20261026-1')
    old = document(recon / 'result.json', failed['priorHeld6ReconciliationSha256'])
    need(ancestry['resultSha256'] == failed['priorHeld6ReconciliationSha256'] and ancestry['rootResult'] == old and (old['format'] == 'root-CONT5-held6-reconciliation-v1') and (old['completed'] is True) and (old['failedHeld6RootResultSha256'] == failed['priorHeld6FailureSha256']) and (old['acceptedBaselineRootResultSha256'] == baseline_local['resultSha256']) and (old['wholeCatalogQualified'] is old['allColumnACLQualified'] is old['readerGraphQualified'] is old['fullSourcePostflightPassed'] is True) and (ancestry['newHeldSuccessAuthority'] is ancestry['newTimingAuthority'] is ancestry['originalFailureRelabelled'] is False), 'actual_23cb_reconciliation_ancestry_remains_separate_from_failed_HELD7')
    names = {'actual-failed-held6': 'actual-failed-held6.private.json', 'baseline-root-result': 'authenticated-baseline-root-result.private.json', **{name: name + '.private.json' for name in ['authenticated-baseline-metadata-histories', 'authenticated-baseline-proof-hashes', 'authenticated-baseline-archive', 'new-source-preflight', 'new-full-current-prerequisites', 'whole-catalog-reconciliation', 'full-source-postflight']}}
    need(set(old['proofHashes']) == set(names) and ancestry['proofHashes'] == old['proofHashes'], 'all_nine_original_23cb_proof_nodes_required')
    for key, name in names.items():
        protected(recon / name, old['proofHashes'][key])
    protected(recon / 'metadata-capture-histories-success.private.json', old['metadataCaptureHistorySha256'])
    frame = failed7_capture_frame()
    child = document(HELD7_CAPTURE / 'apply-sql-child.json', frame['apply-sql-child.json']['sha256'])
    opened = document(HELD7_CAPTURE / 'apply-sql-opened.json', frame['apply-sql-opened.json']['sha256'])
    failure = document(HELD7_CAPTURE / 'failure.json', frame['failure.json']['sha256'])
    need(failure['completed'] is False and failure['rollbackOnly'] is True and (failure['failureType'] == 'RuntimeError') and (failure['productionCOMMITQualified'] is failure['transactionOutcomeQualified'] is failure['automaticRetryAllowed'] is False), 'actual_owned_authority_failure_receipt_not_qualified_transaction_outcome_required')
    need(child['mode'] == 'apply' and child['actor']['pid'] == child['processGroup'] == 1684272 and (child['rootParentPid'] == 1677207) and (child['actor']['startTicks'] == 6641740157) and (opened['childFileSha256'] == frame['apply-sql-child.json']['sha256']) and (opened['message']['mode'] == 'apply') and (opened['message']['xid'] == '17049626') and (opened['message']['event'] == 'transaction-opened') and (opened['message']['format'] == 'yunipals-ypal-cache-guard-sql-v1') and (len(opened['sessions']) == 1) and (opened['sessions'][0]['pid'] == 1684303) and (opened['sessions'][0]['backendStart'] == '1792990725881561') and (opened['message']['backend'] == {'pid': 1684303, 'backendStart': '1792990725881561', 'clientAddress': None, 'clientPort': -1, 'databaseOid': '17584', 'roleOid': '10', 'xid': '17049626'}), 'exact_actual_HELD7_child_opened_backend_and_XID_chain_required')
    return (failed, frame, child, opened)

def authenticate_held7_reconciliation():
    root = pathlib.Path('/var/backups/yunipals-root-cont5-held7-reconcile-20261026-1')
    digest = recon7_local.get('resultSha256')
    need(digest == '3cb418c0811d8fb8a03aef8b79b0e2c06fba01c6f74405e0c79044e049d438b8', 'actual_successful_HELD7_reconciliation_SHA_required')
    value = document(root / 'result.json', digest)
    same_local_remote(recon7_local, value, digest)
    need(value['format'] == 'root-CONT5-held7-reconciliation-v1' and value['completed'] is True and (value['stage'] == 'complete') and (value['failedHeld7RootResultSha256'] == 'ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f') and (value['acceptedBaselineRootResultSha256'] == baseline_local['resultSha256'] == '2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195') and (value['transactionId'] == '17049626') and (value['transactionStatus'] == 'aborted') and (value['baselineFileCount'] == 6) and (value['failedCaptureFileCount'] == 5) and all((value[k] is True for k in ['childGone', 'backendGone', 'rootEpochGone', 'wholeCatalogQualified', 'allColumnACLQualified', 'readerGraphQualified', 'fullCurrentQualified', 'fullSourcePostflightPassed', 'allOriginalFileBytesAndInodesUnchanged'])) and (value['callerSha256'] == CALLER_SHA) and (value['readerManifestSha256'] == MANIFEST_SHA) and (value['metadataRefsSha256'] == sha(encoded(refs))) and (value['metadataCurrentProofProducerSha256'] == 'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2') and all((value[k] is False for k in ['automaticRetryAllowed', 'realCOMMITDispatched', 'qualifierDispatched', 'baselineDispatched', 'LOGINDispatched', 'providerRefreshRequested', 'databaseMutationsDispatched', 'newHeldSuccessAuthority', 'newCommitAuthority'])) and (value['databaseWrites'] == value['serviceActions'] == value['providerCalls'] == 0), 'actual_successful_full_HELD7_reconciliation_not_failure_or_new_held_authority_required')
    fixed = {'actual-failed-held7': 'actual-failed-held7.private.json', 'baseline-root-result': 'authenticated-baseline-root-result.private.json', 'authenticated-baseline-metadata-histories': 'authenticated-baseline-metadata-histories.private.json', 'authenticated-baseline-proof-hashes': 'authenticated-baseline-proof-hashes.private.json', 'authenticated-baseline-archive': 'authenticated-baseline-archive.private.json', 'new-source-preflight': 'new-source-preflight.private.json', 'new-full-current-prerequisites': 'new-full-current-prerequisites.private.json', 'whole-catalog-reconciliation': 'whole-catalog-reconciliation.private.json', 'full-source-postflight': 'full-source-postflight.private.json'}
    need(set(value['proofHashes']) == set(fixed) and all((pin(v) for v in value['proofHashes'].values())) and (value['catalogProofSha256'] == value['proofHashes']['whole-catalog-reconciliation']), 'all_nine_actual_HELD7_reconciliation_private_proofs_required')
    proofs = {key: document(root / name, value['proofHashes'][key]) for key, name in fixed.items()}
    base = proofs['baseline-root-result']
    need(base == document(BASELINE_AUDIT / 'result.json', baseline_local['resultSha256']) and encoded(baseline_local) == encoded({**base, 'resultSha256': sha(encoded(base))}) and (proofs['authenticated-baseline-proof-hashes'] == base['proofHashes']), 'same_actual_accepted_baseline3_inside_HELD7_reconciliation_required')
    need(proofs['authenticated-baseline-metadata-histories'] == document(BASELINE_AUDIT / 'metadata-capture-histories-success.private.json', base['metadataCaptureHistorySha256']) and proofs['authenticated-baseline-archive'] == document(BASELINE_AUDIT / 'archive-result.private.json', base['archiveResultSha256']), 'same_actual_baseline_history_and_archive_proof_nodes_required')
    failed, captured, child, opened = authenticate_failed7_ancestry()
    need(proofs['actual-failed-held7'] == failed, 'same_actual_failed_HELD7_root_inside_3cb_reconciliation_required')
    whole = proofs['whole-catalog-reconciliation']
    before = document(CACHE_BASE / 'before.json', base['beforeSha256'])
    expected = before['catalog']
    prior = whole['priorAborted']
    actual = whole['actualCatalog']
    need(whole['failedHeld7RootResultSha256'] == value['failedHeld7RootResultSha256'] and whole['acceptedBaselineRootResultSha256'] == baseline_local['resultSha256'] and (whole['beforeSha256'] == base['beforeSha256']) and (whole['wholeCatalogQualified'] is whole['allColumnACLQualified'] is whole['readerGraphQualified'] is whole['sharedSDKLockHeld'] is True) and (whole['newSQLMutationDispatched'] is whole['newPreparedACKCreated'] is False) and (actual['catalogSha256'] == expected['catalogSha256']) and all((encoded(actual['postProof'][key]) == encoded(expected['postProof'][key]) for key in ['catalog', 'reader', 'allColumnAcl'])) and (prior['validated'] is True) and (prior['bindingSha256'] == base['priorAbortedSha256']) and (prior['binding']['transactionId'] == '16540148') and (prior['binding']['transactionStatus'] == 'aborted') and (prior['binding']['priorChildGone'] is prior['binding']['priorBackendGone'] is True), 'genuine_complete_original_catalog_reader_all_column_ACLs_and_prior_aborted_ancestry_required')
    terminal = {'transactionId': '17049626', 'transactionStatus': 'aborted', 'rootEpochGone': True, 'childEpochGone': True, 'backendEpochGone': True, 'ownerAPPBackendCount': 0, 'matchingSQLentryProcessCount': 0, 'publicationReadBackendCount': 0}
    need(encoded(whole['terminalBefore']) == encoded(whole['terminalAfter']) == encoded(terminal), 'actual_original_HELD7_root_child_backend_and_publication_terminals_required')
    need(set(whole['baselineFiles']) == {'before.json', 'rehearsal-intent.json', 'rehearse-sql-child.json', 'rehearse-sql-opened.json', 'rehearsed.json', 'authorization.json'} and set(whole['failedCaptureFiles']) == {'intent.json', 'approval-before-launch.json', 'apply-sql-child.json', 'apply-sql-opened.json', 'failure.json'}, 'exact_six_baseline_and_five_actual_failed_HELD7_capture_records_required')
    capture = pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-7')
    for directory, rows in [(CACHE_BASE, whole['baselineFiles']), (capture, whole['failedCaptureFiles'])]:
        need({p.name for p in directory.iterdir()} == set(rows), 'actual_reconciled_original_record_population_unchanged_before_new_capture')
        for name, frame in rows.items():
            need(file_frame(directory / name, frame['sha256']) == frame, 'all_reconciled_file_bytes_and_inodes_unchanged_before_new_capture')
    epoch = before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']
    need(proofs['new-full-current-prerequisites']['metadataCurrentProof']['currentNativeMetadataQualified'] is True and encoded(proofs['new-full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']) == encoded(epoch) and (proofs['full-source-postflight']['metadataActorCurrent']['currentActorQualified'] is True) and (encoded(proofs['full-source-postflight']['metadataEpoch']) == encoded(epoch)), 'genuine_reconciliation_full_current_and_source_postflight_same_metadata_epoch_required')
    history = document(root / 'metadata-capture-histories-success.private.json', value['metadataCaptureHistorySha256'])
    validate_history(history, value, sha(encoded(epoch)))
    return {'reconciliationSourceSha256': '3598beaba67b32c5109b5ef1587d1d0e64e46f015b2a24d97f1838eeab4c9104', 'resultSha256': digest, 'rootResult': value, 'proofHashes': value['proofHashes'], 'metadataHistorySha256': value['metadataCaptureHistorySha256'], 'originalFailedHELD7ProofHashes': failed['proofHashes'], 'originalFailureDiagnosticHashes': {key: failed[key] for key in ['privateDiagnosticSha256', 'afterExceptionWitnessRefusalSha256', 'metadataCaptureHistorySha256', 'rootPhaseObservationSha256', 'currentSubprocessDiagnosticSha256', 'sourceKernelTracebackSha256']}, 'newHeldSuccessAuthority': False, 'newTimingAuthority': False, 'originalFailureRelabelled': False}

def authenticate_prior_held7():
 global recon7_local,failed7_local,HELD7_ROOT,HELD7_CAPTURE,HELD7_SHA
 HELD7_ROOT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-7')
 HELD7_CAPTURE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-7')
 HELD7_SHA='ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f'
 failed7_local={**document(HELD7_ROOT/'result.json',HELD7_SHA),'resultSha256':HELD7_SHA}
 digest='3cb418c0811d8fb8a03aef8b79b0e2c06fba01c6f74405e0c79044e049d438b8'
 root=pathlib.Path('/var/backups/yunipals-root-cont5-held7-reconcile-20261026-1')
 recon7_local={**document(root/'result.json',digest),'resultSha256':digest}
 return authenticate_held7_reconciliation()

def authenticate_prepared_observation(cache,before,rehearsed,opened):
 row=document(FAILED_CAPTURE/'actual-prepared-observation.json','578d82456d5e9165c632d538efeabb762b82163734ced5868f4e861aa534c0ee')
 need(type(row)is dict and set(row)=={'neverProductionPreparedACK','value','valueJson'}and row['neverProductionPreparedACK']is True and
  type(row['valueJson'])is str and type(row['value'])is dict and encoded(json.loads(row['valueJson']))==encoded(row['value'])and
  cache.js_encoded(json.loads(row['valueJson'])).decode()==row['valueJson']and
  sha(row['valueJson'].encode())=='6b1c44228a1462170eca1899765c035c5e3a394c1d042266152c1b7c9aed6f30',
  'exact_actual_failed_HELD8_prepared_packet_and_original_JS_encoding_required')
 value=row['value']
 need(value['format']=='yunipals-ypal-cache-guard-sql-v1'and value['event']=='commit-prepared'and value['mode']=='apply'and
  value['xid']==opened['message']['xid']=='17079057'and
  value['planSha256']==sha(rehearsed['sql']['resultJson'].encode())and
  encoded(json.loads(value['beforeJson']))==encoded(value['before'])and encoded(json.loads(value['afterJson']))==encoded(value['after']),
  'exact_prepared_observation_mode_XID_and_actual_baseline_rehearsal_plan_required')
 # This complete pure catalog comparator authenticates the observation only.
 # Original Host refresh/current/callback deadline is not claimed passed here.
 cache.read_extension(before['catalog']['postProof']['catalog'],value['postProof']['catalog'],
  rehearsed['sql']['result'],value['postProof']['catalog'])
 return {'preparedObservationFileSha256':'578d82456d5e9165c632d538efeabb762b82163734ced5868f4e861aa534c0ee',
  'packetSha256':sha(row['valueJson'].encode()),'transactionId':value['xid'],'actualPreparedObservationAuthenticated':True,
  'neverProductionPreparedACK':True,'completeHeldCallbackQualified':False,'productionCOMMITQualified':False,
  'productionPreparedACKCreated':False,'newCommitAuthority':False,'newHeldSuccessAuthority':False}


def authenticate_reconciliation8():
 digest='3acb03de0673bc48df2760f08c38d3a4ffe6c55b2f80aebb0e64e8616fd837eb'
 root=pathlib.Path('/var/backups/yunipals-root-cont5-held8-reconcile-20261026-1')
 value=document(root/'result.json',digest);same_local_remote(reconciliation_local,value,digest)
 need(value['format']=='root-CONT5-held8-reconciliation-v1'and value['completed']is True and value['stage']=='complete'and
  value['failedHeld8RootResultSha256']==FAILED_SHA and value['acceptedBaselineRootResultSha256']==baseline_local['resultSha256']and
  value['transactionId']=='17079057'and value['transactionStatus']=='aborted'and value['baselineFileCount']==value['failedCaptureFileCount']==6 and
  all(value[k]is True for k in ['childGone','backendGone','rootEpochGone','wholeCatalogQualified','allColumnACLQualified','readerGraphQualified',
   'fullCurrentQualified','fullSourcePostflightPassed','allOriginalFileBytesAndInodesUnchanged','actualPreparedObservationAuthenticated'])and
  all(value[k]is False for k in ['automaticRetryAllowed','realCOMMITDispatched','qualifierDispatched','baselineDispatched','LOGINDispatched',
   'providerRefreshRequested','databaseMutationsDispatched','newHeldSuccessAuthority','newCommitAuthority',
   'completeHeldCallbackQualified','productionPreparedACKCreated'])and value['databaseWrites']==value['serviceActions']==value['providerCalls']==0 and
  value['callerSha256']==CALLER_SHA and value['readerManifestSha256']==MANIFEST_SHA and value['metadataRefsSha256']==sha(encoded(refs)),
  'actual_complete_3acb_HELD8_recovery_only_no_callback_ACK_or_commit_authority_required')
 fixed={'actual-failed-held8':'actual-failed-held8.private.json','actual-prepared-observation':'actual-prepared-observation.private.json',
  'baseline-root-result':'authenticated-baseline-root-result.private.json',
  **{name:name+'.private.json'for name in ['authenticated-baseline-metadata-histories','authenticated-baseline-proof-hashes',
   'authenticated-baseline-archive','new-source-preflight','new-full-current-prerequisites','whole-catalog-reconciliation','full-source-postflight']}}
 need(set(value['proofHashes'])==set(fixed)and all(pin(v)for v in value['proofHashes'].values())and
  value['catalogProofSha256']==value['proofHashes']['whole-catalog-reconciliation'],'all_ten_actual_reconciliation8_proof_nodes_required')
 proofs={key:document(root/name,value['proofHashes'][key])for key,name in fixed.items()}
 base=proofs['baseline-root-result'];need(encoded(base)==encoded(document(BASELINE_AUDIT/'result.json',baseline_local['resultSha256']))and
  encoded(baseline_local)==encoded({**base,'resultSha256':sha(encoded(base))})and proofs['authenticated-baseline-proof-hashes']==base['proofHashes'],
  'same_accepted_actual_baseline3_inside_reconciliation8_required')
 need(proofs['authenticated-baseline-metadata-histories']==document(BASELINE_AUDIT/'metadata-capture-histories-success.private.json',base['metadataCaptureHistorySha256'])and
  proofs['authenticated-baseline-archive']==document(BASELINE_AUDIT/'archive-result.private.json',base['archiveResultSha256']),
  'same_actual_baseline_metadata_history_and_archive_inside_recovery_required')
 need(encoded(proofs['actual-failed-held8'])==encoded({k:v for k,v in failed_local.items()if k!='resultSha256'}),
  'same_actual_failed_HELD8_root_inside_reconciliation8_required')
 whole=proofs['whole-catalog-reconciliation'];before=document(CACHE_BASE/'before.json',base['beforeSha256']);expected=before['catalog']
 actual=whole['actualCatalog'];prior=whole['priorAborted']
 need(whole['failedHeld8RootResultSha256']==FAILED_SHA and whole['acceptedBaselineRootResultSha256']==baseline_local['resultSha256']and
  whole['beforeSha256']==base['beforeSha256']and whole['wholeCatalogQualified']is whole['allColumnACLQualified']is
  whole['readerGraphQualified']is whole['sharedSDKLockHeld']is True and whole['newSQLMutationDispatched']is whole['newPreparedACKCreated']is False and
  actual['catalogSha256']==expected['catalogSha256']and all(encoded(actual['postProof'][key])==encoded(expected['postProof'][key])for key in ['catalog','reader','allColumnAcl'])and
  prior['validated']is True and prior['bindingSha256']==base['priorAbortedSha256']and prior['binding']['transactionId']=='16540148'and
  prior['binding']['transactionStatus']=='aborted'and prior['binding']['priorChildGone']is prior['binding']['priorBackendGone']is True,
  'actual_full_recovered_original_catalog_all_column_ACLs_and_reader_graph_required')
 terminal={'transactionId':'17079057','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,'backendEpochGone':True,
  'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}
 need(encoded(whole['terminalBefore'])==encoded(whole['terminalAfter'])==encoded(terminal),'actual_recovered_HELD8_terminal_epochs_required')
 need(set(whole['baselineFiles'])=={'before.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json','rehearsed.json','authorization.json'}and
  set(whole['failedCaptureFiles'])=={'intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json','failure.json','actual-prepared-observation.json'},
  'exact_six_baseline_and_six_failed8_capture_records_required')
 for directory,rows in [(CACHE_BASE,whole['baselineFiles']),(FAILED_CAPTURE,whole['failedCaptureFiles'])]:
  need({p.name for p in directory.iterdir()}==set(rows),'actual_recovered_file_population_unchanged_before_readonly_benchmark')
  for name,frame in rows.items():need(file_frame(directory/name,frame['sha256'])==frame,'all_recovered_file_bytes_and_inodes_unchanged_required')
 observed=proofs['actual-prepared-observation']
 need(observed['preparedObservationFileSha256']==whole['failedCaptureFiles']['actual-prepared-observation.json']['sha256']==
  '578d82456d5e9165c632d538efeabb762b82163734ced5868f4e861aa534c0ee'and
  observed['packetSha256']=='6b1c44228a1462170eca1899765c035c5e3a394c1d042266152c1b7c9aed6f30'and
  observed['transactionId']=='17079057'and observed['actualPreparedObservationAuthenticated']is observed['neverProductionPreparedACK']is True and
  all(observed[k]is False for k in ['completeHeldCallbackQualified','productionCOMMITQualified','productionPreparedACKCreated','newCommitAuthority','newHeldSuccessAuthority']),
  'actual_prepared_observation_remains_non_ACK_non_callback_authority')
 epoch=before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']
 need(proofs['new-full-current-prerequisites']['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  encoded(proofs['new-full-current-prerequisites']['metadataCurrentProof']['metadataEpoch'])==encoded(epoch)and
  proofs['full-source-postflight']['metadataActorCurrent']['currentActorQualified']is True and
  encoded(proofs['full-source-postflight']['metadataEpoch'])==encoded(epoch),'actual_recovery_full_current_and_Source_epoch_required')
 history=document(root/'metadata-capture-histories-success.private.json',value['metadataCaptureHistorySha256'])
 validate_history(history,value,sha(encoded(epoch)))
 return {'resultSha256':digest,'rootResult':value,'proofHashes':value['proofHashes'],'metadataHistorySha256':value['metadataCaptureHistorySha256'],
  'newCurrentAuthority':False,'newHeldSuccessAuthority':False,'newTimingAuthority':False,'newCommitAuthority':False}


def authenticate_prior_readonly_benchmark():
 root=pathlib.Path('/var/backups/yunipals-root-cont5-readonly-refresh-benchmark-20261026-1')
 digest='27af1b44e25c9133d973ea6debef6b99d5dff40ed5b1ace4865c49cfc69e684d'
 value=document(root/'result.json',digest);same_local_remote(prior_benchmark_local,value,digest)
 need(value['format']=='root-CONT5-readonly-refresh-benchmark-v1'and value['completed']is True and value['stage']=='complete'and
  value['readOnlyBenchmarkOnly']is value['fullSourcePostflightPassed']is value['allOriginalFileBytesAndInodesUnchanged']is True and
  value['reconciliationResultSha256']=='3acb03de0673bc48df2760f08c38d3a4ffe6c55b2f80aebb0e64e8616fd837eb'and
  all(value[key]is False for key in ['actualHeldCallbackQualified','timingQualificationClaimed','newCurrentAuthority','newHeldSuccessAuthority',
   'newCommitAuthority','preparedCallbackDispatched','qualifierDispatched','realCOMMITDispatched','databaseMutationsDispatched','LOGINDispatched'])and
  value['callerSha256']==CALLER_SHA and value['readerManifestSha256']==MANIFEST_SHA and value['metadataRefsSha256']==sha(encoded(refs)),
  'actual_prior_readonly_measurement_is_diagnostic_ancestry_only_never_current_or_held_authority')
 return {'resultSha256':digest,'rootResult':value,'diagnosticReferenceOnly':True,'newCurrentAuthority':False,'newTimingAuthority':False,
  'newHeldSuccessAuthority':False,'newCommitAuthority':False}

measurement_phases=[];duration_observer=None;memo_observer=None;bare_subprocess_run=None;memo_counter_phases=[];memo_counter_capture_errors=0;duration_snapshot_saved=False;duration_saved_summary=None

def measured_call(label,fn):
 row={'label':label,'returned':False,'repeated':False};measurement_phases.append(row)
 wall=time.perf_counter_ns();cpu=time.process_time_ns()
 row.update(startedPerfCounterNanoseconds=wall,startedParentCPUNanoseconds=cpu)
 try:
  value=fn();row['returned']=True;return value
 except BaseException as error:
  row['errorClass']=type(error).__name__;raise
 finally:
  ended=time.perf_counter_ns();ended_cpu=time.process_time_ns()
  row.update(endedPerfCounterNanoseconds=ended,endedParentCPUNanoseconds=ended_cpu,
   wallNanoseconds=ended-wall,parentCPUNanoseconds=ended_cpu-cpu)

def record_memo_counters(label):
 global memo_counter_capture_errors
 # Fixed scalar counter copies only: no live snapshot, bytes, facts or writes.
 try:
  counters=dict(memo_observer.counts)
  need(all(type(key)is str and type(value)is int and value>=0 for key,value in counters.items()),
   'fixed_nonnegative_scalar_memo_counters_required')
  memo_counter_phases.append({'label':label,'capturedPerfCounterNanoseconds':time.perf_counter_ns(),
   'counters':counters,'currentOrTimingAuthority':False})
 except (MemoryError,OSError,TypeError,ValueError,AttributeError,OverflowError):
  try:memo_counter_capture_errors+=1
  except (MemoryError,OSError,TypeError,ValueError,AttributeError,OverflowError):pass

def observe_refresh_and_prerequisites(host):
 need(sys.gettrace()is None and sys.getprofile()is None,'unprofiled_untraced_readonly_benchmark_required')
 need(memo_observer.active is True,'same_active_fresh_byte_memo_scope_required')
 record_memo_counters('before-explicit-pair')
 try:
  with duration_observer:
   measured_call('host-refresh',host.refresh)
   return measured_call('host-prerequisites',host.prerequisites)
 finally:record_memo_counters('after-explicit-pair')

def save_duration_observation():
 global duration_snapshot_saved,duration_saved_summary
 # Reuse only this same already-persisted diagnostic summary, never a proof.
 if duration_saved_summary is not None:return dict(duration_saved_summary)
 if duration_observer is None or memo_observer is None:return {}
 memo_snapshot=memo_observer.snapshot()
 need(memo_snapshot['originalSHA256Restored']is memo_snapshot['privatePayloadsReleased']is True and
  memo_snapshot['SHA256HookChangedDuringScope']is memo_snapshot['sourceOrActorOrCatalogOrReadinessFactsCached']is
  memo_snapshot['compileJSONApplicationOrProfileHooksInstalled']is memo_snapshot['deadlinesChanged']is False,
  'bare_original_SHA256_restored_and_private_payload_released_before_diagnostics_and_full_Source_postflight_required')
 snapshot=duration_observer.snapshot()
 timer_entered=duration_observer.entered
 timer_never_replaced=not timer_entered and subprocess.run is bare_subprocess_run and duration_observer.original is None and duration_observer.active is False
 need(timer_entered or timer_never_replaced,'never_entered_run_observer_requires_actual_unchanged_original_run_object')
 need((snapshot['subprocessRunRestored']is True if timer_entered else snapshot['subprocessRunRestored']is False) and snapshot['liveTraceInstalled']is snapshot['liveProfileInstalled']is
  snapshot['PopenOrPipeOrSQLParentWrapped']is snapshot['argumentsEnvironmentTimeoutAndOriginalResultsChanged']is snapshot['runHookChangedDuringScope']is False,
  'entered_run_observer_restored_or_truthful_never_entered_before_any_private_duration_serialization_required')
 snapshot.update(timerNeverEntered=not timer_entered,subprocessRunNeverReplaced=timer_never_replaced)
 digest=write('readonly-run-durations.private.json',snapshot)
 memo_digest=write('readonly-SHA256-memo.private.json',memo_snapshot)
 counters=write('readonly-SHA256-memo-counter-phases.private.json',{'format':'root-CONT5-readonly-SHA256-memo-counter-phases-v1',
  'phases':memo_counter_phases,'counterCaptureErrors':memo_counter_capture_errors,
  'scopeIncludesGenuineSessionPreflightAndCacheContext':True,'plannedExplicitTopLevelCalls':['host-refresh','host-prerequisites'],
  'currentOrTimingAuthority':False})
 phases=write('readonly-measurement-phases.private.json',{'format':'root-CONT5-readonly-measurement-phases-v1',
  'events':measurement_phases,'mainCPUClock':'process_time_ns-parent-only','wallClock':'perf_counter_ns',
  'timingQualificationClaimed':False,'actualHeldCallbackQualified':False})
 duration_snapshot_saved=True
 paired={row['label']:row['counters']for row in memo_counter_phases}
 pair_complete=memo_counter_capture_errors==0 and set(paired)=={'before-genuine-Session','before-explicit-pair','after-explicit-pair'}
 pair_counts={key:paired['after-explicit-pair'][key]-paired['before-explicit-pair'][key]for key in
  ['cacheHits','cacheLookupMisses','originalConstructorCalls','largeInputBytesAvoidedByHits','largeInputBytesSubmittedToOriginal']}if pair_complete else None
 duration_saved_summary={'privateRunDurationsSha256':digest,'privateSHA256MemoSha256':memo_digest,
  'privateSHA256MemoCounterPhasesSha256':counters,'memoCounterCaptureErrors':memo_counter_capture_errors,
  'completeMemoCounterBoundaries':pair_complete,'memoExplicitPairCounters':pair_counts,
  'memoPrefixCacheHits':paired['before-explicit-pair']['cacheHits']if pair_complete else None,
  'memoScopeCacheHits':memo_snapshot['cacheHits'],'memoScopeBytesAvoidedByHits':memo_snapshot['largeInputBytesAvoidedByHits'],
  'memoBookkeepingErrors':memo_snapshot['bookkeepingErrors'],'memoPeakRetainedPayloadBytes':memo_snapshot['peakRetainedPayloadBytes'],
  'memoMaximumPayloadBytes':memo_snapshot['maximumPayloadBytes'],'memoMaximumEntries':memo_snapshot['maximumEntries'],
  'memoForeignThreadCallsDelegated':memo_snapshot['foreignThreadCallsDelegated'],
  'originalSHA256Restored':memo_snapshot['originalSHA256Restored'],'privateMemoPayloadsReleased':memo_snapshot['privatePayloadsReleased'],
  'fixedPublicBridgeFamilyCallCount':sum(row.get('publicCommandFamily')=='generation-recovery-read-bridge'for row in snapshot['calls']),
  'bridgePhaseClassified':False,'privateMeasurementPhasesSha256':phases,'observedRunCount':len(snapshot['calls']),
  'durationRecordsDropped':snapshot['droppedCalls'],'durationBookkeepingErrors':snapshot['bookkeepingErrors'],
  'foreignThreadRunCount':snapshot['foreignThreadCalls'],'subprocessRunRestored':snapshot['subprocessRunRestored'],
  'timerNeverEntered':not timer_entered,'subprocessRunNeverReplaced':timer_never_replaced,
  'completeRunDurationCoverage':timer_entered and snapshot['droppedCalls']==snapshot['bookkeepingErrors']==snapshot['foreignThreadCalls']==0}
 return dict(duration_saved_summary)

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
need(not os.path.lexists(AUDIT),'fresh_exclusive_readonly_refresh_benchmark_audit_required')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(880)
try:
 stage='authenticate-actual-completed-HELD8-recovery'
 proof_hashes['authenticated-held8-reconciliation']=write('authenticated-held8-reconciliation.private.json',authenticate_reconciliation8())
 proof_hashes['diagnostic-readonly-benchmark-ancestor']=write('diagnostic-readonly-benchmark-ancestor.private.json',authenticate_prior_readonly_benchmark())
 stage='authenticate-failed-held8';failed,failed_frame,child,opened=authenticate_failed()
 proof_hashes['actual-failed-held8']=write('actual-failed-held8.private.json',failed)
 stage='authenticate-completed-construct-only3-baseline'
 baseline_root=document(BASELINE_AUDIT/'result.json',baseline_local['resultSha256'])
 need(baseline_local=={**baseline_root,'resultSha256':sha(protected(BASELINE_AUDIT/'result.json'))}and
  baseline_root['format']=='root-CONT5-construct-only-baseline-v1'and baseline_root['completed']is True and
  baseline_root['fullCurrentQualifiedByGenuineConstruct']is baseline_root['baselineCompleted']is True and
  baseline_root['historicalSchedulingEvidenceOnly']is True and baseline_root['newCadenceObservationPerformed']is baseline_root['approvalLifetimeReset']is False and
  baseline_root['baselineCaptureId']==BASELINE_CAPTURE and baseline_root['callerSha256']==CALLER_SHA and
  baseline_root['readerManifestSha256']==MANIFEST_SHA and baseline_root['metadataRefsSha256']==sha(encoded(refs))and
  baseline_root['priorReadPreparationResultSha256']=='ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'and
  baseline_root['priorQualificationReconciliationSha256']=='80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125'and
  baseline_root['metadataCurrentProofProducerSha256']=='f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2'and
  all(baseline_root[k]is False for k in['automaticRetryAllowed','realCOMMITDispatched','LOGINDispatched','heldApplyDispatched','heldQualificationPerformed','providerRefreshRequested','historicalCONT4BaselineReusedAsCurrent'])and baseline_root['serviceActionsDispatched']==0,
  'actual_complete_construct_only3_baseline_not_old_failed_baseline_or_scheduling_SQL_authority_required')
 proof_hashes['baseline-root-result']=write('authenticated-baseline-root-result.private.json',baseline_root)
 fixed={'historical-scheduling-evidence':'historical-scheduling-evidence.private.json','context':'context.private.json',
  'metadata-ack':'metadata-ack.private.json','source-preflight':'source-preflight.private.json',
  'original-catalog-reconciliation':'original-catalog-reconciliation.private.json',
  'archive-intent':'archive-intent.private.json','archive-result':'archive-result.private.json','baseline':'baseline-result.private.json'}
 need(set(baseline_root['proofHashes'])==set(fixed),'all_eight_actual_construct_only3_proof_hashes_required')
 proofs={key:document(BASELINE_AUDIT/name,baseline_root['proofHashes'][key])for key,name in fixed.items()}
 historical=proofs['historical-scheduling-evidence']
 need(historical['rootResultSha256']==baseline_root['priorReadPreparationResultSha256']and historical['sampleCount']==31 and historical['checkedAtAdvanceCount']>=2 and
  historical['schedulingEvidenceOnly']is True and all(historical[k]is False for k in['newCurrentAuthority','newBaselineAuthority','SQLApprovalAuthority','approvalLifetimeReset']),
  'historical_cadence_is_only_scheduling_evidence_never_current_or_held_authority')
 old_audit=pathlib.Path('/var/backups/yunipals-root-cont5-current-cadence-baseline-20261026-2')
 cadence=document(old_audit/'accepted-cadence.private.json',historical['acceptedCadenceSha256'])
 need(cadence['accepted']is cadence['allSamplesAccepted']is cadence['samplerStopped']is True and
  cadence['sampleCount']==31 and cadence['checkedAtAdvanceCount']==historical['checkedAtAdvanceCount']and
  150_000_000_000<=cadence['durationNanoseconds']<180_000_000_000,'actual_previous_normal_scheduling_observation_required')
 archive=proofs['archive-result'];intent=proofs['archive-intent'];reconciled=proofs['original-catalog-reconciliation']
 need(archive['format']==intent['format']=='root-CONT5-preSQL-archive-v1'and archive['source']==intent['source']==str(CACHE_BASE)and
  archive['destination']==intent['destination']==str(BASELINE_AUDIT/'partial-cache-before-archive')and
  archive['partialFrame']==intent['partialFrame']and archive['capture2IntentFrame']==intent['capture2IntentFrame']and
  archive['originalCatalogProofSha256']==intent['originalCatalogProofSha256']==baseline_root['proofHashes']['original-catalog-reconciliation']and
  baseline_root['archiveResultSha256']==baseline_root['proofHashes']['archive-result']and
  all(archive[k]is True for k in['archived','sourceAbsent','directoryAndFileInodesPreserved','capture2IntentUnchanged','sharedSDKLockHeldDuringReconciliationAndArchive','genuineConstructWillAcquireOwnLockAfterThisLockReleases'])and
  all(archive[k]is False for k in['acceptedBaselineClaimed','oldFilesCopied','oldFilesOverwritten','newSQLDispatched'])and
  reconciled['wholeCatalogQualified']is reconciled['allColumnACLQualified']is True and reconciled['ownedAPPBackendCount']==reconciled['matchingSQLentryProcessCount']==0,
  'actual_owned_preSQL_archive_not_copied_fresh_baseline_and_full_reconciliation_required')
 archive_frame(BASELINE_AUDIT/'partial-cache-before-archive',archive['partialFrame'])
 capture2=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-baseline-20261026-2/intent.json')
 need(file_frame(capture2,archive['capture2IntentFrame']['sha256'])==archive['capture2IntentFrame'],
  'actual_old_capture2_intent_preserved_around_new_baseline_required')
 baseline=proofs['baseline']
 need(baseline['completed']is True and baseline['action']=='construct-records'and baseline['captureId']==BASELINE_CAPTURE and
  baseline['sha256']==baseline_root['baselineReceiptSha256']and
  all(baseline[k]==baseline_root[k]for k in['beforeSha256','rehearsedSha256','authorizationSha256','actualNewRehearsalXID','priorAbortedSha256'])and
  baseline['productionPreparedACKCreated']is baseline['productionCOMMITQualified']is baseline['newStopActionPerformed']is False and
  proofs['context']['metadataRefs']==refs and proofs['context']['cacheInputSha256']==CACHE_INPUT_SHA,
  'genuine_new_baseline3_SQL_ROLLBACK_receipt_and_same_owned_epoch_required')
 before=document(CACHE_BASE/'before.json',baseline['beforeSha256']);metadata=before['binding']['prerequisites']['metadataCurrentProof']
 need(before['binding']['operatorSha256']=='30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326'and
  metadata['currentNativeMetadataQualified']is True and baseline['fullSourcePostflight']['metadataEpoch']==metadata['metadataEpoch']and
  baseline['fullSourcePostflight']['metadataActorCurrent']['currentActorQualified']is True,
  'actual_original_construct_full_current_and_source_postflight_not_historical_cadence_authority')
 expected_binding=sha(encoded(metadata['metadataEpoch']))
 history=document(BASELINE_AUDIT/'metadata-capture-histories-success.private.json',baseline_root['metadataCaptureHistorySha256'])
 validate_history(history,baseline_root,expected_binding)
 profile=document(BASELINE_AUDIT/'call-profile.private.json',baseline_root['privateCallProfileSha256'])
 need(profile['format']=='yunipals-ypal-ordinary-call-profile-v1'and len(profile['events'])==baseline_root['profiledCallCount']and
  profile['droppedCalls']==baseline_root['profiledCallsDropped']and profile['observationErrors']==baseline_root['profileObservationErrors']and
  all(profile[k]is False for k in['functionCodeChanged','argumentsChanged','returnValuesChanged','approvalClockReset','timingQualificationClaimed','effectsRetried']),
  'actual_new_baseline3_private_profile_not_timing_authority_required')
 sql_observed=document(BASELINE_AUDIT/'baseline-SQL-observation.private.json',baseline_root['baselineSQLObservationSha256'])
 need(sql_observed['format']=='root-CONT5-baseline-SQL-observation-v1'and sql_observed['wholeParentCodeUnchanged']is sql_observed['parentRestored']is True and
  len(sql_observed['transports'])==baseline_root['baselineObservedSQLTransportCount']>=1 and
  sum(row['capturedBytes']for row in sql_observed['transports'])==baseline_root['baselinePrivateSQLStderrBytes']and
  all(sql_observed[k]is False for k in['SQLBytesChanged','predicatesChanged','deadlinesChanged','clockReset','effectOrCaptureRetried','newQualificationAuthorityConferred']),
  'actual_new_baseline3_normal_SQL_observation_required')
 commands=document(BASELINE_AUDIT/'current-subprocess-diagnostic.private.json',baseline_root['currentSubprocessDiagnosticSha256'])
 need(commands['diagnosticSourceSha256']=='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'and
  commands['subprocessRunRestored']is baseline_root['currentSubprocessRunRestored']is True and
  commands['argumentsEnvironmentTimeoutAndOriginalResultsChanged']is commands['automaticRetryAllowed']is False and
  len(commands['calls'])==baseline_root['currentSubprocessCommandCount']<=10000 and
  len(commands['failures'])==baseline_root['currentSubprocessFailureCount']<=1000,'actual_baseline3_current_command_diagnostic_required')
 for index,row in enumerate(commands['failures'],1):
  payload=document(BASELINE_AUDIT/('current-failed-command-'+str(index)+'.json'),row['privateEvidenceSha256'])
  need(payload['summary']=={k:v for k,v in row.items()if k!='privateEvidenceSha256'},'same_private_current_command_evidence_required')
 proof_hashes['authenticated-baseline-metadata-histories']=write('authenticated-baseline-metadata-histories.private.json',history)
 proof_hashes['authenticated-baseline-proof-hashes']=write('authenticated-baseline-proof-hashes.private.json',baseline_root['proofHashes'])
 proof_hashes['authenticated-baseline-archive']=write('authenticated-baseline-archive.private.json',archive)
 stage='authenticate-live-programs'
 source_manifest=document(MANIFEST,MANIFEST_SHA)
 for name,digest in {**source_manifest['dependencies'],**source_manifest['files']}.items():
  need(pathlib.Path(name).name==name and pin(digest),'finite_actual_reader5_public_source_required');protected(OPS/name,digest)
 protected(OWNER_MANIFEST,refs['manifestSha256'])
 owner=load(OWNER,refs['producerSha256']);caller=load(CALLER,CALLER_SHA)
 report=document(REPORT,REPORT_SHA);need(report['cacheInputsSha256']==CACHE_INPUT_SHA,'same_actual_original_cache_input_required')
 ack=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
 need(encoded(ack)==encoded(proofs['metadata-ack'])and ack['immutableAcknowledgementOnly']is True,
  'same_immutable_actual_Owner3_ACK_as_baseline3_required')
 stage='authenticate-run-timer-and-pure-SHA-helper';timer=load(TIMER,TIMER_SHA);memo=load(MEMO,MEMO_SHA)
 need(timer.FORMAT=='yunipals-readonly-run-duration-v2'and memo.FORMAT=='yunipals-readonly-sha256-memo-v1',
  'fixed_actual_public_family_timer_and_pure_fresh_byte_SHA256_helper_required')
 need(sys.gettrace()is None and sys.getprofile()is None,'unprofiled_untraced_readonly_benchmark_required')
 # Both are constructed with bare crypto before the wider SHA-only scope.
 bare_subprocess_run=subprocess.run
 duration_observer=timer.RunDurations(maximum_calls=10000)
 memo_observer=memo.SHA256Memo(maximum_payload_bytes=256*1024*1024,maximum_entries=4)
 with memo_observer:
  record_memo_counters('before-genuine-Session')
  stage='full-live-preflight';session=caller.Session(report['sourceRefs'],MANIFEST_SHA,refs)
  new_source_preflight=encoded(session.preflight())
  stage='new-cache-context';context=session.cache_context(CACHE_INPUT_SHA)
  need(type(context)is tuple and len(context)==2 and context[0]is session.cache and context[1]is session.host,
   'actual_cache_context_tuple_required')
  cache=session.cache;host=session.host;authority=cache.continuation_authority
  need(cache.BASE==CACHE_BASE and cache.__file__==str(OPS/'ypal-ordinary-read-cache-continue-v5.py'),
   'actual_unchanged_CONT5_provider_and_cache_namespace_required')
  stage='current-namespace-and-records';cache_frame=fixed_cache_frame(cache)
  need(failed_capture_frame()==failed_frame,'all_held8_capture_file_inodes_and_bytes_unchanged_after_context_required')
  actual_baseline=document(authority.BASE/'captures'/BASELINE_CAPTURE/'result.json',baseline['sha256'])
  need(all(encoded(baseline[key])==encoded(value)for key,value in actual_baseline.items())and actual_baseline['completed']is True,
   'actual_authority_baseline_receipt_not_rebuilt_or_relabelled_required')

  stage='one-readonly-host-refresh-and-prerequisites'
  measured=observe_refresh_and_prerequisites(host)
 # Both original hooks are restored before any driver diagnostic/proof write.
 proof_hashes['new-source-preflight']=write('new-source-preflight.private.json',new_source_preflight)
 observation_summary=save_duration_observation()
 need(measured['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  encoded(measured['metadataCurrentProof']['metadataEpoch'])==encoded(session.metadata_epoch.binding()),
  'genuine_full_prerequisites_and_same_metadata_epoch_required')
 proof_hashes['actual-readonly-prerequisites']=write('actual-readonly-prerequisites.private.json',measured)
 need(fixed_cache_frame(cache)==cache_frame and failed_capture_frame()==failed_frame,
  'all_baseline_and_failed_capture_file_bytes_and_inodes_unchanged_after_readonly_measurement')
 stage='full-source-postflight';postflight=session.finish()
 need(postflight['metadataActorCurrent']['currentActorQualified']is True and
  encoded(postflight['metadataEpoch'])==encoded(session.metadata_epoch.binding()),'actual_full_source_postflight_same_metadata_epoch_required')
 proof_hashes['full-source-postflight']=write('full-source-postflight.private.json',postflight)
 need(fixed_cache_frame(cache)==cache_frame and failed_capture_frame()==failed_frame,'all_original_files_unchanged_after_full_postflight_required')
 capture_summary=capture_histories('success');stage='complete'
 result={'format':'root-CONT5-readonly-refresh-benchmark-v4','completed':True,'stage':stage,'observedAt':now(),
  'reconciliationResultSha256':reconciliation_local['resultSha256'],'acceptedBaselineRootResultSha256':baseline_local['resultSha256'],
  'explicitRefreshInvocationCount':1,'explicitPrerequisitesInvocationCount':1,'explicitTopLevelCountsOnly':True,'fullSourcePostflightPassed':True,
  'allOriginalFileBytesAndInodesUnchanged':True,'proofHashes':proof_hashes,**observation_summary}
except BaseException as error:
 original=traceback.format_exc().encode();observation_summary={}
 try:observation_summary=save_duration_observation()
 except BaseException:
  try:proof_hashes['duration-save-refusal']=write('duration-save-refusal.private.txt',traceback.format_exc().encode())
  except BaseException:pass
 try:capture_summary=capture_histories('failure',error)
 except BaseException:
  try:proof_hashes['history-save-refusal']=write('history-save-refusal.private.txt',traceback.format_exc().encode())
  except BaseException:pass
 result={'format':'root-CONT5-readonly-refresh-benchmark-v4','completed':False,'stage':stage,'observedAt':now(),
  'reconciliationResultSha256':reconciliation_local['resultSha256'],'fullSourcePostflightPassed':False,
  'privateDiagnosticSha256':write('failure.private.txt',original),'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'proofHashes':proof_hashes,**observation_summary}
finally:signal.alarm(0)
result.update(capture_summary)
result.update({'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),
 'passiveRunDurationHelperSha256':TIMER_SHA,'pureSHA256MemoHelperSha256':MEMO_SHA,
 'SHA256MemoScopePlannedBeforeGenuineSession':True,'SHA256MemoScopeEntered':memo_observer is not None and memo_observer.entered,
 'freshFileReadsAndOriginalExpectedDigestChecksRetained':True,
 'CPUObserverInstalled':False,'pureComputationReuseOnly':True,'performanceImprovementOrHeldDeadlineFitClaimed':False,
 'priorReadOnlyBenchmarkResultSha256':prior_benchmark_local['resultSha256'],'priorBenchmarkIsDiagnosticReferenceOnly':True,
 'priorReadOnlyBenchmarkUsedAsCurrentAuthority':False,'historicalTimingUsedAsQualification':False,'bothObserverOverheadsIncluded':True,'elapsedNanoseconds':time.monotonic_ns()-started,
 'mainCPUClock':'process_time_ns-parent-only','wallClock':'perf_counter_ns','readOnlyBenchmarkOnly':True,
 'automaticRetryAllowed':False,'realCOMMITDispatched':False,'preparedCallbackDispatched':False,'qualifierDispatched':False,
 'baselineDispatched':False,'LOGINDispatched':False,'providerRefreshRequested':False,'databaseMutationsDispatched':False,
 'databaseWrites':0,'serviceActions':0,'providerCalls':0,'newHeldSuccessAuthority':False,'newCommitAuthority':False,
 'newCurrentAuthority':False,'timingQualificationClaimed':False,'actualHeldCallbackQualified':False})
digest=write('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
sys.exit(0 if result['completed']is True else 1)
'''

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def read_private(path):
 before=path.lstat()
 if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_gid!=0 or before.st_nlink!=1 or before.st_mode&0o077 or before.st_size>16000000:
  raise RuntimeError('actual_protected_root_result_required')
 raw=path.read_bytes();after=path.lstat()
 if len(raw)!=before.st_size or any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
  raise RuntimeError('same_actual_root_result_bytes_required')
 return json.loads(raw)
def actual_result(value,digest):
 if type(value)is not dict or value.get('resultSha256')!=digest or hashlib.sha256(encoded({key:item for key,item in value.items()if key!='resultSha256'})).hexdigest()!=digest:
  raise RuntimeError('actual_canonical_fixed_root_result_required_before_SSH')
 return value
def exclusive(path,value):
 raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)

def need_reconciliation_result(value):
 if value.get('format')!='root-CONT5-held8-reconciliation-v1'or value.get('completed')is not True or value.get('stage')!='complete'or value.get('transactionId')!='17079057'or value.get('transactionStatus')!='aborted'or value.get('failedHeld8RootResultSha256')!='28d884331e5dbfe5cf5387c2f3af8e7bdbfcc25cdedd31729a57ded8b281bab7'or value.get('completeHeldCallbackQualified')is not False or value.get('productionPreparedACKCreated')is not False or value.get('newHeldSuccessAuthority')is not False or value.get('newCommitAuthority')is not False:
  raise RuntimeError('actual_reconciliation8_recovery_not_callback_or_ACK_authority_required_before_SSH')
 return value


def require_diagnostic_ancestor(value):
 if value.get('format')!='root-CONT5-readonly-refresh-benchmark-v1'or value.get('completed')is not True or value.get('readOnlyBenchmarkOnly')is not True or any(value.get(key)is not False for key in ['actualHeldCallbackQualified','timingQualificationClaimed','newCurrentAuthority','newHeldSuccessAuthority','newCommitAuthority']):
  raise RuntimeError('actual_prior_readonly_result_is_diagnostic_ancestry_only_required_before_SSH')
 return value

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
 if not args.run:
  print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
 if BENCHMARK_SOURCE_REVIEWED is not True:raise RuntimeError('readonly_benchmark_source_review_required_before_SSH')
 started=time.monotonic();os.umask(0o077)
 if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_readonly_benchmark_result_required_no_retry')
 baseline=actual_result(read_private(BASELINE_RESULT),'2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195')
 detail=read_private(FAILED_RESULT)
 if detail.get('format')!='root-held8-failure-detail-v1'or detail.get('rootResultSha256')!='28d884331e5dbfe5cf5387c2f3af8e7bdbfcc25cdedd31729a57ded8b281bab7':
  raise RuntimeError('actual_HELD8_detail_and_original_canonical_operation_result_required')
 failed=actual_result(detail['operationResult'],'28d884331e5dbfe5cf5387c2f3af8e7bdbfcc25cdedd31729a57ded8b281bab7')
 reconciliation=actual_result(read_private(RECONCILIATION_RESULT),'3acb03de0673bc48df2760f08c38d3a4ffe6c55b2f80aebb0e64e8616fd837eb')
 need_reconciliation_result(reconciliation)
 prior_benchmark=actual_result(read_private(PRIOR_BENCHMARK_RESULT),'27af1b44e25c9133d973ea6debef6b99d5dff40ed5b1ace4865c49cfc69e684d')
 require_diagnostic_ancestor(prior_benchmark)
 refs=read_private(METADATA_REFS)
 if encoded(refs)!=encoded(EXPECTED_REFS)or baseline.get('completed')is not True or failed.get('completed')is not False:
  raise SystemExit('actual_fixed_baseline_failure_and_metadata_refs_required_before_SSH')
 remote=REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(baseline)).replace('ACTUAL_METADATA_REFS',repr(refs)).replace('ACTUAL_HELD8_FAILURE',repr(failed)).replace('ACTUAL_HELD8_RECONCILIATION',repr(reconciliation)).replace('ACTUAL_PRIOR_READONLY_BENCHMARK_RESULT',repr(prior_benchmark))
 try:
  remaining=900-(time.monotonic()-started)
  if remaining<=0:raise RuntimeError('root_readonly_reconciliation_outer_budget_expired')
  process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
   '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
   input=remote,capture_output=True,text=True,timeout=remaining)
  try:
   result=json.loads(process.stdout)
   if type(result)is not dict or result.get('format')!='root-CONT5-readonly-refresh-benchmark-v4'or type(result.get('completed'))is not bool:
    raise ValueError('unexpected_readonly_reconciliation_envelope')
  except Exception:
   exclusive(Path('/tmp/yunipals-cont5-readonly-refresh-benchmark-unparsed-private-20261026-4.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
  if process.returncode!=0 or process.stderr:
   exclusive(Path('/tmp/yunipals-cont5-readonly-refresh-benchmark-transport-private-20261026-4.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result.update(completed=False,remoteAuditInspectionRequired=True)
 except subprocess.TimeoutExpired as error:
  exclusive(Path('/tmp/yunipals-cont5-readonly-refresh-benchmark-timeout-private-20261026-4.json'),{'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
   'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
  result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
 exclusive(RESULT,result);print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result.get('completed')is True else 1)
if __name__=='__main__':main()
