"""Synthetic manager plus real exclusive journals; no host/provider activity."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent

def load(path):
    spec=importlib.util.spec_from_file_location(Path(path).stem,path);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n);return n
m=load(HERE/'ypal-ordinary-observer-retained-prefix-v1.py')

def old_namespace():
    previous=load(HERE/m.PREVIOUS.name)
    raw=(HERE/m.FROZEN.name).read_bytes()
    with patch.object(previous,'frozen',return_value=raw):return previous.namespace()


def identity(p):
    s=Path(p).lstat();return {k:getattr(s,k)for k in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink']}


class FakeOwner(m.Owner):
    def __init__(self,root):
        self.input_sha='1'*64;self.config={'format':m.FORMAT+'-input','predecessorObserverSha256':'2'*64,'installationReceiptSha256':'3'*64,'ordinaryRuntime':{'resultSha256':'4'*64,'inputSha256':'5'*64}}
        self.state_value={'MainPID':'9999991','ControlPID':'0','Job':'','ActiveState':'active','SubState':'running','InvocationID':'a'*32,'ExecMainStartTimestampMonotonic':'10','DropInPaths':''}
        self.current_mode='old';self.actions=[];self.fail=None;self.terminal_checks=0;self.input_changed=False
        self.source_value={'release':'same-source','actor':'same-source-actor'}
        self.old_actor={'unit':'synthetic-observer.service','pid':9999991,'invocation':'a'*32,'startMonotonicUs':10}
        unit=root/'original.service';unit.write_text('same original unit');os.chmod(unit,0o644)
        old_base=root/'old-journal';old_base.mkdir(mode=0o700)
        (old_base/'unit-installed.json').write_bytes(m.encoded({'identity':identity(unit)}))
        self.old=types.SimpleNamespace(RELEASE='fixture-release',UNIT='synthetic-observer.service',UNIT_FILE=unit,BASE=old_base,TEMPLATE_SHA=m.sha(unit.read_bytes()),
          protected=lambda p:Path(p).read_bytes(),document=lambda p:json.loads(Path(p).read_bytes()),identity=identity,
          boot=lambda:'boot',mono=lambda:1000,check_boot=lambda _:None,first_cycle_complete=lambda *args:True,time=types.SimpleNamespace(monotonic=lambda:1,sleep=lambda _:None))
        def old_live(h,value):
            m.need(self.current_mode=='old'and self.state_value['ActiveState']=='active','same_original_live_required');return copy.deepcopy(self.old_actor)
        def old_terminal(h,value,actor):
            m.need(self.state_value['ActiveState']=='inactive'and actor==self.old_actor,'same_original_terminal_required');self.terminal_checks+=1
        self.old.live=old_live;self.old.terminal=old_terminal
        self.previous=types.SimpleNamespace(validate_current=lambda _: {'actor':old_live(None,None),'bootLink':{'inode':'original-boot'}})
        self.h=types.SimpleNamespace(state=lambda:copy.deepcopy(self.state_value),control=lambda:[{'chainId':c,'revision':'10','ageMs':1}for c in [1,56,137,8453]],capacity=lambda:{'sufficient':True})
        self.old_value={'binding':{'preserved':{}}};self.old_result={}
        self.drop=b'[Service]\nExecStart=\nExecStart=/fixed/new worker\n'
    def installed(self):return {'artifact':'new-exact'}
    def source(self):return copy.deepcopy(self.source_value)
    def preserved(self):return {'source':{'dataIdentity':{'native':'same44','sourceRelease':self.old.RELEASE}},'installation':self.installed(),'old':not self.input_changed}
    def manager(self,action):
        self.actions.append(action)
        if self.fail=='before-'+action:raise RuntimeError('unknown_manager_ACK')
        if action=='stop':self.state_value.update(MainPID='0',ActiveState='inactive',SubState='dead')
        if action=='daemon-reload':
            self.current_mode='new'if os.path.lexists(m.DROP)else'old';self.state_value['DropInPaths']=str(m.DROP)if self.current_mode=='new'else''
        if action=='start':
            self.state_value.update(MainPID='9999992'if self.current_mode=='new'else'9999993',InvocationID=('b'if self.current_mode=='new'else'c')*32,
              ExecMainStartTimestampMonotonic='1001',ActiveState='active',SubState='running')
        if self.fail=='after-'+action:raise RuntimeError('unknown_manager_ACK')
    def live(self,mode):
        self.start_record(mode);self.static(mode)
        m.need(self.current_mode==mode and self.state_value['ActiveState']=='active','exact_live_mode_required')
        return {'unit':'synthetic-observer.service','pid':int(self.state_value['MainPID']),'invocation':self.state_value['InvocationID'],
          'startMonotonicUs':int(self.state_value['ExecMainStartTimestampMonotonic'])}
    def inspect(self,mode):return {'event':'combined_observer_inspected','running':True,'providerCalls':0,'writes':0}


class Controls(unittest.TestCase):
    def fixture(self):
        temp=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(temp.cleanup);root=Path(temp.name)
        a=patch.object(m,'BASE',root/'new-journal');a.start();self.addCleanup(a.stop)
        b=patch.object(m,'DROP',root/'original.service.d'/'90-retained-prefix-v1.conf');b.start();self.addCleanup(b.stop)
        return FakeOwner(root)
    def test_static_default_and_exact_fixed_old_sources(self):
        out=subprocess.run(['/usr/bin/python3','-I','-B',m.__file__],capture_output=True,check=True)
        self.assertTrue(json.loads(out.stdout)['staticOnly'])
        for file,pin in [(m.PREVIOUS,m.PREVIOUS_SHA),(m.FROZEN,m.FROZEN_SHA),(m.INSTALLER,m.INSTALLER_SHA),(m.INTAKE,m.INTAKE_SHA)]:self.assertEqual(m.sha((HERE/file.name).read_bytes()),pin)
    def test_no_missing_or_extra_configuration_fields(self):
        h=self.fixture();self.assertEqual(m.configuration(h.config),h.config)
        for v in [{**h.config,'arbitraryEntry':'elsewhere'},{**h.config,'installationReceiptSha256':None},{**h.config,'ordinaryRuntime':{'resultSha256':'0'*64}}]:self.assertRaises(RuntimeError,m.configuration,v)
    def test_review_stable_control_observations_and_source_identity_sensitive(self):
        h=self.fixture();first=m.review(h);h.h.control=lambda:[];second=m.review(h)
        self.assertEqual(first['reviewHash'],second['reviewHash']);self.assertNotEqual(first['controlObservation'],second['controlObservation'])
        h.source_value['actor']='other';self.assertNotEqual(first['reviewHash'],m.review(h)['reviewHash'])
    def test_real_frozen_loaded_checks_only_owned_drop_field_changes(self):
        h=self.fixture();original=old_namespace();h.previous=types.SimpleNamespace(namespace=old_namespace)
        h.old_value={};h.before=lambda:{'review':{'binding':{}}}
        original_protected=original.protected
        def local(path,*args):return (HERE/m.FROZEN.name).read_bytes()if Path(path)==m.FROZEN else original_protected(path,*args)
        def ns():
            value=old_namespace();value.protected=local;return value
        h.previous.namespace=ns;h.original_command=['old'];h.new_command=['new'];h.environment={'public':'same'}
        first=h.scope('new');last=h.scope('old')
        self.assertEqual(first.live.__code__.co_code,original.live.__code__.co_code)
        self.assertEqual(first.terminal.__code__.co_code,original.terminal.__code__.co_code)
        self.assertEqual(last.unit_definition.__code__.co_code,original.unit_definition.__code__.co_code)
        self.assertIn(str(m.DROP),first.unit_definition.__code__.co_consts)
        self.assertEqual(first.command(),(['new'],h.environment));self.assertEqual(last.command(),(['old'],h.environment))
    def test_actual_apply_one_old_stop_one_new_start_and_immutable_old_unit(self):
        h=self.fixture();before=h.old.UNIT_FILE.read_bytes();original_inode=identity(h.old.UNIT_FILE);r=m.review(h)
        result=m.apply(h,r['reviewHash'])
        self.assertEqual(h.actions,['stop','daemon-reload','start']);self.assertEqual(result['mode'],'new');self.assertFalse(result['paidAuthority'])
        self.assertEqual(h.old.UNIT_FILE.read_bytes(),before);self.assertEqual(identity(h.old.UNIT_FILE),original_inode)
        self.assertEqual(m.record('apply-intent.json')['review']['binding'],r['binding'])
        self.assertEqual(result['receiptSha256'],m.sha(m.protected(m.BASE/'result.json')))
        self.assertEqual(m.DROP.read_bytes(),h.drop);self.assertEqual(m.DROP.stat().st_mode&0o777,0o600)
        self.assertRaises(RuntimeError,m.apply,h,r['reviewHash'])
    def test_stale_review_refuses_before_any_attempt_or_service(self):
        h=self.fixture();r=m.review(h);h.source_value['actor']='different'
        self.assertRaises(RuntimeError,m.apply,h,r['reviewHash']);self.assertEqual(h.actions,[]);self.assertFalse(m.BASE.exists())
    def test_lost_start_ACK_reconciles_exact_new_actor_without_manager_retry(self):
        h=self.fixture();h.fail='after-start';r=m.review(h)
        self.assertRaises(RuntimeError,m.apply,h,r['reviewHash']);self.assertFalse((m.BASE/'result.json').exists())
        self.assertTrue((m.BASE/'start-intent.json').exists());h.fail=None;before=list(h.actions)
        result=m.acknowledge(h,'new');self.assertEqual(h.actions,before);self.assertEqual(result['mode'],'new')
        self.assertEqual(m.acknowledge(h,'new'),result);self.assertEqual(h.actions,before)
    def test_unknown_old_stop_is_not_reissued_by_apply(self):
        h=self.fixture();h.fail='after-stop';r=m.review(h)
        self.assertRaises(RuntimeError,m.apply,h,r['reviewHash']);self.assertEqual(h.actions,['stop'])
        self.assertRaises(RuntimeError,m.apply,h,r['reviewHash']);self.assertFalse((m.BASE/'start-intent.json').exists())
        h.fail=None;pin=m.sha(m.protected(m.BASE/'apply-intent.json'));result=m.inverse(h,pin)
        self.assertEqual(result['mode'],'old');self.assertEqual(h.actions,['stop','daemon-reload','start'])
    def test_full_inverse_stops_new_restores_only_drop_and_acknowledges_old_new_epoch(self):
        h=self.fixture();result=m.apply(h,m.review(h)['reviewHash']);pin=m.sha(m.protected(m.BASE/'apply-intent.json'))
        with patch.object(m,'recorded',return_value=(h,m.record('result.json'))):back=m.inverse(h,pin)
        self.assertEqual(h.actions,['stop','daemon-reload','start','stop','daemon-reload','start'])
        self.assertEqual(back['mode'],'old');self.assertNotEqual(back['actor']['invocation'],h.old_actor['invocation'])
        self.assertFalse(m.DROP.parent.exists());self.assertEqual(m.record('result.json')['actor'],result['actor'])
    def test_lost_inverse_start_ACK_finish_only_observes(self):
        h=self.fixture();m.apply(h,m.review(h)['reviewHash']);h.fail='after-start';pin=m.sha(m.protected(m.BASE/'apply-intent.json'))
        with patch.object(m,'recorded',return_value=(h,m.record('result.json'))):self.assertRaises(RuntimeError,m.inverse,h,pin)
        h.fail=None;before=list(h.actions);intent=m.sha(m.protected(m.BASE/'inverse-intent.json'))
        back=m.inverse(h,intent,True);self.assertEqual(back['mode'],'old');self.assertEqual(h.actions,before)
        self.assertEqual(m.inverse(h,intent,True),back)
    def test_unmodified_old_actor_partial_failure_inverse_does_not_restart_it(self):
        h=self.fixture();h.fail='before-stop';r=m.review(h);self.assertRaises(RuntimeError,m.apply,h,r['reviewHash'])
        h.fail=None;before=list(h.actions);back=m.inverse(h,m.sha(m.protected(m.BASE/'apply-intent.json')))
        self.assertEqual(back['mode'],'old-untouched');self.assertEqual(back['actor'],h.old_actor);self.assertEqual(h.actions,before)
    def test_failed_new_actor_still_has_owned_inverse(self):
        h=self.fixture();m.apply(h,m.review(h)['reviewHash']);h.state_value.update(MainPID='0',ActiveState='failed',SubState='failed')
        with patch.object(m,'recorded',return_value=(h,m.record('result.json'))):back=m.inverse(h,m.sha(m.protected(m.BASE/'apply-intent.json')))
        self.assertEqual(back['mode'],'old');self.assertEqual(h.actions.count('stop'),1)
    def test_foreign_drop_or_directory_is_not_removed(self):
        h=self.fixture();m.apply(h,m.review(h)['reviewHash']);(m.DROP.parent/'foreign.conf').write_text('other root action')
        with patch.object(m,'recorded',return_value=(h,m.record('result.json'))):self.assertRaises(RuntimeError,m.inverse,h,m.sha(m.protected(m.BASE/'apply-intent.json')))
        self.assertTrue((m.DROP.parent/'foreign.conf').exists());self.assertTrue(m.DROP.exists());self.assertEqual(h.actions.count('start'),1)
    def test_partial_terminal_rejects_foreign_invocation_or_live_known_pid(self):
        h=self.fixture();h.fail='after-stop';self.assertRaises(RuntimeError,m.apply,h,m.review(h)['reviewHash'])
        h.state_value['InvocationID']='d'*32
        self.assertRaises(RuntimeError,m.partial_terminal,h)
        h.state_value['InvocationID']=h.old_actor['invocation'];h.old_actor['pid']=os.getpid()
        self.assertRaises(RuntimeError,m.partial_terminal,h,h.old_actor)
    def test_durable_start_window_and_no_foreign_scope(self):
        h=self.fixture();m.apply(h,m.review(h)['reviewHash']);value=m.record('start-intent.json');self.assertEqual(value['latestStartMonotonicUs']-value['earliestMonotonicUs'],135000000)
        self.assertRaises(RuntimeError,h.start_record,'foreign')
        self.assertEqual(m.BASE.stat().st_mode&0o777,0o700);self.assertEqual((m.BASE/'apply-intent.json').stat().st_mode&0o777,0o600)

    def test_real_current_and_immutable_ACK_support_forward_and_restored_epochs(self):
        h=self.fixture();result=m.apply(h,m.review(h)['reviewHash'])
        with patch.object(m,'Owner',return_value=h):
            current=m.validate_current(result['receiptSha256']);self.assertTrue(current['observerCurrentQualified']);self.assertEqual(current['releaseId'],h.old.RELEASE)
            self.assertFalse(m.acknowledgement(result['receiptSha256'])['observerCurrentQualified'])
            restored=m.inverse(h,result['receiptSha256'])
            with self.assertRaisesRegex(RuntimeError,'inverse_already_started'):m.validate_current(result['receiptSha256'])
            h.source=lambda:(_ for _ in()).throw(AssertionError('must not require obsolete source actor'))
            current=m.validate_current(restored['receiptSha256'])
            self.assertTrue(current['observerCurrentQualified']);self.assertEqual(current['mode'],'old');self.assertEqual(current['actor'],restored['actor'])
            self.assertEqual(current['releaseId'],h.old.RELEASE)

    def test_untouched_inverse_has_explicit_new_ACK_and_genuine_old_current_leaf(self):
        h=self.fixture();h.fail='before-stop';self.assertRaises(RuntimeError,m.apply,h,m.review(h)['reviewHash']);h.fail=None
        restored=m.inverse(h,m.sha(m.protected(m.BASE/'apply-intent.json')))
        with patch.object(m,'Owner',return_value=h):
            current=m.validate_current(restored['receiptSha256']);self.assertEqual(current['mode'],'old-untouched')
            self.assertEqual(current['actor'],h.old_actor);self.assertTrue(current['observerCurrentQualified'])


if __name__=='__main__':unittest.main()
