#!/usr/bin/env python3
"""Protected source5 proxy epoch primitives; no import-time actions or report export."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OLD_SHA='919e952a9d4241bec6252b9cb28aed0a9249b7bb3a59bf71f1943e0ad46f2eca'
PERSISTENT_SHA='ec4f3ce117e1eaaf036b0f65a92509fa55ee735913b6a3c858d711389b793502'
ACTOR='008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
NATIVE='bf4939b3ff'
MANIFEST='0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029'
LONG1=Path('/var/lib/yunipals-unified-shadow/persistent-replays/20261020-008028af-long1')
LONG1_UNIT='yunipals-unified-persistent-20261020-008028af-long1.service'
LONG1_INVOCATION='bef9912e472441068b4411b1b83f4806'
LONG1_REVIEW_HASH='3ebef361a4fadf5e627a9ca500dd9f64785593830bf2ce5a104284f7a46ba80a'
# Actual public hash-only catalog and independently verified package pins.
# Protected full historical reports remain on the production host.
LONG1_REVIEW_SHA='3fbfc84a7d7a6552be0b1214c4eedf3dba35f5ad5cef10d051d0c3a94f49a7a9'
LONG1_MONITOR_SHA='b1a2f7565945bf950552bd8cfef73caae229474e4214a7037d1962937e48e532'
LONG1_TERMINAL_SHA='def02e6d9659fd737721063b648b9f655fc064de13429b6690e5124eb55cef7d'
TERMINAL=OPS/'long1-source5-terminal-witness.json'
SOURCE='d727f87e341f3519c6a69cd38ac67d7366dc5e0c136d8b9a2746ec75eefb0eae'
SOURCE_ARCHIVE_SHA='5b63f165a9f2f8c80ceba922b731995f75d3f17a7e926cc1a481ae4925bea379'
SOURCE_MANIFEST_SHA='ec5b8db7b1027c93732d56d34f97f06b56b24c4bbe4ef0597b85c687d04276ed'
INVENTORY_SHA='06e9b013fc93785c48da7a2e755d051cdca557d67e4b32796b936ecf5737502e'
ARCHIVE_SHA='d9d490e89bfd065a8e46bbfa7ccd28d6cf760e4c40df6ef6fec9b916a2c49293'
PROXY_SHA='b91824e6a156fee4a4f2ad12028b6c68b99b8a072f13ca39e548a7aae1457ce2'
EVIDENCE_SHA='4200ef187f90953f9db80f13e79276362186f8f8ddec6858e2c2d69ee2b29799'
ROOT=Path('/opt/yunipals-unified/releases')/SOURCE
INVENTORY=Path('/var/tmp/yunipals-runtime-d727f87e-20261021/runtime-supplement.inventory.json')
EVIDENCE=Path('/var/tmp/yunipals-runtime-d727f87e-20261021/combined-proxy-epoch-proof.json')
OVERRIDE='zzzzzzzzzzz-unified-range-hints-v5-20261021.conf'
CHAINS={'1':'ethereum','8453':'base','137':'polygon','56':'bnb'}


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()


def trusted(path,maximum=40000000):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts:fail('Protected absolute source5 input required.')
    for item in [*path.parents,path]:
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not(stat.S_ISDIR(info.st_mode) and info.st_mode&stat.S_ISVTX)):
            fail('Protected source5 input ancestry differs.')
    before=path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:fail('Bounded regular source5 input required.')
    raw=path.read_bytes();after=path.stat()
    identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)
    if len(raw)>maximum or identity(before)!=identity(after):fail('Protected source5 input changed while reading.')
    return raw


def load(path,expected,name):
    raw=trusted(path)
    if not re.fullmatch(r'[0-9a-f]{64}',expected) or sha(raw)!=expected:fail('Exact checksum-pinned source5 primitive required.')
    module=types.ModuleType(name);module.__file__=str(path);exec(compile(raw,str(path),'exec'),module.__dict__);return module


def primitives():return load(OPS/'proxy-upgrade-free-fallback-v4.py',OLD_SHA,'source5_old_proxy')
def persistent():return load(OPS/'persistent-native-replay.py',PERSISTENT_SHA,'source5_old_persistent')


@contextmanager
def source_lease():
    fd=os.open('/run/lock/yunipals-unified-shadow.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:fail('Protected exclusive source-controller lease required.')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
    finally:os.close(fd)


def pinned_json(path,expected,maximum=40000000):
    raw=trusted(path,maximum)
    if not re.fullmatch(r'[0-9a-f]{64}',expected) or sha(raw)!=expected:fail('Pinned source5 history/evidence changed.')
    return json.loads(raw)


def counters(proxies):
    result={}
    for chain in CHAINS:
        for workload in ['unified_source','unified_evidence']:
            row=proxies[chain]['unified']['traffic'][workload]
            for key in ['paidCalls','refused']:
                value=row[key]
                if type(value) is not int or value<0:fail('Invalid isolated source5 counter.')
                result[chain+'/'+workload+'/'+key]=value
    return result


def validate_history(review,rows,terminal):
    """Pure protected-report validation; returned content stays operator-local."""
    binding=review.get('binding',{});epoch=binding.get('liveEpoch',{})
    if (review.get('reviewHash')!=LONG1_REVIEW_HASH or sha(encoded(binding))!=review.get('reviewHash') or
        binding.get('helperSha256')!=PERSISTENT_SHA or binding.get('format')!='yunipals-persistent-native-replay-v1' or
        binding.get('sourceDigest')!=ACTOR or binding.get('nativeBuild')!=NATIVE or binding.get('freeOnly') is not True or
        binding.get('launchGrantIds')!=[] or binding.get('sourceOrCacheReset') is not False or binding.get('newWorkspaceCopy') is not False or
        binding.get('automaticRetryAllowed') is not False or binding.get('originalCacheBytes')!=531472384 or
        binding.get('newUnit')!=LONG1_UNIT or epoch.get('activeSelector')!=[] or
        epoch.get('identity',{}).get('manifestHash')!=MANIFEST):fail('Exact historical long1 source/free-only identity required.')
    if not isinstance(rows,list) or not 3<=len(rows)<=10000:fail('Bounded complete long1 monitor required.')
    first,last=rows[0],rows[-1]
    if (first.get('event')!='started' or first.get('reviewHash')!=review['reviewHash'] or first.get('persistentBinding')!=binding or
        first.get('unit')!=LONG1_UNIT or first.get('invocation')!=LONG1_INVOCATION or last.get('event')!='stopped' or
        last.get('reason') not in {'shadow_exited','persistent_prerequisite_unavailable'} or last.get('stopError') is not None or
        last.get('automaticRetryAllowed') is not False or last.get('quarantined') is not True or last.get('runtimeExpiryEvidence') is not None or
        last.get('persistentRequiredSeconds')!=28800 or type(last.get('elapsed')) not in {int,float} or not 0<last['elapsed']<28800):
        fail('Only the explicitly quarantined stopped long1 may seed a manual source5 resume.')
    samples=[row for row in rows if row.get('event')=='sample']
    if not samples:fail('Actual long1 native samples required.')
    for row in [*samples,{'after':last.get('after',{})}]:
        value=row.get('after',row);runtime=value.get('metrics',{}).get('runtime',{})
        if (value.get('legacyUnits')!=epoch['legacyUnits'] or value.get('activeSelector')!=[] or runtime.get('buildId')!=NATIVE or
            any(counters(value['proxies']).values())):fail('Historical long1 source/legacy or zero-paid/refused evidence differs.')
        if 'own' in row and row['own'].get('InvocationID')!=LONG1_INVOCATION:fail('Historical long1 source invocation differs.')
    metrics=last['after']['metrics']
    if (set(c.get('chain') for c in metrics.get('checkpoints',[]))!={1,56,137,8453} or len(metrics['checkpoints'])!=4 or
        any(not isinstance(c.get(k),str) or not re.fullmatch(r'[0-9]{75}',c[k]) for c in metrics['checkpoints'] for k in ['safe','latest','finalized'])):
        fail('Actual four-chain long1 physical checkpoints required.')
    expected_native={'Id':LONG1_UNIT,'LoadState':'loaded','ActiveState':'failed','SubState':'failed','InvocationID':LONG1_INVOCATION,'Result':'exit-code','ExecMainStatus':'75'}
    native=terminal.get('native',{});ended=terminal.get('monitor',{})
    observed=terminal.get('sourceMetrics',{})
    if (any(native.get(k)!=v for k,v in expected_native.items()) or any(observed.get(k)!=metrics.get(k) for k in ['runtime','checkpoints']) or terminal.get('activeSelector')!=[] or
        any(ended.get(k)!=last.get(k) for k in ['event','reason','stopError','automaticRetryAllowed','quarantined','persistentRequiredSeconds'])):
        fail('Exact independently captured stopped75 summary required.')
    return {'review':review,'binding':binding,'first':first,'last':last,'samples':samples,'terminal':terminal,
        'summary':{'reviewSha256':LONG1_REVIEW_SHA,'monitorSha256':LONG1_MONITOR_SHA,'terminalWitnessSha256':LONG1_TERMINAL_SHA,
        'reviewHash':review['reviewHash'],'unit':LONG1_UNIT,'invocation':LONG1_INVOCATION,'nativeExitStatus':75,
        'reason':last['reason'],'quarantined':True,'automaticRetryAllowed':False,'manualNewEpochOnly':True,
        'finalRuntimeSha256':sha(encoded(metrics['runtime'])),'finalCheckpointsSha256':sha(encoded(metrics['checkpoints']))}}


def history():
    review=pinned_json(LONG1/'review.json',LONG1_REVIEW_SHA,110149)
    raw=trusted(LONG1/'monitor.jsonl',1411687)
    if sha(raw)!=LONG1_MONITOR_SHA:fail('Exact protected long1 monitor required.')
    return validate_history(review,[json.loads(row) for row in raw.splitlines()],pinned_json(TERMINAL,LONG1_TERMINAL_SHA,16384))


def stopped_long1(v):
    keys=['Id','LoadState','ActiveState','SubState','InvocationID','Result','ExecMainStatus']
    text=v.run(['/usr/bin/systemctl','show',LONG1_UNIT,*['--property='+k for k in keys]],timeout=3)
    value={}
    for line in text.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys or key in value:fail('Unexpected stopped long1 unit metadata.')
        value[key]=item
    expected={'Id':LONG1_UNIT,'LoadState':'loaded','ActiveState':'failed','SubState':'failed','InvocationID':LONG1_INVOCATION,'Result':'exit-code','ExecMainStatus':'75'}
    if value!=expected:fail('Actual long1 must remain stopped with its original exit75 invocation.')


def environment_hashes(v,props):
    """Opaque checksum only; private EnvironmentFile keys/values never parsed."""
    rows=[]
    for entry in props.get('EnvironmentFilesEntries',[props['EnvironmentFiles']]):
        pieces=re.findall(r'([^ ;]+) \(ignore_errors=(yes|no)\)',entry)
        if ' '.join(path+' (ignore_errors='+optional+')' for path,optional in pieces)!=entry:fail('Exact ordered EnvironmentFile selectors required.')
        for path,optional in pieces:
            selected=Path(path)
            if not selected.exists() and optional=='yes':rows.append({'path':path,'optional':True,'exists':False});continue
            rows.append({'path':path,'optional':optional=='yes','exists':True,'sha256':sha(trusted(selected,2000000))})
    return rows


def validate_base_environment(inherited,hashes):
    base=inherited.get('baseConfiguration')
    if base is None:return
    expected=[*base['originalEnvironmentFileHashes'],{'path':base['publicEnvironmentPath'],'optional':False,'exists':True,'sha256':base['publicEnvironmentSha256']}]
    if hashes!=expected:fail('Base10z original private file bytes or public selector changed.')


def verify_runtime(v):
    for value in [SOURCE,SOURCE_ARCHIVE_SHA,SOURCE_MANIFEST_SHA,INVENTORY_SHA,ARCHIVE_SHA,PROXY_SHA,EVIDENCE_SHA]:
        if not re.fullmatch(r'[0-9a-f]{64}',value):fail('Source5 package pins remain unresolved.')
    installed=v._verify_runtime(INVENTORY,root=ROOT,source=SOURCE,source_archive_sha=SOURCE_ARCHIVE_SHA,
        inventory_sha=INVENTORY_SHA,archive_sha=ARCHIVE_SHA,proxy_sha=PROXY_SHA)
    evidence=pinned_json(EVIDENCE,EVIDENCE_SHA);inventory=pinned_json(INVENTORY,INVENTORY_SHA)
    if (evidence.get('format')!='yunipals-unified-proxy-epoch-evidence-v1' or evidence.get('source',{}).get('archiveSha256')!=SOURCE_ARCHIVE_SHA or
        sha(trusted(ROOT/'RELEASE-MANIFEST.json'))!=SOURCE_MANIFEST_SHA):fail('Source5 clean source/archive/manifest evidence differs.')
    # Frozen validation is pure: no production report reconstruction or network.
    transition=load(OPS/'artifact-transition.py','eee9a1f5291f3056f7f22c58b50569d9efcc33f276e2d9d60ba49df8d7f75273','source5_clean_validator')
    pins={'sourceDigest':SOURCE,'sourceManifestSha256':SOURCE_MANIFEST_SHA,'inventorySha256':INVENTORY_SHA}
    transition.validate_clean_evidence({**evidence,'format':'yunipals-unified-release-candidate2-evidence-v1'},pins,inventory,'49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4')
    epoch=load(OPS/'proxy-epoch-v2.py','d4013f4025d2b49c32cc561c3e673c119fb3ac47529d75c7009b55c962d49961','source5_diff_validator')
    old_evidence=pinned_json('/var/tmp/yunipals-runtime-1612f7bf-20261021/combined-proxy-epoch-proof.json','4c540226c13d63820f6266b7a48f12d88d7f66a2402060ff482068cefaf054bc')
    old_inventory=pinned_json('/var/tmp/yunipals-runtime-1612f7bf-20261021/runtime-supplement.inventory.json',v.INVENTORY_SHA)
    epoch.source_diff(transition,json.loads(trusted(v.ROOT/'RELEASE-MANIFEST.json')),json.loads(trusted(ROOT/'RELEASE-MANIFEST.json')))
    epoch.runtime_diff(v.ROOT,ROOT,old_inventory,inventory,old_evidence['runtime']['buildRoot'],evidence['runtime']['buildRoot'])
    return {**installed,'cleanEvidenceSha256':EVIDENCE_SHA}


def inherited_proxy(v,record,chain):
    """Validate saved9z+10z history, without expecting an old live invocation."""
    b=record['binding'];p=b['plan']['epochPlan'];name=CHAINS[str(chain)];unit='yunipals-market-production-rpc@'+name+'.service'
    directory=Path(p['proxyProofDirectories'][str(chain)]);raw=trusted(directory/'review.json');old=json.loads(raw);result=json.loads(trusted(directory/'result.json'))
    if (sha(raw)!=directory.name or sha(encoded(old))!=directory.name or old.get('format')!='yunipals-proxy-source-fallback-upgrade-v4' or
        old.get('sourceDigest')!=v.SOURCE or old.get('runtimeSha256')!=v.PROXY_SHA or old.get('profileId')!=v.PROFILE_ID or
        result.get('review')!=old or result.get('reviewHash')!=directory.name or result.get('applied') is not True or
        result.get('legacyConfigurationPreserved') is not True or result.get('privateSettingsChanged') is not False):
        fail('Retained original source4 proxy proof changed.')
    expected_id=b['liveEpoch']['legacyUnits'][unit]['InvocationID']
    definitions={**old['originalDefinitionHashes'],old['overridePath']:old['overrideSha256']};private=old['privateSettings'];base=None
    if chain==8453:
        base=b['liveEpoch']['proxies']['baseConfiguration'];d=Path(base['proofDirectory']);br=trusted(d/'review.json');bv=json.loads(br);res=trusted(d/'result.json');applied=json.loads(res)
        if (sha(br)!=base['reviewSha256'] or sha(encoded(bv))!=d.name or sha(res)!=base['resultSha256'] or
            applied.get('review')!=bv or applied.get('applied') is not True or bv.get('originalDefinitionHashes')!=definitions or
            bv.get('beforeInvocationId')!=result.get('afterInvocationId') or applied.get('afterInvocationId')!=expected_id or
            base.get('definitionsAfter')!={**definitions,base['overridePath']:base['overrideSha256']}):fail('Retained Base10z configuration lineage differs.')
        definitions=base['definitionsAfter'];private=base['privateSettingsAfter']
        if trusted(base['publicEnvironmentPath'],20000)!=bv['publicEnvironment'].encode() or sha(trusted(base['overridePath'],20000))!=base['overrideSha256']:
            fail('Retained Base10z public settings changed.')
    elif result.get('afterInvocationId')!=expected_id:fail('Source4 proxy invocation does not link to long1.')
    if result.get('paidCalls')!=0 or result.get('sourceSelectionChanged') is not False:fail('Source4 proof paid/selector invariants differ.')
    return {'unit':unit,'invocation':expected_id,'definitions':definitions,'privateSettings':private,'legacyConfiguration':old['legacyConfiguration'],
        'source4ReviewSha256':sha(raw),'source4ResultSha256':sha(trusted(directory/'result.json')),'baseConfiguration':base}
