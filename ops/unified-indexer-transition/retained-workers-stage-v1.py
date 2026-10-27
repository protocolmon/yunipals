#!/usr/bin/env python3
"""Stage retained worker selectors and a private native-migration env; never run them.

Only systemd property reads, protected file reads and Node's built-in env parser
are used. No application import, provider request, database connection or service
job is permitted by this helper. The resulting drop-ins remain outside systemd.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import types

FORMAT = 'yunipals-retained-workers-stage-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-retained-workers-stage-v1-20261022')
SOURCE = '41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
PROJECT = ROOT / 'apps/yunipals-indexer'
ARTIFACT = Path('/var/tmp/yunipals-runtime-41e5b5fd-20261021/install-result.json')
ARTIFACT_SHA = '0093abc56f8942b552a601d2eea925af04ebb834f01dd57ea596deaa8ee2ca42'
FACADE_SHA = '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81'
NODE = '/opt/node-v24.18.1/bin/node'
CLEAN = {'PATH': '/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
READ_SCHEMA = 'yunipals_ownership_35cdcb32_v3'
RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
PUBLIC = {
    'DATABASE_SCHEMA': 'unified_shadow_20261020_7e7375b0',
    'READ_DATABASE_SCHEMA': READ_SCHEMA,
    'OWNERSHIP_READ_MODE': 'unified',
    'OWNERSHIP_READ_SCHEMA': READ_SCHEMA,
    'OWNERSHIP_RELEASE_ID': RELEASE,
    'UNIFIED_INDEXER_RELEASE_ID': RELEASE,
    'YUNIPALS_PROJECTION_MODE': 'generation',
    'METADATA_SOURCE_MODE': 'archive',
    'BASE_METADATA_INGESTION': 'native',
}
RECOVERY_KEYS = (
    'DATABASE_URL', 'DATABASE_SCHEMA', 'READ_DATABASE_SCHEMA', 'BNB_DATABASE_SCHEMA',
    'METADATA_SOURCE_MODE', 'RARITY_READ_SOURCE', 'OWNERSHIP_READ_MODE',
    'OWNERSHIP_READ_SCHEMA', 'OWNERSHIP_RELEASE_ID', 'BNB_CONFIRMATIONS',
    'YUNIPALS_PROJECTION_MODE', 'BASE_METADATA_INGESTION',
    'UNIFIED_INDEXER_DATABASE_URL', 'UNIFIED_INDEXER_RELEASE_ID',
)
ENTRIES = {
    'yunipals-metadata.service': 'lib/metadata/worker.ts',
    'yunipals-islands-metadata.service': 'lib/islands/worker.ts',
    'yunipals-leaderboard.service': 'lib/leaderboard/worker.ts',
}
ENV_FILES = {
    'yunipals-metadata.service': ['/etc/yunipals-indexer/indexer.env', '/etc/yunipals-marketplace/production/indexer-rpc.env', '/etc/yunipals-metadata-cutover.env'],
    'yunipals-islands-metadata.service': ['/etc/yunipals-marketplace/production/indexer-rpc.env', '/etc/yunipals-indexer/islands-writer.env'],
    'yunipals-leaderboard.service': ['/etc/yunipals-indexer/indexer.env', '/etc/yunipals-marketplace/production/indexer-rpc.env', '/etc/yunipals-metadata-cutover.env', '/opt/yunipals-ops/query-capacity.env'],
}
ORIGINAL = {
    'yunipals-metadata.service': ('/opt/yunipals/releases/f0bd9a0/apps/yunipals-indexer', '/srv/yunipals-arena/operations/short-confirmations-20261015/yunipals-metadata/lib/metadata/worker.ts'),
    'yunipals-islands-metadata.service': ('/opt/yunipals-islands/releases/metadata-host-20261013-80dad7159358', '/srv/yunipals-arena/operations/short-confirmations-20261015/yunipals-islands-metadata/lib/islands/worker.ts'),
    'yunipals-leaderboard.service': ('/opt/yunipals/releases/5dd51e7/apps/yunipals-indexer', '/opt/yunipals/releases/5dd51e7/apps/yunipals-indexer/lib/leaderboard/worker.ts'),
}
PROPS = ('Id', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'User', 'Group',
         'WorkingDirectory', 'ExecStart', 'FragmentPath', 'DropInPaths', 'EnvironmentFiles')


def fail(code):
    raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def protected(path, limit=2_000_000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        fail('absolute_protected_path_required')
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        sticky_directory = stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not sticky_directory):
            fail('root_owned_unwritable_input_required')
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        fail('bounded_regular_file_required')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        fail('bounded_regular_file_required')
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail('input_changed_during_read')
    return raw


def document(path, pin):
    raw = protected(path)
    if sha(raw) != pin:
        fail('exact_input_hash_required')
    return json.loads(raw)


def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=8, env=CLEAN)
    if result.returncode or result.stderr or len(result.stdout) > 2_000_000:
        fail('bounded_private_command_failed')
    return result.stdout


def state(unit):
    raw = run(['/usr/bin/systemctl', 'show', unit, *['--property=' + k for k in PROPS]])
    value, files = {}, []
    for line in raw.decode().splitlines():
        key, sep, val = line.partition('=')
        if not sep or key not in PROPS or key in value:
            fail('exact_systemd_properties_required')
        if key == 'EnvironmentFiles':
            files.append(val)
        else:
            value[key] = val
    value['EnvironmentFiles'] = files
    if set(value) != set(PROPS) or value['Id'] != unit or value['ActiveState'] != 'active' or value['SubState'] != 'running' or not re.fullmatch('[1-9][0-9]*', value['MainPID']) or not re.fullmatch('[a-f0-9]{32}', value['InvocationID']):
        fail('running_original_worker_required')
    if value['User'] not in ('', 'root') or value['Group'] not in ('', 'root'):
        fail('retained_worker_identity_changed')
    cwd, entry = ORIGINAL[unit]
    if value['WorkingDirectory'] != cwd or re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) != [NODE + ' --import tsx ' + entry]:
        fail('retained_worker_command_changed')
    if value['FragmentPath'] != '/etc/systemd/system/' + unit:
        fail('retained_worker_fragment_changed')
    return value


def service_property(unit, key):
    obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in unit)
    value = json.loads(run(['/usr/bin/busctl', '--system', '--json=short', 'get-property', 'org.freedesktop.systemd1', obj, 'org.freedesktop.systemd1.Service', key]))
    if value.get('type') != 'as' or not isinstance(value.get('data'), list) or len(value['data']) > 512 or any(not isinstance(v, str) for v in value['data']):
        fail('bounded_service_environment_required')
    return value['data']


def parse_env(raw):
    # Accept the existing simple systemd format, then compare EVERY configured
    # value with the actual process. Unsupported quoting cannot silently drift.
    if len(raw) > 262144 or b'\0' in raw:
        fail('bounded_environment_required')
    result = {}
    for line in raw.decode().replace('\\\n', '').splitlines():
        line = line.strip()
        if not line or line.startswith(('#', ';')):
            continue
        key, sep, value = line.partition('=')
        if not sep or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key.strip()):
            fail('supported_environment_assignment_required')
        parts = shlex.split(value, comments=False, posix=True)
        if len(parts) > 1:
            fail('unambiguous_environment_value_required')
        result[key.strip()] = parts[0] if parts else ''
    return result


def ordered_files(entries):
    result = []
    for row in entries:
        matches = re.findall(r'(/[A-Za-z0-9_./@+\-]+) \(ignore_errors=(yes|no)\)', row)
        if ' '.join(p + ' (ignore_errors=' + optional + ')' for p, optional in matches) != row:
            fail('exact_environment_selector_shape_required')
        result.extend((p, optional == 'yes') for p, optional in matches)
    return result


def process(pid):
    raw = (Path('/proc') / pid / 'stat').read_bytes()
    return {'pid': int(pid), 'startTicks': int(raw[raw.rfind(b')') + 2:].split()[19]),
            'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def process_env(pid):
    with (Path('/proc') / pid / 'environ').open('rb') as stream:
        raw = stream.read(2_000_001)
    if len(raw) > 2_000_000:
        fail('bounded_process_environment_required')
    result = {}
    for item in raw.split(b'\0'):
        if not item:
            continue
        key, sep, value = item.decode().partition('=')
        if not sep or key in result:
            fail('unambiguous_process_environment_required')
        result[key] = value
    return result


def snapshot(unit):
    before = state(unit)
    identity = process(before['MainPID'])
    if any(service_property(unit, k) for k in ['PassEnvironment', 'UnsetEnvironment']):
        fail('explicit_retained_environment_required')
    inline = service_property(unit, 'Environment')
    env = {}
    for assignment in inline:
        key, sep, value = assignment.partition('=')
        if not sep or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key):
            fail('inline_assignment_required')
        env[key] = value
    selectors = ordered_files(before['EnvironmentFiles'])
    if selectors != [(p, False) for p in ENV_FILES[unit]]:
        fail('retained_private_file_order_changed')
    hashes = {}
    for name, _ in selectors:
        raw = protected(name, 262144)
        hashes[name] = sha(raw)
        env.update(parse_env(raw))
    actual = process_env(before['MainPID'])
    # Missing optional recovery keys must also match the real process. A key
    # injected outside the recorded selectors cannot silently become absent.
    if any(actual.get(k) != env.get(k) for k in set(env) | set(RECOVERY_KEYS)):
        fail('current_files_do_not_match_running_worker')
    if not env.get('DATABASE_URL'):
        fail('retained_database_configuration_required')
    paths = [before['FragmentPath'], *before['DropInPaths'].split()]
    if any(not p.startswith('/etc/systemd/system/' + unit + '.d/') for p in paths[1:]):
        fail('ordinary_retained_dropins_required')
    definitions = {p: sha(protected(p)) for p in paths}
    binding = {'unit': unit, 'state': before, 'process': identity, 'definitions': definitions,
               'environmentFileHashes': hashes, 'inlineEnvironmentSha256': sha(encoded(inline)),
               'configuredEnvironmentSha256': sha(encoded(env))}
    if state(unit) != before or process(before['MainPID']) != identity:
        fail('worker_changed_during_capture')
    return binding, env


def env_bytes(env):
    lines = []
    for key, value in sorted(env.items()):
        if not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) or any(c in value for c in '\n\r\0'):
            fail('single_line_environment_required')
        # These values have identical literal meaning to systemd and util.parseEnv.
        quote = "'" if "'" not in value else '"'
        if quote in value or (quote == '"' and '\\' in value):
            fail('portable_environment_quoting_required')
        lines.append(key + '=' + quote + value + quote)
    raw = ('\n'.join(lines) + '\n').encode()
    if parse_env(raw) != env:
        fail('systemd_environment_roundtrip_failed')
    return raw


def node_roundtrip(env, raw):
    js = "import{parseEnv}from'node:util';import{isDeepStrictEqual}from'node:util';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);if(!isDeepStrictEqual(parseEnv(v.text),v.env))process.exit(2);console.log('ok');"
    if run([NODE, '--input-type=module', '-e', js], encoded({'text': raw.decode(), 'env': env})) != b'ok\n':
        fail('node_environment_roundtrip_failed')


def selections(unit):
    result = dict(PUBLIC)
    if unit == 'yunipals-metadata.service':
        # Native RPC uses ordinary viem with no source headers. Keep existing
        # budget proxy's root route, never the restricted /unified transport.
        result['PONDER_RPC_URL_8453'] = 'http://127.0.0.1:19202/'
    return result


def dropin(unit, selectors):
    return ('# Prepared only; no service has been selected by this bundle.\n[Service]\n'
            'WorkingDirectory=' + str(PROJECT) + '\nEnvironmentFile=\n' +
            ''.join('EnvironmentFile=' + name + '\n' for name in ENV_FILES[unit]) +
            'EnvironmentFile=' + str(selectors) + '\nExecStart=\nExecStart=' + NODE +
            ' --import tsx ' + str(PROJECT / ENTRIES[unit]) + '\n').encode()


def migration_command():
    env = str(BASE / 'native-recovery.env')
    return ('#!/bin/sh\nset -eu\ncase "${1-}" in native-adopt|native-refresh|native-provenance) ;; *) exit 64 ;; esac\n'
            '[ "$#" -eq 1 ] || exit 64\ncd ' + str(PROJECT) + '\n'
            'exec /usr/bin/env -i PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin LANG=C.UTF-8 TZ=UTC ' +
            NODE + ' --env-file=' + env + ' --import tsx scripts/unified-base-metadata.ts --env-file ' + env + ' --command "$1"\n').encode()


def artifact():
    path = OPS / 'consumer-final-runtime-v1.py'
    raw = protected(path)
    if sha(raw) != FACADE_SHA:
        fail('accepted_final_artifact_facade_required')
    module = types.ModuleType('retained_worker_artifact')
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    adapter = types.SimpleNamespace(document=document, protected=protected, sha=sha)
    receipt, manifest, _ = module.accepted(adapter, ARTIFACT, ARTIFACT_SHA)
    rows = {r['path']: r for r in manifest['files']}
    paths = [*ENTRIES.values(), 'scripts/unified-base-metadata.ts', 'scripts/metadata/recovery.ts']
    for rel in paths:
        row = rows['apps/yunipals-indexer/' + rel]
        raw = protected(PROJECT / rel)
        if sha(raw) != row['sha256'] or len(raw) != row['bytes']:
            fail('installed_worker_entrypoint_changed')
    return receipt


def prepare():
    artifact()
    snapshots, payloads = {}, {}
    for unit in ENTRIES:
        binding, original = snapshot(unit)
        snapshots[unit] = binding
        selector_name = unit.removesuffix('.service') + '.selectors.env'
        payloads[selector_name] = env_bytes(selections(unit))
        payloads[unit + '.drop-in.candidate'] = dropin(unit, BASE / selector_name)
        if unit == 'yunipals-metadata.service':
            merged = {**original, **selections(unit)}
            raw = env_bytes(merged)
            node_roundtrip(merged, raw)
            payloads['native-recovery.env'] = raw
            # Missing original optional keys stay missing in both consumers;
            # no new URL, credential or source-reader role is fabricated.
            recovery = {key: sha(merged[key].encode()) if key in merged else None for key in RECOVERY_KEYS}
    payloads['native-recovery.sh'] = migration_command()
    summary = {'format': FORMAT, 'sourceDigest': SOURCE, 'artifactReceiptSha256': ARTIFACT_SHA,
               'retained': snapshots, 'publicSelectors': {u: selections(u) for u in ENTRIES},
               'recoveryKeyHashes': recovery, 'recoveryKeys': list(RECOVERY_KEYS),
               'files': {name: sha(raw) for name, raw in payloads.items()},
               'serviceJobs': 0, 'databaseCalls': 0, 'providerRequests': 0,
               'privateValuesExported': False, 'applicationImported': False,
               'selected': False, 'sourceReceiptRequiredAtFinalSwitch': True}
    return summary, payloads


def write_new(path, raw, mode=0o600):
    with path.open('xb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def stage(summary, payloads):
    if os.path.lexists(BASE):
        fail('fresh_private_stage_directory_required')
    parent = BASE.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
        fail('protected_backup_parent_required')
    BASE.mkdir(mode=0o700)
    # Intent is durable before any credential copy; an interrupted partial stage
    # is never overwritten or presented as complete.
    write_new(BASE / 'intent.json', encoded(summary))
    sync_directory(BASE)
    sync_directory(BASE.parent)
    for name, raw in payloads.items():
        write_new(BASE / name, raw, 0o700 if name.endswith('.sh') else 0o600)
    for unit, saved in summary['retained'].items():
        current, _ = snapshot(unit)
        if current != saved:
            fail('retained_inputs_changed_during_staging')
    artifact()
    write_new(BASE / 'result.json', encoded({**summary, 'staged': True}))
    sync_directory(BASE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_main_required')
    os.umask(0o077)
    summary, payloads = prepare()
    if args.stage:
        stage(summary, payloads)
    print(json.dumps({'format': FORMAT, 'staged': args.stage, 'directory': str(BASE),
                      'bindingSha256': sha(encoded(summary)), 'files': summary['files'],
                      'privateValuesExported': False, 'selected': False,
                      'providerRequests': 0, 'databaseCalls': 0, 'serviceJobs': 0}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('staging_deadline'))
    signal.alarm(90)
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'retained_worker_staging_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code, 'privateValuesExported': False}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
