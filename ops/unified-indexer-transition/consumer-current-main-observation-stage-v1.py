#!/usr/bin/env python3
"""Publish exactly two public observer files, then qualify installed default mode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PRIMITIVES = Path('/var/backups/yunipals-current-feature-final-v2-source-input-20261023/ops/unified-indexer-transition/current-feature-final-public-stage-v2.py')
PRIMITIVES_SHA = '7bf2ef8969cb4694af40f9ae018c00b29c203685b9bb4930a09bb61cf1cdfc72'
FORMAT = 'yunipals-current-main-observation-public-stage-v1'
HELPER = 'consumer-current-main-observation-v1.py'
OBSERVER = 'consumer-retained-selectors-observe-v1.py'
PAYLOAD = {HELPER: 'a57dbbf7d6ecf4e713150c26e930a647b9573caf95602712073bac8ff6d811b3',
    OBSERVER: '066c74a83a2933544b2e204c253e10756bc8cb4e8e9665e63123ddc29b273350'}
SOURCE_RUNTIME = Path('/var/backups/yunipals-source6-normal-replay-successor-20261022/runtime.json')
SOURCE_RUNTIME_SHA = 'e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'
SOURCE = 'yunipals-unified-source6-free-v2.service'
API = 'yunipals-booster-api.service'
MAIN = 'yunipals-api.service'
EXPECTED = {
    MAIN: {'pid': 1437990, 'invocation': '29aaa668db3d4e0cb9ebdddf851324d6'},
    API: {'pid': 1824982, 'invocation': '7858a3f608874abb935e635abc69c1d4'},
    SOURCE: {'pid': 716994, 'invocation': 'c3463c9a2e1240e8890e318ba1360cf4',
        'startTicks': 6611794751, 'startMonotonicMicroseconds': 66117947533239},
}
API_UNIT_SHA = '5ae76b4b54b359dc63cd9b990b227a32e4c984255308e1cd90982fa7de146414'
API_BUNDLE_SHA = '41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73'
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
PROC = Path('/proc')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def module(raw, path):
    value = types.ModuleType('readonly_stage_' + Path(path).stem.replace('-', '_'))
    value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def primitives():
    # Bootstrap only from its exact already reviewed public source. Its read()
    # and exclusive() retain protected ancestry, single-link and inode checks.
    for path in [*reversed(PRIMITIVES.parents), PRIMITIVES]:
        info = path.lstat()
        need(info.st_uid == info.st_gid == 0 and not stat.S_ISLNK(info.st_mode)
            and not info.st_mode & 0o022, 'protected_existing_stage_primitives_required')
    raw = PRIMITIVES.read_bytes()
    need(len(raw) < 100000 and sha(raw) == PRIMITIVES_SHA, 'exact_existing_stage_primitives_required')
    return module(raw, PRIMITIVES)


def run(argv, timeout=8):
    result = subprocess.run(argv, capture_output=True, timeout=timeout, env=CLEAN)
    need(not result.returncode and not result.stderr and len(result.stdout) <= 200000,
        'bounded_readonly_observer_command_required')
    return result.stdout


def identities(p):
    saved = p.read(SOURCE_RUNTIME)
    need(sha(saved) == SOURCE_RUNTIME_SHA and json.loads(saved)['runtime'] == EXPECTED[SOURCE],
        'same_original_normal_source_receipt_required')
    result = {}
    keys = 'Id,LoadState,ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic,Job,FragmentPath,DropInPaths,ControlGroup'
    for unit, expected in EXPECTED.items():
        raw = run(['/usr/bin/systemctl', 'show', '--all', unit, '--property=' + keys]).decode()
        props = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
        need(props.get('Id') == unit and props.get('LoadState') == 'loaded'
            and props.get('ActiveState') == 'active' and props.get('SubState') == 'running'
            and props.get('MainPID') == str(expected['pid']) and props.get('InvocationID') == expected['invocation']
            and props.get('Job') in {'', '0'} and props.get('ControlGroup') == '/system.slice/' + unit
            and props.get('FragmentPath') == '/etc/systemd/system/' + unit,
            'exact_retained_main_booster_and_source_identities_required')
        proc = PROC / str(expected['pid'])
        def ticks():
            text = (proc / 'stat').read_text()
            return int(text[text.rfind(')') + 2:].split()[19])
        before = ticks()
        need('startTicks' not in expected or before == expected['startTicks'], 'exact_source_process_start_required')
        need('startMonotonicMicroseconds' not in expected or
            props['ExecMainStartTimestampMonotonic'] == str(expected['startMonotonicMicroseconds']),
            'exact_source_manager_start_required')
        definitions = {name: sha(p.read(Path(name))) for name in
            [props['FragmentPath'], *props['DropInPaths'].split()]}
        command_sha = sha((proc / 'cmdline').read_bytes())
        if unit == API:
            need(not props['DropInPaths'] and definitions[props['FragmentPath']] == API_UNIT_SHA,
                'same_current_booster_API_definition_required')
            bundle = Path('/opt/yunipals-unified/booster-api-releases') / API_BUNDLE_SHA / 'booster-api.mjs'
            need(sha(p.read(bundle)) == API_BUNDLE_SHA, 'same_current_booster_API_runtime_required')
        need(ticks() == before, 'retained_actor_changed_during_identity_check')
        result[unit] = {'pid': expected['pid'], 'invocation': expected['invocation'],
            'startTicks': before, 'managerStartMonotonic': props['ExecMainStartTimestampMonotonic'],
            'definitionHashes': definitions, 'commandSha256': command_sha}
    return result


def summary(checked):
    value = checked['binding']
    return {'reviewHash': checked['reviewHash'], 'operatorSha256': value['operatorSha256'],
        'originalMainInvocation': value['originalMainInvocation'], 'currentMainInvocation': value['currentMainInvocation'],
        'originalMainMismatchExplicit': value['originalMainIdentityMismatchExplicit'],
        'mainRuntimeEquivalence': value['mainRuntimeEquivalence'],
        'currentPrivateInputBindingSha256': sha(encoded(value['currentMainInputs'])),
        'currentPrivateFileCount': len(value['currentMainInputs']['orderedPrivateFileHashes']),
        'actualProcessEnvironmentCompared': value['currentMainInputs']['actualProcessEnvironmentCompared'],
        'collectorAndIslandsExactOriginalObservations': value['collectorAndIslandsExactOriginalObservations'],
        'sourceReadinessQualified': value['sourceReadinessQualified'],
        'acknowledged': checked['acknowledged'], 'databaseCalls': value['databaseCalls'],
        'providerCalls': value['providerCalls'], 'serviceActions': value['serviceActions'],
        'privateValuesExported': value['privateValuesExported']}


def review(source):
    source = Path(source); p = primitives(); p.directory(source); p.directory(OPS)
    blobs = {name: p.read(source / name) for name in PAYLOAD}
    need(all(sha(blobs[name]) == pin for name, pin in PAYLOAD.items()), 'exact_two_public_sources_required')
    helper = module(blobs[HELPER], source / HELPER)
    dependencies = {}
    for name, pin in helper.DEPS.items():
        if name == OBSERVER:
            need(pin == PAYLOAD[OBSERVER], 'same_pending_public_observer_dependency_required')
            continue
        need(sha(p.read(OPS / name)) == pin, 'existing_public_observer_dependency_changed')
        dependencies[name] = pin
    for name, pin in [(helper.SELECTORS, helper.SELECTORS_SHA), (helper.ACCEPTED, helper.ACCEPTED_SHA)]:
        need(sha(p.read(OPS / name)) == pin, 'existing_historical_baseline_record_changed')
        dependencies[name] = pin
    rows = []
    for name, pin in PAYLOAD.items():
        path = OPS / name; present = os.path.lexists(path)
        if present:
            need(p.read(path) == blobs[name] and stat.S_IMODE(path.stat().st_mode) == 0o644,
                'existing_source_must_be_exact_root0644')
        rows.append({'path': str(path), 'name': name, 'sha256': pin, 'bytes': len(blobs[name]), 'alreadyPresent': present})
    before = identities(p)
    # Only the prospective public loader receives its exact pending observer.
    # This proves source qualification, not installed default execution.
    observer = module(blobs[OBSERVER], source / OBSERVER)
    original_load = helper.load
    helper.load = lambda name: observer if name == OBSERVER else original_load(name)
    observation = summary(helper.review())
    need(observation['acknowledged'] is False and observation['databaseCalls'] ==
        observation['providerCalls'] == observation['serviceActions'] == 0,
        'only_default_readonly_qualification_required')
    need(identities(p) == before, 'main_API_or_source_changed_during_stage_review')
    binding = {'format': FORMAT, 'stagerSha256': sha(Path(__file__).read_bytes()),
        'sourceDirectory': str(source), 'files': rows, 'existingDependenciesAndBaselines': dependencies,
        'stagePrimitivesSha256': PRIMITIVES_SHA, 'runtimeIdentities': before,
        'sourceQualification': observation, 'installedDefaultAlreadyQualified': False,
        'sourceRuntimeReceiptSha256': SOURCE_RUNTIME_SHA,
        'sourceOnlyStageScope': True, 'sourceReadinessClaimed': False,
        'databaseCalls': 0, 'providerCalls': 0, 'serviceActions': 0, 'privateAcknowledgementWrites': 0}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'staged': False}


def installed_default():
    # Deliberately no --acknowledge, --run-id, env file or entrypoint import.
    raw = run(['/usr/bin/python3', '-I', '-B', str(OPS / HELPER)], timeout=45)
    value = json.loads(raw)
    need(value.get('acknowledged') is False, 'installed_default_must_not_acknowledge')
    return summary(value)


def apply(source, expected):
    checked = review(source)
    need(checked['reviewHash'] == expected, 'exact_fresh_two_source_review_required')
    p = primitives()
    for row in checked['binding']['files']:
        if row['alreadyPresent']: continue
        raw = p.read(Path(source) / row['name'])
        need(sha(raw) == row['sha256'], 'public_source_changed_after_review')
        need(identities(p) == checked['binding']['runtimeIdentities'], 'retained_actor_changed_before_publication')
        p.exclusive(Path(row['path']), raw)
    observation = installed_default()
    need(observation == checked['binding']['sourceQualification'], 'installed_default_differs_from_reviewed_source_qualification')
    need(identities(p) == checked['binding']['runtimeIdentities'], 'retained_actor_changed_after_default_qualification')
    for name, pin in PAYLOAD.items():
        path = OPS / name
        need(sha(p.read(path)) == pin and stat.S_IMODE(path.stat().st_mode) == 0o644,
            'both_exact_root0644_sources_required')
    return {'format': FORMAT, 'approvedReviewHash': expected, 'staged': True,
        'publicFiles': PAYLOAD, 'installedDefaultQualified': True, 'installedDefault': observation,
        'runtimeIdentitiesUnchanged': True, 'sourceReadinessClaimed': False,
        'databaseCalls': 0, 'providerCalls': 0, 'serviceActions': 0, 'privateAcknowledgementWrites': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True); parser.add_argument('--apply')
    args = parser.parse_args()
    need(os.geteuid() == 0 and os.uname().nodename == 'yunipals-main', 'root_on_exact_main_required')
    print(json.dumps(apply(args.source, args.apply) if args.apply else review(args.source), sort_keys=True))
