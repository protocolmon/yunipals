#!/usr/bin/env python3
"""Finite scanner/deployment inventory. No scanner execution or retirement authority."""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import socket
import stat
import subprocess
import time

FORMAT = 'yunipals-scanner-inventory-gate-v1'
HERE = Path(__file__).absolute().parent
REPOSITORY_MANIFEST = HERE / 'scanner-inventory-gate-v1.repository.json'
REPOSITORY_MANIFEST_SHA = '24824a9faa43cc8bb28c84774be2c1205c2bb047f3a03a8fa47d56dbe56d2d01'
BASE = Path('/var/backups/yunipals-scanner-inventory-v1-20261024')
HOST = 'yunipals-main'
CLASSES = {'shared-ponder', 'shared-solana', 'legacy-recurring-retire', 'bounded-market-admission',
           'bounded-operator-test', 'transport-proxy', 'non-scanning-consumer', 'deployment-review'}
SOURCE_ROOTS = ('apps', 'packages', 'scripts', 'ops', '.github')
SKIP = {'.git', 'node_modules', 'artifacts', 'dist', 'build', 'coverage', 'vendor', '.vercel', '.ponder',
        '.vite', '.vite-temp', '.codex', '.agents', '.cache', '.local', 'frozen-runtime-source', 'frozen-baseline-source',
        'out', 'out-batch', 'out-permit'}
SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sh', '.json', '.yaml', '.yml', '.service', '.timer', '.example', '.conf'}
SELF_FILES = {'ops/unified-indexer-transition/scanner-inventory-gate-v1' + suffix
              for suffix in ('.py', '.test.py', '.repository.json')}
PATTERNS = {
    'log-discovery': r'\b(?:getLogs|eth_getLogs|getContractEvents|createEventFilter|createContractEventFilter|getFilterLogs|getFilterChanges|watchEvent|watchContractEvent|queryFilter|getPastEvents)\b',
    'solana-discovery': r'\b(?:getAssetsByGroup|getAssetBatch|getProgramAccounts|getTokenAccountsByOwner|getSignaturesForAddress)\b',
    'framework-discovery': r'\bcreateConfig\s*\(|ponder/dist/(?:esm/)?bin/ponder',
    'activation-command': r'\b(?:systemctl|supervisorctl|pm2|crontab)\b|\bdocker\s+(?:run|compose|start)\b',
    'deployment': r'(?m)^\s*ExecStart(?:Pre|Post)?\s*=|\bponder\s+(?:start|dev)\b|\b(?:lib/(?:bnb|solana|metadata|islands)/worker|src/arena/live/(?:projector|recovery)|lib/boosters/artwork-worker)\b',
}
# Config/dispatch files can start discovery without containing a direct log call.
DISPATCH = {
    'apps/yunipals-indexer/ponder.config.ts', 'apps/yunipals-indexer/ponder.boosters.config.ts',
    'apps/yunipals-indexer/ponder.islands.config.ts', 'apps/yunipals-indexer/lib/metadata/worker.ts',
    'apps/yunipals-indexer/scripts/sync-base-metadata-events.ts', 'apps/yunipals-market-api/package.json',
    'apps/yunipals-market-api/src/worker.ts', 'apps/yunipals-market-api/src/activity/collectionWorker.ts',
    'apps/yunipals-market-api/src/arena/live/projectorWorker.ts', 'ops/unified-indexer/run-indexer.sh',
}
PROPERTIES = ('Id', 'Names', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'MainPID', 'ControlPID', 'ControlGroup',
    'FragmentPath', 'DropInPaths', 'Restart', 'NRestarts', 'RestartUSec', 'ExecStart', 'ExecStartPre', 'ExecStartPost',
    'ExecStop', 'ExecStopPost', 'ExecCondition', 'OnFailure', 'OnSuccess', 'Wants', 'Requires', 'Requisite', 'BindsTo',
    'PartOf', 'WantedBy', 'RequiredBy', 'UpheldBy', 'Triggers', 'TriggeredBy', 'Transient', 'EnvironmentFiles')
