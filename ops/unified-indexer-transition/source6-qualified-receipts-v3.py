#!/usr/bin/env python3
"""Finite receipt-only worker bound to the exact acknowledged proxy-qualified source.

No source/proxy restart, grant, scanner, public selection or paid renewal. The
same unit's unchanged fragment is retained; its one owned /run drop-in is the
entire inverse. Default review and inspect are read-only.
"""
import argparse
from contextlib import ExitStack
import hashlib
import grp
import pwd
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-qualified-receipts-v3-20261023')
FORMAT = 'yunipals-source6-qualified-receipts-v3'
UNIT = 'yunipals-unified-support-source6-v2.service'
FRAGMENT = Path('/run/systemd/system') / UNIT
FRAGMENT_SHA = '5afdb87ded1b7beb3c2d60abd8825fe311032a403977b537266ebe706d6cd214'
DROP = FRAGMENT.with_name(UNIT + '.d') / '95-qualified-receipts-v3-15m.conf'
ENTRY = OPS / 'source6-qualified-receipt-entry-v3.mjs'
ENTRY_SHA = '81745864c296b252526d125142b8ef16c37aeb32498007a5b09e90267832b93b'
LOOP = OPS / 'source6-normal-receipt-loop.mjs'
LOOP_SHA = '477376b0a5d8b377a313c248627789af5c0f7d34f569f8ed58e0498bfe0d6691'
SOURCE_RECEIPT = 'e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'
QUALIFICATION = 'add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d'
QUALIFIER_NAME = 'source6-normal-proxy-requalification-v1.py'
QUALIFIER_SHA = '8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658'
SOURCE_ID = {'pid': 716994, 'startTicks': 6611794751,
             'invocation': 'c3463c9a2e1240e8890e318ba1360cf4',
             'startMonotonicMicroseconds': 66117947533239}
PROFILE = '0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
PINS = {
    QUALIFIER_NAME: QUALIFIER_SHA,
    'source6-normal-replay-successor-v2.py': 'c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb',
    'support-probe-runner-v5.mjs': '6b4770a328b21127237a0808d094784cc1233bfdaa19781f4ec885316e768350',
    'support-probe-runner-v6.mjs': '019d9dd5bde40d3821273c2be624ebcb6fa53968f7f0748dea8c7ebb763363e4',
    'prepare-shadow-support.py': '08598217e42d8058b1839ae5162ede44b648f3b9c523c15f1c4eb8f7691bb9c7',
    'source008-receipt-support-build-v1.py': '572173c231c5e3b824563744ccbaf9d9fc48ff39f1bb99931f624d3f776c1f84'
}
ACKS = {
    Path('/var/backups/yunipals-receipt-worker-resume-20261022/runtime.json'):
        'cc55cdecbd08b34f5e9915e30b09bb9fe3444ea618429ce89215b3d081ddc7fa',
    Path('/var/lib/yunipals-unified-shadow/support-probes-source6-v11/20261022-support11-base1/result.json'):
        '69a9d0a9a13964ba4ae111141be7705f335397ad810acda520629943026a4172'
}
GROUP = '/system.slice/' + UNIT


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def module(name, pin):
    path = OPS / name
    raw = path.read_bytes()
    if sha(raw) != pin: fail('exact_reviewed_dependency_required')
    value = types.ModuleType(name); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def modules():
    normal = module('source6-normal-replay-successor-v2.py', PINS['source6-normal-replay-successor-v2.py'])
    r, b, s = normal.modules()
    return normal, r, b, s


def command():
    env = ['PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
           'NODE_OPTIONS=--max-old-space-size=384', 'YUNIPALS_SUPPORT_UID=969', 'YUNIPALS_SUPPORT_GID=963',
           'UNIFIED_RPC_POLICY_REQUIRED=true', 'UNIFIED_RPC_FREE_ONLY=true',
           'UNIFIED_RPC_PROFILE_FILE=' + str(OPS / 'normal-rpc-profile-v1.json'),
           'UNIFIED_RPC_PROFILE_ID=' + PROFILE]
    env += ['PONDER_RPC_URL_' + str(chain) + '=http://127.0.0.1:' + str(port) + '/unified'
            for chain, port in [(1,19201),(56,19204),(137,19203),(8453,19202)]]
    return ['/usr/bin/env', '-i', *env,
            '/opt/node-v24.18.1/bin/node', '--import', 'tsx', str(ENTRY)]


