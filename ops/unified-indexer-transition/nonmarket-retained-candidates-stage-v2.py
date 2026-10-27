#!/usr/bin/env python3
"""Retarget dormant candidates, adopting only the observed metadata replacement."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-nonmarket-retained-candidates-v2-20261022')
FORMAT = 'yunipals-nonmarket-retained-candidates-v2'
INSTALLER_SHA = '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b'
INSTALL_SHA = '87333b9a98b634722e6d6158a0fbf0049045c6edad51dacbb549754594d9fb98'
RETAINED_BINDING = '138df31eab5d349417c7798fab84e2debaf235cccf2e10031f308487b7cac286'
SCOPE_SHA = 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0'
OLD_ROOT = '/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d'

CURRENT_BINDING = '3e4f624b9184b859156188cc0543cc75163c9c93353d46d700a68b792cac9552'
RESTART_DIFF_SHA = '65a53bec9aba696019163b1f2b52b19a9f995012f4c800aae9430954dffe4fbc'
RESTART_RECORD_SHA = '91b98517e76f340aac8881b355d0b8c343cfc65a2aa64c8b21e3bc1827073332'
METADATA = 'yunipals-metadata.service'
# The original and current full snapshots remain pinned. These are the only
# observed leaf changes; even ExecStart is bound to its complete observed value.
REPLACEMENTS = (
    (('process', 'pid'), '2ac47b6661cba7ddba949fd6eefff46e58963688fbd9554da3733be3753b9872', '87e7127bb11dcc23cafd5eed3060d421c66fe07986790ee78f6082b055a13c7f'),
    (('process', 'startTicks'), 'a7fdf39172114a25a23f8481b9d5d71fbe58e32df8df8d0870a69ec0a191d92a', '4cad68633b2415d182c90bf7b4711db958461fbc6c2a0c15e139ed0127bb5105'),
    (('state', 'ExecStart'), '2d112c71cedca8e9983b2d758ad7bc5127d69cfaea3d8196d5562d937674d9b5', 'e0df71fd8a48362e3a22ab072f006d0722fd109f5d1d5cb2ee6849d574959479'),
    (('state', 'InvocationID'), '3ac31cb8cf64f2b36114e3fbabaf507c706f049d437779a6643188131a4a105e', 'f4ada0eb898431aced11f43d68ad1da1cad8883e019fbd71049bf00e94bb5865'),
    (('state', 'MainPID'), 'cc25660a4fa18a075bd8d96531960d6941e70c1865f5d90ed2fd88d604c82d54', 'e86f9be335b9ca5f3bc43287d3beeefa58eb987a6a191ec396a2ff8f27ade7b0'),
)


def fail(code):
    raise RuntimeError(code)


def modules():
    import hashlib
    import stat
    path = OPS / 'nonmarket-consumer-runtime-install-v1.py'
    for part in [*path.parents, path]:
        info = part.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_fixed_installer_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != INSTALLER_SHA:
        fail('exact_fixed_installer_required')
    i = types.ModuleType('nonmarket_installer'); i.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), i.__dict__)
    return i, i.shared()


def replace_once(raw, before, after):
    if raw.count(before) != 1:
        fail('exact_single_candidate_command_required')
    return raw.replace(before, after, 1)


def observed_retained_inputs(m, original, current):
    if m.sha(m.encoded(current)) != CURRENT_BINDING:
        fail('exact_observed_retained_snapshot_required')
    normalized = copy.deepcopy(current)
    for (section, field), old_sha, new_sha in REPLACEMENTS:
        old = original['retained'][METADATA][section][field]
        new = current['retained'][METADATA][section][field]
        if m.sha(m.encoded(old)) != old_sha or m.sha(m.encoded(new)) != new_sha:
            fail('exact_observed_metadata_replacement_required')
        normalized['retained'][METADATA][section][field] = old
    if normalized != original:
        fail('retained_inputs_changed_beyond_observed_metadata_replacement')
    # This operation stages files only. Neither the cause of the prior restart
    # nor any future replacement is inferred or authorized by this check.
    return {'unit': METADATA, 'observedDiffSha256': RESTART_DIFF_SHA,
            'managerRecordSha256': RESTART_RECORD_SHA,
            'previous': {'process': original['retained'][METADATA]['process'],
                         'invocation': original['retained'][METADATA]['state']['InvocationID']},
            'observed': {'process': current['retained'][METADATA]['process'],
                         'invocation': current['retained'][METADATA]['state']['InvocationID']},
            'initiatingActorKnown': False, 'futureReplacementAccepted': False}


def prepare(i, m):
    installed = i.installed(m, INSTALL_SHA)
    saved = json.loads(m.protected(m.BASE / 'result.json'))
    if saved.get('staged') is not True:
        fail('completed_original_retained_stage_required')
    original = {key: value for key, value in saved.items() if key != 'staged'}
    if m.sha(m.encoded(original)) != RETAINED_BINDING:
        fail('exact_original_retained_stage_required')
    current, originals = m.prepare()
    replacement = observed_retained_inputs(m, original, current)
    for name, raw in originals.items():
        if m.protected(m.BASE / name) != raw or m.sha(raw) != saved['files'][name]:
            fail('original_retained_payload_changed')
    metadata = replace_once(originals['yunipals-metadata.service.drop-in.candidate'],
        ('ExecStart=' + m.NODE + ' --import tsx ' + str(m.PROJECT / m.ENTRIES['yunipals-metadata.service']) + '\n').encode(),
        ('ExecStart=' + m.NODE + ' ' + str(i.TARGET / 'dist/metadata-worker.mjs') + '\n').encode())
    native = replace_once(originals['native-recovery.sh'],
        b' --import tsx scripts/unified-base-metadata.ts ',
        (' ' + str(i.TARGET / 'dist/unified-base-metadata.mjs') + ' ').encode())
    scope = m.document(OPS / 'consumer-operational-admission-v1.review.json', SCOPE_SHA)
    row = next(row for row in scope['units'] if row['unit'] == 'yunipals-api.service')
    api_before = row['dropInTemplate'].replace(OLD_ROOT, str(m.ROOT)).encode()
    api = replace_once(api_before, str(m.PROJECT / 'lib/api/server.ts').encode(),
                       str(i.TARGET / 'dist/main-api.mjs').encode())
    payloads = {'yunipals-metadata.service.drop-in.candidate': metadata,
                'native-recovery.sh': native, 'yunipals-api.service.drop-in.candidate': api}
    result = {'format': FORMAT, 'nonmarketInstallReceiptSha256': INSTALL_SHA,
              'artifactDigest': i.DIGEST, 'artifactFiles': installed['files'],
              'retainedStageBindingSha256': RETAINED_BINDING, 'retainedStageDirectory': str(m.BASE),
              'retainedCurrentBindingSha256': CURRENT_BINDING, 'observedMetadataReplacement': replacement,
              'retainedStageResultSha256': m.sha(m.protected(m.BASE / 'result.json')),
              'originalRetainedFiles': saved['files'], 'scopeSha256': SCOPE_SHA,
              'apiCandidateBasis': 'frozen_operational_template_actual_order_checked_before_admission',
              'retainedPrivateEnvironmentCopied': False, 'originalEnvironmentPathsAndValuesPreserved': True,
              'files': {name: m.sha(raw) for name, raw in payloads.items()},
              'serviceJobs': 0, 'providerRequests': 0, 'databaseCalls': 0, 'selected': False}
    return result, payloads


def stage(i, m, result, files):
    if os.path.lexists(BASE):
        fail('fresh_candidate_stage_required')
    i.directory(BASE.parent)
    BASE.mkdir(mode=0o700)
    m.write_new(BASE / 'intent.json', m.encoded(result))
    m.sync_directory(BASE); m.sync_directory(BASE.parent)
    for name, raw in files.items():
        m.write_new(BASE / name, raw, 0o700 if name.endswith('.sh') else 0o600)
    checked, checked_files = prepare(i, m)
    if checked != result or checked_files != files:
        fail('candidate_inputs_changed_during_staging')
    for name, raw in files.items():
        if m.protected(BASE / name) != raw:
            fail('candidate_output_changed_during_staging')
    raw = m.encoded({**result, 'staged': True})
    m.write_new(BASE / 'result.json', raw); m.sync_directory(BASE)
    return m.sha(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true'); parser.add_argument('--expected')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_main_required')
    os.umask(0o077)
    i, m = modules(); result, files = prepare(i, m); binding = m.sha(m.encoded(result))
    if args.stage and args.expected != binding:
        fail('fresh_exact_candidate_review_required')
    pin = stage(i, m, result, files) if args.stage else None
    print(json.dumps({**result, 'staged': args.stage, 'bindingSha256': binding,
                      'resultSha256': pin, 'directory': str(BASE)}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('candidate_stage_deadline')); signal.alarm(90)
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'candidate_stage_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
