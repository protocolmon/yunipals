import ast
import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

h=load('source6-qualified-receipts-v2.py')
legacy=load('source6-normal-receipts.test.py')

def proof():
    return {'validated':True,'format':'yunipals-source6-normal-proxy-requalification-v1',
            'qualificationReceiptSha256':h.QUALIFICATION,'operatorSha256':h.QUALIFIER_SHA,
            'originalRuntimeReceiptSha256':h.SOURCE_RECEIPT,'freeOnly':True,'paidAuthority':False,
            'financialWindowRenewed':False,'originalWholeValidationPassed':False,
            'sourceRestarted':False,'runtime':copy.deepcopy(h.SOURCE_ID),'proxies':{'base':'fixed','bnb':'fixed','ethereum':'fixed','polygon':'fixed'}}


class QualifiedReceipts(unittest.TestCase):
    def test_only_source_authority_and_runtime_ack_change_from_frozen_owner(self):
        old=ast.parse((HERE/'source6-normal-receipts.py').read_text())
        new=ast.parse((HERE/'source6-qualified-receipts-v2.py').read_text())
        a={n.name:ast.dump(n,include_attributes=False)for n in old.body if isinstance(n,ast.FunctionDef)}
        b={n.name:ast.dump(n,include_attributes=False)for n in new.body if isinstance(n,ast.FunctionDef)}
        self.assertEqual({k for k in a if a[k]!=b[k]},{'authority','apply'})
        self.assertEqual(set(b)-set(a),{'source_qualification'})
        # Even apply's actions are retained; only its receipt value gains binding metadata.
        before=next(n for n in old.body if isinstance(n,ast.FunctionDef)and n.name=='apply')
        after=next(n for n in new.body if isinstance(n,ast.FunctionDef)and n.name=='apply')
        for fn in [before,after]:
            for node in ast.walk(fn):
                if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='value'for t in node.targets):
                    node.value=ast.Constant(value='receipt_metadata_only')
        self.assertEqual(ast.dump(before,include_attributes=False),ast.dump(after,include_attributes=False))

    def test_old_files_and_finite_loop_remain_exact(self):
        self.assertEqual(h.sha((HERE/'source6-normal-receipts.py').read_bytes()),'12e0c7debc3681d558948f308ebb3801e1a51a9baf8b5ee01f65fb8deac94281')
        self.assertEqual(h.sha((HERE/'source6-normal-receipt-loop.mjs').read_bytes()),h.ENTRY_SHA)
        self.assertIn('v2-20261023',str(h.BASE));self.assertIn('qualified-receipts-v2',h.DROP.name)
        self.assertIn(b'RuntimeMaxSec=900\n',h.drop_bytes(types.SimpleNamespace(SOURCE='008028af')))
        self.assertNotIn('PERMIT', ' '.join(h.command()))

    def test_exact_actual_ack_is_called_without_the_old_whole_validator(self):
        calls=[];qualifier=types.SimpleNamespace(validate_current=lambda pin:(calls.append(pin),proof())[1])
        s=types.SimpleNamespace(protected=lambda path:(HERE/path.name).read_bytes())
        with patch.object(h,'module',return_value=qualifier):
            self.assertEqual(h.source_qualification(s),proof())
        self.assertEqual(calls,[h.QUALIFICATION])

    def test_changed_qualifier_source_refuses_before_import(self):
        s=types.SimpleNamespace(protected=lambda path:b'foreign')
        with patch.object(h,'module')as imported,self.assertRaisesRegex(RuntimeError,'exact_acknowledged_proxy_qualifier'):
            h.source_qualification(s)
        imported.assert_not_called()

    def test_wrong_receipt_paid_source_renewal_or_original_validation_claim_refuses(self):
        s=types.SimpleNamespace(protected=lambda path:(HERE/path.name).read_bytes())
        for key,value in [('validated',False),('qualificationReceiptSha256','0'*64),('operatorSha256','0'*64),('originalRuntimeReceiptSha256','0'*64),('paidAuthority',True),('freeOnly',False),('financialWindowRenewed',True),('sourceRestarted',True),('originalWholeValidationPassed',True)]:
            changed={**proof(),key:value}
            with self.subTest(key=key),patch.object(h,'module',return_value=types.SimpleNamespace(validate_current=lambda _:changed)),self.assertRaisesRegex(RuntimeError,'actual_proxy_qualified_source_ack'):
                h.source_qualification(s)

    def authority(self, *, source=None, proxies=None, grants=None):
        with tempfile.TemporaryDirectory(prefix='qualified-receipt-authority-',dir='/tmp')as temporary:
            dependency=Path(temporary);dependency.chmod(0o755)
            rights={'exactRestrictedRole':True}
            acl=types.SimpleNamespace(privilege_query=lambda:'acl-fixture',desired_privileges=lambda:rights)
            overlay=types.SimpleNamespace(validate_saved=lambda:{'entrySha256':'014769192103aa421838f98f462a7d1f16c83c08729ef6083392eac828106d35','artifactDigest':'b'*64,'dependencyDirectory':temporary})
            def module(name,pin):
                if name=='prepare-shadow-support.py':return acl
                if name=='source008-receipt-support-build-v1.py':return overlay
                raise AssertionError('unexpected module')
            normal=types.SimpleNamespace(validate=lambda *_:self.fail('old whole validator must never be called'),current_identity=lambda *_:source or h.SOURCE_ID,financial=lambda _:{'activePermits':0,'paidAuthority':False})
            ack=Path('/synthetic-public-ack');ackbytes=b'retained-ack'
            fixtures={name:('synthetic-public-dependency:'+name).encode()for name in h.PINS}
            pins={name:h.sha(raw)for name,raw in fixtures.items()}
            def protected(path):return ackbytes if path==ack else fixtures[path.name]if path.name in fixtures else(HERE/path.name).read_bytes()
            def query(sql,*args):
                if sql=='acl-fixture':return rights if grants is None else grants
                self.assertIn('unified_rpc_replay_permit',sql)
                return [{'enabled':False},{'enabled':False}]
            s=types.SimpleNamespace(SOURCE='008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78',protected=protected,query=query,proxies=lambda:proof()['proxies']if proxies is None else proxies)
            with patch.object(h,'source_qualification',return_value=proof()),patch.object(h,'module',side_effect=module),patch.object(h,'ACKS',{ack:h.sha(ackbytes)}),patch.object(h,'PINS',pins):
                return h.authority(normal,None,None,s)

    def test_authority_accepts_exact_requalified_source_without_changing_receipt_engine(self):
        value=self.authority()
        self.assertEqual(value['sourceQualificationReceiptSha256'],h.QUALIFICATION)
        self.assertEqual(value['sourceQualificationOperatorSha256'],h.QUALIFIER_SHA)
        self.assertFalse(value['originalWholeValidationPassed'])
        self.assertEqual(value['maximumRpcCalls'],256);self.assertEqual(value['maximumRuntimeSeconds'],900)
        self.assertEqual(value['maximumConcurrentReceiptUpstream'],1)
        self.assertEqual(value['newPaidAllowanceCu'],0)

    def test_different_source_or_changed_proxy_after_validation_refuses(self):
        for kwargs,code in [({'source':{**h.SOURCE_ID,'pid':99}},'same_acknowledged_source_after_receipt_review'),({'proxies':{'base':'new'}},'exact_acknowledged_proxy_tuple')]:
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(RuntimeError,code):self.authority(**kwargs)

    def test_unrelated_grants_are_not_normalized(self):
        with self.assertRaisesRegex(RuntimeError,'unchanged_restricted_support_grants'):self.authority(grants={'broader':True})

    def test_public_stager_installs_only_successor_and_preserves_historical_dependencies(self):
        stage=load('stage-source6-qualified-receipts-v2.py')
        with tempfile.TemporaryDirectory(prefix='.qualified-receipts-stage-',dir='/root/yunipals')as temporary:
            area=Path(temporary)
            for name in stage.DEPENDENCIES:(area/name).write_bytes((HERE/name).read_bytes())
            before={p.name:p.read_bytes()for p in area.iterdir()}
            with patch.object(stage,'OPS',area):
                reviewed=stage.review()
                with self.assertRaisesRegex(RuntimeError,'fresh_exact_public_stage_review'):stage.apply('0'*64)
                result=stage.apply(reviewed['reviewHash'])
                self.assertTrue(result['staged']);self.assertEqual(len(list(area.iterdir())),len(before)+1)
                for name,raw in before.items():self.assertEqual((area/name).read_bytes(),raw)
                self.assertEqual((area/'source6-qualified-receipts-v2.py').read_bytes(),(HERE/'source6-qualified-receipts-v2.py').read_bytes())
                (area/'source6-normal-receipt-loop.mjs').write_text('foreign')
                with self.assertRaisesRegex(RuntimeError,'exact_retained_public_dependency'):stage.review()

    def test_owned_inverse_is_unchanged_and_cleans_up_during_source_outage(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse()

    def test_lost_stop_ack_does_not_repeat_stop(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse(lost_stop=True)

    def test_lost_reload_ack_completes_only_owned_drop_removal(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse(lost_reload=True)


if __name__=='__main__':unittest.main()
