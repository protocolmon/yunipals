"""Actual new forward identities and immutable ancestry; runtime mocks only."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
h=load('ypal-ordinary-generation-binding-v1.py')
old_owner=load('ypal-ordinary-feature-handover-bound-v1.py')
refs=load('ypal-ordinary-downstream-refs-continue-v3.py')
managed=load('ypal-ordinary-managed-handover-continue-v3.py')
arena=load('arena-ypal-ordinary-continue-v3.py')


def local(path,digest=None,maximum=4000000):
    path=HERE/Path(path).name
    if not path.exists()and path.name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/path.name
    if not path.exists()and path.name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/path.name
    raw=path.read_bytes();h.need(0<len(raw)<=maximum and(digest is None or h.sha(raw)==digest),'exact_actual_accept_forward_fixture_required');return raw


def body(fn):
    code=fn.__code__ if hasattr(fn,'__code__')else fn
    return(code.co_code,code.co_names,tuple(body(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))


class Controls(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(h,'public',side_effect=local))
        for m in [refs,managed,arena]:self.enterContext(patch.object(m,'utility',return_value=h))
        original=h.derive
        def derive(*args,**kwargs):
            value=original(*args,**kwargs)
            if Path(args[2]).name in {refs.FILE.name,managed.FILE.name,arena.FILE.name}:
                value.public=local;value.utility=lambda:h
            return value
        self.enterContext(patch.object(h,'derive',side_effect=derive))

    def test_actual_new_refs_authenticate_only_actual_accept_reader_feature_ancestry(self):
        value=refs.composition()
        p={'reader':{'resultSha256':'a'*64,'manifestSha256':refs.CODE[refs.READER_MANIFEST]},
            'feature':{'resultSha256':'b'*64,'manifestSha256':refs.CODE[refs.FEATURE_MANIFEST],'inputSha256':'c'*64,
                'producerSha256':refs.CODE[refs.FEATURE],'contextSha256':refs.CODE[refs.FEATURE_CONTEXT]}}
        self.assertEqual(value.references(p),p)
        for key in ['producerSha256','contextSha256','manifestSha256']:
            bad=copy.deepcopy(p);bad['feature'][key]='d'*64
            with self.assertRaises(RuntimeError):value.references(bad)
        self.assertEqual(value.FEATURE,refs.FEATURE);self.assertEqual(value.READER,refs.READER)

    def test_new_ref_current_and_typed_feature_business_bodies_unchanged(self):
        value=refs.composition();original=load('ypal-ordinary-downstream-refs-v1.py')
        for name in ['__init__','feature_current','retained_current']:
            self.assertEqual(body(getattr(value.Reference,name)),body(getattr(original.Reference,name)))
        constants=repr(value.Reference.continued_source.__code__.co_consts)
        self.assertIn('ypal-ordinary-managed-handover-continue-v3.py',constants)
        self.assertNotIn('ypal-ordinary-managed-handover-bound-v1.py',constants)

    def test_real_new_managed_namespace_keeps_parent317_and_all_lifecycle_effect_bodies(self):
        value=managed.composition();old=load('ypal-ordinary-managed-handover-v3.py')
        self.assertEqual(value.BASE,managed.BASE);self.assertEqual(value.FEATURE,managed.FEATURE)
        self.assertIn('continue-v3',str(managed.BASE));self.assertIn('continue-v3',str(managed.FEATURE_INPUT))
        self.assertEqual(value.FEATURE_SHA,managed.FEATURE_SHA);self.assertEqual(value.FOUNDATION_SHA,managed.FOUNDATION_SHA)
        for name,fn in old.Owner.__dict__.items():
            if hasattr(fn,'__code__')and name not in {'__init__','preserved','stable'}:
                self.assertEqual(body(getattr(value.Owner,name)),body(fn),name)
        self.assertIn('parent_phase',repr(value.Owner.stable.__code__.co_freevars))

    def test_new_managed_input_is_exact_and_matches_real_new_feature_producer(self):
        value=managed.composition()
        p={'format':managed.FORMAT+'-feature-input','foundationInputSha256':'a'*64,
            'publicationRefs':{'reader':{'resultSha256':'b'*64,'manifestSha256':refs.CODE[refs.READER_MANIFEST]},
                'feature':{'resultSha256':'c'*64,'inputSha256':'d'*64,'manifestSha256':refs.CODE[refs.FEATURE_MANIFEST],
                    'producerSha256':refs.CODE[refs.FEATURE],'contextSha256':refs.CODE[refs.FEATURE_CONTEXT]}}}
        # Only the authenticated module-loading boundary is replaced; the
        # original exact feature_configuration body executes in new globals.
        real=value.feature_configuration.__globals__['refs_module']
        value.feature_configuration.__globals__['refs_module']=lambda:refs.composition()
        try:
            result=value.feature_configuration(p,'a'*64);self.assertEqual(result['feature']['retirementSha256'],'c'*64)
            with self.assertRaises(RuntimeError):value.feature_configuration({**p,'foundationInputSha256':'e'*64},'a'*64)
        finally:value.feature_configuration.__globals__['refs_module']=real

    def test_real_new_Arena_namespace_retains_e6bc_ad024_and_all_eight_worker_effects(self):
        value=arena.composition();value.protected=local
        current=value.namespace()
        original=load('arena-ypal-ordinary-v1.py')
        with patch.object(original,'protected',side_effect=local):previous=original.namespace()
        self.assertEqual(value.FORMAT,arena.FORMAT);self.assertEqual(value.BASE,arena.BASE)
        self.assertEqual(arena.OBSERVATIONS.name,'yunipals-arena-ypal-ordinary-continue-review-v3-20261025')
        self.assertEqual(value.OBSERVATIONS,arena.OBSERVATIONS)
        for name,fn in previous.Host.__dict__.items():
            if hasattr(fn,'__code__')and name not in {'__init__','normal'}:self.assertEqual(body(getattr(current.Host,name)),body(fn),name)
        self.assertEqual(current.installer.ARTIFACT,'e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234')
        self.assertEqual(arena.INSTALL_ACK,'ad024517f4ae8e348382cea0f589b4c432eaf4261797048cba5c66b676dabe84')
        self.assertEqual(current.SOURCE,'264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24')

    def test_actual_new_source_manifests_are_finite_and_have_no_current_owner_backedge(self):
        source=load('ypal-ordinary-managed-continue-v3-manifest.py').build(HERE)
        self.assertEqual(source['files'],{managed.FILE.name:h.sha(local(managed.FILE)),**managed.SOURCE_PINS})
        self.assertLess(len(source['files']),513)
        manifest=load('arena-ypal-ordinary-continue-v3-manifest.py').build(HERE)
        value=arena.composition();value.protected=local;value.__file__=str(HERE/arena.FILE.name)
        self.assertEqual(value.code_manifest(),manifest);self.assertEqual(len(manifest['files']),20)
        self.assertEqual(manifest['authority']['sourceKind'],'typed-current-epoch')

    def test_actual_Arena_CLI_retains_explicit_protected_continuation_before_effect_dispatch(self):
        value=arena.composed();original=load('arena-ypal-ordinary-bound-v1.py')
        # The CLI body remains exact; only its new reference filename changes.
        self.assertEqual(value.main.__code__.co_code,original.main.__code__.co_code)
        continued={'mode':'restored','refs':{key:char*64 for key,char in zip(
            ['resultSha256','inputSha256','featureInputSha256','producerSha256','manifestSha256'],'abcde')}}
        calls=[]
        value.public=lambda path,digest,maximum:(calls.append((path,digest,maximum))or json.dumps(continued).encode())
        value.module=lambda name:refs.composition()
        value.composition=lambda current:(calls.append(current)or types.SimpleNamespace(main=lambda:calls.append('dispatch')))
        with patch('sys.argv',[str(arena.FILE),'--review','--source-continuation-sha256','f'*64]):value.main()
        self.assertEqual(calls[0],(arena.SOURCE_CONTINUATION,'f'*64,150000))
        self.assertEqual(calls[1:], [continued,'dispatch'])


if __name__=='__main__':unittest.main()