UNIT = re.compile(r'[A-Za-z0-9_.:@\\-]+\.(?:service|timer|socket|path)\Z')


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def is_pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def safe_read(path, maximum=8_000_000, private=False):
    """No symlink following, stable fd and pathname, bounded regular bytes."""
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         'bounded_single_regular_inventory_input_required')
    if private:
        for parent in [*path.parents, path]:
            s = parent.lstat()
            need(s.st_uid == s.st_gid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
                 'protected_root_inventory_input_required')
        need(before.st_mode & 0o077 == 0, 'root_private_inventory_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, maximum + 1)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(identity(before) == identity(os.fstat(fd)) == identity(path.lstat()) and len(raw) == before.st_size,
             'inventory_input_changed_during_read')
        return raw
    finally: os.close(fd)


def repository_candidates(root):
    need(stat.S_ISDIR(root.lstat().st_mode) and not root.is_symlink(), 'non_symlink_repository_directory_required')
    for name in SOURCE_ROOTS:
        source = root / name
        if os.path.lexists(source):
            need(stat.S_ISDIR(source.lstat().st_mode) and not source.is_symlink(),
                 'non_symlink_declared_source_directory_required')
    out = {}; files = total = 0
    for folder, dirs, names in os.walk(root, followlinks=False):
        relative_folder = Path(folder).relative_to(root)
        if relative_folder == Path('.'):
            dirs[:] = sorted(d for d in dirs if d in SOURCE_ROOTS)
            names = [name for name in names if name == 'package.json']
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith('out-') and
                         not d.startswith('.restored-') and
                         not (relative_folder.parts[:1] == ('apps',) and len(relative_folder.parts) == 2 and d == 'public'))
        for directory in dirs:
            need(not (Path(folder) / directory).is_symlink(), 'source_directory_symlink_requires_explicit_inventory_review')
        for name in sorted(names):
            path = Path(folder) / name; relative = path.relative_to(root).as_posix()
            if relative in SELF_FILES or path.suffix not in SUFFIXES or name.endswith(('lock.json', 'lock.yaml')): continue
            if path.suffix == '.json' and name != 'package.json' and not name.startswith('ecosystem'):
                continue  # Data/evidence/manifests are independently authenticated by their owning runtime.
            need(not path.is_symlink(), 'source_symlinks_require_explicit_inventory_review')
            raw = safe_read(path); total += len(raw); files += 1
            need(files <= 20000 and total <= 256_000_000, 'bounded_repository_inventory_exceeded')
            try: text = raw.decode('utf-8')
            except UnicodeError: raise RuntimeError('source_inventory_requires_UTF8')
            evidence = []
            for kind, pattern in PATTERNS.items():
                for match in re.finditer(pattern, text):
                    evidence.append({'kind': kind, 'line': text.count('\n', 0, match.start()) + 1,
                                     'matchSha256': sha(match.group().encode())})
            if relative in DISPATCH: evidence.append({'kind': 'explicit-dispatch', 'line': 0, 'matchSha256': sha(relative.encode())})
            if evidence:
                out[relative] = {'path': relative, 'sha256': sha(raw), 'bytes': len(raw), 'evidence': sorted(evidence, key=encoded)}
    return {'filesExamined': files, 'bytesExamined': total, 'candidates': out}


