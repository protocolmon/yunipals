"""Actual protected facade composition; only source/files and receipt I/O relocate."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-cont5-held-after-exception-v2.py')
family=load('ypal-ordinary-publication-continue-v5.test.py')

class Controls(unittest.TestCase):
    def setUp(self):
        # Keep every production facade function, factory and helper body intact.
        # Only Path's protected source reads/stats are mapped to actual repo
        # bytes; no utility.authority, composition, namespace or class is mocked.
        original_read=Path.read_bytes;original_lstat=Path.lstat;original_open=os.open
        self.original_read=original_read
        def source_path(path):
            path=Path(path)
            if path.is_relative_to(m.OPS):
                rel=path.relative_to(m.OPS)
                if not rel.parts:return HERE
                candidate=HERE/rel
                if not candidate.exists()and path.name=='ypal-old-runtime-inventory-v1.py':candidate=HERE.parent/'booster-launch'/path.name
                if not candidate.exists()and path.name=='final-supervisor-inventory-v1.py':candidate=HERE.parent/'solana-acceptance'/path.name
                return candidate
            if path in m.OPS.parents and str(path).startswith('/opt'):return HERE
            return path
        self.enterContext(patch.object(Path,'read_bytes',lambda path:original_read(source_path(path))))
        self.enterContext(patch.object(Path,'lstat',lambda path,*args,**kw:original_lstat(source_path(path),*args,**kw)))
        self.enterContext(patch.object(os,'open',lambda path,*args,**kw:original_open(source_path(path)if isinstance(path,(str,Path))else path,*args,**kw)))
        self.base,self.base_raw=m.frozen()
        self.facade=m.reference_facade(self.base);self.namespace=self.facade.composition()
        self.assertIsNot(self.facade.__dict__,self.namespace.__dict__)
        self.assertIs(self.facade._qualify_held.__globals__,self.namespace.__dict__)

    def failed(self,authority=None,inner=None,no_inner=False):
        authority=self.facade if authority is None else authority
        case=family.Controls();case.setUp();self.addCleanup(case.doCleanups)
        cache=case.provider().cache_runtime();cache.continuation_authority=authority
        original=cache._sql_child;namespace=authority.composition()
        original_inner=RuntimeError('actual_full_source_refusal_IO_fixture')if inner is None else inner
        def fail(*_args,**_kwargs):
            if no_inner:return {'explicitUnexpectedTransportReturnIOFixture':True}
            raise original_inner
        with patch.object(namespace,'qualification_key',return_value={}),\
            patch.object(namespace,'capture_directory',return_value=Path('/unused-owned-facade-witness-fixture')),\
            patch.object(namespace,'write',return_value='fixture'),\
            patch.object(namespace,'original_catalog',return_value=({},{})),\
            patch.object(namespace,'stopped',return_value=({}, {'sql':{'result':{},'resultJson':'{}'}},{})),\
            patch.object(cache,'sql_child',side_effect=fail):
            try:authority.qualify_held(cache,object(),'fixture')
            except BaseException as error:outer=error
            else:raise AssertionError('genuine qualifier unexpectedly accepted')
        self.assertIs(cache._sql_child,original)
        self.assertIsNone(sys.gettrace());self.assertIsNone(sys.getprofile())
        return outer,cache,original_inner

    def test_actual_production_facade_reproduces_frozen_v1_refusal(self):
        error,cache,inner=self.failed()
        with self.assertRaisesRegex(RuntimeError,'genuine_complete_CONT5_qualifier_code_and_namespace'):
            self.base.Witness(error,self.facade)
        self.assertIs(cache.continuation_authority,self.facade)
        self.assertEqual(str(error),'complete_actual_held_callback_then_refused_COMMIT_ACK_required')

    def test_new_witness_matches_real_facade_composition_and_same_inner_object(self):
        error,cache,inner=self.failed();code=self.namespace._qualify_held.__code__
        witness=m.Witness(error,self.facade);value=witness.snapshot()
        self.assertIs(witness.inner_error,inner);self.assertTrue(value['actualQualifierFrameMatched'])
        self.assertTrue(value['authorityFacadeUsed']);self.assertEqual(value['format'],m.FORMAT)
        self.assertIs(cache.continuation_authority,self.facade);self.assertIs(self.facade._qualify_held.__code__,code)
        self.assertFalse(value['originalV1WitnessPassed']);self.assertFalse(value['liveTraceInstalled'])
        self.assertFalse(value['liveProfileInstalled']);self.assertFalse(value['sourceOrMetadataQualified'])
        self.assertIn('actual_full_source_refusal_IO_fixture',value['innerErrorTraceback'])

    def test_complete_original_namespace_route_remains_supported(self):
        error,cache,inner=self.failed(self.namespace)
        witness=m.Witness(error,self.namespace)
        self.assertIs(witness.inner_error,inner);self.assertFalse(witness.snapshot()['authorityFacadeUsed'])
        self.assertIs(cache.continuation_authority,self.namespace)

    def test_source_facade_function_identity_and_export_mutations_refuse(self):
        error,cache,inner=self.failed()
        for field,value in [('FILE',Path('/foreign')),('SOURCE_PINS',{})]:
            with patch.object(self.facade,field,value),self.assertRaises(RuntimeError):m.Witness(error,self.facade)
        for field in ['composition','__getattr__']:
            with patch.object(self.facade,field,lambda *_:self.namespace),self.assertRaises(RuntimeError):m.Witness(error,self.facade)
        code=self.namespace._qualify_held
        with patch.object(self.namespace,'_qualify_held',lambda *_:None),self.assertRaises(RuntimeError):m.Witness(error,self.facade)
        self.assertIs(self.namespace._qualify_held,code)
        with patch.object(m,'public',side_effect=RuntimeError('changed_actual_source_IO_fixture')):
            with self.assertRaisesRegex(RuntimeError,'changed_actual_source'):m.Witness(error,self.facade)

    def test_old_frame_cannot_be_adopted_after_facade_implementation_changes(self):
        error,cache,inner=self.failed()
        other=m.reference_facade(self.base).composition()
        with patch.object(self.facade,'_implementation',other):
            witness=m.Witness(error,self.facade)
        self.assertFalse(witness.snapshot()['actualQualifierFrameMatched']);self.assertIsNone(witness.inner_error)

    def test_actual_genuine_qualifier_without_caught_inner_error_stays_absent(self):
        error,cache,inner=self.failed(no_inner=True);witness=m.Witness(error,self.facade)
        self.assertTrue(witness.snapshot()['actualQualifierFrameMatched']);self.assertIsNone(witness.inner_error)
        self.assertFalse(witness.snapshot()['caughtInnerErrorObserved'])

    def test_actual_cache_facade_binding_is_never_substituted(self):
        error,cache,inner=self.failed();cache.continuation_authority=self.namespace
        with self.assertRaisesRegex(RuntimeError,'actual_cache_bound'):m.Witness(error,self.facade)

    def test_unknown_outer_error_is_explicit_absence_and_keeps_existing_observers(self):
        try:raise RuntimeError('original_other_failure_IO_fixture')
        except RuntimeError as error:
            trace=lambda *_:None;profile=lambda *_:None;sys.settrace(trace);sys.setprofile(profile)
            try:
                witness=m.Witness(error,self.facade);self.assertIs(sys.gettrace(),trace);self.assertIs(sys.getprofile(),profile)
            finally:sys.settrace(None);sys.setprofile(None)
        self.assertFalse(witness.snapshot()['actualQualifierFrameMatched']);self.assertIsNone(witness.inner_error)

    def test_no_business_or_transport_is_reentered_after_original_failure(self):
        error,cache,inner=self.failed();forbidden=Mock(side_effect=AssertionError('no reentry'))
        with patch.object(cache,'sql_child',forbidden),patch.object(self.namespace,'original_catalog',forbidden),\
            patch.object(self.namespace,'stopped',forbidden):m.Witness(error,self.facade).snapshot()
        forbidden.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
