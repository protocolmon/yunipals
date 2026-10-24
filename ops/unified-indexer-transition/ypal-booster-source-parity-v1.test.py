"""Synthetic guard/receipt/process tests. No production, provider or DB access."""
import ast
import copy
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

m = load('ypal-booster-source-parity-v1')
NOW = 1800000000
HASH = '0x' + 'ab' * 32
PARENT = '0x' + 'cd' * 32

def point(block, full=True):
    return f'{NOW - 7200:010d}{8453:016d}{block:016d}' + ('9' if full else '0') * 33

def frame():
    return {'now': NOW, 'database': '17584', 'databaseName': 'yunipals_backfill', 'role': 'postgres',
        'sessionRole': 'postgres', 'unix': True, 'port': '5432', 'snapshot': '1:1:',
        'readOnly': 'on', 'isolation': 'repeatable read',
        'release': {'id': m.RELEASE, 'schema': m.RIGHT, 'build': m.SCHEMAS[m.RIGHT]['build'], 'manifestHash': m.MANIFEST},
        'marker': {'schemaOid': m.READ_OID, 'releaseId': m.RELEASE, 'identity': m.READ_ID, 'manifestHash': m.MANIFEST},
        'definitions': [{'id': s['id'], 'chainId': 8453, 'manifestHash': m.MANIFEST, 'definition': s} for s in m.SOURCE_DEFINITIONS],
        'sources': [{'schema': schema, 'schemaOid': m.SCHEMAS[schema]['oid'],
            'app': {'version': '6', 'build_id': m.SCHEMAS[schema]['build'], 'is_dev': 0,
                'is_locked': 1, 'is_ready': int(schema == m.LEFT), 'heartbeat_at': NOW * 1000},
            'checkpoint': point(m.FLOOR + 10), 'lastEvent': m.FLOOR, 'eventCount': 1, 'tail': 0,
            'counts': {t: 1 for t in m.TABLES},
            'relations': [{'name': t, 'oid': str(i + 100), 'relkind': 'r', 'columns': m.columns(t)} for i, t in enumerate(m.TABLES)]}
            for schema in (m.LEFT, m.RIGHT)],
        'nativeBoundaryHeaders': [{'number': m.FLOOR, 'hash': HASH, 'parentHash': PARENT, 'timestamp': NOW - 7200}]}

def header():
    boundary = {'number': m.FLOOR, 'hash': HASH, 'parentHash': PARENT, 'timestamp': NOW - 7200}
    return {'format': 'yunipals-base-canonical-header-v1', 'chainId': 8453, **boundary,
        'observedAt': datetime.datetime.fromtimestamp(NOW, datetime.timezone.utc).isoformat(),
        'latest': {'number': m.FLOOR + 1000, 'hash': '0x' + 'ef' * 32, 'parentHash': '0x' + 'fe' * 32, 'timestamp': NOW - 1},
        'finalized': {'number': m.FLOOR + 100, 'hash': '0x' + 'aa' * 32, 'parentHash': '0x' + 'bb' * 32, 'timestamp': NOW - 1200},
        'repeatedBoundary': boundary}

def tables():
    return [{'table': t, 'leftCount': 1, 'rightCount': 1, 'leftSha256': 'ab' * 32,
        'rightSha256': 'ab' * 32, 'differences': 0} for t in sorted(m.TABLES)]

def actors():
    return {unit: {'ActiveState': 'active', 'SubState': 'running', 'MainPID': str(i + 42),
        'InvocationID': ('a' if i else 'b') * 32, 'ExecMainStartTimestampMonotonic': '1234', 'startTicks': 123}
        for i, unit in enumerate(m.SOURCE_UNITS)}

def receipt():
    f, t, h, unexpected = frame(), tables(), header(), {'left': 0, 'right': 0}
    return {'format': m.FORMAT, 'completed': True, 'producerSha256': m.sha(Path(m.__file__).read_bytes()),
        'inputSha256': m.INPUT_HASHES, 'sqlSha256': m.sha(m.snapshot_sql(m.FLOOR).encode()),
        'boundary': m.FLOOR, 'frame': f, 'tables': t, 'unexpected': unexpected, 'canonicalHeader': h,
        'actorsBefore': actors(), 'actorsAfter': actors(), 'qualification': m.assess(f, t, unexpected, h, m.FLOOR),
        'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0,
        'captureId': 'synthetic', 'reportFile': str(m.capture_path('synthetic'))}

