#!/usr/bin/env python3
"""Only new i names/pins; preserve the actual prior root rollout protocol."""
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
def load(name):
    s=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('arena-genuine-rpc-v9-rollout');old=load('arena-genuine-rpc-v8-rollout-v2')

class Tests(unittest.TestCase):
    def test_exact_reverse_to_root_executed_rollout8r2(self):
        before=Path(old.__file__).read_bytes();self.assertEqual(m.sha(before),'84219cd3ab5294afda3f34f952a99210521edf8c8a5e5dbfc8eeeeb5362a5464')
        current=Path(m.__file__).read_text()
        pairs=[('Arena-v8 review','Arena-v9 review'),('fixed_arena_v8_rollout_prerequisite_refused','fixed_arena_v9_rollout_prerequisite_refused'),
            ('yunipals-arena-genuine-v8-rollout-v2','yunipals-arena-genuine-v9-rollout-v1'),('20261021-genuine-h','20261021-genuine-i'),
            ('yunipals-arena-genuine-rpc-20261021-h.service','yunipals-arena-genuine-rpc-20261021-i.service'),
            ('arena-genuine-rpc-v8.py','arena-genuine-rpc-v9.py'),(old.HELPER_SHA,m.HELPER_SHA),('plan-genuine-h.json','plan-genuine-i.json'),(old.PLAN_SHA,m.PLAN_SHA),
            ('actual-review-v8-r2.','actual-review-v9.'),('actual-run-v8-r2.','actual-run-v9.'),
            ("'-v8-r2.stdout.json'","'-v9.stdout.json'"),("'-v8-r2.stderr.txt'","'-v9.stderr.txt'"),("'-v8-r2.'+suffix","'-v9.'+suffix"),
            ('yunipals-arena-genuine-rpc-v8','yunipals-arena-genuine-rpc-v9')]
        for before_text,after_text in reversed(pairs):current=current.replace(after_text,before_text)
        current=current.replace('yunipals-arena-genuine-v9-rollout.lock','yunipals-arena-genuine-v8-rollout-v2.lock')
        self.assertEqual(current.encode(),before)
    def test_new_helper_plan_hashes_fresh_unit_and_work(self):
        self.assertEqual(m.sha((HERE/'arena-genuine-rpc-v9.py').read_bytes()),m.HELPER_SHA)
        self.assertEqual(m.sha((HERE/'arena-genuine-rpc-v9.plan.example.json').read_bytes()),m.PLAN_SHA)
        self.assertEqual(m.WORK.name,'20261021-genuine-i');self.assertEqual(m.UNIT,'yunipals-arena-genuine-rpc-20261021-i.service')
    def test_full_sandbox_and_apply_protocol_unchanged(self):
        hidden=['/var/backups','/mnt/HC_Volume_107222036/typed-20261021-d']
        before=old.properties(hidden,'review');after=m.properties(hidden,'review')
        for key in before:
            self.assertEqual(after[key].replace('actual-review-v9.','actual-review-v8-r2.'),before[key])
        argv=m.launch_args(hidden);apply=m.apply_args(argv,'a'*64)
        self.assertNotIn('--wait',apply);self.assertEqual(apply[-2:],['--run','a'*64])
        self.assertIn(str(m.HELPER),apply);self.assertNotIn(str(old.HELPER),apply)

if __name__=='__main__':unittest.main()
