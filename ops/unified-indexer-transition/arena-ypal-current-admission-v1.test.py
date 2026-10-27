#!/usr/bin/env python3
"""Focused current-admission composition and genuine reused child protocol."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location('test_'+name.replace('.','_'),HERE/name)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

m=load('arena-ypal-current-admission-v1.py');oldctx=load('arena-ypal-native-v2.context.py')
f=load('arena-ypal-native-v2.admission.test.py')
old=json.loads((HERE/'arena-ypal-native-v1.proposal.json').read_text())
proposal=json.loads((HERE/'arena-ypal-current-admission-v1.proposal.json').read_text())


def ns():
    with patch.object(m,'load',side_effect=lambda name:load(name)):
        return m.business(lambda:f.h)


class Controls(unittest.TestCase):
    def test_exact_new_proposal_preserves_all_original_SQL_scope(self):
        self.assertEqual(m.sha((HERE/m.PROPOSAL.name).read_bytes()),m.PROPOSAL_SHA)
        self.assertIs(m.validate_proposal(old,proposal),proposal)
        for change in [lambda p:p['workers'][0]['requiredEdges'].pop(),lambda p:p['sourceReader']['tables'][0].update(oid=123),
                       lambda p:p['currentAmbientAcknowledgement']['functions'][2].update(securityDefiner=True),
                       lambda p:p['currentAmbientAcknowledgement']['functions'].pop()]:
            changed=copy.deepcopy(proposal);change(changed)
            with self.assertRaises(RuntimeError):m.validate_proposal(old,changed)
        for name,pin in m.PINS.items():self.assertEqual(m.sha((HERE/name).read_bytes()),pin)

    def test_ambient_preserves_every_nonfunction_field_and_exact_descriptor(self):
        row={'oid':1,'ownerOid':73004621,'securityDefiner':False,'bodySha256':'a'*64,
             'acl':[{'granteeOid':0,'privilege':'EXECUTE'},{'granteeOid':73004621,'privilege':'EXECUTE'}]}
        before={'readOnly':True,'isolation':'repeatable read','sourceRole':[],'database':{'acl':[{'granteeOid':0},{'granteeOid':99}]},
                'schemas':[{'oid':1,'acl':[{'granteeOid':0},{'granteeOid':99}]}],'functions':[row],'defaultAcl':[]}
        current=copy.deepcopy(before);current['sourceRole']=[{'newOwnedRole':True}]
        self.assertEqual(m.ambient(before),m.ambient(current))
        for change in [lambda v:v['functions'][0].update(bodySha256='b'*64),lambda v:v['functions'][0]['acl'].append({'granteeOid':99,'privilege':'EXECUTE'}),
                       lambda v:v['defaultAcl'].append({'owner':99}),lambda v:v['schemas'][0].update(oid=2)]:
            changed=copy.deepcopy(current);change(changed);self.assertNotEqual(m.ambient(before),m.ambient(changed))
        self.assertEqual(m.descriptor(row)['otherNonownerAclCount'],0)
        changed=copy.deepcopy(row);changed['acl'].append({'granteeOid':99,'privilege':'EXECUTE'})
        self.assertNotEqual(m.descriptor(row),m.descriptor(changed))

    def test_actual_reused_inspect_and_rollback_methods_use_new_context(self):
        cls=m.context_type(oldctx)
        self.assertIs(cls.inspect.__code__,oldctx.Context.inspect.__code__)
        self.assertIs(cls.rehearse.__code__,oldctx.Context.rehearse.__code__)
        h=cls.__new__(cls);calls=[]
        h.load_proposal=lambda:proposal;h.PINS={'arena-ypal-native-v1.proposal.json':m.PROPOSAL_SHA,'operational-roles.current.sql.review':'a'*64,'arena-ypal-native-v1.source.sql.review':'b'*64}
        h.HISTORICAL_OP=Path('old.sql');h.read=lambda *a:b'BEGIN;COMMIT;\n';h.rollback_sql=lambda raw:b'BEGIN;ROLLBACK;\n'
        h.TARGETS=[(15438,'yunipals_arena'),(5432,'yunipals_backfill')];h.catalog=lambda *a:{'same':True}
        h.context=lambda p:calls.append('new-context')or{'source':'new-current'};h.source_ambient=lambda:{'newAmbient':True}
        h.acknowledged=lambda:{'actual8':True};h.sha=m.sha;h.encoded=lambda v:json.dumps(v,sort_keys=True).encode();h.need=m.need
        p,sqls,roles,before,binding=h.inspect()
        self.assertEqual(binding['format'],m.FORMAT+'-rehearsal');self.assertEqual(binding['context'],{'source':'new-current'})
        h.peer_args=lambda *a,**kw:['no-manager'];h.run=lambda *a,**kw:b'';h.NO_PASSWORD=Path('/nonexistent/arena-current-test')
        result=h.rehearse(p,sqls,roles,before,binding,h.sha(h.encoded(binding)))
        self.assertEqual(result['format'],m.FORMAT+'-rehearsal');self.assertEqual(len(result['rehearsals']),2)
        self.assertGreaterEqual(len(calls),4)

    def test_source_CAS_requires_real_bound_actor_loaded_mounts_native_and_deadline(self):
        cls=m.context_type(oldctx);h=cls.__new__(cls);actor={'parent':{'pid':4},'unit':{'InvocationID':'owned'}}
        native={'schemaOid':'75963410','tables':{'44':'same'},'cache':{'sync':'same'},'app':{'build_id':'71e2a7f3b7'}}
        binding={'source':copy.deepcopy(actor),'schemaOid':native['schemaOid'],'nativeTableIdentities':copy.deepcopy(native['tables']),
                 'syncCacheIdentity':copy.deepcopy(native['cache']),'buildId':'71e2a7f3b7','automaticReturnAtMs':int(time.time()*1000)+100000}
        h.source_binding=binding;h.intake=types.SimpleNamespace(UNIT='actual-unit',sha=m.sha,encoded=m.encoded);calls=[]
        current={'actor':copy.deepcopy(actor),'inputs':{'private':'hash'},'native':native}
        h.completion=types.SimpleNamespace(h=types.SimpleNamespace(restore=types.SimpleNamespace(canonical_actor=lambda x:x),source=types.SimpleNamespace(
            actor=lambda unit:copy.deepcopy(current['actor']),inputs=lambda:current['inputs'],native=lambda:current['native'])),
            owner=types.SimpleNamespace(operation=lambda:{'inputs':{'private':'hash'}}),loaded=lambda mode:calls.append(mode))
        self.assertEqual(h.source_cas(),m.sha(m.encoded(binding)));self.assertEqual(calls,['paid'])
        for key in ['actor','private','native','deadline']:
            with self.subTest(key=key):
                saved=copy.deepcopy(current);saved_binding=copy.deepcopy(binding)
                if key=='actor':current['actor']['parent']['pid']=5
                elif key=='private':current['inputs']['private']='foreign'
                elif key=='native':current['native']['cache']['sync']='foreign'
                else:binding['automaticReturnAtMs']=0
                with self.assertRaises(RuntimeError):h.source_cas()
                current.clear();current.update(saved);binding.clear();binding.update(saved_binding)

    def test_outer_full_source_compares_stable_binding_not_progress(self):
        cls=m.context_type(oldctx);h=cls.__new__(cls);h.source_binding=None;h.source_observations=[];h.completion=None
        binding={'intakeOnly':True,'currentWriterQualified':True,'completionReceiptSha256':'actual','sourceEpoch':'acknowledged-alchemy-completion','source':{'pid':1}}
        observation={'progress':1};h.intake=types.SimpleNamespace(RESULT_SHA='actual',observe_runtime=lambda:{'binding':copy.deepcopy(binding),'observation':copy.deepcopy(observation)},_completion=lambda:object())
        h.full_source();observation['progress']=2;h.full_source();self.assertEqual(len(h.source_observations),2)
        binding['source']['pid']=2
        with self.assertRaisesRegex(RuntimeError,'epoch_or_dataset'):h.full_source()

    def test_reused_business_is_new_namespace_with_same_SQL_protocol_bytecode(self):
        n=ns();old=load('arena-ypal-native-v2.admission.py')
        for name in ['boundary','catalog_sql','validate_catalog','review','reconcile','final_receipt']:
            self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code)
            self.assertIs(getattr(n,name).__globals__,n.__dict__)
        self.assertEqual(n.FORMAT,m.FORMAT);self.assertEqual(n.BASE,m.BASE);self.assertEqual(n.RUNNER_SHA,m.own_sha())
        self.assertEqual(old.FORMAT,'yunipals-arena-ypal-admission-v2');self.assertNotEqual(old.BASE,n.BASE)

    def test_actual_reused_child_protocol_commit_ACK_lost_ACK_and_changed_context(self):
        n=ns();case=f.Admission(methodName='test_real_child_protocol_persists_actual_oids_before_commit_then_ack');case.setUp()
        try:
            with patch.object(f,'m',n):
                with tempfile.TemporaryDirectory()as tmp:
                    result=case.protocol(tmp);self.assertEqual(result['commitOutcome'],'commit_confirmed')
                with tempfile.TemporaryDirectory()as tmp:
                    with self.assertRaises(f.h.RehearsalFailure):case.protocol(tmp,lost_ack=True)
                    self.assertTrue((Path(tmp)/'source-commit-intent.json').exists());self.assertFalse((Path(tmp)/'source-result.json').exists())
                with tempfile.TemporaryDirectory()as tmp:
                    with self.assertRaises(f.h.RehearsalFailure):case.protocol(tmp,context_changed=True)
                    self.assertFalse((Path(tmp)/'source-commit-intent.json').exists())
        finally:case.doCleanups()

    def test_current_23_function_catalog_keeps_exact_13_and227_and_rejects_column_write(self):
        n=ns();case=f.Admission();case.setUp()
        try:
            for scope in n.SCOPES:
                doc,oids=f.fixture(scope);p=copy.deepcopy(f.proposal)
                if scope=='source':
                    rows=proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions'];p['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']=rows
                    doc['publicExecutableFunctions']=rows;doc['roles'][0]['functionExecuteCount']=23
                self.assertEqual(n.validate_catalog(f.h,p,scope,doc,oids)['requiredEdges'],227 if scope=='operational' else 13)
                doc['roles'][0]['extraColumnPrivilegeCount']=1
                with self.assertRaises(f.h.RehearsalFailure):n.validate_catalog(f.h,p,scope,doc,oids)
        finally:case.doCleanups()

    def test_immutable_ack_recomputes_real_journal_chain_without_initial_writer(self):
        n=ns();h=types.SimpleNamespace(sha=m.sha,encoded=lambda v:json.dumps(v,sort_keys=True,separators=(',',':')).encode(),
            PINS={'arena-ypal-native-v1.proposal.json':m.PROPOSAL_SHA,'operational-roles.current.sql.review':'a'*64,
                  'arena-ypal-native-v1.source.sql.review':'b'*64},acknowledged=lambda:{'recorded8':True},
            full_source=lambda:(_ for _ in()).throw(AssertionError('old paid writer must not be used')))
        with tempfile.TemporaryDirectory(prefix='.current-ack-test-',dir=HERE)as tmp,patch.object(m,'BASE',Path(tmp)/'admission'),patch.object(m,'REHEARSAL',Path(tmp)/'rollback'),patch.object(m,'create',return_value=(h,n)):
            m.BASE.mkdir();m.REHEARSAL.mkdir();h.read=lambda path,pin,*a:Path(path).read_bytes()
            def write(path,value):path.write_bytes(h.encoded(value));return m.sha(path.read_bytes())
            binding={'operatorSha256':m.own_sha(),'context':{'currentSourceBindingSha256':'c'*64},'catalogSha256':['d'*64,'e'*64],
                     'proposalSha256':m.PROPOSAL_SHA,'acknowledgedCurrentActors':h.acknowledged(),'oldWholeInvocationGatePassed':False,
                     'sourceAmbient':{'sourceCatalogSha256':m.CURRENT_CATALOG_SHA}}
            first={'status':'readonly_review_passed','binding':binding,'reviewHash':h.sha(h.encoded(binding))}
            first_sha=write(m.REHEARSAL/'review.json',first)
            rollback={'status':'rollback_rehearsal_passed','reviewHash':first['reviewHash'],'rehearsals':[
                {'sqlSha256':'a'*64,'catalogUnchanged':True,'rolesAbsentAfterRollback':8},
                {'sqlSha256':'b'*64,'catalogUnchanged':True,'rolesAbsentAfterRollback':1}]}
            rollback_sha=write(m.REHEARSAL/'result.json',rollback)
            write(m.REHEARSAL/'rehearsal-intent.json',{'reviewHash':first['reviewHash'],'operatorSha256':m.own_sha(),'commitAllowed':False})
            intent={**binding,'format':m.FORMAT,'rollbackOperatorSha256':m.own_sha(),'rehearsalReviewSha256':first_sha,'rehearsalResultSha256':rollback_sha}
            intent['reviewHash']=h.sha(h.encoded(intent));write(m.BASE/'intent.json',intent);parts={}
            for scope in n.SCOPES:
                doc,roles=f.fixture(scope);sql=h.PINS['operational-roles.current.sql.review'if scope=='operational'else'arena-ypal-native-v1.source.sql.review']
                prepared={'format':m.FORMAT,'scope':scope,'roles':roles,'catalog':doc};write(m.BASE/(scope+'-prepared.json'),prepared)
                commit={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':doc['markers']['backendPid'],'backendStart':doc['markers']['backendStart']}
                write(m.BASE/(scope+'-commit-intent.json'),commit)
                write(m.BASE/(scope+'-intent.json'),{'format':m.FORMAT,'scope':scope,'sqlSha256':sql,'reviewHash':intent['reviewHash']})
                part={'commitOutcome':'commit_confirmed','roles':roles,'preparedSha256':commit['preparedSha256'],'sqlSha256':sql}
                write(m.BASE/(scope+'-result.json'),part);parts[scope]=part
            result=n.final_receipt(h,intent,parts);receipt_sha=write(m.BASE/'result.json',result)
            value=m.acknowledgement(receipt_sha)
            self.assertTrue(value['recordedAdmissionQualified']);self.assertFalse(value['currentWriterQualified']);self.assertFalse(value['currentRoleGraphQualified'])
            changed=json.loads((m.BASE/'source-commit-intent.json').read_bytes());changed['backendPid']+=1;write(m.BASE/'source-commit-intent.json',changed)
            with self.assertRaisesRegex(RuntimeError,'backend_epoch'):m.acknowledgement(receipt_sha)


if __name__=='__main__':unittest.main()