def validate_repository(root, manifest):
    need(manifest['format'] == FORMAT + '-repository' and manifest['patterns'] == PATTERNS and
         manifest['sourceRoots'] == list(SOURCE_ROOTS) and manifest['rootFiles'] == ['package.json'] and
         manifest['nonPackageJsonExcluded'] is True and manifest['appPublicAssetsExcluded'] is True and
         manifest['generatedDirectoriesExcluded'] == sorted(SKIP) and manifest['explicitDispatch'] == sorted(DISPATCH),
         'exact_reviewed_inventory_detection_scope_required')
    rows = manifest['entries']; need(isinstance(rows, list) and len(rows) <= 2000, 'finite_reviewed_scanner_entries_required')
    reviewed = {}
    for row in rows:
        need(set(row) == {'path', 'sha256', 'bytes', 'evidence', 'classes', 'reason', 'functionScopes'} and row['path'] not in reviewed and
             row['classes'] and set(row['classes']) <= CLASSES and len(row['classes']) == len(set(row['classes'])) and
             isinstance(row['reason'], str) and 10 <= len(row['reason']) <= 600, 'explicit_scanner_classification_required')
        need(type(row['functionScopes']) is list and all(set(scope) == {'symbol', 'class', 'evidenceLines', 'contract'} and
             scope['class'] in row['classes'] and isinstance(scope['symbol'], str) and scope['evidenceLines'] and
             all(type(line) is int and line > 0 for line in scope['evidenceLines']) and isinstance(scope['contract'], str)
             for scope in row['functionScopes']), 'explicit_mixed_function_classification_required')
        reviewed[row['path']] = {k: row[k] for k in ('path', 'sha256', 'bytes', 'evidence')}
    current = repository_candidates(root)
    if current['candidates'] != reviewed:
        changed = sorted(path for path in set(current['candidates']) | set(reviewed)
                         if current['candidates'].get(path) != reviewed.get(path))
        error = RuntimeError('unreviewed_new_changed_or_removed_scanner_or_deployment_entrypoint')
        error.publicInventoryPaths = changed
        raise error
    return {'format': FORMAT + '-repository-result', 'validated': True, 'candidateFiles': len(rows),
            'classCounts': dict(sorted(Counter(c for row in rows for c in row['classes']).items())),
            'inventorySha256': sha(encoded(current['candidates'])), 'filesExamined': current['filesExamined'],
            'productionSingleIngestorAccepted': False, 'legacyScannersRetired': False,
            'hostCaptured': False, 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0}


def command(argv, timeout=10, maximum=8_000_000):
    need(argv[0] == '/usr/bin/systemctl', 'systemd_read_only_inventory_command_required')
    need(argv[1] in {'list-units', 'list-unit-files', 'show'}, 'read_only_systemd_inventory_verb_required')
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    need(result.returncode == 0 and not result.stderr and len(result.stdout) <= maximum, 'bounded_quiet_systemd_inventory_required')
    return result.stdout


def unit_names(raw):
    names = set()
    for line in raw.decode().splitlines():
        if not line.strip(): continue
        name = line.split()[0]
        need(UNIT.fullmatch(name), 'exact_service_timer_socket_path_name_required'); names.add(name)
    need(len(names) <= 3000, 'bounded_unit_inventory_required'); return names


def systemd_snapshot():
    common = ['--all', '--no-legend', '--no-pager', '--plain', '--type=service', '--type=timer', '--type=socket', '--type=path']
    loaded = command(['/usr/bin/systemctl', 'list-units', *common])
    files = command(['/usr/bin/systemctl', 'list-unit-files', *[v for v in common if v != '--all']])
    names = sorted(unit_names(loaded) | unit_names(files)); rows = {}
    for offset in range(0, len(names), 128):
        raw = command(['/usr/bin/systemctl', 'show', '--all', '--no-pager',
                       *['--property=' + p for p in PROPERTIES], *names[offset:offset + 128]])
        for block in raw.decode().strip().split('\n\n'):
            value = {}
            for line in block.splitlines():
                key, sep, field = line.partition('=')
                need(sep and key in PROPERTIES and key not in value, 'exact_manager_inventory_properties_required'); value[key] = field
            need('Id' in value and UNIT.fullmatch(value['Id']) and set(value) <= set(PROPERTIES),
                 'one_exact_inventory_row_per_unit_required')
            # Some systemd versions omit empty typed values. Missing values are
            # recorded as absent, never normalized into an accepted empty value.
            need(value['Id'] not in rows or rows[value['Id']] == value, 'alias_unit_changed_during_inventory')
            rows[value['Id']] = value
    covered = {name for row in rows.values() for name in [row['Id'], *row.get('Names', '').split()]}
    need(set(names) <= covered, 'complete_systemd_unit_inventory_required')
    return {'listedNames': names, 'units': rows}


