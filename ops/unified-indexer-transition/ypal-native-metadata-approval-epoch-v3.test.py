#!/usr/bin/env python3
"""Stable actor authorization keeps fresh positive owned-session evidence."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
owner=load('ypal-native-metadata-approval-epoch-v3.py')
fixture=load('ypal-native-metadata-approval-epoch-v2.test.py')
prior=fixture.namespace
read_bytes=Path.read_bytes
def actual_bytes(path):
    return read_bytes(HERE/path.name)if path==owner.FILE else read_bytes(path)
def public(path,digest=None):
    path=HERE/Path(path).name
    if not path.exists()and path.name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/path.name
    if not path.exists()and path.name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/path.name
    raw=read_bytes(path);owner.need(digest is None or owner.sha(raw)==digest,'actual_local_epoch3_source_required');return raw
with patch.object(owner,'authenticate',lambda:None),patch.object(owner,'public',public),patch.object(Path,'read_bytes',actual_bytes):
    namespace=owner.composition()
namespace.__file__=str(HERE/owner.FILE.name)
fixture.namespace=namespace;fixture.retained.m=namespace;fixture.owner=owner

class RetainedControls(fixture.RetainedControls):
    def test_final_stop_requires_fresh_positive_owned_mapping(self):
        self.arm();self.ctx.host.sessions=lambda actor:{'owned':[],'otherPeers':[]}
        with self.assertRaisesRegex(RuntimeError,'same_selected'):namespace.Context.manager(self.ctx,'stop',self.current,self.sessions)
        self.assertEqual(self.manager,[])
    def test_every_real_review_still_requires_positive_owned_kernel_mapping(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix='epoch3-review-control-')as folder:
            self.ctx.meta.BASE=Path(folder)/'historical';self.ctx.current_old=lambda:self.old
            self.ctx.full_source=lambda:{'fixtureFreshSource':True}
            self.ctx.host.database=lambda:{'scan':{'ingestion_mode':'native','cursor':'frozen'}}
            with patch.object(namespace,'BASE',Path(folder)/'new-operation'):
                self.assertTrue(self.ctx.review()['sessions']['owned'])
                self.ctx.host.sessions=lambda actor:{'owned':[],'otherPeers':[]}
                with self.assertRaisesRegex(RuntimeError,'positive_kernel'):self.ctx.review()

class AuthorizationControls(unittest.TestCase):
    binding=fixture.AuthorizationControls.binding
    def test_owned_population_and_unrelated_peers_can_both_churn(self):
        initial=self.binding();changed=copy.deepcopy(initial)
        changed['sessions']={'owned':[{'pid':14,'backendStart':'new-owned-epoch'},{'pid':15,'backendStart':'pool-growth'}],
            'otherPeers':[{'pid':16,'backendStart':'unrelated-new'}]}
        self.assertEqual(owner.review_hash(initial),owner.review_hash(changed))
        self.assertEqual(initial['sessions']['owned'][0]['pid'],4)
    def test_zero_owned_extra_fields_or_nonlist_proof_refuses(self):
        for sessions in [{'owned':[],'otherPeers':[]},{'owned':[{}],'otherPeers':[],'extra':True},
                {'owned':None,'otherPeers':[]},{'owned':[{}],'otherPeers':None}]:
            with self.assertRaises(RuntimeError):owner.review_hash({'sessions':sessions})
    def test_all_stable_actor_private_source_scan_boot_fields_bind(self):
        initial=self.binding();initial['config']['privateInputsSha256']='a'*64
        for key in initial:
            if key=='sessions':continue
            changed=copy.deepcopy(initial);changed[key]={'changed':True}
            self.assertNotEqual(owner.review_hash(initial),owner.review_hash(changed),key)
        private=copy.deepcopy(initial);private['config']['privateInputsSha256']='b'*64
        self.assertNotEqual(owner.review_hash(initial),owner.review_hash(private))
    def test_all_retained_actor_effect_and_ack_methods_are_exact(self):
        for name,fn in prior.Context.__dict__.items():
            if hasattr(fn,'__code__')and name!='inverse_source':
                self.assertEqual(fixture.body(getattr(namespace.Context,name)),fixture.body(fn),name)
        for name in ['configuration','history','render_input','actor_function','strip_refresh','acknowledgement',
                'actor_current','inverse_acknowledgement','restored_actor_current','transition_lock']:
            self.assertEqual(fixture.body(getattr(namespace,name)),fixture.body(getattr(prior,name)),name)
    def test_inverse_catalog_only_reader_identity_changes(self):
        self.assertEqual(namespace.INVERSE_READER,'ypal-ordinary-reader-continue-v3.py')
        before=prior.Context.inverse_source.__code__;after=namespace.Context.inverse_source.__code__
        self.assertEqual(before.co_code,after.co_code);self.assertEqual(before.co_names,after.co_names)
        expected=tuple('yunipals-ypal-ordinary-reader-continue-v3-source'if value=='yunipals-ypal-ordinary-reader-continue-v2-source'else value for value in before.co_consts)
        self.assertEqual(after.co_consts,expected)
    def test_new_domain_paths_and_actual_artifact_remain_explicit(self):
        for name in ['FILE','FORMAT','BASE','INPUT','INVERSE_INPUT','DROP','MANIFEST']:
            self.assertEqual(getattr(namespace,name),getattr(owner,name));self.assertNotEqual(getattr(namespace,name),getattr(prior,name))
        self.assertEqual(namespace.ARTIFACT,prior.ARTIFACT);self.assertEqual(namespace.INSTALL_SHA,prior.INSTALL_SHA)
    def test_real_upgrade_accepts_pool_churn_and_stores_complete_new_observation(self):
        binding=self.binding();expected=owner.review_hash(binding)
        binding['sessions']={'owned':[{'pid':40,'backendStart':'fresh-positive-owned'}],'otherPeers':[{'pid':50,'backendStart':'fresh-other'}]}
        with tempfile.TemporaryDirectory(dir=HERE,prefix='epoch3-upgrade-control-')as folder:
            base=Path(folder)/'operation';ctx=namespace.Context.__new__(namespace.Context);ctx.review=lambda:copy.deepcopy(binding)
            ctx.config={'actual':'config'};ctx.input_sha='b'*64;ctx.selected={'nativeActor':{'historical':True},'boot':binding['boot']}
            ctx.host=types.SimpleNamespace(s=types.SimpleNamespace(boot=lambda:'boot'));calls=[]
            ctx.step=lambda name,action:(calls.append(name)or {'started':True});ctx.accept=lambda started,inverse:{'observed':started}
            with patch.object(namespace,'BASE',base):ctx.upgrade(expected);saved=namespace.document('operation.json')
            self.assertEqual(saved['reviewBinding']['sessions'],binding['sessions']);self.assertEqual(saved['reviewHash'],expected)
            self.assertEqual(calls,['old-stop','overlay-publish','new-reload','new-start'])
    def test_real_upgrade_stable_actor_source_or_private_drift_refuses_before_effects(self):
        initial=self.binding();expected=owner.review_hash(initial)
        with tempfile.TemporaryDirectory(dir=HERE,prefix='epoch3-refusal-control-')as folder:
            base=Path(folder)/'operation';ctx=namespace.Context.__new__(namespace.Context)
            for key in ['actor','source','config','state','scan','boot','overlaySha256']:
                changed=copy.deepcopy(initial);changed[key]={'foreign':True};ctx.review=lambda:changed
                with patch.object(namespace,'BASE',base),self.assertRaisesRegex(RuntimeError,'same_fresh_actual'):ctx.upgrade(expected)
                self.assertFalse(base.exists())

if __name__=='__main__':unittest.main()
