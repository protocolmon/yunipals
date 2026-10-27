#!/usr/bin/env python3
"""Install one acknowledged native staking unit, dormant; no start, LOGIN or SQL."""
import argparse
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-staking-v4-dormant-install-v1-20261022')
CANDIDATES = Path('/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022')
ROOT = Path('/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d')
UNIT = 'yunipals-native-staking-support.service'
TIMER = 'yunipals-native-staking-support.timer'
LEGACY = 'yunipals-islands-staking.service'
TARGET = Path('/etc/systemd/system') / UNIT
FORMAT = 'yunipals-staking-v4-dormant-install-v1'
SHARED_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
CANDIDATE_RECEIPT_SHA = 'be0e6ec9f39d9b967a5395a7955496be801a04dc26cf90f3ce7173941e8591a0'
CANDIDATE_SHA = '7a45245663a189105ae44ff00ad224b17068f45966e24ed486b8074f0fb93cea'
OWNER_RECEIPT = Path('/var/backups/yunipals-metadata-readview-v4-owner-v1-20261022/result.json')
OWNER_RECEIPT_SHA = 'ad4a5004e84a9aae47e301c50af1268b88e03b8bf3c812b4096c89390a0ab24c'
ORIGINAL_SHA = '15ab2bda3468ad8758d112f05111d72815c0e7cefa1b23ee7395fe12dddcae55'
OLD_SCHEMA = 'yunipals_ownership_35cdcb32_v3'
SCHEMA = 'yunipals_ownership_35cdcb32_v4'
OLD_IDENTITY = '0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc'
IDENTITY = '0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d'
SOURCE_PINS = {
    'RELEASE-MANIFEST.json': '5e06ff4b9d86859814f1fd1d2b24d1db38278eec75a7c2cefcdd3689103f27e0',
    'apps/yunipals-indexer/scripts/staking-support.ts': 'a3c5bda351a9476b30517d14a6f8bb834aa45ba628196fbf31fe1b69bd50f5a1',
    'apps/yunipals-indexer/lib/islands/staking-support-worker.ts': '9ff2497b0d22907666b6a23f6c0dcffd59debba14143276eb69fe8a8213c87a9',
    'apps/yunipals-indexer/lib/islands/staking-support-adapter.ts': '54acb75bc23928ecac4319af7e29b48c79f319f9883287bf4e1770bd66129fe7',
    'apps/yunipals-indexer/lib/islands/staking-verifier.ts': '365deb9e8d46a9babfb1fc1259cc2c40821888bf54f970990cfd588ba16c62f3'
}
PROPS = ('LoadState','ActiveState','SubState','MainPID','InvocationID','Job','FragmentPath','DropInPaths',
         'UnitFileState','User','Group','WorkingDirectory','ExecStart','Environment','SupplementaryGroups',
         'RuntimeMaxUSec','TimeoutStartUSec','TimeoutStopUSec','Restart','KillMode','NoNewPrivileges',
         'CapabilityBoundingSet','AmbientCapabilities','ExecMainStartTimestampMonotonic')


def fail(code):
    raise RuntimeError(code)


def modules():
    import stat
    path = OPS / 'retained-workers-stage-v1.py'
    for part in [*path.parents, path]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('protected_shared_helper_required')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHARED_SHA:
        fail('exact_shared_helper_required')
    m = types.ModuleType('staking_v4_shared'); m.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), m.__dict__)
    return m


def show(m, unit):
    raw = m.run(['/usr/bin/systemctl','show',unit,*['--property='+key for key in PROPS]]).decode()
    return dict(line.split('=',1) for line in raw.splitlines() if '=' in line)


def absent(value, timer=False):
    if (value.get('LoadState') != 'not-found' or value.get('ActiveState') != 'inactive'
            or value.get('SubState') != 'dead' or (value.get('MainPID','0') if timer else value.get('MainPID')) != '0'
            or any(value.get(key) for key in ('InvocationID','Job','FragmentPath','DropInPaths'))):
        fail('never_started_absent_native_unit_required')


def no_file_collision():
    for name in (UNIT, TIMER):
        for directory in ('/etc/systemd/system','/run/systemd/system','/usr/lib/systemd/system','/lib/systemd/system'):
            if os.path.lexists(Path(directory)/name) or os.path.lexists(Path(directory)/(name+'.d')):
                fail('no_existing_native_unit_or_dropin_required')