def file_tree(roots):
    """Hash raw boot/cron/supervisor files, never emit their contents."""
    result = {}; nodes = total = 0
    def add(path):
        nonlocal nodes, total
        if str(path) in result: return
        s = path.lstat(); nodes += 1; need(nodes <= 15000, 'bounded_boot_configuration_inventory_required')
        identity = {'uid': s.st_uid, 'gid': s.st_gid, 'mode': stat.S_IMODE(s.st_mode)}
        if stat.S_ISLNK(s.st_mode): identity.update({'type': 'link', 'target': os.readlink(path)})
        elif stat.S_ISREG(s.st_mode):
            raw = safe_read(path); total += len(raw)
            need(total <= 64_000_000, 'bounded_boot_configuration_bytes_required')
            identity.update({'type': 'file', 'sha256': sha(raw)})
        elif stat.S_ISDIR(s.st_mode):
            identity['type'] = 'directory'
            for child in sorted(path.iterdir()): add(child)
        else: raise RuntimeError('unexpected_boot_configuration_file_type')
        result[str(path)] = identity
    for root in roots:
        if os.path.lexists(root): add(root)
        else: result[str(root)] = {'type': 'absent'}
    return result


def process_snapshot(proc=Path('/proc')):
    out = []; total = 0
    for path in sorted(proc.iterdir()):
        if not path.name.isdecimal(): continue
        try:
            before = (path / 'stat').read_text(); tail = before[before.rfind(')') + 2:].split(); start = tail[19]
            argv = (path / 'cmdline').read_bytes(); need(len(argv) <= 128000, 'bounded_process_argument_inventory_required')
            total += len(argv); need(total <= 16_000_000, 'bounded_total_process_arguments_required')
            status = dict(line.split(':', 1) for line in (path / 'status').read_text().splitlines() if ':' in line)
            cgroup = (path / 'cgroup').read_text(); exe = os.readlink(path / 'exe') if argv else ''
            after = (path / 'stat').read_text(); need(after[after.rfind(')') + 2:].split()[19] == start, 'process_PID_reused_during_inventory')
            if argv:
                out.append({'pid': int(path.name), 'parentPid': int(tail[1]), 'startTicks': start, 'uid': status['Uid'].split(), 'gid': status['Gid'].split(),
                            'argv': argv.decode('utf-8', errors='surrogateescape').split('\0')[:-1], 'exe': exe, 'cgroup': cgroup})
        except FileNotFoundError: continue  # Actual exit is observational; final identity is never manufactured.
        need(len(out) <= 8192, 'bounded_process_inventory_required')
    return out


def boot_roots():
    import pwd
    roots = [Path(p) for p in ('/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system',
        '/etc/systemd/user', '/usr/lib/systemd/user', '/lib/systemd/user', '/var/lib/systemd/linger', '/etc/crontab', '/etc/anacrontab',
        '/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly',
        '/var/spool/cron', '/var/spool/at', '/etc/rc.local', '/etc/inittab', '/etc/init.d',
        '/etc/rc0.d', '/etc/rc1.d', '/etc/rc2.d', '/etc/rc3.d', '/etc/rc4.d', '/etc/rc5.d', '/etc/rc6.d', '/etc/rcS.d',
        '/etc/supervisor', '/etc/supervisord.conf')]
    for user in pwd.getpwall():
        home = Path(user.pw_dir)
        if home.is_absolute() and home != Path('/') and home.is_dir():
            roots += [home / '.config/systemd/user', home / '.pm2/dump.pm2', home / '.config/autostart']
    run_user = Path('/run/user')
    if run_user.is_dir():
        roots += [p / 'systemd' for p in sorted(run_user.iterdir()) if p.name.isdecimal()]
    return sorted(set(roots))


