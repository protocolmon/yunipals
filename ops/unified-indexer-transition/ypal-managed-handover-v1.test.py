#!/usr/bin/env python3
"""Synthetic local lifecycle/real-filesystem controls; no host services/RPC."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name('ypal-managed-handover-v1.py')
spec = importlib.util.spec_from_file_location('managed_tested_owner', PATH)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def solana():
    return {'format': 'yunipals-solana-supervisor-handover-state-v1', 'readOnly': True,
            'isolation': 'repeatable read', 'databaseWrites': 0, 'providerCalls': 0,
            'observedAt': '2026-10-24T04:00:00+00:00',
            'manifest': {'checksum': m.MANIFEST_CHECKSUM, 'count': 10000},
            'state': {'publishedRunId': 10, 'nextScanAt': '2026-10-24T05:00:00+00:00',
                      'lastErrorPresent': False, 'rowSha256': 'a' * 64},
            'publishedRun': {'id': 10, 'state': 'published', 'assetCount': 10000, 'missingCount': 0,
                             'completedAt': '2026-10-24T03:00:00+00:00', 'rowSha256': 'b' * 64},
            'runningScans': 1, 'runningRunStates': [{'id': 11, 'next_batch': 4}],
            'stage': {'rows': 4000, 'sha256': 'c' * 64},
            'ledgerPrefix': {'throughId': '30', 'rows': 30, 'credits': '300000', 'sha256': 'd' * 64},
            'ledgerCurrent': {'rows': 30, 'credits': '300000', 'latestId': '30'},
            'workerLock': {'granted': 0, 'waiting': 0}}


def native():
    return {'schemaOid': '75963410', 'app': {'build_id': m.BUILD, 'is_ready': 1, 'is_locked': 1, 'heartbeat_at': 1000},
            'clock': 1000, 'tables': {str(i): {'oid': str(i), 'owner': '73004621', 'kind': 'r'} for i in range(44)},
            'checkpoints': {c: '0000001000' + c.zfill(16) + '0000000000000100' + '9' * 33 for c in ['1', '56', '137', '8453']}}


def process(pid, parent, argv, cwd):
    return {'pid': pid, 'parentPid': parent, 'startTicks': pid * 100, 'argv': argv, 'cwd': cwd,
            'uid': 970, 'gid': 964, 'groups': [964], 'noNewPrivileges': True, 'capabilitiesZero': True,
            'startupInjectionAbsent': True, 'parentPrivateValuesAbsent': True,
            'cgroup': '0::/system.slice/' + m.PARENT, 'environmentSha256': 'e' * 64, 'executable': m.NODE}


def tree():
    p = process(100, 1, [m.NODE, str(m.STAGE / 'launcher.mjs')], '/')
    return {'parent': p, 'processes': [p, process(101, 100, m.source_arguments(), m.PROJECT),
            process(102, 100, m.solana_arguments(), m.SOLANA_PROJECT)],
            'unit': {'InvocationID': 'f' * 32, 'ExecMainStartTimestampMonotonic': '100'}}


def catalog():
    edge = {'kind': 'relation', 'object': '1', 'object_name': m.SCHEMA + '.booster_monster',
            'grantee': '73187672', 'grantor': '73004621', 'privilege': 'SELECT', 'grantable': False,
            'column_number': None}
    before = {'roles': [{'name': 'collector', 'oid': '73187672', 'login': True}],
              'directRoleEdges': [], 'targetEdges': [],
              'schemas': [{'oid': '5', 'acl': 'original'}],
              'relations': [{'oid': '1', 'acl': 'original'}], 'functions': [],
              'effective': [{'role': 'collector', 'schemas': {}, 'relations': {edge['object_name']: {'select': False, 'writes': False}}, 'functions': {}}],
              'activeRelease': [{'release_id': m.RELEASE, 'epoch': 4}], 'other': 'fixed'}
    after = copy.deepcopy(before); after['directRoleEdges'] = [edge]; after['targetEdges'] = [edge]
    after['relations'][0]['acl'] = 'new'; after['effective'][0]['relations'][edge['object_name']]['select'] = True
    return before, after, edge


class Pure(unittest.TestCase):
    def settings_transport(self, change=None):
        settings = {'Restart': 'on-failure', 'RestartPreventExitStatus': '75', 'TimeoutStopUSec': '1min',
                    'KillMode': 'control-group', 'MemoryMax': '6442450944', 'MemorySwapMax': '0', 'TasksMax': '128',
                    'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
                    'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'RestrictSUIDSGID': 'yes',
                    'Environment': '', 'PassEnvironment': '', 'UnsetEnvironment': 'DATABASE_URL DATABASE_PRIVATE_URL HELIUS_API_KEY',
                    'ExecStart': '{ argv[]=' + m.NODE + ' ' + str(m.STAGE / 'launcher.mjs') + ' ; }',
                    'ExecStartPre': '', 'ExecStartPost': '', 'ExecStop': '', 'ExecStopPost': '',
                    'WorkingDirectory': '/', 'User': 'yunipals_unified_shadow', 'Group': 'yunipals_unified_shadow',
                    'RuntimeMaxUSec': 'infinity', 'RestrictAddressFamilies': 'AF_UNIX AF_INET AF_INET6',
                    'Wants': 'network-online.target', 'Conflicts': ' '.join(set(m.WRITERS) - {m.PARENT} | {'shutdown.target'}),
                    'IPAddressAllow': ' '.join(m.CIDRS | {'127.0.0.0/8', '::1/128'}), 'IPAddressDeny': '0.0.0.0/0 ::/0'}
        typed = {'EnvironmentFiles': {'type': 'a(sb)', 'data': [[str(m.STAGE / 'service.public.env'), False]]},
                 'BindPaths': {'type': 'a(ssbt)', 'data': [[b, a, False, 0] for a, b in list(m.NAMESPACE.items())[:3]]},
                 'BindReadOnlyPaths': {'type': 'a(ssbt)', 'data': [[b, a, False, 16384] for a, b in list(m.NAMESPACE.items())[3:]]}}
        if change: change(settings, typed)
        def run(argv, *args, **kwargs):
            if argv[0] == '/usr/bin/systemctl': return '\n'.join(k + '=' + v for k, v in settings.items()).encode()
            return json.dumps(typed[argv[-1]]).encode()
        return run

    def test_actual_loaded_settings_require_three_mounts_and_only_public_parent_env(self):
        h = m.Host.__new__(m.Host)
        with patch.object(m, 'command', self.settings_transport()): h.managed_settings()
        def wrong(settings, typed): typed['EnvironmentFiles']['data'].append(['/private/solana.env', False])
        with patch.object(m, 'command', self.settings_transport(wrong)):
            with self.assertRaises(RuntimeError): h.managed_settings()

    def test_loaded_unit_cannot_add_unknown_stop_conflict_or_start_pre_action(self):
        h = m.Host.__new__(m.Host)
        for key, value in [('Conflicts', 'yunipals-booster-api.service'), ('ExecStartPre', '{ argv[]=/bin/false ; }'),
                           ('IPAddressAllow', '0.0.0.0/0')]:
            def wrong(settings, typed): settings[key] = value
            with patch.object(m, 'command', self.settings_transport(wrong)):
                with self.assertRaises(RuntimeError): h.managed_settings()

    def test_loaded_mount_ownership_and_typed_flags_cannot_be_guessed(self):
        h = m.Host.__new__(m.Host)
        for value in [True, 16385, 1]:
            def wrong(settings, typed): typed['BindPaths']['data'][0][3] = value
            with patch.object(m, 'command', self.settings_transport(wrong)):
                with self.assertRaises(RuntimeError): h.managed_settings()

    def test_managed_tree_has_two_separate_children_and_ordered_three_env_files(self):
        self.assertEqual(m.validate_tree(tree())['solana']['pid'], 102)
        self.assertEqual(m.source_arguments()[2:5], ['--env-file=' + p for p in m.ENV_FILES[:3]])

    def test_wrong_env_precedence_or_Solana_credential_file_refused(self):
        for i in [1, 2]:
            t = tree(); t['processes'][i]['argv'] = list(t['processes'][i]['argv'])
            t['processes'][i]['argv'][2] = '--env-file=/wrong-private-file'
            with self.assertRaises(RuntimeError): m.validate_tree(t)

    def test_missing_solana_or_foreign_extra_process_refused(self):
        t = tree(); t['processes'].pop()
        with self.assertRaises(RuntimeError): m.validate_tree(t)
        t = tree(); t['processes'].append(process(103, 100, ['/bin/sleep', '1'], '/'))
        with self.assertRaises(RuntimeError): m.validate_tree(t)

    def test_only_actual_Ponder_compiler_child_allowed(self):
        t = tree(); exe = '/accepted/@esbuild/linux-x64/bin/esbuild'
        p = process(103, 101, [exe, '--service=0.25.12', '--ping'], m.PROJECT); p['executable'] = exe
        t['processes'].append(p); m.validate_tree(t)
        p['parentPid'] = 102
        with self.assertRaises(RuntimeError): m.validate_tree(t)

    def test_new_tree_rejects_old_root_or_capability_privileges(self):
        for key, value in [('uid', 0), ('capabilitiesZero', False), ('noNewPrivileges', False), ('groups', [964, 0])]:
            t = tree(); t['processes'][1][key] = value
            with self.assertRaises(RuntimeError): m.validate_tree(t)

    def test_all_44_native_OIDs_and_checkpoints_preserved_without_copy(self):
        a = native(); b = copy.deepcopy(a); b['checkpoints']['56'] = b['checkpoints']['56'].replace('0000000000000100', '0000000000000101')
        m.native_preserved(a, b)
        b['tables']['0']['oid'] = 'foreign'
        with self.assertRaises(RuntimeError): m.native_preserved(a, b)
        b = copy.deepcopy(a); b['checkpoints']['56'] = '0' * 75
        with self.assertRaises(RuntimeError): m.native_preserved(a, b)

    def test_stopped_stage_schedule_and_whole_mutable_usage_prefix_are_exact(self):
        a = solana(); m.stopped_solana(a, copy.deepcopy(a))
        for path, value in [('stage', {'rows': 3999, 'sha256': 'f' * 64}), ('ledgerPrefix', {'throughId': '30', 'sha256': 'e' * 64})]:
            b = copy.deepcopy(a); b[path] = value
            with self.assertRaises(RuntimeError): m.stopped_solana(a, b)

    def test_stopped_capture_is_after_legitimate_outcome_finish(self):
        live = solana(); stopped = copy.deepcopy(live); stopped['ledgerPrefix']['sha256'] = 'e' * 64
        with self.assertRaises(RuntimeError): m.prefix_preserved(live, stopped)
        m.prefix_preserved(stopped, copy.deepcopy(stopped))

    def test_inverse_keeps_new_solana_publication_and_external_credits(self):
        a = solana(); b = copy.deepcopy(a); b['state']['publishedRunId'] = 12
        b['ledgerCurrent'] = {'rows': 45, 'credits': '450000', 'latestId': '45'}
        m.prefix_preserved(a, b)
        b['ledgerCurrent']['credits'] = '299999'
        with self.assertRaises(RuntimeError): m.prefix_preserved(a, b)

    def test_scheduled_publication_is_new_10000_run_not_resumed_partial(self):
        a = solana(); b = copy.deepcopy(a); b['observedAt'] = '2026-10-24T05:10:00+00:00'
        b['state']['publishedRunId'] = 12; b['state']['nextScanAt'] = '2026-10-24T06:10:00+00:00'
        b['publishedRun'] = {'id': 12, 'state': 'published', 'assetCount': 10000, 'missingCount': 2,
                             'completedAt': '2026-10-24T05:05:00+00:00'}
        fresh = {'id': 12, 'manifestChecksum': m.MANIFEST_CHECKSUM, 'requestCount': 10, 'startedAt': '2026-10-24T05:00:00+00:00'}
        m.scheduled_publication(a, b, fresh)
        for key, value in [('id', 11), ('requestCount', 9), ('startedAt', '2026-10-24T04:59:59+00:00')]:
            bad = dict(fresh); bad[key] = value
            with self.assertRaises(RuntimeError): m.scheduled_publication(a, b, bad)

    def test_exact_owned_read_delta_and_effective_rights_only(self):
        b, a, edge = catalog(); m.phase_catalog(b, a, [edge])
        a['roles'][0]['login'] = False
        with self.assertRaises(RuntimeError): m.phase_catalog(b, a, [edge])

    def test_unmanaged_SELECT_column_or_grant_option_cannot_hide_in_delta(self):
        b, a, edge = catalog()
        foreign = dict(edge, grantee='999'); a['targetEdges'].append(foreign)
        with self.assertRaises(RuntimeError): m.phase_catalog(b, a, [edge])
        b, a, edge = catalog(); edge = dict(edge, grantable=True)
        with self.assertRaises(RuntimeError): m.phase_catalog(b, a, [edge])
        edge = dict(edge, grantable=False, column_number=1)
        with self.assertRaises(RuntimeError): m.phase_catalog(b, a, [edge])

    def test_static_default_cannot_import_apps_or_run_host_commands(self):
        cp = subprocess.run([sys.executable, '-I', '-B', str(PATH)], capture_output=True, check=True)
        value = json.loads(cp.stdout)
        self.assertFalse(value['qualified']); self.assertEqual(value['providerCalls'], 0)
        self.assertEqual(cp.stderr, b'')

    def test_snapshot_SQL_is_byte_identical_to_accepted_generic_Solana_SQL(self):
        raw = PATH.with_suffix('.solana.sql').read_bytes()
        self.assertEqual(m.sha(raw), m.SQL_SHA)
        self.assertEqual(raw, PATH.parents[1].joinpath('solana-acceptance/supervisor-handover-state-v1.sql').read_bytes())


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.managed-test-', dir=PATH.parents[2])
        self.root = Path(self.temp.name); self.base = self.root / 'base'; self.base.mkdir(mode=0o700)
        self.system = self.root / 'system'; self.system.mkdir(); self.hold = self.system / '.hold'; self.hold.mkdir(mode=0o700)
        self.patch = patch.multiple(m, BASE=self.base, SYSTEM=self.system, HOLD=self.hold)
        self.patch.start()
        self.op = {'operatorSha256': m.sha(m.protected(PATH)), 'bootId': m.boot(), 'inputSha256': 'a' * 64, 'manifestSha256': 'b' * 64}
        m.save(self.base / 'operation.json', self.op)
        self.actor = {'parent': {'pid': 42}, 'processes': [{'pid': 42}], 'unit': {'InvocationID': 'c' * 32}}
        case = self
        class Fake:
            input_sha = 'a' * 64; manifest_sha = 'b' * 64
            current = case.actor; calls = []; gone = False
            def actor(self, unit, allow_terminal=False):
                if self.current is None and not allow_terminal: raise RuntimeError('not_active')
                return copy.deepcopy(self.current)
            def sessions(self, actors): return {'16388': {'owned': {m.SOURCE: [{'pid': 77, 'backendStart': 'fixed'}]}, 'other': [{'pid': 88, 'backendStart': 'other-metadata'}]}}
            def sessions_gone(self, proof):
                m.need(self.current is None and self.gone, 'backend_not_gone')
            def manager(self, action, unit):
                self.calls.append((action, unit)); self.current = None; self.gone = True
        self.h = Fake(); self.owner = m.Owner(self.h)

    def tearDown(self): self.patch.stop(); self.temp.cleanup()

    def test_stop_has_fresh_kernel_session_proof_and_post_intent_actor_CAS(self):
        original = self.owner.put
        def put(name, value):
            result = original(name, value)
            if name == 'stop-intent.json': self.h.current = {'foreign': True}
            return result
        self.owner.put = put
        with self.assertRaisesRegex(RuntimeError, 'post_intent'): self.owner.stop_exact(m.SOURCE, self.actor, 'stop')
        self.assertEqual(self.h.calls, []); self.assertTrue((self.base / 'stop-sessions.json').exists())

    def test_lost_stop_ACK_is_observed_not_repeated(self):
        real = self.h.manager
        def lost(action, unit): real(action, unit); raise RuntimeError('lost_ACK')
        self.h.manager = lost
        with self.assertRaises(RuntimeError): self.owner.stop_exact(m.SOURCE, self.actor, 'stop')
        self.owner.finish_stop(m.SOURCE, self.actor, 'stop')
        self.assertEqual(self.h.calls, [('stop', m.SOURCE)])
        self.assertTrue((self.base / 'stop-result.json').exists())

    def test_unknown_stop_still_live_cannot_be_retried_or_blessed(self):
        m.save(self.base / 'stop-sessions.json', {})
        m.save(self.base / 'stop-intent.json', {'value': {'unit': m.SOURCE, 'actor': self.actor},
                                             'operationSha256': m.sha(m.protected(self.base / 'operation.json'))})
        with self.assertRaises(RuntimeError): self.owner.finish_stop(m.SOURCE, self.actor, 'stop')
        self.assertEqual(self.h.calls, [])

    def test_same_inode_boot_rename_finish_after_lost_ACK(self):
        source = self.system / 'boot'; target = self.hold / 'boot'; os.symlink('/accepted/service', source)
        record = m.identity(source); original = os.rename
        def lost(a, b): original(a, b); raise OSError('lost_local_ACK')
        with patch.object(m.os, 'rename', lost):
            with self.assertRaises(OSError): self.owner.move_owned(source, target, record, 'move')
        self.owner.move_owned(source, target, record, 'move', finish=True)
        self.assertEqual(m.identity(target), record)
        self.owner.move_owned(target, source, record, 'restore')
        self.assertEqual(m.identity(source), record)

    def test_foreign_same_bytes_different_inode_refuses_inverse(self):
        path = self.system / 'new'; self.owner.publish_file('unit', path, b'accepted\n')
        path.unlink(); path.write_bytes(b'accepted\n')
        # Force a distinct inode even on filesystems that immediately reuse one.
        replacement = self.system / 'replacement'; replacement.write_bytes(b'accepted\n'); os.replace(replacement, path)
        with self.assertRaises(RuntimeError): self.owner.owned_new_definition('unit')

    def test_file_publication_prepared_inode_precedes_visible_path(self):
        path = self.system / 'new'; real = os.rename
        def rename(a, b):
            record = m.document(self.base / 'unit-prepared.json')
            self.assertEqual(m.identity(a), record['identity']); self.assertFalse(path.exists()); real(a, b)
        with patch.object(m.os, 'rename', rename): self.owner.publish_file('unit', path, b'accepted\n')
        self.assertEqual(self.owner.owned_new_definition('unit')['sha256'], m.sha(b'accepted\n'))

    def test_full_definition_and_boot_inverse_restores_original_inodes_after_interrupted_intent(self):
        wants = self.system / 'multi-user.target.wants'; wants.mkdir()
        self.h.boot_link = lambda unit: wants / unit
        op = {'activations': {u: {'boot': None, 'definitions': {}} for u in m.UNITS}}
        originals = {}
        for unit in [m.PARENT, m.OBSERVER]:
            p = self.system / unit; p.write_bytes(('original-' + unit).encode()); p.chmod(0o644)
            r = {'sha256': m.sha(m.protected(p)), 'identity': m.identity(p)}
            op['activations'][unit]['definitions'][str(p)] = r
            originals[str(p)] = r['identity']
        for unit in [m.SOURCE, m.SOLANA, m.PARENT, m.OBSERVER]:
            p = wants / unit; os.symlink(str(self.system / unit), p)
            op['activations'][unit]['boot'] = m.link_record(p); originals[str(p)] = m.identity(p)
            self.owner.move_owned(p, self.hold / (unit + '.boot'), m.identity(p), 'hold-boot-' + unit)
        for unit in [m.PARENT, m.OBSERVER]:
            p = self.system / unit
            self.owner.move_owned(p, self.hold / (unit + '.definition-0'), m.identity(p), 'hold-definition-' + unit)
        self.owner.publish_file('managed-unit', self.system / m.PARENT, b'new-managed')
        self.owner.publish_file('observer-unit', self.system / m.OBSERVER, b'new-observer')
        drop = self.system / (m.PARENT + '.d'); drop.mkdir()
        self.owner.publish_file('managed-egress', drop / '90-managed-helius.conf', b'new-egress')
        for unit in [m.PARENT, m.OBSERVER]:
            p = wants / unit; os.symlink(str(self.system / unit), p)
            self.owner.put('new-boot-' + unit + '-prepared.json', {'path': str(p), 'link': m.link_record(p)})
        original = os.rename
        def interrupted(a, b):
            raise OSError('failed_before_first_inverse_rename')
        with patch.object(m.os, 'rename', interrupted):
            with self.assertRaises(OSError): self.owner.restore_files(op, False)
        self.owner.restore_files(op, True)
        self.owner.restore_files(op, True)
        for path, inode in originals.items(): self.assertEqual(m.identity(Path(path)), inode)
        self.assertFalse((drop / '90-managed-helius.conf').exists())
        self.assertEqual(self.h.calls, [])

    def test_protected_report_never_overwrites(self):
        path = self.base / 'result.json'; m.save(path, {'one': 1})
        with self.assertRaises(FileExistsError): m.save(path, {'two': 2})
        self.assertEqual(m.document(path), {'one': 1})

    def test_unknown_start_reconciliation_has_no_start_command(self):
        m.save(self.base / 'parent-start-intent.json', {'notBeforeUs': 1})
        # The actual reconciliation function reaches only kernel/native reads;
        # this failing identity gate cannot call systemctl start a second time.
        self.owner.stable = lambda *_: None
        self.h.managed = lambda _: (_ for _ in ()).throw(RuntimeError('not_owned'))
        with self.assertRaisesRegex(RuntimeError, 'not_owned'): self.owner.accept_parent()
        self.assertEqual(self.h.calls, [])

    def inverse_started_prefix(self, live=True):
        wants = self.system / 'multi-user.target.wants'; wants.mkdir()
        self.h.boot_link = lambda unit: wants / unit
        old_parent = process(42, 1, [m.NODE, '/retained/old-program'], '/retained')
        old_parent['capabilitySetSha256'] = '1' * 64
        old = {'parent': old_parent, 'processes': [old_parent], 'unit': {'InvocationID': 'a' * 32}}
        current = copy.deepcopy(old); current['parent']['pid'] = 43; current['parent']['startTicks'] = 999
        current['unit'] = {'InvocationID': 'b' * 32, 'ExecMainStartTimestampMonotonic': '20'}
        activations = {u: {'boot': None, 'definitions': {}} for u in m.UNITS}
        self.op.update({'units': {u: old if u == m.SOURCE else None for u in m.UNITS}, 'activations': activations})
        frame = {k: '' for k in m.KEYS}; frame.update({'LoadState': 'loaded', 'ExecStart': '{ argv[]=/retained/old-program ; }'})
        self.op['unitDefinitionFrames'] = {u: m.definition_frame(frame) for u in m.UNITS}
        (self.base / 'operation.json').unlink(); m.save(self.base / 'operation.json', self.op)
        m.save(self.base / ('drain-' + m.SOURCE + '-intent.json'), {})
        m.save(self.base / ('drain-' + m.SOURCE + '-result.json'), {})
        before = solana(); after = copy.deepcopy(before)
        after['state']['publishedRunId'] = 12; after['publishedRun']['id'] = 12
        after['ledgerCurrent'] = {'rows': 31, 'credits': '310000', 'latestId': '31'}
        m.save(self.base / 'drained.json', {'solana': before})
        m.save(self.base / 'inverse-drained.json', {'solana': before, 'native': native(), 'solanaFrozen': True})
        intent = {'operationSha256': m.sha(m.protected(self.base / 'operation.json')), 'bootId': m.boot()}
        m.save(self.base / 'inverse-intent.json', intent)
        m.save(self.base / 'inverse-reload-intent.json', {**intent, 'value': {}})
        m.save(self.base / ('inverse-start-' + m.SOURCE + '-intent.json'), {'notBeforeUs': 10})
        def actor(unit, allow_terminal=False):
            value = current if unit == m.SOURCE and live else None
            if value is None and not allow_terminal: raise RuntimeError('not_active')
            return copy.deepcopy(value)
        self.h.actor = actor; self.h.activation = lambda unit: activations[unit]
        self.h.state = lambda unit: frame
        self.h.definitions = lambda unit: {}; self.h.sql_solana = lambda *args: copy.deepcopy(after)
        self.h.native = native; self.h.readiness = lambda: {'fresh': True}
        self.owner.stable = lambda *args: None
        return current

    def test_finish_inverse_lost_original_start_ACK_keeps_new_publication_no_repeat(self):
        current = self.inverse_started_prefix()
        result = self.owner.inverse(True)
        self.assertTrue(result['restored']); self.assertTrue(result['solanaWholePrefixPreserved'])
        self.assertEqual(result['restoredActors'][m.SOURCE], current)
        self.assertEqual(self.h.calls, [])

    def test_finish_inverse_unknown_original_start_still_terminal_never_retries(self):
        self.inverse_started_prefix(live=False)
        with self.assertRaisesRegex(RuntimeError, 'not_active'): self.owner.inverse(True)
        self.assertEqual(self.h.calls, [])

    def test_lost_reload_cannot_start_cached_new_program_under_old_file(self):
        self.inverse_started_prefix()
        real = self.h.state
        self.h.state = lambda u: {**real(u), 'ExecStart': '{ argv[]=/unaccepted/new-program ; }'}
        with self.assertRaisesRegex(RuntimeError, 'original_loaded_commands'): self.owner.inverse(True)
        self.assertEqual(self.h.calls, [])

    def pending_restart(self):
        m.save(self.base / 'parent-start-intent.json', {'notBeforeUs': 1})
        m.save(self.base / 'installed.json', {m.PARENT: {'definitions': {}, 'boot': None}})
        self.h.definitions = lambda unit: {}; self.h.activation = lambda unit: {'boot': None}
        self.h.managed_settings = lambda: None
        state = {'MainPID': '0', 'ControlPID': '0', 'ActiveState': 'activating', 'SubState': 'auto-restart',
                 'NRestarts': '2', 'ExecMainStartTimestampMonotonic': '2'}
        self.h.state = lambda unit: dict(state)
        self.h.failed_parent_quiet = lambda op: {'73004621': {'owned': {}, 'other': []},
                                               '16388': {'owned': {m.METADATA: []}, 'other': []}}
        self.h.current = None
        real = self.h.manager
        def manager(action, unit):
            real(action, unit); state.update({'ActiveState': 'inactive', 'SubState': 'dead'})
        self.h.manager = manager
        return state

    def test_failed_parent_owned_restart_timer_is_cancelled_without_start(self):
        self.pending_restart()
        self.owner.inverse_stop(m.PARENT, 'cancel')
        self.assertEqual(self.h.calls, [('stop', m.PARENT)])
        self.assertIsNone(self.h.current)

    def test_lost_restart_cancel_ACK_is_terminal_reconciled_not_repeated(self):
        self.pending_restart(); real = self.h.manager
        def lost(action, unit): real(action, unit); raise RuntimeError('lost_ACK')
        self.h.manager = lost
        with self.assertRaisesRegex(RuntimeError, 'lost_ACK'): self.owner.inverse_stop(m.PARENT, 'cancel')
        self.owner.inverse_stop(m.PARENT, 'cancel')
        self.assertEqual(self.h.calls, [('stop', m.PARENT)])

    def test_pending_restart_CAS_race_proves_no_command_before_explicit_new_stop(self):
        state = self.pending_restart()
        def proof(op):
            state.update({'MainPID': '42', 'ActiveState': 'active', 'SubState': 'running'})
            self.h.current = self.actor
            return {'16388': {'owned': {}, 'other': []}}
        self.h.failed_parent_quiet = proof
        with self.assertRaisesRegex(RuntimeError, 'no_command_invoked'): self.owner.inverse_stop(m.PARENT, 'cancel')
        self.assertEqual(self.h.calls, [])
        self.h.managed = lambda _: copy.deepcopy(self.actor)
        self.owner.inverse_stop(m.PARENT, 'cancel')
        self.assertTrue((self.base / 'cancel-after-CAS-intent.json').exists())
        self.assertEqual(self.h.calls, [('stop', m.PARENT)])

    def test_process_group_timeout_kills_grandchild_not_only_launcher(self):
        marker = self.root / 'child.pid'
        code = "import subprocess,time,pathlib; p=subprocess.Popen(['" + sys.executable + "','-c','import time; time.sleep(30)']);pathlib.Path('" + str(marker) + "').write_text(str(p.pid));time.sleep(30)"
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired): m.command([sys.executable, '-I', '-B', '-c', code], timeout=0.4)
        self.assertLess(time.monotonic() - started, 3)
        pid = int(marker.read_text()); p = Path('/proc') / str(pid) / 'stat'
        self.assertTrue(not p.exists() or p.read_text().split(') ')[1].startswith('Z'))


if __name__ == '__main__': unittest.main()
