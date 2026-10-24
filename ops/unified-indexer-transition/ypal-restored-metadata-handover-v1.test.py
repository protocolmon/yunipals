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

HERE = Path(__file__).parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

m = load('new_metadata_owner', 'ypal-restored-metadata-handover-v1.py')
old = load('old_metadata_controls', 'ypal-native-metadata-handover-v1.test.py')
old.m = m  # Test fixture only: unchanged operational bodies run with NEW paths/identity.


class RetainedLifecycle(old.Controls):
    def test_exact_corrected_read_admission_producer_not_future_ack(self):
        self.assertEqual(m.ADMISSION_FILE.name, 'ypal-restored-read-admission-v1.py')
        self.assertNotEqual(m.FORMAT, 'yunipals-ypal-native-metadata-handover-v1')
        self.assertEqual(m.sha((HERE / m.TEMPLATE.name).read_bytes()), m.TEMPLATE_SHA)
        self.assertEqual(m.BASE.name, 'yunipals-ypal-restored-metadata-handover-v1-20261024')
        self.assertIn('restored-native-metadata.conf', str(m.DROP))


class NewContextControls(unittest.TestCase):
    def setUp(self):
        self.cfg = {'admissionSha256':'a'*64, 'readPlanSha256':'b'*64, 'readContextInputSha256':'c'*64}
        self.ref = {'producerFile':str(m.ADMISSION_FILE),'producerSha256':m.sha(b'new-READ-source'),'resultFile':str(m.ADMISSION_RESULT),
            'receiptSha256':self.cfg['admissionSha256'],'planSha256':self.cfg['readPlanSha256'],'contextInputSha256':self.cfg['readContextInputSha256']}
        self.proof = {'validated':True,'readAdmissionSha256':self.cfg['admissionSha256'],'readPlanSha256':self.cfg['readPlanSha256'],
            'readContextInputSha256':self.cfg['readContextInputSha256'],'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.admitted = {'format':'yunipals-ypal-restored-read-admission-v1','admitted':True,'operatorSha256':self.ref['producerSha256'],
            'bootId':'boot','planSha256':self.ref['planSha256'],'contextInputSha256':self.ref['contextInputSha256'], 'reviewHash':'review',
            'readEdgeCount':143,'loginChanges':0,'newDml':0,'serviceActions':0,'originalWholeValidatorPassed':False,'sourceReadinessQualified':False,
            'commitOutcome':'commit_confirmed','beforeSha256':'d'*64,'rehearsalSha256':'e'*64,'commitIntentSha256':'f'*64}
        self.candidate = {'staged':True,'selected':False,'adopted':False,'readviewResultSha256':'created', 'files':{'private.env':m.sha(b'same-private-bytes')}}
        def document(path, pin=None):
            if path == m.ADMISSION_RESULT: self.assertEqual(pin,self.cfg['admissionSha256']); return self.admitted
            if path == m.CANDIDATES / 'result.json': self.assertEqual(pin,m.CANDIDATE_SHA); return self.candidate
            if path.name in {'before.json','rehearsed.json','commit-intent.json'}:
                return {k:self.admitted[k] for k in ['format','operatorSha256','reviewHash']}
            self.fail('Unexpected receipt read: '+str(path))
        def protected(path, *args):
            if path == m.ADMISSION_FILE: return b'new-READ-source'
            if path == m.CANDIDATES / 'private.env': return b'same-private-bytes'
            if path == m.TEMPLATE: return (HERE / m.TEMPLATE.name).read_bytes()
            if path == m.META_FILE: return (HERE / m.META_FILE.name).read_bytes()
            self.fail('Unexpected protected read: '+str(path))
        self.store = types.SimpleNamespace(document=document, protected=protected, boot=lambda:'boot')
        meta = types.SimpleNamespace(__file__=str(m.META_FILE), READ='read', IDENTITY='identity', READ_RESULT_SHA='created', SOURCE_RESULT_SHA='old-c96')
        meta.load = lambda *args: self.fail('old meta.load was invoked')
        self.primitives = {'meta':meta,'s':self.store,'h':types.SimpleNamespace(query=lambda sql: []), 'm':types.SimpleNamespace(protected=protected),
            'installer':None,'reader':None,'source_op':{},'source':{'historicalOnly':True},
            'created':{'readSchema':'read','readIdentity':'identity','target':{'schemaOid':'75994954'},'sourceReceiptSha256':'old-c96'},
            'sourceAuthorityQualified':False}
        self.static = patch.object(m, 'static_context', return_value=types.SimpleNamespace(metadata_primitives=lambda:self.primitives))
        self.static.start(); self.addCleanup(self.static.stop)

    def construct(self, **kw):
        return m.construct_context(self.cfg, lambda:copy.deepcopy(self.proof), admission_ref=self.ref, **kw)

    def test_explicit_static_constructor_works_without_old_runtime_or_source_authority(self):
        h = self.construct(); self.assertIs(h.h,self.primitives['h']); self.assertEqual(h.read_config,self.cfg)
        self.assertFalse(h.inverse_mode); self.assertNotIn('runtime',self.primitives)
        self.assertEqual(h.admission_ref,self.ref)

    def test_missing_refresh_or_actual_refs_refuses(self):
        with self.assertRaisesRegex(RuntimeError,'explicit_phase_refresh'):
            m.construct_context(self.cfg,None,admission_ref=self.ref)
        with self.assertRaisesRegex(RuntimeError,'actual_three'):
            m.construct_context({'admissionSha256':None},lambda:self.proof,admission_ref=self.ref)
        with self.assertRaisesRegex(RuntimeError,'fixed_new_READ'):
            m.construct_context(self.cfg,lambda:self.proof,admission_ref=None)

    def test_old_c9_receipt_cannot_be_relabelled_new143(self):
        self.admitted['format']='yunipals-ypal-combined-read-admission-v2'
        with self.assertRaisesRegex(RuntimeError,'not_historical_c9'):
            self.construct()

    def test_callback_must_qualify_exact_current_refs_and_no_side_effects(self):
        for key,value in [('readPlanSha256','z'*64),('readAdmissionSha256','d'*64),('originalWholeValidatorPassed',True),('databaseWrites',1)]:
            old_value=self.proof[key]; self.proof[key]=value
            with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'exact_new_refs'):
                self.construct()
            self.proof[key]=old_value

    def test_actual_record_chain_mismatch_refuses_before_any_operation(self):
        base=self.store.document
        self.store.document=lambda path,pin=None: ({'format':self.admitted['format'],'operatorSha256':'foreign','reviewHash':'review'} if path.name=='rehearsed.json' else base(path,pin))
        with self.assertRaisesRegex(RuntimeError,'record_chain'):
            self.construct()

    def test_inverse_constructor_uses_explicit_same_callback_without_active_source_constructor(self):
        h=self.construct(inverse=True);self.assertTrue(h.inverse_mode);self.assertTrue(h.refresh()['validated'])

    def test_new_operation_refuses_old_format_or_different_phase_refs(self):
        h=self.construct();new_file=Path(m.__file__).absolute()
        value={'format':m.FORMAT,'operatorSha256':m.sha(new_file.read_bytes()),'bootId':'boot','admissionSha256':h.admission_pin,
            'candidateSha256':m.CANDIDATE_SHA,'readConfig':h.read_config,'admissionRef':h.admission_ref,'admissionOperatorSha256':h.admission_ref['producerSha256'],
            'historicalMetadataProducerSha256':m.TEMPLATE_SHA,'executionContext':{'synthetic':True}}
        base=self.store.document;prot=self.store.protected
        self.store.document=lambda path,pin=None: value if path==m.BASE/'operation.json' else base(path,pin)
        self.store.protected=lambda path,*args: new_file.read_bytes() if path==new_file else prot(path,*args)
        with patch.object(m,'execution_context',return_value={'synthetic':True}):
            self.assertEqual(m.operation(h,'op'),value)
            value['format']='yunipals-ypal-native-metadata-handover-v1'
            with self.assertRaisesRegex(RuntimeError,'same_owned_metadata_operation'):
                m.operation(h,'op')

    def test_default_cli_is_static_and_has_no_host_or_database_import(self):
        value=subprocess.run([sys.executable,str(HERE/'ypal-restored-metadata-handover-v1.py')],capture_output=True,check=True)
        row=json.loads(value.stdout);self.assertTrue(row['staticOnly']);self.assertFalse(row['operationCreated']);self.assertEqual(value.stderr,b'')

    def test_unchanged_business_and_recovery_AST_and_inverse_SQL(self):
        before=ast.parse((HERE/'ypal-native-metadata-handover-v1.py').read_bytes())
        after=ast.parse((HERE/'ypal-restored-metadata-handover-v1.py').read_bytes())
        dumps=lambda node:ast.dump(node,include_attributes=False)
        a={n.name:n for n in before.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        b={n.name:n for n in after.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        changed=[]
        for name,node in a.items():
            if name=='Host':
                old_methods={n.name:n for n in node.body if isinstance(n,ast.FunctionDef)}
                new_methods={n.name:n for n in b[name].body if isinstance(n,ast.FunctionDef)}
                for method,body in old_methods.items():
                    if dumps(body)!=dumps(new_methods[method]):changed.append('Host.'+method)
            elif dumps(node)!=dumps(b[name]):changed.append(name)
        self.assertEqual(sorted(changed),['Host.__init__','Host.refresh','main','operation','review'])
        before_sql=next(n.value.value for n in before.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name)and t.id=='INVERSE_JS'for t in n.targets))
        self.assertEqual(before_sql,m.INVERSE_JS)
        self.assertEqual(m.sha((HERE/'ypal-native-metadata-handover-v1.py').read_bytes()),m.TEMPLATE_SHA)


if __name__=='__main__':unittest.main(verbosity=2)
