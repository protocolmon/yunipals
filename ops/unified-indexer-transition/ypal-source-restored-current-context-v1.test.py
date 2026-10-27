#!/usr/bin/env python3
"""Synthetic stable-binding/scope and real protected-file controls; no host IO."""
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
spec = importlib.util.spec_from_file_location('restored_context', HERE / 'ypal-source-restored-current-context-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def setUp(self):
        self.count = 0; self.mutate = lambda v: None; self.calls = []
        self.actor = {'unit': {'After': 'a.service z.service', 'InvocationID': 'synthetic-new-five'}, 'parent': {'pid': 42, 'startTicks': 420}, 'processes': []}
        self.boot = {'identity': {'inode': 1}, 'target': '/synthetic/source.service'}
        self.rpc = {'operatorSha256': m.RPC_SHA, 'receiptSha256': m.RPC_ACK_SHA, 'currentRPCComponentSha256': m.RPC_COMPONENT_SHA,
            'validated': True, 'rpcScopeOnly': True, 'freeOnly': True, 'paidAuthority': False,
            **{k: False for k in ['historicalWholeValidatorPassed', 'sourceActorQualified', 'temporaryYpalSourceAndApiQualified',
                 'sourceReadinessQualified', 'readerRoleGraphQualified', 'financialWriteAuthorityQualified']}}
        self.native = {'schemaOid': '75963410', 'app': {'build_id': m.BUILD, 'is_ready': 0, 'heartbeat_at': 10}, 'clock': 11,
            'checkpoints': {'8453': {'latest': 'synthetic-checkpoint'}}, 'cache': {'schemaOid': '700', 'relations': [{'oid': '701'}]},
            'tables': {str(i): {'oid': str(i), 'owner': '73004621', 'kind': 'r'} for i in range(44)}}
        self.proof = {'format': 'yunipals-source-tail-restore-v1-source-current', 'validated': True, 'operatorSha256': m.RESTORE_SHA,
            'receiptSha256': m.RESULT_SHA, 'poolMaximum': 5, 'configurationSha256': m.CONFIG_SHA, 'sourceRelease': m.RELEASE,
            'schema': m.SCHEMA, 'buildId': m.BUILD, 'native': self.native, 'source': self.actor, 'currentRPC': self.rpc,
            **{k: False for k in ['oldWholeSourceValidatorPassed', 'prior47abInverseResultClaimed', 'sourceReadinessQualified',
                'currentCanonicalCoverageQualified', 'currentWriterBackendRequalified', 'temporaryPackActorsQualified', 'financialAuthorityQualified', 'readerRoleGraphQualified']},
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.receipt = {'format': 'yunipals-source-tail-restore-v1', 'restored': True, 'operatorSha256': m.RESTORE_SHA, 'source': copy.deepcopy(self.actor),
            'poolMaximum': 5, 'originalConfigSha256': m.CONFIG_SHA, 'ancestorOperatorSha256': m.ANCESTOR_OPERATOR,
            'ancestorOperationSha256': m.ANCESTOR_OPERATION, 'allSixOriginalMountsQualified': True, 'safeRecoveryFloorsPreserved': True,
            'prior47abInverseResultClaimed': False, 'oldC96ActorRelabelled': False, 'sourceReadinessQualified': False, 'paidAuthorityAdded': False,
            'originalBoot': copy.deepcopy(self.boot), 'startIntentSha256': 'a' * 64, 'bootId': 'synthetic-boot'}
        self.registered = {'registered': True, 'releaseId': m.RELEASE, 'manifestHash': m.MANIFEST, 'sourceReceiptSha256': m.C96, 'activeReleaseChanged': False}
        self.profile = {'manifest': {'synthetic-exact-source-descriptors': True}}
        self.row = {'id': m.RELEASE, 'schema': m.SCHEMA, 'build': m.BUILD, 'manifestHash': m.MANIFEST, 'manifest': self.profile['manifest']}
        self.docs = {m.RESULT: self.receipt, m.REGISTERED: self.registered, m.PROFILE: self.profile}
        self.h = types.SimpleNamespace(query=self.query, source_op={}, raw=types.SimpleNamespace(
            old_terminal=lambda _: self.calls.append('old-terminal'), preserved_old_native=lambda _: self.calls.append('old-native')))
        self.s = types.SimpleNamespace(validate_source_current=self.leaf,
            load=lambda: (types.SimpleNamespace(BOOT=Path('/synthetic/boot')), types.SimpleNamespace(link_record=lambda _: copy.deepcopy(self.boot)), self.h, {'boot': self.receipt['originalBoot']}))
        self.bind(m, 'restore', lambda: self.s); self.bind(m, 'document', lambda path, pin: copy.deepcopy(self.docs[path]))
    def bind(self, obj, key, value):
        action = patch.object(obj, key, value); action.start(); self.addCleanup(action.stop)
    def leaf(self, receipt):
        self.assertEqual(receipt, m.RESULT_SHA); self.count += 1; value = copy.deepcopy(self.proof)
        value['native']['clock'] += self.count; value['native']['app']['heartbeat_at'] += self.count
        value['native']['checkpoints']['8453']['latest'] += str(self.count); self.mutate(value); return value
    def query(self, sql):
        self.assertTrue(sql.startswith('SELECT jsonb_build_object(')); self.assertIn(m.RELEASE, sql); self.assertNotIn('GRANT', sql)
        return copy.deepcopy(self.row)
    def test_default_is_static_and_actual_pin_does_not_claim_runtime(self):
        output = subprocess.run(['/usr/bin/python3', '-I', '-B', str(HERE / 'ypal-source-restored-current-context-v1.py')], capture_output=True, check=True)
        value = json.loads(output.stdout); self.assertTrue(value['actualRestoreACKBound']); self.assertFalse(value['runtimeQualified']); self.assertEqual(output.stderr, b'')
    def test_heartbeat_checkpoint_and_ready_changes_do_not_change_binding(self):
        a = m.observe_runtime(); b = m.observe_runtime(); self.assertEqual(a['binding'], b['binding']); self.assertNotEqual(a['observation'], b['observation'])
        self.native['app']['is_ready'] = 1; self.assertEqual(m.validate_runtime(), a['binding'])
        self.assertFalse(a['binding']['frameworkReadinessQualified']); self.assertNotIn('checkpoints', a['binding'])
    def test_exact_de4_and_actual_0ee_are_required(self):
        for change in [{'operatorSha256': m.ANCESTOR_OPERATOR}, {'receiptSha256': 'f' * 64}, {'poolMaximum': 8}]:
            original = copy.deepcopy(self.proof); self.proof.update(change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, 'actual_de4'): m.validate_runtime()
            self.proof = original
    def test_old_c96_or_prior47ab_success_cannot_be_relabelled(self):
        for key in ['prior47abInverseResultClaimed', 'oldC96ActorRelabelled']:
            self.receipt[key] = True
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'not_c96_or47ab'): m.validate_runtime()
            self.receipt[key] = False
    def test_same_count_native_oid_or_cache_substitution_refuses(self):
        for scope in ['native', 'cache']:
            def changed(v):
                if self.count % 2 == 0:
                    if scope == 'native': v['native']['tables']['0']['oid'] = 'foreign'
                    else: v['native']['cache']['relations'][0]['oid'] = 'foreign'
            self.mutate = changed
            with self.subTest(scope=scope), self.assertRaisesRegex(RuntimeError, 'native_identity_changed'): m.validate_runtime()
    def test_foreign_actor_cannot_equal_actual_ACK(self):
        self.actor['parent']['pid'] += 1
        with self.assertRaisesRegex(RuntimeError, 'not_c96_or47ab'): m.validate_runtime()
    def test_original_config_and_six_mount_acceptance_are_required(self):
        self.receipt['originalConfigSha256'] = 'f' * 64
        with self.assertRaises(RuntimeError): m.validate_runtime()
        self.receipt['originalConfigSha256'] = m.CONFIG_SHA; self.receipt['allSixOriginalMountsQualified'] = False
        with self.assertRaises(RuntimeError): m.validate_runtime()
    def test_actual_full_manifest_drift_refuses(self):
        self.row['manifest'] = {'foreign': True}
        with self.assertRaisesRegex(RuntimeError, 'registered_data_identity'): m.validate_runtime()
    def test_changed_boot_inode_during_registered_query_refuses(self):
        query = self.h.query
        def changed(sql):
            row = query(sql); self.boot['identity']['inode'] += 1; return row
        self.h.query = changed
        with self.assertRaisesRegex(RuntimeError, 'native_identity_changed'): m.validate_runtime()
    def test_rpc_cannot_add_source_reader_or_financial_authority(self):
        for key in ['sourceActorQualified', 'readerRoleGraphQualified', 'financialWriteAuthorityQualified', 'paidAuthority']:
            self.rpc[key] = True
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'nine_RPC_scope'): m.validate_runtime()
            self.rpc[key] = False
    def test_all_downstream_authorities_false_and_ancestry_is_separate(self):
        value = m.validate_runtime()
        for key in ['frameworkReadinessQualified', 'currentCanonicalCoverageQualified', 'readerRoleGraphQualified', 'ArenaAuthorityQualified',
                    'READ143AuthorityQualified', 'sourceReadinessQualified', 'financialAuthorityQualified', 'financialWriteAuthorityQualified', 'currentWriterBackendRequalified']:
            self.assertFalse(value[key])
        self.assertFalse(value['historicalAncestry']['prior47abInverseSuccessClaimed']); self.assertFalse(value['operationalRestore']['activePool8Overlay'])
        self.assertEqual(value['operationalRestore']['receiptSha256'], m.RESULT_SHA); self.assertEqual(value['source'], self.actor)
    def test_protected_loader_rejects_foreign_bytes_and_links(self):
        with tempfile.TemporaryDirectory(prefix='.restored-context-', dir=HERE) as directory:
            path = Path(directory).absolute() / 'public.json'; path.write_bytes(b'{"synthetic":true}\n'); path.chmod(0o600)
            self.assertEqual(m.protected(path, m.sha(path.read_bytes())), path.read_bytes())
            with self.assertRaises(RuntimeError): m.protected(path, '0' * 64)
            link = path.with_name('link'); link.symlink_to(path)
            with self.assertRaises(RuntimeError): m.protected(link, m.sha(path.read_bytes()))


if __name__ == '__main__': unittest.main(verbosity=2)
