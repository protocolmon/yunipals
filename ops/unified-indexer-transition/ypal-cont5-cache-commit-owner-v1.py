#!/usr/bin/env python3
"""One root-explicit CONT5 cache COMMIT, gated by actual baseline3 and held4 success.

Import/default are inert. Root must review this source before --run.
Any after-invocation failure requires actual XID/catalog inspection; never retry.
No baseline, qualifier, second prepare-ACK, LOGIN, refresh or service dispatch.
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
METADATA_REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
HELD_RESULT=Path('/tmp/yunipals-cont5-held-rollback-qualification-production-20261026-4.json')
RESULT=Path('/tmp/yunipals-cont5-cache-commit-production-20261026-1.json')
# Baseline3 and held4 contracts have separate complete source reviews.
# The actual successful receipts and full private graphs remain mandatory.
BASELINE_CONTRACT_FINALIZED=True
EXPECTED_REFS={
    'mode':'current',
    'resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
    'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
    'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
    'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'
}

REMOTE=r'''import datetime,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,traceback,types,time
os.umask(0o077)
baseline_local=ACTUAL_BASELINE_RESULT
held_local=ACTUAL_HELD_RESULT
refs=ACTUAL_METADATA_REFS
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-cache-commit-20261026-1')
HELD_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-4')
QUALIFICATION_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026')
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v5-20261026')
AVAILABILITY_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-current-cadence-baseline-20261026-2')
AVAILABILITY_SHA='ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'
BASELINE_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
BASELINE_CAPTURE='cont5-baseline-20261026-3'
HELD_CAPTURE='cont5-held-rollback-20261026-4'
ATTEMPT='cont5-cache-commit-20261026-1'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
CALLER=OPS/'ypal-ordinary-publication-continue-v5.py'
CALLER_SHA='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v5.manifest.json'
MANIFEST_SHA='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'
PROVIDER_SHA='30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326'
AUTHORITY_SHA='d95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef'
CACHE_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
OWNER=OPS/'ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST=OPS/'ypal-native-metadata-approval-epoch-v3.manifest.json'
started=time.monotonic_ns();stage='initial';commit_invoked=False;commit_returned=False;qualification_ref=None;proof_hashes={};session=None;capture_summary={};profiler=None;command_trace=None;original_subprocess_run=subprocess.run
ENABLE_PROFILE=ACTUAL_ENABLE_PROFILE

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
def deadline(_signum,_frame):raise RuntimeError('root_COMMIT_deadline_expired_actual_XID_catalog_inspection_required_no_retry')


def save_current_failure(name,raw):return write('current-'+name,raw)
def install_observers(source_manifest):
 global command_trace,profiler
 diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py',
  '2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465')
 command_trace=diagnostic.SubprocessDiagnostics(original_subprocess_run,save_current_failure)
 if ENABLE_PROFILE:
  module=load(OPS/'ypal-ordinary-call-profile-v1.py',
   '5b3aa246bf10e6e69c70d01ed4742d1817d86a0e9095f243428b4c8e9c901d8a')
  files={str(OPS/name):digest for name,digest in{**source_manifest['dependencies'],**source_manifest['files']}.items()}
  files[str(CALLER)]=CALLER_SHA
  for name,digest in files.items():protected(pathlib.Path(name),digest)
  profiler=module.CallProfile(files,{'__init__','preflight','prerequisites','metadata','current','capture_current',
   'cache_context','require_qualification','new_identity','fresh_approval_gate','execute_cache','commit','prepare_ack','finish'},maximum=10000)
  profiler.__enter__()
 subprocess.run=command_trace

def save_observations():
 # Observation only: restore the original function before inspecting memory.
 subprocess.run=original_subprocess_run
 if profiler is not None and profiler.installed:profiler.__exit__(None,None,None)
 summary={}
 if command_trace is not None:
  value={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'calls':command_trace.calls,'failures':command_trace.failures,'subprocessRunRestored':subprocess.run is original_subprocess_run,
   'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False,
   'SQLTransportWrapperInstalled':False}
  digest=write('current-subprocess-diagnostic.private.json',value)
  summary.update({'currentSubprocessDiagnosticSha256':digest,'currentSubprocessCommandCount':len(command_trace.calls),
   'currentSubprocessFailureCount':len(command_trace.failures),'currentSubprocessRunRestored':subprocess.run is original_subprocess_run})
 if profiler is not None:
  value=profiler.snapshot();digest=write('call-profile.private.json',value)
  summary.update({'privateCallProfileSha256':digest,'profiledCallCount':len(value['events']),
   'profiledCallsDropped':value['droppedCalls'],'profileObservationErrors':value['observationErrors']})
 return summary

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

def capture_history_checked(value,expected_binding,outcome):
 need(value['format']=='root-CONT5-metadata-capture-history-v1'and value['outcome']==outcome and
  value['readOnlyMemorySnapshot']is True and value['currentObservationsPerformed']==0 and
  all(value[key]is False for key in['stableBindingMutated','timingKeyMutated','approvalClockReset'])and
  type(value['epochs'])is list and len(value['epochs'])==2 and
  {row['label']for row in value['epochs']}=={'sessionEpoch','cacheEpoch'},
  'actual_both_metadata_Epoch_memory_only_capture_history_required')
 exception=value['exceptionCapture']
 need(exception is None or outcome=='failure'and exception=={'history':[],'lastAttempts':[]},
  'no_failed_metadata_capture_may_be_relabelled_as_completed_baseline')
 for row in value['epochs']:
  need(row['stableBindingSha256']==expected_binding and type(row['history'])is list and len(row['history'])>0 and
   row['lastAttempts']==row['history'][-1]['attempts'],'actual_stable_metadata_binding_and_complete_capture_history_required')
  for capture in row['history']:
   need(capture['format']=='yunipals-ypal-ordinary-metadata-current-observation-v1-capture'and
    capture['inverse']is capture['effectsRetried']is capture['approvalLifetimeReset']is False and
    type(capture['attempts'])is list and 1<=len(capture['attempts'])<=3,
    'actual_f536_capture_domain_and_unchanged_three_attempt_readonly_policy_required')
   for index,attempt in enumerate(capture['attempts'],1):
    last=index==len(capture['attempts'])
    need(attempt['attempt']==index and attempt['effectsRetried']is attempt['partialObservationReused']is False and
     type(attempt['elapsedNanoseconds'])is int and 0<=attempt['elapsedNanoseconds']<90_000_000_000 and
     attempt['completed']is last and attempt['discarded']is(not last)and
     attempt['ownerResultProduced']is last and attempt['classifiedMetadataBackendChurn']is(not last),
     'only_genuine_classified_discard_then_complete_fresh_metadata_capture_history_required')
    if not last:need(attempt['errorClass']=='RuntimeError'and attempt['fixedCode']=='metadata_backend_churn_retry_readonly_observation_only',
     'no_generic_command_failure_may_be_recorded_as_authorized_metadata_churn')
 attempts=[attempt for row in value['epochs']for capture in row['history']for attempt in capture['attempts']]
 return{'metadataEpochInstanceCount':2,'exceptionMetadataCaptureCount':0,
  'metadataCaptureCount':sum(len(row['history'])for row in value['epochs']),
  'metadataCaptureAttemptCount':len(attempts),
  'metadataDiscardedCaptureCount':sum(attempt['discarded']is True for attempt in attempts)}

def archived_partial_frame(path):
 row=path.lstat();need(stat.S_ISDIR(row.st_mode)and not stat.S_ISLNK(row.st_mode)and row.st_uid==row.st_gid==0 and
  stat.S_IMODE(row.st_mode)==0o700 and {p.name for p in path.iterdir()}=={'before.json','rehearsal-intent.json'},
  'actual_two_file_private_archive_directory_required')
 files={}
 for name in['before.json','rehearsal-intent.json']:
  raw=protected(path/name);item=(path/name).lstat()
  files[name]={'sha256':sha(raw),'device':item.st_dev,'inode':item.st_ino,'mode':item.st_mode,
   'uid':item.st_uid,'gid':item.st_gid,'links':item.st_nlink,'bytes':item.st_size,'mtimeNs':item.st_mtime_ns,'ctimeNs':item.st_ctime_ns}
 return{'directory':{key:getattr(row,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode']},'files':files}

def authenticate_constructed_baseline():
 baseline_root=document(BASELINE_AUDIT/'result.json',baseline_local['resultSha256'])
 need(baseline_local=={**baseline_root,'resultSha256':sha(protected(BASELINE_AUDIT/'result.json'))}and
  baseline_root['format']=='root-CONT5-construct-only-baseline-v1'and
  baseline_root['completed']is baseline_root['baselineCompleted']is baseline_root['fullCurrentQualifiedByGenuineConstruct']is True and
  baseline_root['baselineCaptureId']==BASELINE_CAPTURE and baseline_root['callerSha256']==CALLER_SHA and
  baseline_root['readerManifestSha256']==MANIFEST_SHA and baseline_root['metadataRefsSha256']==sha(encoded(refs))and
  baseline_root['priorReadPreparationResultSha256']==AVAILABILITY_SHA and baseline_root['historicalSchedulingEvidenceOnly']is True and
  baseline_root['priorQualificationReconciliationSha256']=='80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125'and
  baseline_root['metadataCurrentProofProducerSha256']=='f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2'and
  baseline_root['newCadenceObservationPerformed']is baseline_root['approvalLifetimeReset']is False and
  all(baseline_root[key]is False for key in['automaticRetryAllowed','realCOMMITDispatched','LOGINDispatched',
   'heldApplyDispatched','heldQualificationPerformed','providerRefreshRequested','historicalCONT4BaselineReusedAsCurrent'])and
  baseline_root['serviceActionsDispatched']==0 and baseline_root['transactionApprovalLifetimeSeconds']==90 and
  baseline_root['terminalReserveSeconds']==5,
  'actual_successful_new_construct_only_baseline3_required_before_live_context')
 fixed={'historical-scheduling-evidence':'historical-scheduling-evidence.private.json','context':'context.private.json',
  'metadata-ack':'metadata-ack.private.json','source-preflight':'source-preflight.private.json',
  'original-catalog-reconciliation':'original-catalog-reconciliation.private.json','archive-intent':'archive-intent.private.json',
  'archive-result':'archive-result.private.json','baseline':'baseline-result.private.json'}
 need(set(baseline_root['proofHashes'])==set(fixed),'complete_actual_construct_only3_private_proof_hashes_required')
 proofs={label:document(BASELINE_AUDIT/name,baseline_root['proofHashes'][label])for label,name in fixed.items()}
 context=proofs['context'];baseline=proofs['baseline'];archive=proofs['archive-result'];intent=proofs['archive-intent']
 need(context['metadataRefs']==refs and context['callerSha256']==CALLER_SHA and context['readerManifestSha256']==MANIFEST_SHA and
  context['reportFile']==str(REPORT)and context['reportSha256']==REPORT_SHA and context['cacheInputSha256']==CACHE_INPUT_SHA and
  context['baselineCaptureId']==BASELINE_CAPTURE and
  all(context[key]is False for key in['realCommitPermitted','LOGINPermitted','serviceActionsPermitted','heldApplyPermitted']),
  'actual_same_metadata_input_reader5_and_rollback_only_construct_context_required')
 need(baseline['completed']is True and baseline['action']=='construct-records'and baseline['captureId']==BASELINE_CAPTURE and
  baseline['sha256']==baseline_root['baselineReceiptSha256']and
  all(baseline[key]==baseline_root[key]for key in['beforeSha256','rehearsedSha256','authorizationSha256','actualNewRehearsalXID','priorAbortedSha256'])and
  all(pin(baseline[key])for key in['sha256','beforeSha256','rehearsedSha256','authorizationSha256','priorAbortedSha256'])and
  type(baseline['actualNewRehearsalXID'])is str and re.fullmatch('[1-9][0-9]*',baseline['actualNewRehearsalXID'])and
  baseline['actualNewRehearsalXID']!='16540148'and
  all(baseline[key]is False for key in['newStopActionPerformed','productionPreparedACKCreated','productionCOMMITQualified'])and
  baseline['databaseWrites']==baseline['serviceActions']==baseline['providerCalls']==0,
  'actual_new_construct_only3_rehearsal_and_authorization_receipt_required')
 need(archive['format']==intent['format']=='root-CONT5-preSQL-archive-v1'and
  all(archive[key]==value for key,value in intent.items())and archive['source']==str(CACHE_BASE)and
  archive['destination']==str(BASELINE_AUDIT/'partial-cache-before-archive')and
  all(archive[key]is True for key in['archived','sourceAbsent','directoryAndFileInodesPreserved','capture2IntentUnchanged',
   'sharedSDKLockHeldDuringReconciliationAndArchive','genuineConstructWillAcquireOwnLockAfterThisLockReleases'])and
  all(archive[key]is False for key in['acceptedBaselineClaimed','oldFilesCopied','oldFilesOverwritten','newSQLDispatched'])and
  baseline_root['archiveResultSha256']==baseline_root['proofHashes']['archive-result']and
  archive['originalCatalogProofSha256']==baseline_root['proofHashes']['original-catalog-reconciliation']and
  archived_partial_frame(pathlib.Path(archive['destination']))==archive['partialFrame'],
  'actual_owned_archive_ACK_and_current_preserved_inodes_before_new_baseline_required')
 old_before=document(pathlib.Path(archive['destination'])/'before.json',archive['partialFrame']['files']['before.json']['sha256'])
 old_intent=document(pathlib.Path(archive['destination'])/'rehearsal-intent.json',archive['partialFrame']['files']['rehearsal-intent.json']['sha256'])
 reconciliation=proofs['original-catalog-reconciliation']
 need(reconciliation['wholeCatalogQualified']is reconciliation['allColumnACLQualified']is True and
  reconciliation['ownedAPPBackendCount']==reconciliation['matchingSQLentryProcessCount']==0 and
  reconciliation['partialBeforeCatalogSha256']==old_before['catalog']['catalogSha256']==reconciliation['catalog']['catalogSha256']and
  reconciliation['catalog']['postProof']['allColumnAcl']==old_before['catalog']['postProof']['allColumnAcl']and
  old_before['reviewHash']==sha(encoded(old_before['binding']))and old_before['binding']['retainedActualStop']==reconciliation['priorAborted']['binding']and
  old_intent['reviewHash']==old_before['reviewHash']and old_intent['databaseCommitAllowed']is False and
  old_intent['retainedActualPriorAbortedSha256']==reconciliation['priorAborted']['bindingSha256']==baseline['priorAbortedSha256'],
  'actual_archived_partial_baseline_whole_original_catalog_and_retained_aborted_stop_lineage_required')
 capture2=QUALIFICATION_BASE/'captures'/'cont5-baseline-20261026-2'
 need({path.name for path in capture2.iterdir()}=={'intent.json'}and
  sha(protected(capture2/'intent.json'))==archive['capture2IntentFrame']['sha256']and
  (capture2/'intent.json').lstat().st_ino==archive['capture2IntentFrame']['inode']and
  len(protected(capture2/'intent.json'))==archive['capture2IntentFrame']['bytes'],
  'actual_failed_capture2_intent_remains_immutable_after_owned_archive')
 new_before=document(CACHE_BASE/'before.json',baseline['beforeSha256'])
 new_rehearsed=document(CACHE_BASE/'rehearsed.json',baseline['rehearsedSha256'])
 new_authorization=document(CACHE_BASE/'authorization.json',baseline['authorizationSha256'])
 need((CACHE_BASE/'before.json').lstat().st_ino!=archive['partialFrame']['files']['before.json']['inode']and
  new_before['binding']['operatorSha256']==PROVIDER_SHA and new_before['binding']['config']==old_before['binding']['config']and
  new_before['reviewHash']==sha(encoded(new_before['binding']))and new_rehearsed['beforeFileSha256']==baseline['beforeSha256']and
  new_rehearsed['newActualRollbackRehearsal']is True and new_rehearsed['committed']is False and
  new_rehearsed['retainedActualPriorAbortedSha256']==baseline['priorAbortedSha256']and
  new_authorization['reviewHash']==new_rehearsed['reviewHash']==new_before['reviewHash']and
  new_authorization['additionalReadCount']==4 and new_authorization['additionalAuthorityRequested']is False and
  new_authorization['additionalReadDeltaSha256']==new_rehearsed['additionalReadDeltaSha256'],
  'actual_fresh_constructed_files_and_same_four_READ_authorization_required')
 current=new_before['binding']['prerequisites']['metadataCurrentProof'];metadata_binding=current['metadataEpoch']
 need(current['currentNativeMetadataQualified']is True and
  baseline['fullSourcePostflight']['validated']is True and baseline['fullSourcePostflight']['metadataEpoch']==metadata_binding and
  baseline['fullSourcePostflight']['metadataActorCurrent']['currentActorQualified']is True,
  'genuine_new_construct_metadata_current_and_full_source_postflight_required')
 proofs['full-current-prerequisites']=new_before['binding']['prerequisites']
 expected_binding=sha(encoded(metadata_binding))
 history=document(BASELINE_AUDIT/'metadata-capture-histories-success.private.json',baseline_root['metadataCaptureHistorySha256'])
 summary=capture_history_checked(history,expected_binding,'success')
 need(all(baseline_root[key]==value for key,value in summary.items()),'same_actual_baseline3_capture_count_summary_required')
 availability=document(AVAILABILITY_AUDIT/'result.json',AVAILABILITY_SHA)
 need(availability['format']=='root-CONT5-current-cadence-baseline-v1'and availability['completed']is False and
  availability['baselineStarted']is availability['fullCurrentQualified']is availability['cadenceAccepted']is True and
  availability['baselineCompleted']is False and availability['callerSha256']==CALLER_SHA and
  availability['readerManifestSha256']==MANIFEST_SHA and availability['metadataRefsSha256']==sha(encoded(refs)),
  'actual_failed_root2_is_historical_current_and_cadence_evidence_not_baseline_authority')
 fixed_old={'deliberate-new-attempt-ancestry':'deliberate-new-attempt-ancestry.private.json','context':'context.private.json',
  'metadata-ack':'metadata-ack.private.json','source-preflight':'source-preflight.private.json',
  'full-current-prerequisites':'full-current-prerequisites.private.json','accepted-cadence':'accepted-cadence.private.json',
  'actor-before-cadence':'actor-before-cadence.private.json','actor-after-cadence':'actor-after-cadence.private.json',
  'cadence-source-postflight':'cadence-source-postflight.private.json'}
 need(set(availability['proofHashes'])==set(fixed_old),'all_actual_historical_root2_private_proofs_required')
 old={label:document(AVAILABILITY_AUDIT/name,availability['proofHashes'][label])for label,name in fixed_old.items()}
 historical=proofs['historical-scheduling-evidence'];cadence=old['accepted-cadence']
 need(historical=={'rootResultSha256':AVAILABILITY_SHA,'acceptedCadenceSha256':availability['proofHashes']['accepted-cadence'],
  'sampleCount':31,'checkedAtAdvanceCount':cadence['checkedAtAdvanceCount'],'schedulingEvidenceOnly':True,
  'newCurrentAuthority':False,'newBaselineAuthority':False,'SQLApprovalAuthority':False,'approvalLifetimeReset':False}and
  cadence['accepted']is cadence['allSamplesAccepted']is cadence['samplerStopped']is True and
  cadence['sampleCount']==availability['sampleCount']==len(cadence['samples'])==31 and cadence['checkedAtAdvanceCount']>=2 and
  150_000_000_000<=cadence['durationNanoseconds']<180_000_000_000 and
  old['metadata-ack']==proofs['metadata-ack']and old['context']['metadataRefs']==refs and old['context']['cacheInputSha256']==CACHE_INPUT_SHA and
  old['full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']==metadata_binding and
  old['cadence-source-postflight']['metadataEpoch']==metadata_binding and
  old['actor-before-cadence']['actor']==old['actor-after-cadence']['actor']and
  all(old[label]['upgradeAcknowledgement']==proofs['metadata-ack']and old[label]['upgradeRefs']==refs and
   old[label]['currentActorQualified']is True and old[label]['originalOwner3CurrentPassed']is False
   for label in['actor-before-cadence','actor-after-cadence']),
  'actual_private_31_sample_historical_scheduling_lineage_without_freshness_or_timing_waiver_required')
 for index,sample in enumerate(cadence['samples']):
  need(sample['index']==index,'actual_cadence_sample_order_required')
  observed=document(AVAILABILITY_AUDIT/('cadence-sample-'+str(index).zfill(3)+'.private.json'),sample['proofSha256'])
  need(observed['snapshot']['checkedUs']==sample['checkedUs']and observed['ageNanoseconds']==sample['ageNanoseconds']and
   observed['remainingNanoseconds']==sample['remainingNanoseconds']and observed['officialApprovalRefreshedByThisGate']is False,
   'all_actual_private_historical_cadence_sample_hashes_required')
 old_history=document(AVAILABILITY_AUDIT/'metadata-capture-histories-failure.private.json',availability['metadataCaptureHistorySha256'])
 old_summary=capture_history_checked(old_history,expected_binding,'failure')
 need(all(availability[key]==value for key,value in old_summary.items()),'same_actual_root2_metadata_history_summary_required')
 proof_hashes['baseline-root-result']=write('authenticated-baseline-root-result.private.json',baseline_root)
 proof_hashes['authenticated-baseline-metadata-histories']=write('authenticated-baseline-metadata-histories.private.json',history)
 proof_hashes['authenticated-prerequisites']=write('authenticated-CONT5_baseline-proof-hashes.private.json',baseline_root['proofHashes'])
 proof_hashes['historical-scheduling-lineage']=write('authenticated-historical-scheduling-lineage.private.json',{
  'rootResultSha256':AVAILABILITY_SHA,'proofHashes':availability['proofHashes'],'metadataCaptureHistorySha256':availability['metadataCaptureHistorySha256'],
  'historicalSchedulingEvidenceOnly':True,'newBaselineAuthority':False,'SQLApprovalAuthority':False})
 return baseline_root,proofs,history,baseline,expected_binding

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
need(not os.path.lexists(AUDIT),'fresh_exclusive_root_held_audit_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(880)
try:
 stage='authenticate-completed-construct-only3-baseline'
 baseline_root,proofs,history,baseline,expected_binding=authenticate_constructed_baseline()

 stage='authenticate-completed-held-root'
 held_root=document(HELD_AUDIT/'result.json',held_local['resultSha256'])
 need(held_local=={**held_root,'resultSha256':sha(protected(HELD_AUDIT/'result.json'))}and
  held_root['format']=='root-CONT5-held-rollback-qualification-v2'and held_root['completed']is True and
  held_root['callerSha256']==CALLER_SHA and held_root['readerManifestSha256']==MANIFEST_SHA and
  held_root['metadataRefsSha256']==sha(encoded(refs))and held_root['baselineRootResultSha256']==baseline_local['resultSha256']and
  held_root['baselineReceiptSha256']==baseline['sha256']and held_root['qualificationOnly']is True and
  held_root['rootDriverVariant']=='held4-construct-only3-baseline'and
  held_root['priorQualificationReconciliationSha256']=='80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125'and
  held_root['metadataCurrentProofProducerSha256']=='f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2'and
  all(held_root[key]is False for key in['automaticRetryAllowed','realCOMMITDispatched','productionCOMMITQualified',
   'productionPreparedACKCreated','LOGINDispatched','providerRefreshRequested','historicalCONT4BaselineReusedAsCurrent'])and
  held_root['serviceActionsDispatched']==0,
  'actual_completed_CONT5_held_root_and_same_baseline_epoch_before_live_context_required')
 qualification_ref=held_root['heldQualification']
 need(type(qualification_ref)is dict and set(qualification_ref)=={'captureId','sha256'}and
  qualification_ref['captureId']==HELD_CAPTURE and pin(qualification_ref['sha256']),
  'actual_fixed_CONT5_held_capture_ref_required')
 fixed_held={'baseline-root-result':'authenticated-baseline-root-result.private.json',
  'authenticated-baseline-metadata-histories':'authenticated-baseline-metadata-histories.private.json',
  'authenticated-baseline-proof-hashes':'authenticated-baseline-proof-hashes.private.json',
  'authenticated-baseline-archive':'authenticated-baseline-archive.private.json',
  'new-source-preflight':'new-source-preflight.private.json','new-full-current-prerequisites':'new-full-current-prerequisites.private.json',
  'actual-prior-aborted':'actual-prior-aborted.private.json','qualifier-return':'qualifier-return.private.json',
  'authenticated-held-qualification':'authenticated-held-qualification.private.json'}
 need(set(held_root['proofHashes'])==set(fixed_held),'complete_actual_held_root_proof_hashes_required')
 held_proofs={label:document(HELD_AUDIT/name,held_root['proofHashes'][label])for label,name in fixed_held.items()}
 need(held_proofs['baseline-root-result']==baseline_root and held_proofs['authenticated-baseline-metadata-histories']==history and
  held_proofs['authenticated-baseline-proof-hashes']==baseline_root['proofHashes']and
  held_proofs['authenticated-baseline-archive']==proofs['archive-result']and
  held_proofs['new-source-preflight']['metadataEpoch']==proofs['full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']and
  held_proofs['new-full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']==proofs['full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']and
  held_proofs['actual-prior-aborted']['validated']is True and
  held_proofs['actual-prior-aborted']['binding']['transactionId']=='16540148'and
  held_proofs['actual-prior-aborted']['binding']['transactionStatus']=='aborted'and
  held_proofs['actual-prior-aborted']['binding']['priorChildGone']is held_proofs['actual-prior-aborted']['binding']['priorBackendGone']is True and
  held_proofs['actual-prior-aborted']['bindingSha256']==baseline['priorAbortedSha256'],
  'actual_held_root_same_owned_epoch_prior_aborted_and_baseline_ancestry_required')
 qualified=document(QUALIFICATION_BASE/'captures'/HELD_CAPTURE/'result.json',qualification_ref['sha256'])
 returned=held_proofs['qualifier-return']
 need(qualified==held_proofs['authenticated-held-qualification']and returned['completed']is returned['rollbackOnly']is True and
  returned['captureId']==HELD_CAPTURE and returned['sha256']==qualification_ref['sha256']and
  returned['productionCOMMITQualified']is False and qualified['format']=='yunipals-ypal-ordinary-cache-continuation-authority-v5'and
  all(qualified[key]is True for key in['completed','rollbackOnly','completeHeldCallback','childGone','backendGone','catalogRestored',
   'transactionalCatalogMutationsRolledBack'])and
  all(qualified[key]is False for key in['productionCOMMITQualified','productionPreparedACKCreated','priorTimingReceiptUsed'])and
  qualified['transactionStatus']=='aborted'and type(qualified['transactionId'])is str and re.fullmatch('[1-9][0-9]*',qualified['transactionId'])and
  qualified['transactionId']not in{'16540148','16775453',baseline['actualNewRehearsalXID']}and
  qualified['transactionId']==held_root['transactionId']and held_root['transactionStatus']=='aborted'and
  all(held_root[key]is True for key in['completeHeldCallback','childGone','backendGone','catalogRestored','transactionalCatalogMutationsRolledBack'])and
  type(qualified['elapsedNanoseconds'])is int and qualified['elapsedNanoseconds']>0 and
  qualified['reserveNanoseconds']==5_000_000_000 and qualified['approvalGate']['ttlNanoseconds']==90_000_000_000 and
  qualified['elapsedNanoseconds']+qualified['reserveNanoseconds']<qualified['approvalGate']['remainingNanoseconds']<=90_000_000_000 and
  qualified['elapsedNanoseconds']==held_root['elapsedHeldNanoseconds']and
  qualified['reserveNanoseconds']==held_root['reserveNanoseconds']and
  qualified['approvalGate']['remainingNanoseconds']==held_root['approvalRemainingAtLaunchNanoseconds']and
  qualified['databaseWrites']==qualified['serviceActions']==qualified['providerCalls']==0,
  'actual_new_aborted_held_XID_gone_catalog_and_measured_90_plus_5_required_before_live_context')
 source_manifest=document(MANIFEST,MANIFEST_SHA)
 need(source_manifest['contexts']['phase']=={'file':'ypal-ordinary-read-cache-continue-v5.py','sha256':PROVIDER_SHA}and
  source_manifest['dependencies']['ypal-ordinary-cache-continuation-authority-v5.py']==AUTHORITY_SHA,
  'actual_fixed_CONT5_provider_and_authority_source_required')
 identity=qualified['identity'];context=identity['continuationContext']
 need(identity['inputSha256']==CACHE_INPUT_SHA and identity['providerSha256']==source_manifest['contexts']['phase']['sha256']and
  identity['authoritySha256']==source_manifest['dependencies']['ypal-ordinary-cache-continuation-authority-v5.py']and
  all(identity[key]==baseline[field]for key,field in[('beforeSha256','beforeSha256'),('rehearsedSha256','rehearsedSha256'),('authorizationSha256','authorizationSha256'),('priorAbortedSha256','priorAbortedSha256')])and
  context['operatorSha256']==CALLER_SHA and context['readerSha256']==source_manifest['files']['ypal-ordinary-reader-continue-v5.py']and
  context['mode']=='cache-prepared-held'and context['metadataEpoch']==proofs['full-current-prerequisites']['metadataCurrentProof']['metadataEpoch']and
  context['context']['inputSha256']==CACHE_INPUT_SHA and context['context']['direction']=='forward',
  'actual_held_full_caller_provider_input_and_metadata_epoch_identity_required')
 audit_names={'intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json',
  'actual-prepared-observation.json','complete-held-callback.json'}
 need(type(qualified['auditFiles'])is dict and set(qualified['auditFiles'])==audit_names and
  qualified['auditFiles']==held_root['auditFileHashes'],'all_six_actual_held_audit_hashes_required')
 records={name:document(QUALIFICATION_BASE/'captures'/HELD_CAPTURE/name,digest)for name,digest in qualified['auditFiles'].items()}
 packet=records['actual-prepared-observation.json'];opened=records['apply-sql-opened.json']
 need(records['intent.json']=={'format':qualified['format'],'identity':identity,'rollbackOnly':True,'automaticRetryAllowed':False}and
  records['approval-before-launch.json']==qualified['approvalGate']and
  packet['neverProductionPreparedACK']is True and packet['value']['xid']==opened['message']['xid']==qualified['transactionId']and
  packet['value']['mode']==opened['message']['mode']=='apply'and type(packet['valueJson'])is str and
  json.loads(packet['valueJson'])==packet['value']and opened['childFileSha256']==qualified['auditFiles']['apply-sql-child.json']and
  records['complete-held-callback.json']['packetSha256']==qualified['actualPreparedPacketSha256']==held_root['actualPreparedPacketSha256']==sha(packet['valueJson'].encode())and
  records['complete-held-callback.json']['productionPreparedACKCreated']is False and
  type(records['complete-held-callback.json']['elapsedNanoseconds'])is int and
  0<records['complete-held-callback.json']['elapsedNanoseconds']<=qualified['elapsedNanoseconds']and
  qualified['approvalGate']['identity']=={key:identity[key]for key in['format','providerSha256','inputSha256','configSha256','authoritySha256','sqlEntrySha256','componentSha256']}and
  qualified['approvalGate']['mode']=='apply'and qualified['approvalGate']['officialApprovalRefreshedByThisGate']is False,
  'actual_six_held_audits_exact_packet_and_no_COMMIT_chain_required')
 held_history=document(HELD_AUDIT/'metadata-capture-histories-success.private.json',held_root['metadataCaptureHistorySha256'])
 held_summary=capture_history_checked(held_history,expected_binding,'success')
 need(all(held_root[key]==value for key,value in held_summary.items()),
  'same_actual_held4_f536_metadata_capture_count_summary_required')
 proof_hashes['held-root-result']=write('authenticated-held-root-result.private.json',held_root)
 proof_hashes['held-qualification']=write('authenticated-qualified-receipt.private.json',qualified)
 proof_hashes['held-audits']=write('authenticated-six-held-audits.private.json',records)
 proof_hashes['held-metadata-histories']=write('authenticated-held-metadata-histories.private.json',held_history)

 stage='authenticate-live-programs'
 protected(MANIFEST,MANIFEST_SHA);protected(OWNER_MANIFEST,refs['manifestSha256'])
 owner=load(OWNER,refs['producerSha256']);caller=load(CALLER,CALLER_SHA)
 report=document(REPORT,REPORT_SHA)
 need(report['cacheInputsSha256']==CACHE_INPUT_SHA,'same_actual_original_cache_input_required')
 ack=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
 need(ack==proofs['metadata-ack']and ack['immutableAcknowledgementOnly']is True,'same_actual_accepted_Owner3_ACK_as_CONT5_baseline_required')
 stage='install-passive-observers'
 install_observers(source_manifest)
 stage='full-live-preflight'
 session=caller.Session(report['sourceRefs'],MANIFEST_SHA,refs)
 proof_hashes['new-source-preflight']=write('new-source-preflight.private.json',session.preflight())
 stage='new-cache-context';context=session.cache_context(CACHE_INPUT_SHA)
 need(type(context)is tuple and len(context)==2 and context[0]is session.cache and context[1]is session.host,'actual_cache_context_tuple_required')
 cache=session.cache;authority=cache.continuation_authority
 stage='authenticate-current-baseline-files'
 actual_baseline=document(authority.BASE/'captures'/BASELINE_CAPTURE/'result.json',baseline['sha256'])
 need(all(baseline[key]==value for key,value in actual_baseline.items())and actual_baseline['completed']is True,
  'same_actual_authority_baseline_audit_receipt_required')
 for name,key in [('before.json','beforeSha256'),('rehearsed.json','rehearsedSha256'),('authorization.json','authorizationSha256')]:
  protected(cache.BASE/name,baseline[key])
 for name in ['sql-intent.json','sql-prepared.json','sql-committed.json','prepared.json','apply-sql-child.json','apply-sql-opened.json']:
  need(not os.path.lexists(cache.BASE/name),'held_qualification_requires_no_real_apply_or_COMMIT_records')
 stage='full-current-prerequisites'
 prerequisites=session.host.prerequisites()
 need(prerequisites['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  prerequisites['metadataCurrentProof']['metadataEpoch']==session.metadata_epoch.binding(),'genuine_full_current_metadata_and_actual_epoch_required')
 proof_hashes['new-full-current-prerequisites']=write('new-full-current-prerequisites.private.json',prerequisites)
 stage='actual-prior-aborted-authority'
 prior=authority.prior_aborted(cache.prior_cache,session.host)
 need(prior['validated']is True and prior['binding']['transactionId']=='16540148'and prior['binding']['transactionStatus']=='aborted'and
  prior['binding']['priorChildGone']is prior['binding']['priorBackendGone']is True and
  prior['bindingSha256']==baseline['priorAbortedSha256'],'same_actual_original_aborted_XID_and_unchanged_journals_required')
 proof_hashes['actual-prior-aborted']=write('actual-prior-aborted.private.json',prior)
 stage='require-actual-held-qualification'
 current_qualification=authority.require_qualification(cache,session.host,qualification_ref)
 need(current_qualification==qualified,'actual_same_complete_held_qualification_in_fresh_current_context_required')
 need(cache.xact_status(session.host,qualified['transactionId'])=='aborted','actual_qualified_rollback_XID_must_still_be_aborted')
 stage='full-source-current-before-commit'
 source_current=session.source.current()
 need(source_current['currentWriterQualified']is source_current['sourceActorQualified']is True and
  source_current['databaseWrites']==source_current['serviceActions']==source_current['providerCalls']==0,
  'actual_full_source_current_before_explicit_COMMIT_required')
 proof_hashes['source-current-before-commit']=write('source-current-before-commit.private.json',source_current)
 stage='explicit-commit-only'
 write('commit-invocation-intent.private.json',{'attemptId':ATTEMPT,'baselineCaptureId':BASELINE_CAPTURE,'heldQualification':qualification_ref,
  'baselineRootResultSha256':baseline_local['resultSha256'],'heldRootResultSha256':held_local['resultSha256'],
  'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefs':refs,
  'automaticRetryAllowed':False,'explicitRealCOMMITRequested':True,'LOGINPermitted':False,'serviceActionsPermitted':False})
 commit_invoked=True
 prepared=caller.execute_cache(session,'commit',[],ATTEMPT,qualification_ref)
 commit_returned=True
 # execute_cache returns the genuine prepare_ack VALUE directly. The original
 # commit already saved prepared.json; never invoke prepare-ack a second time.
 prepared_raw=protected(cache.BASE/'prepared.json');prepared_sha=sha(prepared_raw);prepared_file=json.loads(prepared_raw)
 need(type(prepared)is dict and prepared==prepared_file and prepared['format']==cache.FORMAT and prepared['prepared']is True and
  prepared['operatorSha256']==source_manifest['contexts']['phase']['sha256']and prepared['config']==session.host.config and
  prepared['beforeSha256']==baseline['beforeSha256']and prepared['readAdmissionSha256']==session.host.config['readAdmissionSha256']and
  prepared['additionalReadCount']==4 and prepared['original143WholeValidatorPassed']is False and
  prepared['nativeWorkerStarted']is prepared['nativeGenerationPublished']is False and
  prepared['legacy103ServingAccepted']is prepared['cacheBootDisabled']is prepared['coordinatedPublicationAndReaderSwitchStillRequired']is True,
  'actual_genuine_commit_returned_existing_prepared_ACK_value_required')
 committed_raw=protected(cache.BASE/'sql-committed.json');committed=json.loads(committed_raw)
 sql_prepared_raw=protected(cache.BASE/'sql-prepared.json');sql_prepared=json.loads(sql_prepared_raw)
 intent_raw=protected(cache.BASE/'sql-intent.json');intent=json.loads(intent_raw)
 opened=document(cache.BASE/'apply-sql-opened.json');child_raw=protected(cache.BASE/'apply-sql-child.json')
 need(committed['mode']=='apply'and committed['acknowledged']is True and
  committed['xid']==sql_prepared['xid']==opened['message']['xid']and re.fullmatch('[1-9][0-9]*',committed['xid'])and
  committed['xid']not in{'16540148',qualified['transactionId'],baseline['actualNewRehearsalXID']}and
  committed['operatorSha256']==prepared['operatorSha256']and committed['bootId']==prepared['bootId']==intent['bootId']and
  committed['reviewHash']==prepared['reviewHash']==intent['reviewHash']and
  committed['commitIntentSha256']==sha(intent_raw)and committed['preparedSha256']==sha(sql_prepared_raw)and
  committed['additionalReadAuthorizationSha256']==baseline['authorizationSha256']and
  intent['rehearsalSha256']==baseline['rehearsedSha256']and intent['authorizationSha256']==baseline['authorizationSha256']and
  opened['childFileSha256']==sha(child_raw)and prepared['additionalReadAcknowledgementSha256']==sha(committed_raw)and
  committed['reconciledAfterUnknownAck']is False,
  'actual_new_committed_SQL_opened_child_prepared_and_four_READ_ACK_chain_required')
 need(cache.xact_status(session.host,committed['xid'])=='committed','actual_new_SQL_XID_must_be_committed')
 cache.child_gone(session.host,'apply-sql-child.json')
 attempt_area=session.continuation_caller.BASE/'attempts'/ATTEMPT
 caller_intent=document(attempt_area/'intent.json');business=document(attempt_area/'business-result.json');attempt_result=document(attempt_area/'result.json')
 need(caller_intent['format']==attempt_result['format']==session.continuation_caller.FORMAT and
  caller_intent['operatorSha256']==CALLER_SHA and caller_intent['action']==attempt_result['action']=='commit'and
  caller_intent['context']==attempt_result['context']==session.key and caller_intent['sourcePreflight']==session.readonly_preflight and
  caller_intent['automaticEffectRetryAllowed']is False and business==prepared and attempt_result['completed']is True and
  attempt_result['businessResultPresent']is attempt_result['originalOwnerJournalsAreEffectAuthority']is True and
  attempt_result['automaticEffectRetryAllowed']is False and attempt_result['fixedCode']is None and
  attempt_result['postflight']['validated']is True and attempt_result['postflight']['metadataEpoch']==session.metadata_epoch.binding(),
  'actual_genuine_caller_attempt_and_full_source_postflight_after_COMMIT_required')
 proof_hashes['prepared-ACK']=write('prepared-ACK-value.private.json',prepared)
 proof_hashes['sql-committed']=write('sql-committed-value.private.json',committed)
 proof_hashes['caller-attempt']=write('caller-attempt-value.private.json',attempt_result)
 actual_gate=cache._continuation_approval_gate
 need(actual_gate['mode']=='apply'and actual_gate['ttlNanoseconds']==90_000_000_000 and
  actual_gate['officialApprovalRefreshedByThisGate']is False and
  actual_gate['identity']==qualified['approvalGate']['identity']and
  qualified['elapsedNanoseconds']+5_000_000_000<actual_gate['remainingNanoseconds']and
  actual_gate['capturedMonotonicNanoseconds']>qualified['approvalGate']['capturedMonotonicNanoseconds'],
  'actual_new_fresh_official_gate_and_measured_budget_used_for_this_COMMIT_required')
 proof_hashes['actual-fresh-approval-gate']=write('actual-fresh-approval-gate.private.json',actual_gate)
 capture_summary=capture_histories('success')
 stage='complete'
 result={'format':'root-CONT5-cache-commit-v1','completed':True,'observedAt':now(),'stage':stage,'attemptId':ATTEMPT,
  'baselineRootResultSha256':baseline_local['resultSha256'],'heldRootResultSha256':held_local['resultSha256'],
  'heldQualification':qualification_ref,'commitReturned':True,'preparedACKCreatedByGenuineCommit':True,
  'preparedFileSha256':prepared_sha,'sqlCommittedFileSha256':sha(committed_raw),'sqlPreparedFileSha256':sha(sql_prepared_raw),
  'transactionId':committed['xid'],'transactionStatus':'committed','fullSourcePostflightQualified':True,
  'additionalReadCount':4,'nativeWorkerStarted':False,'nativeGenerationPublished':False,'LOGINDispatched':False,
  'coordinatedPublicationAndReaderSwitchStillRequired':True,'proofHashes':proof_hashes}
except BaseException as error:
 original_trace=traceback.format_exc().encode()
 try:capture_summary=capture_histories('failure',error)
 except BaseException:
  proof_hashes['metadata-history-save-refusal']=write('metadata-history-save-refusal.private.txt',traceback.format_exc().encode())
 diagnostic=write('failure.private.txt',original_trace)
 observed_journals={}
 if session is not None and vars(session).get('cache')is not None:
  for name in['sql-intent.json','apply-sql-child.json','apply-sql-opened.json','sql-prepared.json','sql-committed.json','prepared.json']:
   path=session.cache.BASE/name
   if os.path.lexists(path):
    try:raw=protected(path);observed_journals[name]={'sha256':sha(raw),'bytes':len(raw)}
    except BaseException:observed_journals[name]={'protectedReadRefused':True}
 proof_hashes['failure-journal-observations']=write('failure-journal-observations.private.json',observed_journals)
 result={'format':'root-CONT5-cache-commit-v1','completed':False,'observedAt':now(),'stage':stage,'attemptId':ATTEMPT,
  'commitInvoked':commit_invoked,'commitReturned':commit_returned,'heldQualification':qualification_ref,
  'outcomeUnknownRequiresActualXIDCatalogInspection':commit_invoked,'outcomeReconciliationRequired':commit_invoked,
  'transactionOutcomeQualified':False,'privateDiagnosticSha256':diagnostic,'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'proofHashes':proof_hashes}
signal.alarm(0)
try:capture_summary.update(save_observations())
except BaseException:
 proof_hashes['observation-save-refusal']=write('observation-save-refusal.private.txt',traceback.format_exc().encode())
result.update(capture_summary)
result.update({'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,'realCOMMITInvoked':commit_invoked,
 'LOGINDispatched':False,'serviceActionsDispatched':0,'providerRefreshRequested':False,
 'baselineDispatched':False,'qualificationDispatched':False,'secondPrepareACKDispatched':False})
digest=write('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
raise SystemExit(0 if result['completed']else 1)
'''


def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def read_private(path):
    before=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_gid!=0 or before.st_nlink!=1 or before.st_mode&0o077 or before.st_size>16000000:
        raise RuntimeError('actual_protected_root_result_required')
    raw=path.read_bytes();after=path.lstat()
    if len(raw)!=before.st_size or any(getattr(before,key)!=getattr(after,key)for key in
        ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('same_actual_root_result_bytes_required')
    return json.loads(raw)


def successful_local_result(path):
    value=read_private(path)
    if type(value)is not dict or value.get('completed')is not True:
        raise RuntimeError('actual_successful_root_result_required_before_SSH')
    digest=value.get('resultSha256')
    if type(digest)is not str or len(digest)!=64 or any(c not in '0123456789abcdef'for c in digest):
        raise RuntimeError('actual_canonical_root_result_SHA_required_before_SSH')
    raw={key:item for key,item in value.items()if key!='resultSha256'}
    if hashlib.sha256(encoded(raw)).hexdigest()!=digest:
        raise RuntimeError('all_actual_successful_root_result_content_required_before_SSH')
    return value


def exclusive(path,value):
    raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');parser.add_argument('--profile',action='store_true');args=parser.parse_args()
    if not args.run:
        print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    if not BASELINE_CONTRACT_FINALIZED:raise SystemExit('actual_construct_only_baseline3_contract_not_yet_reviewed_no_execution')
    started=time.monotonic();os.umask(0o077)
    if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_commit_result_required_no_retry')
    refs=read_private(METADATA_REFS);baseline=successful_local_result(BASELINE_RESULT);held=successful_local_result(HELD_RESULT)
    if refs!=EXPECTED_REFS or baseline.get('format')!='root-CONT5-construct-only-baseline-v1'or baseline.get('baselineCaptureId')!='cont5-baseline-20261026-3'or \
        baseline.get('callerSha256')!='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'or \
        baseline.get('readerManifestSha256')!='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'or \
        not all(baseline.get(key)is True for key in['completed','fullCurrentQualifiedByGenuineConstruct','baselineCompleted'])or \
        baseline.get('priorReadPreparationResultSha256')!='ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'or \
        baseline.get('historicalSchedulingEvidenceOnly')is not True or baseline.get('approvalLifetimeReset')is not False:
        raise SystemExit('actual_successful_CONT5_baseline_and_exact_metadata_refs_required_before_SSH')
    if not isinstance(baseline.get('resultSha256'),str)or len(baseline['resultSha256'])!=64:
        raise SystemExit('actual_CONT5_baseline_remote_result_SHA_required')
    if held.get('format')!='root-CONT5-held-rollback-qualification-v2'or held.get('completed')is not True or \
        held.get('callerSha256')!=baseline['callerSha256']or held.get('readerManifestSha256')!=baseline['readerManifestSha256']or \
        held.get('baselineRootResultSha256')!=baseline['resultSha256']or held.get('transactionStatus')!='aborted'or \
        not isinstance(held.get('resultSha256'),str)or len(held['resultSha256'])!=64:
        raise SystemExit('actual_completed_CONT5_held_rollback_root_required_before_SSH')
    remote=REMOTE.replace('ACTUAL_BASELINE_RESULT',repr(baseline)).replace('ACTUAL_HELD_RESULT',repr(held)).replace('ACTUAL_METADATA_REFS',repr(refs)).replace('ACTUAL_ENABLE_PROFILE',repr(args.profile))
    try:
        remaining=900-(time.monotonic()-started)
        if remaining<=0:raise RuntimeError('root_commit_total_budget_expired_before_SSH')
        process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
            input=remote,capture_output=True,text=True,timeout=remaining)
        parsed=True
        try:
            result=json.loads(process.stdout)
            if type(result)is not dict or type(result.get('completed'))is not bool or result.get('format')!='root-CONT5-cache-commit-v1':
                raise ValueError('actual_root_commit_result_object_required')
        except Exception:
            parsed=False;result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True}
        if not parsed or process.returncode!=0 or process.stderr:
            exclusive(Path('/tmp/yunipals-cont5-cache-commit-transport-private-20261026-1.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result.update(completed=False,remoteAuditInspectionRequired=True,automaticRetryAllowed=False,
                outcomeUnknownRequiresActualXIDCatalogInspection=True,outcomeReconciliationRequired=True)
    except subprocess.TimeoutExpired as error:
        exclusive(Path('/tmp/yunipals-cont5-cache-commit-timeout-private-20261026-1.json'),
            {'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
             'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
        result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,
            'outcomeUnknownRequiresActualXIDCatalogInspection':True,'outcomeReconciliationRequired':True}
    exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get('completed')is True else 1)


if __name__=='__main__':main()
