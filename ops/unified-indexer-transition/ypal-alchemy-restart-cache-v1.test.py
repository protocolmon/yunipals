#!/usr/bin/env python3
"""Actual fragment-prefix controls; no production connection or mutation."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('restart_cache', HERE / 'ypal-alchemy-restart-cache-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def fixture():
    rows = m.filters()
    safes = {c: max(r['fromBlock'] for r in rows if r['chainId'] == c) + 1000 for c in m.MINIMUMS}
    def cp(c, n):
        return str(1700000000).zfill(10) + str(c).zfill(16) + str(n).zfill(16) + '9' * 33
    native = {'schemaOid': '75963410', 'app': {'build_id': m.BUILD, 'is_locked': 0, 'heartbeat_at': 100000},
        'clock': 125001, 'tables': {str(n): {'oid': str(n), 'owner': 'source', 'kind': 'r'} for n in range(44)},
        'cache': {'schemaOid': 'fixture-cache', 'relations': [{'name': 'intervals', 'oid': 'fixture-interval', 'kind': 'r', 'owner': 'source'}]},
        'checkpoints': {str(c): {'safe': cp(c, n), 'latest': cp(c, n + 2), 'finalized': cp(c, n)} for c, n in safes.items()}}
    capture = {**copy.deepcopy(native), 'identity': {'databaseOid': '17584', 'port': '5432', 'readOnly': True, 'socket': True},
        'matrix': {r['key']: [[str(r['fromBlock']), str(safes[r['chainId']] + 51), True, True]] for r in rows}}
    plan = {'format': 'yunipals-ypal-alchemy-catchup-financial-v1-plan', 'profileId': m.PROFILE,
        'permits': [{'chainId': c, 'profileId': m.PROFILE, 'enabled': True, 'fromBlock': str(start),
                    'throughBlock': str(safes[c] + 10000)} for c, start in m.MINIMUMS.items()]}
    return native, capture, plan


class Controls(unittest.TestCase):
    def test_actual_frozen_source_query_selects_source5432_not_market15438(self):
        # Execute the real source-query producer against a capturing primitive;
        # no psql process or connection is started. This pins the port oracle to
        # retained production source rather than duplicating a consumer literal.
        path = HERE / 'ypal-combined-rpc-admission-v3.py'
        self.assertEqual(m.sha(path.read_bytes()), '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862')
        spec = importlib.util.spec_from_file_location('actual_source_query', path)
        source = importlib.util.module_from_spec(spec); spec.loader.exec_module(source)
        n, c, p = fixture(); calls = []
        def capture(args, text, timeout):
            calls.append((args, text, timeout))
            self.assertIn(b'BEGIN READ ONLY', text)
            self.assertEqual(args[args.index('-d') + 1], 'yunipals_backfill')
            self.assertEqual(args[args.index('-h') + 1], '/var/run/postgresql')
            c['identity']['port'] = args[args.index('-p') + 1]
            return json.dumps(c)
        peer = types.SimpleNamespace(peer=lambda: [], run=capture)
        observed = source.source_query(peer, m.capture_sql())
        self.assertTrue(m.validate_capture(observed, p, n)['cacheCoverageQualified'])
        self.assertEqual(len(calls), 1)
        observed['identity']['port'] = '15438'
        with self.assertRaisesRegex(RuntimeError, 'source_database_readonly'):
            m.validate_capture(observed, p, n)

    def test_actual_eighty_log_four_latest_artifact(self):
        rows = m.filters()
        self.assertEqual(len(rows), 80); self.assertEqual(len({r['sourceId'] for r in rows}), 12)
        self.assertEqual({c: sum(r['chainId'] == c for r in rows) for c in m.MINIMUMS}, {1: 5, 8453: 65, 137: 3, 56: 7})

    def test_prefix_and_separate_dynamic_latest_scope(self):
        n, c, p = fixture(); v = m.validate_capture(c, p, n)
        self.assertTrue(v['cacheCoverageQualified']); self.assertFalse(v['currentWriterQualified'])
        self.assertFalse(v['canonicalReadinessQualified']); self.assertEqual(v['dynamicLatestBlockFilters'], 4)
        self.assertTrue(all(r['logCachedThrough'] >= r['safeResumeBlock'] for r in v['chains'].values()))

    def test_hole_not_hidden_by_maximum_endpoint_or_fetch_gauge(self):
        n, c, p = fixture(); r = m.filters()[0]; start = r['fromBlock']; end = int(c['matrix'][r['key']][0][1])
        c['matrix'][r['key']] = [[str(start), str(start + 5), True, True], [str(start + 7), str(end + 100000), True, True]]
        c['irrelevantFetchGauge'] = end + 100000
        with self.assertRaisesRegex(RuntimeError, 'older_cache_hole'): m.validate_capture(c, p, n)

    def test_missing_fragment_refuses(self):
        n, c, p = fixture(); c['matrix'].pop(m.filters()[0]['key'])
        with self.assertRaisesRegex(RuntimeError, 'eighty_official'): m.validate_capture(c, p, n)

    def test_tail_only_permit_cannot_cover_real_start_header(self):
        n, c, p = fixture(); p['permits'][0]['fromBlock'] = str(int(p['permits'][0]['fromBlock']) + 1000)
        with self.assertRaisesRegex(RuntimeError, 'diagnostic_header'): m.validate_capture(c, p, n)

    def test_full_native44_cache_app_and_cursor_CAS(self):
        for key in ('schemaOid', 'tables', 'cache', 'app', 'checkpoints'):
            with self.subTest(key=key):
                n, c, p = fixture(); n[key] = {'changed': True} if isinstance(n[key], dict) else 'changed'
                with self.assertRaises((RuntimeError, KeyError)): m.validate_capture(c, p, n)

    def test_official25s_expired_lock_crash_recovery(self):
        n, c, p = fixture()
        for v in (n, c): v['app']['is_locked'] = 1
        self.assertTrue(m.validate_capture(c, p, n)['validated'])
        c['clock'] = c['app']['heartbeat_at'] + 24999
        with self.assertRaisesRegex(RuntimeError, '25s_expired'): m.validate_capture(c, p, n)

    def test_partial_safe_requires_exact_raw_block_for_extract(self):
        n, c, p = fixture(); r = m.filters()[0]; chain = str(r['chainId'])
        safe = m.block(n['checkpoints'][chain]['safe'], r['chainId'])
        point = n['checkpoints'][chain]['safe'][:42] + '0' * 33
        n['checkpoints'][chain]['safe'] = c['checkpoints'][chain]['safe'] = point
        c['matrix'][r['key']] = [[str(r['fromBlock']), str(safe), True, True]]
        with self.assertRaisesRegex(RuntimeError, 'older_cache_hole'): m.validate_capture(c, p, n)

    def test_cached_header_outside_permit_not_clamped(self):
        n, c, p = fixture()
        for r in m.filters(): c['matrix'][r['key']][0][1] = str(int(next(x for x in p['permits'] if x['chainId'] == r['chainId'])['throughBlock']) + 100)
        with self.assertRaisesRegex(RuntimeError, 'cached_diagnostic'): m.validate_capture(c, p, n)

    def test_closed_upper_minus_one_actual_Ponder_contract(self):
        self.assertEqual(m.prefix(100, [['100', '111', True, True]]), 110)
        self.assertEqual(m.prefix(100, [['100', '106', True, True], ['108', '120', True, True]]), 105)
        with self.assertRaisesRegex(RuntimeError, 'closed_Ponder'): m.prefix(100, [['100', '111', True, False]])

    def test_actual_installed_bytes_and_readonly_query_wrapper(self):
        n, c, p = fixture(); original = m.RUNTIME; m.RUNTIME = HERE.parents[1] / 'apps/yunipals-indexer/node_modules/ponder'
        queries = []
        try:
            v = m.validate_restart_capture(lambda sql: (queries.append(sql), c)[1], p, n)
            self.assertEqual(v['installedPonder']['publicFiles'], 14)
        finally: m.RUNTIME = original
        self.assertEqual(len(queries), 1); self.assertIn('range_agg(part)', queries[0]); self.assertIn('ANY(w.ids)', queries[0])
        self.assertNotIn('UPDATE ', queries[0]); self.assertNotIn('INSERT ', queries[0])


if __name__ == '__main__': unittest.main()