def drop_bytes(s):
    # systemd applies the original named user/group before installing the
    # retained RestrictSUIDSGID syscall filter. No post-exec privilege change.
    return ('[Service]\nWorkingDirectory=' +
            '/opt/yunipals-unified/releases/' + s.SOURCE + '/apps/yunipals-indexer\n'
            'ExecStart=\nExecStart=' + ' '.join(command()) + '\nRuntimeMaxSec=900\n').encode()


def inherited_identity(s):
    expected = {'User': 'yunipals_unified_support', 'Group': 'yunipals_unified_support',
                'SupplementaryGroups': '', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
                'NoNewPrivileges': 'yes', 'RestrictSUIDSGID': 'yes', 'SystemCallFilter': '~', 'SecureBits': '0'}
    raw = s.run(['/usr/bin/systemctl', 'show', '--all', UNIT] +
                ['--property=' + key for key in expected]).decode()
    actual = dict(line.split('=', 1) for line in raw.splitlines())
    if actual != expected: fail('unchanged_inherited_support_identity_and_hardening_required')
    user = pwd.getpwnam('yunipals_unified_support')
    group = grp.getgrnam('yunipals_unified_support')
    if (user.pw_uid != 969 or user.pw_gid != 963 or group.gr_gid != 963 or
            set(os.getgrouplist(user.pw_name, user.pw_gid)) != {963}):
        fail('existing_support_account_without_extra_groups_required')
    return actual


def support_pids():
    result = []
    for path in Path('/proc').glob('[0-9]*/status'):
        try: raw = path.read_text()
        except FileNotFoundError: continue
        uid = re.search(r'(?m)^Uid:\s+([0-9]+)', raw)
        if uid and uid[1] == '969': result.append(int(path.parent.name))
    return sorted(result)


def job(s):
    path = '/org/freedesktop/systemd1/unit/yunipals_2dunified_2dsupport_2dsource6_2dv2_2eservice'
    value = json.loads(s.run(['/usr/bin/busctl', '--json=short', 'get-property',
        'org.freedesktop.systemd1', path, 'org.freedesktop.systemd1.Unit', 'Job']).decode())
    if value.get('type') != '(uo)' or value.get('data') != [0, '/']: fail('quiet_support_manager_job_required')


def configuration(s, *, installed):
    if sha(s.protected(FRAGMENT)) != FRAGMENT_SHA: fail('original_support_fragment_changed')
    p = s.unit(UNIT); job(s); inherited_identity(s)
    if (p['FragmentPath'] != str(FRAGMENT) or p['DropInPaths'] != (str(DROP) if installed else '') or
            p['Restart'] != 'no' or p['NRestarts'] != '0' or p['MemoryMax'] != '805306368' or
            p['RuntimeMaxUSec'] != ('15min' if installed else '1h')):
        fail('exact_finite_support_configuration_required')
    if installed and (s.protected(DROP) != drop_bytes(s) or p['command'] != ' '.join(command()) or
                      p['User'] != 'yunipals_unified_support' or p['Group'] != 'yunipals_unified_support'):
        fail('only_exact_inherited_unprivileged_launch_allowed')
    return p


def quiet(s):
    p = s.unit(UNIT); job(s)
    if p['MainPID'] != '0' or p['ActiveState'] not in {'inactive','failed'} or support_pids():
        fail('all_support_actors_must_be_terminal')
    group = Path('/sys/fs/cgroup') / GROUP.lstrip('/') / 'cgroup.procs'
    if group.exists() and group.read_text().strip(): fail('support_cgroup_must_be_empty')
    if s.database(True)['supportSessions'] != 0: fail('support_database_sessions_must_be_quiet')
    return {k:p[k] for k in ['MainPID','ActiveState','SubState','InvocationID','Result','ExecMainStartTimestampMonotonic']}


