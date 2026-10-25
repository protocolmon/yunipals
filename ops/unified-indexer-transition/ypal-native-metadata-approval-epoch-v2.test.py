#!/usr/bin/env python3
"""The new authorization omits only unrelated role peers; actor effects stay exact."""
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
owner=load('ypal-native-metadata-approval-epoch-v2.py')
legacy=load('ypal-native-metadata-approval-epoch-v1.py')
retained=load('ypal-native-metadata-approval-epoch-v1.test.py')

def public(path,digest=None):
    raw=(HERE/Path(path).name).read_bytes()
    owner.need(digest is None or owner.sha(raw)==digest,'actual_local_epoch2_source_required');return raw
with patch.object(owner,'authenticate',lambda:None),patch.object(owner,'public',public):
    namespace=owner.composition()
namespace.__file__=str(HERE/owner.FILE.name)
retained.m=namespace

def body(fn):
    c=fn.__code__ if hasattr(fn,'__code__')else fn
    return(c.co_code,c.co_names,tuple(body(x)if isinstance(x,types.CodeType)else x for x in c.co_consts))

class RetainedControls(retained.Tests):
    def ack_fixture(self):
        config={'format':namespace.FORMAT+'-input',**self.ctx.config,'newInstallSha256':namespace.INSTALL_SHA};self.ctx.config=config
        self.op.update(config=config,historicalActor=self.old,historicalBoot={'inode':1})
        self.op['reviewBinding'].update(config=config,boot={'inode':1},sessions=copy.deepcopy(self.sessions))
        self.op['reviewHash']=owner.review_hash(self.op['reviewBinding'])
        (self.base/'operation.json').write_bytes(namespace.encoded(self.op))
        path=self.base/'input.json';path.write_bytes(namespace.encoded(config));path.chmod(0o600)
        self.ctx.input_sha=namespace.sha(path.read_bytes());self.op['inputSha256']=self.ctx.input_sha
        (self.base/'operation.json').write_bytes(namespace.encoded(self.op))
        self.start_chain();digest=self.ctx.accept()['receiptSha256']
        return path,digest

class AuthorizationControls(unittest.TestCase):
    def binding(self):
        return{'config':{'value':1},'actor':{'invocation':'selected'},'boot':{'inode':2},'state':{'command':'actual'},
            'scan':{'cursor':3},'source':{'frame':'qualified'},'overlaySha256':'a'*64,
            'sessions':{'owned':[{'pid':4,'backendStart':'owned-epoch'}],'otherPeers':[{'pid':5,'backendStart':'unrelated'}]}}
    def test_only_other_peers_are_excluded(self):
        initial=self.binding();changed=copy.deepcopy(initial);changed['sessions']['otherPeers']=[]
        self.assertEqual(owner.review_hash(initial),owner.review_hash(changed))
        self.assertNotEqual(initial,changed);self.assertEqual(len(initial['sessions']['otherPeers']),1)
    def test_owned_epoch_and_all_other_review_fields_still_bind(self):
        initial=self.binding()
        for key in initial:
            changed=copy.deepcopy(initial)
            if key=='sessions':changed[key]['owned'][0]['backendStart']='foreign'
            else:changed[key]={'changed':True}
            self.assertNotEqual(owner.review_hash(initial),owner.review_hash(changed),key)
    def test_positive_owned_proof_and_exact_session_shape_required(self):
        for sessions in [{'owned':[],'otherPeers':[]},{'owned':[{}],'otherPeers':[],'extra':True},{'owned':[{}],'otherPeers':None}]:
            with self.assertRaises(RuntimeError):owner.review_hash({'sessions':sessions})
    def test_actual_retained_effect_and_actor_bodies_unchanged(self):
        for name,fn in legacy.Context.__dict__.items():
            if hasattr(fn,'__code__')and name not in{'upgrade','read_operation'}:
                self.assertEqual(body(getattr(namespace.Context,name)),body(fn),name)
        for name in ['configuration','history','render_input','actor_function','strip_refresh','actor_current','inverse_acknowledgement','restored_actor_current','transition_lock']:
            self.assertEqual(body(getattr(namespace,name)),body(getattr(legacy,name)),name)
    def test_new_paths_and_domain_are_explicit(self):
        for name in ['FILE','FORMAT','BASE','INPUT','INVERSE_INPUT','DROP','MANIFEST']:
            self.assertEqual(getattr(namespace,name),getattr(owner,name));self.assertNotEqual(getattr(namespace,name),getattr(legacy,name))
        self.assertEqual(namespace.ARTIFACT,legacy.ARTIFACT);self.assertEqual(namespace.INSTALL_SHA,legacy.INSTALL_SHA)
    def test_real_upgrade_accepts_other_peer_churn_and_keeps_full_binding(self):
        binding=self.binding();expected=owner.review_hash(binding);binding['sessions']['otherPeers']=[]
        with tempfile.TemporaryDirectory(dir=HERE,prefix='epoch2-upgrade-control-')as folder:
            base=Path(folder)/'operation';ctx=namespace.Context.__new__(namespace.Context);ctx.review=lambda:copy.deepcopy(binding)
            ctx.config={'actual':'config'};ctx.input_sha='b'*64;ctx.selected={'nativeActor':{'historical':True},'boot':binding['boot']}
            ctx.host=types.SimpleNamespace(s=types.SimpleNamespace(boot=lambda:'boot'));calls=[]
            ctx.step=lambda name,action:(calls.append(name)or {'started':True});ctx.accept=lambda started,inverse:{'observed':started}
            with patch.object(namespace,'BASE',base):
                result=ctx.upgrade(expected);saved=namespace.document('operation.json')
            self.assertEqual(saved['reviewBinding']['sessions']['otherPeers'],[])
            self.assertEqual(saved['reviewHash'],expected);self.assertIn('new-start',calls);self.assertIn('observed',result)
    def test_real_upgrade_refuses_changed_owned_epoch_before_new_base_or_effects(self):
        binding=self.binding();expected=owner.review_hash(binding);binding['sessions']['owned'][0]['backendStart']='changed'
        with tempfile.TemporaryDirectory(dir=HERE,prefix='epoch2-refusal-control-')as folder:
            base=Path(folder)/'operation';ctx=namespace.Context.__new__(namespace.Context);ctx.review=lambda:binding
            with patch.object(namespace,'BASE',base),self.assertRaisesRegex(RuntimeError,'same_fresh_actual'):
                ctx.upgrade(expected)
            self.assertFalse(base.exists())

if __name__=='__main__':unittest.main()
