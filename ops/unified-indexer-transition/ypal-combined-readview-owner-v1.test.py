import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
FILE = HERE / 'ypal-combined-readview-owner-v1.py'
spec = importlib.util.spec_from_file_location('view_owner', FILE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
p = json.loads((HERE / 'ypal-combined-readview-v1.preparation.json').read_bytes())
profile = json.loads((HERE / 'ypal-combined-rpc-profile-v1.json').read_bytes())
encoded = lambda value: (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def target():
    return {'schemaOid': 'new', 'owner': 'postgres', 'nonownerPermissions': 0,
            'marker': {'singleton': True, 'identity': p['readIdentity'], 'release_id': p['sourceRelease'],
                       'manifest_hash': p['manifestHash'], 'definitions': p['definitions']},
            'relations': [{'oid': str(i), 'name': name, 'kind': kind, 'owner': 'postgres', 'definition': name, 'acl': None}
                          for i, (name, kind) in enumerate(m.RELATIONS.items())],
            'functions': [{'oid': str(i + 20), 'name': name, 'owner': 'postgres', 'definer': False,
                           'configuration': ['search_path=pg_catalog'], 'definition': name, 'acl': 'owner-only'}
                          for i, name in enumerate(m.FUNCTIONS)]}


class Tests(unittest.TestCase):
    def test_exact_plan_and_registered_receipt_fixtures(self):
        self.assertEqual(sha((HERE / 'ypal-combined-readview-v1.preparation.json').read_bytes()), m.PLAN_SHA)
        self.assertEqual(sha((HERE / 'ypal-combined-release-register-v1.py').read_bytes()), m.REGISTER_SHA)
        raw = (HERE / 'fixtures/combined-release-registered-v1.json').read_bytes()
        self.assertEqual(sha(raw), m.REGISTER_ACK_SHA); self.assertTrue(json.loads(raw)['registered'])
        self.assertEqual(len(p['expectedOwnerStatements']), 19)

    def test_all_official_ddl_is_preserved_and_no_grants_or_native_writes_added(self):
        before = {'targetAbsent': True}
        sql = m.owner_sql(p, before)
        self.assertTrue(sql.endswith('ROLLBACK;\n'))
        for row in p['expectedOwnerStatements']:
            if not row['params']: self.assertIn(row['sql'] + ';', sql)
        self.assertNotRegex(sql, r'\b(?:GRANT|UPDATE|DELETE|ALTER|TRUNCATE|DROP)\s')
        with self.assertRaisesRegex(RuntimeError, 'reviewed_nineteen_write_rehearsal_required'):
            m.owner_sql(p, before, True)

    def test_commit_compares_rehearsed_semantics_before_commit_and_preserves_array_order(self):
        sql = m.owner_sql(p, {'targetAbsent': True}, True, m.semantics(target()))
        self.assertTrue(sql.endswith('COMMIT;\n'))
        self.assertIn('WITH ORDINALITY', sql); self.assertIn('ORDER BY ordinal', sql)
        self.assertLess(sql.index('rehearsed_read_objects_changed'), sql.index('COMMIT;'))
        self.assertIn("SET LOCAL search_path=pg_catalog", sql)

    def test_semantic_comparison_omits_only_fresh_oids(self):
        a = target(); b = copy.deepcopy(a); b['schemaOid'] = 'other'
        for row in b['relations'] + b['functions']: row['oid'] += '1'
        self.assertEqual(m.semantics(a), m.semantics(b))
        b['relations'][0]['definition'] = 'changed'; self.assertNotEqual(m.semantics(a), m.semantics(b))

    def test_permissions_definers_markers_and_extra_objects_refused(self):
        m.validate_target(p, target())
        for change in [lambda t: t.update(nonownerPermissions=1), lambda t: t['functions'][0].update(definer=True),
                       lambda t: t['marker'].update(release_id='other'), lambda t: t['relations'].append(t['relations'][0])]:
            t = target(); change(t)
            with self.assertRaises(RuntimeError): m.validate_target(p, t)

    def test_marker_parameters_cannot_mutate_another_table(self):
        bad = copy.deepcopy(p); row = next(row for row in bad['expectedOwnerStatements'] if row['params'])
        row['sql'] = 'INSERT INTO "' + m.READ_SCHEMA + '".other VALUES($1,$2,$3,$4)'
        with self.assertRaisesRegex(RuntimeError, 'exact_marker_parameters_required'): m.owner_sql(bad, {})

    def lifecycle(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        base = Path(directory.name); self.enterContext(patch.object(m, 'BASE', base))
        def save(path, value):
            with path.open('xb') as file: file.write(encoded(value))
        def document(path, pin=None):
            raw = path.read_bytes()
            if pin is not None: self.assertEqual(sha(raw), pin)
            return json.loads(raw)
        s = types.SimpleNamespace(save=save, document=document, protected=lambda path: Path(path).read_bytes(), boot=lambda: 'boot')
        r = types.SimpleNamespace(sha=sha, encoded=encoded, SOURCE_ACK_SHA='actual_source')
        t = target(); before = {'binding': {'source': 'actual'}, 'before': {'targetAbsent': True}, 'reviewHash': 'review'}
        rehearsal = {'rehearsed': True, 'catalogUnchanged': True, 'reviewHash': 'review', 'targetSemantics': m.semantics(t)}
        save(base / 'rehearsed.json', rehearsal)
        self.enterContext(patch.object(m, 'saved_review', return_value=before))
        self.enterContext(patch.object(m, 'source_binding', return_value=before['binding']))
        return base, r, s, t, before, rehearsal

    def test_lost_ack_preserves_one_attempt_intent(self):
        base, r, s, t, before, rehearsal = self.lifecycle()
        def sql(h, text, readonly=True):
            if not readonly:
                self.assertTrue((base / 'commit-intent.json').exists()); raise RuntimeError('ack_lost')
            return [before['before']]
        with patch.object(m, 'query', side_effect=sql):
            with self.assertRaisesRegex(RuntimeError, 'ack_lost'): m.commit(r, s, None, None, None, p, 'review')
            with self.assertRaisesRegex(RuntimeError, 'one_readview_creation_attempt_only'): m.commit(r, s, None, None, None, p, 'review')
        self.assertTrue(s.document(base / 'failed.json')['commitOutcomeMayBeUnknown'])

    def test_intent_only_sigkill_reconciliation_never_executes_ddl(self):
        base, r, s, t, before, rehearsal = self.lifecycle()
        intent = {'reviewHash': 'review', 'bootId': 'boot', 'planSha256': m.PLAN_SHA,
                  'rehearsalSha256': sha((base / 'rehearsed.json').read_bytes())}
        s.save(base / 'commit-intent.json', intent); calls = []
        def sql(h, text, readonly=True):
            calls.append(readonly)
            if 'previousRelations' in text: return [{'targetAbsent': False}]
            if 'nonownerPermissions' in text: return [t]
            return [{'collections': [], 'baseMetadataReady': False}]
        with patch.object(m, 'query', side_effect=sql):
            value = m.reconcile(r, s, None, None, None, p, sha((base / 'commit-intent.json').read_bytes()))
        self.assertEqual(calls, [True, True, True]); self.assertTrue(value['reconciledAfterUnknownAck'])
        self.assertFalse(value['selected']); self.assertFalse(value['grantsChanged'])


if __name__ == '__main__': unittest.main()
