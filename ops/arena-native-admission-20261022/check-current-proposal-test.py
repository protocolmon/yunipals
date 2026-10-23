#!/usr/bin/env python3
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('current_admission', HERE / 'check-current-proposal.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class Admission(unittest.TestCase):
    def setUp(self):
        self.proposal = json.loads((HERE / 'proposal.current.json').read_bytes())
        self.operational = (HERE / 'operational-roles.current.sql.review').read_text()
        self.source = (HERE / 'source-reader.current.sql.review').read_text()

    def test_actual_current_graph(self):
        value = m.validate(self.proposal, self.operational, self.source)
        self.assertEqual(value['operationalGrantEdges'], 227)
        self.assertFalse(value['applied'])

    def test_added_authority_or_missing_modern_edge_refused(self):
        for sql in [self.operational + '\nGRANT SELECT ON TABLE yunipals_arena.identity_job TO "yunipals_arena_native_capacity";', self.operational.replace('GRANT SELECT, INSERT ON TABLE yunipals_arena.identity_job', 'GRANT SELECT ON TABLE yunipals_arena.identity_job'), self.operational + '\nGRANT EXECUTE ON FUNCTION yunipals_arena.guard() TO "yunipals_arena_native_api";']:
            with self.subTest(sql=sql[-100:]), self.assertRaises(ValueError):
                m.validate(self.proposal, sql, self.source)

    def test_login_and_source_write_refused(self):
        with self.assertRaises(ValueError):
            m.validate(self.proposal, self.operational.replace('NOLOGIN PASSWORD NULL', 'LOGIN PASSWORD NULL', 1), self.source)
        with self.assertRaises(ValueError):
            m.validate(self.proposal, self.operational, self.source + '\nGRANT UPDATE ON public.data TO arena_native_reader;')

    def test_same_count_wrong_source_relation_refused(self):
        changed = self.source.replace('.arena_credit TO', '.different_table TO')
        self.assertNotEqual(changed, self.source)
        with self.assertRaises(ValueError):
            m.validate(self.proposal, self.operational, changed)

    def test_stale_markers_or_known_role_cannot_be_treated_as_fresh(self):
        for modify in [lambda p:p['workers'][0].update(exists=True, observedRoleOid=123), lambda p:p['current']['committedMarkers'][0].update(checksumMatches=False)]:
            p = copy.deepcopy(self.proposal)
            modify(p)
            with self.assertRaises(ValueError):
                m.validate(p, self.operational, self.source)

    def test_migration_replay_or_extra_legacy_round_refused(self):
        for key in ['extraLegacyUpgradeRequired', 'reuseMigrationOperator']:
            p = copy.deepcopy(self.proposal)
            p['directCutover'][key] = True
            with self.assertRaises(ValueError):
                m.validate(p, self.operational, self.source)

    def test_current_delta_keeps_owner_grantor_and_observed_public_baseline(self):
        marker = '-- Exact current-runtime seven-statement delta'
        self.assertLess(self.operational.index(marker), self.operational.index('RESET ROLE;'))
        self.assertEqual(len(self.proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']), 2)
        self.assertEqual(self.proposal['sourceReader']['existingAmbientAuthority']['publicDatabase'], ['CONNECT', 'TEMPORARY'])


if __name__ == '__main__':
    unittest.main()
