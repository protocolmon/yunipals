#!/usr/bin/env python3
"""Native120 controls; private creator/catalog/peer observations are explicit I/O fixtures, never live DB."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
FILE = HERE / 'ypal-native-metadata-readiness-policy-v2.py'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load(FILE, 'readiness_policy_controls')
old_tests = load(HERE / 'ypal-ordinary-readview-v5.test.py', 'actual_old_creator_fixture')


class Controls(unittest.TestCase):
    def setUp(self):
        self.legacy = old_tests.Controls('test_source_free_recorded_ack_uses_genuine_intake_reader_signature')
        self.legacy.setUp()
        # The old fixture produces real immutable creator/rehearsal/intent receipts.
        # Supply the genuine frozen generated PL/pgSQL body, in pg_get_functiondef's
        # CREATE OR REPLACE spelling; all other catalog values remain explicit fixtures.
        target = self.legacy.target()
        statement = next(row['sql'] for row in self.legacy.plan['expectedOwnerStatements']
                         if row['sql'].startswith('CREATE FUNCTION') and '.base_metadata_frame(' in row['sql'])
        body = statement.replace('CREATE FUNCTION "' + m.READ_SCHEMA + '".', 'CREATE OR REPLACE FUNCTION ' + m.READ_SCHEMA + '.', 1)
        next(row for row in target['functions'] if row['name'] == m.FUNCTION)['definition'] = body
        self.legacy.target = lambda: copy.deepcopy(target)
        review = self.legacy.prepare_fake_database()
        self.legacy.n.rehearse(*self.legacy.args, review['reviewHash'])
        self.legacy.n.commit(*self.legacy.args, review['reviewHash'])
        self.created_sha = m.sha((self.legacy.base / 'created.json').read_bytes())
        self.temp = tempfile.TemporaryDirectory(prefix='.readiness-policy-', dir=HERE.parents[1])
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.base = self.root / 'policy'; self.input = self.root / 'input.json'; self.manifest = self.root / 'manifest.json'
        self.config = {'format': m.FORMAT + '-input', 'createdReceiptSha256': self.created_sha}
        self.input.write_bytes(m.encoded(self.config)); self.input.chmod(0o600)
        self.input_sha = m.sha(self.input.read_bytes())
        self.manifest.write_bytes(m.encoded({'format': m.FORMAT + '-source', 'files': {FILE.name: m.sha(FILE.read_bytes()), **m.SOURCE_PINS}}))
        self.manifest.chmod(0o600)
        self.patches = [patch.object(m, 'FILE', FILE), patch.object(m, 'OPS', HERE), patch.object(m, 'MANIFEST', self.manifest),
                        patch.object(m, 'INPUT', self.input), patch.object(m, 'BASE', self.base), patch.object(m, 'CREATOR_BASE', self.legacy.base),
                        patch.object(m, 'CREATOR', HERE / m.CREATOR.name), patch.object(m, 'TEMPLATE', HERE / m.TEMPLATE.name)]
        for p in self.patches: p.start()
        real_load = m.load
        def source(path):
            if Path(path).name == m.CREATOR.name:
                m.public(path, m.SOURCE_PINS[Path(path).name])
                return self.legacy.__class__.__module__ and old_tests.m
            return real_load(path)
        self.patch('load', source)
        self.before = {'databaseOid': '17584', 'target': copy.deepcopy(target), 'schemaAcl': '{postgres=UC/postgres}',
                       'columnAcl': [{'relationOid': '1000', 'column': 1, 'name': 'fixture', 'acl': None}]}
        self.actual = copy.deepcopy(self.before); self.sql_calls = []; self.status = {}; self.next_xid = 93000

    def patch(self, name, value):
        p = patch.object(m, name, value); p.start(); self.patches.append(p)

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup(); self.legacy.tearDown()

    def simulated_peer(self, sql, readonly=True, journal=None):
        self.sql_calls.append((sql, readonly, journal))
        if readonly:
            if 'pg_xact_status' in sql:
                return [self.status[sql.split("pg_xact_status('", 1)[1].split("'", 1)[0]]]
            return [copy.deepcopy(self.actual)]
        operation = m.document(self.base / 'operation.json')
        self.assertEqual(self.actual, operation['before'])
        self.next_xid += 1; xid = str(self.next_xid)
        rows = [{'transactionId': xid, 'guard': 1}, {'after': copy.deepcopy(operation['after']), 'guard': 1}]
        committed = sql.endswith('COMMIT;')
        self.status[xid] = 'committed' if committed else 'aborted'
        if committed: self.actual = copy.deepcopy(operation['after'])
        if journal:
            m.write(journal + '-child.json', {'pid': 4242, 'processStat': 'explicit fixture', 'requestSha256': m.sha(sql.encode()), 'automaticRetryAllowed': False})
            m.transport(journal, sql, types.SimpleNamespace(pid=4242, returncode=0), b''.join(m.encoded(row) for row in rows), b'', None)
        return rows

    def rehearse(self):
        self.patch('peer', self.simulated_peer)
        review = m.review(self.input_sha); m.rehearse(self.input_sha, review['reviewHash']); return review

    def apply(self):
        review = self.rehearse(); result = m.apply(self.input_sha, review['reviewHash']); return result['receiptSha256']

    def test_default_inert_and_exact_source_manifest_precedes_old_module(self):
        value = subprocess.run([sys.executable, '-I', '-B', str(FILE)], check=True, capture_output=True)
        self.assertTrue(json.loads(value.stdout)['staticOnly']); self.assertFalse(value.stderr)
        m.authenticate()
        bad = json.loads(self.manifest.read_bytes()); bad['files'][m.CREATOR.name] = 'f' * 64
        self.manifest.write_bytes(m.encoded(bad))
        with patch.object(m, 'load', side_effect=AssertionError('no eval before complete authentication')):
            with self.assertRaisesRegex(RuntimeError, 'source_manifest'): m.context(self.input_sha)

    def test_genuine_creator_ACK_chain_and_query_body_are_retained(self):
        self.legacy.i.validate_runtime = lambda *_: (_ for _ in ()).throw(AssertionError('no current Source'))
        config, target = m.context(self.input_sha)
        self.assertEqual(config, self.config); self.assertEqual(target, self.before['target'])
        original = load(HERE / m.TEMPLATE.name, 'genuine_query_body')
        wanted = types.FunctionType(original.target_sql.__code__, {**original.target_sql.__globals__, 'READ_SCHEMA': m.READ_SCHEMA})({})
        sql = m.snapshot_sql(); self.assertIn(wanted, sql)
        self.assertIn('a.attacl::text', sql); self.assertIn("'databaseOid'", sql)
        self.assertNotIn('FROM metadata_source.native_base_metadata_state', wanted)
        bad = self.legacy.base / 'commit-intent.json'; value = json.loads(bad.read_bytes()); value['automaticRetryAllowed'] = True; bad.write_bytes(m.encoded(value))
        with self.assertRaises(RuntimeError): m.context(self.input_sha)

    def test_exact_one_body_delta_and_official_future_build_literal(self):
        changed = m.amend_target(self.before['target'])
        original = m.function_row(self.before['target'])['definition']; after = m.function_row(changed)['definition']
        self.assertEqual(after.replace(m.NEW, m.OLD), original)
        self.assertEqual(m.function_row(changed)['oid'], m.function_row(self.before['target'])['oid'])
        for body in [original + m.OLD, original.replace(m.OLD, m.NEW), original.replace(m.IMPLEMENTATION, 'foreign'), original.replace(m.READ_IDENTITY, 'foreign')]:
            with self.assertRaises(RuntimeError): m.amend_definition(body)
        official = HERE.parents[1] / 'apps/yunipals-indexer/lib/unified/base-metadata-views.ts'
        raw = official.read_bytes(); self.assertEqual(raw.count(m.NEW.encode()), 1); self.assertNotIn(m.OLD.encode(), raw)
        self.assertEqual(m.sha(raw.replace(m.NEW.encode(), m.OLD.encode())), 'dc323df6d6a80367be146b9122ea3e3f3505f9101f283adad921c2271163fb73')
        native = (HERE.parents[1] / 'apps/yunipals-indexer/lib/metadata/native-base.ts').read_text()
        self.assertIn("interval '60 seconds'", native)

    def test_SQL_is_one_function_no_grants_data_services_or_approval_rewrite(self):
        after = {**copy.deepcopy(self.before), 'target': m.amend_target(self.before['target'])}
        sql = m.amendment_sql(self.before, after, True)
        self.assertEqual(sql.count('CREATE OR REPLACE FUNCTION'), 3)  # definition plus two exact JSON guards
        self.assertIn('DO $policy_lock$ BEGIN PERFORM pg_advisory_xact_lock', sql)
        self.assertTrue(sql.endswith('COMMIT;')); self.assertTrue(m.amendment_sql(self.before, after).endswith('ROLLBACK;'))
        self.assertNotIn('GRANT ', sql); self.assertNotIn('DROP ', sql); self.assertNotIn('UPDATE metadata_source', sql)
        for mutate in [lambda v: v['target']['functions'][0].update(oid='99999'), lambda v: v.update(schemaAcl=None), lambda v: v['columnAcl'][0].update(acl='changed')]:
            bad = copy.deepcopy(after); mutate(bad)
            with self.assertRaises(RuntimeError): m.amendment_sql(self.before, bad, True)

    def test_rehearse_apply_pure_ACK_expected_target_current_and_no_repeat(self):
        result_sha = self.apply(); self.sql_calls.clear()
        ack = m.acknowledgement(result_sha)
        self.assertEqual(ack['policyTTLSeconds'], 120); self.assertTrue(ack['immutableAcknowledgementOnly']); self.assertFalse(ack['actualPolicyBodyCurrent'])
        self.assertFalse(self.sql_calls); self.assertFalse(ack['originalCreatorWholeValidatorPassed'])
        self.assertEqual(m.expected_target(self.before['target'], result_sha), self.actual['target'])
        current = m.current(result_sha)
        self.assertTrue(current['actualPolicyBodyCurrent']); self.assertEqual(current['databaseWrites'], 0)
        self.assertEqual(current['functionOid'], ack['functionOid'])
        before = len([row for row in self.sql_calls if not row[1]])
        with self.assertRaises(RuntimeError): m.apply(self.input_sha, m.document(self.base / 'operation.json')['reviewHash'])
        self.assertEqual(len([row for row in self.sql_calls if not row[1]]), before)

    def test_current_all_body_OID_marker_and_columns_drift_fail_permissions_separate(self):
        digest = self.apply(); good = copy.deepcopy(self.actual)
        self.actual['target']['nonownerPermissions'] = 17; self.actual['target']['relations'][0]['acl'] = 'separately owned grant'
        self.actual['columnAcl'][0]['acl'] = 'separately owned column grant'
        self.assertTrue(m.current(digest)['permissionChangesRequireSeparateGraphAuthority'])
        for mutate in [lambda v: v['target'].update(schemaOid='88'), lambda v: v['target']['marker'].update(identity='foreign'),
                       lambda v: v['target']['functions'][0].update(definition='foreign'), lambda v: v['target']['functions'][0].update(oid='999'),
                       lambda v: v['target']['relations'][0]['columns'].append({'name': 'foreign'})]:
            self.actual = copy.deepcopy(good); mutate(self.actual)
            with self.assertRaises(RuntimeError): m.current(digest)
        host = types.SimpleNamespace(query=lambda _: copy.deepcopy(good))
        self.assertTrue(m.current(digest, host)['actualPolicyBodyCurrent'])

    def test_rehearsal_tamper_refuses_before_apply_transport(self):
        review = self.rehearse(); path = self.base / 'rehearsal-intent.json'; value = json.loads(path.read_bytes()); value['automaticRetryAllowed'] = True
        path.write_bytes(m.encoded(value)); count = len(self.sql_calls)
        with self.assertRaises(RuntimeError): m.apply(self.input_sha, review['reviewHash'])
        self.assertEqual(len(self.sql_calls), count); self.assertFalse((self.base / 'apply-intent.json').exists())

    def test_saved_operation_binds_exact120_and_original_creator_even_with_review_hash(self):
        self.rehearse(); path = self.base / 'operation.json'; original = json.loads(path.read_bytes())
        for values in [{'policyTTLSeconds': '120'}, {'policyTTLSeconds': 90}, {'policyTTLSeconds': True},
                       {'originalCreatorReceiptSha256': 'f' * 64}]:
            bad = {**copy.deepcopy(original), **values}
            bad['reviewHash'] = m.sha(m.encoded({k: v for k, v in bad.items() if k != 'reviewHash'}))
            path.write_bytes(m.encoded(bad))
            with self.assertRaisesRegex(RuntimeError, 'owned_policy_operation'): m._saved(self.input_sha)
        path.write_bytes(m.encoded(original)); self.assertEqual(m._saved(self.input_sha), original)

    def test_result_and_transport_tamper_refuse_pure_ACK(self):
        digest = self.apply()
        for name, mutate in [('apply-transport.json', lambda v: v.update(stderrBase64=base64.b64encode(b'failure').decode())),
                             ('apply-sql-observation.json', lambda v: v['rows'][0].update(guard=True)),
                             ('operation.json', lambda v: v['after']['columnAcl'][0].update(acl='foreign'))]:
            path = self.base / name; raw = path.read_bytes(); value = json.loads(raw); mutate(value); path.write_bytes(m.encoded(value))
            with self.assertRaises(RuntimeError): m.acknowledgement(digest)
            path.write_bytes(raw)
        value = json.loads((self.base / 'result.json').read_bytes()); value['policyTTLSeconds'] = True
        (self.base / 'result.json').write_bytes(m.encoded(value))
        with self.assertRaises(RuntimeError): m.acknowledgement(m.sha(m.encoded(value)))

    def test_transport_args_exact_timeout_private_capture_and_original_exception(self):
        self.base.mkdir(mode=0o700); calls = []
        class Fake:
            pid = 456789; returncode = 0
            def communicate(self, data=None, timeout=None): calls.append(('communicate', data, timeout)); return b'{"fixture":true}\n', b''
        def popen(argv, **kwargs): calls.append((argv, kwargs)); return Fake()
        with patch.object(m.subprocess, 'Popen', popen), patch.object(m.Path, 'read_text', return_value='private proc fixture'):
            self.assertEqual(m.peer('SELECT fixture;', False, 'apply'), [{'fixture': True}])
        argv, kwargs = calls[0]; self.assertIn('--bounding-set=-all', argv); self.assertEqual(kwargs['env'], m.CLEAN)
        self.assertEqual(kwargs['cwd'], '/'); self.assertTrue(kwargs['start_new_session']); self.assertEqual(calls[1][-1], 80)
        self.assertEqual(stat.S_IMODE((self.base / 'apply-transport.json').stat().st_mode), 0o600)
        original = TimeoutError('original deadline')
        class Broken(Fake):
            def communicate(self, *args, **kwargs): raise original
        with patch.object(m.subprocess, 'Popen', return_value=Broken()), patch.object(m.Path, 'read_text', return_value='private'), \
             patch.object(m.os, 'killpg', side_effect=PermissionError('secondary')), patch.object(m, 'transport', side_effect=MemoryError('secondary')):
            with self.assertRaises(TimeoutError) as caught: m.peer('SELECT fixture;', False, 'rehearsal')
        self.assertIs(caught.exception, original)

    def test_exact_shared_lock_releases_and_contends_without_mutation(self):
        lock = self.root / 'shared.lock'
        with patch.object(m, 'LOCK', lock):
            with m.transition_lock():
                with self.assertRaises(BlockingIOError):
                    with m.transition_lock(): self.fail('second lock entered')
            with m.transition_lock(): pass
        self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o600)

    def test_actual_sticky_parent_allows_only_fixed_root_directory_and_keeps_lock_inode(self):
        parent = self.root / 'fixed-run-lock'; parent.mkdir(mode=0o700); parent.chmod(0o1777)
        lock = parent / 'shared.lock'
        with patch.object(m, 'LOCK', lock):
            with self.assertRaisesRegex(RuntimeError, 'lock_parent_required'):
                with m.transition_lock(): self.fail('generic writable sticky parent was admitted')
            self.assertFalse(lock.exists())
        # Both fixed paths are relocated to a real temporary sticky directory.
        # Production constants remain the literal /run/lock shared-lock path.
        with patch.object(m, 'LOCK', lock), patch.object(m, 'LOCK_DIRECTORY', parent):
            with m.transition_lock():
                first = lock.stat()
                self.assertEqual(stat.S_IMODE(first.st_mode), 0o600)
                self.assertEqual((first.st_uid, first.st_gid, first.st_nlink), (0, 0, 1))
                with self.assertRaises(BlockingIOError):
                    with m.transition_lock(): self.fail('second flock entered')
            with m.transition_lock(): self.assertEqual(lock.stat().st_ino, first.st_ino)
        self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o1777)

    def test_sticky_parent_never_allows_foreign_lock_symlink_or_nonsticky_writable_parent(self):
        parent = self.root / 'fixed-run-lock'; parent.mkdir(mode=0o700); parent.chmod(0o1777)
        lock = parent / 'shared.lock'; lock.touch(mode=0o600)
        with patch.object(m, 'LOCK', lock), patch.object(m, 'LOCK_DIRECTORY', parent):
            # This sandbox cannot map a foreign UID for chown (EINVAL). Supply
            # only the foreign fstat owner reply; directory/file/flock/symlink
            # operations below use real owned temporary inodes.
            actual_fstat = m.os.fstat
            def foreign_fstat(fd):
                row = actual_fstat(fd)
                return types.SimpleNamespace(**{key: getattr(row, key) for key in m.FRAME if key not in {'st_uid', 'st_gid'}},
                                             st_uid=65534, st_gid=65534)
            with patch.object(m.os, 'fstat', side_effect=foreign_fstat), self.assertRaisesRegex(RuntimeError, 'existing_transition_lock_required'):
                with m.transition_lock(): self.fail('foreign lock entered')
            lock.unlink(); target = parent / 'target'; target.touch(mode=0o600)
            lock.symlink_to(target)
            with self.assertRaises(OSError):
                with m.transition_lock(): self.fail('symlink lock entered')
            lock.unlink(); parent.chmod(0o777)
            with self.assertRaisesRegex(RuntimeError, 'lock_parent_required'):
                with m.transition_lock(): self.fail('nonsticky writable parent entered')
            self.assertFalse(lock.exists())
            parent.chmod(0o1777); lock.touch(mode=0o644)
            with self.assertRaisesRegex(RuntimeError, 'existing_transition_lock_required'):
                with m.transition_lock(): self.fail('publicly readable lock entered')


if __name__ == '__main__': unittest.main()
