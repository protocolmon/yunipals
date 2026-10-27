#!/usr/bin/env python3
"""Offline owner controls: no production SQL, service or provider calls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('ypal-reader-cutover-v1.py')
spec = importlib.util.spec_from_file_location('ypal_reader', FILE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def catalog(admitted=False, usage=False):
    value = {'databaseOid': m.DATABASE_OID, 'role': {'oid': m.ROLE_OID, 'name': m.ROLE, 'login': True, 'limit': 6, 'super': False, 'inherit': False, 'createRole': False, 'createDatabase': False, 'replication': False, 'bypassRls': False, 'memberships': [], 'validUntil': None, 'passwordConfigured': False}, 'schemas': {m.OLD_SCHEMA: {'oid': '100', 'owner': m.WRITER_OID, 'acl': [], 'usage': True, 'create': False}, m.SCHEMA: {'oid': '200', 'owner': m.WRITER_OID, 'acl': [], 'usage': usage or admitted, 'create': False}}, 'tables': [], 'edges': [{'kind': 'relation', 'object': 'old-other', 'grantor': 'fixed', 'privilege': 'SELECT', 'grantable': False}]}
    for i, schema in enumerate(sorted((m.SCHEMA, m.OLD_SCHEMA))):
        for n, name in enumerate(m.TABLES): value['tables'].append({'schema': schema, 'name': name, 'oid': str(1000 + 100 * i + n), 'owner': m.WRITER_OID, 'acl': [], 'kind': 'r', 'select': schema == m.OLD_SCHEMA or admitted, 'writes': False})
    if usage or admitted:
        value['schemas'][m.SCHEMA]['acl'].append({'grantee': m.ROLE_OID, 'grantor': m.WRITER_OID, 'privilege': 'USAGE', 'grantable': False})
        value['edges'].append({'kind': 'schema', 'object': '200', 'grantor': m.WRITER_OID, 'privilege': 'USAGE', 'grantable': False})
    if admitted:
        for row in value['tables']:
            if row['schema'] == m.SCHEMA:
                row['acl'].append({'grantee': m.ROLE_OID, 'grantor': m.WRITER_OID, 'privilege': 'SELECT', 'grantable': False})
                value['edges'].append({'kind': 'relation', 'object': row['oid'], 'grantor': m.WRITER_OID, 'privilege': 'SELECT', 'grantable': False})
    return value


class Controls(unittest.TestCase):
    def test_actual_source_producer_missing_means_no_review_or_apply_authority(self):
        with patch.object(m, 'SOURCE_START_SHA', None):
            self.assertRaisesRegex(RuntimeError, 'not_yet_bound', m.source_module)

    def test_real_frozen_source_producer_interface_loads_without_actions(self):
        with patch.object(m, 'SOURCE_START_FILE', FILE.with_name('ypal-source-start-v1.py').absolute()):
            source = m.source_module()
            self.assertEqual(source.FORMAT, 'yunipals-ypal-source-start-v1')
            self.assertEqual(source.SCHEMA, m.SCHEMA)
            self.assertTrue(callable(source.validate_current))
            self.assertTrue(callable(source.validate_owned))

    def test_exact_ten_actual_oids_plus_only_needed_schema_usage(self):
        for usage in (False, True):
            before, after = catalog(False, usage), catalog(True, usage)
            self.assertTrue(m.validate_delta(before, after)); sql = m.grant_sql(before, after, True)
            self.assertEqual(sql.count('GRANT SELECT ON TABLE '), 10)
            self.assertEqual(sql.count('GRANT USAGE ON SCHEMA '), 0 if usage else 1)
            self.assertTrue(sql.endswith('COMMIT;')); self.assertNotIn('ALTER ROLE', sql)
            self.assertNotIn('INSERT INTO', sql); self.assertNotIn('GRANT ALL', sql)

    def test_extra_update_grant_option_wrong_role_login_limit_owner_or_old_reads_refuse(self):
        for mutate in [lambda c: c['role'].update(limit=-1), lambda c: c['role'].update(login=False), lambda c: c['role'].update(oid='999'), lambda c: c['role'].update(inherit=True), lambda c: c['tables'][0].update(writes=True), lambda c: c['tables'][0].update(owner='999'), lambda c: c['tables'].pop(), lambda c: c['schemas'][m.SCHEMA].update(create=True)]:
            c = catalog(True); mutate(c); self.assertRaises(RuntimeError, m.validate_catalog, c, True)
        for mutate in [lambda c: c['edges'].append({'kind': 'relation', 'object': '999', 'grantor': 'x', 'privilege': 'UPDATE', 'grantable': False}), lambda c: c['edges'][-1].update(grantable=True), lambda c: c['edges'][0].update(grantor='changed'), lambda c: c['tables'][0]['acl'].append({'grantee': '0', 'grantor': m.WRITER_OID, 'privilege': 'SELECT', 'grantable': False})]:
            c = catalog(True); mutate(c); self.assertRaises(RuntimeError, m.validate_delta, catalog(), c)

    def test_rehearsal_rolls_back_and_inverse_restores_only_owned_delta(self):
        before, after = catalog(), catalog(True)
        self.assertTrue(m.grant_sql(before).endswith('ROLLBACK;'))
        inverse = m.grant_sql(after, before, True, True)
        self.assertEqual(inverse.count('REVOKE SELECT ON TABLE '), 10)
        self.assertEqual(inverse.count('REVOKE USAGE ON SCHEMA '), 1)
        self.assertNotIn('DROP ', inverse); self.assertNotIn('ALTER ROLE', inverse)
        retained_usage = m.grant_sql(catalog(True, True), catalog(False, True), True, True)
        self.assertNotIn('REVOKE USAGE', retained_usage)

    def test_catalog_cas_has_exact_oid_grantor_edges_before_and_after(self):
        before, after = catalog(), catalog(True); sql = m.grant_sql(before, after, True)
        self.assertEqual(sql.count("RAISE EXCEPTION 'exact_reader_catalog_CAS_required'"), 2)
        self.assertIn('pg_advisory_xact_lock', sql); self.assertIn('pg_default_acl', sql)
        self.assertIn('grantor', sql); self.assertIn(before['tables'][0]['oid'], sql)

    def test_readonly_old_identity_accepts503_but_never_wrong_target(self):
        class H:
            def request(self, path): return 503, {'collection': '0x105319be2182018c31fb10b1be198c3cf238a146', 'engine': '0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609'}
        self.assertEqual(m.old_target(H())['engine'], '0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609')
        h = H(); h.request = lambda path: (503, {'collection': '0xwrong', 'engine': '0xwrong'})
        self.assertRaises(RuntimeError, m.old_target, h)

    def test_inverse_refuses_foreign_same_byte_inode(self):
        with tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
            root = Path(name); base = root / 'evidence'; base.mkdir(); dest = root / 'public.env'
            with patch.object(m, 'BASE', base), patch.object(m, 'PUBLIC_ENV', dest), patch.object(m, 'DROPS', {}):
                record = m.create_overlay(dest, b'PUBLIC=value\n'); retained = root / 'retained'; dest.rename(retained); dest.write_bytes(b'PUBLIC=value\n')
                self.assertRaises(RuntimeError, m.owned_overlay, record)
                self.assertTrue(retained.exists()); self.assertTrue(dest.exists())

    def test_exclusive_publication_never_overwrites_existing_file(self):
        with tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
            root = Path(name); base = root / 'evidence'; base.mkdir(); dest = root / 'public.env'; dest.write_bytes(b'foreign')
            with patch.object(m, 'BASE', base), patch.object(m, 'PUBLIC_ENV', dest), patch.object(m, 'DROPS', {}):
                self.assertRaises(RuntimeError, m.create_overlay, dest, b'ours'); self.assertEqual(dest.read_bytes(), b'foreign')

    def test_lost_link_ack_is_reconciled_only_by_explicit_inverse_exact_staged_inode(self):
        with tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
            root = Path(name); base = root / 'evidence'; base.mkdir(); dest = root / 'public.env'; link = m.os.link
            def lost(*args, **kwargs): link(*args, **kwargs); raise RuntimeError('lost_link_ack')
            with patch.object(m, 'BASE', base), patch.object(m, 'PUBLIC_ENV', dest), patch.object(m, 'DROPS', {}):
                with patch.object(m.os, 'link', lost): self.assertRaises(RuntimeError, m.create_overlay, dest, b'public')
                self.assertRaises(RuntimeError, m.publications)
                rows = m.publications(True); self.assertEqual(len(rows), 1); m.owned_overlay(rows[0]); self.assertEqual(dest.stat().st_nlink, 1)

    def test_actor_or_private_input_change_refuses_before_grants(self):
        class H:
            source_pin = 'actual'
            def source(self): return {'receiptSha256': 'actual'}
            def independent(self): return {'unchanged': True}
            def inputs(self): return None
            def catalog(self): return catalog()
        binding = {'operatorSha256': m.sha(m.protected(FILE.absolute())), 'bootId': m.boot(), 'sourceReceiptSha256': 'actual', 'independent': {'unchanged': False}, 'before': catalog()}
        self.assertRaisesRegex(RuntimeError, 'unchanged_OG', m.check_binding, H(), binding, False)

    def test_same_pid_private_environment_drift_refuses_before_any_manager_entry(self):
        with tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
            root = Path(name); base = root / 'base'; prepared = root / 'prepared'; base.mkdir(); prepared.mkdir()
            m.save(prepared / 'operation.json', {'snapshot': {'privateInputHashes': {'fixed-private-file': {'sha256': 'original'}}}})
            h = object.__new__(m.Host); h.inputs = lambda: None
            h.h = types.SimpleNamespace(observer=types.SimpleNamespace(file_pin=lambda path: {'sha256': 'changed'}))
            with patch.object(m, 'BASE', base), patch.object(m, 'PREPARED', prepared), patch.object(m, 'unix_account', lambda: None), patch.object(m.subprocess, 'run') as run:
                self.assertRaisesRegex(RuntimeError, 'private_reader_input_changed', h.manager, 'stop', m.TIMER)
                run.assert_not_called()

    def test_actual_native_checkpoint_readiness_refuses_zero_stale_foreign_build(self):
        parity_path = FILE.parents[1] / 'unified-indexer-transition/booster-source-parity-v3.py'
        spec = importlib.util.spec_from_file_location('parity', parity_path); parity = importlib.util.module_from_spec(spec); spec.loader.exec_module(parity)
        import time
        now = int(time.time())
        checkpoint = str(now).zfill(10) + str(8453).zfill(16) + str(52999999).zfill(16) + '9' * 33
        good = {'app': {'build_id': m.BUILD, 'version': '6', 'is_dev': '0', 'is_ready': '1', 'is_locked': '1', 'heartbeat_at': now * 1000}, 'checkpoint': checkpoint}
        h = object.__new__(m.Host); h.core = types.SimpleNamespace(parity=parity); h.query = lambda text: good
        self.assertEqual(h.ready()['completeBlock'], 52999999)
        for update in ({'is_ready': '0'}, {'is_locked': '0'}, {'build_id': 'old-build'}, {'heartbeat_at': (now - 181) * 1000}):
            altered = copy.deepcopy(good); altered['app'].update(update); h.query = lambda text: altered
            self.assertRaises(RuntimeError, h.ready)

    def test_completed_and_partial_new_API_start_have_owned_inverse_without_source_restart(self):
        for completed in (False, True):
            with self.subTest(completed=completed), tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
                root = Path(name); base = root / 'base'; base.mkdir(); env = root / 'etc' / 'public.env'
                drops = {m.API: root / 'api.d' / '95-ypal.conf', m.QUEUE: root / 'queue.d' / '95-ypal.conf'}
                with patch.object(m, 'BASE', base), patch.object(m, 'PUBLIC_ENV', env), patch.object(m, 'DROPS', drops):
                    old = {'Id': m.API, 'MainPID': '11', 'InvocationID': 'a' * 32, 'ExecMainStartTimestampMonotonic': '5', 'startTicks': 5}
                    current = {'Id': m.API, 'MainPID': '22', 'InvocationID': 'b' * 32, 'ExecMainStartTimestampMonotonic': '30', 'startTicks': 30}
                    binding = {'operatorSha256': m.sha(m.protected(FILE.absolute())), 'bootId': m.boot(), 'sourceReceiptSha256': 'f' * 64, 'independent': {'fixed': True}, 'definitions': {'exact': True}, 'inputs': {'values': {'BOOSTER_DATABASE_SCHEMA': m.SCHEMA}}, 'API': old}
                    admission = {'before': catalog(), 'after': catalog(True)}
                    m.save(base / 'admission.json', admission); binding['admissionSha256'] = m.sha(m.protected(base / 'admission.json'))
                    m.save(base / 'switch-review.json', binding); m.save(base / 'original-readyz.json', {'monsters': 'old', 'engine': 'old'})
                    m.save(base / 'start-fresh-api-intent.json', {'bootId': m.boot(), 'monotonicUs': 10})
                    for path in [env, *drops.values()]: m.create_overlay(path, b'public-only\n')
                    if completed:
                        m.save(base / 'result.json', {'operatorSha256': binding['operatorSha256']}); pin = m.sha(m.protected(base / 'result.json'))
                    else: pin = m.sha(m.protected(base / 'switch-review.json'))
                    class H:
                        source_pin = 'f' * 64
                        inverse_mode = False
                        def __init__(self): self.api = current; self.graph = admission['after']; self.calls = []
                        def source(self): assert self.inverse_mode; return {'ownedButMayBeTerminal': True}
                        def inputs(self): return None
                        def independent(self): return {'fixed': True}
                        def catalog(self): return self.graph
                        def state(self, unit): return {'MainPID': self.api['MainPID'] if unit == m.API else '0'}
                        def actor(self, unit, expected=None): return self.api
                        def manager(self, action, unit=None, expected=None):
                            self.calls.append((action, unit))
                            if unit == m.API and action == 'stop': assert expected == current; self.api = {**current, 'MainPID': '0'}
                            if unit == m.API and action == 'start': self.api = {**old, 'MainPID': '33', 'InvocationID': 'c' * 32}
                        def quiet(self, unit): assert self.state(unit)['MainPID'] == '0'
                        def definitions(self): return {'exact': True}
                        def availability(self, old, inverse=False): assert inverse; return {'oldTargetIdentity': True, 'status': 503}
                        def sql(self, sql): assert 'REVOKE SELECT' in sql; self.graph = admission['before']; return json.dumps(self.graph)
                    h = H(); result = m.inverse(h, pin)
                    self.assertTrue(result['originalRoleGraphRestored']); self.assertEqual(result['sourceChanges'], 0)
                    self.assertTrue(result['oldTarget']['oldTargetIdentity']); self.assertEqual(result['API']['MainPID'], '33')
                    self.assertFalse(any(path.exists() for path in [env, *drops.values()]))
                    self.assertFalse(any(unit and unit not in {m.API, m.QUEUE, m.TIMER} for _, unit in h.calls))

    def test_active_owned_source_without_readiness_is_inverse_only_and_still_identity_fenced(self):
        with tempfile.TemporaryDirectory(prefix='.reader-test-', dir=FILE.parent) as name:
            root = Path(name); owner_base = root / 'source'; owner_base.mkdir()
            actor = {'unit': 'fresh-source', 'pid': 22, 'invocation': 'b' * 32, 'startTicks': 2, 'cgroup': '/exact', 'actorPids': [22, 23]}
            binding = {'buildId': m.BUILD, 'preparedResultSha256': 'c' * 64}
            table_oids = {name: str(1000 + n) for n, name in enumerate(m.TABLES)}
            result = {'format': 'actual-source-format', 'operatorSha256': m.SOURCE_START_SHA, 'bootId': m.boot(), 'ready': True, 'operationSha256': 'd' * 64, 'source': actor, 'schemaOid': '200', 'readTableOids': table_oids}
            m.save(owner_base / 'result.json', result); pin = m.sha(m.protected(owner_base / 'result.json')); m.save(owner_base / 'boot-created.json', {'owned': True})
            source_m = types.SimpleNamespace(protected=m.protected, boot=m.boot, load=m.document)
            current_catalog = {'schemaOid': '200', 'owner': m.WRITER_OID, 'app': {'build_id': m.BUILD, 'version': '6', 'is_dev': '0', 'is_ready': '0', 'heartbeat_at': 1}, 'tables': table_oids}
            state = {'MainPID': '22', 'UnitFileState': 'enabled'}
            class SourceHost:
                def __init__(self, module): self.h = types.SimpleNamespace(query=lambda sql: current_catalog)
                def unit(self, bound): return state
                def fresh_actor(self, bound, intent): return actor
                def sessions(self, bound, observed): return {'complete': True, 'freshSourceSessions': 1}
            class Controller:
                def __init__(self, host): pass
                def load(self, sha): self_sha = sha; return binding
                def owned_start(self): return {'actual': True}, actor
                def old_terminal(self, bound): return {'terminal': True, 'enabled': False}
            owner = types.SimpleNamespace(prepare_module=lambda: source_m, Host=SourceHost, SourceStart=Controller, BASE=owner_base,
                FORMAT='actual-source-format', self_sha=lambda module: m.SOURCE_START_SHA, BOOT_FILE=root / 'fixed-boot', SOURCE='fresh-source',
                check_link=lambda *args: None, activation=lambda *args: {'WantedBy': 'multi-user.target'}, actor_identity=lambda value: value,
                wait_for=lambda effect, code: effect())
            proof = m.inverse_source_proof(owner, pin)
            self.assertFalse(proof['ready']); self.assertFalse(proof['nativeReadinessClaimed']); self.assertTrue(proof['readerInverseOnly'])
            self.assertTrue(proof['activeOwnedUnreadyAllowed']); self.assertEqual(proof['sourceChanges'], 0)
            current_catalog['schemaOid'] = 'foreign'
            self.assertRaises(RuntimeError, m.inverse_source_proof, owner, pin)
            current_catalog['schemaOid'] = '200'
            wrong = copy.deepcopy(result); wrong['source'] = {**actor, 'pid': 999}; (owner_base / 'result.json').unlink(); m.save(owner_base / 'result.json', wrong)
            self.assertRaises(RuntimeError, m.inverse_source_proof, owner, m.sha(m.protected(owner_base / 'result.json')))


if __name__ == '__main__': unittest.main()
