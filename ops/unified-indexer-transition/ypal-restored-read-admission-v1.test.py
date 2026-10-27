"""Synthetic plans/real owned filesystem only. No production inputs or connections."""
import ast
import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

m = load('ypal-restored-read-admission-v1.py')
f = load('ypal-combined-read-admission-v2.test.py')


def fixture():
    plan, before, after = f.fixture()
    return plan, {'read': before, 'allColumnAcl': []}, {'read': after, 'allColumnAcl': []}


class Tests(unittest.TestCase):
    def test_exact143_pure_edge_scope_and_all_columns(self):
        p, before, after = fixture(); self.assertTrue(m.validate_delta(f.m, p, before, after))
        self.assertEqual(len(f.m.statements(p)), 143)
        self.assertEqual(sum(v['privilege'] == 'SELECT' for v in p['missingPermissions']), 109)
        self.assertTrue(next(v for v in after['read']['roles'] if v['name'] == 'yunipals_unified_collector')['login'])

    def test_unmanaged_column_grantee_and_PUBLIC_refused(self):
        p, before, after = fixture()
        for grantee in ['0', '999999999']:
            bad = copy.deepcopy(after); bad['allColumnAcl'] = [{'relation': '15', 'column': 1, 'acl': 'foreign', 'edges': [{'grantee': grantee, 'privilege': 'SELECT'}]}]
            with self.assertRaisesRegex(RuntimeError, 'all_grantee_column'): m.validate_delta(f.m, p, before, bad)

    def test_existing_column_edges_cannot_disappear_or_change(self):
        p, before, after = fixture()
        before['allColumnAcl'] = [{'column': 1, 'acl': 'original', 'grantor': '10'}]
        after['allColumnAcl'] = copy.deepcopy(before['allColumnAcl'])
        self.assertTrue(m.validate_delta(f.m, p, before, after))
        after['allColumnAcl'][0]['grantor'] = '9'
        with self.assertRaises(RuntimeError): m.validate_delta(f.m, p, before, after)

    def test_table_foreign_ROLE_LOGIN_DML_and_OID_drift_refused(self):
        p, before, after = fixture()
        changes = [lambda v: v['read']['roles'][0].update(login=True), lambda v: v['read']['relations'][0].update(oid='8'),
                   lambda v: v['read']['targetEdges'].append({**v['read']['targetEdges'][0], 'grantee': '0'}),
                   lambda v: next(iter(v['read']['effective'][0]['relations'].values())).update(writes=True)]
        for change in changes:
            bad = copy.deepcopy(after); change(bad)
            with self.assertRaises(RuntimeError): m.validate_delta(f.m, p, before, bad)

    def test_all_column_SQL_does_not_filter_managed_roles_or_target_namespaces(self):
        sql = (HERE / 'ypal-restored-read-admission-v1.columns.sql').read_text()
        self.assertEqual(m.sha(sql.encode()), m.COLUMNS_SHA)
        self.assertIn('aclexplode(a.attacl)', sql); self.assertIn('a.attacl IS NOT NULL', sql)
        self.assertNotIn('grantee IN', sql); self.assertNotIn('unified_ypal', sql)

    def test_transaction_guards_complete_snapshot_and_reversible143(self):
        plan, before, after = fixture(); host = types.SimpleNamespace(sql='SELECT complete_snapshot', helpers=f.m, plan=plan)
        text = m.transaction(host, before, after, True)
        self.assertEqual(text.count('COMMIT;'), 1); self.assertEqual(text.count('GRANT '), 143)
        self.assertIn('allColumnAcl', text); self.assertLess(text.index('current_read_catalog_changed'), text.index('GRANT '))
        self.assertNotIn('ALTER ROLE', text); self.assertNotIn('UPDATE ', text)
        inverse = m.transaction(host, after, before, True, True)
        self.assertEqual(inverse.count('REVOKE '), 143)
        with self.assertRaises(RuntimeError): m.transaction(host, before, commit=True)

    def test_new_constructor_has_no_historical_runtime_or_view_load(self):
        source = (HERE / 'ypal-restored-read-admission-v1.py').read_text(); tree = ast.parse(source)
        calls = {ast.unparse(v.func) for v in ast.walk(tree) if isinstance(v, ast.Call)}
        self.assertFalse({'helpers.load', 'view.load', 'c9.load', 'self.context.historical().validate_runtime'} & calls)
        self.assertIn('self.context.load_components', calls)
        self.assertNotIn('c96', ast.unparse(next(v for v in tree.body if isinstance(v, ast.ClassDef) and v.name == 'Host')))

    def test_new_owned_files_exclusive_and_actual_bytes_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'result.json'; first = {'actual': True}
            m.save(target, first); raw = target.read_bytes(); inode = target.stat().st_ino
            with self.assertRaises(FileExistsError): m.save(target, {'actual': False})
            self.assertEqual(raw, target.read_bytes()); self.assertEqual(inode, target.stat().st_ino)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def lifecycle(self, mode):
        plan, before, after = fixture(); stable = {'runtime': {'epoch': 'new-restored'}, 'consumers': {'old': 'same'}}
        host = types.SimpleNamespace(plan=plan, plan_sha='a'*64, context_input='b'*64, helpers=f.m, stable=lambda: copy.deepcopy(stable), sql='SELECT catalog')
        host.runtime = lambda: copy.deepcopy(stable['runtime']); host.consumers = lambda: copy.deepcopy(stable['consumers'])
        state = {'catalog': before, 'calls': 0}
        host.catalog = lambda: copy.deepcopy(state['catalog'])
        def execute(sql, readonly):
            state['calls'] += 1
            if sql.endswith('ROLLBACK;'): return [after]
            state['catalog'] = copy.deepcopy(before if 'REVOKE ' in sql else after)
            if mode == 'lost' and 'GRANT ' in sql: raise TimeoutError('lost ACK')
            return [copy.deepcopy(state['catalog'])]
        host.query = execute
        review = {'format': m.FORMAT, 'operatorSha256': 'e'*64, 'bootId': 'boot', 'planSha256': host.plan_sha,
                  'contextInputSha256': host.context_input, 'stable': stable, 'catalogBefore': before, 'readEdgeCount': 143,
                  'loginChanges': 0, 'newDml': 0, 'serviceActions': 0}
        review['reviewHash'] = m.sha(m.encoded(review))
        return host, state, review

    def prepare(self, host, review, base):
        m.save(base/'before.json', review)
        m.save(base/'rehearsed.json', {'format': m.FORMAT, 'operatorSha256': 'e'*64, 'rehearsed': True, 'databaseCommitted': False,
               'reviewHash': review['reviewHash'], 'beforeSha256': m.sha((base/'before.json').read_bytes()), 'after': fixture()[2]})

    def test_lost_ACK_readonly_reconcile_never_regrants(self):
        host, state, before = self.lifecycle('lost')
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'BASE', Path(tmp)), patch.object(m, 'own_sha', return_value='e'*64), patch.object(m, 'boot', return_value='boot'), patch.object(m, 'protected', side_effect=lambda p, expected=None: Path(p).read_bytes()):
            self.prepare(host, before, Path(tmp)); auth = m.sha(m.encoded(host.helpers.statements(host.plan)))
            with self.assertRaises(TimeoutError): m.commit(host, before['reviewHash'], auth)
            self.assertEqual(state['calls'], 1); result = m.acknowledge(host, True)
            self.assertEqual(result['commitOutcome'], 'postgraph_reconciled_after_unknown_ACK'); self.assertEqual(state['calls'], 1)
            with self.assertRaisesRegex(RuntimeError, 'no_repeat'): m.commit(host, before['reviewHash'], auth)

    def test_wrong_SQL_authorization_or_runtime_refuses_before_intent(self):
        host, state, before = self.lifecycle('normal')
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'BASE', Path(tmp)), patch.object(m, 'own_sha', return_value='e'*64), patch.object(m, 'boot', return_value='boot'), patch.object(m, 'protected', side_effect=lambda p, expected=None: Path(p).read_bytes()):
            self.prepare(host, before, Path(tmp))
            with self.assertRaisesRegex(RuntimeError, 'authorization'): m.commit(host, before['reviewHash'], 'wrong')
            host.stable = lambda: {'runtime': 'different'}
            with self.assertRaisesRegex(RuntimeError, 'runtime'): m.commit(host, before['reviewHash'], m.sha(m.encoded(host.helpers.statements(host.plan))))
            self.assertEqual(state['calls'], 0); self.assertFalse((Path(tmp)/'commit-intent.json').exists())

    def test_source_terminal_inverse_is_explicit_and_rejects_foreign_epoch(self):
        before = {'stable': {'runtime': {'source': {'pid': 12, 'epoch': 'restored'}}, 'consumers': {'private': 'same'}}}
        proof = {'validated': True, 'recordedSource': {'pid': 12, 'epoch': 'restored'}, 'sourceTerminalQualified': True,
                 'originalWholeValidatorPassed': False, 'frameworkReadinessQualified': False}
        host = types.SimpleNamespace(inverse_mode=True, consumers=lambda: {'private': 'same'},
                 static=types.SimpleNamespace(inverse_source=lambda: proof))
        self.assertTrue(m.inverse_stable(host, before)['sourceTerminalQualified'])
        proof['recordedSource']['epoch'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'restored_source'): m.inverse_stable(host, before)

    def test_baseline_column_SELECT_overlap_refused_but_unrelated_columns_preserved(self):
        p,before,_=fixture(); edge=next(v for v in p['missingPermissions']if v['kind']=='relation')
        overlap={'relation':edge['object'],'edges':[{'grantee':edge['grantee'],'privilege':'SELECT','grantor':'other','grantable':True}]}
        before['allColumnAcl']=[overlap]
        with self.assertRaisesRegex(RuntimeError,'noninvertible'):m.validate_column_overlap(p,before)
        overlap['edges'][0]['grantee']='unrelated-role'
        self.assertTrue(m.validate_column_overlap(p,before))
        overlap['edges'][0]['grantee']=edge['grantee'];overlap['relation']='unrelated-relation'
        self.assertTrue(m.validate_column_overlap(p,before))

    def test_initial_pack_guard_uses_exact_restore_preservation_and_double_capture(self):
        peers={'source':'accepted2309','api':'accepted2334'}; calls=[]
        owner=types.SimpleNamespace(preserved=lambda:calls.append('actualGETandActor')or copy.deepcopy(peers))
        primitive=types.SimpleNamespace(pack_packets=lambda:{'definitions':'exact'},pack_boots=lambda:{'inodes':'exact'})
        host=m.Host.__new__(m.Host);host.primitives={'restoreModule':types.SimpleNamespace(Owner=lambda *args:owner),
            'recoveryModule':None,'sdk':None,'host':primitive,'ancestorOperation':{}}
        proof=host.pack_initial();self.assertEqual(proof['actors'],peers);self.assertEqual(len(calls),2)
        before={'stable':{'runtime':'runtime','consumers':'same','temporaryPackInitial':proof}}
        host.consumers=lambda:'same';host.runtime=lambda:'runtime'
        self.assertEqual(m.inverse_stable(host,before),'runtime')
        primitive.pack_boots=lambda:{'inodes':'foreign'}
        with self.assertRaisesRegex(RuntimeError,'separate_feature_recovery'):m.inverse_stable(host,before)

    def test_graph_only_validator_never_recaptures_active_source(self):
        _, _, after = fixture(); host=types.SimpleNamespace(catalog=lambda: copy.deepcopy(after))
        parts={'host':host,'rehearsal':{'after':after},'reference':{'receiptSha256':'actual'}}
        with patch.object(m,'admitted_components',return_value=parts):
            value=m.validate_catalog_current('actual')
            self.assertTrue(value['catalogOnly']);self.assertFalse(value['sourceActorQualified'])
            self.assertFalse(value['sourceReadinessQualified'])
            host.catalog=lambda:{**after,'allColumnAcl':[{'foreign':'column'}]}
            with self.assertRaisesRegex(RuntimeError,'all_grantee_columns'):m.validate_catalog_current('actual')

    def test_owned_inverse_and_lost_inverse_ACK_reconcile(self):
        host, state, before = self.lifecycle('normal')
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'BASE', Path(tmp)), patch.object(m, 'own_sha', return_value='e'*64), patch.object(m, 'boot', return_value='boot'), patch.object(m, 'protected', side_effect=lambda p, expected=None: Path(p).read_bytes()):
            base=Path(tmp); self.prepare(host, before, base)
            m.commit(host, before['reviewHash'], m.sha(m.encoded(host.helpers.statements(host.plan))))
            admission = m.sha((base/'result.json').read_bytes()); checked=m.inverse_review(host, admission)
            result=m.inverse(host, admission, checked['inverseReviewHash'])
            self.assertTrue(result['catalogRestored']); self.assertEqual(state['catalog'], before['catalogBefore'])
            (base/'inverse-result.json').unlink(); calls=state['calls']; intent=m.document(base/'inverse-intent.json')
            result=m.inverse_ack(host, intent, True); self.assertTrue(result['reconciledAfterUnknownAck']); self.assertEqual(state['calls'], calls)
            intent['admissionSha256']='forged'
            # A genuine protected pin is checked by document(), independently of this test's local read shim.
            intent['inverseReviewHash']='wrong'
            with self.assertRaises(RuntimeError): m.inverse_ack(host, intent, True)

if __name__ == '__main__': unittest.main()
