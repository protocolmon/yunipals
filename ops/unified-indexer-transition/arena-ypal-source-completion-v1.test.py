#!/usr/bin/env python3
"""Source-only continuation tests; genuine retained child protocol, private fixtures."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location('test_'+name.replace('.','_'),HERE/name);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v

m=load('arena-ypal-source-completion-v1.py');f=load('arena-ypal-native-v2.admission.test.py');current_tests=load('arena-ypal-current-admission-v1.test.py')


def namespace():
    original=current_tests.ns();p=types.SimpleNamespace(create=lambda:(f.h,original))
    with patch.object(m,'parent',return_value=p):return m.create()


class Controls(unittest.TestCase):
    def setUp(self):
        self.case=f.Admission();self.case.setUp();self.addCleanup(self.case.doCleanups)

    def test_actual_parent_and_operational_ACK_pins_and_exact_jit_only_query_delta(self):
        self.assertEqual(m.sha((HERE/m.PARENT.name).read_bytes()),m.PARENT_SHA)
        self.assertEqual(m.OPERATIONAL_RESULT_SHA,'ec196512185ad685998c118d4dc92803c885532fb2ed65095eec6484ab0f15af')
        h,n=namespace();original=current_tests.ns()
        for scope in n.SCOPES:
            before=original.catalog_sql(h,f.proposal,scope);after=n.catalog_sql(h,f.proposal,scope)
            self.assertEqual(after.replace('SET LOCAL jit=off;',''),before)
            self.assertEqual(after.count('SET LOCAL jit=off;'),1 if scope=='source'else 0)
            self.assertIn("statement_timeout='5s'",after)
        raw=(HERE/'arena-ypal-native-v1.source.sql.review').read_bytes()
        self.assertIn(b"statement_timeout='15s'",raw);self.assertEqual(m.sha(raw),h.PINS['arena-ypal-native-v1.source.sql.review'])

    def test_same_held_boundary_bytecode_with_new_record_domain(self):
        _,n=namespace();original=current_tests.ns()
        self.assertEqual(n.boundary.__code__.co_code,original.boundary.__code__.co_code)
        self.assertIs(n.boundary.__globals__,n.__dict__);self.assertEqual(n.FORMAT,m.FORMAT);self.assertEqual(n.BASE,m.BASE)
        self.assertNotEqual(original.BASE,n.BASE)

    def test_real_source_child_ACK_lost_ACK_and_context_change_without_operational_SQL(self):
        _,n=namespace()
        with patch.object(f,'m',n):
            with tempfile.TemporaryDirectory()as tmp:
                value=self.case.protocol(tmp);self.assertEqual(set(value['roles']),{'arena_native_reader'})
                self.assertFalse((Path(tmp)/'operational-intent.json').exists())
            with tempfile.TemporaryDirectory()as tmp:
                with self.assertRaises(f.h.RehearsalFailure):self.case.protocol(tmp,lost_ack=True)
                self.assertTrue((Path(tmp)/'source-commit-intent.json').exists());self.assertFalse((Path(tmp)/'source-result.json').exists())
            with tempfile.TemporaryDirectory()as tmp:
                with self.assertRaises(f.h.RehearsalFailure):self.case.protocol(tmp,context_changed=True)
                self.assertFalse((Path(tmp)/'source-commit-intent.json').exists())

    def setup_parent(self,parent):
        h=f.h;prepared={'format':'yunipals-arena-ypal-current-admission-v1','scope':'operational','roles':f.fixture('operational')[1],'catalog':f.fixture('operational')[0]}
        part={'commitOutcome':'commit_confirmed','acknowledgement':'explicit_commit_ack_and_fresh_catalog','roles':prepared['roles'],
              'preparedSha256':h.sha(h.encoded(prepared)),'sqlSha256':h.PINS['operational-roles.current.sql.review']}
        def save(name,value):(parent/name).write_bytes(h.encoded(value))
        intent={'format':prepared['format'],'operatorSha256':m.PARENT_SHA,'proposalSha256':m.PROPOSAL_SHA,'acknowledgedCurrentActors':h.acknowledged(),
                'context':{'same':'current-source'},'sourceAmbient':{'sourceCatalogSha256':'b'*64}}
        intent['reviewHash']=h.sha(h.encoded(intent));save('intent.json',intent)
        save('operational-prepared.json',prepared);save('operational-result.json',part)
        backend=prepared['catalog']['markers'];save('operational-commit-intent.json',{'preparedSha256':part['preparedSha256'],'backendPid':backend['backendPid'],'backendStart':backend['backendStart']})
        for scope,key in [('operational','operational-roles.current.sql.review'),('source','arena-ypal-native-v1.source.sql.review')]:
            save(scope+'-intent.json',{'format':prepared['format'],'scope':scope,'sqlSha256':h.PINS[key],'reviewHash':intent['reviewHash']})
        save('failed.json',{'format':prepared['format'],'commitOutcome':'partial_or_unknown','acknowledgedDatabaseBoundaries':{'operational':part},'automaticRetryAllowed':False})
        return intent,part,m.sha((parent/'operational-result.json').read_bytes())

    def actual_fixture_read(self,path,pin=None,*args):
        raw=Path(path).read_bytes();f.h.need(pin is None or m.sha(raw)==pin,'exact_fixture_hash_required');return raw

    def test_original_operational8_chain_exact_and_parent_source_must_stay_intent_only(self):
        h,n=namespace()
        with tempfile.TemporaryDirectory()as tmp:
            parent=Path(tmp);intent,part,pin=self.setup_parent(parent)
            with patch.object(m,'PARENT_BASE',parent),patch.object(m,'OPERATIONAL_RESULT_SHA',pin),patch.object(h,'read',side_effect=self.actual_fixture_read):
                value=m.records(h,n);self.assertEqual(value['operational']['roles'],part['roles'])
                (parent/'source-prepared.json').write_text('{}')
                with self.assertRaisesRegex(RuntimeError,'intent_only'):m.records(h,n)
                (parent/'source-prepared.json').unlink();bad=copy.deepcopy(part);bad['roles'].pop(next(iter(bad['roles'])))
                (parent/'operational-result.json').write_bytes(h.encoded(bad))
                with self.assertRaises(f.h.RehearsalFailure):m.records(h,n)

    def test_immutable_combined9_ACK_recomputes_cross_producer_chains_without_current_source(self):
        h,n=namespace()
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp);parent=root/'parent';target=root/'new';parent.mkdir();target.mkdir();intent,part,pin=self.setup_parent(parent)
            with patch.object(m,'PARENT_BASE',parent),patch.object(m,'BASE',target),patch.object(m,'OPERATIONAL_RESULT_SHA',pin),patch.object(m,'create',return_value=(h,n)),patch.object(h,'read',side_effect=self.actual_fixture_read):
                old=m.records(h,n)
                operation={'format':m.FORMAT,'operatorSha256':m.own_sha(),'parentIntentSha256':old['parentIntentSha256'],
                    'parentSourceIntentSha256':old['parentSourceIntentSha256'],'parentFailureSha256':old['parentFailureSha256'],
                    'context':intent['context'],'operationalResultSha256':pin,'sourceSqlSha256':h.PINS['arena-ypal-native-v1.source.sql.review']}
                operation['reviewHash']=h.sha(h.encoded(operation))
                def save(name,value):(target/name).write_bytes(h.encoded(value))
                save('operation.json',operation);save('rehearsed.json',{'reviewHash':operation['reviewHash'],'rolledBack':True,'sourceRoleAbsentAfter':True,'sourceSqlSha256':operation['sourceSqlSha256']})
                doc,roles=f.fixture('source');prepared={'format':m.FORMAT,'scope':'source','roles':roles,'catalog':doc};save('source-prepared.json',prepared)
                commit={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':doc['markers']['backendPid'],'backendStart':doc['markers']['backendStart']};save('source-commit-intent.json',commit)
                save('source-intent.json',{'format':m.FORMAT,'scope':'source','sqlSha256':operation['sourceSqlSha256'],'reviewHash':operation['reviewHash']})
                source={'commitOutcome':'commit_confirmed','roles':roles,'preparedSha256':commit['preparedSha256'],'sqlSha256':operation['sourceSqlSha256']};save('source-result.json',source)
                result=m.combined(h,n,operation,source);save('result.json',result)
                with patch.object(h,'full_source',side_effect=AssertionError('no current writer in immutable ACK'),create=True),patch.object(h,'source_ambient',side_effect=AssertionError('no DB in immutable ACK')):
                    value=m.acknowledgement(m.sha((target/'result.json').read_bytes()))
                self.assertFalse(value['currentWriterQualified']);self.assertTrue(value['recordedAdmissionQualified'])
                self.assertEqual(result['perDatabaseProducerSha256'],{'operational':m.PARENT_SHA,'source':m.own_sha()})
                changed=copy.deepcopy(commit);changed['backendPid']+=1;save('source-commit-intent.json',changed)
                with self.assertRaisesRegex(RuntimeError,'prepared_COMMIT'):m.acknowledgement(m.sha((target/'result.json').read_bytes()))

    def test_previous_fixed_commit_backends_must_be_absent(self):
        h,_=namespace()
        with patch.object(h,'peer_args',return_value=[]),patch.object(h,'run',return_value=b'0'):m.absent_source_backends(h)
        with patch.object(h,'peer_args',return_value=[]),patch.object(h,'run',return_value=b'1'):
            with self.assertRaisesRegex(RuntimeError,'backends_must_be_gone'):m.absent_source_backends(h)


if __name__=='__main__':unittest.main()
