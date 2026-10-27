#!/usr/bin/env python3
"""Review-first finite official observer. No services, receipts, scans or grants."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-ypal-combined-observer-owner-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-combined-observer-v1-20261024')
READ_OWNER = OPS / 'ypal-combined-read-admission-v2.py'
READ_OWNER_SHA = 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
ENTRY = OPS / 'ypal-combined-observer-v1.mjs'
ENTRY_SHA = 'ed0876e26b2d4fde5f1d9d64c506b882e36ffe9ccd517fceceebe5d2490806e8'
CONTEXT = OPS / 'ypal-combined-observer-context-v1.mjs'
CONTEXT_SHA = '518b7c6e22b0be91fa8d3169db20f4fc2618f709b4ab9e51be6316358b7b850f'
PUBLIC_RELEASE = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
TSX = PUBLIC_RELEASE / 'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'
TSX_REAL = PUBLIC_RELEASE / 'node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs'
TSX_SHA = '17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f'
PROFILE = OPS / 'ypal-combined-rpc-v1/profile.json'
PROFILE_SHA = 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
PROJECT = '/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'
NODE = '/opt/node-v24.18.1/bin/node'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
NATIVE = 'unified_ypal_20261023_v1'
PROFILE_ID = '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
MANIFEST = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
ENDPOINTS = {1: 19221, 56: 19224, 137: 19223, 8453: 19222}
OUTER_SECONDS = 150
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def protected(path, cap=3000000):
    path = Path(path)
    for item in [path, *path.parents]:
        st = item.lstat(); need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_observer_input_required')
    st = path.stat(); need(stat.S_ISREG(st.st_mode) and st.st_size <= cap, 'bounded_observer_input_required')
    raw = path.read_bytes(); after = path.stat()
    need((st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size) == (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size), 'observer_input_changed_during_read')
    return raw


def document(path, pin=None):
    raw = protected(path); need(pin is None or sha(raw) == pin, 'exact_owned_observer_record_required'); return json.loads(raw)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, value):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), 0o600); f.write(raw); f.flush(); os.fsync(f.fileno())
    sync(path.parent); return sha(raw)


def inputs():
    need(sha(protected(ENTRY)) == ENTRY_SHA and sha(protected(PROFILE)) == PROFILE_SHA, 'exact_observer_and_admitted_profile_required')
    need(sha(protected(CONTEXT)) == CONTEXT_SHA and TSX.resolve(strict=True) == TSX_REAL and sha(protected(TSX_REAL)) == TSX_SHA,
         'exact_public_observer_context_and_loader_required')
    raw = protected(READ_OWNER); need(sha(raw) == READ_OWNER_SHA, 'exact_current_read_admission_owner_required')
    owner = types.ModuleType('acknowledged_combined_reads'); owner.__file__ = str(READ_OWNER)
    exec(compile(raw, str(READ_OWNER), 'exec'), owner.__dict__)
    account = pwd.getpwnam('yunipals_unified_support')
    need(account.pw_uid == 969 and account.pw_gid == 963 and set(os.getgrouplist(account.pw_name, 963)) == {963}, 'existing_support_account_without_extra_groups_required')
    help_result = subprocess.run(['/usr/bin/setpriv', '--help'], env=CLEAN, capture_output=True, timeout=5)
    need(help_result.returncode == 0 and not help_result.stderr and b'--pdeathsig' in help_result.stdout, 'available_setpriv_parent_death_guard_required')
    return owner


def configuration(run_id, chains, admission):
    need(re.fullmatch('[a-z0-9][a-z0-9-]{2,63}', run_id or '') and re.fullmatch('[a-f0-9]{64}', admission or ''), 'explicit_finite_run_and_actual_read_ACK_required')
    need(isinstance(chains, list) and 1 <= len(chains) <= 4 and all(type(v) is int and v in ENDPOINTS for v in chains) and sorted(set(chains)) == chains, 'fixed_sequential_chain_selection_required')
    return {'runId': run_id, 'chains': chains, 'readAdmissionSha256': admission}


def qualify(owner, config):
    value = owner.validate_current(config['readAdmissionSha256']); source = value['sourceBinding']
    need(value['validated'] is True and value['operatorSha256'] == READ_OWNER_SHA and value['receiptSha256'] == config['readAdmissionSha256'] and
         value['originalWholeValidatorPassed'] is False and value['consumerSelectionsQualified'] is False and
         source['releaseId'] == RELEASE and source['schema'] == NATIVE and source['schemaOid'] == '75963410' and source['buildId'] == '71e2a7f3b7' and
         source['manifestHash'] == MANIFEST and source['sourceReceiptSha256'] == 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909', 'actual_current_read_ACK_and_combined_source_required')
    return source


def current(owner, chains):
    view, _, _, h, *_ = owner.load()
    sql = "SELECT jsonb_build_object('native',(SELECT jsonb_build_object('buildId',value->>'build_id','frameworkReady',value->>'is_ready','locked',value->>'is_locked','heartbeat',value->>'heartbeat_at') FROM " + NATIVE + "._ponder_meta WHERE key='app'),'control',COALESCE((SELECT jsonb_agg(jsonb_build_object('chainId',s.chain_id,'status',jsonb_build_object('revision',s.revision::text,'head_number',s.head_number::text,'head_hash',s.head_hash,'head_timestamp',s.head_timestamp::text,'finalized_number',s.finalized_number::text,'finalized_hash',s.finalized_hash,'witness_number',s.witness_number::text,'witness_hash',s.witness_hash,'observed_at_ms',s.observed_at_ms::text,'provider_id',s.provider_id,'anchors',s.anchors,'halted',s.halted,'error_code',s.error_code,'finality_error_code',s.finality_error_code),'witnessCanonical',EXISTS(SELECT 1 FROM " + NATIVE + ".chain_block b WHERE b.chain_id=s.chain_id AND b.block_number=s.witness_number AND b.block_hash=s.witness_hash))ORDER BY s.chain_id)FROM yunipals_indexer_control.chain_status s WHERE s.release_id='" + RELEASE + "'AND s.chain_id IN(" + ','.join(str(v) for v in chains) + ")),'[]'::jsonb))"
    value = view.query(h, sql)[0]
    need(value['native']['buildId'] == '71e2a7f3b7' and len(value['control']) <= len(chains), 'bounded_same_native_control_state_required')
    return value


def command(config, mode, parent_pid=None):
    need(mode in {'inspect', 'observe-once'}, 'fixed_observer_child_mode_required')
    env = {**CLEAN, 'NODE_OPTIONS': '--max-old-space-size=384', 'TSX_DISABLE_CACHE': '1',
           'YUNIPALS_OBSERVER_PUBLIC_CONTEXT': 'public6e-v1', 'YUNIPALS_OBSERVER_READ_ACK_SHA': config['readAdmissionSha256']}
    if parent_pid is not None: env['YUNIPALS_OBSERVER_PARENT_PID'] = str(parent_pid)
    return ['/usr/bin/setpriv', '--reuid=969', '--regid=963', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL',
            '/usr/bin/env', '-i', *[k + '=' + v for k, v in env.items()], NODE, '--import', str(TSX), '--import', str(CONTEXT),
            str(ENTRY), mode, ','.join(str(v) for v in config['chains'])]


def review(owner, config):
    first = qualify(owner, config); state = current(owner, config['chains'])
    need(qualify(owner, config) == first, 'source_changed_during_observer_review')
    value = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'runnerSha256': ENTRY_SHA,
             'publicContextSha256': CONTEXT_SHA, 'tsxLoaderSha256': TSX_SHA,
             'readAdmissionOwnerSha256': READ_OWNER_SHA, 'readAdmissionSha256': config['readAdmissionSha256'], 'config': config,
             'sourceBinding': first, 'controlBefore': state['control'], 'bootId': boot(), 'workingDirectory': PROJECT,
             'peerCommand': command(config, 'observe-once'), 'outerSeconds': OUTER_SECONDS,
             'maximumRpcCalls': 64, 'rpcWindowSeconds': 120, 'maximumResponseBytes': 2097152, 'maximumTotalResponseBytes': 16777216,
             'sourceReadinessClaimed': False, 'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'currentNative': state['native']}


def child(config, mode, deadline, on_started=None):
    remaining = deadline - time.monotonic(); need(remaining > 0, 'observer_outer_deadline_expired')
    proc = subprocess.Popen(command(config, mode, os.getpid()), cwd=PROJECT, env=CLEAN, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        need(os.getpgid(proc.pid) == proc.pid, 'new_owned_observer_process_group_required')
        if on_started: on_started({'pid': proc.pid, 'processGroup': proc.pid, 'parentPid': os.getpid(), 'bootId': boot(), 'intentBound': True})
        try: stdout, stderr = proc.communicate(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True; os.killpg(proc.pid, signal.SIGKILL); stdout, stderr = proc.communicate(timeout=5)
    except BaseException:
        if proc.poll() is None: os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5); raise
    need(len(stdout) <= 1000000 and len(stderr) <= 1000000, 'bounded_observer_child_output_required')
    return {'returncode': proc.returncode, 'timedOut': timed_out, 'stdout': stdout, 'stderr': stderr}


def parsed_child(outcome, mode, config):
    need(outcome['returncode'] == 0 and outcome['timedOut'] is False and not outcome['stderr'], 'observer_child_ACK_unknown_inspect_only')
    value = json.loads(outcome['stdout'])
    need(value['format'] == 'yunipals-ypal-combined-observer-v1' and value['releaseId'] == RELEASE and value['manifestHash'] == MANIFEST and
         value['buildId'] == '71e2a7f3b7' and value['rootReadAdmissionReference'] == config['readAdmissionSha256'] and
         value['rootReadAdmissionVerifiedHere'] is False and value['sourceReadinessQualified'] is False, 'exact_official_observer_child_required')
    if mode == 'inspect': need(value['inspected'] is True and value['rpcCalls'] == value['writeStatements'] == 0, 'actual_peer_inspection_zero_effects_required')
    else:
        need(value['completed'] is True and value['successful'] is True and value['paidAuthority'] is False and value['nativeDataWritten'] is False and
             value['canonicalNativeWitnessCreated'] is False and value['receiptQueries'] == 0 and value['requests']['rpcCalls'] <= 64 and
             value['requests']['responseBytes'] <= 16777216 and value['requests']['failed'] is False and
             [v['chainId'] for v in value['results']] == config['chains'] and all(v['executed'] is True and v['observed'] == 'observed' for v in value['results']), 'every_selected_official_observation_must_acknowledge')
    return value


def confirm_control(value, control, chains, now_ms=None):
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    rows = {v['chainId']: v for v in control['control']}; need(set(rows) == set(chains), 'all_current_observed_control_rows_required')
    for result in value['results']:
        current_row = rows[result['chainId']]; status = current_row['status']; actual = {k: v for k, v in status.items() if k not in {'release_id', 'chain_id'}}
        need(actual == result['observation'] and current_row['witnessCanonical'] is True and status['halted'] is False and status['error_code'] is None and
             status['observed_at_ms'] is not None and 0 <= now_ms - int(status['observed_at_ms']) <= 180000,
             'same_owned_observation_revision_and_current_canonical_witness_required')


def operation_directory(config):
    for parent in BASE.parents:
        st = parent.lstat()
        trusted_temporary_root = parent == Path('/tmp') and stat.S_IMODE(st.st_mode) == 0o1777
        need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and
             (not st.st_mode & 0o022 or trusted_temporary_root), 'protected_observer_operation_ancestry_required')
    BASE.mkdir(mode=0o700, exist_ok=True)
    st = BASE.lstat()
    need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o700,
         'private_observer_operation_parent_required')
    sync(BASE.parent)
    directory = BASE / config['runId']; directory.mkdir(mode=0o700); sync(BASE)
    return directory


def observe(owner, config, expected):
    deadline = time.monotonic() + OUTER_SECONDS
    checked = review(owner, config); need(checked['reviewHash'] == expected, 'fresh_exact_observer_review_required')
    need(not os.path.lexists(BASE / config['runId']), 'one_attempt_per_explicit_observer_run')
    # Real unprivileged import/DB-read qualification before any operation directory or write intent.
    inspected = parsed_child(child(config, 'inspect', deadline), 'inspect', config)
    need(review(owner, config)['binding'] == checked['binding'], 'source_or_control_changed_during_peer_inspection')
    need(time.monotonic() < deadline, 'observer_preflight_deadline_expired_before_write_intent')
    directory = operation_directory(config)
    save(directory / 'review.json', checked); save(directory / 'peer-inspection.json', inspected)
    intent = {'format': FORMAT, 'reviewHash': expected, 'reviewFileSha256': sha(protected(directory / 'review.json')), 'operatorSha256': checked['binding']['operatorSha256'], 'bootId': boot(), 'config': config, 'outerSeconds': OUTER_SECONDS, 'automaticRetryAllowed': False}
    save(directory / 'intent.json', intent)
    try:
        outcome = child(config, 'observe-once', deadline, lambda started: save(directory / 'child-started.json', started))
        save(directory / 'child.stdout', outcome.pop('stdout')); save(directory / 'child.stderr', outcome.pop('stderr')); save(directory / 'child-terminal.json', outcome)
        value = parsed_child({**outcome, 'stdout': protected(directory / 'child.stdout'), 'stderr': protected(directory / 'child.stderr')}, 'observe-once', config)
        need(qualify(owner, config) == checked['binding']['sourceBinding'], 'source_changed_during_official_observation')
        after = current(owner, config['chains']); confirm_control(value, after, config['chains'])
        need(qualify(owner, config) == checked['binding']['sourceBinding'], 'source_changed_during_observation_acknowledgement')
        result = {'format': FORMAT, 'completed': True, 'operatorSha256': checked['binding']['operatorSha256'], 'runnerSha256': ENTRY_SHA,
                  'publicContextSha256': CONTEXT_SHA, 'tsxLoaderSha256': TSX_SHA,
                  'readAdmissionSha256': config['readAdmissionSha256'], 'reviewHash': expected, 'bootId': boot(), 'config': config,
                  'intentSha256': sha(protected(directory / 'intent.json')), 'childOutputSha256': sha(protected(directory / 'child.stdout')),
                  'confirmedControlSha256': sha(encoded(after['control'])), 'officialObservedChains': config['chains'],
                  'sourceReadinessClaimed': False, 'canonicalNativeWitnessCreated': False, 'nativeDataWritten': False,
                  'receiptProcessing': False, 'serviceActions': 0, 'paidAuthority': False, 'automaticRetryAllowed': False}
        save(directory / 'result.json', result); return result
    except BaseException:
        save(directory / 'unknown.json', {'format': FORMAT, 'reviewHash': expected, 'outcomeMayBeUnknown': True, 'automaticRetryAllowed': False}); raise


def inspect(owner, config):
    checked = review(owner, config); directory = BASE / config['runId']; attempt = None
    if directory.exists():
        intent = document(directory / 'intent.json'); saved = document(directory / 'review.json', intent['reviewFileSha256'])
        need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
             intent['config'] == config and intent['reviewHash'] == saved['reviewHash'] == sha(encoded(saved['binding'])), 'exact_owned_observer_attempt_required')
        attempt = {'intentSha256': sha(protected(directory / 'intent.json')), 'completedReceiptExists': (directory / 'result.json').exists(),
                   'terminalReceiptExists': (directory / 'child-terminal.json').exists(), 'outcomeMayBeUnknown': not (directory / 'result.json').exists(), 'automaticRetryAllowed': False}
    return {'format': FORMAT, 'inspected': True, 'reviewHash': checked['reviewHash'], 'attempt': attempt,
            'currentCanonicalControl': current(owner, config['chains']), 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0,
            'successInferredFromCatalogAlone': False, 'sourceReadinessClaimed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--read-admission', required=True); parser.add_argument('--run-id', required=True); parser.add_argument('--chains', default='1,56,137,8453')
    action = parser.add_mutually_exclusive_group(); action.add_argument('--observe'); action.add_argument('--inspect', action='store_true'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_production_root_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'observer_outer_deadline_expired')); signal.alarm(OUTER_SECONDS)
    config = configuration(args.run_id, [int(v) for v in args.chains.split(',')], args.read_admission); owner = inputs()
    _, _, shared, *_ = owner.load()
    with shared.transition_lock():
        result = observe(owner, config, args.observe) if args.observe else inspect(owner, config) if args.inspect else review(owner, config)
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld', 'errorClass': type(error).__name__, 'automaticRetryAllowed': False})); raise SystemExit(1)
