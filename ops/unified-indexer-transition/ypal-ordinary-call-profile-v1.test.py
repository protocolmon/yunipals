import hashlib
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

FILE=Path(__file__).with_name('ypal-ordinary-call-profile-v1.py')
spec=importlib.util.spec_from_file_location('actual_profile',FILE)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
THIS=str(Path(__file__).resolve());SHA=hashlib.sha256(Path(THIS).read_bytes()).hexdigest()


class Controls(unittest.TestCase):
    def test_calls_args_identity_result_exception_and_code_are_unchanged(self):
        marker=object();error=RuntimeError('actual error');calls=[]
        def target(value,*,fail=False):
            calls.append((value,fail))
            if fail:raise error
            return value
        code=target.__code__;defaults=target.__defaults__;profile=module.CallProfile({THIS:SHA},{'target'})
        with profile:
            self.assertIs(target(marker),marker)
            with self.assertRaises(RuntimeError)as caught:target(marker,fail=True)
        self.assertIs(caught.exception,error);self.assertIs(target.__code__,code);self.assertIs(target.__defaults__,defaults)
        self.assertEqual(calls,[(marker,False),(marker,True)])
        self.assertEqual(len(profile.snapshot()['events']),2);self.assertIsNone(sys.getprofile())
        self.assertTrue(all(not row['successQualified']and row['elapsedNs']>=0 for row in profile.events))

    def test_nested_same_name_and_finite_cap(self):
        def target(n):return target(n-1)if n else 0
        profile=module.CallProfile({THIS:SHA},{'target'},2)
        with profile:self.assertEqual(target(5),0)
        self.assertEqual(len(profile.events),2);self.assertEqual(profile.dropped,4)
        self.assertEqual(profile.snapshot()['unfinishedCalls'],0)

    def test_other_files_and_names_are_not_profiled(self):
        def excluded():return 7
        profile=module.CallProfile({THIS:SHA},{'target'})
        with profile:self.assertEqual(excluded(),7)
        self.assertEqual(profile.events,[])

    def test_existing_profiler_and_reentrant_install_refuse(self):
        profile=module.CallProfile({THIS:SHA},{'target'})
        sentinel=lambda *_:None
        sys.setprofile(sentinel)
        try:
            with self.assertRaisesRegex(RuntimeError,'exclusive'):profile.__enter__()
            self.assertIs(sys.getprofile(),sentinel)
        finally:sys.setprofile(None)
        with profile:
            with self.assertRaisesRegex(RuntimeError,'exclusive'):profile.__enter__()

    def test_original_exception_propagates_and_profile_is_removed(self):
        error=LookupError('actual');profile=module.CallProfile({THIS:SHA},{'target'})
        with self.assertRaises(LookupError)as caught:
            with profile:raise error
        self.assertIs(caught.exception,error);self.assertIsNone(sys.getprofile())

    def test_observation_exception_does_not_replace_original_call(self):
        def target():return 7
        profile=module.CallProfile({THIS:SHA},{'target'})
        with patch.object(module.time,'monotonic_ns',side_effect=OSError('observation failure')):
            with profile:self.assertEqual(target(),7)
        self.assertGreater(profile.observation_errors,0);self.assertEqual(profile.events,[])

    def test_runtime_deadline_inside_observer_is_not_swallowed(self):
        def target():return 7
        error=RuntimeError('actual deadline');profile=module.CallProfile({THIS:SHA},{'target'})
        with patch.object(module.time,'monotonic_ns',side_effect=error):
            with self.assertRaises(RuntimeError)as caught:
                with profile:target()
        self.assertIs(caught.exception,error);self.assertIsNone(sys.getprofile())

    def test_actual_qualifier_trace_and_profile_coexist_without_code_changes(self):
        def load(name):
            path=FILE.with_name(name);s=importlib.util.spec_from_file_location(name,path)
            value=importlib.util.module_from_spec(s);s.loader.exec_module(value);return value
        genuine=load('ypal-ordinary-cache-continuation-authority-v1.py')
        diagnostic=load('ypal-ordinary-held-diagnostic-v1.py');inner=RuntimeError('fixture actual inner error')
        def parent():return None
        parent=types.FunctionType(parent.__code__,{'protected':lambda *_:b''})
        def fail(*args,**kwargs):raise inner
        cache=types.SimpleNamespace(_sql_child=parent,prior_cache=types.SimpleNamespace(_sql_child=parent),
            BASE=Path('/tmp/unused-profile-fixture'),sql_child=fail)
        def need(value,code):
            if not value:raise RuntimeError(code)
        scope={**genuine._qualify_held.__globals__,'qualification_key':lambda *_:{},
            'capture_directory':lambda *_:Path('/tmp/unused-profile-fixture'),
            'NEW_BASE':Path('/tmp/unused-profile-fixture'),
            'write':lambda *_:'fixture','original_catalog':lambda *_:({},{}),
            'stopped':lambda *_:({}, {'sql':{'result':{},'resultJson':'{}'}},{}),
            'rollback_transport':lambda fn,*_:fn,'prepared_callback':lambda *_:None,'need':need}
        actual=types.FunctionType(genuine._qualify_held.__code__,scope)
        trace=diagnostic.CaughtErrorTrace(actual.__code__)
        path=str(FILE.with_name('ypal-ordinary-cache-continuation-authority-v1.py'))
        profile=module.CallProfile({path:hashlib.sha256(Path(path).read_bytes()).hexdigest()},{'_qualify_held'})
        with self.assertRaisesRegex(RuntimeError,'complete_actual_held_callback'):
            with profile,trace:actual(cache,object(),'fixture')
        self.assertIs(trace.error,inner);self.assertEqual(len(profile.events),1)
        self.assertIs(actual.__code__,genuine._qualify_held.__code__)
        self.assertIsNone(sys.getprofile());self.assertIsNone(sys.gettrace())


if __name__=='__main__':unittest.main()