def source_qualification(s):
    if sha(s.protected(OPS / QUALIFIER_NAME)) != QUALIFIER_SHA:
        fail('exact_acknowledged_proxy_qualifier_required')
    qualifier = module(QUALIFIER_NAME, QUALIFIER_SHA)
    value = qualifier.validate_current(QUALIFICATION)
    if (value.get('validated') is not True or
            value.get('format') != 'yunipals-source6-normal-proxy-requalification-v1' or
            value.get('qualificationReceiptSha256') != QUALIFICATION or
            value.get('operatorSha256') != QUALIFIER_SHA or
            value.get('originalRuntimeReceiptSha256') != SOURCE_RECEIPT or
            value.get('freeOnly') is not True or value.get('paidAuthority') is not False or
            value.get('financialWindowRenewed') is not False or
            value.get('originalWholeValidationPassed') is not False or
            value.get('sourceRestarted') is not False):
        fail('actual_proxy_qualified_source_ack_required')
    return value


def authority(normal, r, b, s):
    value = source_qualification(s)
    if value['runtime'] != SOURCE_ID: fail('exact_acknowledged_normal_source_required')
    for name,pin in PINS.items():
        if sha(s.protected(OPS/name)) != pin: fail('protected_reviewed_inputs_required')
    if (sha(s.protected(ENTRY)) != ENTRY_SHA or sha(s.protected(LOOP)) != LOOP_SHA):
        fail('exact_receipt_entry_and_unchanged_loop_required')
    for path,pin in ACKS.items():
        if sha(s.protected(path)) != pin: fail('retained_actual_support_acknowledgments_required')
    acl = module('prepare-shadow-support.py',PINS['prepare-shadow-support.py'])
    rights = s.query(acl.privilege_query())
    if rights != acl.desired_privileges(): fail('unchanged_restricted_support_grants_required')
    builder = module('source008-receipt-support-build-v1.py',PINS['source008-receipt-support-build-v1.py'])
    overlay = builder.validate_saved()
    if overlay['entrySha256'] != '014769192103aa421838f98f462a7d1f16c83c08729ef6083392eac828106d35':
        fail('actual_v11_receipt_overlay_required')
    dependencies = Path(overlay['dependencyDirectory']).lstat()
    if not stat.S_ISDIR(dependencies.st_mode) or dependencies.st_uid != 0 or dependencies.st_mode & 0o022:
        fail('retained_real_dependency_directory_required')
    permits=s.query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',permit_id,'maximumCu',maximum_cu,'spentCu',spent_cu,'enabled',enabled,'expiresAt',expires_at)ORDER BY permit_id),'[]'::jsonb)FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id='"+PROFILE+"'",True)
    if len(permits)!=2:fail('both_retained_historical_permit_records_required')
    proxies = s.proxies()
    if proxies != value['proxies']:
        fail('exact_acknowledged_proxy_tuple_required')
    if normal.current_identity(s, SOURCE_ID) != SOURCE_ID:
        fail('same_acknowledged_source_after_receipt_review_required')
    return {'format':FORMAT, 'sourceQualificationReceiptSha256':QUALIFICATION,
            'sourceQualificationOperatorSha256':QUALIFIER_SHA,
            'originalWholeValidationPassed':False,
            'sourceRuntime':SOURCE_ID,'sourceReceiptSha256':SOURCE_RECEIPT,'proxies':proxies,
            'financial':normal.financial(s),'acl':rights,'overlayArtifactDigest':overlay['artifactDigest'],
            'historicalPermitRecordsSha256':sha(encode(permits)),
            'originalAggregatePaidCeilingCu':20_000_000,'newPaidAllowanceCu':0,
            'entrySha256':ENTRY_SHA,'loopSha256':LOOP_SHA,'dropSha256':sha(drop_bytes(s)),
            'maximumConcurrentReceiptUpstream':1,'maximumRuntimeSeconds':900,'maximumRpcCalls':256,
            'paidAuthority':False,'newPaidWindow':False,'receiptHistoryCompleteClaimed':False}


def review(normal,r,b,s):
    if BASE.exists() or os.path.lexists(DROP.parent): fail('fresh_owned_receipt_probe_required')
    p=configuration(s,installed=False); stopped=quiet(s)
    value={**authority(normal,r,b,s),'before':stopped,'fragmentSha256':FRAGMENT_SHA,
           'operatorSha256':sha(s.protected(Path(__file__).absolute()))}
    return {**value,'reviewHash':sha(encode(value))}