def persistent_view(value):
    return {'bootId': value['bootId'], 'systemd': value['systemd'], 'bootFiles': value['bootFiles']}


def launch_files(systemd):
    paths = set(boot_roots())
    for unit in systemd['units'].values():
        for path in [unit.get('FragmentPath', ''), *unit.get('DropInPaths', '').split()]:
            if not path: continue
            need(Path(path).is_absolute() and not re.search(r'[\s\x00]', path), 'literal_absolute_unit_definition_path_required')
            paths.add(Path(path))
    return file_tree(sorted(paths))


def collector_envelope(processes, pid, source_path):
    """Separate only this audit's own CLI and literal ancestral shell command.

    Their raw facts remain in the protected report. This prevents the plan hash
    in this audit's own argv creating a circular process-plan fingerprint.
    No other process or unit is exempted from review.
    """
    indexed = {row['pid']: row for row in processes}; excluded = []
    current = indexed.get(pid)
    python = {'python3', '/usr/bin/python3', 'python3.12', '/usr/bin/python3.12'}
    need(current is not None and len(current['argv']) >= 6 and current['argv'][0] in python and
         current['argv'][1:4] == ['-I', '-B', source_path], 'actual_inventory_process_envelope_required')
    suffix = current['argv'][4:]
    need(len(suffix) == 2 and suffix[0] == '--capture-host' and re.fullmatch('[a-z][a-z0-9-]{0,47}', suffix[1]) or
         len(suffix) == 4 and suffix[0] == '--validate-host' and Path(suffix[1]).is_absolute() and
         not re.search(r'[\s\x00]', suffix[1]) and suffix[2] == '--plan-sha' and is_pin(suffix[3]),
         'exact_inventory_only_CLI_envelope_required')
    excluded.append(current); parent = indexed.get(current['parentPid'])
    if parent and Path(parent['exe']).name in {'bash', 'sh', 'dash'} and any(source_path in arg for arg in parent['argv']):
        argv = parent['argv']
        need(len(argv) == 3 and Path(argv[0]).name in {'bash', 'sh', 'dash'} and argv[1] in {'-c', '-lc'} and
             not re.search(r'[;&|<>\n\r\x00`$(){}]', argv[2]), 'compound_or_substituted_audit_ancestor_not_exempt')
        literal = shlex.split(argv[2]); literal = literal[1:] if literal[:1] == ['exec'] else literal
        need(len(literal) == len(current['argv']) and literal[0] in python and literal[1:] == current['argv'][1:],
             'only_exact_literal_python_audit_ancestor_is_exempt')
        excluded.append(parent)
    return excluded


