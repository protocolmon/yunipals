#!/usr/bin/env python3
"""Acknowledge current unchanged-program Arena actors; no service or SQL action."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT = 'yunipals-arena-ypal-current-actors-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS / 'arena-ypal-native-v1.actors.py'
REHEARSAL = OPS / 'arena-ypal-native-v1.rehearsal.py'
REHEARSAL_SHA = '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf'
PROPOSAL = OPS / 'arena-ypal-native-v1.proposal.json'
PROPOSAL_SHA = 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80'
RESTORED_SHA = 'b1102b2b294b98ba98e61d96850a7bb765669ca23b3d4dd5bd06504e501efc33'
BASE = Path('/var/backups/yunipals-arena-ypal-actor-ack-v1-20261024')
RESULT = BASE / 'result.json'
STABLE_SECONDS = 1
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
MANAGER_KEYS = ('NRestarts', 'ExecMainStartTimestampMonotonic', 'ActiveEnterTimestampMonotonic', 'Result', 'ExecMainCode', 'ExecMainStatus')
PROCESS_KEYS = {'pid', 'startTicks', 'uid', 'gid', 'cwd', 'exe', 'argvSha256'}


class ActorFailure(RuntimeError): pass

def need(ok, code):
    if not ok: raise ActorFailure(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def protected(path, expected=None):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'absolute_actor_input_required')
    for p in [*reversed(path.parents), path]:
        s = p.lstat(); need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_actor_input_required')
    before = path.lstat(); need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size < 2_000_000, 'bounded_actor_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(identity(os.fstat(fd)) == identity(before), 'actor_input_open_changed')
        raw = os.read(fd, 2_000_000)
        need(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()) and len(raw) == before.st_size, 'actor_input_read_changed')
    finally: os.close(fd)
    need(expected is None or sha(raw) == expected, 'exact_actor_input_required'); return raw


def load(path, expected):
    raw = protected(path, expected); module = types.ModuleType('retained_actor_' + path.stem); module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__); return module


def core():
    # Reuse only immutable protected-reader/restore/graph leaves. The old
    # rehearsal.context() invocation predicate is never called or patched.
    h = load(REHEARSAL, REHEARSAL_SHA)
    proposal = json.loads(h.read(PROPOSAL, PROPOSAL_SHA))
    r = h.module(h.RESTORE, h.RESTORE_SHA); m = r.load_owner(); o = m.observer()
    raw = r.read(o, r.PARENT / 'result.json'); result = json.loads(raw)
    binding = json.loads(r.read(o, r.PARENT / 'review.json'))
    need(sha(raw) == proposal['current']['ownerResultSha256'] == r.RESULT_SHA and
         sha(m.encoded(binding)) == proposal['current']['ownerReviewHash'] == r.OWNER_REVIEW and
         result['reviewHash'] == r.OWNER_REVIEW and binding['operatorSha256'] == r.OWNER_SHA and
         result['migrationCommitOutcome'] == 'commit_confirmed', 'exact_committed_owner11_history_required')
    restored = json.loads(r.read(o, r.BASE / 'result.json'))
    need(sha(r.encoded(restored)) == proposal['current']['restoreResultSha256'] == RESTORED_SHA and restored['restored'] is True and
         restored['originalActors'] == proposal['current']['actors'], 'exact_historical_restore_ack_required')
    raw = o.read(r.OPS / 'arena-config-public-baseline-v1.json', 200000)[0]
    need(sha(raw) == o.BASELINE_SHA, 'unchanged_original_public_baseline_required'); base = json.loads(raw)
    need({row['unit'] for row in base['services']} == set(m.UNITS) == set(restored['originalActors']) and len(base['services']) == 8, 'exact_eight_original_units_required')
    return h, r, m, o, proposal, binding, base, restored


def manager(m, unit):
    raw = m.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in MANAGER_KEYS]], timeout=5, maximum=10000).decode()
    pairs = [line.split('=', 1) for line in raw.splitlines()]
    need(all(len(p) == 2 for p in pairs) and len(pairs) == len(MANAGER_KEYS) and set(dict(pairs)) == set(MANAGER_KEYS), 'complete_actor_restart_metadata_required')
    value = dict(pairs)
    need(all(re.fullmatch('[0-9]+', value[k]) for k in MANAGER_KEYS if k != 'Result') and value['Result'] == 'success' and
         value['ExecMainCode'] == value['ExecMainStatus'] == '0', 'healthy_current_manager_result_required')
    return value


def qualify_actor(prior, current, props, restart, old_pid_present):
    need(set(prior) == set(current) == {'invocation', 'process'} and set(prior['process']) == set(current['process']) == PROCESS_KEYS, 'exact_official_actor_shape_required')
    need(props['ActiveState'] == 'active' and props['SubState'] == 'running' and props['Restart'] == 'on-failure' and props['KillMode'] == 'control-group', 'original_running_restart_and_kill_policy_required')
    p, c = prior['process'], current['process']
    need(all(type(c[k]) is int and c[k] > 0 for k in ['pid', 'startTicks', 'uid', 'gid']) and re.fullmatch('[a-f0-9]{32}', current['invocation']), 'actual_current_process_and_invocation_required')
    need({k: v for k, v in c.items() if k not in {'pid', 'startTicks'}} == {k: v for k, v in p.items() if k not in {'pid', 'startTicks'}}, 'original_UID_GID_cwd_exe_argv_must_not_change')
    start = int(restart['ExecMainStartTimestampMonotonic']); enter = int(restart['ActiveEnterTimestampMonotonic'])
    tick_us = 1_000_000 // os.sysconf('SC_CLK_TCK')
    need(0 <= start - c['startTicks'] * tick_us <= 2_000_000 and enter >= start > 0, 'manager_and_kernel_start_identity_required')
    if current == prior: return {'kind': 'retained_exact_actor'}
    need(c['pid'] != p['pid'] and c['startTicks'] > p['startTicks'] and current['invocation'] != prior['invocation'] and
         not old_pid_present and int(restart['NRestarts']) > 0, 'only_proven_newer_auto_restarted_actor_may_be_acknowledged')
    return {'kind': 'unchanged_program_auto_restart', 'oldPidGone': True, 'newStartNewer': True, 'positiveAutoRestartCounter': True}


def snapshot(r, m, o, proposal, binding, base, restored):
    r.no_jobs(m); graph = r.graph(m, o, base, binding, owned=False)
    need(graph == proposal['current']['definitions'], 'unchanged_all_eight_definition_and_environment_graph_required')
    m.verify_inputs(o, binding['privateInputHashes'])
    actors, managers, qualification = {}, {}, {}
    for row in base['services']:
        unit = row['unit']; props = r.props(m, unit); restart = manager(m, unit)
        current = {'invocation': props['InvocationID'], 'process': m.process_identity(props, row)}
        prior = restored['originalActors'][unit]
        qualification[unit] = qualify_actor(prior, current, props, restart, Path('/proc', str(prior['process']['pid'])).exists())
        need(r.props(m, unit) == props and manager(m, unit) == restart, 'actor_or_restart_metadata_changed_during_observation')
        actors[unit], managers[unit] = current, restart
    # At least one unmodified cryptographic invocation anchors the historical
    # process tuple to this boot; all-eight replacement needs separate review.
    need(any(v['kind'] == 'retained_exact_actor' for v in qualification.values()), 'historical_same_boot_actor_anchor_required')
    r.no_jobs(m); m.verify_inputs(o, binding['privateInputHashes'])
    need(r.graph(m, o, base, binding, owned=False) == graph, 'definition_graph_changed_after_actor_capture')
    return {'actors': actors, 'manager': managers, 'qualification': qualification, 'definitionsSha256': sha(encoded(graph)), 'privateInputHashes': binding['privateInputHashes']}


def review():
    h, r, m, o, proposal, binding, base, restored = core()
    first = snapshot(r, m, o, proposal, binding, base, restored); time.sleep(STABLE_SECONDS)
    second = snapshot(r, m, o, proposal, binding, base, restored)
    need(first == second, 'all_eight_actors_must_be_stable_across_two_observations')
    value = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
             'proposalSha256': PROPOSAL_SHA, 'historicalRestoreSha256': RESTORED_SHA, 'historicalOwnerResultSha256': r.RESULT_SHA,
             'historicalOwnerReviewHash': r.OWNER_REVIEW, 'historicalActorsSha256': sha(encoded(restored['originalActors'])),
             'stabilitySeconds': STABLE_SECONDS, 'snapshot': second, 'oldWholeInvocationGatePassed': False,
             'serviceChanges': 0, 'databaseWrites': 0, 'providerCalls': 0, 'secretValuesExported': False}
    return value


def save(path, value):
    raw = encoded(value); fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), 0o600); f.write(raw); f.flush(); os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def capture(value, expected):
    need(pin(expected) and sha(encoded(value)) == expected, 'exact_fresh_actor_review_required')
    need(not os.path.lexists(BASE) and protected(Path(__file__).absolute()) and sha(protected(Path(__file__).absolute())) == value['operatorSha256'], 'fresh_exclusive_actor_ack_operation_required')
    # The caller just performed the fresh two-observation review. No manager,
    # database or provider effect is reachable; only this new audit directory.
    BASE.mkdir(mode=0o700); save(BASE / 'review.json', value)
    result = {'format': FORMAT, 'acknowledged': True, 'reviewHash': expected, 'operatorSha256': value['operatorSha256'],
              'binding': value, 'historicalRestoreRewritten': False, 'oldWholeInvocationGatePassed': False,
              'databaseWrites': 0, 'serviceChanges': 0, 'providerCalls': 0, 'secretValuesExported': False}
    save(RESULT, result)
    fd = os.open(BASE.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    return result


def acknowledgement(expected):
    need(pin(expected), 'actual_actor_ack_sha256_required'); raw = protected(RESULT, expected); value = json.loads(raw)
    need(stat.S_IMODE(RESULT.lstat().st_mode) == 0o600 and stat.S_IMODE(BASE.lstat().st_mode) == 0o700 and value['format'] == FORMAT and value['acknowledged'] is True and
         value['operatorSha256'] == sha(protected(Path(__file__).absolute())) == value['binding']['operatorSha256'] and value['reviewHash'] == sha(encoded(value['binding'])) and
         protected(BASE / 'review.json') == encoded(value['binding']) and value['binding']['proposalSha256'] == PROPOSAL_SHA and value['binding']['historicalRestoreSha256'] == RESTORED_SHA and
         value['historicalRestoreRewritten'] is False and value['oldWholeInvocationGatePassed'] is False and value['binding']['bootId'] == boot() and
         all(value[k] == 0 for k in ['databaseWrites', 'serviceChanges', 'providerCalls']), 'exact_same_boot_current_actor_ack_required')
    return value


def validate_current(expected):
    saved = acknowledgement(expected); current = review()
    need(current == saved['binding'], 'acknowledged_current_actor_or_static_context_changed')
    return {'format': FORMAT, 'validated': True, 'acknowledgementSha256': expected, 'reviewHash': saved['reviewHash'], 'binding': current, 'databaseWrites': 0, 'serviceChanges': 0, 'providerCalls': 0}


def summary(value):
    b = value.get('binding', value); q = b['snapshot']['qualification']
    return {'format': FORMAT, 'operatorSha256': b['operatorSha256'], 'reviewHash': sha(encoded(b)), 'actorCount': len(q),
            'unchangedActors': sum(v['kind'] == 'retained_exact_actor' for v in q.values()), 'restartedActors': sum(v['kind'] == 'unchanged_program_auto_restart' for v in q.values()),
            'oldWholeInvocationGatePassed': False, 'historicalRestoreRewritten': False, 'databaseWrites': 0, 'serviceChanges': 0, 'providerCalls': 0, 'secretValuesExported': False}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--capture', metavar='FRESH_REVIEW_SHA256'); a = p.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main' and Path(__file__).absolute() == FILE, 'fixed_root_host_and_public_actor_helper_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError())); signal.alarm(120)
    need(not os.path.lexists(BASE), 'exclusive_actor_ack_already_exists_no_retry')
    value = review()
    if a.capture:
        result = capture(value, a.capture); out = {**summary(result), 'acknowledged': True, 'resultFile': str(RESULT), 'resultSha256': sha(encoded(result))}
    else: out = {**summary(value), 'acknowledged': False, 'fileWrites': 0}
    print(json.dumps(out, sort_keys=True))
if __name__ == '__main__':
    try: main()
    except BaseException as e:
        print(json.dumps({'format': FORMAT, 'acknowledged': False, 'errorClass': type(e).__name__, 'fixedCode':str(e)if isinstance(e,ActorFailure)else'actor_observation_dependency_refused', 'rawMessagesExported': False, 'automaticRetry': False}, sort_keys=True)); raise SystemExit(1)
