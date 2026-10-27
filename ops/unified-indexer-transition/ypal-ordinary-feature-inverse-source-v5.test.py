"""Actual complete source-facts derivation and explicit feature-phase boundaries."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def assembled(name):
    wrapper=load(name);actual_read=Path.read_bytes
    def local(path,digest=None):
        path=HERE/Path(path).name
        if not path.exists()and path.name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/path.name
        if not path.exists()and path.name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/path.name
        raw=actual_read(path);wrapper.need(digest is None or wrapper.sha(raw)==digest,'actual_local_feature_inverse3_source');return raw
    def self_read(path):return actual_read(HERE/path.name)if path==wrapper.FILE else actual_read(path)
    with patch.object(wrapper,'authenticate',lambda:None),patch.object(wrapper,'public',local),patch.object(Path,'read_bytes',self_read):
        value=wrapper.composition()
    value.__file__=str(HERE/name);wrapper.public=local
    return value

s=assembled('ypal-ordinary-feature-inverse-source-v5.py')
base_tests=load('ypal-ordinary-restored-source-prefix-v5.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.base=base_tests.Controls();self.base.setUp();self.addCleanup(self.base.doCleanups)
        self.enterContext(patch.object(s,'public',side_effect=self.public))
        self.phase={'format':'yunipals-ordinary-feature-inverse-prefix-v5','producerSha256':s.SOURCE_PINS[s.PHASE],
            'validated':True,'ownedDefinitionPrefixQualified':True,'temporarySourceActor':None,'temporarySourceKernelSessions':None,
            'fixtureActualOwnedPhase':'terminal'}
        self.fn=s.phase_source_facts(base_tests.m)

    def public(self,path,digest,maximum=4000000):
        path=Path(path);origin=HERE/path.name
        if path.name=='final-supervisor-inventory-v1.py':origin=HERE.parent/'solana-acceptance'/path.name
        if not origin.exists()and path.name=='ypal-old-runtime-inventory-v1.py':origin=HERE.parent/'booster-launch'/path.name
        raw=origin.read_bytes();s.need(0<len(raw)<=maximum and s.sha(raw)==digest,'actual_local_feature_inverse_source_fixture_required');return raw

    def facts(self):return self.fn(self.base.owner,self.base.op,self.base.inverse,self.phase)

    def test_default_inert_and_all_actual_manifest_bytes_precede_runtime(self):
        value=subprocess.run([sys.executable,'-I','-B',str(HERE/s.FILE.name)],capture_output=True,check=True)
        self.assertTrue(json.loads(value.stdout)['staticOnly']);self.assertEqual(value.stderr,b'')
        self.assertEqual(s.authenticate()['files'],{s.FILE.name:s.own_sha(),**s.SOURCE_PINS})

    def test_exact_one_FRESH_definition_seam_preserves_all_full_source_function_statements(self):
        name='ypal-ordinary-restored-source-prefix-v1.py';raw=self.public(s.OPS/name,s.SOURCE_PINS[name]);tree=ast.parse(raw)
        original=next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='source_facts')
        with patch.object(s,'evaluate',wraps=s.evaluate):derived=s.phase_source_facts(base_tests.m)
        self.assertEqual(derived.__code__.co_names,base_tests.m.source_facts.__code__.co_names)
        expected=copy.deepcopy(original);changes=0
        for node in ast.walk(expected):
            if isinstance(node,ast.If)and ast.unparse(node.test)=='unit == owner.feature_runtime.SOURCE and allowed_fresh is not None':
                node.test=ast.parse("unit == owner.feature_runtime.SOURCE and feature['ownedDefinitionPrefixQualified'] is True",mode='eval').body;changes+=1
        scope=dict(base_tests.m.__dict__)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[expected],type_ignores=[])),str(s.FILE),'exec'),scope)
        self.assertEqual(changes,1);self.assertEqual(derived.__code__.co_code,scope['source_facts'].__code__.co_code)
        self.assertEqual(derived.__code__.co_consts,scope['source_facts'].__code__.co_consts)

    def test_owned_FRESH_boot_definition_prefix_changes_only_with_typed_actual_phase(self):
        value=self.facts();self.assertEqual(set(value[1]),{'SOURCE','SOLANA'})
        self.base.peers['freshFrame']={'fixtureOwnedBootTransition':True};self.base.peers['apiFrame']={'fixtureOwnedTerminalAPI':True}
        self.facts();self.phase['producerSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'typed_owned_feature_prefix'):self.facts()

    def test_foreign_peer_private_routes_source_epoch_native_cache_and_zero_kernel_refuse(self):
        for change in [lambda:self.base.peers['og']['currentFrames'].update({'yunipals-api.service':{'foreign':True}}),
                       lambda:self.base.sourcefacts.update(inputs={'foreign':True}),
                       lambda:self.base.actor['SOURCE']['unit'].update(NRestarts='1'),
                       lambda:self.base.native.update(cache={'foreign':True})]:
            before=copy.deepcopy((self.base.peers,self.base.sourcefacts,self.base.actor,self.base.native));change()
            with self.subTest(change=change),self.assertRaises(RuntimeError):self.facts()
            self.base.peers,self.base.sourcefacts,self.base.actor,self.base.native=before
        self.base.owner.h.sessions.return_value=None
        self.base.owner.h.sessions.side_effect=lambda *_:{'73004621':{'owned':{'SOURCE':[]}}}
        with self.assertRaisesRegex(RuntimeError,'positive_actual_restored'):self.facts()

    def authority(self,started):
        root=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(root.cleanup);path=Path(root.name)
        if started:(path/'inverse-review.json').write_text('{}')
        value=s.Authority.__new__(s.Authority);value.input_sha='e'*64;value._inputs=Mock()
        value.owner=self.base.owner;value.operation=self.base.op;value.inverse=self.base.inverse
        value.config={'format':s.FORMAT+'-input','prefixInputSha256':'d'*64}
        value.initial_config=copy.deepcopy(self.base.config);value.initial_config['stage']='arena-restored'
        value.initial_config['arenaInverse']={key:'c'*64 for key in ['resultSha256','planSha256','producerSha256','manifestSha256']}
        value.feature_refs=copy.deepcopy(self.base.recorded_feature)
        value.business=types.SimpleNamespace(BASE=path);value.feature_host=object();value.feature_owner=object();value.h=object()
        value.phase=types.SimpleNamespace(validate_current_phase=Mock(side_effect=lambda *_:copy.deepcopy(self.phase)))
        value.source_facts=self.fn
        initial={'sourceOnlyCurrent':True,'currentWriterQualified':True,'managedInverseRefs':value.initial_config['managedInverse'],
            'ordinaryRuntimeAncestry':self.base.owner.bound_references.ordinary,'binding':{'actors':{unit:base_tests.f.canonical_actor(actor)
                for unit,actor in self.base.actor.items()}},'native':self.base.native,'dataIdentity':self.base.data}
        value.prefix=types.SimpleNamespace(validate_current_source=Mock(return_value=initial),arena_current=Mock(return_value={'binding':{'actualPrivateNative8':True}}))
        return value,initial

    def test_before_inverse_uses_full_frozen_prefix_without_relabelling_old_standalone(self):
        authority,_=self.authority(False);proof=authority.current()
        authority.prefix.validate_current_source.assert_called_once_with('d'*64)
        authority.phase.validate_current_phase.assert_not_called()
        self.assertEqual(proof['sourceKind'],'restored-owned-feature-inverse-prefix')
        self.assertFalse(proof['oldStandaloneSuccessClaimed']);self.assertFalse(proof['originalWholeStablePassed'])

    def test_inprogress_source_uses_actual_phase_then_full_source_kernel_with_bookends(self):
        authority,_=self.authority(True);self.phase['temporarySourceActor']={'unit':{},'processes':[{'pid':1073741700}]}
        proof=authority.current();authority.prefix.validate_current_source.assert_not_called()
        self.assertEqual(authority.phase.validate_current_phase.call_count,2);self.assertEqual(authority.prefix.arena_current.call_count,2)
        self.assertEqual(set(authority.last_actors),{'SOURCE','SOLANA','FRESH'})
        self.assertFalse(proof['sourceReadinessQualified']);self.assertFalse(proof['currentReadersQualified'])
        self.assertEqual(proof['registeredDataSha256'],self.base.data['registeredDataSha256'])

    def test_changed_feature_phase_or_Arena_inverse_binding_during_source_capture_refuses(self):
        authority,_=self.authority(True)
        authority.phase.validate_current_phase.side_effect=[self.phase,{**self.phase,'fixtureActualOwnedPhase':'changed'}]
        with self.assertRaisesRegex(RuntimeError,'phase_changed_around_complete_source'):authority.current()
        authority.phase.validate_current_phase.side_effect=lambda *_:copy.deepcopy(self.phase)
        authority.prefix.arena_current.side_effect=[{'binding':{'actual':1}},{'binding':{'actual':2}}]
        with self.assertRaisesRegex(RuntimeError,'Arena_business_inverse_changed'):authority.current()

    def test_input_contract_refuses_callbacks_unknown_stages_and_future_readiness_flags(self):
        pin=lambda value:type(value)is str and len(value)==64
        prefix=types.SimpleNamespace(pin=pin)
        for value in [{'format':s.FORMAT+'-input','prefixInputSha256':'a'*64,'sourceReady':True},
                      {'format':s.FORMAT+'-input','prefixInputSha256':'future'},
                      {'format':'foreign','prefixInputSha256':'a'*64}]:
            with self.subTest(value=value),self.assertRaises(RuntimeError):s.configuration(value,prefix)


if __name__=='__main__':unittest.main()
