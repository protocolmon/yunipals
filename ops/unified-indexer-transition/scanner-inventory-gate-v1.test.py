#!/usr/bin/env python3
"""Repository/real-FS inventory negatives; no host commands/DB/provider/service."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
PATH = HERE / 'scanner-inventory-gate-v1.py'
spec = importlib.util.spec_from_file_location('tested_scanner_inventory', PATH)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def manifest(root):
    rows = [{**row, 'classes': ['bounded-operator-test'], 'reason': 'Explicit local scanner discovery fixture, never runtime authority.', 'functionScopes': []}
            for row in m.repository_candidates(root)['candidates'].values()]
    return {'format': m.FORMAT + '-repository', 'patterns': m.PATTERNS, 'sourceRoots': list(m.SOURCE_ROOTS),
            'rootFiles': ['package.json'], 'nonPackageJsonExcluded': True, 'appPublicAssetsExcluded': True,
            'generatedDirectoriesExcluded': sorted(m.SKIP), 'explicitDispatch': sorted(m.DISPATCH), 'entries': rows}


def unit(name='yunipals-indexer.service', active=False, enabled=False, **extra):
    return {'Id': name, 'Names': name, 'MainPID': '100' if active else '0', 'ControlPID': '0',
            'ActiveState': 'active' if active else 'inactive', 'UnitFileState': 'enabled' if enabled else 'disabled',
            'ExecStart': '/fixed/public/launcher.mjs', 'Restart': 'on-failure', **extra}


def report():
    return {'format': m.FORMAT + '-host-capture', 'producerSha256': '1' * 64, 'bootId': 'same-boot',
            'systemd': {'units': {'yunipals-indexer.service': unit(active=True, enabled=True)}, 'listedNames': ['yunipals-indexer.service']},
            'bootFiles': {'/etc/crontab': {'type': 'file', 'sha256': '2' * 64}}, 'processes': [], 'collectorEnvelope': [],
            'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0, 'productionSingleIngestorAccepted': False}


def plan(value, phase='before-retirement'):
    result = {'format': m.FORMAT + '-host-plan', 'phase': phase, 'bootId': value['bootId'],
            'repositoryManifestSha256': m.REPOSITORY_MANIFEST_SHA, 'captureProducerSha256': value['producerSha256'],
            'entries': {key: {'inventory': row, 'classes': ['deployment-review'], 'reason': 'Explicit private fixture launch review only.'}
                        for key, row in m.launch_rows(value).items()}}
    if 'unit:yunipals-indexer.service' in result['entries']:
        result['entries']['unit:yunipals-indexer.service']['classes'] = ['shared-ponder', 'shared-solana']
    return result


class Repository(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup); self.root = Path(self.tmp.name)
        self.entry = self.root / 'apps/example/worker.ts'; self.entry.parent.mkdir(parents=True)
        self.entry.write_text('export async function witness(client) { return client.getLogs({fromBlock: 1n, toBlock: 1n}); }\n')

    def test_reviewed_entry_passes_without_retirement_or_host_claim(self):
        result = m.validate_repository(self.root, manifest(self.root))
        self.assertEqual(result['candidateFiles'], 1); self.assertFalse(result['productionSingleIngestorAccepted'])
        self.assertFalse(result['legacyScannersRetired']); self.assertFalse(result['hostCaptured'])

    def test_unknown_getContractEvents_and_filter_entrypoints_refuse(self):
        baseline = manifest(self.root)
        for token in ('getContractEvents', 'getFilterChanges', 'watchContractEvent', 'eth_getLogs', 'getAssetBatch'):
            path = self.entry.with_name('unknown.ts'); path.write_text('unknown.' + token + '();\n')
            with self.subTest(token=token), self.assertRaisesRegex(RuntimeError, 'unreviewed_new_changed'):
                m.validate_repository(self.root, baseline)
            path.unlink()

    def test_unknown_ponder_config_and_deployment_command_refuse(self):
        baseline = manifest(self.root)
        cases = {'new.config.ts': 'export default createConfig({});', 'bootstrap.py': 'command(["systemctl", "start", "mystery.service"])',
                 'mystery.service': '[Service]\nExecStart=/usr/bin/node /unknown/hidden.mjs\n'}
        for name, source in cases.items():
            path = self.root / 'ops' / name; path.parent.mkdir(exist_ok=True); path.write_text(source)
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'unreviewed_new_changed'):
                m.validate_repository(self.root, baseline)
            path.unlink()

    def test_changed_or_removed_entry_and_evidence_scope_refuse(self):
        baseline = manifest(self.root); self.entry.write_text(self.entry.read_text() + 'setInterval(witness, 1000);\n')
        with self.assertRaisesRegex(RuntimeError, 'unreviewed_new_changed'): m.validate_repository(self.root, baseline)
        self.entry.unlink()
        with self.assertRaisesRegex(RuntimeError, 'unreviewed_new_changed'): m.validate_repository(self.root, baseline)
        bad = copy.deepcopy(baseline); bad['patterns']['log-discovery'] = 'never_detect'
        with self.assertRaisesRegex(RuntimeError, 'detection_scope'): m.validate_repository(self.root, bad)

    def test_generated_dependencies_are_explicitly_excluded_and_source_symlink_refuses(self):
        baseline = manifest(self.root); path = self.root / 'node_modules/hidden.js'; path.parent.mkdir(); path.write_text('client.getLogs({});')
        m.validate_repository(self.root, baseline)
        link = self.root / 'apps/linked.ts'; link.symlink_to(self.entry)
        with self.assertRaisesRegex(RuntimeError, 'source_symlinks'): m.repository_candidates(self.root)

    def test_runtime_data_docs_assets_and_outside_roots_cannot_expand_source_scope(self):
        baseline = manifest(self.root)
        for path in ['data/runtime.json', '.local/cache/opaque.js', 'docs/preparation.json', 'sites/archived/index.js',
                     'apps/example/public/runtime.js', 'ops/evidence.json', 'apps/example/node_modules/dependency.js']:
            target = self.root/path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text('systemctl eth_getLogs')
        m.validate_repository(self.root, baseline)
        link = self.root/'apps/example/source-link'; link.symlink_to(self.root/'sites', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'directory_symlink'): m.repository_candidates(self.root)

    def test_repository_and_declared_source_root_symlinks_refuse_before_external_read(self):
        outside = self.root/'opaque-external'; outside.mkdir(); (outside/'hidden.ts').write_text('client.getLogs({});')
        alias = self.root/'repository-alias'; alias.symlink_to(outside, target_is_directory=True)
        linked_root = self.root/'linked-root'; linked_root.mkdir()
        (linked_root/'apps').symlink_to(outside, target_is_directory=True)
        broken_root = self.root/'broken-root'; broken_root.mkdir(); (broken_root/'ops').symlink_to(self.root/'absent')
        with patch.object(m, 'safe_read', side_effect=AssertionError('external_target_must_never_be_read')):
            for target in (alias, linked_root, broken_root):
                with self.subTest(target=target.name), self.assertRaisesRegex(RuntimeError, 'non_symlink_.*directory'):
                    m.repository_candidates(target)
        # Declared generated/dependency paths are excluded before directory
        # qualification; they cannot import outside code into source authority.
        for name in ('node_modules','public'):
            (self.entry.parent/name).symlink_to(outside, target_is_directory=True)
        self.assertEqual(len(m.repository_candidates(self.root)['candidates']),1)

    def test_classification_and_mixed_function_evidence_are_explicit(self):
        value = manifest(self.root); value['entries'][0]['classes'] = ['all-scanners-allowed']
        with self.assertRaisesRegex(RuntimeError, 'classification'): m.validate_repository(self.root, value)
        value = manifest(self.root); value['entries'][0]['functionScopes'] = [{'symbol': 'witness', 'class': 'bounded-market-admission',
            'evidenceLines': [1], 'contract': 'not a classified exception'}]
        with self.assertRaisesRegex(RuntimeError, 'mixed_function'): m.validate_repository(self.root, value)

    def test_public_manifest_exact_hash_and_mixed_safety_contract(self):
        raw = m.REPOSITORY_MANIFEST.read_bytes(); self.assertEqual(m.sha(raw), m.REPOSITORY_MANIFEST_SHA)
        value = json.loads(raw); indexed = {row['path']: row for row in value['entries']}
        mixed = indexed['apps/yunipals-market-api/src/bnb/discovery.ts']
        self.assertEqual(set(mixed['classes']), {'legacy-recurring-retire', 'bounded-market-admission'})
        self.assertEqual({s['symbol'] for s in mixed['functionScopes']}, {'runBnbDiscoveryPass / readLogs', 'reconstructPublishedComponents'})
        for path in ['apps/yunipals-market-api/src/bnb/chain.ts', 'apps/yunipals-market-api/src/opensea/chain.ts']:
            self.assertEqual(indexed[path]['classes'], ['bounded-market-admission'])
        legacy = indexed['apps/yunipals-indexer/lib/metadata/legacy-http-worker.ts']
        self.assertTrue(any(e['matchSha256'] == m.sha(b'getContractEvents') for e in legacy['evidence']))
        self.assertEqual(legacy['functionScopes'][0]['symbol'], 'syncBaseMetadataUpdates')


class HostInventory(unittest.TestCase):
    def test_exact_reviewed_inventory_passes_but_never_single_ingestor(self):
        value = report(); result = m.validate_host(value, plan(value))
        self.assertTrue(result['validated']); self.assertFalse(result['productionSingleIngestorAccepted'])
        self.assertFalse(result['sourceActorQualified'])
        self.assertEqual(set(result) & {'argv', 'bootFilesRaw', 'processesRaw', 'environment'}, set())

    def test_unknown_service_timer_boot_link_cron_or_restart_hook_refuses(self):
        original = report(); review = plan(original)
        cases = []
        value = copy.deepcopy(original); value['systemd']['units']['unknown.timer'] = unit('unknown.timer', enabled=True); cases.append(value)
        value = copy.deepcopy(original); value['bootFiles']['/etc/systemd/system/multi-user.target.wants/unknown.service'] = {'type': 'link', 'target': '/private/raw/command'}; cases.append(value)
        value = copy.deepcopy(original); value['bootFiles']['/etc/crontab']['sha256'] = '3' * 64; cases.append(value)
        value = copy.deepcopy(original); value['systemd']['units']['yunipals-indexer.service']['OnFailure'] = 'hidden-scanner.service'; cases.append(value)
        for value in cases:
            with self.assertRaisesRegex(RuntimeError, 'unreviewed_or_changed_host'): m.validate_host(value, review)

    def test_unknown_live_process_frame_and_duplicate_count_refuse(self):
        original = report(); review = plan(original)
        process = {'pid': 9, 'parentPid': 1, 'uid': ['0'] * 4, 'gid': ['0'] * 4, 'exe': '/usr/bin/node', 'argv': ['node', '/private/unknown.mjs'], 'cgroup': '0::/unknown'}
        value = copy.deepcopy(original); value['processes'] = [process]
        with self.assertRaisesRegex(RuntimeError, 'unreviewed_or_changed_host'): m.validate_host(value, review)
        review = plan(value); value['processes'].append({**process, 'pid': 10})
        with self.assertRaisesRegex(RuntimeError, 'unreviewed_or_changed_host'): m.validate_host(value, review)

    def test_legacy_requires_terminal_no_reachable_timer_or_cron_and_no_pm2_claim(self):
        value = report(); name = 'retired-legacy.service'; value['systemd']['units'][name] = unit(name)
        review = plan(value, 'retired'); review['entries']['unit:' + name]['classes'] = ['legacy-recurring-retire']
        m.validate_host(value, review)
        for active, enabled in [(True, False), (False, True)]:
            bad = copy.deepcopy(value); bad['systemd']['units'][name] = unit(name, active=active, enabled=enabled)
            with self.assertRaisesRegex(RuntimeError, 'legacy_scanner'): m.validate_host(bad, review)
        bad = copy.deepcopy(value); timer = unit('legacy.timer', enabled=True, Triggers=name); bad['systemd']['units']['legacy.timer'] = timer
        with self.assertRaisesRegex(RuntimeError, 'legacy_scanner'): m.validate_host(bad, review)
        bad = copy.deepcopy(value); bad['processes'] = [{'pid': 4, 'parentPid': 1, 'uid': ['0']*4, 'gid': ['0']*4, 'exe': '/usr/bin/node', 'argv': ['node', '/root/.pm2/agent.js'], 'cgroup': '0::/pm2'}]
        with self.assertRaisesRegex(RuntimeError, 'container_or_pm2'): m.validate_host(bad, plan(bad, 'retired'))
        review = plan(value, 'retired'); review['entries']['boot:/etc/crontab']['classes'] = ['legacy-recurring-retire']
        with self.assertRaisesRegex(RuntimeError, 'legacy_scanner'): m.validate_host(value, review)

    def test_disabled_inactive_timer_does_not_fabricate_a_live_restart_path(self):
        value = report(); value['systemd']['units'] = {'legacy.service': unit('legacy.service', TriggeredBy='legacy.timer'),
            'legacy.timer': unit('legacy.timer', Triggers='legacy.service')}
        rows = m.launch_rows(value)
        self.assertFalse(rows['unit:legacy.service']['bootReachable']); self.assertFalse(rows['unit:legacy.timer']['bootReachable'])

    def test_retired_phase_requires_one_reviewed_shared_parent_not_multiple_scanners(self):
        value = report(); m.validate_host(value, plan(value, 'retired'))
        for extra in (False, True):
            bad = copy.deepcopy(value)
            if extra:
                bad['systemd']['units']['second.service'] = unit('second.service', active=True)
                review = plan(bad, 'retired'); review['entries']['unit:second.service']['classes'] = ['shared-ponder']
            else:
                review = plan(bad, 'retired'); review['entries']['unit:yunipals-indexer.service']['classes'] = ['deployment-review']
            with self.assertRaisesRegex(RuntimeError, 'one_reviewed_shared'): m.validate_host(bad, review)

    def test_plan_boot_producer_scope_and_unqualified_flags_refuse(self):
        value = report(); review = plan(value)
        for key, changed in [('bootId', 'another-boot'), ('repositoryManifestSha256', 'f' * 64), ('captureProducerSha256', '0' * 64)]:
            bad = copy.deepcopy(review); bad[key] = changed
            with self.assertRaisesRegex(RuntimeError, 'same_boot'): m.validate_host(value, bad)
        value['databaseWrites'] = 1
        with self.assertRaisesRegex(RuntimeError, 'no_mutation'): m.validate_host(value, review)

    def test_manager_read_only_parser_aliases_and_unknown_verb_refuse(self):
        name = 'canonical.service'; alias = 'alias.service'; row = unit(name, Names=name + ' ' + alias)
        data = '\n'.join(k + '=' + v for k, v in row.items()).encode()
        def cmd(argv, **kwargs):
            if argv[1].startswith('list-'): return (name + ' disabled\n' + alias + ' alias\n').encode()
            return data + b'\n\n' + data
        with patch.object(m, 'command', cmd):
            value = m.systemd_snapshot(); self.assertEqual(list(value['units']), [name])
        with self.assertRaisesRegex(RuntimeError, 'read_only_systemd'): m.command(['/usr/bin/systemctl', 'start', name])
        with self.assertRaisesRegex(RuntimeError, 'path_name'): m.unit_names(b'bad;command.service enabled\n')

    def test_collector_envelope_exempts_only_self_and_literal_ancestral_shell(self):
        argv = ['python3', '-I', '-B', str(PATH.absolute()), '--validate-host', '/root/private-plan.json', '--plan-sha', 'a'*64]
        frame = {'pid': 3, 'parentPid': 2, 'exe': '/usr/bin/python3', 'argv': argv}
        parent = {'pid': 2, 'parentPid': 1, 'exe': '/bin/bash', 'argv': ['bash', '-c', ' '.join(argv)]}
        unrelated = {'pid': 4, 'parentPid': 1, 'exe': '/bin/bash', 'argv': ['bash', '-c', 'scanner unknown']}
        self.assertEqual(m.collector_envelope([frame,parent,unrelated],3,str(PATH.absolute())), [frame,parent])
        with self.assertRaisesRegex(RuntimeError, 'actual_inventory_process'): m.collector_envelope([parent],3,str(PATH.absolute()))

    def test_collector_ancestor_compound_echo_extra_or_substituted_commands_refuse(self):
        argv = ['python3', '-I', '-B', str(PATH.absolute()), '--capture-host', 'actual-id']
        frame = {'pid': 3, 'parentPid': 2, 'exe': '/usr/bin/python3', 'argv': argv}
        for text in [' '.join(argv) + '; launch-other-scanner', 'echo ' + str(PATH.absolute()),
                     ' '.join(argv) + ' extra', ' '.join(argv) + ' $(hidden)', ' '.join(argv) + ' > /tmp/output']:
            parent = {'pid': 2, 'parentPid': 1, 'exe': '/bin/sh', 'argv': ['sh', '-c', text]}
            with self.subTest(text=text), self.assertRaisesRegex(RuntimeError, 'not_exempt|only_exact_literal'):
                m.collector_envelope([frame,parent],3,str(PATH.absolute()))
        parent = {'pid': 2, 'parentPid': 1, 'exe': '/bin/sh', 'argv': ['sh', '-c', 'exec ' + ' '.join(argv)]}
        self.assertEqual(len(m.collector_envelope([frame,parent],3,str(PATH.absolute()))),2)

    def test_two_snapshot_change_refuses_before_any_private_report_write(self):
        base = report()['systemd']; changed = copy.deepcopy(base); changed['units']['unknown.service'] = unit('unknown.service')
        process = {'pid': os.getpid(), 'parentPid': 1, 'exe': '/usr/bin/python3', 'argv': ['python3', str(PATH.absolute())]}
        with patch.object(m.socket, 'gethostname', return_value=m.HOST), patch.object(m, 'systemd_snapshot', side_effect=[base,changed]), \
             patch.object(m, 'launch_files', return_value={}), patch.object(m, 'process_snapshot', return_value=[process]):
            with self.assertRaisesRegex(RuntimeError, 'two_snapshot'): m.capture_host()


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.tmp.cleanup); self.root = Path(self.tmp.name)

    def test_private_exclusive_capture_no_overwrite_and_no_raw_stdout_fields(self):
        with patch.object(m, 'BASE', self.root / 'private'):
            value = report(); value['processes'] = [{'argv': ['NEVER_PUBLIC_RAW_ARGV']}]
            summary = m.exclusive_report(value, 'fixture-capture')
            path = m.BASE/'fixture-capture/result.json'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600); self.assertEqual(m.BASE.stat().st_mode & 0o777, 0o700)
            self.assertEqual(m.sha(path.read_bytes()), summary['reportSha256']); self.assertNotIn('NEVER_PUBLIC_RAW_ARGV', json.dumps(summary))
            with self.assertRaises(FileExistsError): m.exclusive_report(value, 'fixture-capture')
            with self.assertRaisesRegex(RuntimeError, 'bounded_explicit'): m.exclusive_report(value, '../foreign')

    def test_file_inventory_detects_unknown_symlink_and_changed_cron_bytes_without_following(self):
        path = self.root/'cron'; path.mkdir(); job = path/'job'; job.write_text('private-command-not-exported\n')
        first = m.file_tree([path]); self.assertNotIn('private-command', json.dumps(first))
        link = path/'boot-path'; link.symlink_to('/not/followed')
        second = m.file_tree([path]); self.assertNotEqual(first, second); self.assertEqual(second[str(link)]['type'], 'link')
        job.write_text('changed-private-command\n'); self.assertNotEqual(second, m.file_tree([path]))

    def test_same_launch_path_changed_script_never_claims_program_or_retirement_acceptance(self):
        script = self.root/'installed-scanner.mjs'; script.write_text('approved opaque runtime bytes\n')
        value = report(); value['systemd']['units']['yunipals-indexer.service']['ExecStart'] = '/usr/bin/node ' + str(script)
        review = plan(value, 'retired'); before = m.validate_host(value, review)
        script.write_text('changed opaque runtime bytes with hidden cursor\n')
        after = m.validate_host(value, review)
        # This leaf cannot observe or authorize script bytes. A separately
        # authenticated installed/runtime manifest remains mandatory both times.
        for proof in (before, after):
            self.assertFalse(proof['installedProgramProvenanceQualified'])
            self.assertFalse(proof['scannerRetirementAccepted'])
            self.assertTrue(proof['requiresIndependentRuntimeManifestReceipts'])
            self.assertFalse(proof['productionSingleIngestorAccepted'])

    def test_safe_private_read_rejects_symlink_hardlink_or_public_mode(self):
        path = self.root/'plan'; path.write_text('{}'); path.chmod(0o600); self.assertEqual(m.safe_read(path, private=True), b'{}')
        path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'root_private'): m.safe_read(path, private=True)
        path.chmod(0o600); link=self.root/'link'; link.symlink_to(path)
        with self.assertRaisesRegex(RuntimeError, 'single_regular'): m.safe_read(link)
        hard=self.root/'hard'; os.link(path,hard)
        with self.assertRaisesRegex(RuntimeError, 'single_regular'): m.safe_read(path)

    def test_default_cli_never_captures_or_starts_anything(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(PATH)], capture_output=True, check=True)
        value = json.loads(result.stdout); self.assertTrue(value['staticOnly']); self.assertFalse(value['hostCaptured'])
        self.assertFalse(value['productionSingleIngestorAccepted']); self.assertEqual(result.stderr,b'')


if __name__ == '__main__': unittest.main(verbosity=2)
