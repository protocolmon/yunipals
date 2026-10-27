#!/usr/bin/env python3
"""Observe only eight already accepted runtimes after normal proxy restarts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
OUTPUT = OPS / 'source6-dependent-restarts-v1.json'
FORMAT = 'yunipals-source6-dependent-restart-equivalence-v1'
INVENTORY_SHA = 'b00f666ced357a9d5d2835a4ed5de6efe5ed5cdf395fe3794e651665a826a9f5'
VERIFIER_SHA = 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965'
DEPENDENCY_HELPER_SHA = '1baaaafca0021ea710f2234b6a705a3fa6a4978608810a51aa9ef56913e544e0'
DEPENDENCY_SHA = 'caa2626c651d29e9a2bdb15e16be2e390d39b6c96ba27a6976cd921f991d2717'
LEGACY_SHA = '73305a9022ca57e5759a510b0f58c3aa14ee4e112d889da424fb11fa32769a78'
FIVE = tuple('yunipals-' + n + '.service' for n in ['indexer', 'bnb', 'metadata', 'api', 'leaderboard'])
THREE = ('yunipals-market-production-read@base.service', 'yunipals-market-production-read@ethereum.service', 'yunipals-market-production-signature.service')
UNITS = FIVE + THREE
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(label):
    raise RuntimeError(label)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def trusted(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        fail('protected_absolute_input_required')
    for item in [*path.parents, path]:
        props = item.lstat()
        if stat.S_ISLNK(props.st_mode) or props.st_uid != 0 or props.st_mode & 0o022:
            fail('root_protected_input_required')
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
        fail('bounded_regular_input_required')
    raw = path.read_bytes()
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail('protected_input_changed')
    return raw


def load(path, expected, name):
    raw = trusted(path, 300_000)
    if sha(raw) != expected:
        fail('exact_readonly_helper_pin_required')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def properties(verifier, unit, command=subprocess.run):
    if unit not in UNITS:
        fail('exact_eight_service_scope_required')
    keys = set(verifier.STATE_KEYS) | {'Id', 'LoadState', 'Result'}
    result = command(['/usr/bin/systemctl', 'show', '--all', unit,
                      '--property=' + ','.join(sorted(keys))], env=ENV, capture_output=True, timeout=5)
    if result.returncode or not isinstance(result.stdout, bytes) or len(result.stdout) > 100_000:
        fail('bounded_existing_service_properties_required')
    values = {}
    repeated = {'Environment': [], 'EnvironmentFiles': []}
    for line in result.stdout.decode().splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in keys or key in values:
            fail('exact_unique_public_property_shape_required')
        if key in repeated:
            repeated[key].append(value)
        else:
            values[key] = value
    if any(not items for items in repeated.values()):
        fail('complete_private_settings_hash_input_required')
    for key, items in repeated.items():
        values[key] = ' '.join(items)
    values['EnvironmentFilesEntries'] = repeated['EnvironmentFiles']
    if set(values) != keys | {'EnvironmentFilesEntries'}:
        fail('complete_service_properties_required')
    return values


def equivalent(verifier, dependency, unit, prior, before, after, props):
    if (unit not in UNITS or prior.get('unit') != unit or prior.get('afterState') != before or
            before.get('Id') != unit or after.get('Id') != unit or
            any(row.get('LoadState') != 'loaded' or row.get('ActiveState') != 'active' or row.get('SubState') != 'running' or
                not re.fullmatch('[0-9a-f]{32}', row.get('InvocationID', '')) for row in [before, after]) or
            before['InvocationID'] == after['InvocationID'] or props.get('Id') != unit or
            props.get('InvocationID') != after['InvocationID'] or props.get('Result') != 'success' or
            props.get('LoadState') != 'loaded' or props.get('ActiveState') != 'active' or props.get('SubState') != 'running' or
            not props.get('MainPID', '').isdigit() or int(props['MainPID']) <= 1):
        fail('actual_exact_before_and_current_healthy_restart_required')
    argv = re.findall(r'argv\[\]=(.*?)\s+;', props.get('ExecStart', ''))
    executable = re.findall(r'(?:^|[ {;])path=([^ ;]+)', props.get('ExecStart', ''))
    if (argv != [' '.join(prior['execArgv'])] or executable != [prior['execPath']] or
            props.get('WorkingDirectory') != prior['workingDirectory'] or
            verifier.definitions(props) != prior['definitions'] or
            verifier.private_settings(props) != prior['privateSettings']):
        fail('accepted_runtime_definition_or_private_hash_changed')
    files = {**prior.get('runtimeFiles', {}), **prior.get('additionalCurrentEntrypointPins', {})}
    if unit in THREE:
        files = {prior['execArgv'][-1]: prior['runtimeSha256']}
    if not files or len(files) > 8:
        fail('exact_small_accepted_public_runtime_set_required')
    for path, expected in files.items():
        raw = dependency.legacy_runtime(path, 4_000_000) if Path(path).suffix in {'.ts', '.json'} else trusted(path, 4_000_000)
        if sha(raw) != expected:
            fail('accepted_public_runtime_bytes_changed')
    return {'unit': unit, 'beforeState': before, 'afterState': after,
            'acceptedProofSha256': DEPENDENCY_SHA if unit in FIVE else LEGACY_SHA,
            'definitionsSha256': sha(encoded(prior['definitions'])),
            'privateSettingsSha256': sha(encoded(prior['privateSettings'])),
            'execIdentitySha256': sha(encoded({k: prior[k] for k in ['execPath', 'execArgv', 'workingDirectory']})),
            'runtimeFilesSha256': sha(encoded(files)), 'healthy': True, 'result': 'success'}


def capture(inventory, verifier, dependency, *, command=subprocess.run):
    proof_files = [('dependency-rebase-range-hints-v5.json', DEPENDENCY_SHA, 'services', set(FIVE)),
                   ('legacy-rebase-range-hints-v5.json', LEGACY_SHA, 'workers', set(THREE))]
    accepted = {}
    for name, expected, key, units in proof_files:
        raw = trusted(OPS / name, 100_000)
        if sha(raw) != expected:
            fail('exact_prior_accepted_equivalence_proof_required')
        rows = json.loads(raw).get(key, [])
        if len(rows) != len(units) or {row.get('unit') for row in rows} != units:
            fail('exact_five_plus_three_accepted_rows_required')
        accepted.update({row['unit']: row for row in rows})
    first = inventory.capture(command)
    differences = {row['unit']: row for row in first['differences']}
    if (set(differences) != set(UNITS) or first.get('comparedServiceCount') != 30 or
            first.get('baselineAdoptedFromCurrent') is not False or first.get('promotionAuthorized') is not False):
        fail('only_exact_eight_historical_restart_differences_allowed')
    rows = []
    for unit in UNITS:
        changed = differences[unit]
        rows.append(equivalent(verifier, dependency, unit, accepted[unit], changed['before'], changed['after'],
                               properties(verifier, unit, command)))
    if inventory.capture(command) != first:
        fail('service_ids_changed_during_equivalence_observation')
    return {'format': FORMAT, 'historicalStopProofSha256': inventory.STOP_SHA,
            'historicalMonitorSha256': inventory.MONITOR_SHA,
            'dependencyProofSha256': DEPENDENCY_SHA, 'legacyProofSha256': LEGACY_SHA,
            'inventoryHelperSha256': INVENTORY_SHA, 'verifierSha256': VERIFIER_SHA,
            'inventoryObservationSha256': sha(encoded(first)),
            'historicalProjectedThirtySha256': first['expectedThirtySha256'],
            'restartQualifiedThirtySha256': first['currentThirtySha256'],
            'services': rows, 'serviceCount': 8, 'otherServiceCountUnchanged': 22,
            'onlyInvocationChanged': True, 'acceptedRuntimeDefinitionsAndPrivateHashesUnchanged': True,
            'baseBnbControlledSeparately': True, 'baselineAdoptedFromCurrent': False,
            'sourceSelectorChecked': False, 'privateEnvironmentFilesRead': False,
            'serviceJobs': 0, 'databaseCalls': 0, 'providerCalls': 0,
            'promotionAuthorized': False}


def save(proof, marker):
    if sha(encoded(proof)) != marker:
        fail('fresh_exact_equivalence_review_required')
    raw = encoded(proof)
    fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    parent = os.open(OUTPUT.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main':
        fail('exact_root_host_observation_required')
    os.umask(0o077)
    def expired(*_):
        raise TimeoutError('bounded_equivalence_observation')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(90)
    try:
        inventory = load(OPS / 'paid-prepromotion-legacy-inventory-v1.py', INVENTORY_SHA, 'accepted_service_inventory')
        verifier = load(OPS / 'proxy-upgrade.py', VERIFIER_SHA, 'accepted_public_setting_hashes')
        dependency = load(OPS / 'dependency-rebase-range-hints-v5.py', DEPENDENCY_HELPER_SHA, 'accepted_public_source_reader')
        proof = capture(inventory, verifier, dependency)
        marker = sha(encoded(proof))
        if args.apply:
            save(proof, args.apply)
        print(json.dumps({'format': FORMAT, 'reviewHash': marker, 'proofSha256': marker,
                          'proofFile': str(OUTPUT) if args.apply else None,
                          'applied': bool(args.apply), 'serviceCount': 8,
                          'otherServiceCountUnchanged': 22, 'onlyInvocationChanged': True,
                          'baselineAdoptedFromCurrent': False, 'promotionAuthorized': False,
                          'databaseCalls': 0, 'providerCalls': 0, 'serviceJobs': 0}))
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False,
                          'errorClass': type(error).__name__, 'promotionAuthorized': False}))
        raise SystemExit(1)