def actor_boundary(status,cgroup):
    if (set(status['Uid'].split())!={'969'} or set(status['Gid'].split())!={'963'} or status['Groups'].strip() not in {'', '963'} or
            status['NoNewPrivs'].strip()!='1' or any(int(status[k].strip(),16)for k in['CapInh','CapPrm','CapEff','CapAmb']) or
            cgroup.strip()!='0::'+GROUP):
        fail('exact_unprivileged_support_actor_boundary_required')


def actor(s):
    p=configuration(s,installed=True)
    if p['ActiveState']!='active' or p['SubState']!='running' or int(p['MainPID'])<2:
        fail('new_active_receipt_actor_required')
    intent=json.loads(s.protected(BASE/'start-intent.json'))
    started=int(p['ExecMainStartTimestampMonotonic'])
    if not intent['beforeStartUs']<=started<=intent['beforeStartUs']+60_000_000:
        fail('only_owned_start_window_may_be_reconciled')
    pid=int(p['MainPID']); proc=Path('/proc',str(pid))
    if (proc/'cmdline').read_bytes().split(b'\0')[:-1] != [b'/opt/node-v24.18.1/bin/node',b'--import',b'tsx',str(ENTRY).encode()]:
        fail('exact_receipt_node_command_required')
    members=sorted(int(n)for n in (Path('/sys/fs/cgroup')/GROUP.lstrip('/')/'cgroup.procs').read_text().split())
    if not 1<=len(members)<=4 or members!=support_pids() or pid not in members:
        fail('only_owned_support_cgroup_actors_allowed')
    for child in members:
        childproc=Path('/proc',str(child));status=dict(line.split(':',1)for line in(childproc/'status').read_text().splitlines()if':'in line)
        actor_boundary(status,(childproc/'cgroup').read_text())
    identity={'pid':pid,'startTicks':int((proc/'stat').read_text().rpartition(')')[2].split()[19]),
              'invocation':p['InvocationID'],'startMonotonicMicroseconds':started}
    if not re.fullmatch('[0-9a-f]{32}',identity['invocation']): fail('actual_support_invocation_required')
    return identity


def inspect(normal,r,b,s,*,check_source=True):
    before=json.loads(s.protected(BASE/'before.json'))
    # A source outage or expired profile must not prevent stopping our own peer.
    # Starting/acceptance always revalidates the full acknowledged authority.
    current=authority(normal,r,b,s)if check_source else None
    if current is not None and any(current[k]!=before[k]for k in current): fail('source_proxy_policy_or_code_changed')
    p=s.unit(UNIT)
    identity=actor(s)if p['ActiveState']=='active'else None
    if identity is None: quiet(s)
    started=BASE/'started.json'
    if started.exists() and identity is not None and identity!=json.loads(s.protected(started))['runtime']:
        fail('foreign_receipt_invocation')
    return {'runtime':identity,'authority':current,'stopped':identity is None}


