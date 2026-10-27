"""Self-contained synthetic controls; no DB, provider or service actions."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
m = load('metadata-fixed-parity-v4'); old = load('metadata-fixed-parity-v3')

def rows():
    scan = {'chainId': 8453, 'contract': '0x98433df878e8c898cb907345c3a7756e5f72240f',
            'deploymentBlock': '22224075', 'nextBlock': str(m.BOUNDARY + 1), 'ingestionMode': 'rpc'}
    result = []
    for part in m.PARTITIONS:
        side = {'rows': 1, 'unique_keys': 1, 'mints': 1, 'updates': 0, 'payload_sha256': hashlib.sha256(part.encode()).hexdigest()}
        result.append({'partition': part, 'boundary': m.BOUNDARY, 'legacy': side,
            'native': {**side, 'unexpected_identities': 0},
            'comparison': {'missing_legacy': 0, 'missing_native': 0, 'changed_payloads': 0}, 'legacyScan': scan})
    return result + [{'invalidKeys': {'legacy': 0, 'native': 0}}]

class Tests(unittest.TestCase):
    def capture(self, data=None, identities=None):
        data = rows() if data is None else data
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m.socket, 'gethostname', return_value='yunipals-main'), \
             patch.object(m.os, 'statvfs', return_value=types.SimpleNamespace(f_bavail=100000000, f_frsize=4096)), \
             patch.object(m.os.path, 'lexists', return_value=False), patch.object(m, 'source_identity', side_effect=identities or [{'same': True}, {'same': True}]), \
             patch.object(m, 'command', return_value='\n'.join(json.dumps(row) for row in data)) as command:
            result = m.capture(); self.assertEqual(command.call_args.args[1:], (m.EXECUTION_SQL, 360))
            self.assertIn('-w', command.call_args.args[0]); self.assertIn('PGPASSFILE=' + m.PEER_PASSWORD_SENTINEL, command.call_args.args[0])
            self.assertIn('PGAPPNAME=' + m.APPLICATION_NAME, command.call_args.args[0])
            return result
    def test_frozen_v3_and_only_namespace_query_difference(self):
        self.assertEqual(hashlib.sha256((HERE / 'metadata-fixed-parity-v3.py').read_bytes()).hexdigest(), '99cca36142bf8c26de017800649227eb0d77d1109a82cf657df95c2dcb64eabe')
        self.assertEqual(m.BASE_SQL.replace(m.CONTEXT['schema'], 'unified_shadow_20261020_7e7375b0'), old.BASE_SQL)
        self.assertEqual(m.SQL.replace(m.CONTEXT['schema'], 'unified_shadow_20261020_7e7375b0'), old.SQL)
        self.assertEqual(m.PARTITIONS, old.PARTITIONS); self.assertEqual(m.BOUNDARY, 52870977)
    def test_sixteen_partitions_one_RR_caps_and_no_TTL_override(self):
        self.assertEqual(m.SQL.count('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'), 1)
        self.assertEqual(m.SQL.count('ROLLBACK;'), 1)
        self.assertEqual(m.SQL.count("'partition','"), 16)
        self.assertEqual(m.EXECUTION_SQL.replace(m.CONTEXT_GUARD, '', 1), m.SQL)
        self.assertLess(m.EXECUTION_SQL.index(m.CONTEXT_GUARD), m.EXECUTION_SQL.index('WITH legacy'))
        self.assertIn("right(latest_checkpoint,33)=repeat('9',33)", m.CONTEXT_GUARD)
        self.assertIn("ELSE 1 END>=52870977", m.CONTEXT_GUARD)
        for text in ["statement_timeout='90s'", "lock_timeout='500ms'", "work_mem='16MB'", "temp_file_limit='512MB'", 'max_parallel_workers_per_gather=0', 'enable_mergejoin=off']:
            self.assertIn(text, m.EXECUTION_SQL)
        self.assertNotIn('frameworkReady', m.CONTEXT_GUARD); self.assertNotIn('is_ready', m.CONTEXT_GUARD)
    def test_new_exact_source_read_peer_context_is_guarded_in_snapshot(self):
        for value in [m.CONTEXT['releaseId'], m.CONTEXT['readIdentity'], m.CONTEXT['manifestHash'], m.CONTEXT['buildId'], m.CONTEXT['schemaOid'], m.CONTEXT['readSchemaOid'], '17584']:
            self.assertIn(value, m.CONTEXT_GUARD)
        self.assertIn("current_user='postgres'", m.CONTEXT_GUARD)
    def test_full_synthetic_equal_result_remains_data_only(self):
        value = self.capture(); self.assertTrue(value['exactDataParity']); self.assertFalse(value['canonicalAcceptance']); self.assertFalse(value['sourceSelected'])
        self.assertEqual(value['comparison']['legacy']['rows'], 16); self.assertEqual(value['comparison']['native']['rows'], 16)
        self.assertEqual(value['databaseWrites'], 0); self.assertEqual(value['context'], m.CONTEXT)
    def test_any_missing_partition_and_invalid_key_shape_refuses(self):
        data = rows(); data.pop(0)
        with self.assertRaisesRegex(RuntimeError, 'all_sixteen'): self.capture(data)
        data = rows(); data[-1]['invalidKeys']['extra'] = 0
        with self.assertRaisesRegex(RuntimeError, 'invalid_key_coverage'): self.capture(data)
    def test_all_mismatch_types_remain_explicitly_unequal(self):
        for edit in [lambda v: v[0]['comparison'].update(changed_payloads=1), lambda v: v[0]['comparison'].update(missing_native=1),
            lambda v: v[-1]['invalidKeys'].update(native=1), lambda v: v[0]['native'].update(unexpected_identities=1),
            lambda v: v[0]['native'].update(unique_keys=0), lambda v: v[0]['native'].update(payload_sha256='0'*64),
            lambda v: v[0].update(legacyScan={**v[0]['legacyScan'], 'nextBlock': str(m.BOUNDARY)})]:
            value = rows(); edit(value); self.assertFalse(self.capture(value)['exactDataParity'])
    def test_current_actor_change_refuses_result(self):
        with self.assertRaisesRegex(RuntimeError, 'source_changed'): self.capture(identities=[{'same': 1}, {'same': 2}])
    def test_source_handle_rejects_replacement_or_old_terminal(self):
        fields = {'MainPID': m.SOURCE_PID, 'ActiveState': 'active', 'SubState': 'running', 'InvocationID': m.INVOCATION}
        raw = b'2472127 (synthetic) ' + b' '.join([b'S'] * 19 + [str(m.SOURCE_START_TICKS).encode()])
        with patch.object(m, 'command', return_value='\n'.join(k+'='+v for k,v in fields.items())), patch.object(m.Path, 'read_bytes', return_value=raw):
            self.assertEqual(m.source_identity()['startTicks'], m.SOURCE_START_TICKS)
        for key,value in [('MainPID','0'),('InvocationID','old'),('ActiveState','failed')]:
            changed = {**fields, key:value}
            with patch.object(m, 'command', return_value='\n'.join(k+'='+v for k,v in changed.items())):
                with self.assertRaisesRegex(RuntimeError, 'current_combined'): m.source_identity()
    def test_command_keeps_clean_env_root_cwd_and_sanitizes_errors(self):
        process = types.SimpleNamespace(returncode=0, communicate=lambda *a, **k: ('{}', ''))
        with patch.object(m.subprocess, 'Popen', return_value=process) as run:
            self.assertEqual(m.command(['synthetic']), '{}'); self.assertEqual(run.call_args.kwargs['cwd'], '/'); self.assertEqual(run.call_args.kwargs['env'], m.CLEAN)
            self.assertTrue(run.call_args.kwargs['start_new_session'])
        process = types.SimpleNamespace(returncode=1, communicate=lambda *a, **k: ('', 'ERROR: 57014 private rows'))
        with patch.object(m.subprocess, 'Popen', return_value=process):
            with self.assertRaisesRegex(RuntimeError, '^bounded_metadata_comparison_failed_sqlstate_57014$'): m.command(['synthetic'])

    def test_timeout_stops_real_descendant_with_inherited_pipes(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'grandchild.pid'
            child = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)"
            # The intermediate reader exits on TERM. Its descendant deliberately
            # retains stdout/stderr and ignores TERM, exercising the KILL path.
            code = ("import subprocess,sys,time;from pathlib import Path;"
                    "p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]);"
                    "Path(sys.argv[1]).write_text(str(p.pid));"
                    "print('synthetic private diagnostic',flush=True);time.sleep(30)")
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(RuntimeError, '^bounded_metadata_comparison_timed_out_inspect_only$'):
                    m.command([sys.executable, '-c', code, str(marker)], timeout=1)
                self.assertLess(time.monotonic() - started, 7)
                pid = int(marker.read_text())
                status = Path('/proc') / str(pid) / 'stat'
                try:
                    raw = status.read_bytes()
                    self.assertEqual(raw[raw.rfind(b')') + 2:].split()[0], b'Z')
                except FileNotFoundError:
                    pass
            finally:
                if marker.exists():
                    pid = int(marker.read_text())
                    try:
                        if b'time.sleep(30)' in (Path('/proc') / str(pid) / 'cmdline').read_bytes():
                            os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except FileNotFoundError:
                        pass

if __name__ == '__main__': unittest.main()
