"""Synthetic-only controls. No production catalog/receipt fixture is published."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('read_admission', HERE / 'ypal-combined-read-admission-v2.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def fixture():
    N, R, C = m.NATIVE, m.READ_SCHEMA, 'yunipals_indexer_control'
    common = ['_ponder_meta', '_ponder_checkpoint', 'indexer_source', 'chain_checkpoint', 'chain_block', 'token', 'token_lifecycle', 'transfer_event', 'admin_role_event', 'contract_owner_event']
    boundary = ['_ponder_meta', '_ponder_checkpoint', 'indexer_source', 'chain_block']
    views = ['_unified_read_release', 'admin_role_event', 'base_metadata_event', 'base_metadata_scan', 'contract_owner_event', 'source_status', 'token', 'token_lifecycle', 'transfer_event']
    funcs = ['base_metadata_frame(boolean)', 'base_metadata_probe()', 'source_boundary(text)', 'source_probe(text)']
    request = {}
    roles = list(m.ROLE_OIDS)
    for role in roles:
        if role == 'yunipals': native, view, fn, scopes, controls = boundary + ['canonical_event'], views, funcs, [N, R, C], ['release', 'chain_status']
        elif role.endswith('_support'): native, view, fn, scopes, controls = boundary + ['chain_checkpoint', 'canonical_event', 'transaction_candidate'], [], [], [N], []
        elif role.endswith('_staking'): native, view, fn, scopes, controls = boundary + ['transfer_event'], ['_unified_read_release', 'transfer_event'], funcs[2:], [N, R], []
        elif role.endswith('_islands_api'): native, view, fn, scopes, controls = common, [v for v in views if not v.startswith('base_metadata_')], funcs[2:], [N, R], []
        else: native, view, fn, scopes, controls = common + ['canonical_event'] + (['transaction_candidate', 'booster_request'] if role.endswith('_api') else []), views, funcs, [N, R], []
        request[role] = [('schema', x, 'USAGE') for x in scopes] + [('relation', N + '.' + x, 'SELECT') for x in native] + [('relation', R + '.' + x, 'SELECT') for x in view] + [('relation', C + '.' + x, 'SELECT') for x in controls] + [('function', R + '.' + x, 'EXECUTE') for x in fn]
    names = sorted({(kind, name) for rows in request.values() for kind, name, _ in rows})
    objects = {(kind, name): {'oid': str(1000 + index), 'owner': '900' if name.split('.')[0] != R else '10'} for index, (kind, name) in enumerate(names)}
    missing = sorted([{'kind': kind, 'name': name, 'privilege': privilege, 'role': role, 'grantee': m.ROLE_OIDS[role], 'object': objects[kind, name]['oid'], 'grantor': objects[kind, name]['owner']} for role, rows in request.items() for kind, name, privilege in rows], key=lambda v: (v['role'], v['kind'], v['name']))
    before = {'databaseOid': '17584', 'currentUser': 'postgres', 'sessionUser': 'postgres', 'socket': True, 'port': '5432',
              'roles': [{'name': r, 'oid': m.ROLE_OIDS[r], 'login': r in {'yunipals', 'yunipals_unified_collector', 'yunipals_unified_support'}, 'limit': 6} for r in roles],
              'schemas': [], 'relations': [], 'functions': [], 'directRoleEdges': [], 'targetEdges': [], 'effective': [], 'retained': {'tcg': 20, 'solana': 9, 'writesOwnedByMetadata': True}}
    for (kind, name), row in objects.items():
        value = {'name': name, **row, 'acl': 'canonical-owner-only', 'definitionMd5': 'synthetic-definition'}
        before[{'schema': 'schemas', 'relation': 'relations', 'function': 'functions'}[kind]].append(value)
    for role in roles:
        before['effective'].append({'role': role, 'schemas': {name: {'usage': False, 'create': False} for kind, name in names if kind == 'schema'},
                                    'relations': {name: {'select': False, 'writes': False} for kind, name in names if kind == 'relation'},
                                    'functions': {name: False for kind, name in names if kind == 'function'}})
    after = copy.deepcopy(before); eff = {x['role']: x for x in after['effective']}
    for v in missing:
        edge = {'kind': v['kind'], 'object': v['object'], 'object_name': v['name'], 'grantee': v['grantee'], 'grantor': v['grantor'], 'privilege': v['privilege'], 'grantable': False}
        after['targetEdges'].append(edge); after['directRoleEdges'].append({**edge, 'column_number': None})
        if v['kind'] == 'schema': eff[v['role']]['schemas'][v['name']]['usage'] = True
        elif v['kind'] == 'relation': eff[v['role']]['relations'][v['name']]['select'] = True
        else: eff[v['role']]['functions'][v['name']] = True
    p = {'missingPermissions': missing, 'missingCount': len(missing)}
    return p, before, after


class Tests(unittest.TestCase):
    def test_full_143_read_only_edges_and_collector_login_retained(self):
        p, before, after = fixture(); self.assertEqual(len(p['missingPermissions']), 143)
        self.assertEqual({v: sum(x['privilege'] == v for x in p['missingPermissions']) for v in ['SELECT', 'EXECUTE', 'USAGE']}, {'SELECT': 109, 'EXECUTE': 20, 'USAGE': 14})
        self.assertTrue(m.validate_delta(p, before, after))
        self.assertTrue(next(v for v in after['roles'] if v['name'] == 'yunipals_unified_collector')['login'])

    def test_exact_sql_only_143_read_grants_and_owned_revoke_inverse(self):
        p, before, after = fixture(); grant = m.statements(p); revoke = m.statements(p, True)
        self.assertEqual(len(grant), len(revoke)); self.assertTrue(all(v.startswith('GRANT ') for v in grant))
        self.assertTrue(all(v.startswith('REVOKE ') for v in revoke))
        self.assertNotRegex('\n'.join(grant), r'\b(?:LOGIN|INSERT|UPDATE|DELETE|CREATE ROLE|ALTER|ALL PRIVILEGES|GRANT OPTION)\b')
        sql = m.transaction(p, 'SELECT 1', before, after, True)
        self.assertLess(sql.index('exact_read_catalog_changed'), sql.index('GRANT ')); self.assertTrue(sql.endswith('COMMIT;\n'))
        with self.assertRaises(RuntimeError): m.transaction(p, 'SELECT 1', before, commit=True)

    def test_main_candidate_and_booster_request_both_needed_and_no_other_booster_grants(self):
        p, _, _ = fixture(); rows = [v['name'] for v in p['missingPermissions'] if v['role'] == 'yunipals_unified_api']
        self.assertIn(m.NATIVE + '.transaction_candidate', rows); self.assertIn(m.NATIVE + '.booster_request', rows)
        self.assertNotIn(m.NATIVE + '.booster_monster', rows)

    def test_extra_read_or_public_grant_refused(self):
        p, before, after = fixture()
        for field in ['targetEdges', 'directRoleEdges']:
            bad = copy.deepcopy(after); edge = copy.deepcopy(bad[field][0]); edge['grantee'] = '0'; bad[field].append(edge)
            with self.assertRaises(RuntimeError): m.validate_delta(p, before, bad)

    def test_login_limit_password_role_and_dml_drift_refused(self):
        p, before, after = fixture()
        for edit in [lambda v: v['roles'][0].update(login=True), lambda v: v['roles'][0].update(limit=-1),
                     lambda v: v['roles'][0].update(passwordConfigured=True), lambda v: next(iter(v['effective'][0]['relations'].values())).update(writes=True)]:
            bad = copy.deepcopy(after); edit(bad)
            with self.assertRaises(RuntimeError): m.validate_delta(p, before, bad)

    def test_oid_definition_owner_old_operational_change_refused(self):
        p, before, after = fixture()
        for edit in [lambda v: v['relations'][0].update(oid='999999'), lambda v: v['functions'][0].update(definitionMd5='changed'),
                     lambda v: v['schemas'][0].update(owner='foreign'), lambda v: v['retained'].update(tcg=19)]:
            bad = copy.deepcopy(after); edit(bad)
            with self.assertRaises(RuntimeError): m.validate_delta(p, before, bad)

    def test_nonread_or_foreign_role_statement_refused(self):
        p, _, _ = fixture()
        for edit in [lambda v: v.update(privilege='UPDATE'), lambda v: v.update(role='postgres'), lambda v: v.update(name='public.other')]:
            bad = copy.deepcopy(p); edit(bad['missingPermissions'][0])
            with self.assertRaises(RuntimeError): m.statements(bad)

    def test_reader_ack_accepts_only_exact_owned_collector_edges(self):
        p, _, _ = fixture(); before = {'role': {'login': True}, 'tables': [20], 'edges': []}; after = copy.deepcopy(before)
        after['edges'] = [{k: v[k] for k in ['kind', 'object', 'grantor', 'privilege']} | {'grantable': False} for v in p['missingPermissions'] if v['role'] == 'yunipals_unified_collector']
        m.validate_reader_delta(p, before, after)
        for edit in [lambda v: v['role'].update(login=False), lambda v: v['tables'].append('foreign'), lambda v: v['edges'][0].update(grantor='foreign')]:
            bad = copy.deepcopy(after); edit(bad)
            with self.assertRaises(RuntimeError): m.validate_reader_delta(p, before, bad)

    def test_namespace_preserves_original_globals_and_returns_actual_hash(self):
        p, _, _ = fixture(); before = {'edges': [], 'tables': [20]}; after = copy.deepcopy(before)
        after['edges'] = [{k: v[k] for k in ['kind', 'object', 'grantor', 'privilege']} | {'grantable': False} for v in p['missingPermissions'] if v['role'] == 'yunipals_unified_collector']
        raw = (HERE / 'ypal-combined-rpc-admission-v3.py').read_bytes()
        a = types.SimpleNamespace(sentinel='unchanged'); state = dict(a.__dict__)
        h = types.SimpleNamespace(m=types.SimpleNamespace(route_owner=a, pinned=lambda *_: raw))
        namespace = m.retained_namespace(h, p, before, after)
        self.assertEqual(a.__dict__, state); self.assertNotIn('acknowledged_catalog', a.__dict__)
        check = namespace['acknowledged_catalog']; check(None, {'roleGraphSha256': m.sha(m.encoded(before))}, after)
        with self.assertRaises(RuntimeError): check(None, {'roleGraphSha256': 'foreign'}, after)
        with self.assertRaises(RuntimeError): check(None, {'roleGraphSha256': m.sha(m.encoded(before))}, before)
        tree = ast.parse(raw); original = next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'accepted_ypal')
        self.assertIn("reader['roleGraphSha256']", ast.unparse(original))

    def test_retained_comparison_requires_real_actual_hash_and_all_other_facts(self):
        old = {'api': {'pid': 10, 'private': 'hash'}, 'acceptedYpal': {'readerCatalogSha256': 'old', 'queue': 'static'}}
        now = copy.deepcopy(old); now['acceptedYpal']['readerCatalogSha256'] = 'actual'
        m.compare_retained(now, old, 'old', 'actual')
        for edit in [lambda v: v['api'].update(private='changed'), lambda v: v['acceptedYpal'].update(queue='changed'), lambda v: v['acceptedYpal'].update(readerCatalogSha256='foreign')]:
            bad = copy.deepcopy(now); edit(bad)
            with self.assertRaises(RuntimeError): m.compare_retained(bad, old, 'old', 'actual')

    def context(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup); base = Path(directory.name)
        self.enterContext(patch.object(m, 'BASE', base))
        def save(path, value):
            with path.open('xb') as file: file.write(m.encoded(value))
        def document(path, pin=None):
            raw = path.read_bytes()
            if pin is not None: self.assertEqual(m.sha(raw), pin)
            return json.loads(raw)
        s = types.SimpleNamespace(save=save, document=document, protected=lambda p: Path(p).read_bytes(), boot=lambda: 'boot')
        p, b, a = fixture(); before = {'operatorSha256': 'operator', 'readerBefore': {'edges': []}, 'reviewHash': 'review', 'catalogBefore': b, 'sourceBinding': 'source', 'consumers': 'consumers'}
        rehearsal = {'format': m.FORMAT, 'rehearsed': True, 'reviewHash': 'review', 'after': a, 'readerAfter': 'reader'}
        save(base / 'before.json', before); save(base / 'rehearsed.json', rehearsal)
        self.enterContext(patch.object(m, 'records', return_value=(before, rehearsal)))
        self.enterContext(patch.object(m, 'source_binding', return_value='source'))
        self.enterContext(patch.object(m, 'consumer_frame', return_value='consumers'))
        self.enterContext(patch.object(m, 'post_runtime', return_value={'originalWholeValidatorPassed': False}))
        return base, s, p, before, rehearsal

    def test_lost_commit_ack_has_fsynced_intent_and_never_repeats_sql(self):
        base, s, p, before, rehearsal = self.context()
        def query(_h, _sql, readonly=True):
            self.assertFalse(readonly); self.assertTrue((base / 'commit-intent.json').exists()); raise RuntimeError('unknown_ACK')
        view = types.SimpleNamespace(query=query)
        with self.assertRaisesRegex(RuntimeError, 'unknown_ACK'): m.commit(view, None, s, None, None, None, p, 'SELECT 1', 'review')
        with self.assertRaisesRegex(RuntimeError, 'one_read_commit_attempt_only'): m.commit(view, None, s, None, None, None, p, 'SELECT 1', 'review')

    def test_intent_only_reconcile_is_readonly_and_crossboot_refused(self):
        base, s, p, before, rehearsal = self.context()
        intent = {'format': m.FORMAT, 'reviewHash': 'review', 'bootId': 'boot', 'planSha256': m.PLAN_SHA, 'rehearsalSha256': m.sha((base / 'rehearsed.json').read_bytes())}
        s.save(base / 'commit-intent.json', intent)
        with patch.object(m, 'acknowledge', return_value='confirmed') as ack:
            self.assertEqual(m.reconcile(None, None, s, None, None, None, p, '', m.sha((base / 'commit-intent.json').read_bytes())), 'confirmed')
            self.assertEqual(ack.call_args.args[-1], True)
        with patch.object(s, 'boot', return_value='other'):
            with self.assertRaises(RuntimeError): m.reconcile(None, None, s, None, None, None, p, '', m.sha((base / 'commit-intent.json').read_bytes()))

    def test_inverse_review_refuses_changed_catalog_and_consumer(self):
        base, s, p, before, rehearsal = self.context()
        value = {'operatorSha256': 'operator', 'reviewHash': 'review', 'catalogAfterSha256': 'after'}
        with patch.object(m, 'admitted', return_value=(value, before, rehearsal)):
            with self.assertRaises(RuntimeError): m.inverse_review(types.SimpleNamespace(query=lambda *_: [{}]), None, s, None, None, None, p, '', 'pin')
            with patch.object(m, 'post_runtime', side_effect=RuntimeError('private_input_changed')):
                with self.assertRaisesRegex(RuntimeError, 'private_input_changed'): m.inverse_review(types.SimpleNamespace(query=lambda *_: [rehearsal['after']]), None, s, None, None, None, p, '', 'pin')

    def test_real_intent_only_commit_reconcile_has_zero_write_calls(self):
        base, s, p, before, rehearsal = self.context()
        intent = {'format': m.FORMAT, 'reviewHash': 'review', 'bootId': 'boot', 'planSha256': m.PLAN_SHA, 'rehearsalSha256': m.sha((base / 'rehearsed.json').read_bytes())}
        s.save(base / 'commit-intent.json', intent); calls = []
        def query(_h, _sql, readonly=True):
            calls.append(readonly); return [rehearsal['after']]
        value = m.reconcile(types.SimpleNamespace(query=query), None, s, None, None, None, p, 'SELECT 1', m.sha((base / 'commit-intent.json').read_bytes()))
        self.assertEqual(calls, [True, True]); self.assertTrue(value['admitted']); self.assertTrue(value['reconciledAfterUnknownAck'])
        self.assertFalse((base / 'failed.json').exists()); self.assertFalse(value['originalWholeValidatorPassed'])

    def test_lost_inverse_ACK_reconciles_owned_real_intent_without_revoke_retry(self):
        base, s, p, before, rehearsal = self.context()
        value = {'operatorSha256': 'operator', 'reviewHash': 'review', 'catalogAfterSha256': m.sha(m.encoded(rehearsal['after']))}
        state = {'catalog': rehearsal['after']}; calls = []
        def query(_h, _sql, readonly=True):
            calls.append(readonly)
            if not readonly:
                self.assertTrue((base / 'inverse-intent.json').exists()); state['catalog'] = before['catalogBefore']; raise RuntimeError('inverse_ACK_lost')
            return [state['catalog']]
        view = types.SimpleNamespace(query=query)
        with patch.object(m, 'admitted', return_value=(value, before, rehearsal)):
            checked = m.inverse_review(view, None, s, None, None, None, p, 'SELECT 1', 'admission')
            with self.assertRaisesRegex(RuntimeError, 'inverse_ACK_lost'):
                m.inverse(view, None, s, None, None, None, p, 'SELECT 1', 'admission', checked['inverseReviewHash'])
            pin = m.sha((base / 'inverse-intent.json').read_bytes())
            result = m.reconcile_inverse(view, None, s, None, None, None, p, 'SELECT 1', pin)
        self.assertTrue(result['inversed']); self.assertTrue(result['reconciledAfterUnknownAck']); self.assertEqual(calls.count(False), 1)

    def test_forward_read_validation_allows_owned_downstream_selection_not_acl_drift(self):
        base, s, p, before, rehearsal = self.context()
        value = {'operatorSha256': 'operator', 'actualReaderCatalogSha256': 'actual', 'originalReaderCatalogSha256': 'original'}
        changed = copy.deepcopy(rehearsal['after']); changed.update(activeRelease=[{'name': 'owned-new-selection'}], nativeMetadataAdoptions=1)
        context = (types.SimpleNamespace(query=lambda *_: [changed]), None, s, None, None, None, p, 'SELECT 1')
        with patch.object(m, 'load', return_value=context), patch.object(m, 'admitted', return_value=(value, before, rehearsal)):
            result = m.validate_current('actual-ack')
            self.assertFalse(result['consumerSelectionsQualified']); self.assertFalse(result['sourceReadinessClaimed'])
            self.assertEqual(m.post_runtime.call_args.args[-1], False)
            changed['roles'][0]['limit'] = 999
            with self.assertRaisesRegex(RuntimeError, 'same_current_admitted_read_graph_required'): m.validate_current('actual-ack')

    def test_inverse_catalog_does_not_ignore_adoption_or_selector_changes(self):
        p, before, after = fixture()
        for field, value in [('activeRelease', [{'release': 'new'}]), ('nativeMetadataAdoptions', 1)]:
            bad = copy.deepcopy(after); bad[field] = value
            with self.assertRaises(RuntimeError): m.validate_delta(p, before, bad)

    def test_actual_shaped_environment_reset_drops_unused_inherited_files(self):
        unit = 'yunipals-api.service'; base = '/fixture/base.service'; drop = '/fixture/95-owned.conf'
        state = {'Id': unit, 'FragmentPath': base, 'DropInPaths': drop, 'MainPID': '5', 'InvocationID': 'inv', 'ActiveState': 'active'}
        rows = {base: b'[Service]\nEnvironmentFile=/fixture/unused.env\n', drop: b'[Service]\nEnvironmentFile=\nEnvironmentFile=/fixture/actual.env\nEnvironmentFile=-/fixture/optional.env\n', '/fixture/actual.env': b'PUBLIC=unchanged\n'}
        reads = []
        def protected(path):
            reads.append(path); return rows[path]
        h = types.SimpleNamespace(m=types.SimpleNamespace(run=lambda *_args, **_kwargs: ('\n'.join(k + '=' + v for k, v in state.items()) + '\n').encode(), protected=protected))
        with patch.object(m, 'UNITS', (unit,)), patch.object(m.os.path, 'lexists', return_value=False):
            result = m.consumer_frame(h)[unit]
        self.assertNotIn('/fixture/unused.env', reads); self.assertNotIn('/fixture/unused.env', result['files'])
        self.assertEqual(result['files'][base], m.sha(rows[base])); self.assertEqual(result['files'][drop], m.sha(rows[drop]))
        self.assertEqual(result['files']['/fixture/actual.env'], m.sha(rows['/fixture/actual.env']))
        self.assertIsNone(result['files']['/fixture/optional.env'])

    def test_environment_nonliteral_still_refused_and_later_file_drift_visible(self):
        unit = 'yunipals-api.service'; base = '/fixture/base.service'
        state = {'Id': unit, 'FragmentPath': base, 'DropInPaths': '', 'MainPID': '5', 'InvocationID': 'inv', 'ActiveState': 'active'}
        raw = {'body': b'[Service]\nEnvironmentFile=\nEnvironmentFile=/fixture/actual.env\n', 'env': b'A=one\n'}
        h = types.SimpleNamespace(m=types.SimpleNamespace(run=lambda *_args, **_kwargs: ('\n'.join(k + '=' + v for k, v in state.items()) + '\n').encode(), protected=lambda path: raw['body'] if path == base else raw['env']))
        with patch.object(m, 'UNITS', (unit,)):
            first = m.consumer_frame(h); raw['env'] = b'A=two\n'; self.assertNotEqual(first, m.consumer_frame(h))
            for declaration in ['/fixture/a /fixture/b', '/fixture/%i.env', '/fixture/*.env', '"/fixture/a"']:
                raw['body'] = ('[Service]\nEnvironmentFile=' + declaration + '\n').encode()
                with self.assertRaisesRegex(RuntimeError, 'literal_retained_environment_file_required'): m.consumer_frame(h)

    def test_v1_function_AST_preserved_except_environment_observer(self):
        old = ast.parse((HERE / 'ypal-combined-read-admission-v1.py').read_bytes()); new = ast.parse((HERE / 'ypal-combined-read-admission-v2.py').read_bytes())
        functions = lambda tree: {v.name: ast.dump(v, include_attributes=False) for v in tree.body if isinstance(v, (ast.FunctionDef, ast.ClassDef)) and v.name != 'consumer_frame'}
        self.assertEqual(functions(old), functions(new))


if __name__ == '__main__': unittest.main()