def apply(normal,r,b,s,pin):
    with ExitStack()as locks:
        for name in[s.SOURCE_LEASE,'/run/lock/yunipals-unified-support-probe.lock']:locks.enter_context(s.lease(name))
        checked=review(normal,r,b,s)
        if checked['reviewHash']!=pin: fail('exact_fresh_receipt_review_required')
        BASE.mkdir(mode=0o700);s.save(BASE/'before.json',checked)
        s.save(BASE/'intent.json',{'reviewHash':pin,'automaticRetryAllowed':False,'at':s.now()})
        DROP.parent.mkdir(mode=0o755);normal.write_new(DROP,drop_bytes(s),0o644)
        s.run(['/usr/bin/systemctl','daemon-reload']);configuration(s,installed=True);quiet(s)
        s.save(BASE/'start-intent.json',{'beforeStartUs':time.monotonic_ns()//1000,'at':s.now()})
        s.run(['/usr/bin/systemctl','start','--no-block',UNIT])
        until=time.monotonic()+60
        while True:
            try: identity=actor(s);break
            except (RuntimeError,FileNotFoundError):
                if time.monotonic()>=until:raise
                time.sleep(1)
        s.save(BASE/'started.json',{'runtime':identity,'at':s.now()})
        inspect(normal,r,b,s)
        value={'format':FORMAT,'sourceQualificationReceiptSha256':QUALIFICATION,
               'sourceQualificationOperatorSha256':QUALIFIER_SHA,'operatorSha256':sha(s.protected(Path(__file__).absolute())),
               'originalWholeValidationPassed':False,
               'started':True,'runtime':identity,'maximumRuntimeSeconds':900,'maximumRpcCalls':256,
               'paidAuthority':False,'sourceRestarted':False,'canonicalWitnessCreated':False,
               'receiptHistoryCompleteClaimed':False,'sourceReadinessClaimed':False,'at':s.now()}
        return {**value,'runtimeReceiptSha256':s.save(BASE/'runtime.json',value)}


def restore(normal,r,b,s):
    with ExitStack()as locks:
        for name in[s.SOURCE_LEASE,'/run/lock/yunipals-unified-support-probe.lock']:locks.enter_context(s.lease(name))
        removal=BASE/'removal-intent.json';stop=BASE/'stop-intent.json'
        if not removal.exists():
            current=inspect(normal,r,b,s,check_source=False)
            if not stop.exists():s.save(stop,{**current,'at':s.now()})
            saved=json.loads(s.protected(stop));identity=saved['runtime']
            if current['runtime'] is not None:
                if current['runtime']!=identity:fail('only_exact_owned_receipt_actor_may_stop')
                s.run(['/usr/bin/systemctl','stop',UNIT],timeout=45)
            quiet(s)
            if identity is not None:
                try: ticks=int(Path('/proc',str(identity['pid']),'stat').read_text().rpartition(')')[2].split()[19])
                except FileNotFoundError:ticks=None
                if ticks==identity['startTicks']:fail('original_receipt_process_must_be_gone')
            s.save(removal,{'dropSha256':sha(drop_bytes(s)),'at':s.now()})
        before=json.loads(s.protected(BASE/'before.json'))
        if before['entrySha256']!=ENTRY_SHA or before['dropSha256']!=sha(drop_bytes(s)):
            fail('recorded_owned_receipt_operation_required')
        if json.loads(s.protected(removal))['dropSha256']!=before['dropSha256']:
            fail('exact_owned_removal_intent_required')
        quiet(s)
        if os.path.lexists(DROP):
            if s.protected(DROP)!=drop_bytes(s)or set(DROP.parent.iterdir())!={DROP}:fail('only_owned_receipt_drop_may_be_removed')
            DROP.unlink()
        if DROP.parent.exists():DROP.parent.rmdir()
        s.run(['/usr/bin/systemctl','daemon-reload']);configuration(s,installed=False);quiet(s)
        value={'restored':True,'supportRemainsStopped':True,'originalFragmentUnchanged':True,
               'sourceRestarted':False,'receiptRowsOrLeasesReset':False,'paidAuthority':False,'at':s.now()}
        if not(BASE/'restored.json').exists():s.save(BASE/'restored.json',value)
        return value


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);actions=parser.add_mutually_exclusive_group()
    actions.add_argument('--apply');actions.add_argument('--inspect',action='store_true');actions.add_argument('--restore',action='store_true')
    args=parser.parse_args();signal.signal(signal.SIGALRM,lambda *_:fail('bounded_operator_deadline'));signal.alarm(160)
    try:
        if os.geteuid()!=0:fail('root_owner_operator_required')
        normal,r,b,s=modules()
        value=apply(normal,r,b,s,args.apply)if args.apply else restore(normal,r,b,s)if args.restore else inspect(normal,r,b,s)if args.inspect else review(normal,r,b,s)
        print(json.dumps(value,sort_keys=True))
    except Exception as error:
        code=str(error)if type(error)is RuntimeError and re.fullmatch('[a-z_0-9]+',str(error))else'private_diagnostics_withheld'
        print(json.dumps({'completed':False,'errorClass':type(error).__name__,'fixedCode':code,'automaticRetryAllowed':False}));raise SystemExit(1)
