#!/usr/bin/env python3
"""Stage v4 read selectors and corrected metadata commands; never select/start."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022')
FORMAT = 'yunipals-metadata-readview-v4-candidates-v1'
INSTALLER_SHA = '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab'
PARENT_SHA = '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486'
PARENT_RESULT_SHA = '5a2b99e7223f8d5e6f930eb16402bf0fd1453d937815ab753886e9b6f58dda13'
PLAN_SHA = '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29'
STAKING_SHA = '15ab2bda3468ad8758d112f05111d72815c0e7cefa1b23ee7395fe12dddcae55'
OLD_SCHEMA = 'yunipals_ownership_35cdcb32_v3'
SCHEMA = 'yunipals_ownership_35cdcb32_v4'
OLD_ID = '0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc'
IDENTITY = '0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d'


def fail(code):
    raise RuntimeError(code)


def load(name, pin):
    path = OPS / name
    for part in [*path.parents, path]:
        info = part.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_fixed_helper_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != pin:
        fail('exact_fixed_helper_required')
    value = types.ModuleType(name.replace('.', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def replace_once(raw, before, after):
    if raw.count(before) != 1:
        fail('exact_single_candidate_value_required')
    return raw.replace(before, after, 1)


def selectors(value):
    result = dict(value)
    for key in ('OWNERSHIP_READ_SCHEMA', 'READ_DATABASE_SCHEMA'):
        if result.get(key) != OLD_SCHEMA:
            fail('exact_previous_read_schema_required')
        result[key] = SCHEMA
    return result


def render(i, m, p, installed, previous, original_files, parent_files, scope, plan, staking, install_pin):
    if (plan.get('readSchema') != SCHEMA or plan.get('readIdentity') != IDENTITY
            or plan.get('artifactDigest') != i.DIGEST or plan.get('previousReadIdentity') != OLD_ID):
        fail('exact_v4_readview_plan_required')
    files = {}
    for unit in m.ENTRIES:
        selector_name = unit.removesuffix('.service') + '.selectors.env'
        files[selector_name] = m.env_bytes(selectors(m.parse_env(original_files[selector_name])))
        name = unit + '.drop-in.candidate'
        raw = parent_files[name] if unit == 'yunipals-metadata.service' else original_files[name]
        raw = replace_once(raw, str(m.BASE / selector_name).encode(), str(BASE / selector_name).encode())
        if unit == 'yunipals-metadata.service':
            raw = replace_once(raw, str(p.modules()[0].TARGET / 'dist/metadata-worker.mjs').encode(),
                               str(i.TARGET / 'dist/metadata-worker.mjs').encode())
        files[name] = raw
    original_env = m.parse_env(original_files['native-recovery.env'])
    native_env = selectors(original_env)
    files['native-recovery.env'] = m.env_bytes(native_env)
    m.node_roundtrip(native_env, files['native-recovery.env'])
    old_i, _ = p.modules()
    native = replace_once(parent_files['native-recovery.sh'],
                          str(old_i.TARGET / 'dist/unified-base-metadata.mjs').encode(),
                          str(i.TARGET / 'dist/unified-base-metadata.mjs').encode())
    old_env = str(m.BASE / 'native-recovery.env').encode()
    if native.count(old_env) != 2:
        fail('both_native_env_arguments_required')
    files['native-recovery.sh'] = native.replace(old_env, str(BASE / 'native-recovery.env').encode())
    for row in scope['units']:
        unit = row['unit']
        name = unit.removesuffix('.service') + '.ownership.env'
        files[name] = m.env_bytes(selectors(row['publicSelectors']))
        raw = (parent_files[unit + '.drop-in.candidate'] if unit == 'yunipals-api.service'
               else row['dropInTemplate'].replace(p.OLD_ROOT, str(m.ROOT)).encode())
        files[unit + '.drop-in.candidate'] = replace_once(
            raw, ('EnvironmentFile=' + row['publicSelectorOverlay'] + '\n').encode(),
            ('EnvironmentFile=' + str(BASE / name) + '\n').encode())
    # This is the fixed previously reviewed template, NOT an attestation of a
    # live staking unit. Final installation must compare its actual original.
    if staking.count(OLD_SCHEMA.encode()) != 1 or staking.count(OLD_ID.encode()) != 1:
        fail('exact_staking_template_selectors_required')
    files['staking-support-v4.service.candidate'] = staking.replace(OLD_SCHEMA.encode(), SCHEMA.encode()).replace(OLD_ID.encode(), IDENTITY.encode())
    changed = {key for key in original_env.keys() | native_env.keys() if original_env.get(key) != native_env.get(key)}
    if changed != {'OWNERSHIP_READ_SCHEMA', 'READ_DATABASE_SCHEMA'}:
        fail('only_two_native_environment_changes_required')
    result = {'format': FORMAT, 'artifactDigest': i.DIGEST,
              'installReceiptSha256': install_pin, 'artifactFiles': installed['files'],
              'parentCandidateReceiptSha256': PARENT_RESULT_SHA, 'planSha256': PLAN_SHA,
              'previousReadSchema': OLD_SCHEMA, 'readSchema': SCHEMA, 'readIdentity': IDENTITY,
              'originalRetainedFileHashes': previous['originalRetainedFiles'],
              'privateEnvironmentChangedKeys': sorted(changed), 'privateValuesExported': False,
              'files': {name: m.sha(raw) for name, raw in files.items()},
              'serviceJobs': 0, 'databaseCalls': 0, 'providerRequests': 0,
              'loginOrRoleChanges': False, 'selected': False, 'previousCandidatesModified': False,
              'stakingActualUnitValidated': False, 'finalAdmissionAndRegenerationRequired': True}
    return result, files


def prepare(i, p, install_pin):
    if not re.fullmatch('[a-f0-9]{64}', install_pin) or install_pin == '0' * 64:
        fail('actual_install_receipt_hash_required')
    old_i, m = p.modules()
    installed = i.installed(m, install_pin)
    previous = m.document(p.BASE / 'result.json', PARENT_RESULT_SHA)
    fresh, parent_files = p.prepare(old_i, m)
    if previous != {**fresh, 'staged': True}:
        fail('acknowledged_parent_candidate_inputs_changed')
    for name, raw in parent_files.items():
        if m.protected(p.BASE / name) != raw:
            fail('previous_candidate_bytes_changed')
    original_files = {}
    for name, pin in previous['originalRetainedFiles'].items():
        raw = m.protected(m.BASE / name)
        if m.sha(raw) != pin:
            fail('original_retained_candidate_changed')
        original_files[name] = raw
    scope = m.document(OPS / 'consumer-operational-admission-v1.review.json', p.SCOPE_SHA)
    plan = m.document(OPS / 'metadata-readview-v4-plan.review.json', PLAN_SHA)
    staking = m.protected(OPS / 'staking-support-native-v1.service.example')
    if m.sha(staking) != STAKING_SHA:
        fail('exact_prior_staking_template_required')
    result, files = render(i, m, p, installed, previous, original_files, parent_files, scope, plan, staking, install_pin)
    return m, result, files


def stage(i, p, m, result, files, install_pin):
    if os.path.lexists(BASE):
        fail('fresh_candidate_directory_required')
    i.directory(BASE.parent); BASE.mkdir(mode=0o700)
    m.write_new(BASE / 'intent.json', m.encoded(result))
    m.sync_directory(BASE); m.sync_directory(BASE.parent)
    for name, raw in files.items():
        m.write_new(BASE / name, raw, 0o700 if name.endswith('.sh') else 0o600)
    _, check, checked_files = prepare(i, p, install_pin)
    if check != result or checked_files != files:
        fail('candidate_inputs_changed_during_stage')
    for name, raw in files.items():
        if m.protected(BASE / name) != raw:
            fail('candidate_payload_changed_during_stage')
    raw = m.encoded({**result, 'staged': True})
    m.write_new(BASE / 'result.json', raw); m.sync_directory(BASE)
    return m.sha(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-receipt-sha', required=True)
    parser.add_argument('--stage', action='store_true'); parser.add_argument('--expected')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_host_required')
    os.umask(0o077)
    i = load('metadata-normalization-runtime-install-v1.py', INSTALLER_SHA)
    p = load('nonmarket-retained-candidates-stage-v2.py', PARENT_SHA)
    m, result, files = prepare(i, p, args.install_receipt_sha)
    binding = m.sha(m.encoded(result))
    if args.stage and args.expected != binding:
        fail('fresh_candidate_review_hash_required')
    receipt = stage(i, p, m, result, files, args.install_receipt_sha) if args.stage else None
    print(json.dumps({**result, 'bindingSha256': binding, 'staged': args.stage,
                      'resultSha256': receipt, 'directory': str(BASE)}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('bounded_candidate_stage_deadline')); signal.alarm(120)
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'candidate_stage_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
