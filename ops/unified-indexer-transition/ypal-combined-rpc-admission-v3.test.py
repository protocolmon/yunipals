#!/usr/bin/env python3
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = module(HERE / 'ypal-combined-rpc-admission-v3.py', 'combined_rpc')
PROFILE = json.loads((HERE / 'ypal-combined-rpc-profile-v1.json').read_bytes())


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.combined-rpc-test-', dir=HERE); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.c = module(HERE.parent / 'booster-launch/ypal-rpc-admission-v1.py', 'primitives'); self.c.BASE = self.base
        p = patch.object(m, 'BASE', self.base); p.start(); self.addCleanup(p.stop)

    def test_v1_preserved_and_only_absent_state_version_delta(self):
        old_path = HERE / 'ypal-combined-rpc-admission-v1.py'
        self.assertEqual(m.sha(old_path.read_bytes()), '02eddae174a3178b59938f991509ce01b088724254064364e80c868377a4e09a')
        old, new = ast.parse(old_path.read_text()), ast.parse(Path(m.__file__).read_text())
        old_functions = {n.name: ast.dump(n, include_attributes=False) for n in old.body if isinstance(n, ast.FunctionDef)}
        new_functions = {n.name: ast.dump(n, include_attributes=False) for n in new.body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(set(old_functions), set(new_functions))
        self.assertEqual([name for name in old_functions if old_functions[name] != new_functions[name]], ['state'])

    def test_actual_not_found_omitted_execstart_shape(self):
        for name in [m.SOURCE, *[m.unit(c) for c in m.CHAINS]]:
            row = {k: '' for k in dict.fromkeys(m.FIELDS + self.c.SECURITY)}
            row.update(Id=name, LoadState='not-found', MainPID='0', ActiveState='inactive', SubState='dead')
            del row['ExecStart']; del row['EnvironmentFiles']
            raw = ''.join(k + '=' + v + '\n' for k, v in row.items()).encode()
            with patch.object(self.c, 'run', return_value=raw) as run:
                got = m.state(self.c, name)
            self.assertEqual(got['ExecStart'], ''); self.assertEqual(got['EnvironmentFiles'], '')
            self.assertEqual(run.call_count, 1)

    def test_absent_normalization_refuses_loaded_or_other_missing_fields(self):
        name = m.unit('base'); row = {k: '' for k in dict.fromkeys(m.FIELDS + self.c.SECURITY)}
        row.update(Id=name, LoadState='not-found', MainPID='0', ActiveState='inactive', SubState='dead')
        for missing, change in [('ExecStart', {'LoadState': 'loaded'}), ('User', {}), ('ExecStart', {'MainPID': '1'}), ('ExecStart', {'FragmentPath': '/etc/foreign'})]:
            value = {**row, **change}; del value[missing]
            raw = ''.join(k + '=' + v + '\n' for k, v in value.items()).encode()
            with patch.object(self.c, 'run', return_value=raw), self.assertRaises(RuntimeError): m.state(self.c, name)

    def test_loaded_source_keeps_existing_typed_empty_environment_proof(self):
        name = m.YPAL_UNITS[1]; row = {k: '' for k in dict.fromkeys(m.FIELDS + self.c.SECURITY)}
        row.update(Id=name, LoadState='loaded', MainPID='2309283', ActiveState='active', SubState='running', ExecStart='public-command')
        del row['EnvironmentFiles']; raw = ''.join(k + '=' + v + '\n' for k, v in row.items()).encode()
        with patch.object(self.c, 'run', side_effect=[raw, b'{"type":"a(sb)","data":[]}']) as run:
            got = m.state(self.c, name)
        self.assertEqual(got['ExecStart'], 'public-command'); self.assertEqual(run.call_count, 2)

    def test_v2_frozen_and_only_peer_literal_version_delta(self):
        p = HERE / 'ypal-combined-rpc-admission-v2.py'
        self.assertEqual(m.sha(p.read_bytes()), '2752349d37a4421cb0687f20bb7a266985535ba83b76f720ed79883c7b5df6c6')
        old, new = ast.parse(p.read_text()), ast.parse(Path(m.__file__).read_text())
        funcs = lambda tree: {n.name: ast.dump(n, include_attributes=False) for n in tree.body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(funcs(old), funcs(new))
        constants = lambda tree: {n.targets[0].id: ast.dump(n.value, include_attributes=False) for n in tree.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)}
        a, b = constants(old), constants(new)
        self.assertEqual([k for k in a if a[k] != b[k]], ['FORMAT', 'BASE', 'PEER'])

    def test_node_env_file_missing_keys_only_for_exact_acknowledged_source(self):
        tree = ast.parse(m.PEER); function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'public_env_matches')
        namespace = {}; exec(compile(ast.Module(body=[function], type_ignores=[]), '<peer-env-guard>', 'exec'), namespace)
        check = namespace['public_env_matches']; expected = {'DATABASE_SCHEMA': 'yunipals_boosters_ypal_v1', 'UNIFIED_RPC_FREE_ONLY': 'true'}
        group = '/system.slice/yunipals-booster-ypal-source.service'
        self.assertTrue(check({}, expected, 2309283, group))
        self.assertTrue(check({b'DATABASE_SCHEMA': b'yunipals_boosters_ypal_v1'}, expected, 2309283, group))
        self.assertFalse(check({b'DATABASE_SCHEMA': b'changed'}, expected, 2309283, group))
        self.assertFalse(check({}, expected, 2309284, group))
        self.assertFalse(check({}, expected, 2309283, '/system.slice/yunipals-booster-api.service'))
        for group in ['/system.slice/yunipals-booster-api.service', '/system.slice/yunipals-ypal-base-rpc.service']:
            self.assertFalse(check({}, expected, 12, group))
            self.assertTrue(check({k.encode(): v.encode() for k, v in expected.items()}, expected, 12, group))

    def test_final_public_pins_and_exact_approval(self):
        for file, pin in [('ypal-combined-rpc-profile-v1.json', m.PROFILE_SHA), ('ypal-combined-rpc-approval-v1.json', m.APPROVAL_SHA), ('ypal-combined-rpc-official-v1.mjs', m.RUNNER_SHA)]:
            self.assertEqual(m.sha((HERE / file).read_bytes()), pin)
        self.assertEqual(json.loads((HERE / 'ypal-combined-rpc-approval-v1.json').read_bytes()), {'profile': PROFILE, 'expiresAt': m.EXPIRY, 'permits': []})

    def test_runner_only_changes_fixed_approval_destination(self):
        prior = (HERE.parent / 'booster-launch/ypal-rpc-official-v1.mjs').read_text()
        self.assertEqual((HERE / 'ypal-combined-rpc-official-v1.mjs').read_text(), prior.replace('/ypal-rpc-19212/approval.json', '/ypal-combined-rpc-v1/approval.json'))

    def test_four_new_ports_and_no_existing_unit_action(self):
        self.assertEqual(m.CHAINS, {'ethereum': (1, 19221), 'base': (8453, 19222), 'polygon': (137, 19223), 'bnb': (56, 19224)})
        for c in m.CHAINS:
            with patch.object(self.c, 'run', return_value=b'') as run: m.manager(self.c, 'start', c)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/systemctl', 'start', m.unit(c)])
            self.assertEqual(run.call_args.kwargs['timeout'], 130)
        for verb, c in [('restart', 'bnb'), ('stop', 'old'), ('daemon-reload', 'base')]:
            with self.assertRaises(RuntimeError): m.manager(self.c, verb, c)

    def test_new_environment_is_free_only_and_uses_full_profile(self):
        for c, (chain, port) in m.CHAINS.items():
            values = dict(x.split('=', 1) for x in m.env_bytes(c).decode().splitlines())
            self.assertEqual(values['MARKET_RPC_PROXY_PORT'], str(port)); self.assertEqual(values['MARKET_RPC_PROXY_CHAIN_ID'], str(chain))
            self.assertEqual(values['MARKET_RPC_PROXY_HOST'], '127.0.0.1'); self.assertEqual(values['MARKET_RPC_PROXY_MAX_IN_FLIGHT'], '2')
            self.assertEqual(values['MARKET_RPC_PROXY_UNIFIED_PROFILE_ID'], m.PROFILE_ID)
            self.assertEqual([values['MARKET_RPC_PROXY_' + k] for k in m.PAID_FLAGS], ['false'] * 7)

    def catalog(self):
        before = {'budget': {'enabled': True, 'dailyCu': '1000000'}, 'retainedProfiles': [{'id': 'old'}, {'id': 'ypal'}], 'profile': None, 'activePermits': 0, 'newPermits': 0}
        after = copy.deepcopy(before); after['profile'] = {'profile_id': m.PROFILE_ID, 'scope': PROFILE['scope'], 'manifest_hash': m.MANIFEST_HASH, 'policy': PROFILE, 'enabled': True, 'expires_at': '2026-11-19T18:00:00+00:00'}
        return before, after

    def test_exact_insert_only_admission_and_no_new_financial_authority(self):
        before, after = self.catalog()
        with patch.object(self.c, 'pinned', return_value=json.dumps(PROFILE).encode()): m.exact_catalog(self.c, after, before, True)
        for key, value in [('budget', {'enabled': True, 'dailyCu': '2'}), ('retainedProfiles', []), ('activePermits', 1), ('newPermits', 1)]:
            changed = copy.deepcopy(after); changed[key] = value
            with patch.object(self.c, 'pinned', return_value=json.dumps(PROFILE).encode()), self.assertRaises(RuntimeError): m.exact_catalog(self.c, changed, before, True)
        for key, value in [('enabled', False), ('policy', {}), ('manifest_hash', 'other'), ('expires_at', '2026-11-20T18:00:00Z')]:
            changed = copy.deepcopy(after); changed['profile'][key] = value
            with patch.object(self.c, 'pinned', return_value=json.dumps(PROFILE).encode()), self.assertRaises(RuntimeError): m.exact_catalog(self.c, changed, before, True)

    def test_preexisting_combined_profile_refused(self):
        before, after = self.catalog()
        with self.assertRaisesRegex(RuntimeError, 'must_be_absent'): m.exact_catalog(self.c, after, before, False)

    def test_lost_commit_ack_reconciliation_never_reexecutes_sql(self):
        intent = {'reviewHash': 'review', 'bootId': self.c.boot()}; self.c.save('commit-intent.json', intent)
        pin = m.sha((self.base / 'commit-intent.json').read_bytes())
        with patch.object(m, 'baseline', return_value={'reviewHash': 'review'}), patch.object(m, 'official') as sql, patch.object(m, 'admission_result', return_value={'observed': True}):
            self.assertEqual(m.reconcile(self.c, pin), {'observed': True}); sql.assert_not_called()

    def test_commit_intent_is_durable_before_sql_and_repeat_refused(self):
        before, _ = self.catalog(); reviewed = {'reviewHash': 'review', 'catalog': before, 'official': {'reviewHash': 'official'}}
        self.c.save('rehearsed.json', {'reviewHash': 'review'})
        def lost(*_):
            self.assertTrue((self.base / 'commit-intent.json').exists()); raise OSError('unknown_commit')
        with patch.object(m, 'baseline', return_value=reviewed), patch.object(m, 'catalog', return_value=before), patch.object(m, 'official', side_effect=lost):
            with self.assertRaises(OSError): m.commit(self.c, 'review')
            with self.assertRaisesRegex(RuntimeError, 'reconcile_not_retry'): m.commit(self.c, 'review')

    def test_start_ack_reconciliation_never_starts_or_publishes(self):
        intent = {'bootId': self.c.boot(), 'reviewHash': 'review', 'admissionReceiptSha256': 'admission'}; self.c.save('install-intent.json', intent)
        pin = m.sha((self.base / 'install-intent.json').read_bytes())
        with patch.object(m, 'baseline', return_value={'reviewHash': 'review'}), patch.object(m, 'result', return_value={'ok': True}) as result, patch.object(m, 'manager') as manager, patch.object(self.c, 'publish') as publish:
            self.assertEqual(m.reconcile_start(self.c, pin), {'ok': True}); manager.assert_not_called(); publish.assert_not_called()
            self.assertEqual(result.call_args.args[-1], True)

    def test_saved_direct_baseline_does_not_call_old_source_qualifier(self):
        b = {'operatorSha256': m.sha(Path(m.__file__).read_bytes()), 'bootId': self.c.boot(), 'inputs': {}, 'retained': {'direct': 'unchanged'}, 'plans': {c: {} for c in m.CHAINS}}
        before = {'binding': b, 'catalog': {}, 'official': {}}
        before['reviewHash'] = m.sha(m.encoded(before)); self.c.save('before.json', before)
        with patch.object(m, 'retained', return_value=b['retained']), patch.object(m, 'profile_inputs', return_value={}), patch.object(m, 'plan', return_value=({}, b'')), patch.object(self.c, 'source_guard', side_effect=AssertionError('old source drained')):
            self.assertEqual(m.baseline(self.c), before)

    def test_direct_baseline_refuses_same_pid_environment_or_file_drift(self):
        b = {'operatorSha256': m.sha(Path(m.__file__).read_bytes()), 'bootId': self.c.boot(), 'inputs': {}, 'retained': {'env': 'original'}, 'plans': {}}
        self.c.save('before.json', {'binding': b})
        with patch.object(m, 'retained', return_value={'env': 'changed'}), patch.object(m, 'profile_inputs', return_value={}), self.assertRaisesRegex(RuntimeError, 'direct_binding'): m.baseline(self.c)

    def test_protected_publish_owned_inode_and_foreign_replacement(self):
        p = self.base / 'unit'; self.c.publish(p, b'new', 'unit'); self.c.check_published('unit')
        replacement = self.base / 'replacement'; replacement.write_bytes(b'new'); replacement.replace(p)
        with self.assertRaisesRegex(RuntimeError, 'inode'): self.c.remove_published('unit')

    def test_combined_source_must_be_terminal_before_inverse(self):
        with patch.object(m, 'state', return_value={'MainPID': '12', 'Job': '', 'ActiveState': 'active'}), self.assertRaisesRegex(RuntimeError, 'must_be_stopped'): m.combined_stopped(self.c)

    def test_same_uid_peer_is_bounded_and_does_not_return_environment_values(self):
        account = types.SimpleNamespace(pw_uid=970, pw_gid=964)
        value = {'pid': 123, 'startTicks': 99, 'commandSha256': 'a' * 64, 'environmentSha256': 'b' * 64, 'environmentFiles': [], 'publicEnvironmentMatched': True, 'privileges': {}}
        with patch.object(self.c, 'run', return_value=json.dumps(value).encode()) as run:
            got = m.peer_actor(self.c, 123, account, '/system.slice/fixed.service', {'PUBLIC_KEY': 'public'})
        argv = run.call_args.args[0]; self.assertEqual(argv[:4], ['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups']); self.assertIn('--no-new-privs', argv)
        self.assertIn('--ambient-caps=-all', argv); self.assertIn('--inh-caps=-all', argv); self.assertEqual(run.call_args.kwargs['timeout'], 8)
        self.assertNotIn('environment', got); self.assertNotIn('command', got)
        tree = ast.parse(Path(m.__file__).read_text()); peer_literal = next(n.value.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(x, ast.Name) and x.id == 'PEER' for x in n.targets))
        self.assertIn('assert public_env_matches(e,expected,pid,group)', peer_literal)

    def test_direct_readiness_uses_pinned_receipts_and_queue_static_not_oneshot_pid(self):
        text = Path(m.__file__).read_text()
        for pin in [m.YPAL_SOURCE_SHA, m.YPAL_READER_SHA, m.YPAL_BOOT_SHA]: self.assertIn(pin, text)
        tree = ast.parse(text); f = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'accepted_ypal'); body = ast.get_source_segment(text, f)
        self.assertIn("source_query(m, module.catalog_sql())", body); self.assertIn("reader['roleGraphSha256']", body)
        self.assertIn("get(9030, '/v1/boosters/types')", body); self.assertIn("for name in [QUEUE, TIMER]", body)
        self.assertNotIn("state(m, QUEUE)", body); self.assertIn("row['ActiveState'] == 'active'", body)

    def test_source_query_is_read_only_peer_without_dev_null_password(self):
        with patch.object(self.c, 'run', return_value=b'{}') as run, patch.object(m.os.path, 'lexists', return_value=False): m.source_query(self.c, 'SELECT 1')
        args = run.call_args.args[0]; self.assertIn('-p', args); self.assertIn('5432', args); self.assertNotIn('PGPASSFILE=/dev/null', args)
        self.assertTrue(run.call_args.args[1].startswith(b'BEGIN READ ONLY;')); self.assertTrue(run.call_args.args[1].endswith(b';ROLLBACK;'))

    def test_start_stays_closed_until_separate_single_connection_artifact_qualified(self):
        self.assertIsNone(m.SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA)
        with patch.object(m, 'baseline') as baseline, patch.object(m, 'manager') as manager, self.assertRaisesRegex(RuntimeError, 'single_connection'):
            m.start(self.c, 'not-a-pin')
        baseline.assert_not_called(); manager.assert_not_called()
        self.assertEqual(list(self.base.iterdir()), [])

    def test_accepted_type_rule_and_freshness_validation(self):
        operation = {'buildId': '8e88ea2e00', 'deployment': {'registry': '0x' + '1' * 40, 'engine': '0x' + '2' * 40,
                     'ypal': '0x' + '3' * 40, 'catalogHash': '0x' + '4' * 64, 'sourceStartBlock': '52995007'}, 'expectedRuleHash': '0x' + '5' * 64}
        expected = {'id': '8453:0x' + '1' * 40 + ':1', 'registry': '0x' + '1' * 40, 'engine': '0x' + '2' * 40,
                    'payment_token': '0x' + '3' * 40, 'catalog_hash': '0x' + '4' * 64, 'rule_hash': '0x' + '5' * 64,
                    'pack_type_id': '1', 'price': '1000000000000000000', 'interval_seconds': 86400, 'mints_per_interval': 1,
                    'total_variants': 264, 'max_batch': 7, 'sales_paused': False,
                    'manifest_uri': 'https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/manifest.json',
                    'metadata_base_uri': 'https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/'}
        row = {'app': {'build_id': operation['buildId'], 'version': 6, 'is_dev': 0, 'is_locked': 1, 'is_ready': 1, 'heartbeat_at': 1792780000000},
               'clock': 1792780000000, 'checkpoint': '1792780000' + str(8453).zfill(16) + str(52995007).zfill(16) + '9' * 33, 'types': [expected]}
        self.assertEqual(m.native_rules(row, operation), expected)
        for key in ['payment_token', 'catalog_hash', 'rule_hash', 'price', 'manifest_uri', 'metadata_base_uri']:
            changed = copy.deepcopy(row); changed['types'][0][key] = 'changed'
            with self.assertRaisesRegex(RuntimeError, 'type_one'): m.native_rules(changed, operation)
        changed = copy.deepcopy(row); changed['clock'] += 180001
        with self.assertRaisesRegex(RuntimeError, 'fresh'): m.native_rules(changed, operation)
        changed = copy.deepcopy(row); changed['checkpoint'] = changed['checkpoint'][:-1] + '0'
        with self.assertRaisesRegex(RuntimeError, 'checkpoint'): m.native_rules(changed, operation)

    def test_retained_public_proxy_and_source_argv_bound_to_accepted_records(self):
        text = Path(m.__file__).read_text()
        self.assertIn("m.pinned(rpc['profileFile'], rpc['profileFileSha256'])", text)
        self.assertIn('m.protected(m.ENV_FILE) == m.env_bytes()', text)
        self.assertIn('check_link(m.BOOT_LINK, rpc_boot)', text)
        self.assertIn("actual['processes'][0]['commandSha256'] == accepted['sourceCommandSha256']", text)
        self.assertIn("actual['processes'][1]['parentPid'] == actual['pid']", text)
        self.assertIn('m.pinned(ESBUILD, ESBUILD_SHA)', text)

    def test_inverse_never_drops_admission_native_cache_or_old_units(self):
        tree = ast.parse(Path(m.__file__).read_text()); f = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'restore')
        body = ast.get_source_segment(Path(m.__file__).read_text(), f)
        for bad in ['DELETE FROM', 'DROP ', 'UPDATE ', 'restart', 'owner.validate_current']: self.assertNotIn(bad, body)
        self.assertIn("'profileAdmissionRetained': True", body); self.assertIn('owned_stop_intent_actor_changed', body)

    def test_gate_rejects_foreign_profile_paid_or_wrong_chain(self):
        def gate(workload): return {'profileId': m.PROFILE_ID, 'manifestHash': m.MANIFEST_HASH, 'chainId': 56, 'replay': {'mode': 'free_only'}, 'workload': workload, 'scope': 'yunipals-opensea', 'coordinatorId': 'faf1bb8c-4306-4c43-b55e-6ac5fa038567', 'limits': PROFILE['limits']}
        metrics = {'freeRouting': True, 'paidFallbackOnFreeFailure': False, 'sourcePaidFallbackOnFreeFailure': False, 'unified': {'profileId': m.PROFILE_ID, 'chainId': 56, 'sourceRouting': 'free_first', 'traffic': {w: {'paidCalls': 0} for w in ['unified_source', 'unified_evidence']}}}
        def get(port, path, headers=None): return copy.deepcopy(metrics if path == '/metrics' else gate(headers['x-yunipals-rpc-workload']))
        with patch.object(m, 'get', side_effect=get): self.assertEqual(len(m.gate('bnb')), 2)
        metrics['unified']['traffic']['unified_source']['paidCalls'] = 1
        with patch.object(m, 'get', side_effect=get), self.assertRaisesRegex(RuntimeError, 'free_only'): m.gate('bnb')


if __name__ == '__main__': unittest.main()
