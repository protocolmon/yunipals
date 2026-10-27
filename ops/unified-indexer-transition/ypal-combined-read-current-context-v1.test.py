#!/usr/bin/env python3
"""Finite reused-Arena-catalog/feature/FS controls; no host/provider calls."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('.', '_'), HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load('ypal-combined-read-current-context-v1.py')
admission_tests = load('arena-ypal-native-v2.admission.test.py')
admission = admission_tests.m
feature_tests = load('ypal-feature-handover-v1.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.rpc = {'format': 'yunipals-ypal-retained-proxy-current-v3', 'validated': True,
                    'receiptSha256': 'a' * 64, 'operatorSha256': 'b' * 64,
                    'currentRPCComponentSha256': 'c' * 64,
                    'rpcScopeOnly': True, 'freeOnly': True, 'paidAuthority': False,
                    **{key: False for key in ('historicalWholeValidatorPassed', 'sourceActorQualified',
                       'temporaryYpalSourceAndApiQualified', 'sourceReadinessQualified',
                       'readerRoleGraphQualified', 'financialWriteAuthorityQualified')},
                    'providerCalls': 0, 'databaseWrites': 0, 'serviceActions': 0}
        self.native = {'schemaOid': '75963410', 'app': {'build_id': '71e2a7f3b7'},
                       'tables': {str(n): {'oid': str(n), 'owner': '73004621', 'kind': 'r'} for n in range(44)}}
        self.actor = {'pid': 2472127, 'invocation': 'synthetic-same-c96', 'processes': []}
        self.ack = {'source': copy.deepcopy(self.actor), 'native': copy.deepcopy(self.native), 'newBoot': {'same': 'inode'}}
        self.op = {'sourceCode': {'code': 'exact'}, 'sourceRole': {'role': 'exact'}}
        self.source = types.SimpleNamespace(BASE=Path('/nonexistent-synthetic-source'), NEW_LINK=Path('/synthetic-boot'),
            static_inputs=lambda h: self.calls.append('static'), old_private_inputs=lambda op: self.calls.append('private'),
            base_code=lambda: {'code': 'exact'}, bootstrap=lambda *a: (copy.deepcopy(self.actor), copy.deepcopy(self.native)),
            exact_link=lambda *a: self.calls.append('boot'))
        self.host = types.SimpleNamespace(role=lambda: {'role': 'exact'}, old_terminal=lambda op: self.calls.append('old-terminal'),
            preserved_old_native=lambda op: self.calls.append('old-native'),
            query=lambda sql: {'id': m.RELEASE, 'schema': m.NATIVE, 'build': '71e2a7f3b7',
                               'manifestHash': m.MANIFEST, 'manifest': {'exact': 'public'}})
        self.leaf = types.SimpleNamespace(load=lambda: (self.source, self.host, self.op, self.ack),
            SOURCE_ACK='c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909', boot=lambda: 'same-boot')
        forbidden = lambda *a: (_ for _ in ()).throw(AssertionError('obsolete whole/source/API scope invoked'))
        self.source.check_preserved = forbidden
        self.q = types.SimpleNamespace(qualified_rpc_components=lambda pin: (copy.deepcopy(self.rpc), {}),
                                       validate_source_current=forbidden)
        self.registered = {'registered': True, 'releaseId': m.RELEASE, 'manifestHash': m.MANIFEST,
                           'sourceReceiptSha256': self.leaf.SOURCE_ACK, 'activeReleaseChanged': False}
        self.bind(m, 'RPC_SHA', 'b' * 64); self.bind(m, 'RPC_ACK_SHA', 'a' * 64); self.bind(m, 'RPC_COMPONENT_SHA', 'c' * 64)
        self.bind(m, 'components', lambda: (self.leaf, self.q))
        self.docs = {m.REGISTERED: self.registered, m.PROFILE: {'manifest': {'exact': 'public'}}}
        self.bind(m, 'document', lambda path, pin: copy.deepcopy(self.docs[Path(path)]))
        self.graph, self.oids = admission_tests.fixture('source')
        self.receipt = {'format': 'yunipals-arena-ypal-admission-v2', 'commitOutcome': 'commit_confirmed',
            'operatorSha256': m.ADMISSION_SHA, 'releaseId': m.RELEASE,
            'roles': {'operational-synthetic': 980100}, 'sourceRole': {'name': 'arena_native_reader', 'oid': self.oids['arena_native_reader']}}
        self.docs[m.ADMISSION_RESULT] = self.receipt
        self.helper = admission_tests.h
        original_read = lambda path, pin, *a: (HERE.parent / 'arena-native-admission-20261022/operational-roles.current.sql.review').read_bytes()
        self.bind(self.helper, 'read', original_read)
        def verified(receipt, *, phase, password_sha256):
            subset = None if password_sha256 is None else {'arena_native_reader': password_sha256['arena_native_reader']}
            admission.validate_catalog(self.helper, admission_tests.proposal, 'source', self.graph, self.oids,
                                       phase=phase, password_sha256=subset)
            return {'validated': True, 'phase': phase, 'roleCount': 9, 'databaseWrites': 0,
                    'catalogs': {'source': {'requiredEdges': 13}}}
        self.a = types.SimpleNamespace(verify_current=verified, runner=lambda: self.helper,
            current_catalog=lambda *a: copy.deepcopy(self.graph), validate_catalog=admission.validate_catalog, graph=admission.graph)
        self.bind(self.helper, 'load_proposal', lambda: copy.deepcopy(admission_tests.proposal))
        self.bind(m, 'module', lambda path, pin: self.a if path == m.ADMISSION else (_ for _ in ()).throw(AssertionError('unexpected module')))
        self.config = {'receiptSha256': 'c' * 64, 'phase': 'admitted', 'setupSha256': None, 'authSha256': None}

    def bind(self, obj, key, value):
        action = patch.object(obj, key, value); action.start(); self.addCleanup(action.stop)

    def test_default_static_mode_has_no_input_or_host_requirement(self):
        value = subprocess.run(['/usr/bin/python3', '-I', '-B', str(HERE / 'ypal-combined-read-current-context-v1.py')],
                               check=True, capture_output=True)
        result = json.loads(value.stdout)
        self.assertTrue(result['staticOnly']); self.assertFalse(result['runtimeQualified'])
        self.assertEqual(result['databaseWrites'], 0); self.assertEqual(value.stderr, b'')

    def test_unbound_v3_refuses_before_input_code_or_host_reads(self):
        # Execute the real protected-loader entry, not the fixture components.
        real = load('ypal-combined-read-current-context-v1.py')
        with patch.object(real, 'RPC_SHA', None), patch.object(real, 'protected', side_effect=AssertionError('input read')):
            with self.assertRaisesRegex(RuntimeError, 'actual_frozen_RPC_v3'): real.components()
        with patch.object(m, 'components', side_effect=AssertionError('input read')):
            with self.assertRaisesRegex(RuntimeError, 'actual_152178_RPC_v3'): m.validate_runtime('d' * 64)

    def test_runtime_scope_is_rpc_only_and_survives_reader_role_only_changes(self):
        value = m.validate_runtime('a' * 64)
        self.assertTrue(value['validated']); self.assertEqual(value['source'], self.actor)
        self.assertEqual(value['poolMaximum'], 5); self.assertEqual(len(value['nativeTableIdentities']), 44)
        self.assertFalse(value['readerRoleGraphQualified']); self.assertFalse(value['temporaryYpalSourceAndApiQualified'])
        self.assertEqual(self.calls, ['static', 'private', 'old-terminal', 'old-native', 'boot'])
        self.graph['roles'][0]['attributes']['login'] = True
        self.assertEqual(m.validate_runtime('a' * 64), value)

    def test_rpc_foreign_authority_or_source_epoch_catalog_drift_refuses(self):
        for key in ('paidAuthority', 'sourceActorQualified', 'readerRoleGraphQualified'):
            self.rpc[key] = True
            with self.assertRaisesRegex(RuntimeError, 'RPC_only_scope'): m.validate_runtime('a' * 64)
            self.rpc[key] = False
        self.rpc['currentRPCComponentSha256'] = 'd' * 64
        with self.assertRaisesRegex(RuntimeError, 'RPC_only_scope'): m.validate_runtime('a' * 64)
        self.rpc['currentRPCComponentSha256'] = 'c' * 64
        self.actor['pid'] += 1
        with self.assertRaisesRegex(RuntimeError, 'same_actual_c96_epoch'): m.validate_runtime('a' * 64)
        self.actor = copy.deepcopy(self.ack['source']); self.native['tables']['0']['oid'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'same_actual_c96_epoch'): m.validate_runtime('a' * 64)

    def test_registered_current_manifest_must_match_actual_public_profile(self):
        self.host.query = lambda _: {'id': m.RELEASE, 'manifest': {'changed': True}}
        with self.assertRaisesRegex(RuntimeError, 'same_actual_registered_native_manifest'): m.validate_runtime('a' * 64)

    def test_real_admission_catalog_validator_proves_exact13_edges(self):
        value = m.arena_admission(self.config)
        self.assertEqual(len(value['ownedSourceReadEdges']), 13)
        self.assertEqual(value['sourceRole'], self.receipt['sourceRole'])
        self.graph['roles'][0]['directRelationAcl'][0]['grantOption'] = True
        with self.assertRaises(RuntimeError): m.arena_admission(self.config)

    def test_auth_phase_is_explicit_and_protected_setup_is_not_a_login_receipt(self):
        setup = {'format': 'yunipals-arena-ypal-credentials-v2', 'operatorSha256': m.CREDENTIALS_SHA,
            'admissionResultSha256': 'c' * 64, 'roles': self.receipt['roles'], 'sourceRole': self.receipt['sourceRole'],
            'credentialsConfigured': True, 'loginEnabled': False,
            'passwordVerifierSha256': {'operational-synthetic': 'd' * 64, 'arena_native_reader': 'e' * 64}}
        self.docs[m.CREDENTIAL_BASE / 'setup-result.json'] = setup
        self.graph['markers']['auth']['arena_native_reader'] = {'passwordPresent': True, 'scram': True, 'passwordSha256': 'e' * 64}
        config = {**self.config, 'phase': 'passwords', 'setupSha256': 'f' * 64}
        self.assertEqual(m.arena_admission(config)['phase'], 'passwords')
        self.graph['roles'][0]['attributes']['login'] = True
        with self.assertRaises(RuntimeError): m.arena_admission(config)
        config['phase'] = 'login'
        with self.assertRaisesRegex(RuntimeError, 'LOGIN_authentication'): m.arena_admission(config)
        config['authSha256'] = '1' * 64
        auth = {'format': 'yunipals-arena-ypal-role-auth-v2', 'operatorSha256': m.CREDENTIALS_SHA,
                'admissionResultSha256': 'c' * 64, 'setupResultSha256': 'f' * 64,
                'roles': self.receipt['roles'], 'sourceRole': self.receipt['sourceRole'],
                'loginEnabled': True, 'grantsVerified': True, 'tcpAuthenticationProven': True}
        self.docs[m.CREDENTIAL_BASE / 'auth-result.json'] = auth
        self.assertEqual(m.arena_admission(config)['phase'], 'login')
        auth['setupResultSha256'] = '2' * 64
        with self.assertRaisesRegex(RuntimeError, 'LOGIN_auth_chain'): m.arena_admission(config)

    def test_fresh_baseline_requires_all13_actual_Arena_reads_and_original_grantors(self):
        arena = m.arena_admission(self.config)
        catalog = {'databaseOid': '17584', 'targetEdges': copy.deepcopy(arena['ownedSourceReadEdges'])}
        self.assertTrue(m.validate_baseline_catalog(catalog, arena))
        catalog['targetEdges'].pop()
        with self.assertRaisesRegex(RuntimeError, 'Arena13_must_precede'): m.validate_baseline_catalog(catalog, arena)
        catalog['targetEdges'] = copy.deepcopy(arena['ownedSourceReadEdges']); catalog['targetEdges'][0]['grantor'] = 'foreign'
        with self.assertRaises(RuntimeError): m.validate_baseline_catalog(catalog, arena)

    def test_actual_feature_catalog_before_must_already_have_atomic_Arena_admission_edges(self):
        arena = m.arena_admission(self.config); before = feature_tests.fixture()
        for row in before['target']['tables']:
            if row['name'] in {'_ponder_meta', '_ponder_checkpoint'}:
                edge = next(e for e in arena['ownedSourceReadEdges'] if e['object_name'] == m.NATIVE + '.' + row['name'])
                row['acl'].append({key: edge[key] for key in ('grantee', 'grantor', 'privilege', 'grantable')})
        after = feature_tests.m.after_eight(before)
        result = m.validate_feature_catalog_order({'catalogBefore': before, 'catalogAfter': after}, arena)
        self.assertTrue(result['ArenaAdmissionPredatesFeatureCapture'])
        before['target']['tables'][0]['acl'] = []
        # Explicitly remove the protected meta edge regardless of sort order.
        next(r for r in before['target']['tables'] if r['name'] == '_ponder_meta')['acl'] = []
        with self.assertRaisesRegex(RuntimeError, 'precede_feature_catalogBefore'):
            m.validate_feature_catalog_order({'catalogBefore': before, 'catalogAfter': after}, arena)

    def test_existing_feature_prefix_refuses_before_any_source_or_role_qualification(self):
        self.docs[m.INPUT] = {'format': m.FORMAT + '-input', 'rpcReceiptSha256': 'a' * 64, 'arenaAdmission': self.config}
        with patch.object(m.os.path, 'lexists', return_value=True), patch.object(m, 'validate_runtime', side_effect=AssertionError('late source qualification')):
            with self.assertRaisesRegex(RuntimeError, 'precede_any_feature_operation'): m.validate_before_baseline('f' * 64)

    def test_new_baseline_uses_original143_scope_and_actual_RR_catalog_leaf(self):
        arena = m.arena_admission(self.config)
        catalog = {'databaseOid': '17584', 'targetEdges': copy.deepcopy(arena['ownedSourceReadEdges'])}
        self.docs[m.INPUT] = {'format': m.FORMAT + '-input', 'rpcReceiptSha256': 'a' * 64, 'arenaAdmission': self.config}
        self.docs[m.OLD_PLAN] = {'missingCount': 143, 'missingPermissions': [{'original': n} for n in range(143)], 'catalogSqlSha256': m.READ_CATALOG_SHA}
        def query(host, sql):
            self.assertIs(host, self.host); self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
            self.assertTrue(sql.endswith(';ROLLBACK;')); self.assertNotIn('GRANT ', sql)
            return [copy.deepcopy(catalog)]
        prior = m.module
        with patch.object(m, 'module', side_effect=lambda path, pin: types.SimpleNamespace(query=query) if path == m.VIEW_OWNER else prior(path, pin)), \
             patch.object(m, 'protected', return_value=b'SELECT fixture'), patch.object(m.os.path, 'lexists', return_value=False):
            value = m.validate_before_baseline('f' * 64)
        self.assertEqual(value['readEdgeCount'], 143); self.assertFalse(value['historicalPlanRewritten'])
        self.assertEqual(value['catalogBefore'], catalog); self.assertTrue(value['featureOperationAbsent'])

    def test_protected_loader_executes_only_pinned_real_file_and_refuses_foreign_links(self):
        with tempfile.TemporaryDirectory(prefix='.read-context-', dir=HERE) as directory:
            path = Path(directory) / 'public.py'; path.write_bytes(b'value=17\n'); path.chmod(0o600)
            real = load('ypal-combined-read-current-context-v1.py')
            self.assertEqual(real.module(path, real.sha(path.read_bytes())).value, 17)
            with self.assertRaises(RuntimeError): real.module(path, '0' * 64)
            link = Path(directory) / 'link.py'; link.symlink_to(path)
            with self.assertRaises(RuntimeError): real.protected(link)


if __name__ == '__main__': unittest.main(verbosity=2)
