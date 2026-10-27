#!/usr/bin/env python3
"""One exact source5 proxy upgrade; no source launch, grants or configuration edits."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import socket
import types

COMMON_SHA='25a595d23d8584977df4d02438fc5fe021ef5b077569585cf6a42a853b3bab3c'
COMMON=Path('/opt/yunipals-unified/operations/free-replay-20261020/source5-epoch-common.py')
PROOFS=Path('/var/backups/yunipals-unified-range-hints-v5-20261021')
FORMAT='yunipals-proxy-range-hints-upgrade-v5'


def modules():
    import hashlib
    import stat
    for path in [*COMMON.parents,COMMON]:
        info=path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('Protected source5 primitive required.')
    raw=COMMON.read_bytes()
    if not re.fullmatch(r'[0-9a-f]{64}',COMMON_SHA) or hashlib.sha256(raw).hexdigest()!=COMMON_SHA:raise RuntimeError('Exact source5 common pin required.')
    c=types.ModuleType('pinned_source5_epoch');c.__file__=str(COMMON);exec(compile(raw,str(COMMON),'exec'),c.__dict__);return c,c.primitives()


def content(c,v,chain):
    return ('[Service]\nExecStart=\nExecStart='+v.NODE+' '+str(c.ROOT/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs')+
        '\nWorkingDirectory='+str(c.ROOT/'apps/yunipals-market-api')+'\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE='+str(v.PROFILE)+
        '\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_ID='+v.PROFILE_ID+f'\nEnvironment=MARKET_RPC_PROXY_CHAIN_ID={chain}\n')


def verify_source4(c,v):
    inventory=Path('/var/tmp/yunipals-runtime-1612f7bf-20261021/runtime-supplement.inventory.json')
    return v._verify_runtime(inventory,root=v.ROOT,source=v.SOURCE,source_archive_sha=v.SOURCE_ARCHIVE_SHA,
        inventory_sha=v.INVENTORY_SHA,archive_sha=v.ARCHIVE_SHA,proxy_sha=v.PROXY_SHA)


def review(c,v,name):
    chain,port=v.CHAINS[name];unit='yunipals-market-production-rpc@'+name+'.service';target=v.SYSTEMD/(unit+'.d')/c.OVERRIDE
    if os.path.lexists(target):c.fail('Fresh source5 override path required; no retained attempt is overwritten.')
    record=c.history();c.stopped_long1(v);old_runtime=verify_source4(c,v);runtime=c.verify_runtime(v);policy=v.approved_policy()
    inherited=c.inherited_proxy(v,record,chain);props=v.state(unit);v.verify_exec_start(props,v.ROOT);definitions=v.definitions(props)
    if (props['InvocationID']!=inherited['invocation'] or definitions!=inherited['definitions'] or v.private_settings(props)!=inherited['privateSettings'] or
        any(Path(path).name>=c.OVERRIDE for path in list(definitions)[1:])):c.fail('Actual source4/9z/Base10z identity or original settings changed.')
    config=v.legacy_health(port,chain)
    if config!=inherited['legacyConfiguration'] or config['freeSourceMinimumIntervalMs']<400 or config['maximumConcurrentUpstreamRequests']>8:
        c.fail('Legacy pacing/configuration changed before source5.')
    files=c.environment_hashes(v,props);c.validate_base_environment(inherited,files);text=content(c,v,chain)
    return {'format':FORMAT,'unit':unit,'chain':name,'chainId':chain,'port':port,**runtime,'beforeRuntime':old_runtime,
        'profileId':v.PROFILE_ID,'profile':policy,'long1':record['summary'],'inheritedProxy':inherited,
        'beforeInvocationId':props['InvocationID'],'originalMainPid':props['MainPID'],'originalExecStartSha256':v.sha_bytes(props['ExecStart'].encode()),
        'originalWorkingDirectory':props['WorkingDirectory'],'originalDefinitionHashes':definitions,'privateSettings':v.private_settings(props),
        'legacyConfiguration':config,'environmentFileHashes':files,'overridePath':str(target),'overrideSha256':v.sha_bytes(text.encode()),'override':text,
        'helperSha256':v.digest(v.safe_file(Path(__file__).absolute())),'commonHelperSha256':COMMON_SHA,
        'sourceSelectionChanged':False,'sourceStarted':False,'profileOrCapsChanged':False,'newPermits':False}


def unchanged(c,v,value,props,*,installed):
    definitions=v.definitions(props)
    if installed:
        if definitions.pop(value['overridePath'],None)!=value['overrideSha256']:c.fail('Exact own source5 override required.')
    if (definitions!=value['originalDefinitionHashes'] or v.private_settings(props)!=value['privateSettings'] or
        c.environment_hashes(v,props)!=value['environmentFileHashes']):c.fail('Existing proxy definitions/private settings changed.')


def selected_owned_state(c,v,value):
    """Bounded public unit fields permit safe cleanup after restart reports failure."""
    keys=['Id','LoadState','ActiveState','SubState','InvocationID','ExecStart','WorkingDirectory','FragmentPath','DropInPaths']
    text=v.run(['/usr/bin/systemctl','show',value['unit'],*['--property='+k for k in keys]],timeout=3);props={}
    for line in text.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys or key in props:c.fail('Unexpected source5 rollback unit metadata.')
        props[key]=item
    if (set(props)!=set(keys) or props['Id']!=value['unit'] or props['LoadState']!='loaded' or
        props['ActiveState'] not in {'active','inactive','failed'} or not re.fullmatch(r'[0-9a-f]{32}',props['InvocationID']) or
        props['InvocationID']==value['beforeInvocationId']):c.fail('No exact new source5 invocation available for guarded restoration.')
    v.verify_exec_start(props,c.ROOT)
    if v.definitions(props)!={**value['originalDefinitionHashes'],value['overridePath']:value['overrideSha256']}:c.fail('Source5 rollback definitions changed.')
    # The unchanged definitions pin inline settings. Files are independently
    # opaque-hashed using the already reviewed ordered selectors.
    reviewed={'EnvironmentFilesEntries':value['privateSettings']['orderedEnvironmentFiles'],'EnvironmentFiles':''}
    if c.environment_hashes(v,reviewed)!=value['environmentFileHashes']:c.fail('Source5 rollback private file bytes changed.')
    return props


def proof_directory(c,name,marker):
    import stat
    for path in [PROOFS,PROOFS/name]:
        path.mkdir(mode=0o700,exist_ok=True);info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:c.fail('Private source5 proof ancestry required.')
    directory=PROOFS/name/marker;directory.mkdir(mode=0o700);return directory


def apply(c,v,value,marker):
    if v.sha_bytes(v.encoded(value))!=marker:c.fail('Exact source5 review hash required.')
    unit,chain,port=value['unit'],value['chainId'],value['port'];target=Path(value['overridePath']);directory=proof_directory(c,value['chain'],marker)
    v.save_new(directory/'review.json',v.encoded(value));installed=False;phase='pre_install_fence';after_invocation=None
    try:
        c.stopped_long1(v);props=v.state(unit);unchanged(c,v,value,props,installed=False)
        if props['InvocationID']!=value['beforeInvocationId'] or v.sha_bytes(props['ExecStart'].encode())!=value['originalExecStartSha256']:c.fail('Original source5 target invocation changed.')
        if v.digest(v.PROFILE)!=v.PROFILE_SHA or v.digest(c.ROOT/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs')!=c.PROXY_SHA:c.fail('Pinned profile or source5 runtime changed.')
        phase='exclusive11z_install';v.save_new(target,value['override'].encode(),0o644);installed=True
        phase='daemon_reload';v.run(['/usr/bin/systemctl','daemon-reload'])
        phase='restart_exact_proxy';v.run(['/usr/bin/systemctl','restart',unit],timeout=150)
        after=v.state(unit);after_invocation=after['InvocationID'];v.verify_exec_start(after,c.ROOT);unchanged(c,v,value,after,installed=True)
        phase='legacy_and_unified_checks'
        if v.retry(lambda:v.legacy_health(port,chain))!=value['legacyConfiguration']:c.fail('Legacy configuration changed after source5.')
        v.retry(lambda:v.unified_preflight(port,chain));current=v.state(unit)
        if current['InvocationID']!=after_invocation or after_invocation==value['beforeInvocationId']:c.fail('Exact new source5 invocation not retained.')
        unchanged(c,v,value,current,installed=True);v.verify_exec_start(current,c.ROOT);c.stopped_long1(v)
        metrics=v.request(port,'/metrics')
        traffic=metrics.get('unified',{}).get('traffic',{})
        if any(traffic.get(w,{}).get(k)!=0 for w in ['unified_source','unified_evidence'] for k in ['paidCalls','refused']):c.fail('Source5 startup has nonzero isolated paid/refused counters.')
        result={'reviewHash':marker,'review':value,'proofDirectory':str(directory),'applied':True,'unit':unit,'chainId':chain,
            **{k:value[k] for k in ['sourceRoot','sourceDigest','profileId','runtimeSha256','runtimeInventorySha256','runtimeArchiveSha256','overridePath','overrideSha256','beforeInvocationId']},
            'afterInvocationId':after_invocation,'verifyExecStart':True,'legacyHealthPassed':True,'legacyConfigurationPreserved':True,
            'privateSettingsChanged':False,'ingestorStarted':False,'sourceSelectionChanged':False,'paidCalls':0,'newPermits':False}
        v.save_new(directory/'result.json',(json.dumps(result,indent=2)+'\n').encode())
        return {'applied':True,'reviewHash':marker,'unit':unit,'beforeInvocationId':value['beforeInvocationId'],'afterInvocationId':after_invocation,
            'sourceDigest':c.SOURCE,'proofDirectory':str(directory),'legacyConfigurationPreserved':True,'sourceStarted':False,'profileOrCapsChanged':False,'paidCalls':0}
    except Exception as error:
        failed={'phase':phase,'errorClass':type(error).__name__,'rollbackAttempted':False,'rollbackSucceeded':False}
        # A distinct actor replacing this process/override is never restarted.
        if installed:
            try:
                current=selected_owned_state(c,v,value)
                if (not target.is_symlink() and target.is_file() and v.digest(target)==value['overrideSha256'] and
                    (after_invocation is None or current['InvocationID']==after_invocation)):
                    # Repeat immediately before removal; an intervening actor's
                    # invocation is never adopted as our restart result.
                    if selected_owned_state(c,v,value)!=current:c.fail('Source5 rollback invocation changed during ownership fence.')
                    failed['rollbackAttempted']=True
                    target.unlink();v.run(['/usr/bin/systemctl','daemon-reload']);v.run(['/usr/bin/systemctl','restart',unit],timeout=150)
                    restored=v.state(unit);unchanged(c,v,value,restored,installed=False);v.verify_exec_start(restored,v.ROOT)
                    if v.retry(lambda:v.legacy_health(port,chain))!=value['legacyConfiguration']:c.fail('Source4 configuration restoration failed.')
                    failed['rollbackSucceeded']=True
            except Exception as problem:failed['rollbackErrorClass']=type(problem).__name__
        v.save_new(directory/'failed-check.json',v.encoded(failed));c.fail('Source5 upgrade incomplete; retained exact proof records guarded rollback outcome.')


def public_review(c,v,value):
    return {'reviewHash':v.sha_bytes(v.encoded(value)),'applied':False,'unit':value['unit'],'sourceDigest':c.SOURCE,
        'beforeInvocationId':value['beforeInvocationId'],'beforeRuntimeInventorySha256':value['beforeRuntime']['runtimeInventorySha256'],
        'runtimeInventorySha256':value['runtimeInventorySha256'],'long1':value['long1'],'overridePath':value['overridePath'],
        'originalSettingsAnd9z10zBound':True,'sourceStarted':False,'profileOrCapsChanged':False,'newPermits':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--chain',required=True,choices=['base','bnb','ethereum','polygon']);parser.add_argument('--apply');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':raise RuntimeError('Exact production root/host required.')
    c,v=modules()
    if args.apply:
        if not re.fullmatch(r'[0-9a-f]{64}',args.apply):c.fail('Exact source5 review hash required.')
        with c.source_lease(),v.chain_lock(args.chain):
            value=review(c,v,args.chain)
            if v.sha_bytes(v.encoded(value))!=args.apply:c.fail('Source5 review changed; no mutation.')
            result=apply(c,v,value,args.apply)
    else:result=public_review(c,v,review(c,v,args.chain))
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'completed':False,'errorClass':type(error).__name__}));raise SystemExit(1)
