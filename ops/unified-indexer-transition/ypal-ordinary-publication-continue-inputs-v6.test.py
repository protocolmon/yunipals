"""Whole original renderer and real Reader6 cold core; receipt I/O is explicit."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-publication-continue-inputs-v6.py')
r=load('ypal-native-readiness-reader-binding-v1.test.py')
local=r.family_tests.local


class Static(unittest.TestCase):
    def test_complete_sources_and_default_inert(self):
        with patch.object(m,'public',side_effect=local):
            value=m.authenticate();self.assertEqual(len(value['files']),342)
        out=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],check=True,capture_output=True,text=True)
        self.assertTrue(json.loads(out.stdout)['staticOnly']);self.assertFalse(out.stderr)
        for args in [['--prepared-sha','f'*64],['--manifest-sha','f'*64]]:
            out=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name),*args],capture_output=True,text=True)
            self.assertNotEqual(out.returncode,0)

    def test_only_two_original_renderer_literals_change_and_all_record_checks_remain(self):
        template=ast.parse(local(m.TEMPLATE));fn=next(x for x in template.body if isinstance(x,ast.FunctionDef)and x.name=='reader_inputs')
        originals=[x.value for x in ast.walk(fn)if isinstance(x,ast.Constant)]
        self.assertEqual(originals.count('yunipals-ypal-ordinary-reader-continue-v1-source'),1)
        self.assertEqual(originals.count('ypal-ordinary-read-cache-continue-v1.py'),1)
        source=ast.parse(local(m.FILE));entry=next(x for x in source.body if isinstance(x,ast.FunctionDef)and x.name=='reader_inputs')
        self.assertFalse(any(isinstance(x,ast.Call)and isinstance(x.func,ast.Attribute)and x.func.attr in{'current','actor_current','qualify_held','commit','execute'}for x in ast.walk(entry)))
        self.assertEqual(sum(isinstance(x,ast.Call)and ast.unparse(x.func)=='value.reader_inputs'for x in ast.walk(entry)),1)


class Actual(unittest.TestCase):
    def setUp(self):
        self.cold=r.Cold();self.cold.setUp();self.addCleanup(self.cold.doCleanups)
        self.f=self.cold.f;self.files={};self.core_calls=[]
        self.enterContext(patch.object(m,'public',side_effect=self.read))
        self.reader=r.w.reader_namespace(self.f.family);self.provider=self.f.family.provider()
        # The renderer itself constructs the actual route once. Restore only
        # the family cache for that call; reuse this genuine route in the
        # explicit loader I/O adapter below, not an arbitrary Proof stand-in.
        self.recorded=self.f.family.metadata.Epoch(self.f.old.refs,self.f.manifest,False).binding()
        config=copy.deepcopy(self.f.old.config);self.config_sha=self.put(self.provider.INPUT,config)
        before={'binding':{'format':self.provider.FORMAT,'operatorSha256':m.SOURCE_PINS[m.PROVIDER],
            'config':config,'prerequisites':{'metadataCurrentProof':{'metadataEpoch':self.recorded}}},'reviewHash':'1'*64}
        before_sha=self.put(self.provider.BASE/'before.json',before)
        committed={'reviewHash':before['reviewHash'],'operatorSha256':m.SOURCE_PINS[m.PROVIDER],
            'mode':'apply','readAdmissionSha256':config['readAdmissionSha256']}
        committed_sha=self.put(self.provider.BASE/'sql-committed.json',committed)
        prepared={'format':self.provider.FORMAT,'operatorSha256':m.SOURCE_PINS[m.PROVIDER],
            'config':config,'prepared':True,'nativeWorkerStarted':False,'nativeGenerationPublished':False,
            'reviewHash':before['reviewHash'],'beforeSha256':before_sha,'additionalReadAcknowledgementSha256':committed_sha}
        self.prepared_sha=self.put(self.provider.BASE/'prepared.json',prepared)
        observer_ref=self.f.manifest['contexts']['observer'];observer=load(observer_ref['file'])
        observer.BASE=Path('/explicit-protected-observer-receipt-I-O')
        self.put(observer.BASE/'result.json',{'format':observer.FORMAT,'operatorSha256':observer_ref['sha256'],'mode':'new',
            'observerScopeOnly':True,'ordinarySustainedObserver':True})
        transport=self.f.manifest['transportQualification']
        self.put(Path(transport['newQualificationFile']),{'format':'yunipals-ordinary-reader-peer-bound-v1','qualified':True,
            'producerSha256':transport['newProducerSha256'],'wireManifestSha256':self.f.manifest['wireManifestSha256'],
            'peers':{'postgres':{},'main':{}}})
        self.installs={};receipt_pins={}
        for name,field in [('ypal-generation-publisher-install-v1.py','PUBLISHER_INSTALL_SHA'),
                ('ypal-latest-complete-main-api-install-v1.py','MAIN_INSTALL_SHA')]:
            owner=load(name);digest=self.put(owner.BASE/'result.json',{'explicitImmutableInstallerReceiptIO':name})
            self.installs[name]=owner;receipt_pins[field]=digest
        real_core=self.reader.core
        def core(digest):
            result=real_core(digest);self.core_calls.append(result)
            # Synthetic installer documents cannot hash to the immutable live
            # receipt constants. Only their private-read expected hashes are
            # substituted after the complete genuine cold core has executed.
            for field,value in receipt_pins.items():setattr(result[1],field,value)
            result[1].Context=lambda *_:self.fail('static renderer must not construct a current Context')
            return result
        self.enterContext(patch.object(self.reader,'core',side_effect=core))
        original_utility=self.f.family.utility
        def utility():
            value=original_utility()
            def loaded(path,digest):
                name=Path(path).name;local(path,digest)
                if name==observer_ref['file']:return observer
                if name in self.installs:return self.installs[name]
                return load(name)
            return r.family_tests.context_tests.m.Proxy(value,load=loaded)
        self.enterContext(patch.object(self.f.family,'utility',side_effect=utility))
        # Match the actual source policy while relocating the one immutable
        # private input hash to this generated receipt graph. No live input,
        # baseline, current validation or completed Reader ACK is claimed.
        self.enterContext(patch.object(self.f.family.authority_context.value,'PRIOR_INPUT_SHA',self.config_sha))
        original_load=m.load
        def supplied(name):
            if name==m.FAMILY:return types.SimpleNamespace(Family=lambda refs,authority:self.f.family)
            if name==m.BINDING:return types.SimpleNamespace(reader_namespace=lambda family:self.reader)
            return original_load(name)
        self.enterContext(patch.object(m,'load',side_effect=supplied))

    def put(self,path,value):
        raw=m.encoded(value);self.files[str(path)]=raw;return m.sha(raw)
    def read(self,path,digest=None):
        if str(path)in self.files:
            raw=self.files[str(path)]
            if digest is not None:self.assertEqual(m.sha(raw),digest,'fixture document digest must be genuine')
            return raw
        return local(path,digest)
    def run_renderer(self):return m.reader_inputs(self.prepared_sha,self.f.manifest_sha,self.f.refs,self.f.input_sha)

    def test_full_real_cold_core_ten_refs_and_actual_epoch_binding(self):
        result=self.run_renderer();self.assertEqual(len(self.core_calls),1)
        self.assertIs(self.core_calls[0][1].module_context('phase'),self.provider)
        self.assertEqual(set(result['readerInputs']),self.core_calls[0][1]._implementation.INPUT_KEYS)
        self.assertEqual(len(result['readerInputs']),10);self.assertEqual(result['readerInputs']['cachePreparedSha256'],self.prepared_sha)
        self.assertEqual(result['metadataRefs'],self.recorded['refs']);self.assertFalse(result['metadataActorCurrentQualified'])
        self.assertEqual(result['nativeReadinessPolicy'],self.f.family.readiness.binding())
        self.assertEqual(result['readerRouteBinding'],self.reader.native_readiness_reader_binding)
        self.assertTrue(result['immutableFileLineageOnly']);self.assertFalse(result['oldReader5InputsClaimed'])
        self.assertEqual(result['databaseWrites'],result['serviceActions']);self.assertEqual(result['providerCalls'],0)

    def test_refuse_foreign_prepared_observer_wire_epoch_and_source_refs(self):
        key=str(self.provider.BASE/'prepared.json');prepared=json.loads(self.files[key])
        for field,value in [('nativeWorkerStarted',True),('operatorSha256','f'*64),('nativeGenerationPublished',True)]:
            changed={**prepared,field:value};self.prepared_sha=self.put(self.provider.BASE/'prepared.json',changed)
            with self.assertRaises(RuntimeError):self.run_renderer()
        self.prepared_sha=self.put(self.provider.BASE/'prepared.json',prepared)
        observer_path=Path('/explicit-protected-observer-receipt-I-O/result.json')
        observer=json.loads(self.files[str(observer_path)])
        self.put(observer_path,{**observer,'ordinarySustainedObserver':False})
        with self.assertRaises(RuntimeError):self.run_renderer()
        self.put(observer_path,observer)
        transport_path=Path(self.f.manifest['transportQualification']['newQualificationFile'])
        transport=json.loads(self.files[str(transport_path)])
        self.put(transport_path,{**transport,'peers':{'postgres':{}}})
        with self.assertRaises(RuntimeError):self.run_renderer()
        self.put(transport_path,transport)
        # Rehash every enclosing record so this reaches the actual immutable
        # Epoch relation, rather than merely failing a document hash check.
        before_path=self.provider.BASE/'before.json';before=json.loads(self.files[str(before_path)])
        before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']['refs']['resultSha256']='f'*64
        before_sha=self.put(before_path,before);prepared['beforeSha256']=before_sha
        self.prepared_sha=self.put(self.provider.BASE/'prepared.json',prepared)
        with self.assertRaises((RuntimeError,AssertionError)):self.run_renderer()
        with self.assertRaises(RuntimeError):m.reader_inputs(self.prepared_sha,'f'*64,self.f.refs,self.f.input_sha)


if __name__=='__main__':unittest.main()
