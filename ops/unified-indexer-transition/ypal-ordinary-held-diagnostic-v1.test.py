"""Local pipe/trace fixtures only; never a production qualification receipt."""
import base64
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-held-diagnostic-v1.py');genuine=load('ypal-ordinary-cache-continuation-authority-v1.py')

def helper(callee):
    error=None
    try:callee()
    except BaseException as caught:error=caught
    finally:restored=True
    if error is not None:raise RuntimeError('fixture_generic_outer_refusal')

def raw_parent():
    marker='commit-authorized'
    return subprocess.Popen(['fixture-never-executed'],stderr=subprocess.PIPE,env={'FIXTURE':'exact'},start_new_session=True)

class Controls(unittest.TestCase):
    def terminal_pipe(self,data=b'fixture SQL stderr\n'):
        read,write=os.pipe();os.write(write,data);os.close(write)
        raw=os.fdopen(read,'rb',buffering=0);self.addCleanup(raw.close)
        process=types.SimpleNamespace(pid=123,returncode=7)
        return raw,process
    def test_original_read_arguments_bytes_and_error_are_identical(self):
        raw=Mock();raw.read.return_value=b'abc';process=types.SimpleNamespace(pid=123,returncode=0)
        tee=m.StderrTee(raw,process,{})
        self.assertIs(tee.read(99),raw.read.return_value);raw.read.assert_called_once_with(99)
        error=RuntimeError('fixture original read error');raw.read.side_effect=error
        with self.assertRaises(RuntimeError)as seen:tee.read(1000000)
        self.assertIs(seen.exception,error)
    def test_unread_stderr_captured_only_after_terminal_at_original_close(self):
        raw,process=self.terminal_pipe();tee=m.StderrTee(raw,process,{})
        tee.close();value=tee.snapshot()
        self.assertEqual(base64.b64decode(value['stderrBase64']),b'fixture SQL stderr\n')
        self.assertTrue(value['complete']);self.assertTrue(raw.closed);self.assertEqual(value['returncode'],7)
    def test_buffered_original_short_read_retains_prefetched_tail_at_close(self):
        read,write=os.pipe();os.write(write,b'buffered SQL stderr');os.close(write)
        raw=os.fdopen(read,'rb');self.addCleanup(raw.close)
        tee=m.StderrTee(raw,types.SimpleNamespace(pid=123,returncode=7),{})
        self.assertEqual(tee.read(1),b'b');tee.close();value=tee.snapshot()
        self.assertEqual(base64.b64decode(value['stderrBase64']),b'buffered SQL stderr')
        self.assertTrue(value['complete'])
    def test_live_process_never_drains_or_waits_or_controls_child(self):
        raw,process=self.terminal_pipe();process.returncode=None;tee=m.StderrTee(raw,process,{})
        with patch.object(m.select,'select',side_effect=AssertionError('must not drain live child')):tee.close()
        self.assertEqual(tee.snapshot()['capturedBytes'],0);self.assertFalse(tee.snapshot()['complete'])
    def test_capture_is_bounded_and_marked_without_claiming_full_stderr(self):
        raw,process=self.terminal_pipe(b'12345678');tee=m.StderrTee(raw,process,{})
        with patch.object(m,'MAXIMUM_STDERR_BYTES',4):tee.close()
        self.assertEqual(base64.b64decode(tee.snapshot()['stderrBase64']),b'1234')
        self.assertTrue(tee.snapshot()['truncatedOrAtCap']);self.assertFalse(tee.snapshot()['complete'])
    def test_deadline_or_cancellation_during_diagnostic_close_is_not_swallowed(self):
        raw,process=self.terminal_pipe();tee=m.StderrTee(raw,process,{});error=RuntimeError('fixture deadline')
        with patch.object(m.select,'select',side_effect=error):
            with self.assertRaises(RuntimeError)as seen:tee.close()
        self.assertIs(seen.exception,error);self.assertTrue(raw.closed)
    def test_exact_code_trace_retains_caught_error_and_preserves_outer_refusal(self):
        inner=RuntimeError('fixture original SQL error');trace=m.CaughtErrorTrace(helper.__code__)
        def callee():raise inner
        with self.assertRaisesRegex(RuntimeError,'generic_outer_refusal'):
            with trace:helper(callee)
        proof=trace.snapshot();self.assertEqual(proof['innerErrorMessage'],str(inner))
        self.assertIn('callee',proof['innerErrorTraceback']);self.assertIs(trace.error,inner);self.assertIsNone(sys.gettrace())
    def test_same_code_scope_passes_original_Popen_objects_and_restores_on_error(self):
        def rollback(fn,prior,save):
            constants=list(fn.__code__.co_consts);self.assertEqual(constants.count('commit-authorized'),1)
            constants[constants.index('commit-authorized')]='fixture-never-authorized'
            return types.FunctionType(fn.__code__.replace(co_consts=tuple(constants)),fn.__globals__,fn.__name__,fn.__defaults__,fn.__closure__)
        authority=types.SimpleNamespace(rollback_transport=rollback,code_identity=genuine.code_identity,_qualify_held=helper)
        cache=types.SimpleNamespace(_sql_child=raw_parent,prior_cache=types.SimpleNamespace(_sql_child=raw_parent))
        observed=m.ObservedQualification(cache,authority);raw,process=self.terminal_pipe();process.stderr=raw
        with patch.object(m.subprocess,'Popen',return_value=process)as launch:
            with self.assertRaisesRegex(RuntimeError,'generic_outer_refusal'):
                with observed:
                    fn=rollback(cache._sql_child,raw_parent,None)
                    def failure():
                        child=fn();child.stderr.close();raise RuntimeError('fixture inner transport')
                    helper(failure)
        launch.assert_called_once_with(['fixture-never-executed'],stderr=subprocess.PIPE,env={'FIXTURE':'exact'},start_new_session=True)
        proof=observed.snapshot();self.assertTrue(proof['wholeParentCodeUnchanged']);self.assertTrue(proof['parentRestored']);self.assertTrue(proof['traceRestored'])
        self.assertEqual(proof['caughtError']['innerErrorMessage'],'fixture inner transport');self.assertEqual(proof['transports'][0]['returncode'],7)
        self.assertIs(cache._sql_child,raw_parent)

if __name__=='__main__':unittest.main()
