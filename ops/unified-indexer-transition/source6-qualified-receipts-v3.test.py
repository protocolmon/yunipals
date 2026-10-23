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

h=load('source6-qualified-receipts-v3.py')
legacy=load('source6-normal-receipts.test.py')

def proof():
    return {'validated':True,'format':'yunipals-source6-normal-proxy-requalification-v1',
            'qualificationReceiptSha256':h.QUALIFICATION,'operatorSha256':h.QUALIFIER_SHA,
            'originalRuntimeReceiptSha256':h.SOURCE_RECEIPT,'freeOnly':True,'paidAuthority':False,
            'financialWindowRenewed':False,'originalWholeValidationPassed':False,
            'sourceRestarted':False,'runtime':copy.deepcopy(h.SOURCE_ID),'proxies':{'base':'fixed','bnb':'fixed','ethereum':'fixed','polygon':'fixed'}}


class QualifiedReceipts(unittest.TestCase):
    def test_only_owned_runtime_and_group_boundary_change_from_frozen_v2(self):
        old=ast.parse((HERE/'source6-qualified-receipts-v2.py').read_text())
        new=ast.parse((HERE/'source6-qualified-receipts-v3.py').read_text())
        a={n.name:ast.dump(n,include_attributes=False)for n in old.body if isinstance(n,ast.FunctionDef)}
        b={n.name:ast.dump(n,include_attributes=False)for n in new.body if isinstance(n,ast.FunctionDef)}
        self.assertEqual({k for k in a if a[k]!=b[k]},{'command','drop_bytes','configuration','actor_boundary','authority'})
        self.assertEqual(set(b)-set(a),{'inherited_identity'})
        for name in ['apply','actor','inspect','restore','source_qualification','review','quiet']:
            self.assertEqual(a[name],b[name])

    def test_old_files_and_finite_loop_remain_exact(self):
        self.assertEqual(h.sha((HERE/'source6-qualified-receipts-v2.py').read_bytes()),'325efeb168a364c0ba99e02ad7cb0dc773025a5c1911dddda5cfc88e302838f7')
        self.assertEqual(h.sha((HERE/'source6-normal-receipt-loop.mjs').read_bytes()),h.LOOP_SHA)
        self.assertEqual(h.sha((HERE/h.ENTRY.name).read_bytes()),h.ENTRY_SHA)
        self.assertIn('v3-20261023',str(h.BASE));self.assertIn('qualified-receipts-v3',h.DROP.name)
        raw=h.drop_bytes(types.SimpleNamespace(SOURCE='008028af'))
        self.assertIn(b'RuntimeMaxSec=900\n',raw)
        self.assertEqual([line.split(b'=',1)[0]for line in raw.splitlines()if b'='in line],
                         [b'WorkingDirectory',b'ExecStart',b'ExecStart',b'RuntimeMaxSec'])
        self.assertEqual(h.command()[:2],['/usr/bin/env','-i'])
        for forbidden in ['setpriv','CAP_','PERMIT','User=root','Group=root']:
            self.assertNotIn(forbidden,raw.decode())
        self.assertIn('UNIFIED_RPC_FREE_ONLY=true',h.command())

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
        stage=load('stage-source6-qualified-receipts-v3.py')
        with tempfile.TemporaryDirectory(prefix='.qualified-receipts-stage-',dir='/root/yunipals')as temporary:
            area=Path(temporary)
            for name in stage.DEPENDENCIES:(area/name).write_bytes((HERE/name).read_bytes())
            before={p.name:p.read_bytes()for p in area.iterdir()}
            with patch.object(stage,'OPS',area):
                reviewed=stage.review()
                with self.assertRaisesRegex(RuntimeError,'fresh_exact_public_stage_review'):stage.apply('0'*64)
                result=stage.apply(reviewed['reviewHash'])
                self.assertTrue(result['staged']);self.assertEqual(len(list(area.iterdir())),len(before)+len(stage.FILES))
                for name,raw in before.items():self.assertEqual((area/name).read_bytes(),raw)
                self.assertEqual((area/'source6-qualified-receipts-v3.py').read_bytes(),(HERE/'source6-qualified-receipts-v3.py').read_bytes())
                (area/'source6-normal-receipt-loop.mjs').write_text('foreign')
                with self.assertRaisesRegex(RuntimeError,'exact_retained_public_dependency'):stage.review()

    def test_owned_inverse_is_unchanged_and_cleans_up_during_source_outage(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse()

    def test_lost_stop_ack_does_not_repeat_stop(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse(lost_stop=True)

    def test_lost_reload_ack_completes_only_owned_drop_removal(self):
        with patch.object(legacy,'h',h):legacy.ReceiptBoundaries().inverse(lost_reload=True)


class DirectSystemdBoundary(unittest.TestCase):
    def status(self):
        return {'Uid':'969 969 969 969','Gid':'963 963 963 963','Groups':'963',
                'NoNewPrivs':'1','CapInh':'0000','CapPrm':'0000','CapEff':'0000','CapAmb':'0000'}

    def test_actor_accepts_no_groups_or_only_its_primary_group(self):
        for groups in ['', '963']:
            h.actor_boundary({**self.status(),'Groups':groups},'0::'+h.GROUP+'\n')

    def test_actor_refuses_extra_groups_wrong_ids_caps_or_privileges(self):
        for key,value in [('Groups','0'),('Groups','963 964'),('Groups','963 963'),('Uid','0 969 969 969'),
                          ('Gid','964 963 963 963'),('NoNewPrivs','0'),('CapEff','01')]:
            with self.subTest(key=key,value=value),self.assertRaisesRegex(RuntimeError,'unprivileged_support_actor'):
                h.actor_boundary({**self.status(),key:value},'0::'+h.GROUP)
        with self.assertRaises(RuntimeError):h.actor_boundary(self.status(),'0::/foreign')

    def inherited(self, *, change=None, groups=None, uid=969, gid=963):
        fields={'User':'yunipals_unified_support','Group':'yunipals_unified_support','SupplementaryGroups':'',
                'CapabilityBoundingSet':'','AmbientCapabilities':'','NoNewPrivileges':'yes',
                'RestrictSUIDSGID':'yes','SystemCallFilter':'~','SecureBits':'0'}
        if change:fields.update(change)
        def run(argv):
            self.assertEqual(argv[:4],['/usr/bin/systemctl','show','--all',h.UNIT])
            return ''.join(k+'='+v+'\n'for k,v in fields.items()).encode()
        with patch.object(h.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=uid,pw_gid=gid,pw_name='yunipals_unified_support')),patch.object(h.grp,'getgrnam',return_value=types.SimpleNamespace(gr_gid=963)),patch.object(h.os,'getgrouplist',return_value=[963]if groups is None else groups):
            return h.inherited_identity(types.SimpleNamespace(run=run))

    def test_loaded_original_hardening_and_existing_nss_are_exact(self):
        self.assertEqual(self.inherited()['CapabilityBoundingSet'],'')
        for change in [{'User':'root'},{'Group':'root'},{'SupplementaryGroups':'964'},
                       {'CapabilityBoundingSet':'cap_setuid'},{'AmbientCapabilities':'cap_setuid'},
                       {'NoNewPrivileges':'no'},{'RestrictSUIDSGID':'no'},{'SystemCallFilter':''},
                       {'SecureBits':'1'},{'Unreviewed':'property'}]:
            with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'unchanged_inherited'):
                self.inherited(change=change)
        for kwargs in [{'groups':[963,964]},{'uid':0},{'gid':0}]:
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(RuntimeError,'existing_support_account'):
                self.inherited(**kwargs)

    def test_synthetic_probe_retains_original_fragment_and_never_loads_credentials(self):
        probe=load('source6-qualified-receipt-probe-v3.py')
        original=b'[Service]\nUser=yunipals_unified_support\nGroup=yunipals_unified_support\nCapabilityBoundingSet=\nNoNewPrivileges=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n'
        script=(HERE/'source6-qualified-receipt-probe-v3.mjs').read_bytes()
        with patch.object(probe,'FRAGMENT_SHA',h.sha(original)),patch.object(probe,'protected',side_effect=lambda path:original if path==probe.FRAGMENT else script):
            rendered=probe.render();self.assertTrue(rendered.startswith(original))
            self.assertIn(b'RuntimeMaxSec=30',rendered);self.assertNotIn(b'PONDER_RPC',rendered)
            self.assertNotIn(b'runProbe',script);self.assertIn(b'providerCalls, databaseCalls: 0, credentialReads: 0',script)
        for directive in [b'EnvironmentFile=/private',b'LoadCredential=secret:/private',b'SetCredentialEncrypted=secret:private']:
            changed=original+directive+b'\n'
            with patch.object(probe,'FRAGMENT_SHA',h.sha(changed)),patch.object(probe,'protected',side_effect=lambda path:changed if path==probe.FRAGMENT else script),self.assertRaisesRegex(RuntimeError,'must_not_load_credentials'):
                probe.render()


if __name__=='__main__':unittest.main()
