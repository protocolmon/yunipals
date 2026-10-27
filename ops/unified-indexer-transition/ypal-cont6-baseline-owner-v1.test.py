#!/usr/bin/env python3
"""Focused Root-entry controls; all application/SSH/PG outcomes are explicit I/O fixtures."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'ypal-cont6-baseline-owner-v1.py'
SPEC = importlib.util.spec_from_file_location('root_cont6_entry_controls', SOURCE)
m = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)
ROOT = HERE.parents[1]


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.root-cont6-controls-', dir=ROOT)
        self.root = Path(self.temp.name); self.root.chmod(0o700); self.addCleanup(self.temp.cleanup)
        mask = os.umask(0o077); self.addCleanup(lambda: os.umask(mask))
        self.n = {'__name__': 'explicit_remote_IO_fixture'}
        exec(compile(m.REMOTE, str(SOURCE) + ':remote', 'exec'), self.n)

    def test_syntax_default_inert_actual_API_shape_and_exact_single_dispatch(self):
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'c1a4ed35cf3f1bbe4572d481b3b0b504865618f993f42d696b5cc382fc62e076')
        compile(SOURCE.read_bytes(), str(SOURCE), 'exec'); tree = ast.parse(m.REMOTE)
        calls = [ast.unparse(row.func) for row in ast.walk(tree) if isinstance(row, ast.Call)]
        for name in ['module.Session', 'session.preflight', 'session.cache_context', 'module.construct_records']:
            self.assertEqual(calls.count(name), 1, name)
        for name in ['session.finish', 'module.qualify_held', 'module.execute_cache', 'module.execute_reader', 'sys.settrace', 'sys.setprofile']:
            self.assertNotIn(name, calls)
        spec = importlib.util.spec_from_file_location('actual_caller6_signature', ROOT / 'ops/unified-indexer-transition/ypal-ordinary-publication-continue-v6.py')
        caller = importlib.util.module_from_spec(spec); spec.loader.exec_module(caller)
        import inspect
        self.assertEqual(list(inspect.signature(caller.Session).parameters), ['source_refs', 'manifest_sha', 'metadata_refs', 'policy_refs', 'authority_input_sha', 'inverse'])
        self.assertEqual(list(inspect.signature(caller.construct_records).parameters), ['session', 'capture_id'])
        with patch.object(sys, 'argv', [str(SOURCE)]), patch.object(m.subprocess, 'run', side_effect=AssertionError('no network for inert default')), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main(), 0)
        self.assertTrue(json.loads(out.getvalue())['staticOnly'])

    def test_real_exact_byte_copy_and_exclusive_existing_parent_refusal(self):
        old = self.root / 'old.json'; raw = b'  {"unaltered": 1}\n'; old.write_bytes(raw); old.chmod(0o600)
        new = self.root / 'new' / 'input.json'; self.n.update(OLD_INPUT=old, NEW_INPUT=new, CACHE_SHA=hashlib.sha256(raw).hexdigest())
        before = old.stat(); self.n['copy_input']()
        self.assertEqual(new.read_bytes(), raw); self.assertEqual(old.read_bytes(), raw)
        self.assertEqual(stat.S_IMODE(new.stat().st_mode), 0o600); self.assertEqual(stat.S_IMODE(new.parent.stat().st_mode), 0o700)
        self.assertEqual(old.stat().st_ino, before.st_ino)
        with self.assertRaisesRegex(RuntimeError, 'exclusive_new_family6'): self.n['copy_input']()
        self.assertEqual(old.read_bytes(), raw); self.assertEqual(new.read_bytes(), raw)

    def test_copy_refuses_wrong_source_or_symlink_without_creating_destination(self):
        old = self.root / 'old.json'; old.write_bytes(b'changed'); old.chmod(0o600)
        new = self.root / 'new' / 'input.json'; self.n.update(OLD_INPUT=old, NEW_INPUT=new, CACHE_SHA='f' * 64)
        with self.assertRaises(RuntimeError): self.n['copy_input']()
        self.assertFalse(new.parent.exists())
        link = self.root / 'link'; link.symlink_to(old); self.n['OLD_INPUT'] = link
        with self.assertRaises(RuntimeError): self.n['copy_input']()
        self.assertFalse(new.parent.exists())

    def test_private_history_captures_both_distinct_epochs_and_exception(self):
        audit = self.root / 'audit'; audit.mkdir(mode=0o700); self.n['AUDIT'] = audit
        capture = {'attempts': [{'discarded': True}, {'discarded': False}]}
        self.n['session'] = types.SimpleNamespace(metadata_epoch=types.SimpleNamespace(current_capture_history=[capture]), cache=types.SimpleNamespace(metadata_epoch=types.SimpleNamespace(current_capture_history=[capture])))
        error = RuntimeError('fixture'); error.metadata_current_capture_history = [capture]
        value = self.n['histories'](error)
        self.assertEqual((value['instances'], value['captures'], value['attempts'], value['discarded']), (2, 2, 4, 2))
        path = audit / 'metadata-capture-histories.private.json'; self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        saved = json.loads(path.read_bytes()); self.assertEqual(len(saved['exceptionHistory']), 1)

    def test_run_uses_one_original_constructor_and_retained_postflight_shape(self):
        n = self.n; events = []; source_refs = {'resultSha256': 'a' * 64, 'inputSha256': 'b' * 64}
        baseline = {'format': 'yunipals-ypal-ordinary-cache-continuation-authority-v6', 'completed': True, 'action': 'construct-records', 'fullSourcePostflight': {'validated': True}, 'productionPreparedACKCreated': False, 'productionCOMMITQualified': False, 'newStopActionPerformed': False, 'actualNewRehearsalXID': '99999999', 'sha256': 'c' * 64, 'beforeSha256': 'd' * 64, 'rehearsedSha256': 'e' * 64, 'authorizationSha256': 'f' * 64}
        authority = types.SimpleNamespace(BASE=n['AUTH_BASE'], TTL_NS=120_000_000_000, COMMIT_RESERVE_NS=5_000_000_000)
        session = types.SimpleNamespace(cache=types.SimpleNamespace(BASE=n['CACHE_BASE'], continuation_authority=authority), preflight=lambda: events.append('preflight') or {'validated': True}, cache_context=lambda digest: events.append(('cache_context', digest)))
        module = types.ModuleType('explicit_application_IO_fixture')
        def make(*args):
            events.append(('Session', args)); return session
        module.Session = make
        def construct(actual, capture):
            self.assertIs(actual, session); self.assertEqual(capture, n['CAPTURE']); events.append('construct_records'); return baseline
        module.construct_records = construct
        def read(path, digest=None):
            if path == n['CALLER']: self.assertEqual(digest, n['CALLER_SHA']); return b'pass'
            if path == n['REPORT']: return n['encoded']({'sourceRefs': source_refs})
            if path == n['AUTH_INPUT']: return n['encoded']({'format': 'yunipals-ypal-ordinary-cache-continuation-authority-v6-input', 'nativePolicyRefs': n['POLICY']})
            return b'authenticated-file-I/O-fixture'
        n.update(read=read, old_frames=lambda: {'original': {'unchanged': True}}, copy_input=lambda: {'exactCopyIOFixture': True}, save=lambda name, value: hashlib.sha256(n['encoded'](value)).hexdigest(), histories=lambda: {'instances': 2}, types=types.SimpleNamespace(ModuleType=lambda name: module))
        with patch.object(n['os'].path, 'lexists', return_value=False): result = n['run']()
        self.assertTrue(result['completed']); self.assertTrue(n['invoked']); self.assertTrue(n['returned'])
        self.assertEqual(events[0][1], (source_refs, n['MANIFEST_SHA'], n['META'], n['POLICY'], n['AUTH_SHA'], False))
        self.assertEqual(events[1:], ['preflight', ('cache_context', n['CACHE_SHA']), 'construct_records'])
        self.assertFalse(result['cacheCommitRequested']); self.assertFalse(result['readerLOGINRequested'])

    def test_outer_strict_reply_types_and_unknown_transport_are_private_and_never_retried(self):
        good = {'format': m.FORMAT, 'completed': True}
        cases = [(json.dumps(good).encode(), b'', 0, True), (b'[]', b'', 0, False), (b'null', b'', 0, False), (b'{}', b'', 0, False), (b'{"format":"wrong","completed":true}', b'', 0, False), (json.dumps({**good, 'completed': 1}).encode(), b'', 0, False), (json.dumps(good).encode(), b'error', 0, False), (json.dumps(good).encode(), b'', 1, False)]
        for index, (out, err, code, accepted) in enumerate(cases):
            result = self.root / ('result' + str(index)); transport = self.root / ('transport' + str(index))
            peer = types.SimpleNamespace(stdout=out, stderr=err, returncode=code)
            with self.subTest(index=index), patch.object(m, 'RESULT', result), patch.object(m, 'TRANSPORT', transport), patch.object(sys, 'argv', [str(SOURCE), '--run']), patch.object(m.subprocess, 'run', return_value=peer) as call, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(), 0 if accepted else 1)
                self.assertEqual(call.call_count, 1); self.assertEqual(call.call_args.kwargs['timeout'], 1220)
            self.assertEqual(stat.S_IMODE(result.stat().st_mode), 0o600)
            value = json.loads(result.read_bytes())
            if accepted: self.assertEqual(value['resultSha256'], hashlib.sha256(out).hexdigest())
            else:
                self.assertTrue(value['transportOutcomeUnknown']); self.assertFalse(value['automaticRetryAllowed'])
                self.assertEqual(stat.S_IMODE(transport.stat().st_mode), 0o600)


if __name__ == '__main__': unittest.main()
