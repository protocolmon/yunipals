import copy
import importlib.util
import os
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('restored_metadata_context', HERE / 'ypal-restored-metadata-context-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def native():
    return {'schemaOid': '75963410', 'tables': {str(n): {'oid': str(n), 'owner': '73004621', 'kind': 'r'} for n in range(44)},
            'cache': {'schemaOid': '123', 'relations': ['same-cache']}, 'app': {'build_id': '71e2a7f3b7'}, 'safe': 400}


class Controls(unittest.TestCase):
    def test_native_identity_is_exact_not_checkpoint_or_heartbeat_authority(self):
        now = native(); receipt = {'native': copy.deepcopy(now)}
        now['safe'] += 5; now['app']['heartbeat_at'] = 'new'
        self.assertEqual(m.native_identity(now, receipt), {k: now[k] for k in ['schemaOid', 'tables', 'cache']})
        for kind in ['oid', 'table', 'cache', 'owner', 'build']:
            changed = copy.deepcopy(now)
            if kind == 'oid': changed['schemaOid'] = '1'
            if kind == 'table': changed['tables'].pop('0')
            if kind == 'cache': changed['cache']['schemaOid'] = 'foreign'
            if kind == 'owner': changed['tables']['0']['owner'] = '999'
            if kind == 'build': changed['app']['build_id'] = 'foreign'
            with self.subTest(kind=kind), self.assertRaisesRegex(RuntimeError, 'native44'):
                m.native_identity(changed, receipt)

    def recorded(self):
        source = types.SimpleNamespace(RESULT=Path('/fixture/result'), CONFIG_SHA='config')
        restore = types.SimpleNamespace(FORMAT='restore-format', OP_SHA='op', RECOVERY_SHA='recovery', BASE=Path('/fixture'))
        actor = {'unit': {'InvocationID': 'new', 'ExecMainStartTimestampMonotonic': '20'}}
        intent = {'operatorSha256': m.RESTORE_SHA, 'ancestorOperationSha256': 'op', 'bootId': 'boot', 'notBeforeUs': 10}
        receipt = {'format': 'restore-format', 'restored': True, 'operatorSha256': m.RESTORE_SHA, 'ancestorOperationSha256': 'op',
            'ancestorOperatorSha256': 'recovery', 'bootId': 'boot', 'poolMaximum': 5, 'originalConfigSha256': 'config',
            'originalBoot': {'same': True}, 'startIntentSha256': m.sha(b'actual-intent'), 'allSixOriginalMountsQualified': True,
            'safeRecoveryFloorsPreserved': True, 'prior47abInverseResultClaimed': False, 'oldC96ActorRelabelled': False,
            'sourceReadinessQualified': False, 'paidAuthorityAdded': False, 'source': actor}
        source.document = lambda path, pin: receipt
        sdk = types.SimpleNamespace(document=lambda path: intent, protected=lambda path: b'actual-intent', boot=lambda: 'boot')
        op = {'bootId': 'boot', 'boot': {'same': True}, 'source': {'unit': {'InvocationID': 'old'}}}
        return source, restore, sdk, op, receipt

    def test_recorded_receipt_qualifies_only_own_restored_epoch(self):
        source, restore, sdk, op, receipt = self.recorded()
        self.assertEqual(m.restore_receipt(source, restore, sdk, op), receipt)
        receipt['source']['unit']['InvocationID'] = 'old'
        with self.assertRaisesRegex(RuntimeError, 'own_start_intent'):
            m.restore_receipt(source, restore, sdk, op)

    def test_recorded_receipt_rejects_old_labels_pool_and_claimed_authority(self):
        for key, value in [('poolMaximum', 8), ('oldC96ActorRelabelled', True), ('sourceReadinessQualified', True), ('operatorSha256', 'old')]:
            source, restore, sdk, op, receipt = self.recorded(); receipt[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'actual_new_de4'):
                m.restore_receipt(source, restore, sdk, op)

    def test_query_constructor_does_not_call_active_context_or_old_read_constructor(self):
        expected = native(); receipt = {'native': expected, 'source': {'actualRecorded': True}}
        helpers = types.SimpleNamespace(ROLE_OIDS={'role': '1'}, statements=lambda p: list(range(143)),
            edge_key=None, expected_edges=None, validate_delta=None, validate_reader_delta=None)
        plan = {'missingCount': 143, 'missingPermissions': list(range(143)), 'catalogSqlSha256': 'sql', 'physicalSchema': 'native',
            'physicalSchemaOid': '75963410', 'readSchema': 'read', 'readSchemaOid': '75994954', 'baselineCatalog': {'roles': [{'name':'role','oid':'1'}]},
            'newRoles': 0, 'loginChanges': 0, 'newDml': 0}
        old = types.SimpleNamespace(OLD_PLAN='historical-plan', OLD_PLAN_SHA='historical-sha', READ_CATALOG='sql-path', READ_CATALOG_SHA='sql', NATIVE='native', READ='read')
        host = types.SimpleNamespace(native=lambda: expected)
        restore = types.SimpleNamespace(load=lambda: ('r', 'sdk', host, 'op'))
        source = types.SimpleNamespace(restore=lambda: restore, protected=lambda *args: b'SELECT true')
        def forbidden(*args): self.fail('active/obsolete constructor was called')
        read = types.SimpleNamespace(source=lambda: source, historical=lambda: old, module=lambda *args: helpers,
            READ_HELPERS='helpers', READ_HELPERS_SHA='helper-sha', document=lambda *args: plan,
            ReaderHost=lambda h, sql: (h, sql), validate_runtime=forbidden, load_components=forbidden)
        with patch.object(m, 'read_context', return_value=read), patch.object(m, 'restore_receipt', return_value=receipt):
            result = m.query_components()
        self.assertIs(result['privilegedSourcePrimitives']['host'], host)
        self.assertFalse(result['sourceActorQualified']); self.assertFalse(result['actualNewReadAdmissionQualified'])
        self.assertNotIn('runtime', result)

    def test_readonly_query_interface_rejects_mutation_and_multi_statement(self):
        spec = importlib.util.spec_from_file_location('frozen_e82', HERE / 'ypal-restored-read-current-context-v1.py')
        read = importlib.util.module_from_spec(spec); spec.loader.exec_module(read)
        h = read.ReaderHost(types.SimpleNamespace(query=lambda s: s), '')
        self.assertEqual(h.query('SELECT 1'), 'SELECT 1')
        for sql in ['UPDATE x SET y=1', 'SELECT 1; SELECT 2', 'SELECT\x00 1', 'SELECT ' + 'x' * 200000]:
            with self.subTest(sql=sql[:30]), self.assertRaisesRegex(RuntimeError, 'readonly_selector'):
                h.query(sql)

    def inverse_fixture(self, terminal=True):
        n = native(); receipt = {'native': copy.deepcopy(n), 'source': {'processes': [], 'same': 'actor'}}
        rpc = {'receiptSha256': m.RPC_SHA, 'rpcScopeOnly': True, 'sourceActorQualified': False}
        actor = None if terminal else {'same': 'actor'}; calls = []
        owner = types.SimpleNamespace(prefix=lambda: calls.append('prefix'), owned=lambda: receipt['source'], floors=lambda v: calls.append('old-floors'), get=lambda n: {})
        r = types.SimpleNamespace(SOURCE='source', recovery_floor=lambda a,b: m.need(b['safe'] >= a['safe'], 'accepted_floor_regressed'), epoch_heartbeat=lambda *args: calls.append('heartbeat'))
        raw = types.SimpleNamespace(old_terminal=lambda op: calls.append('old-terminal'), preserved_old_native=lambda op: calls.append('old-native'))
        h = types.SimpleNamespace(inputs=lambda: 'inputs', rpc_current=lambda: rpc, actor=lambda *args: actor, native=lambda: n, raw=raw, source_op={})
        restore = types.SimpleNamespace(Owner=lambda *args: owner, canonical_actor=lambda a: a)
        parts = {'privilegedSourcePrimitives': {'restoreModule':restore,'recoveryModule':r,'sdk':None,'host':h,'ancestorOperation':{'inputs':'inputs'},'restoreReceipt':receipt},
                 'nativeIdentity': {k:n[k] for k in ['schemaOid','tables','cache']}}
        return parts, n, calls, h

    def test_terminal_inverse_context_needs_no_active_source_or_temporary_peer(self):
        parts, n, calls, h = self.inverse_fixture()
        with patch.object(m, 'query_components', return_value=parts): result = m.inverse_source()
        self.assertTrue(result['sourceTerminalQualified']); self.assertFalse(result['sourceActorQualified'])
        self.assertFalse(result['currentWriterBackendRequalified']); self.assertFalse(result['writerExclusivityQualified'])
        self.assertEqual(calls.count('prefix'), 2); self.assertNotIn('heartbeat', calls)

    def test_active_inverse_context_checks_acknowledged_actor_and_heartbeat(self):
        parts, n, calls, h = self.inverse_fixture(False)
        with patch.object(m, 'query_components', return_value=parts): result = m.inverse_source()
        self.assertEqual(result['sourceState'], 'acknowledged-active'); self.assertIn('heartbeat', calls)
        self.assertFalse(result['frameworkReadinessQualified'])

    def test_inverse_refuses_accepted_safe_floor_regression(self):
        parts, n, calls, h = self.inverse_fixture(); n['safe'] = 399
        with patch.object(m, 'query_components', return_value=parts), self.assertRaisesRegex(RuntimeError, 'accepted_floor'):
            m.inverse_source()

    def test_inverse_refuses_foreign_current_actor(self):
        parts, n, calls, h = self.inverse_fixture(False)
        parts['privilegedSourcePrimitives']['restoreModule'].Owner = lambda *args: types.SimpleNamespace(prefix=lambda: None, owned=lambda: {'foreign': True})
        with patch.object(m, 'query_components', return_value=parts), self.assertRaisesRegex(RuntimeError, 'acknowledged_restored'):
            m.inverse_source()

    def test_inverse_rechecks_terminal_actor_after_observation(self):
        parts, n, calls, h = self.inverse_fixture(); count = 0
        def actor(*args):
            nonlocal count
            count += 1
            return None if count == 1 else {'new': True}
        h.actor = actor
        with patch.object(m, 'query_components', return_value=parts), self.assertRaisesRegex(RuntimeError, 'changed_during_inverse'):
            m.inverse_source()

    def test_live_known_pid_cannot_be_called_terminal(self):
        raw = Path('/proc/self/stat').read_text(); ticks = int(raw[raw.rfind(')') + 2:].split()[19])
        with self.assertRaisesRegex(RuntimeError, 'PID_epoch'):
            m.gone([{'pid': os.getpid(), 'startTicks': ticks}])
        m.gone([{'pid': os.getpid(), 'startTicks': ticks - 1}])


if __name__ == '__main__': unittest.main(verbosity=2)
