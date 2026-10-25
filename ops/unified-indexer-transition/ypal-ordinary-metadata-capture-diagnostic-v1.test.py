"""Real bounded subprocess observations and exact read-only capture plumbing."""
import ast
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('diagnostic', HERE / 'ypal-ordinary-metadata-capture-diagnostic-v1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def wrapper(self):
        saved = {}
        def save(name, body):
            self.assertNotIn(name, saved)
            saved[name] = body
            return m.sha(body)
        return m.SubprocessDiagnostics(subprocess.run, save), saved

    def test_default_and_exact_frozen_executor(self):
        value = json.loads(subprocess.run(['/usr/bin/python3', '-I', '-B', m.__file__], capture_output=True, check=True).stdout)
        self.assertTrue(value['staticOnly'])
        self.assertEqual(value['serviceActions'], 0)
        self.assertEqual(m.sha((HERE / m.EXECUTOR.name).read_bytes()), m.EXECUTOR_SHA)

    def test_actual_anonymous_stdio_pipes_are_unmodified(self):
        trace, saved = self.wrapper()
        value = trace(['/usr/bin/true'], input=b'', capture_output=True, timeout=2)
        self.assertEqual(value.returncode, 0)
        self.assertEqual(value.stdout, b'')
        self.assertEqual(saved, {})
        self.assertEqual(trace.calls[0]['stdoutBytes'], 0)

    def test_actual_unknown_failed_child_arguments_and_output_never_persist(self):
        trace, saved = self.wrapper()
        code = "import sys;print('private-stdout');sys.stderr.write('private-stderr');sys.exit(7)"
        value = trace(['/usr/bin/python3', '-I', '-B', '-c', code], capture_output=True, timeout=2)
        self.assertEqual(value.returncode, 7)
        private = json.loads(saved['failed-command-1.json'])
        self.assertFalse(private['rawPublicPeerEvidenceRetained'])
        self.assertNotIn('argv', private)
        self.assertNotIn('stdoutBase64', private)
        self.assertNotIn('stderrBase64', private)
        self.assertNotIn('private-stdout', saved['failed-command-1.json'].decode())
        self.assertNotIn('private-stderr', saved['failed-command-1.json'].decode())
        self.assertNotIn(code, saved['failed-command-1.json'].decode())
        self.assertEqual(trace.failures[0]['exitCode'], 7)
        self.assertNotIn('private-stdout', json.dumps(trace.calls))
        self.assertNotIn('private-stderr', json.dumps(trace.failures))
        self.assertNotIn(code, json.dumps(trace.failures))

    def test_stderr_success_also_records_exact_inventory_refusal(self):
        trace, saved = self.wrapper()
        trace(['/usr/bin/python3', '-I', '-B', '-c', "import sys;sys.stderr.write('private warning')"], capture_output=True, timeout=2)
        self.assertEqual(len(saved), 1)
        self.assertEqual(trace.failures[0]['exitCode'], 0)
        self.assertEqual(trace.failures[0]['stderrBytes'], 15)

    def test_real_check_exception_preserved_and_private_traceback(self):
        trace, saved = self.wrapper()
        with self.assertRaises(subprocess.CalledProcessError):
            trace(['/usr/bin/false'], capture_output=True, check=True, timeout=2)
        private = json.loads(saved['failed-command-1.json'])
        self.assertEqual(private['exceptionClass'], 'CalledProcessError')
        self.assertTrue(all(set(row) == {'file', 'function', 'line'} for row in private['traceback']))
        self.assertTrue(all(set(row) == {'file', 'function', 'line'} for row in trace.failures[0]['traceback']))

    def test_safe_numeric_uid_options_and_finite_command_kind(self):
        summary = m.command_summary(['/usr/bin/setpriv', '--reuid=111', '--regid', '113', '--clear-groups', '--no-new-privs', '--inh-caps=-all', '/private/program'])
        self.assertEqual((summary['uid'], summary['gid']), (111, 113))
        self.assertTrue(summary['clearGroups'] and summary['noNewPrivileges'] and summary['capabilityOptionsPresent'])
        self.assertNotIn('/private/program', json.dumps(summary))
        self.assertEqual(m.command_summary(['/private/sensitive-program'])['commandKind'], 'other')

    def public_peer(self):
        source = HERE.parents[1] / m.PUBLIC_INVENTORY
        raw = source.read_bytes()
        self.assertEqual(m.sha(raw), m.PUBLIC_INVENTORY_SHA)
        tree = ast.parse(raw)
        script = next(row.value.value for row in tree.body if isinstance(row, ast.Assign) and
                      any(isinstance(target, ast.Name) and target.id == 'PEER_FDS' for target in row.targets))
        self.assertEqual(m.sha(script.encode()), m.PEER_FDS_SCRIPT_SHA)
        return ['/usr/bin/setpriv', '--reuid=0', '--regid=0', '--clear-groups', '--no-new-privs',
                '--inh-caps=-all', '--ambient-caps=-all', '/usr/bin/python3', '-I', '-B', '-c', script,
                '[2147483647]', '0']

    def test_genuine_exact_public_peer_failure_retains_bounded_raw(self):
        trace, saved = self.wrapper()
        argv = self.public_peer()
        self.assertTrue(m.public_fd_peer(argv))
        result = trace(argv, capture_output=True, timeout=2)
        self.assertNotEqual(result.returncode, 0)
        private = json.loads(saved['failed-command-1.json'])
        self.assertTrue(private['rawPublicPeerEvidenceRetained'])
        self.assertEqual(private['argv'], argv)
        self.assertEqual(base64.b64decode(private['stderrBase64']), result.stderr)
        self.assertEqual(base64.b64decode(private['stdoutBase64']), result.stdout)
        self.assertLessEqual(len(result.stderr), m.MAX_RAW_BYTES)

    def test_unknown_script_extra_private_arg_and_wrong_uid_refuse_raw(self):
        argv = self.public_peer()
        for changed in [argv + ['private-sentinel'], argv[:11] + ['print("private-sentinel")'] + argv[12:],
                        argv[:-1] + ['970'], argv[:12] + ['[true]', '0']]:
            self.assertFalse(m.public_fd_peer(changed))
        source = Path(m.__file__).read_text()
        self.assertNotIn('format_exception', source)
        self.assertNotIn('format_stack', source)

    def test_raw_capture_count_and_byte_limits(self):
        argv = self.public_peer()
        saved = {}
        trace = m.SubprocessDiagnostics(lambda *a, **kw: subprocess.CompletedProcess(argv, 1, b'public', b'public-error'),
                                       lambda name, body: saved.setdefault(name, body) and m.sha(body))
        for _ in range(m.MAX_RAW_FAILURES + 1):
            trace(argv)
        self.assertEqual(sum(json.loads(body)['rawPublicPeerEvidenceRetained'] for body in saved.values()), m.MAX_RAW_FAILURES)
        trace.original = lambda *a, **kw: subprocess.CompletedProcess(argv, 1, b'x' * (m.MAX_RAW_BYTES + 1), b'')
        trace(argv)
        self.assertFalse(json.loads(saved['failed-command-' + str(m.MAX_RAW_FAILURES + 2) + '.json'])['rawPublicPeerEvidenceRetained'])

    def test_capture_uses_exact_once_readonly_entry_without_effects(self):
        calls = []
        host = object()
        namespace = object()
        owner = types.SimpleNamespace(namespace=lambda pin: calls.append('namespace') or namespace,
                                      cli_context=lambda pin: calls.append('cli_context') or host)
        context = types.SimpleNamespace(load_input=lambda pin: {'candidateReceiptSha256': 'candidate', 'candidateInputSha256': 'candidate-input'})
        value = types.SimpleNamespace(OWNER='owner', OWNER_SHA='owner-pin', COMMON='common', COMMON_SHA='common-pin',
            INPUT_SHA='input', CANDIDATE_SHA='candidate', CANDIDATE_INPUT_SHA='candidate-input', need=m.need,
            module=lambda name, pin: owner if name == 'owner' else context,
            install_session_observer=lambda n, h, observations: calls.append('session-observer'),
            capture=lambda n, h, pin, observations: calls.append('capture') or {'complete': True})
        self.assertEqual(m.capture(value), {'complete': True})
        self.assertEqual(calls, ['namespace', 'cli_context', 'session-observer', 'capture'])
        tree = ast.parse(Path(m.__file__).read_text())
        function = next(row for row in tree.body if isinstance(row, ast.FunctionDef) and row.name == 'capture')
        names = {ast.unparse(row.func) for row in ast.walk(function) if isinstance(row, ast.Call)}
        self.assertFalse(any(name.endswith(('.main', '.execute', '.drain', '.manager', '.save')) for name in names))

    def test_private_files_exclusive0600_and_no_raw_public_export(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(m, 'BASE', Path(folder)):
            m.private('failed-command-1.json', b'private')
            self.assertEqual((Path(folder) / 'failed-command-1.json').stat().st_mode & 0o777, 0o600)
            self.assertRaises(FileExistsError, m.private, 'failed-command-1.json', b'changed')
        tree = ast.parse(Path(m.__file__).read_text())
        run = next(row for row in tree.body if isinstance(row, ast.FunctionDef) and row.name == 'run')
        result = next(row.value for row in run.body if isinstance(row, ast.Return))
        self.assertNotIn('capture', [row.value for row in result.keys if isinstance(row, ast.Constant)])


if __name__ == '__main__':
    unittest.main()