class Tests(unittest.TestCase):
    def test_original_producer_unchanged_and_semantic_functions_identical(self):
        oldpath = HERE / 'booster-source-parity.py'
        self.assertEqual(m.sha(oldpath.read_bytes()), '9f01e4c41dc0b7c9411022b266a62d2ff4d9c08c8041976d54f4786656df451f')
        old = ast.parse(oldpath.read_text()); new = ast.parse(Path(m.__file__).read_text())
        for name in ['complete_block', 'row_expression', 'identifier']:
            a = next(n for n in old.body if isinstance(n, ast.FunctionDef) and n.name == name)
            b = next(n for n in new.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(ast.dump(a), ast.dump(b))
    def test_one_RR_exact_all_fields_both_except_directions_and_caps(self):
        sql = m.snapshot_sql(m.FLOOR)
        self.assertEqual(sql.count('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'), 1)
        self.assertEqual(sql.count('ROLLBACK;'), 1)
        self.assertEqual(m.comparisons_sql().count('EXCEPT ALL'), 16)
        for t in m.TABLES:
            self.assertIn('"' + m.LEFT + '".' + t, m.comparisons_sql())
            self.assertIn('"' + m.RIGHT + '".' + t, m.comparisons_sql())
        for cap in ["statement_timeout='45s'", "lock_timeout='1s'", "work_mem='8MB'", "temp_file_limit='512MB'", 'max_parallel_workers_per_gather=0']:
            self.assertIn(cap, sql)
        self.assertLess(sql.index('DO $ypal_parity_guard$'), sql.index('EXCEPT ALL'))
        self.assertIn('args\'\x29||jsonb_build_object', m.row_expression('t', 'booster_event'))
    def test_fixed_prefix_can_pass_while_combined_framework_false_and_Base_checkpoint_old(self):
        value = receipt(); self.assertTrue(value['qualification']['canonicalQualifiedAtCapture'])
        self.assertTrue(m.validate_receipt(value)['exactDataParity'])
        self.assertFalse(m.validate_receipt(value)['currentReadinessQualified'])
        self.assertEqual(value['frame']['sources'][1]['app']['is_ready'], 0)
        self.assertLess(int(value['frame']['sources'][1]['checkpoint'][:10]), NOW - 180)
    def test_partial_checkpoint_never_counts_as_completed_boundary(self):
        f = frame(); f['sources'][1]['checkpoint'] = point(m.FLOOR, False)
        self.assertIn(m.RIGHT + ':incomplete_boundary', m.source_checks(f, m.FLOOR))
        self.assertEqual(m.complete_block(point(m.FLOOR, False)), m.FLOOR - 1)
    def test_both_sides_future_tail_and_missing_known_mint_refuse(self):
        for side in [0, 1]:
            for change in [{'tail': 1}, {'lastEvent': m.FLOOR + 1}, {'lastEvent': None}]:
                f = frame(); f['sources'][side].update(change)
                self.assertFalse(m.assess(f, tables(), {'left': 0, 'right': 0}, header(), m.FLOOR)['exactDataParity'])
    def test_every_native_context_and_relation_drift_refuses(self):
        edits = [lambda f: f.update(database='1'), lambda f: f.update(role='unified_test'),
            lambda f: f.update(unix=False), lambda f: f['marker'].update(identity='0x' + '00' * 32),
            lambda f: f['release'].update(build='bf4939b3ff'), lambda f: f['definitions'].pop(),
            lambda f: f['sources'][0].update(schemaOid='1'), lambda f: f['sources'][1]['app'].update(build_id='wrong'),
            lambda f: f['sources'][1]['app'].update(heartbeat_at=(NOW - 181) * 1000),
            lambda f: f['sources'][0]['relations'][0]['columns'].append({'name': 'extra'}),
            lambda f: f['sources'][1]['relations'][1].update(relkind='v'),
            lambda f: f['sources'][1]['counts'].update(booster_event=m.MAX_ROWS + 1)]
        for edit in edits:
            f = copy.deepcopy(frame()); edit(f)
            self.assertTrue(m.source_checks(f, m.FLOOR))
    def test_all_counts_digests_except_and_unexpected_contracts_are_independent(self):
        for edit in [lambda t: t.pop(), lambda t: t[0].update(leftCount=2),
            lambda t: t[0].update(differences=1), lambda t: t[0].update(rightSha256='cd' * 32),
            lambda t: t[0].update(leftCount=0, rightCount=0)]:
            t = tables(); edit(t)
            self.assertFalse(m.assess(frame(), t, {'left': 0, 'right': 0}, header(), m.FLOOR)['exactDataParity'])
        self.assertFalse(m.assess(frame(), tables(), {'left': 1, 'right': 0}, header(), m.FLOOR)['exactDataParity'])
    def test_fresh_observation_latest_finalized_repeat_and_native_boundary_required(self):
        edits = [lambda h: h.update(chainId=1), lambda h: h.update(hash='0x' + '00' * 32),
            lambda h: h.update(observedAt=datetime.datetime.fromtimestamp(NOW - 181, datetime.timezone.utc).isoformat()),
            lambda h: h['latest'].update(timestamp=NOW - 181), lambda h: h['finalized'].update(number=m.FLOOR - 1),
            lambda h: h['repeatedBoundary'].update(hash='0x' + 'aa' * 32)]
        for edit in edits:
            h = copy.deepcopy(header()); edit(h)
            self.assertFalse(m.assess(frame(), tables(), {'left': 0, 'right': 0}, h, m.FLOOR)['canonicalQualifiedAtCapture'])
        f = frame(); f['nativeBoundaryHeaders'][0]['hash'] = '0x' + 'dd' * 32
        out = m.assess(f, tables(), {'left': 0, 'right': 0}, header(), m.FLOOR)
        self.assertTrue(out['exactDataParity']); self.assertFalse(out['canonicalQualifiedAtCapture'])
    def test_pure_receipt_recomputes_producer_sql_context_and_actor_fences(self):
        for edit in [lambda v: v.update(producerSha256='0' * 64), lambda v: v.update(sqlSha256='0' * 64),
            lambda v: v['actorsAfter'][m.SOURCE_UNITS[0]].update(MainPID='100'),
            lambda v: v['tables'][0].update(differences=1), lambda v: v['qualification'].update(currentReadinessQualified=True),
            lambda v: v.update(databaseWrites=1)]:
            value = receipt(); edit(value)
            with self.assertRaises(RuntimeError): m.validate_receipt(value)
    def test_current_prefix_rechecks_payloads_and_never_refreshes_external_observation(self):
        value = receipt(); raw = m.encoded(value)
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m.socket, 'gethostname', return_value='yunipals-main'), \
             patch.object(m, 'protected', return_value=raw), patch.object(m, 'actors', return_value=actors()), \
             patch.object(m, 'query', return_value=[frame(), tables(), {'left': 0, 'right': 0}]) as query, patch.object(m.time, 'time', return_value=NOW):
            result = m.validate_current_prefix(m.sha(raw), header(), 'synthetic')
            self.assertTrue(result['currentPrefixUnchanged']); self.assertEqual(result['canonicalObservedAtUnix'], NOW)
            self.assertFalse(result['currentCanonicalProviderQualified']); self.assertFalse(result['currentReadinessQualified'])
            self.assertEqual(query.call_args.args, (m.snapshot_sql(m.FLOOR),))
        changed = tables(); changed[0].update(differences=1)
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m.socket, 'gethostname', return_value='yunipals-main'), \
             patch.object(m, 'protected', return_value=raw), patch.object(m, 'actors', return_value=actors()), \
             patch.object(m, 'query', return_value=[frame(), changed, {'left': 0, 'right': 0}]), patch.object(m.time, 'time', return_value=NOW):
            with self.assertRaisesRegex(RuntimeError, 'current_full_ypal_prefix'): m.validate_current_prefix(m.sha(raw), header(), 'synthetic')
    def test_peer_command_uses_empty_env_fixed_app_and_no_password_or_provider(self):
        with patch.object(m.os.path, 'lexists', return_value=False), patch.object(m, 'command', return_value='{}\n') as command:
            self.assertEqual(m.query('synthetic SQL'), [{}])
            args, sql, timeout = command.call_args.args
            self.assertIn('-i', args); self.assertIn('PGAPPNAME=' + m.APPLICATION_NAME, args)
            self.assertIn('PGPASSFILE=' + m.PASSWORD_SENTINEL, args); self.assertIn('-w', args)
            self.assertEqual(sql, 'synthetic SQL'); self.assertEqual(timeout, 150)
        process = types.SimpleNamespace(returncode=1, communicate=lambda *a, **k: ('private', 'ERROR: 57014 private payload'))
        with patch.object(m.subprocess, 'Popen', return_value=process) as popen:
            with self.assertRaisesRegex(RuntimeError, '^bounded_parity_command_failed_sqlstate_57014$'): m.command(['synthetic'])
            self.assertEqual(popen.call_args.kwargs['env'], m.CLEAN); self.assertEqual(popen.call_args.kwargs['cwd'], '/')
            self.assertTrue(popen.call_args.kwargs['start_new_session'])
    def test_named_capture_paths_refuse_arbitrary_or_reused_operations(self):
        for name in ['', '../foreign', '/tmp/foreign', 'a/b', 'Upper', 'a' * 49, 'a_b']:
            with self.assertRaisesRegex(RuntimeError, 'bounded_explicit_capture_id'): m.capture_path(name)
        for name in ['initial', 'post-switch-event-53000662']:
            self.assertEqual(m.capture_path(name), m.BASE / 'captures' / name / 'result.json')
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'BASE', Path(directory)):
            (m.BASE / 'captures').mkdir(mode=0o700)
            def run(name):
                plan = {'captureId': name, 'boundary': m.FLOOR}
                current = {'reviewHash': 'a' * 64, 'header': header(), 'binding': {'plan': plan,
                    'producerSha256': m.sha(Path(m.__file__).read_bytes()), 'sqlSha256': m.sha(m.snapshot_sql(m.FLOOR).encode())}}
                with patch.object(m, 'review', return_value=current), patch.object(m, 'actors', return_value=actors()), \
                     patch.object(m, 'query', return_value=[frame(), tables(), {'left': 0, 'right': 0}]) as query, \
                     patch.object(sys, 'argv', ['parity', '--plan', '/synthetic', '--capture', 'a' * 64]), \
                     patch('sys.stdout', new_callable=io.StringIO):
                    m.main()
                self.assertEqual(query.call_count, 1)
            run('initial'); old = m.capture_path('initial').read_bytes()
            self.assertEqual(stat.S_IMODE(m.capture_path('initial').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(m.capture_path('initial').parent.stat().st_mode), 0o700)
            with self.assertRaises(FileExistsError): run('initial')
            run('post-event'); self.assertEqual(m.capture_path('initial').read_bytes(), old)
            self.assertEqual(m.validate_receipt(json.loads(old))['validated'], True)
    def test_separate_fresh_header_does_not_renew_or_mutate_immutable_capture(self):
        value = receipt(); raw = m.encoded(value); fresh = header()
        fresh['observedAt'] = datetime.datetime.fromtimestamp(NOW + 60, datetime.timezone.utc).isoformat()
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m.socket, 'gethostname', return_value='yunipals-main'), \
             patch.object(m, 'protected', return_value=raw), patch.object(m, 'actors', return_value=actors()), \
             patch.object(m, 'query', return_value=[frame(), tables(), {'left': 0, 'right': 0}]), patch.object(m.time, 'time', return_value=NOW + 60):
            out = m.validate_current_prefix(m.sha(raw), fresh, 'synthetic')
            self.assertEqual(out['canonicalObservedAtUnix'], NOW + 60)
            self.assertEqual(out['originalCanonicalObservedAtUnix'], NOW)
            self.assertEqual(raw, m.encoded(value))
            fresh['hash'] = '0x' + 'cc' * 32
            fresh['repeatedBoundary'] = {k: fresh[k] for k in ['number', 'hash', 'parentHash', 'timestamp']}
            with self.assertRaisesRegex(RuntimeError, 'same_native_canonical_boundary'): m.validate_current_prefix(m.sha(raw), fresh, 'synthetic')
    def test_default_review_mode_never_connects_or_looks_up_actors(self):
        current = {'reviewHash': 'a' * 64, 'binding': {'plan': {'boundary': m.FLOOR}}}
        with patch.object(m, 'review', return_value=current), patch.object(m, 'query') as query, patch.object(m, 'actors') as actor, \
             patch.object(sys, 'argv', ['parity', '--plan', '/synthetic']), patch('sys.stdout', new_callable=io.StringIO) as out:
            m.main()
            query.assert_not_called(); actor.assert_not_called()
            self.assertEqual(json.loads(out.getvalue())['databaseConnections'], 0)
    def test_timeout_terminates_real_grandchild_inheriting_captured_pipes(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'child.pid'
            child = 'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'
            code = ('import subprocess,sys,time;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c",' + repr(child)
                + ']);Path(sys.argv[1]).write_text(str(p.pid));time.sleep(30)')
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(RuntimeError, '^bounded_parity_timeout_inspect_only$'):
                    m.command([sys.executable, '-c', code, str(marker)], timeout=0.5)
                self.assertLess(time.monotonic() - started, 6)
                pid = int(marker.read_text()); status = Path('/proc') / str(pid) / 'stat'
                if status.exists():
                    raw = status.read_bytes(); self.assertEqual(raw[raw.rfind(b')') + 2:].split()[0], b'Z')
            finally:
                if marker.exists():
                    try: os.kill(int(marker.read_text()), signal.SIGKILL)
                    except ProcessLookupError: pass

if __name__ == '__main__': unittest.main()
