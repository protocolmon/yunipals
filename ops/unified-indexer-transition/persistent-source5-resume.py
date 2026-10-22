#!/usr/bin/env python3
"""One manually approved free-only source5 resume from the actual quarantined long1."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import time
import types

COMMON_SHA='25a595d23d8584977df4d02438fc5fe021ef5b077569585cf6a42a853b3bab3c'
UPGRADER_SHA='9361692a9b1de13ddc6e47e05fd9d767d7a1e7dca4b2407bcd8a9cbe5874f3c9'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FORMAT='yunipals-persistent-source5-manual-resume-v1'
PROOF_BASE=Path('/var/backups/yunipals-unified-range-hints-v5-20261021')
PLAN_KEYS={'format','runId','freeOnly','maximumSeconds','proxyProofDirectories','legacyRebaseFile','legacyRebaseSha256','dependencyRebaseFile','dependencyRebaseSha256','diagnosisFile','diagnosisSha256'}


def modules():
    path=OPS/'source5-epoch-common.py'
    import hashlib
    import stat
    for item in [*path.parents,path]:
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('Protected source5 common primitive required.')
    raw=path.read_bytes()
    if not re.fullmatch(r'[0-9a-f]{64}',COMMON_SHA) or hashlib.sha256(raw).hexdigest()!=COMMON_SHA:raise RuntimeError('Exact source5 common helper pin required.')
    c=types.ModuleType('resume_source5_common');c.__file__=str(path);exec(compile(raw,str(path),'exec'),c.__dict__)
    return c,c.primitives(),c.persistent()


def validate_plan(c,plan):
    if (set(plan)!=PLAN_KEYS or plan['format']!=FORMAT or plan['freeOnly'] is not True or type(plan['maximumSeconds']) is not int or
        plan['maximumSeconds']!=28800 or not re.fullmatch(r'20261020-008028af-[a-z0-9]{1,16}',plan['runId']) or
        plan['runId']=='20261020-008028af-long1' or set(plan['proxyProofDirectories'])!=set(c.CHAINS)):
        c.fail('Exact one-attempt8h free-only source5 manual plan required.')
    for key in ['legacyRebaseSha256','dependencyRebaseSha256','diagnosisSha256']:
        if not isinstance(plan[key],str) or not re.fullmatch(r'[0-9a-f]{64}',plan[key]):c.fail('Actual source5 public proof hashes required.')
    for key in ['legacyRebaseFile','dependencyRebaseFile','diagnosisFile']:
        if not isinstance(plan[key],str) or not Path(plan[key]).is_absolute() or '..' in Path(plan[key]).parts:c.fail('Protected source5 proof selectors required.')
    for key,name in [('legacyRebaseFile','legacy-rebase-range-hints-v5.json'),('dependencyRebaseFile','dependency-rebase-range-hints-v5.json')]:
        if Path(plan[key])!=OPS/name:c.fail('Exact versioned source5 rebase required.')
    for chain,directory in plan['proxyProofDirectories'].items():
        path=Path(directory)
        if path.parent!=PROOF_BASE/c.CHAINS[chain] or not re.fullmatch(r'[0-9a-f]{64}',path.name):c.fail('Exact four source5 applied proof directories required.')


def diagnosis(c,plan,record):
    value=c.pinned_json(plan['diagnosisFile'],plan['diagnosisSha256'],16384)
    expected={'format':'yunipals-explicit-long1-source5-resume-diagnosis-v1','parentHelperSha256':c.PERSISTENT_SHA,
        'parentReviewSha256':c.LONG1_REVIEW_SHA,'parentMonitorSha256':c.LONG1_MONITOR_SHA,'terminalWitnessSha256':c.LONG1_TERMINAL_SHA,
        'nativeExitStatus':75,'stopReason':record['last']['reason'],'quarantined':True,'source5Digest':c.SOURCE,
        'manuallyApprovedNewAttemptOnly':True,'automaticRetryAllowed':False,'observedTerminalClasses':value.get('observedTerminalClasses')}
    classes=value.get('observedTerminalClasses')
    if value!=expected or not isinstance(classes,list) or not 1<=len(classes)<=16 or any(not isinstance(x,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}',x) for x in classes):
        c.fail('Explicit hash-bound source5 diagnosis required; quarantined75 never auto-retries.')
    return {'sha256':plan['diagnosisSha256'],'manualNewAttemptOnly':True,'nativeExitStatus':75}


def package(c,v,p,helper,ctx,old_artifact,old_plan):
    installed=c.verify_runtime(v);inventory=c.pinned_json(c.INVENTORY,c.INVENTORY_SHA);clean=c.pinned_json(c.EVIDENCE,c.EVIDENCE_SHA)
    if (clean.get('format')!='yunipals-unified-proxy-epoch-evidence-v1' or installed['expectedNativeBuildId']!=c.NATIVE or installed['manifestHash']!=c.MANIFEST or
        clean.get('source',{}).get('archiveSha256')!=c.SOURCE_ARCHIVE_SHA or c.sha(c.trusted(c.ROOT/'RELEASE-MANIFEST.json'))!=c.SOURCE_MANIFEST_SHA):
        c.fail('Exact clean source5 proxy-only package proof required.')
    pins={'sourceDigest':c.SOURCE,'sourceManifestSha256':c.SOURCE_MANIFEST_SHA,'inventorySha256':c.INVENTORY_SHA}
    ctx.transition.validate_clean_evidence({**clean,'format':'yunipals-unified-release-candidate2-evidence-v1'},pins,inventory,ctx.old.RUNTIME_HELPER_SHA)
    old_manifest=json.loads(c.trusted(v.ROOT/'RELEASE-MANIFEST.json'));new_manifest=json.loads(c.trusted(c.ROOT/'RELEASE-MANIFEST.json'))
    delta=helper.source_diff(ctx.transition,old_manifest,new_manifest)
    old_clean=json.loads(c.trusted(old_plan['epochPlan']['proxyArtifact']['cleanEvidenceFile']))
    runtime_delta=helper.runtime_diff(v.ROOT,c.ROOT,old_artifact['inventory'],inventory,old_clean['runtime']['buildRoot'],clean['runtime']['buildRoot'])
    return {'installed':installed,'sourceDelta':delta,'runtimeDelta':runtime_delta,'inventory':inventory}


def current_proxies(c,v,observer,plan,record,current,*,live):
    if v.digest(v.safe_file(c.ROOT/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs'))!=c.PROXY_SHA:c.fail('Source5 proxy entrypoint bytes changed.')
    def one(item):
        chain,name=item;unit='yunipals-market-production-rpc@'+name+'.service';directory=Path(plan['proxyProofDirectories'][chain])
        raw=c.trusted(directory/'review.json');before=json.loads(raw);result=json.loads(c.trusted(directory/'result.json'));inherit=c.inherited_proxy(v,record,int(chain))
        target=v.SYSTEMD/(unit+'.d')/c.OVERRIDE;target_raw=c.trusted(target,20000)
        expected={'unit':unit,'chainId':int(chain),'sourceRoot':str(c.ROOT),'sourceDigest':c.SOURCE,'profileId':v.PROFILE_ID,
            'runtimeSha256':c.PROXY_SHA,'runtimeInventorySha256':c.INVENTORY_SHA,'runtimeArchiveSha256':c.ARCHIVE_SHA,
            'overridePath':str(target),'overrideSha256':c.sha(target_raw),'beforeInvocationId':inherit['invocation']}
        if (c.sha(raw)!=directory.name or c.sha(c.encoded(before))!=directory.name or before.get('format')!='yunipals-proxy-range-hints-upgrade-v5' or
            before.get('helperSha256')!=UPGRADER_SHA or before.get('commonHelperSha256')!=COMMON_SHA or before.get('long1')!=record['summary'] or
            before.get('inheritedProxy')!=inherit or any(before.get(k)!=value for k,value in expected.items()) or
            result.get('reviewHash')!=directory.name or result.get('review')!=before or any(result.get(k)!=value for k,value in expected.items()) or
            result.get('afterInvocationId')!=current[unit]['InvocationID'] or result.get('afterInvocationId')==inherit['invocation'] or
            any(result.get(k) is not True for k in ['applied','legacyHealthPassed','legacyConfigurationPreserved','verifyExecStart']) or
            any(result.get(k) is not False for k in ['privateSettingsChanged','ingestorStarted','sourceSelectionChanged','newPermits']) or result.get('paidCalls')!=0 or
            before.get('override')!=target_raw.decode() or before.get('originalDefinitionHashes')!=inherit['definitions'] or before.get('privateSettings')!=inherit['privateSettings']):
            c.fail('Exact source5 upgrade/runtime/invocation provenance required on every chain.')
        props=observer.state(unit);v.verify_exec_start(props,c.ROOT);definitions=v.definitions(props)
        if (props['InvocationID']!=current[unit]['InvocationID'] or definitions!={**inherit['definitions'],str(target):expected['overrideSha256']} or
            v.private_settings(props)!=inherit['privateSettings'] or c.environment_hashes(v,props)!=before.get('environmentFileHashes')):c.fail('Current source5 definitions or private settings differ.')
        metrics=observer.request(v.CHAINS[name][1],'/metrics')
        config={key:metrics[key] for key in v.CONFIG_KEYS}
        if observer.request(v.CHAINS[name][1],'/health').get('status')!='ready' or config!=inherit['legacyConfiguration']:c.fail('Current source5 local health/configuration differs.')
        if live and observer.legacy_health(v.CHAINS[name][1],int(chain))!=config:c.fail('Source5 startup chain identity differs.')
        return {'chainId':int(chain),'unit':unit,'reviewSha256':c.sha(raw),'resultSha256':c.sha(c.trusted(directory/'result.json')),
            'invocation':props['InvocationID'],'definitionsSha256':c.sha(c.encoded(definitions)),'privateSettingsSha256':c.sha(c.encoded(inherit['privateSettings']))}
    with ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(one,c.CHAINS.items()))
    return {'sha256':c.sha(c.encoded(rows)),'proofs':rows}


def rebase_plan(plan,old_plan):
    return {**old_plan['epochPlan'],**{key:plan[key] for key in ['legacyRebaseFile','legacyRebaseSha256','dependencyRebaseFile','dependencyRebaseSha256']}}


def review(c,v,p,plan,*,existing_directory=None,live=True):
    validate_plan(c,plan);record=c.history();manual=diagnosis(c,plan,record);c.stopped_long1(v)
    old_plan=record['binding']['plan'];helper=p.load_epoch(old_plan['epochHelper']);p.validate_plan(old_plan,helper)
    ctx,_,old_artifact,origin,_,qualification=p.historical_prerequisite(old_plan,helper)
    artifact=package(c,v,p,helper,ctx,old_artifact,old_plan);epoch=record['binding']['liveEpoch'];states=ctx.old.service_states(ctx.old.LEGACY_UNITS)
    selector=ctx.old.active_selector()
    if selector!=[]:c.fail('Source5 replay cannot change the active selector.')
    rebases=helper.rebases(rebase_plan(plan,old_plan),ctx,states);proxies=current_proxies(c,v,helper.local_verifier(v,ctx.old),plan,record,states,live=live)
    metrics=ctx.old.source_metrics();latest=record['last']['after']['metrics']
    if metrics.get('runtime')!=latest['runtime'] or metrics.get('checkpoints')!=latest['checkpoints']:c.fail('Retained physical runtime/checkpoints advanced after quarantined long1.')
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old,ctx.profile,c.MANIFEST),c.NATIVE,len(ctx.profile['manifest']['sources']),latest)
    policy=ctx.cont.free_policy_snapshot(ctx.old,ctx.env,ctx.profile)
    if ctx.old.peer_acl()!=epoch['peer'] or ctx.cont.retained_policy_binding(ctx.old,policy,free_only=True)!=epoch['policy']:c.fail('Original source peer or free-only budget policy changed.')
    if ctx.transition.registered_source(ctx.old,ctx.profile)!=epoch['registeredSource']:c.fail('Registered physical release/schema/build changed.')
    observation=ctx.old.proxy_observation();ctx.old.validate_proxies(observation,epoch['identity'])
    if any(c.counters(observation).values()):c.fail('New proxy epoch isolated paid/refused counters must be zero.')
    pins={str(c.LONG1/'review.json'):c.LONG1_REVIEW_SHA,str(c.LONG1/'monitor.jsonl'):c.LONG1_MONITOR_SHA,str(c.TERMINAL):c.LONG1_TERMINAL_SHA,
        str(c.OPS/'source5-epoch-common.py'):COMMON_SHA,str(c.OPS/'proxy-upgrade-range-hints-v5.py'):UPGRADER_SHA,
        str(c.INVENTORY):c.INVENTORY_SHA,str(c.EVIDENCE):c.EVIDENCE_SHA,str(c.ROOT/'RELEASE-MANIFEST.json'):c.SOURCE_MANIFEST_SHA,
        str(c.ROOT/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs'):c.PROXY_SHA,
        plan['legacyRebaseFile']:plan['legacyRebaseSha256'],plan['dependencyRebaseFile']:plan['dependencyRebaseSha256'],plan['diagnosisFile']:plan['diagnosisSha256'],
        str(Path(__file__).absolute()):c.sha(c.trusted(Path(__file__).absolute()))}
    pins.update(record['binding']['inputPins'])
    if any(c.sha(c.trusted(path))!=value for path,value in pins.items()):c.fail('Retained source/F1/proxy5/diagnosis input changed.')
    new_epoch={**{k:epoch[k] for k in ['peer','policy','registeredSource','identity']},'legacyUnits':states,'activeSelector':selector,'proxies':proxies,'rebases':rebases}
    binding={'format':FORMAT,'plan':plan,'helperSha256':c.sha(c.trusted(Path(__file__).absolute())),'commonHelperSha256':COMMON_SHA,
        'long1':record['summary'],'manualDiagnosis':manual,'prerequisite900Sha256':c.sha(c.encoded(qualification)),'liveEpoch':new_epoch,'inputPins':pins,
        'source5Package':{k:artifact[k] for k in ['installed','sourceDelta','runtimeDelta']},'sourceDigest':c.ACTOR,'nativeBuild':c.NATIVE,
        'retainedWorkspace':str(ctx.workspace),'retainedSchema':ctx.old.SCHEMA,'limits':p.limits(ctx),'systemdProperties':p.properties(ctx,ctx.workspace/'apps/yunipals-indexer'),
        'originalCacheBytes':531472384,'freeOnly':True,'launchGrantIds':[],'sourceOrCacheReset':False,'newWorkspaceCopy':False,
        'automaticRetryAllowed':False,'consumerServingAllowed':False,'previousRuntime':latest['runtime'],'previousCheckpoints':latest['checkpoints']}
    result={'reviewHash':c.sha(c.encoded(binding)),'binding':binding,'metrics':metrics,'proxies':observation,'started':False}
    free=shutil.disk_usage(ctx.candidate.SOURCE).free
    if free<ctx.old.START_FREE or p.stop_reason({'freeBytes':free,'metrics':metrics,'legacyUnits':states,'activeSelector':selector},result,0):c.fail('Original cumulative resource limits prevent source5 resume.')
    ctx.old.free_port()
    if ctx.old.service_states((p.unit_name(plan),))[p.unit_name(plan)]['LoadState']!='not-found':c.fail('Fresh source5 resume transient unit required.')
    directory=ctx.old.BASE/'source5-resumes'/plan['runId']
    if existing_directory is None:
        if directory.exists() or directory.is_symlink():c.fail('Source5 resume evidence must not be overwritten.')
    elif directory!=existing_directory or directory.is_symlink() or directory.stat().st_uid!=0 or directory.stat().st_mode&0o022 or list(directory.iterdir()):
        c.fail('Prepared source5 resume directory differs.')
    return result,(helper,ctx,record,directory)


def validate_running(c,v,p,plan,prepared,baseline,sample,own,invocation,elapsed):
    helper,ctx,record,_=prepared;epoch=baseline['binding']['liveEpoch']
    if any(c.sha(c.trusted(path))!=value for path,value in baseline['binding']['inputPins'].items()):c.fail('Pinned source5 resume inputs changed.')
    ctx.old.validate_proxies(sample['proxies'],epoch['identity'])
    if c.counters(sample['proxies'])!=c.counters(baseline['proxies']):c.fail('Isolated paid/refused counters changed or reset.')
    if sample['legacyUnits']!=epoch['legacyUnits'] or sample['activeSelector']!=[]:c.fail('Source5/legacy invocation or selector drift.')
    if (ctx.cont.retained_policy_binding(ctx.old,sample['policy'],free_only=True)!=epoch['policy'] or ctx.old.peer_acl()!=epoch['peer'] or
        ctx.transition.registered_source(ctx.old,ctx.profile)!=epoch['registeredSource']):c.fail('Source peer/free-only policy/release changed.')
    if (helper.rebases(rebase_plan(plan,record['binding']['plan']),ctx,sample['legacyUnits'])!=epoch['rebases'] or
        current_proxies(c,v,helper.local_verifier(v,ctx.old),plan,record,sample['legacyUnits'],live=False)!=epoch['proxies']):c.fail('Source5 runtime/rebase proof changed.')
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old,ctx.profile,c.MANIFEST),c.NATIVE,len(ctx.profile['manifest']['sources']),{},starting=False)
    c.stopped_long1(v)
    if own.get('InvocationID')!=invocation:c.fail('Owned source5 resume invocation changed.')
    if own['ActiveState'] not in {'inactive','failed'}:p.actual_resources(plan,ctx,invocation,baseline['reviewHash'],allow_timeout_shutdown=elapsed>=28800)


def completion_proof(c,p,plan,ctx,invocation,elapsed):
    if elapsed is None or elapsed<28800:return None
    keys=['Id','InvocationID','ActiveState','SubState','Result','ExecMainStatus','ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic']
    raw=ctx.old.command(['/usr/bin/systemctl','show',p.unit_name(plan),*['--property='+key for key in keys]],env=ctx.old.ROLE_ENV,timeout=2);value={}
    for line in raw.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys or key in value:return None
        value[key]=item
    if (set(value)!=set(keys) or value['Id']!=p.unit_name(plan) or value['InvocationID']!=invocation or
        value['ActiveState'] not in {'inactive','failed'} or value['Result'] not in {'success','timeout'} or value['ExecMainStatus']=='75' or
        any(not re.fullmatch(r'[0-9]{1,20}',value[key]) for key in keys[-2:])):return None
    start,end=(int(value[key]) for key in keys[-2:])
    if start<=0 or end-start<28800000000:return None
    return {'qualification':'measured_owned_native_eight_hour_lifetime','unit':p.unit_name(plan),'invocation':invocation,
        'result':value['Result'],'startMonotonicMicroseconds':start,'exitMonotonicMicroseconds':end,'durationMicroseconds':end-start,'requiredSeconds':28800}


def apply(c,v,p,plan,expected):
    with c.source_lease():
        result,prepared=review(c,v,p,plan)
        if result['reviewHash']!=expected:c.fail('Source5 manual review changed; no start.')
        helper,ctx,record,directory=prepared;parent=directory.parent;parent.mkdir(mode=0o750,exist_ok=True)
        if parent.is_symlink() or parent.stat().st_uid!=0 or parent.stat().st_mode&0o022:c.fail('Protected source5 report root required.')
        gid=pwd.getpwnam(ctx.old.USER).pw_gid;os.chown(parent,0,gid);directory.mkdir(mode=0o750);os.chown(directory,0,gid)
        project=ctx.workspace/'apps/yunipals-indexer';launch=ctx.workspace/'launch.env';ctx.cont.validate_launch_text(ctx.candidate,launch.read_text(),free_only=True)
        text=ctx.old.command(['/usr/sbin/runuser','-u',ctx.old.USER,'--','/usr/bin/env','-i',ctx.old.NODE,'--env-file='+str(launch),'--import','tsx','scripts/unified-rpc-preflight.ts'],cwd=project,env=ctx.old.ROLE_ENV,timeout=60)
        ctx.cont.validate_preflight(text,{'freeOnly':True},ctx.old,ctx.env)
        again,_=review(c,v,p,plan,existing_directory=directory,live=False)
        if again['reviewHash']!=expected:c.fail('Source5 prerequisites changed during grant-free preflight.')
        p.save(directory/'review.json',result);invocation=None;started=None;reason='launch_or_monitor_error';expiry=None;controller_started=time.monotonic();log=directory/'monitor.jsonl'
        try:
            invocation=p.start(plan,ctx,expected);resources=p.actual_resources(plan,ctx,invocation,expected);started=resources['mainStartMonotonicMicroseconds']/1000000
            ctx.old.emit(log,{'event':'started','reviewHash':expected,'source5ResumeBinding':result['binding'],'unit':p.unit_name(plan),'invocation':invocation,'mainStartMonotonicMicroseconds':resources['mainStartMonotonicMicroseconds']})
            while True:
                tick=time.monotonic();signal.setitimer(signal.ITIMER_REAL,15)
                try:
                    own=ctx.old.own_state(p.unit_name(plan));sample={'freeBytes':shutil.disk_usage(ctx.candidate.SOURCE).free,'metrics':ctx.old.source_metrics(),
                        'legacyUnits':ctx.old.service_states(ctx.old.LEGACY_UNITS),'activeSelector':ctx.old.active_selector(),'proxies':ctx.old.proxy_observation(),
                        'policy':ctx.cont.free_policy_snapshot(ctx.old,ctx.env,ctx.profile)}
                    validate_running(c,v,p,plan,prepared,result,sample,own,invocation,time.monotonic()-started)
                finally:signal.setitimer(signal.ITIMER_REAL,0)
                elapsed=time.monotonic()-started;ctx.old.emit(log,{'event':'sample','elapsed':round(elapsed,2),'own':own,**sample})
                if own.get('ExecMainStatus')=='75' and own['ActiveState']!='active':reason='shadow_exited';break
                if own['ActiveState'] in {'inactive','failed'}:
                    expiry=p.runtime_expiry(plan,ctx,own,invocation,elapsed);reason='deadline' if expiry else 'shadow_exited';break
                reason=p.stop_reason(sample,result,elapsed)
                if reason:break
                time.sleep(max(0,ctx.old.INTERVAL-(time.monotonic()-tick)))
        except (KeyboardInterrupt,SystemExit):reason='operator_interrupt'
        except Exception as error:reason='source5_resume_prerequisite_unavailable';ctx.old.emit(log,{'event':'monitor_guard_failed','errorClass':type(error).__name__})
        finally:
            stop_error=None
            try:p.stop_owned(plan,ctx,invocation,expected)
            except Exception as error:stop_error=type(error).__name__
            completed=None;terminal={}
            try:
                own=ctx.old.own_state(p.unit_name(plan));terminal={key:own.get(key) for key in ['Id','LoadState','ActiveState','SubState','Result','ExecMainStatus','InvocationID']}
            except Exception as error:terminal={'unavailable':type(error).__name__}
            if reason=='deadline' and stop_error is None:
                try:expiry=p.runtime_expiry(plan,ctx,ctx.old.own_state(p.unit_name(plan)),invocation,time.monotonic()-started)
                except Exception:expiry=None
                try:completed=completion_proof(c,p,plan,ctx,invocation,time.monotonic()-started)
                except Exception:completed=None
                if completed is None:reason='deadline_terminal_proof_unavailable'
            after={}
            for key,collect in [('legacyUnits',lambda:ctx.old.service_states(ctx.old.LEGACY_UNITS)),('activeSelector',ctx.old.active_selector),('proxies',ctx.old.proxy_observation),('metrics',ctx.old.source_metrics)]:
                try:after[key]=collect()
                except Exception as error:after[key]={'unavailable':type(error).__name__}
            ctx.old.emit(log,{'event':'stopped','reason':reason,'elapsed':None if started is None else round(time.monotonic()-started,2),'controllerElapsedSeconds':round(time.monotonic()-controller_started,2),
                'stopError':stop_error,'runtimeExpiryEvidence':expiry,'measuredEightHourCompletion':completed,'ownedTerminalState':terminal,'after':after,
                'automaticRetryAllowed':False,'quarantined':reason!='deadline' or stop_error is not None or completed is None,'requiredSeconds':28800})


def public_review(c,result):
    binding=result['binding']
    return {'reviewHash':result['reviewHash'],'started':False,'format':FORMAT,'runId':binding['plan']['runId'],'sourceDigest':c.ACTOR,'proxySourceDigest':c.SOURCE,
        'nativeBuild':c.NATIVE,'long1':binding['long1'],'newUnit':'yunipals-unified-persistent-'+binding['plan']['runId']+'.service',
        'physicalStateMatchesActualLong1Final':True,'fourAppliedProxy5ProofsVerified':True,'originalF1CacheAnchor':531472384,'maximumSeconds':28800,
        'freeOnly':True,'automaticRetryAllowed':False,'schemaOrCacheReset':False,'consumerServingAllowed':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--apply');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':raise RuntimeError('Exact root/host required.')
    c,v,p=modules();plan=json.loads(c.trusted(args.plan))
    if args.apply:
        if not re.fullmatch(r'[0-9a-f]{64}',args.apply):c.fail('Exact source5 review hash required.')
        signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit()));signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError()))
        apply(c,v,p,plan,args.apply)
    else:print(json.dumps(public_review(c,review(c,v,p,plan)[0]),indent=2))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'completed':False,'errorClass':type(error).__name__}));raise SystemExit(1)
