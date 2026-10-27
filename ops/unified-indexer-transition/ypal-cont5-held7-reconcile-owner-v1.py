#!/usr/bin/env python3
"""One explicit read-only full catalog reconciliation for failed HELD7.

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
FAILED_RESULT=Path('/tmp/yunipals-held7-failure-detail-production-20261026-1.json')
# Root reviewed the complete delta against executed35eb and all 11 controls.
RECONCILIATION_SOURCE_REVIEWED=True
METADATA_REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
RESULT=Path('/tmp/yunipals-cont5-held7-reconcile-production-20261026-1.json')
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
failed_local=ACTUAL_HELD7_FAILURE
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-held7-reconcile-20261026-1')
BASELINE_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
BASELINE_CAPTURE='cont5-baseline-20261026-3'
FAILED_CAPTURE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-7')
FAILED_ROOT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-7')
FAILED_SHA='ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f'
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

def deadline(_signum,_frame):raise RuntimeError('root_readonly_held7_reconciliation_deadline_expired_no_retry')
def process_epoch_gone(pid,ticks):
 try:raw=(pathlib.Path('/proc')/str(pid)/'stat').read_text()
 except(FileNotFoundError,ProcessLookupError):return True
 actual=int(raw[raw.rfind(')')+2:].split()[19]);need(actual>0,'actual_live_process_start_ticks_required')
 return actual!=ticks

def failed_capture_frame():
 fixed={'apply-sql-child.json': ('f7946a212e4483d1ca764a107670954bf758e22adc4f1e78e12e8a651355dcbb', 2722913, 374), 'apply-sql-opened.json': ('1bdd71a9fe14259b2636039fb34186943ec7585e527d01ff4179f09df80c2881', 2722904, 448), 'approval-before-launch.json': ('a0445fd1f515dd4856495eed204f3c0f1b7c15c1f4c7434946b2b42c4d30e5ee', 2722908, 8260), 'failure.json': ('e751856cbb8aecb48c98f20bf1c903ab19faa50d4bc432e295f8563f781e34de', 2722905, 318), 'intent.json': ('61a33d72e12e47fab4b97a9e3dac2d89f779c1fd46f4b4e64268d2c9ade1f2fc', 2722903, 22299)}
 need({p.name for p in FAILED_CAPTURE.iterdir()}==set(fixed),'exact_held7_five_capture_files_without_prepared_or_result_required')
 result={name:file_frame(FAILED_CAPTURE/name,digest)for name,(digest,inode,size)in fixed.items()}
 need(all(result[name]['inode']==inode and result[name]['bytes']==size for name,(digest,inode,size)in fixed.items()),
  'actual_failed_held7_private_file_bytes_and_inodes_required')
 return result

def authenticate_failed():
 failed=document(FAILED_ROOT/'result.json',FAILED_SHA);same_local_remote(failed_local,failed,FAILED_SHA)
 need(failed['format']=='root-CONT5-held-rollback-qualification-v5'and failed['completed']is False and
  failed['rootDriverVariant']=='held7-unprofiled-after-exception-witness'and failed['stage']=='qualify-held-rollback-only'and
  failed['qualifierInvoked']is True and failed['qualifierReturned']is False and failed['heldQualification']is None and
  failed['transactionOutcomeQualified']is False and failed['outcomeReconciliationRequired']is True and
  failed['failureCode']=='complete_actual_held_callback_then_refused_COMMIT_ACK_required'and
  failed['afterExceptionWitnessRefused']is True and failed['afterExceptionWitnessSourceSha256']=='ba7e2570888811d741be95d53826e9dd1e71ad5beb3d89cb55cdff1e1c4925c1'and
  failed['passiveOriginalRunObserverRetained']is failed['currentSubprocessRunRestored']is True and
  all(failed[key]is False for key in ['liveTraceInstalled','liveProfileInstalled','SQLParentWrapped','SQLParentPopenOrPipeWrapped',
   'SQLTransportObservationInstalled','transportCountInferredFromMissingObserver'])and
  not({'observedSQLTransportCount','privateSQLStderrBytes','qualificationDiagnosticSha256','privateCallProfileSha256','profiledCallCount'}&set(failed))and
  failed['callerSha256']==CALLER_SHA and failed['readerManifestSha256']==MANIFEST_SHA and failed['metadataRefsSha256']==sha(encoded(refs))and
  failed['priorHeld6FailureSha256']=='c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372'and
  failed['priorHeld6ReconciliationSha256']=='23cb35fa68f1c728eb0d1c7e0e90238755832d434875002c1b849664f901c75d'and
  failed['proofHashes']['baseline-root-result']=='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'and
  all(failed[k]is False for k in['automaticRetryAllowed','realCOMMITDispatched','productionCOMMITQualified','productionPreparedACKCreated','LOGINDispatched','providerRefreshRequested'])and
  failed['serviceActionsDispatched']==0,'actual_failed_unprofiled_HELD7_no_invented_transport_count_or_inner_error_required')
 # The actual post-failure witness refused. Authenticate that refusal and the
 # untouched original outer failure; neither becomes a successful inner proof.
 protected(FAILED_ROOT/'failure.private.txt',failed['privateDiagnosticSha256'])
 protected(FAILED_ROOT/'after-exception-witness-refusal.private.txt',failed['afterExceptionWitnessRefusalSha256'])
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
  'untraced-dependency-inspection':'untraced-dependency-inspection.private.json'}
 need(set(failed['proofHashes'])==set(fixed),'all_twelve_actual_failed_HELD7_ancestry_nodes_required')
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
  'actual_23cb_reconciliation_ancestry_remains_separate_from_failed_HELD7')
 names={'actual-failed-held6':'actual-failed-held6.private.json','baseline-root-result':'authenticated-baseline-root-result.private.json',
  **{name:name+'.private.json'for name in ['authenticated-baseline-metadata-histories','authenticated-baseline-proof-hashes',
   'authenticated-baseline-archive','new-source-preflight','new-full-current-prerequisites','whole-catalog-reconciliation','full-source-postflight']}}
 need(set(old['proofHashes'])==set(names)and ancestry['proofHashes']==old['proofHashes'],'all_nine_original_23cb_proof_nodes_required')
 for key,name in names.items():protected(recon/name,old['proofHashes'][key])
 protected(recon/'metadata-capture-histories-success.private.json',old['metadataCaptureHistorySha256'])
 frame=failed_capture_frame();child=document(FAILED_CAPTURE/'apply-sql-child.json',frame['apply-sql-child.json']['sha256'])
 opened=document(FAILED_CAPTURE/'apply-sql-opened.json',frame['apply-sql-opened.json']['sha256'])
 failure=document(FAILED_CAPTURE/'failure.json',frame['failure.json']['sha256'])
 need(failure['completed']is False and failure['rollbackOnly']is True and failure['failureType']=='RuntimeError'and
  failure['productionCOMMITQualified']is failure['transactionOutcomeQualified']is failure['automaticRetryAllowed']is False,
  'actual_owned_authority_failure_receipt_not_qualified_transaction_outcome_required')
 need(child['mode']=='apply'and child['actor']['pid']==child['processGroup']==1684272 and child['rootParentPid']==1677207 and
  child['actor']['startTicks']==6641740157 and opened['childFileSha256']==frame['apply-sql-child.json']['sha256']and
  opened['message']['mode']=='apply'and opened['message']['xid']=='17049626'and opened['message']['event']=='transaction-opened'and
  opened['message']['format']=='yunipals-ypal-cache-guard-sql-v1'and len(opened['sessions'])==1 and
  opened['sessions'][0]['pid']==1684303 and opened['sessions'][0]['backendStart']=='1792990725881561'and
  opened['message']['backend']=={'pid':1684303,'backendStart':'1792990725881561','clientAddress':None,'clientPort':-1,
    'databaseOid':'17584','roleOid':'10','xid':'17049626'},'exact_actual_HELD7_child_opened_backend_and_XID_chain_required')
 return failed,frame,child,opened


def terminal(cache,host,authority):
 need(process_epoch_gone(1677207,6641711122)and process_epoch_gone(1684272,6641740157),
  'actual_failed_held7_root_and_SQL_child_epochs_must_be_gone')
 need(cache.xact_status(host,'17049626')=='aborted','actual_held7_opened_XID_must_be_aborted')
 backend_sql="SELECT count(*)::int FROM pg_stat_activity WHERE pid=1684303 AND (extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text='1792990725881561' AND datid=17584 AND usesysid=10"
 need(host.query(backend_sql)==0 and host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),
  'actual_held7_backend_epoch_all_APP_sessions_and_SQLentry_processes_must_be_absent')
 publication_sql="SELECT count(*)::int FROM pg_stat_activity WHERE datid=17584 AND application_name='ypal_full_publication_readonly'"
 need(host.query(publication_sql)==0,'original_held7_full_publication_peer_must_be_gone')
 return {'transactionId':'17049626','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,
  'backendEpochGone':True,'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
need(not os.path.lexists(AUDIT),'new_exclusive_readonly_held7_reconciliation_audit_required')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(880)
try:
 stage='authenticate-failed-held7';failed,failed_frame,child,opened=authenticate_failed()
 proof_hashes['actual-failed-held7']=write('actual-failed-held7.private.json',failed)
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
 stage='full-live-preflight';session=caller.Session(report['sourceRefs'],MANIFEST_SHA,refs)
 proof_hashes['new-source-preflight']=write('new-source-preflight.private.json',session.preflight())
 stage='new-cache-context';context=session.cache_context(CACHE_INPUT_SHA)
 need(type(context)is tuple and len(context)==2 and context[0]is session.cache and context[1]is session.host,
  'actual_cache_context_tuple_required')
 cache=session.cache;host=session.host;authority=cache.continuation_authority
 need(cache.BASE==CACHE_BASE and cache.__file__==str(OPS/'ypal-ordinary-read-cache-continue-v5.py'),
  'actual_unchanged_CONT5_provider_and_cache_namespace_required')
 stage='current-namespace-and-records';cache_frame=fixed_cache_frame(cache)
 need(failed_capture_frame()==failed_frame,'all_held7_capture_file_inodes_and_bytes_unchanged_after_context_required')
 actual_baseline=document(authority.BASE/'captures'/BASELINE_CAPTURE/'result.json',baseline['sha256'])
 need(all(encoded(baseline[key])==encoded(value)for key,value in actual_baseline.items())and actual_baseline['completed']is True,
  'actual_authority_baseline_receipt_not_rebuilt_or_relabelled_required')
 stage='full-current-prerequisites';prerequisites=host.prerequisites()
 need(prerequisites['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  encoded(prerequisites['metadataCurrentProof']['metadataEpoch'])==encoded(session.metadata_epoch.binding()),
  'genuine_full_current_metadata_and_actual_epoch_required')
 proof_hashes['new-full-current-prerequisites']=write('new-full-current-prerequisites.private.json',prerequisites)
 stage='whole-catalog-reconciliation'
 with host.read_host.primitives['sdk'].lock():
  initial_terminal=terminal(cache,host,authority)
  prior,current=authority.original_catalog(cache.prior_cache,host)
  need(prior['validated']is True and prior['binding']['transactionId']=='16540148'and
   prior['binding']['transactionStatus']=='aborted'and prior['binding']['priorChildGone']is prior['binding']['priorBackendGone']is True and
   prior['bindingSha256']==baseline['priorAbortedSha256'],'original_16540148_aborted_stop_and_journals_ancestry_required')
  expected=before['catalog']
  need(current['catalogSha256']==expected['catalogSha256']and
   encoded(current['postProof']['catalog'])==encoded(expected['postProof']['catalog'])and
   encoded(current['postProof']['reader'])==encoded(expected['postProof']['reader'])and
   encoded(current['postProof']['allColumnAcl'])==encoded(expected['postProof']['allColumnAcl']),
   'whole_original_catalog_all_column_ACLs_and_reader_graph_must_equal_actual_baseline3_before')
  need(fixed_cache_frame(cache)==cache_frame and failed_capture_frame()==failed_frame,
   'all_six_baseline_and_five_failed_capture_file_inodes_unchanged_around_catalog_required')
  final_terminal=terminal(cache,host,authority)
  need(encoded(initial_terminal)==encoded(final_terminal),'same_actual_held7_terminal_facts_around_catalog_required')
  proof_hashes['whole-catalog-reconciliation']=write('whole-catalog-reconciliation.private.json',{
   'failedHeld7RootResultSha256':FAILED_SHA,'acceptedBaselineRootResultSha256':baseline_local['resultSha256'],
   'beforeSha256':baseline['beforeSha256'],'actualCatalog':current,'priorAborted':prior,
   'wholeCatalogQualified':True,'allColumnACLQualified':True,'readerGraphQualified':True,
   'terminalBefore':initial_terminal,'terminalAfter':final_terminal,'baselineFiles':cache_frame,'failedCaptureFiles':failed_frame,
   'sharedSDKLockHeld':True,'newSQLMutationDispatched':False,'newPreparedACKCreated':False})
 catalog_qualified=True
 stage='full-source-postflight';postflight=session.finish()
 need(postflight['metadataActorCurrent']['currentActorQualified']is True and
  encoded(postflight['metadataEpoch'])==encoded(session.metadata_epoch.binding()),'actual_full_source_postflight_and_same_metadata_epoch_required')
 proof_hashes['full-source-postflight']=write('full-source-postflight.private.json',postflight)
 need(fixed_cache_frame(cache)==cache_frame and failed_capture_frame()==failed_frame,
  'all_original_records_unchanged_after_full_source_postflight_required')
 capture_summary=capture_histories('success');stage='complete'
 result={'format':'root-CONT5-held7-reconciliation-v1','completed':True,'stage':stage,'observedAt':now(),
  'failedHeld7RootResultSha256':FAILED_SHA,'acceptedBaselineRootResultSha256':baseline_local['resultSha256'],
  'transactionId':'17049626','transactionStatus':'aborted','childGone':True,'backendGone':True,'rootEpochGone':True,
  'wholeCatalogQualified':True,'allColumnACLQualified':True,'readerGraphQualified':True,'fullCurrentQualified':True,
  'fullSourcePostflightPassed':True,'baselineFileCount':6,'failedCaptureFileCount':5,'allOriginalFileBytesAndInodesUnchanged':True,
  'catalogProofSha256':proof_hashes['whole-catalog-reconciliation'],'proofHashes':proof_hashes}
except BaseException as error:
 original=traceback.format_exc().encode()
 try:capture_summary=capture_histories('failure',error)
 except BaseException:proof_hashes['history-save-refusal']=write('history-save-refusal.private.txt',traceback.format_exc().encode())
 result={'format':'root-CONT5-held7-reconciliation-v1','completed':False,'stage':stage,'observedAt':now(),
  'failedHeld7RootResultSha256':FAILED_SHA,'acceptedBaselineRootResultSha256':baseline_local.get('resultSha256'),
  'catalogObservedQualifiedBeforeFailure':catalog_qualified,'transactionOutcomeQualified':False,'wholeCatalogQualified':False,
  'privateDiagnosticSha256':write('failure.private.txt',original),'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'proofHashes':proof_hashes,'outcomeReconciliationRequired':True}
finally:signal.alarm(0)
result.update(capture_summary)
result.update({'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),
 'metadataCurrentProofProducerSha256':'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2',
 'priorReconciliationSha256':'80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125',
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,'realCOMMITDispatched':False,
 'qualifierDispatched':False,'baselineDispatched':False,'LOGINDispatched':False,'providerRefreshRequested':False,
 'databaseMutationsDispatched':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
 'newHeldSuccessAuthority':False,'newCommitAuthority':False})
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
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
 if not args.run:
  print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
 if RECONCILIATION_SOURCE_REVIEWED is not True:raise RuntimeError('HELD7_reconciliation_source_review_required_before_SSH')
 started=time.monotonic();os.umask(0o077)
 if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_held7_reconciliation_result_required_no_retry')
 baseline=actual_result(read_private(BASELINE_RESULT),'2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195')
 detail=read_private(FAILED_RESULT)
 if detail.get('format')!='root-held7-failure-detail-v1'or detail.get('rootResultSha256')!='ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f':
  raise RuntimeError('actual_HELD7_detail_and_original_canonical_operation_result_required')
 failed=actual_result(detail['operationResult'],'ef5fff2e1fed341771ab4c958a6328aed60e4c70f4029184cfd41ec44380676f')
 refs=read_private(METADATA_REFS)
 if encoded(refs)!=encoded(EXPECTED_REFS)or baseline.get('completed')is not True or failed.get('completed')is not False:
  raise SystemExit('actual_fixed_baseline_failure_and_metadata_refs_required_before_SSH')
 remote=REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(baseline)).replace('ACTUAL_METADATA_REFS',repr(refs)).replace('ACTUAL_HELD7_FAILURE',repr(failed))
 try:
  remaining=900-(time.monotonic()-started)
  if remaining<=0:raise RuntimeError('root_readonly_reconciliation_outer_budget_expired')
  process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
   '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
   input=remote,capture_output=True,text=True,timeout=remaining)
  try:
   result=json.loads(process.stdout)
   if type(result)is not dict or result.get('format')!='root-CONT5-held7-reconciliation-v1'or type(result.get('completed'))is not bool:
    raise ValueError('unexpected_readonly_reconciliation_envelope')
  except Exception:
   exclusive(Path('/tmp/yunipals-cont5-held7-reconcile-unparsed-private-20261026-1.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
  if process.returncode!=0 or process.stderr:
   exclusive(Path('/tmp/yunipals-cont5-held7-reconcile-transport-private-20261026-1.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result.update(completed=False,remoteAuditInspectionRequired=True)
 except subprocess.TimeoutExpired as error:
  exclusive(Path('/tmp/yunipals-cont5-held7-reconcile-timeout-private-20261026-1.json'),{'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
   'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
  result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
 exclusive(RESULT,result);print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result.get('completed')is True else 1)
if __name__=='__main__':main()