def capture_host():
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == HOST, 'fixed_root_host_inventory_only')
    started = time.time(); boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    first = {'bootId': boot, 'systemd': systemd_snapshot()}; first['bootFiles'] = launch_files(first['systemd'])
    processes = process_snapshot(); second = {'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'systemd': systemd_snapshot()}; second['bootFiles'] = launch_files(second['systemd'])
    need(first == second and time.time() - started <= 90, 'boot_restart_inventory_changed_during_two_snapshot_capture')
    return {'format': FORMAT + '-host-capture', 'producerSha256': sha(safe_read(Path(__file__).absolute())),
            'capturedAtUnix': int(time.time()), **second, 'processes': processes,
            'collectorEnvelope': collector_envelope(processes, os.getpid(), str(Path(__file__).absolute())),
            'installedProgramProvenanceQualified': False, 'scannerRetirementAccepted': False,
            'requiresIndependentRuntimeManifestReceipts': True,
            'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0, 'productionSingleIngestorAccepted': False}


def launch_rows(report):
    rows = {}
    units = report['systemd']['units']
    aliases = {name: row['Id'] for row in units.values() for name in [row['Id'], *row.get('Names', '').split()]}
    reachable = {name for name, row in units.items() if row.get('UnitFileState') not in {'disabled', 'static', 'masked', 'not-found', ''} or
                 any(row.get(k) for k in ('WantedBy', 'RequiredBy', 'UpheldBy')) or
                 name.endswith(('.timer', '.path', '.socket')) and row.get('ActiveState') in {'active', 'activating'}}
    for _ in range(len(units) + 1):
        following = reachable | {aliases.get(child, child) for name in reachable if name in units
            for key in ('Wants', 'Requires', 'OnFailure', 'OnSuccess', 'Triggers') for child in units[name].get(key, '').split()}
        if following == reachable: break
        reachable = following
    for name, value in report['systemd']['units'].items():
        rows['unit:' + name] = {'kind': 'unit', 'name': name, 'sha256': sha(encoded(value)),
                               'running': value.get('MainPID', '0') != '0' or value.get('ControlPID', '0') != '0' or
                               value.get('ActiveState') in {'active', 'activating', 'reloading'},
                               'bootReachable': name in reachable or any(aliases.get(trigger, trigger) in reachable for trigger in value.get('TriggeredBy', '').split())}
    for path, value in report['bootFiles'].items():
        rows['boot:' + path] = {'kind': 'boot', 'name': path, 'sha256': sha(encoded(value))}
    for process in report['processes']:
        if process in report['collectorEnvelope']: continue
        frame = {k: process[k] for k in ('uid', 'gid', 'argv', 'exe', 'cgroup')}; digest = sha(encoded(frame)); key = 'process:' + digest
        if key not in rows: rows[key] = {'kind': 'process', 'name': 'process-frame-' + digest, 'sha256': digest, 'count': 0}
        rows[key]['count'] += 1
    return rows


def validate_host(report, plan):
    need(report['format'] == FORMAT + '-host-capture' and plan['format'] == FORMAT + '-host-plan' and
         plan['bootId'] == report['bootId'] and plan['repositoryManifestSha256'] == REPOSITORY_MANIFEST_SHA and is_pin(REPOSITORY_MANIFEST_SHA) and
         plan['captureProducerSha256'] == report['producerSha256'], 'actual_same_boot_reviewed_inventory_plan_required')
    need(report['databaseWrites'] == report['providerCalls'] == report['serviceActions'] == 0 and
         report['productionSingleIngestorAccepted'] is False, 'inventory_leaf_has_no_mutation_or_single_ingestor_authority')
    need(plan['phase'] in {'before-retirement', 'retired'} and isinstance(plan['entries'], dict), 'explicit_inventory_retirement_phase_required')
    actual = launch_rows(report); expected = {}
    if plan['phase'] == 'retired':
        need(not any(Path(p['exe']).name in {'dockerd', 'containerd', 'kubelet'} or
             any(re.search(r'(?:^|[/ .])pm2(?:$|[/ .])', arg, re.I) for arg in p['argv']) for p in report['processes']),
             'container_or_pm2_restart_policy_requires_separate_reviewed_inventory_extension')
    for key, value in plan['entries'].items():
        need(set(value) == {'inventory', 'classes', 'reason'} and value['classes'] and set(value['classes']) <= CLASSES and
             isinstance(value['reason'], str) and 10 <= len(value['reason']) <= 600, 'all_host_boot_and_process_entries_must_be_reviewed')
        expected[key] = value['inventory']
        if plan['phase'] == 'retired' and 'legacy-recurring-retire' in value['classes']:
            row = actual.get(key, {})
            need(row.get('kind') == 'unit' and row.get('running') is False and row.get('bootReachable') is False,
                 'legacy_scanner_process_cron_or_boot_path_not_owned_retired')
    need(actual == expected, 'unreviewed_or_changed_host_service_timer_cron_process_or_restart_path')
    active_shared = {classification: sorted(row['inventory']['name'] for row in plan['entries'].values()
        if classification in row['classes'] and row['inventory'].get('kind') == 'unit' and row['inventory'].get('running') is True)
        for classification in ('shared-ponder', 'shared-solana')}
    if plan['phase'] == 'retired':
        need(all(names == ['yunipals-indexer.service'] for names in active_shared.values()),
             'retired_inventory_requires_one_reviewed_shared_EVM_and_Solana_parent_unit')
    # This is an inventory leaf, never proof of source permissions, DB exclusivity,
    # canonical freshness, managed epoch or successfully applied retirement.
    return {'format': FORMAT + '-host-result', 'validated': True, 'phase': plan['phase'], 'entryCount': len(actual),
            'inventorySha256': sha(encoded(actual)), 'unitNames': sorted(report['systemd']['units']),
            'activeSharedUnitNames': active_shared,
            'units': len(report['systemd']['units']), 'bootFiles': len(report['bootFiles']), 'processes': len(report['processes']),
            'installedProgramProvenanceQualified': False, 'scannerRetirementAccepted': False,
            'requiresIndependentRuntimeManifestReceipts': True,
            'productionSingleIngestorAccepted': False, 'sourceActorQualified': False, 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0}


def exclusive_report(report, capture_id):
    need(re.fullmatch('[a-z][a-z0-9-]{0,47}', capture_id), 'bounded_explicit_inventory_capture_id_required')
    BASE.mkdir(mode=0o700, exist_ok=True)
    s = BASE.lstat(); need(stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 0 and stat.S_IMODE(s.st_mode) == 0o700,
                          'exact_root_private_inventory_BASE_required')
    directory = BASE / capture_id; directory.mkdir(mode=0o700)
    fd = os.open(directory / 'result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    raw = encoded(report)
    try:
        with os.fdopen(fd, 'wb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    finally:
        for p in (directory, BASE):
            d = os.open(p, os.O_RDONLY | os.O_DIRECTORY); os.fsync(d); os.close(d)
    return {'format': FORMAT + '-host-summary', 'reportSha256': sha(raw), 'unitNames': sorted(report['systemd']['units']),
            'units': len(report['systemd']['units']), 'bootFiles': len(report['bootFiles']), 'processes': len(report['processes']),
            'installedProgramProvenanceQualified': False, 'scannerRetirementAccepted': False,
            'requiresIndependentRuntimeManifestReceipts': True,
            'rawRootPrivate': True, 'productionSingleIngestorAccepted': False, 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__); modes = p.add_mutually_exclusive_group()
    modes.add_argument('--repository', type=Path); modes.add_argument('--capture-host', metavar='CAPTURE_ID')
    modes.add_argument('--validate-host', type=Path); p.add_argument('--plan-sha'); args = p.parse_args()
    if args.repository:
        raw = safe_read(REPOSITORY_MANIFEST)
        need(sha(raw) == REPOSITORY_MANIFEST_SHA, 'exact_reviewed_repository_inventory_manifest_required')
        result = validate_repository(args.repository.absolute(), json.loads(raw))
    elif args.capture_host:
        result = exclusive_report(capture_host(), args.capture_host)
    elif args.validate_host:
        need(is_pin(args.plan_sha), 'explicit_protected_host_inventory_plan_hash_required')
        raw = safe_read(args.validate_host.absolute(), private=True); need(sha(raw) == args.plan_sha, 'exact_host_inventory_plan_required')
        # Current read-only recapture, not acceptance of a stale saved snapshot.
        result = validate_host(capture_host(), json.loads(raw))
    else:
        result = {'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0,
                  'hostCaptured': False, 'productionSingleIngestorAccepted': False}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'validated': False, 'fixedCode': str(error) if type(error) is RuntimeError and
            re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__, 'rawDiagnosticsWithheld': True,
            'unreviewedSourcePaths': getattr(error, 'publicInventoryPaths', [])[:100],
            'unreviewedSourcePathCount': len(getattr(error, 'publicInventoryPaths', [])),
            'productionSingleIngestorAccepted': False})); raise SystemExit(1)
