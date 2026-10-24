#!/usr/bin/env python3
"""Synthetic legacy preservation and exact v1 reuse; no production calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('ypal-restored-managed-host-preparation-v2.py')
OLD=PATH.with_name('ypal-restored-managed-host-preparation-v1.py')
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(PATH,'tested_inactive_v2');v1=load(OLD,'immutable_inactive_v1')


class Pure(unittest.TestCase):
    def test_default_never_reads_host_or_imports_template(self):
        value=subprocess.run([sys.executable,'-I','-B',str(PATH)],capture_output=True,check=True)
        actual=json.loads(value.stdout);self.assertTrue(actual['sourceOnly']);self.assertFalse(actual['managedAuthorityQualified']);self.assertEqual(value.stderr,b'')

    def test_exact_frozen_v1_functions_and_other_methods_remain_identical(self):
        namespace=m.assemble(OLD.read_bytes(),lambda h,i:{'readOnlyPreservationQualified':True})
        self.assertEqual(namespace.FORMAT,m.FORMAT);self.assertEqual(namespace.BASE,m.BASE);self.assertEqual(namespace.PLAN_SHA,v1.PLAN_SHA)
        for name,obj in v1.__dict__.items():
            if isinstance(obj,types.FunctionType):self.assertEqual(obj.__code__.co_code,namespace.__dict__[name].__code__.co_code,name)
        for name,obj in v1.Host.__dict__.items():
            if isinstance(obj,types.FunctionType)and name!='capture':self.assertEqual(obj.__code__.co_code,namespace.Host.__dict__[name].__code__.co_code,name)
        self.assertNotEqual(v1.Host.capture.__code__.co_code,namespace.Host.capture.__code__.co_code)
        self.assertEqual(m.sha(OLD.read_bytes()),m.TEMPLATE_SHA)
        self.assertEqual(m.sha(PATH.with_name('ypal-restored-managed-handover-v1.py').read_bytes()),'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5')


class Legacy(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='.legacy-preservation-v2-',dir=PATH.parents[2]);self.root=Path(self.tmp.name)
        self.files={}
        for name,raw in [('private-a.env',b'PRIVATE=synthetic-a\n'),('private-b.env',b'PRIVATE=synthetic-b\n'),
                         ('node',b'synthetic Node'),('ponder.js',b'synthetic Ponder'),('compiler',b'synthetic compiler'),('ponder.config.ts',b'synthetic config')]:
            path=self.root/name;path.write_bytes(raw);self.files[name]=str(path)
        def fingerprint(path):
            p=Path(path);s=p.stat();keys=('st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_mtime_ns','st_ctime_ns')
            return {'sha256':m.sha(p.read_bytes()),'bytes':s.st_size,'identity':{k:getattr(s,k)for k in keys}}
        actor={'parent':{'pid':42,'uid':0,'gid':0,'cwd':str(self.root),'executable':self.files['node'],
                         'argv':[self.files['node'],self.files['ponder.js'],'start'],'environmentSha256':'a'*64},
               'processes':[{'pid':42,'executable':self.files['node']},{'pid':43,'executable':self.files['compiler']}],
               'unit':{'InvocationID':'b'*32}}
        activation={'boot':{'fixture':'same'},'definitions':{p:{'sha256':v,'identity':{'fixture':'same'}}for p,v in m.LEGACY_DEFINITIONS.items()}}
        self.record={'format':'yunipals-existing-legacy-parent-preservation-v2','unit':'yunipals-indexer.service','bootId':'synthetic-boot',
            'actor':actor,'activation':activation,'effectiveEnvironmentFiles':{'type':'a(sb)','data':[[self.files['private-a.env'],False],[self.files['private-b.env'],False]]},
            'fileFingerprints':{self.files[k]:fingerprint(self.files[k])for k in ['private-a.env','private-b.env']},
            'publicPrograms':{self.files[k]:fingerprint(self.files[k])for k in ['node','ponder.js','compiler','ponder.config.ts']},
            'selectedConfig':{'path':self.files['ponder.config.ts'],'explicitArgument':False},'explicitLoaders':[],
            'historicalPonderProgramMatched':True,'existingActorPreservationOnly':True,'installedApplicationClosureQualified':False,
            'newManagedWriterQualified':False,'retirementQualified':False,'sourceReadinessQualified':False,'financialAuthorityQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.live_actor=copy.deepcopy(actor);self.live_activation=copy.deepcopy(activation);self.live_files=copy.deepcopy(self.record['effectiveEnvironmentFiles'])
        case=self
        class Inventory:
            def actor(self,unit,terminal):case.assertEqual(unit,'yunipals-indexer.service');return copy.deepcopy(case.live_actor)
            def activation(self,unit):return copy.deepcopy(case.live_activation)
        def command(argv):
            self.assertEqual(argv[0],'/usr/bin/busctl');self.assertEqual(argv[-1],'EnvironmentFiles');return json.dumps(self.live_files).encode()
        self.host=types.SimpleNamespace(sdk=types.SimpleNamespace(PARENT='yunipals-indexer.service',boot=lambda:'synthetic-boot',command=command))
        self.inventory=Inventory();self.reads=[]
        def protected(path,pin):
            self.reads.append((path,pin))
            self.assertIn((path,pin),[(m.DIAGNOSTIC,m.DIAGNOSTIC_SHA),(m.PRIOR_INPUT,m.PRIOR_INPUT_SHA),(m.LEGACY_INPUT,m.LEGACY_INPUT_SHA)])
            return json.dumps(self.record).encode()if path==m.LEGACY_INPUT else b'synthetic fixed prior proof'
        self.namespace=types.SimpleNamespace(protected=protected)
        self.patcher=patch.object(m,'PONDER_SHA',self.record['publicPrograms'][self.files['ponder.js']]['sha256']);self.patcher.start()

    def tearDown(self):self.patcher.stop();self.tmp.cleanup()

    def scope(self):return m.parent_scope(self.namespace,self.host,self.inventory)

    def test_exact_active_legacy_is_preserved_readonly_without_new_authority_or_paths(self):
        result=self.scope();self.assertTrue(result['readOnlyPreservationQualified']);self.assertEqual(result['packetSha256'],m.LEGACY_INPUT_SHA)
        for key in ['managedAuthorityQualified','currentWriterQualified','retirementQualified','sourceReadinessQualified','financialAuthorityQualified','installedApplicationClosureQualified']:
            self.assertFalse(result[key])
        self.assertNotIn(str(self.root),json.dumps(result));self.assertEqual(len(self.reads),3)

    def test_changed_actual_actor_or_foreign_overlay_refuses(self):
        self.live_actor['parent']['pid']=99
        with self.assertRaisesRegex(RuntimeError,'exact_existing_legacy'):self.scope()
        self.live_actor=copy.deepcopy(self.record['actor']);self.live_activation['definitions']['/etc/systemd/system/foreign.conf']={'sha256':'f'*64}
        with self.assertRaisesRegex(RuntimeError,'exact_existing_legacy'):self.scope()

    def test_full_typed_array_order_and_earlier_file_cannot_be_lost(self):
        self.live_files['data'].reverse()
        with self.assertRaisesRegex(RuntimeError,'ordered_two_file'):self.scope()
        self.live_files=copy.deepcopy(self.record['effectiveEnvironmentFiles']);self.live_files['data'].pop(0)
        with self.assertRaisesRegex(RuntimeError,'ordered_two_file'):self.scope()

    def test_changed_private_or_program_file_refuses_without_importing_it(self):
        Path(self.files['private-a.env']).write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError,'recorded_legacy_file_inode'):self.scope()

    def test_foreign_or_new_managed_command_cannot_relabel_existing_legacy(self):
        self.record['actor']['parent']['argv']=['node','launcher.mjs','start'];self.live_actor=copy.deepcopy(self.record['actor'])
        with self.assertRaisesRegex(RuntimeError,'not_new_managed_launcher'):self.scope()

    def test_opaque_closure_or_retirement_success_claim_is_rejected(self):
        self.record['retirementQualified']=True
        with self.assertRaisesRegex(RuntimeError,'not_runtime_authority'):self.scope()

    def test_actual_selected_config_or_explicit_loader_needs_its_own_fingerprint(self):
        self.record['explicitLoaders']=[str(self.root/'unrecorded-loader.mjs')]
        with self.assertRaisesRegex(RuntimeError,'every_explicit_loader'):self.scope()


class Capture(unittest.TestCase):
    def test_new_capture_binds_active_scope_but_never_allows_managed_operation(self):
        calls=[]
        def scope(host,inventory):calls.append('qualified');return {'readOnlyPreservationQualified':True,'managedAuthorityQualified':False,'packetSha256':m.LEGACY_INPUT_SHA}
        namespace=m.assemble(OLD.read_bytes(),scope)
        h=object.__new__(namespace.Host);actor={'source':'existing-de4'};native={'tables':{'native44':'same'},'cache':{'same':'cache'},'schemaOid':'75963410'}
        class Inventory:
            def activation(self,unit):return {'same':'legacy activation'}
        h.current=types.SimpleNamespace(observe_runtime=lambda:{'binding':{'source':actor}})
        h.h=types.SimpleNamespace(native=lambda:native,inputs=lambda:{'existing':'unchanged'})
        h.owner=types.SimpleNamespace(floors=lambda n:None,owned=lambda:actor,preserved=lambda:{'pack':'serving'})
        h.r=types.SimpleNamespace(recovery_floor=lambda before,after:None)
        h.restore=types.SimpleNamespace(BASE=Path('/fixed/old'),canonical_actor=lambda a:a)
        h.sdk=types.SimpleNamespace(document=lambda *args:{'native':native},command=lambda *args:None,protected=lambda *args:None,
                                   Host=Inventory,WRITERS=['yunipals-indexer.service'],ENV_FILES=[],PARENT='yunipals-indexer.service')
        h.consumer=types.SimpleNamespace(consumer_frame=lambda bridge:{'actual':'stable'})
        with tempfile.TemporaryDirectory(prefix='.capture-v2-',dir=PATH.parents[2])as tmp:
            with patch.multiple(namespace,MANAGED_BASE=Path(tmp)/'managed',MANAGED_HOLD=Path(tmp)/'hold'):
                result=h.capture();self.assertFalse(result['binding']['legacyParentReadOnlyPreservation']['managedAuthorityQualified'])
                namespace.MANAGED_BASE.mkdir()
                with self.assertRaisesRegex(RuntimeError,'managed_runtime_and_operation'):h.capture()
        self.assertEqual(calls,['qualified','qualified'])


if __name__=='__main__':unittest.main()
