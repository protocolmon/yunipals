#!/usr/bin/env python3
"""Requalify one retained main API restart; default is read-only observation.

No consumer, source, database, provider or service action is performed. A future
consumer composition may explicitly consume a fresh protected acknowledgement;
the old retained selector record and installer remain unchanged.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-current-main-reader-observation-v1-20261023')
FORMAT = 'yunipals-current-main-reader-observation-v1'
MAIN = 'yunipals-api.service'
UNITS = (MAIN, 'yunipals-collector-api.service', 'yunipals-islands-api.service')
SELECTORS = 'consumer-retained-selectors-actual-20261021.json'
SELECTORS_SHA = '3a031e154a911b7b38634518cf872d5b224602cf393e174fb12cd7c5c2d641eb'
ACCEPTED = 'dependency-rebase-range-hints-v5.json'
ACCEPTED_SHA = 'caa2626c651d29e9a2bdb15e16be2e390d39b6c96ba27a6976cd921f991d2717'
DEPS = {
    'paid-source6-dependent-restarts-v1.py': '4668511cb75e917a92185d42f822ed4ed467412d904340344e0fb4ebc1997676',
    'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965',
    'dependency-rebase-range-hints-v5.py': '1baaaafca0021ea710f2234b6a705a3fa6a4978608810a51aa9ef56913e544e0',
    'consumer-retained-selectors-observe-v1.py': '066c74a83a2933544b2e204c253e10756bc8cb4e8e9665e63123ddc29b273350',
    'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416',
}


def fail(code):
    raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def protected(path, maximum=4_000_000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        fail('absolute_protected_observation_input_required')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('protected_observation_input_required')
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
        fail('bounded_regular_observation_input_required')
    raw = path.read_bytes()
    after = path.stat()
    keys = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if keys(before) != keys(after):
        fail('observation_input_changed_while_reading')
    return raw


def document(name, pin):
    raw = protected(OPS / name)
    if sha(raw) != pin:
        fail('exact_historical_observation_input_required')
    return json.loads(raw)


def load(name):
    raw = protected(OPS / name)
    if sha(raw) != DEPS.get(name):
        fail('exact_readonly_observation_helper_required')
    module = types.ModuleType('current_main_' + name.replace('-', '_'))
    module.__file__ = str(OPS / name)
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def selector_delta(prior, current):
    if (prior.get('format') != 'yunipals-consumer-retained-selectors-v1' or prior.get('completed') is not True
            or len(prior.get('services', [])) != 3 or len(current) != 3
            or {row['unit'] for row in prior['services']} != set(UNITS)
            or {row['unit'] for row in current} != set(UNITS)):
        fail('exact_three_retained_consumer_observations_required')
    for old in prior['services']:
        fresh = next(row for row in current if row['unit'] == old['unit'])
        if old['unit'] != MAIN:
            if fresh != old:
                fail('collector_and_islands_observations_must_remain_exact')
        elif ({k: v for k, v in fresh.items() if k not in {'process', 'invocationId'}} !=
              {k: v for k, v in old.items() if k not in {'process', 'invocationId'}}
              or fresh['invocationId'] == old['invocationId']
              or fresh['process'] == old['process']):
            fail('only_actual_main_restart_identity_may_differ')
    return {'format': prior['format'], 'completed': True, 'services': current}


def current_inputs(retained, props):
    inline = shlex.split(props['Environment'])
    configured = {}
    for item in inline:
        key, sep, value = item.partition('=')
        if not sep or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) or key in configured:
            fail('exact_unambiguous_main_inline_environment_required')
        configured[key] = value
    hashes = {}
    for name, optional in retained.ordered_files(props['EnvironmentFilesEntries']):
        path = Path(name)
        if optional and not os.path.lexists(path):
            hashes[name] = None
            continue
        raw = protected(path, 262144)
        hashes[name] = sha(raw)
        configured.update(retained.parse_env(raw))
    pid = props['MainPID']
    before = retained.process(pid)
    actual = retained.process_env(pid)
    if (not configured.get('DATABASE_URL') or
            any(actual.get(key) != configured.get(key) for key in set(configured) | set(retained.RECOVERY_KEYS))):
        fail('current_main_files_and_source_selectors_must_match_running_process')
    if retained.process(pid) != before:
        fail('current_main_identity_changed_during_private_comparison')
    return {'process': before, 'orderedPrivateFileHashes': hashes,
        'inlineEnvironmentSha256': sha(encoded(inline)),
        'configuredEnvironmentSha256': sha(encoded(configured)), 'actualProcessEnvironmentCompared': True}


def capture():
    restart = load('paid-source6-dependent-restarts-v1.py')
    verifier = load('proxy-upgrade.py')
    dependency = load('dependency-rebase-range-hints-v5.py')
    observer = load('consumer-retained-selectors-observe-v1.py')
    retained = load('retained-workers-stage-v1.py')
    prior = document(SELECTORS, SELECTORS_SHA)
    accepted = document(ACCEPTED, ACCEPTED_SHA)
    rows = accepted.get('services', [])
    if len(rows) != 5 or {row['unit'] for row in rows} != set(restart.FIVE):
        fail('exact_five_accepted_runtime_rows_required')
    baseline = next(row for row in rows if row['unit'] == MAIN)
    observations = [observer.observe(unit) for unit in UNITS]
    current = selector_delta(prior, observations)
    props = restart.properties(verifier, MAIN)
    after = {key: props[key] for key in baseline['afterState']}
    equivalence = restart.equivalent(verifier, dependency, MAIN, baseline, baseline['afterState'], after, props)
    inputs = current_inputs(retained, props)
    main = next(row for row in observations if row['unit'] == MAIN)
    process = inputs['process']
    observer_identity = {'pid': process['pid'], 'startTicks': process['startTicks'], 'boot': process['bootId']}
    if main['process'] != observer_identity or main['invocationId'] != props['InvocationID']:
        fail('same_actual_main_process_required_for_all_observations')
    latest = restart.properties(verifier, MAIN)
    if (latest != props or
            restart.equivalent(verifier, dependency, MAIN, baseline, baseline['afterState'], after, latest) != equivalence
            or current_inputs(retained, latest) != inputs
            or [observer.observe(unit) for unit in UNITS] != observations):
        fail('current_main_or_retained_peers_changed_during_qualification')
    public_state_keys = {'Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID'}
    equivalence = {**equivalence,
        'beforeState': {key: value for key, value in equivalence['beforeState'].items() if key in public_state_keys},
        'afterState': {key: value for key, value in equivalence['afterState'].items() if key in public_state_keys}}
    old = next(row for row in prior['services'] if row['unit'] == MAIN)
    return {'format': FORMAT, 'operatorSha256': sha(Path(__file__).read_bytes()),
        'originalSelectorsFile': str(OPS / SELECTORS), 'originalSelectorsSha256': SELECTORS_SHA,
        'acceptedRuntimeFile': str(OPS / ACCEPTED), 'acceptedRuntimeSha256': ACCEPTED_SHA,
        'originalMainInvocation': old['invocationId'], 'currentMainInvocation': main['invocationId'],
        'originalMainIdentityMismatchExplicit': True, 'mainRuntimeEquivalence': equivalence,
        'currentMainInputs': inputs, 'currentSelectors': current,
        'collectorAndIslandsExactOriginalObservations': True,
        'historicalObservationModified': False, 'oldStoredInvocationGateClaimedPassed': False,
        'sourceReadinessQualified': False, 'installOrPromotionAuthorized': False,
        'databaseCalls': 0, 'providerCalls': 0, 'serviceActions': 0, 'privateValuesExported': False}


def review():
    binding = capture()
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'acknowledged': False}


def receipt_path(run_id):
    if not isinstance(run_id, str) or not re.fullmatch('[a-z0-9][a-z0-9-]{0,39}', run_id):
        fail('bounded_fresh_observation_run_id_required')
    return BASE / run_id / 'result.json'


def acknowledge(expected, run_id):
    checked = review()
    if checked['reviewHash'] != expected:
        fail('exact_fresh_main_observation_review_required')
    path = receipt_path(run_id)
    for directory in (BASE.parent, BASE):
        if directory == BASE and not os.path.lexists(directory):
            directory.mkdir(mode=0o700)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('protected_observation_output_directory_required')
    path.parent.mkdir(mode=0o700)
    value = {**checked, 'acknowledged': True}
    with path.open('xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(encoded(value)); stream.flush(); os.fsync(stream.fileno())
    for directory in (path.parent, BASE):
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    return {'format': FORMAT, 'acknowledged': True, 'reviewHash': expected,
        'receiptFile': str(path), 'receiptSha256': sha(protected(path)),
        'databaseCalls': 0, 'providerCalls': 0, 'serviceActions': 0}


def validate_current(path, pin):
    path = Path(path)
    if path.parent.parent != BASE or path != receipt_path(path.parent.name):
        fail('fixed_current_main_observation_receipt_path_required')
    raw = protected(path)
    if not re.fullmatch('[0-9a-f]{64}', str(pin)) or sha(raw) != pin:
        fail('exact_owned_main_observation_receipt_required')
    value = json.loads(raw)
    if value.get('acknowledged') is not True or value.get('reviewHash') != sha(encoded(value.get('binding'))):
        fail('actual_acknowledged_main_observation_required')
    current = capture()
    if current != value['binding']:
        fail('main_or_peer_restart_requires_new_fresh_qualified_acknowledgement')
    return current


def qualify_scope(scope, path, pin):
    current = validate_current(path, pin)
    original = document(SELECTORS, SELECTORS_SHA)
    if scope.get('retainedSelectors') != original:
        fail('unchanged_original_retained_scope_required_before_acknowledgement')
    updated = copy.deepcopy(scope)
    updated['retainedSelectors'] = copy.deepcopy(current['currentSelectors'])
    updated['acknowledgedCurrentMainObservation'] = {'file': str(path), 'sha256': pin,
        'operatorSha256': current['operatorSha256'], 'originalSelectorsSha256': SELECTORS_SHA,
        'originalMainInvocation': current['originalMainInvocation'],
        'currentMainInvocation': current['currentMainInvocation']}
    return updated


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acknowledge'); parser.add_argument('--run-id')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main':
        fail('root_on_exact_main_required')
    if bool(args.acknowledge) != bool(args.run_id):
        fail('explicit_review_hash_and_fresh_run_id_required_together')
    print(json.dumps(acknowledge(args.acknowledge, args.run_id) if args.acknowledge else review(), sort_keys=True))
