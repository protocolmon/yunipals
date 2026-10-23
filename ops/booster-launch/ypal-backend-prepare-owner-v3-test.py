#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

def module(name):
    path=Path(__file__).with_name(name);spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

v3=module("ypal-backend-prepare-owner-v3.py")
fixtures=module("ypal-backend-prepare-owner-v2-test.py")

class PoolObservations(unittest.TestCase):
    def test_exact_retained_core_and_actual_new_producer(self):
        c=v3.core();self.assertEqual(c.__file__,str(Path(__file__).with_name("ypal-backend-prepare-owner-v3.py").absolute()));self.assertEqual(c.PHASES,("prepare",))

    def test_old_and_combined_pool_churn_no_longer_changes_review_hash(self):
        c=v3.core();a=fixtures.snapshot();b=copy.deepcopy(a)
        b["source"]["sessionAttribution"].update(oldBackends=[{"pid":8,"backendStart":"reconnected"}],combinedBackends=[{"pid":9,"backendStart":"new"}],sourceRoleBackendCount=99)
        self.assertEqual(c.sha(c.encoded(c.stable_snapshot(a))),c.sha(c.encoded(c.stable_snapshot(b))))
        self.assertIn("oldBackends",a["source"]["sessionAttribution"])

    def test_actors_roles_schema_source_and_private_inputs_are_never_normalized(self):
        c=v3.core();a=fixtures.snapshot();a["source"]["unit"]={"definition":"fixed"};baseline=c.stable_snapshot(a)
        for change in [lambda v:v["source"]["actor"].update(pid=999),lambda v:v["roles"]["collector"].update(connectionLimit=7),lambda v:v["nativeOld"].update(schemaOid="wrong"),lambda v:v["privateInputHashes"].update(file="changed"),lambda v:v["source"]["unit"].update(definition="changed")]:
            b=copy.deepcopy(a);change(b);self.assertNotEqual(c.stable_snapshot(b),baseline)

    def test_complete_kernel_attribution_still_required_for_every_hash(self):
        c=v3.core()
        for key,value in [("complete",False),("applicationNameOrAgeInference",True),("sharedRoleZeroSessionsRequired",True)]:
            b=fixtures.snapshot();b["source"]["sessionAttribution"][key]=value;self.assertRaises(RuntimeError,c.stable_snapshot,b)

if __name__=="__main__":unittest.main()
