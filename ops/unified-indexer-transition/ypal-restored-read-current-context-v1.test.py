#!/usr/bin/env python3
"""Synthetic current-source/real pure catalog controls; no host/role actions."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('.', '_'), HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = load('ypal-restored-read-current-context-v1.py')
old_tests = load('ypal-combined-read-current-context-v1.test.py')
old = old_tests.m
helpers = load('ypal-combined-read-admission-v2.py')


class Controls(unittest.TestCase):
    def setUp(self):
        # Reuse genuine pure Arena13/feature fixtures, not a protected host ACK.
        self.arena = old_tests.Controls('test_real_admission_catalog_validator_proves_exact13_edges')
        self.arena.setUp(); self.addCleanup(self.arena.doCleanups)
        self.runtime = {'format': 'yunipals-source-restored-current-context-v1-runtime', 'validated': True,
            'sourceEpoch': 'acknowledged-de4-original-pool5-restore', 'poolMaximum': 5,
            'operationalRestore': {'producerSha256': m.RESTORE_SHA, 'receiptSha256': m.RESTORE_RESULT_SHA},
            'source': {'unit': {'InvocationID': 'synthetic-de4'}, 'parent': {'pid': 42}},
            'currentRPC': {'receiptSha256': m.RPC_RECEIPT_SHA}, 'nativeTableIdentities': {str(i): {'oid': str(i)} for i in range(44)},
            **{k: False for k in ['originalWholeValidatorPassed', 'frameworkReadinessQualified', 'currentCanonicalCoverageQualified',
                'readerRoleGraphQualified', 'ArenaAuthorityQualified', 'READ143AuthorityQualified', 'sourceReadinessQualified',
                'financialAuthorityQualified', 'financialWriteAuthorityQualified', 'currentWriterBackendRequalified']},
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.queries = []; self.catalog = {'databaseOid': '17584', 'targetEdges': []}
        self.raw_catalog = (HERE / 'ypal-combined-read-admission-v1.catalog.sql').read_bytes()
        self.host = types.SimpleNamespace(query=lambda sql: self.queries.append(sql) or {'select': True},
            sdk=types.SimpleNamespace(peer_query=lambda sql: self.queries.append(sql) or copy.deepcopy(self.catalog)))
        self.s = types.SimpleNamespace(validate_runtime=lambda: copy.deepcopy(self.runtime),
            observe_runtime=lambda: {'binding': copy.deepcopy(self.runtime), 'observation': {'native': {'clock': 10}}},
            restore=lambda: types.SimpleNamespace(load=lambda: (None, None, self.host, None)), protected=self.protected)
        self.plan = {'missingCount': 143, 'missingPermissions': [{'kind': 'relation', 'object': str(9000+i), 'name': old.NATIVE + '.synthetic_' + str(i),
            'role': 'yunipals_unified_api', 'grantee': helpers.ROLE_OIDS['yunipals_unified_api'], 'grantor': '10', 'privilege': 'SELECT'} for i in range(143)],
            'catalogSqlSha256': old.READ_CATALOG_SHA, 'physicalSchema': old.NATIVE, 'physicalSchemaOid': '75963410',
            'readSchema': old.READ, 'readSchemaOid': '75994954', 'baselineCatalog': {'roles': [{'name': k, 'oid': v} for k, v in helpers.ROLE_OIDS.items()]},
            'newRoles': 0, 'loginChanges': 0, 'newDml': 0}
        self.docs = {**self.arena.docs, old.OLD_PLAN: self.plan}
        self.config = {'format': m.FORMAT + '-input', 'rpcReceiptSha256': m.RPC_RECEIPT_SHA, 'arenaAdmission': self.arena.config}
        self.docs[m.INPUT] = self.config
        self.bind(m, 'source', lambda: self.s); self.bind(m, 'historical', lambda: old)
        self.bind(m, 'module', lambda path, pin: helpers if path == m.READ_HELPERS else self.arena.a if path == old.ADMISSION else self.unexpected(path))
        self.bind(m, 'document', lambda path, pin: copy.deepcopy(self.docs[path]))
        self.bind(old, 'validate_runtime', lambda *a: self.unexpected('obsolete c96 runtime'))
        self.bind(helpers, 'load', lambda *a: self.unexpected('obsolete c9.load'))
    def bind(self, obj, key, value):
        action = patch.object(obj, key, value); action.start(); self.addCleanup(action.stop)
    def unexpected(self, path): raise AssertionError(str(path))
    def protected(self, path, pin):
        if path == old.READ_CATALOG:
            self.assertEqual(m.sha(self.raw_catalog), pin); return self.raw_catalog
        self.assertEqual(path, Path(m.__file__).absolute()); raw = path.read_bytes(); self.assertEqual(m.sha(raw), pin); return raw

    def test_default_static_has_no_host_or_input_dependency(self):
        value = subprocess.run(['/usr/bin/python3', '-I', '-B', str(HERE / 'ypal-restored-read-current-context-v1.py')], capture_output=True, check=True)
        self.assertTrue(json.loads(value.stdout)['staticOnly']); self.assertEqual(value.stderr, b'')
    def test_restored_runtime_same_shape_no_obsolete_validator(self):
        self.assertEqual(m.validate_runtime(m.RPC_RECEIPT_SHA), self.runtime); self.assertEqual(m.observe_runtime()['binding'], self.runtime)
        with self.assertRaises(RuntimeError): m.validate_runtime('f' * 64)
        self.runtime['READ143AuthorityQualified'] = True
        with self.assertRaisesRegex(RuntimeError, 'source_only_binding'): m.validate_runtime()
    def test_current_constructor_structured_readonly_not_old_tuple_or_ACK(self):
        parts = m.load_components()
        self.assertEqual(parts['runtime'], self.runtime); self.assertEqual(parts['historicalReadPlan'], self.plan)
        self.assertFalse(parts['actualNewReadAdmissionQualified']); self.assertFalse(parts['actualNewCacheAdmissionQualified']); self.assertFalse(parts['terminalInverseSourceQualified'])
        self.assertFalse(hasattr(parts['readerHost'], 'manager')); self.assertFalse(hasattr(parts['historicalReadHelpers'], 'load'))
        self.assertIs(parts['privilegedSourcePrimitives']['host'], self.host)
        self.assertEqual(parts['privilegedSourcePrimitives']['currentSource'], self.runtime['source'])
        self.assertEqual(parts['historicalReadHelpers'].statements(self.plan), helpers.statements(self.plan))
    def test_scope_cannot_change_role_oid_grant_count_or_DML(self):
        self.plan['missingPermissions'].pop()
        with self.assertRaises(RuntimeError): m.load_components()
        self.plan['missingCount'] = 142
        with self.assertRaises(RuntimeError): m.load_components()
    def test_reader_host_one_RR_catalog_and_single_READ_selectors(self):
        host = m.reader_host(); self.assertEqual(host.catalog(), self.catalog)
        sql = self.queries.pop(); self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(sql.endswith(';ROLLBACK;')); self.assertIn(self.raw_catalog.decode().strip(), sql)
        self.assertEqual(host.query('SELECT 1'), {'select': True})
        for bad in ['COMMIT', 'SELECT 1;COMMIT', 'UPDATE metadata.x SET x=1', 'SELECT 1\x00']:
            with self.assertRaises(RuntimeError): host.query(bad)
    def test_real_Arena13_catalog_and_grantor_semantics(self):
        arena = m.arena_admission(self.arena.config); self.assertEqual(len(arena['ownedSourceReadEdges']), 13)
        self.arena.graph['roles'][0]['directRelationAcl'][0]['grantOption'] = True
        with self.assertRaises(RuntimeError): m.arena_admission(self.arena.config)
    def test_auth_phase_requires_actual_setup_and_LOGIN_not_a_boolean(self):
        config = {**self.arena.config, 'phase': 'passwords', 'setupSha256': None}
        with self.assertRaisesRegex(RuntimeError, 'actual_owned_Arena_setup'): m.arena_admission(config)
        config = {**self.arena.config, 'phase': 'admitted', 'authSha256': 'a' * 64}
        with self.assertRaisesRegex(RuntimeError, 'NOLOGIN_phase'): m.arena_admission(config)
    def test_pure_ordering_preserves_all13_and_exact_grantor(self):
        arena = m.arena_admission(self.arena.config); catalog = {'databaseOid': '17584', 'targetEdges': copy.deepcopy(arena['ownedSourceReadEdges'])}
        self.assertTrue(m.validate_baseline_catalog(catalog, arena)); catalog['targetEdges'][0]['grantor'] = 'foreign'
        with self.assertRaises(RuntimeError): m.validate_baseline_catalog(catalog, arena)
    def test_feature_order_uses_actual_unchanged_before_and_after_helper(self):
        arena = m.arena_admission(self.arena.config); before = old_tests.feature_tests.fixture()
        for row in before['target']['tables']:
            if row['name'] in {'_ponder_meta', '_ponder_checkpoint'}:
                edge = next(e for e in arena['ownedSourceReadEdges'] if e['object_name'] == old.NATIVE + '.' + row['name'])
                row['acl'].append({k: edge[k] for k in ['grantee', 'grantor', 'privilege', 'grantable']})
        after = old_tests.feature_tests.m.after_eight(before)
        self.assertTrue(m.validate_feature_catalog_order({'catalogBefore': before, 'catalogAfter': after}, arena)['ArenaAdmissionPredatesFeatureCapture'])
        next(row for row in before['target']['tables'] if row['name'] == '_ponder_meta')['acl'] = []
        with self.assertRaises(RuntimeError): m.validate_feature_catalog_order({'catalogBefore': before, 'catalogAfter': after}, arena)
    def test_missing_Arena_or_existing_feature_stays_closed(self):
        self.arena.config['receiptSha256'] = None
        with patch.object(m.os.path, 'lexists', return_value=False), self.assertRaisesRegex(RuntimeError, 'actual_Arena_admission'): m.validate_before_baseline('f' * 64)
        with patch.object(m.os.path, 'lexists', return_value=True), self.assertRaisesRegex(RuntimeError, 'precede_feature'): m.validate_before_baseline('f' * 64)
    def test_new_RR_baseline_preserves143_scope_no_new_authority(self):
        arena = m.arena_admission(self.arena.config); self.catalog['targetEdges'] = copy.deepcopy(arena['ownedSourceReadEdges'])
        with patch.object(m.os.path, 'lexists', return_value=False): value = m.validate_before_baseline('f' * 64)
        self.assertEqual(value['catalogBefore'], self.catalog); self.assertEqual(value['readEdgeCount'], 143)
        self.assertFalse(value['actualNewReadAdmissionQualified']); self.assertFalse(value['historicalPlanRewritten'])
        self.assertEqual(len(self.queries), 1)
    def test_column_edge_identity_retained_by_exact_pure_read_delta(self):
        pure = m.load_components()['historicalReadHelpers']
        self.assertIs(pure.validate_delta, helpers.validate_delta); self.assertIs(pure.validate_reader_delta, helpers.validate_reader_delta)
        column = {'kind': 'column', 'object': '1', 'object_name': old.NATIVE + '.token', 'grantee': '2', 'grantor': '3', 'privilege': 'SELECT', 'grantable': False, 'column_number': 4}
        other = {**column, 'column_number': 5}
        self.assertNotEqual(pure.edge_key(column, True), pure.edge_key(other, True))


if __name__ == '__main__': unittest.main(verbosity=2)
