#!/usr/bin/env python3
"""Root Family6 baseline entry; default/import inert. No forward cache COMMIT or LOGIN."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

RESULT = Path('/tmp/yunipals-cont6-baseline-production-20261026-2.json')
TRANSPORT = Path('/tmp/yunipals-cont6-baseline-transport-private-20261026-2.json')
FORMAT = 'yunipals-root-cont6-baseline-v2'
FROZEN_CONSTRUCTOR_FIX_READY = True  # Exact helper77fab87a/MF8c775588 independently reviewed.
REMOTE = r'''import copy,hashlib,json,os,pathlib,re,signal,socket,stat,time,traceback,types
os.umask(0o077)
FORMAT='yunipals-root-cont6-baseline-v2'
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont6-baseline-20261026-2')
CAPTURE='cont6-baseline-20261026-2'
CALLER=OPS/'ypal-ordinary-publication-continue-v6.py'
CALLER_SHA='55391a93cabc13393abf449a77bb667e6ab41a853cdd9089af6fa437c2c4532c'
BINDING_HELPER=OPS/'ypal-native-readiness-prepared-binding-v1.py'
BINDING_SHA='77fab87ac98eafe2487627151b0dc7d09ce6083cced00dc8c84ffa1f4089fe2a'
BINDING_MANIFEST_SHA='8c775588084c7c5d37b57ac43abe251d3facef29543dd5fea9ce756dfa6118d4'
MANIFEST_SHA='524c45b6453c7eee4bfc876a47f1e93df49c59afc8be7a383ee068f177c799ca'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
OLD_INPUT=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-input-v2-20261025/input.json')
NEW_INPUT=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-input-v6-20261026/input.json')
CACHE_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026')
AUTH_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v6-20261026')
AUTH_INPUT=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-input-v6-20261026/input.json')
AUTH_SHA='a468a1ebbb4bf3fe40b5506dfdc7959602b38b91ad051a4dd0674af2fc45cb6c'
META={'mode':'current','resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343','inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca','producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1','manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'}
POLICY={'producerSha256':'33c6cae5ffe0980376a3ce5a6baa76096e2a619a7869b1b57c5f82de7e941210','manifestSha256':'89b2d78177b5e7356fb65a21ae87f8eac7e6a6c0a59184b68dd202858e99ea53','resultSha256':'90ad380f190bf43ab21ccaea15df940cfeeb121d85b96db85eaef35bec9f81f6'}
FRAME=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
stage='initial';session=None;invoked=False;returned=False;proofs={};old=None
def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+chr(10)).encode()
def read(path,digest=None):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_baseline_file_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=6000000 and all(getattr(before,k)==getattr(after,k)for k in FRAME)and(digest is None or sha(raw)==digest),'same_exact_baseline_file_required')
 return raw
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def exclusive(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(path.parent);return sha(raw)
def save(name,value):return exclusive(AUDIT/name,encoded(value))
def old_frames():
 prior=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025')
 five=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v5-20261026')
 paths=[OLD_INPUT,REPORT,AUTH_INPUT,pathlib.Path('/var/backups/yunipals-native-metadata-approval-epoch-input-v3-20261025/input.json'),pathlib.Path('/var/backups/yunipals-native-metadata-approval-epoch-v3-20261025/result.json'),pathlib.Path('/var/backups/yunipals-native-metadata-readiness-policy-v2-20261026/result.json')]
 paths +=[five/name for name in['before.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json','rehearsed.json','authorization.json']]
 paths +=[prior/name for name in['before.json','rehearsed.json','authorization.json','boot-disable-intent.json','boot-disabled.json','disable-reload-intent.json','disable-reload-result.json','stop-intent.json','stopped.json','sql-intent.json','apply-sql-child.json','apply-sql-opened.json']]
 result={}
 for path in paths:
  raw=read(path);row=path.lstat();result[str(path)]={'sha256':sha(raw),**{k:getattr(row,k)for k in FRAME}}
 return result
def reuse_input():
 previous_dir=pathlib.Path('/var/backups/yunipals-root-cont6-baseline-20261026-1')
 previous=json.loads(read(previous_dir/'result.private.json','36fe1cb6da9abc103c332da49829d33bcb04730a3fe1079e423b0b0f520bc0f0'))
 need(previous['format']=='yunipals-root-cont6-baseline-v1'and previous['completed']is False and previous['stage']=='cache-context'and previous['failureType']=='KeyError'and previous['constructInvoked']is previous['constructReturned']is previous['cacheCommitRequested']is previous['readerLOGINRequested']is False and previous['serviceActionsRequested']==0,'actual_preconstruct_family6_failure_without_effects_required')
 detail=json.loads(read(previous_dir/'failure-traceback.private.json',previous['proofHashes']['failureTraceback']))
 need(detail['type']=='KeyError'and detail['traceback'].endswith("KeyError: 'module'\n")and 'bind_source_guard'in detail['traceback']and 'ypal-native-readiness-context-v2.py'in detail['traceback'],'actual_exact_known_constructor_failure_required')
 copied=json.loads(read(previous_dir/'input-copy.private.json',previous['proofHashes']['inputCopy']))
 need(copied=={'source':str(OLD_INPUT),'destination':str(NEW_INPUT),'sha256':CACHE_SHA,'originalBytesChanged':False},'actual_first_owned_input_copy_proof_required')
 before=json.loads(read(previous_dir/'old-files-before.private.json',previous['proofHashes']['oldFilesBefore']))
 need(old_frames()==before and not os.path.lexists(pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026'))and not os.path.lexists(pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v6-20261026')),'actual_original_files_preserved_and_no_first_baseline_records_required')
 raw=read(OLD_INPUT,CACHE_SHA);need(read(NEW_INPUT,CACHE_SHA)==raw,'same_owned_new_input_exact_original_bytes_required')
 file=NEW_INPUT.lstat();parent=NEW_INPUT.parent.lstat()
 need(stat.S_IMODE(file.st_mode)==0o600 and stat.S_IMODE(parent.st_mode)==0o700,'owned_private_input_file_and_directory_modes_required')
 return{'previousResultSha256':'36fe1cb6da9abc103c332da49829d33bcb04730a3fe1079e423b0b0f520bc0f0','previousProofHashes':previous['proofHashes'],'inputCopy':copied,'newInputFrame':{key:getattr(file,key)for key in FRAME},'inputReusedWithoutWrite':True,'priorSourcePreflightReused':False}
def histories(error=None):
 rows=[]
 for label,epoch in[('session',getattr(session,'metadata_epoch',None)),('cache',getattr(getattr(session,'cache',None),'metadata_epoch',None))]:
  if epoch is not None:rows.append({'label':label,'history':copy.deepcopy(getattr(epoch,'current_capture_history',()))})
 attempts=[attempt for row in rows for capture in row['history']for attempt in capture['attempts']]
 value={'format':'root-Family6-metadata-capture-histories-v1','instances':rows,'exceptionHistory':copy.deepcopy(getattr(error,'metadata_current_capture_history',()))}
 digest=save('metadata-capture-histories.private.json',value)
 return{'sha256':digest,'instances':len(rows),'captures':sum(len(row['history'])for row in rows),'attempts':len(attempts),'discarded':sum(attempt['discarded']is True for attempt in attempts)}
def run():
 global stage,session,invoked,returned,old
 stage='authenticate-owned-input'
 need(not os.path.lexists(CACHE_BASE)and not os.path.lexists(AUTH_BASE/'captures'/CAPTURE),'fresh_family6_baseline_and_capture_required')
 source=read(CALLER,CALLER_SHA);read(OPS/'ypal-ordinary-reader-continue-v6.manifest.json',MANIFEST_SHA)
 report=json.loads(read(REPORT,REPORT_SHA));config=json.loads(read(AUTH_INPUT,AUTH_SHA))
 need(config=={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6-input','nativePolicyRefs':POLICY},'actual_authority6_policy_input_required')
 old=old_frames();proofs['oldFilesBefore']=save('old-files-before.private.json',old)
 proofs['ownedInputReuse']=save('owned-input-reuse.private.json',reuse_input())
 stage='construct-session'
 module=types.ModuleType('root_actual_family6');module.__file__=str(CALLER);exec(compile(source,str(CALLER),'exec'),module.__dict__)
 session=module.Session(report['sourceRefs'],MANIFEST_SHA,META,POLICY,AUTH_SHA,False)
 stage='full-source-preflight';proofs['preflight']=save('preflight.private.json',session.preflight())
 stage='bind-reviewed-constructor-successor'
 need(type(BINDING_SHA)is str and re.fullmatch('[a-f0-9]{64}',BINDING_SHA)and type(BINDING_MANIFEST_SHA)is str and re.fullmatch('[a-f0-9]{64}',BINDING_MANIFEST_SHA),'actual_frozen_constructor_successor_source_refs_required')
 binding_raw=read(BINDING_HELPER,BINDING_SHA);read(BINDING_HELPER.with_suffix('.manifest.json'),BINDING_MANIFEST_SHA)
 helper=types.ModuleType('root_actual_prepared_binding_successor');helper.__file__=str(BINDING_HELPER);exec(compile(binding_raw,str(BINDING_HELPER),'exec'),helper.__dict__)
 binding=helper.bind(session);proofs['constructorBinding']=save('constructor-binding.private.json',binding)
 need(binding['format']=='yunipals-native-readiness-prepared-binding-v1'and binding['operatorSha256']==BINDING_SHA and binding['manifestSha256']==BINDING_MANIFEST_SHA and binding['authorityInputSha256']==AUTH_SHA and binding['nativePolicyRefs']==POLICY and binding['metadataRefs']==META and binding['sourceRefs']==report['sourceRefs']and binding['sameAlreadyBoundGuardRequired']is True and binding['originalFamily1ConstructorPassed']is binding['sourceFactsReused']is binding['currentPredicatesChanged']is False,'actual_same_source_policy_epoch_and_authority_constructor_binding_required')
 stage='cache-context';session.cache_context(CACHE_SHA)
 need(session.key['preparedConstructorBinding']==binding and session.cache.continuation_context['preparedConstructorBinding']==binding,'actual_binding_in_cache_and_session_full_timing_keys_required')
 need(session.cache.BASE==CACHE_BASE and session.cache.continuation_authority.BASE==AUTH_BASE and session.cache.continuation_authority.TTL_NS==120_000_000_000 and session.cache.continuation_authority.COMMIT_RESERVE_NS==5_000_000_000,'actual_new_family6_cache_and_authority_scope_required')
 stage='construct-records';invoked=True
 baseline=module.construct_records(session,CAPTURE);returned=True
 proofs['baseline']=save('baseline.private.json',baseline)
 need(baseline['format']=='yunipals-ypal-ordinary-cache-continuation-authority-v6'and baseline['completed']is True and baseline['action']=='construct-records'and baseline['fullSourcePostflight']['validated']is True and baseline['productionPreparedACKCreated']is baseline['productionCOMMITQualified']is baseline['newStopActionPerformed']is False,'complete_genuine_new_baseline_and_source_postflight_required')
 need(encoded(baseline['identity']['preparedConstructorBinding'])==encoded(binding),'actual_constructor_binding_in_owned_baseline_identity_required')
 need(type(baseline['actualNewRehearsalXID'])is str and re.fullmatch('[1-9][0-9]*',baseline['actualNewRehearsalXID'])and baseline['actualNewRehearsalXID']!='16540148','actual_new_baseline_rehearsal_XID_required')
 owned=json.loads(read(AUTH_BASE/'captures'/CAPTURE/'result.json',baseline['sha256']))
 need(encoded(owned['identity'])==encoded(baseline['identity'])and encoded(owned['identity']['preparedConstructorBinding'])==encoded(binding),'same_actual_saved_baseline_identity_and_private_constructor_binding_required')
 for name,key in[('before.json','beforeSha256'),('rehearsed.json','rehearsedSha256'),('authorization.json','authorizationSha256')]:read(CACHE_BASE/name,baseline[key])
 stage='preservation-and-private-history';need(old_frames()==old,'all_known_original_bytes_and_inodes_unchanged_required')
 proofs['oldFilesAfter']=save('old-files-after.private.json',old_frames());history=histories()
 return{'format':FORMAT,'completed':True,'stage':'complete','callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'cacheInputSha256':CACHE_SHA,'authorityInputSha256':AUTH_SHA,'policyRefs':POLICY,'baselineCaptureId':CAPTURE,'baselineSha256':baseline['sha256'],'rehearsalXID':baseline['actualNewRehearsalXID'],'constructorBindingSourceSha256':BINDING_SHA,'constructorBindingManifestSha256':BINDING_MANIFEST_SHA,'constructorBindingSha256':proofs['constructorBinding'],'baselineConstructed':True,'fullSourcePostflightPassed':True,'oldFilesUnchanged':True,'metadataCaptureHistory':history,'proofHashes':proofs,'constructInvoked':True,'constructReturned':True,'cacheCommitRequested':False,'readerLOGINRequested':False,'serviceActionsRequested':0,'automaticRetryAllowed':False,'outerPreparationBoundSeconds':1200}
def main():
 need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_baseline_host_required')
 AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
 save('intent.json',{'format':FORMAT,'captureId':CAPTURE,'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'automaticRetryAllowed':False})
 def expired(*_):raise TimeoutError('root_family6_outer_preparation_deadline_inspect_no_replay')
 signal.signal(signal.SIGALRM,expired);signal.alarm(1200)
 try:result=run()
 except BaseException as error:
  try:proofs['failureTraceback']=save('failure-traceback.private.json',{'type':type(error).__name__,'traceback':traceback.format_exc()})
  except BaseException:pass
  try:history=histories(error)
  except BaseException:history=None
  result={'format':FORMAT,'completed':False,'stage':stage,'failureType':type(error).__name__,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else None,'constructInvoked':invoked,'constructReturned':returned,'outcomeRequiresInspection':invoked,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'metadataCaptureHistory':history,'proofHashes':proofs,'cacheCommitRequested':False,'readerLOGINRequested':False,'serviceActionsRequested':0}
 finally:signal.alarm(0)
 save('result.private.json',result);print(encoded(result).decode(),end='')
 return 0 if result['completed']else 1
if __name__=='__main__':raise SystemExit(main())
'''


def exclusive(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    if not args.run:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'automaticRetryAllowed': False}))
        return 0
    if not FROZEN_CONSTRUCTOR_FIX_READY:
        raise RuntimeError('actual_frozen_constructor_successor_required_before_dispatch')
    if os.path.lexists(RESULT) or os.path.lexists(TRANSPORT):
        raise RuntimeError('exclusive_root_result_and_transport_namespace_required')
    argv = ['ssh', '-oBatchMode=yes', '-oConnectTimeout=10', '-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts', 'root@168.119.172.10', 'python3 -I -B -']
    try:
        peer = subprocess.run(argv, input=REMOTE.encode(), capture_output=True, timeout=1220)
        out, err, status = peer.stdout, peer.stderr, peer.returncode
    except subprocess.TimeoutExpired as error:
        out, err, status = error.stdout or b'', error.stderr or b'', None
    value = None
    try:
        candidate = json.loads(out)
        if type(candidate) is dict and candidate.get('format') == FORMAT and type(candidate.get('completed')) is bool and not err and status == (0 if candidate['completed'] else 1):
            value = candidate
    except (ValueError, UnicodeError):
        pass
    if value is None:
        exclusive(TRANSPORT, json.dumps({'stdoutHex': out.hex(), 'stderrHex': err.hex(), 'returncode': status}).encode())
        value = {'format': FORMAT, 'completed': False, 'transportOutcomeUnknown': True,
                 'remoteAuditInspectionRequired': True, 'automaticRetryAllowed': False}
    else:
        value = {**value, 'resultSha256': hashlib.sha256(out).hexdigest()}
    exclusive(RESULT, (json.dumps(value, sort_keys=True) + chr(10)).encode())
    print(json.dumps(value, sort_keys=True))
    return 0 if value['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
