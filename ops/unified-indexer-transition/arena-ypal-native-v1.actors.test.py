#!/usr/bin/env python3
"""Synthetic manager/proc observations and real exclusive private audit files."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def module(name):
    p=HERE/name;m=types.ModuleType(p.stem);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
m=module('arena-ypal-native-v1.actors.py')
proposal=json.loads((HERE/'arena-ypal-native-v1.proposal.json').read_bytes())
official=module('arena-owner-migration-v11.py')

class Fixture:
    def __init__(self,root):
        self.root=root;self.prior=copy.deepcopy(proposal['current']['actors']);self.current=copy.deepcopy(self.prior);self.managers={};self.observations=[]
        for i,(unit,value)in enumerate(self.current.items()):
            if i in [1,2,3,4,7]:value['invocation']=str(i)*32;value['process']['pid']=990001+i;value['process']['startTicks']+=1000000
            tick=value['process']['startTicks']*(1000000//os.sysconf('SC_CLK_TCK'))
            self.managers[unit]={'NRestarts':'23','ExecMainStartTimestampMonotonic':str(tick+5000),'ActiveEnterTimestampMonotonic':str(tick+6000),'Result':'success','ExecMainCode':'0','ExecMainStatus':'0'}
        self.private=root/'retained.env';self.private.write_bytes(b'SYNTHETIC_RETAINED_ONLY=fixture\n');self.private.chmod(0o600)
        self.binding={'privateInputHashes':{str(self.private):m.sha(self.private.read_bytes())}}
        self.base={'services':[{'unit':u}for u in self.prior]};self.restored={'originalActors':self.prior}
        self.r=types.SimpleNamespace(no_jobs=self.no_jobs,graph=lambda *a,**kw:proposal['current']['definitions'],props=self.props,RESULT_SHA=proposal['current']['ownerResultSha256'],OWNER_REVIEW=proposal['current']['ownerReviewHash'])
        self.o=types.SimpleNamespace(read=lambda p,*a,**kw:(p.read_bytes(),None))
        self.owner=types.SimpleNamespace(run=self.run,verify_inputs=official.verify_inputs,process_identity=self.identity)
        self.owner_tuple=(None,self.r,self.owner,self.o,proposal,self.binding,self.base,self.restored)
    def no_jobs(self,_):self.observations.append('no-jobs')
    def props(self,_,unit):return {'MainPID':str(self.current[unit]['process']['pid']),'InvocationID':self.current[unit]['invocation'],'ActiveState':'active','SubState':'running','Restart':'on-failure','KillMode':'control-group'}
    def identity(self,props,row):self.observations.append(('official-identity-seam',row['unit']));return copy.deepcopy(self.current[row['unit']]['process'])
    def run(self,argv,**kw):
        assert argv[:3]==['/usr/bin/systemctl','show','--all'];unit=argv[3]
        return ''.join(k+'='+v+'\n'for k,v in self.managers[unit].items()).encode()

class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='arena-actor-',dir=HERE);self.root=Path(self.tmp.name);self.fixture=Fixture(self.root)
        self.addCleanup(self.tmp.cleanup)
        self.bind(m,'core',lambda:self.fixture.owner_tuple);self.bind(m,'boot',lambda:'synthetic-current-boot');self.bind(m.time,'sleep',lambda _:None)
        self.bind(m,'BASE',self.root/'ack');self.bind(m,'RESULT',m.BASE/'result.json')
    def bind(self,target,key,value):
        p=patch.object(target,key,value);p.start();self.addCleanup(p.stop)
    def review(self):return m.review()
    def capture(self):
        value=self.review();return m.capture(value,m.sha(m.encoded(value)))
    def test_two_real_snapshot_calls_stable_eight_and_summary_only(self):
        value=self.review();self.assertEqual(len(value['snapshot']['actors']),8)
        summary=m.summary(value);self.assertEqual(summary['unchangedActors'],3);self.assertEqual(summary['restartedActors'],5)
        self.assertEqual(sum(isinstance(x,tuple)for x in self.fixture.observations),16)
        self.assertNotIn('snapshot',summary);self.assertNotIn('privateInputHashes',summary);self.assertFalse(m.BASE.exists())
    def test_actor_change_between_two_snapshots_refuses_without_file_write(self):
        unit=next(iter(self.fixture.current))
        def changed(_):
            self.fixture.current[unit]['invocation']='a'*32;self.fixture.current[unit]['process']['pid']=999991;self.fixture.current[unit]['process']['startTicks']+=2000000
            t=self.fixture.current[unit]['process']['startTicks']*10000;self.fixture.managers[unit].update(ExecMainStartTimestampMonotonic=str(t+5000),ActiveEnterTimestampMonotonic=str(t+6000))
        self.bind(m.time,'sleep',changed)
        with self.assertRaisesRegex(RuntimeError,'stable_across_two'):self.review()
        self.assertFalse(m.BASE.exists())
    def test_kernel_manager_start_alignment_and_nonpositive_restart_refuse(self):
        unit=next(u for u in self.fixture.current if self.fixture.current[u]!=self.fixture.prior[u]);prior=self.fixture.prior[unit];current=self.fixture.current[unit];props=self.fixture.props(None,unit);manager=self.fixture.managers[unit]
        for change in [{'NRestarts':'0'},{'ExecMainStartTimestampMonotonic':'1'},{'ActiveEnterTimestampMonotonic':'1'}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.qualify_actor(prior,current,props,{**manager,**change},False)
    def test_old_pid_reuse_or_same_pid_new_invocation_refuses(self):
        unit=next(u for u in self.fixture.current if self.fixture.current[u]!=self.fixture.prior[u]);p=self.fixture.prior[unit];c=self.fixture.current[unit]
        with self.assertRaisesRegex(RuntimeError,'only_proven_newer'):m.qualify_actor(p,c,self.fixture.props(None,unit),self.fixture.managers[unit],True)
        bad=copy.deepcopy(c);bad['process']['pid']=p['process']['pid']
        with self.assertRaises(RuntimeError):m.qualify_actor(p,bad,self.fixture.props(None,unit),self.fixture.managers[unit],False)
    def test_changed_program_private_input_definition_or_job_refuses(self):
        unit=next(iter(self.fixture.current));self.fixture.current[unit]['process']['argvSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'argv_must_not_change'):self.review()
        self.fixture.current[unit]=copy.deepcopy(self.fixture.prior[unit]);self.fixture.private.write_text('CHANGED_SYNTHETIC=fixture\n')
        with self.assertRaisesRegex(RuntimeError,'private_configuration'):self.review()
        self.fixture.private.write_bytes(b'SYNTHETIC_RETAINED_ONLY=fixture\n');self.fixture.r.graph=lambda *a,**kw:{}
        with self.assertRaisesRegex(RuntimeError,'definition_and_environment'):self.review()
        self.fixture.r.graph=lambda *a,**kw:proposal['current']['definitions'];self.fixture.r.no_jobs=lambda _:(_ for _ in()).throw(RuntimeError('manager-job'))
        with self.assertRaisesRegex(RuntimeError,'manager-job'):self.review()
    def test_no_retained_boot_anchor_refuses(self):
        for i,(u,c)in enumerate(self.fixture.current.items()):
            if c==self.fixture.prior[u]:
                c['invocation']=('abcdef0123456789'[i])*32;c['process']['pid']=999900+i;c['process']['startTicks']+=1000000
                t=c['process']['startTicks']*10000;self.fixture.managers[u].update(ExecMainStartTimestampMonotonic=str(t+5000),ActiveEnterTimestampMonotonic=str(t+6000))
        with self.assertRaisesRegex(RuntimeError,'same_boot_actor_anchor'):self.review()
    def test_exclusive_private_capture_and_validate_current(self):
        result=self.capture();pin=m.sha(m.encoded(result));before=m.RESULT.read_bytes()
        self.assertEqual(m.BASE.stat().st_mode&0o777,0o700);self.assertEqual(m.RESULT.stat().st_mode&0o777,0o600)
        self.assertTrue(m.validate_current(pin)['validated']);self.assertFalse(result['historicalRestoreRewritten'])
        with self.assertRaisesRegex(RuntimeError,'exclusive'):m.capture(self.review(),m.sha(m.encoded(self.review())))
        self.assertEqual(m.RESULT.read_bytes(),before)
    def test_wrong_review_pin_and_post_ack_drift_never_capture_or_requalify(self):
        value=self.review()
        with self.assertRaisesRegex(RuntimeError,'fresh_actor_review'):m.capture(value,'f'*64)
        self.assertFalse(m.BASE.exists());result=self.capture();pin=m.sha(m.encoded(result))
        unit=next(iter(self.fixture.managers));self.fixture.managers[unit]['NRestarts']='999'
        with self.assertRaisesRegex(RuntimeError,'actor_or_static_context_changed'):m.validate_current(pin)
    def test_ack_authenticates_producer_review_and_same_boot(self):
        result=self.capture();pin=m.sha(m.encoded(result));self.bind(m,'boot',lambda:'different-boot')
        with self.assertRaisesRegex(RuntimeError,'same_boot_current_actor_ack'):m.acknowledgement(pin)
    def test_official_process_identity_executes_actual_retained_body_on_synthetic_procfs(self):
        # The frozen owner method reads this synthetic kernel shape itself;
        # UID/GID/argv/cwd/exe/cgroup guards are not reimplemented by the test.
        proc=self.root/'proc';(proc/'123').mkdir(parents=True);node=self.root/'node';node.write_text('synthetic-executable');cwd=self.root/'app';cwd.mkdir()
        p=proc/'123';(p/'status').write_text('Uid:\t971\t971\t971\t971\nGid:\t965\t965\t965\t965\n');(p/'cmdline').write_bytes(str(node).encode()+b'\0dist/arena-api.mjs\0')
        (p/'cwd').symlink_to(cwd);(p/'exe').symlink_to(node);fields=['0']*22;fields[19]='123456';(p/'stat').write_text('123 (node) '+' '.join(fields));(p/'cgroup').write_text('0::/system.slice/yunipals-arena-api.service\n')
        row={'unit':'yunipals-arena-api.service','WorkingDirectory':str(cwd),'execStartPublicTokens':['/usr/bin/env',str(node),'dist/arena-api.mjs']};props={'MainPID':'123','User':'synthetic','Group':'synthetic'};real=Path
        def redirected(*parts):
            q=real(*parts);return proc/q.relative_to('/proc')if str(q)=='/proc'or str(q).startswith('/proc/')else q
        with patch.object(official,'Path',redirected),patch.object(official.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=971)),patch.object(official.grp,'getgrnam',return_value=types.SimpleNamespace(gr_gid=965)):
            value=official.process_identity(props,row);self.assertEqual(value['startTicks'],123456);self.assertEqual(value['gid'],965)
            (p/'cmdline').write_bytes(b'foreign\0')
            with self.assertRaisesRegex(RuntimeError,'node_argv'):official.process_identity(props,row)

if __name__=='__main__':unittest.main(verbosity=2)