def directory(path):
    for part in [*path.parents,path]:
        info=part.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
            fail('protected_existing_directory_required')


def actor():
    user = pwd.getpwnam('yunipals_islands_staking'); group = grp.getgrnam(user.pw_name)
    if (user.pw_uid != 962 or user.pw_gid != 957 or group.gr_gid != 957 or group.gr_mem
            or user.pw_shell != '/usr/sbin/nologin' or set(os.getgrouplist(user.pw_name,user.pw_gid)) != {957}):
        fail('exact_existing_locked_staking_actor_required')
    shadow = [line.split(':') for line in Path('/etc/shadow').read_text().splitlines() if line.startswith(user.pw_name+':')]
    if len(shadow) != 1 or not shadow[0][1].startswith(('!','*')):
        fail('locked_staking_password_required')
    return {'uid':962,'gid':957,'shell':'/usr/sbin/nologin','passwordLocked':True,'supplementaryGroups':[]}


def legacy(m):
    value = show(m, LEGACY)
    if (value.get('LoadState') != 'loaded' or value.get('ActiveState') != 'inactive'
            or value.get('SubState') != 'dead' or value.get('MainPID') != '0' or value.get('Job')
            or value.get('InvocationID') != '0dcf23da7cc847ac805d357b8b5a028e'):
        fail('acknowledged_inactive_legacy_staking_required')
    paths = [value['FragmentPath'],*value['DropInPaths'].split()]
    expected = {
        '/etc/systemd/system/yunipals-islands-staking.service':'d24e117450d8576a423dc9b7c822067e8f3d758d457d9671394ed561c59ca8a8',
        '/etc/systemd/system/yunipals-islands-staking.service.d/zzzzzz-short-confirmations.conf':'d3e9fd6dec9c9f2aa8cf6493d475f8dc9b5488d7f1c7ffa25d222d7b89a83b97'
    }
    if paths != list(expected) or {name:m.sha(m.protected(Path(name))) for name in paths} != expected:
        fail('unchanged_legacy_staking_definitions_required')
    private = {
        '/etc/yunipals-marketplace/production/indexer-rpc.env':'8ff71b2f619c6f77a19276e61a8e994ec983ad7a1dd167ca1aa6c8cacc248677',
        '/etc/yunipals-indexer/islands-writer.env':'98bf3daca4e64aebff6997e2057742c83148991ec3e03d3d419ed5ec0e23320a'
    }
    if {name:m.sha(m.protected(Path(name))) for name in private} != private:
        fail('unchanged_legacy_private_files_required')
    value['ExecStartSha256'] = m.sha(value.pop('ExecStart','').encode())
    # No private command or environment values leave this function.
    value['EnvironmentSha256'] = m.sha(value.pop('Environment','').encode())
    return {'state':value,'definitionHashes':expected,'privateFileHashes':private}


def candidate(m):
    receipt = m.document(CANDIDATES/'result.json', CANDIDATE_RECEIPT_SHA)
    owner = m.document(OWNER_RECEIPT, OWNER_RECEIPT_SHA)
    if not owner.get('committed') or owner.get('rehearsed') or owner.get('readIdentity') != IDENTITY:
        fail('actual_committed_v4_views_required')
    raw = m.protected(CANDIDATES/'staking-support-v4.service.candidate')
    old = m.protected(OPS/'staking-support-native-v1.service.example')
    if (m.sha(raw) != CANDIDATE_SHA or receipt['files']['staking-support-v4.service.candidate'] != CANDIDATE_SHA
            or m.sha(old) != ORIGINAL_SHA or old.count(OLD_SCHEMA.encode()) != 1 or old.count(OLD_IDENTITY.encode()) != 1
            or raw != old.replace(OLD_SCHEMA.encode(),SCHEMA.encode()).replace(OLD_IDENTITY.encode(),IDENTITY.encode())):
        fail('exact_two_value_candidate_change_required')
    for name,pin in SOURCE_PINS.items():
        if m.sha(m.protected(ROOT/name)) != pin:
            fail('retained_staking_runtime_changed')
    return raw


def prepare(m):
    raw = candidate(m); absent(show(m,UNIT)); absent(show(m,TIMER),timer=True); no_file_collision()
    result = {'format':FORMAT,'candidateReceiptSha256':CANDIDATE_RECEIPT_SHA,'ownerReceiptSha256':OWNER_RECEIPT_SHA,
              'candidateSha256':CANDIDATE_SHA,'runtimeRoot':str(ROOT),'runtimePins':SOURCE_PINS,'actor':actor(),
              'legacyPreserved':legacy(m),'unit':UNIT,'target':str(TARGET),'readSchema':SCHEMA,'readIdentity':IDENTITY,
              'changedCandidateValues':['OWNERSHIP_READ_SCHEMA','ISLANDS_STAKING_READ_IDENTITY'],
              'databaseCalls':0,'providerCalls':0,'startEnableOrRoleChanges':False,'timerInstalled':False}
    return result,raw


def installed(m, raw):
    if m.protected(TARGET) != raw:
        fail('installed_unit_bytes_changed')
    value = show(m,UNIT)
    expected = {'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'','Job':'',
                'FragmentPath':str(TARGET),'DropInPaths':'','UnitFileState':'static','User':'yunipals_islands_staking',
                'Group':'yunipals_islands_staking','WorkingDirectory':str(ROOT/'apps/yunipals-indexer'),
                'Environment':'','SupplementaryGroups':'','RuntimeMaxUSec':'4min','TimeoutStartUSec':'15s',
                'TimeoutStopUSec':'20s','Restart':'no','KillMode':'control-group','NoNewPrivileges':'yes',
                'CapabilityBoundingSet':'','AmbientCapabilities':'','ExecMainStartTimestampMonotonic':'0'}
    if any(value.get(key) != wanted for key,wanted in expected.items()):
        fail('exact_dormant_effective_unit_required')
    command = next(line.removeprefix('ExecStart=') for line in raw.decode().splitlines() if line.startswith('ExecStart='))
    if re.findall(r'argv\[\]=(.*?)\s+;',value.get('ExecStart','')) != [' '.join(shlex.split(command))]:
        fail('exact_clean_staking_argv_required')
    obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum() else '_'+format(ord(c),'02x') for c in UNIT)
    for name,kind in [('EnvironmentFiles','a(sb)'),('PassEnvironment','as'),('UnsetEnvironment','as')]:
        actual=m.run(['/usr/bin/busctl','--system','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Service',name]).decode().strip()
        if actual != kind+' 0':
            fail('no_implicit_staking_environment_required')
    absent(show(m,TIMER),timer=True)
    return {key:value[key] for key in expected}


def apply(m, expected):
    before,raw=prepare(m)
    if m.sha(m.encoded(before)) != expected:
        fail('fresh_dormant_install_review_required')
    if os.path.lexists(BASE):
        fail('fresh_durable_install_intent_required')
    directory(BASE.parent);directory(TARGET.parent)
    BASE.mkdir(mode=0o700); m.write_new(BASE/'intent.json',m.encoded(before));m.sync_directory(BASE);m.sync_directory(BASE.parent)
    # One additive unit only. Never replace any old unit, create a timer, or start.
    m.write_new(TARGET,raw,0o644);m.sync_directory(TARGET.parent)
    m.run(['/usr/bin/systemctl','daemon-reload'])
    state=installed(m,raw)
    if legacy(m)!=before['legacyPreserved'] or actor()!=before['actor']:
        fail('existing_actor_or_legacy_staking_changed')
    after={**before,'installed':True,'state':state,'serviceStarts':0,'daemonReloads':1}
    m.write_new(BASE/'result.json',m.encoded(after));m.sync_directory(BASE)
    return {'format':FORMAT,'installed':True,'resultSha256':m.sha(m.encoded(after)),'serviceStarts':0,'databaseCalls':0,'providerCalls':0}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',metavar='REVIEW_SHA');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_host_required')
    os.umask(0o077);m=modules()
    if args.apply:result=apply(m,args.apply)
    else:
        before,_=prepare(m);result={**before,'bindingSha256':m.sha(m.encoded(before)),'installed':False}
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:fail('bounded_dormant_install_deadline'));signal.alarm(60)
    try:main()
    except Exception as error:
        code=str(error) if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',str(error)) else 'dormant_install_failed'
        print(json.dumps({'format':FORMAT,'installed':False,'failure':code}));raise SystemExit(1)
    finally:signal.alarm(0)
