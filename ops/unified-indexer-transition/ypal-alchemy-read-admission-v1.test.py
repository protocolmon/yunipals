#!/usr/bin/env python3
"""Current READ constructor/scope and actual reused immutable lifecycle controls."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location('test_'+name.replace('.','_'),HERE/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

m=load('ypal-alchemy-read-admission-v1.py');oldtest=load('ypal-restored-read-admission-v1.test.py')

def namespace():
    with patch.object(m,'OLD',HERE/m.OLD.name):return m.namespace()


def parts():
    plan,before,after=oldtest.fixture()
    return {'historicalReadPlan':plan,'historicalReadHelpers':oldtest.f.m,'privilegedSourcePrimitives':{'host':object(),'sdk':object()},
            'catalogSql':'SELECT fixed_read_catalog','catalogSqlSha256':'c'*64},before,after


class Controls(unittest.TestCase):
    def test_explicit_constructor_is_static_and_has_no_old_runtime_or_Arena_placeholder(self):
        n=namespace();p,_,_=parts();calls=[]
        intake=types.SimpleNamespace(historical_components=lambda:calls.append('static-fbb')or{'components':p},
              validate_runtime=lambda:(_ for _ in()).throw(AssertionError('current source is separate')))
        config={'format':m.FORMAT+'-input','arenaAdmission':{'receiptSha256':'a'*64,'phase':'admitted','setupSha256':None,'authSha256':None}}
        with patch.object(m,'load',return_value=intake),patch.object(n,'module',return_value=object()),patch.object(n,'document',return_value=config),patch.object(n,'protected',return_value=b'SELECT all_columns'):
            host=n.Host('b'*64,inverse=True)
        self.assertEqual(calls,['static-fbb']);self.assertTrue(host.inverse_mode)
        self.assertEqual(host.parts,p);self.assertIsNone(host.plan)
        with patch.object(m,'load',return_value=intake),patch.object(n,'document',return_value={'format':'old-e82','arenaAdmission':None}):
            with self.assertRaisesRegex(RuntimeError,'exact_current_READ_input'):n.Host('b'*64)

    def test_pack_proof_uses_actual_current_peers_not_old_free_restore(self):
        n=namespace();host=n.Host.__new__(n.Host);calls=[];packet={'actors':{'actual':'current'},'packets':{'private':'hash'},'boots':{'actual':'inode'}}
        c=types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(pack_ready=lambda:calls.append('realHTTP'))),
              owner=types.SimpleNamespace(c=types.SimpleNamespace(peers=lambda:calls.append('actualPeers')or copy.deepcopy(packet))))
        host.intake=types.SimpleNamespace(_completion=lambda:c)
        self.assertEqual(host.pack_initial(),packet);self.assertEqual(calls,['realHTTP','actualPeers','actualPeers'])
        count=[0]
        def drift():count[0]+=1;return {'actor':count[0]}
        c.owner.c.peers=drift
        with self.assertRaisesRegex(RuntimeError,'pack_actor'):host.pack_initial()

    def test_current_Arena13_owned_edges_are_mandatory_before_baseline(self):
        edges=[{'kind':'relation','object':str(i),'object_name':'native.table'+str(i),'grantee':'900','grantor':'73004621','privilege':'SELECT','grantable':False,'column_number':None}for i in range(13)]
        catalog={'databaseOid':'17584','targetEdges':copy.deepcopy(edges)};proof={'validated':True,'ownedSourceReadEdges':edges}
        m.arena_in_catalog(catalog,proof)
        catalog['targetEdges'].pop()
        with self.assertRaisesRegex(RuntimeError,'Arena13'):m.arena_in_catalog(catalog,proof)
        proof['ownedSourceReadEdges']=[]
        with self.assertRaises(RuntimeError):m.arena_in_catalog(catalog,proof)

    def test_Arena_adapter_requires_actual_new_ACK_and_current13_catalog(self):
        n=namespace();rows=[{'name':'native.table'+str(i),'oid':i}for i in range(13)]
        role={'name':'arena_native_reader','oid':900};receipt={'operatorSha256':m.ARENA_SHA,'sourceRole':role,'roles':{'op':899}}
        catalog={'relations':rows,'roles':[{'directRelationAcl':[{'relation':row['name'],'granteeOid':900,'grantorOid':73004621,'privilege':'SELECT','grantOption':False}for row in rows]}]}
        calls=[];h=types.SimpleNamespace(load_proposal=lambda:{})
        helper=types.SimpleNamespace(acknowledgement=lambda sha:{'validated':True,'recordedAdmissionQualified':True,'sourceActorQualified':False,'currentWriterQualified':False},
             verify_current=lambda r,**kw:calls.append(kw)or{'validated':True,'currentRoleGraphQualified':True,'roleCount':9,'catalogs':{'source':{'requiredEdges':13}}},
             create=lambda:(h,types.SimpleNamespace(current_catalog=lambda *a:catalog)))
        config={'receiptSha256':'a'*64,'phase':'admitted','setupSha256':None,'authSha256':None}
        with patch.object(m,'load',return_value=helper),patch.object(n,'document',return_value=receipt):
            value=m.arena(config,n);self.assertEqual(len(value['ownedSourceReadEdges']),13);self.assertFalse(value['sourceActorQualified'])
            bad=copy.deepcopy(config);bad['setupSha256']='b'*64
            with self.assertRaisesRegex(RuntimeError,'NOLOGIN'):m.arena(bad,n)
            receipt['operatorSha256']='old5439'
            with self.assertRaisesRegex(RuntimeError,'not_old'):m.arena(config,n)
        self.assertEqual(calls,[{'phase':'admitted','password_sha256':None}])

    def test_same143_statements_delta_and_all_grantee_columns_preserve_Arena(self):
        n=namespace();p,before,after=oldtest.fixture();helpers=oldtest.f.m
        for v in [before,after]:v['read']['targetEdges'].append({'kind':'relation','object':'9000','object_name':'native.owned_arena','grantee':'900','grantor':'73004621','privilege':'SELECT','grantable':False})
        self.assertTrue(n.validate_delta(helpers,p,before,after));self.assertEqual(len(helpers.statements(p)),143)
        host=types.SimpleNamespace(sql='SELECT full_snapshot',helpers=helpers,plan=p)
        sql=n.transaction(host,before,after,True);self.assertEqual(sql.count('GRANT '),143);self.assertEqual(sql.count('COMMIT;'),1)
        self.assertIn('allColumnAcl',sql);self.assertNotIn('ALTER ROLE',sql)
        after['allColumnAcl']=[{'relation':'foreign','edges':[{'grantee':'0','privilege':'UPDATE'}]}]
        with self.assertRaisesRegex(RuntimeError,'all_grantee_column'):n.validate_delta(helpers,p,before,after)

    def test_actual_reused_commit_lost_ACK_and_graph_only_reconcile_never_regrants(self):
        n=namespace()
        with patch.object(oldtest,'m',n):
            case=oldtest.Tests(methodName='test_lost_ACK_readonly_reconcile_never_regrants');case.test_lost_ACK_readonly_reconcile_never_regrants()
            case.test_wrong_SQL_authorization_or_runtime_refuses_before_intent()

    def test_initial_inverse_terminal_maps_all_remaining_writer_sessions_and_refuses_replacement(self):
        n=namespace();host=n.Host.__new__(n.Host);p,before,_=parts();source={'processes':[{'pid':999999999,'startTicks':123}]}
        expected={'source':source,'schemaOid':'75963410','nativeTableIdentities':{'44':'same'},'syncCacheIdentity':{'same':'cache'},'buildId':'71e2a7f3b7'}
        before={'stable':{'runtime':expected}};actor=[None];mapped=[]
        hsource=types.SimpleNamespace(actor=lambda *a:actor[0],inputs=lambda:{'private':'hash'},native=lambda:{'schemaOid':'75963410','tables':{'44':'same'},'cache':{'same':'cache'},'app':{'build_id':'71e2a7f3b7'}},query=lambda sql:None)
        def kernel(*args):mapped.append(args);self.assertTrue(args[-1]);return {m.FRESH:[]}
        c=types.SimpleNamespace(h=types.SimpleNamespace(source=hsource,observer=object()),loaded=lambda mode:self.assertEqual(mode,'paid'),
              owner=types.SimpleNamespace(operation=lambda:{'inputs':{'private':'hash'}},c=types.SimpleNamespace(peers=lambda:{'actors':{m.FRESH:{'actual':'fresh'}}})),
              c=types.SimpleNamespace(host_module=types.SimpleNamespace(kernel_backends=kernel)))
        host.intake=types.SimpleNamespace(_completion=lambda:c,UNIT='actual-source');host.runtime=lambda:{'foreign':'newEpoch'}
        value=host.inverse_source(before);self.assertTrue(value['sourceTerminalQualified']);self.assertFalse(value['currentWriterQualified']);self.assertEqual(len(mapped),1)
        c.c.host_module.kernel_backends=lambda *a:(_ for _ in()).throw(RuntimeError('escaped_writer_backend'))
        with self.assertRaisesRegex(RuntimeError,'escaped_writer'):host.inverse_source(before)
        actor[0]={'foreign':'replacement'}
        with self.assertRaisesRegex(RuntimeError,'acknowledged_paid_source'):host.inverse_source(before)

    def test_catalog_leaf_is_current_graph_only_after_writer_handover(self):
        n=namespace();_,_,after=oldtest.fixture();h=types.SimpleNamespace(catalog=lambda:copy.deepcopy(after),runtime=lambda:(_ for _ in()).throw(AssertionError('old actor must not run')))
        with patch.object(n,'admitted_components',return_value={'host':h,'rehearsal':{'after':after},'reference':{'receiptSha256':'actual'}}):
            value=n.validate_catalog_current('actual');self.assertTrue(value['currentRoleGraphQualified']if 'currentRoleGraphQualified'in value else value['catalogOnly'])
            self.assertFalse(value['sourceActorQualified']);self.assertFalse(value['sourceReadinessQualified'])
            h.catalog=lambda:{**after,'allColumnAcl':[{'foreign':'column'}]}
            with self.assertRaisesRegex(RuntimeError,'all_grantee_columns'):n.validate_catalog_current('actual')

    def test_pure_ack_reaches_real_journal_validation_without_Host_or_database(self):
        n=namespace()
        with patch.object(oldtest,'m',n):
            case=oldtest.Tests();host,state,before=case.lifecycle('normal')
            with tempfile.TemporaryDirectory(prefix='.current-read-ack-',dir=HERE)as tmp:
                base=Path(tmp);input_file=base/'input.json';plan_file=base/'plan.json'
                config={'format':m.FORMAT+'-input','arenaAdmission':{'receiptSha256':'a'*64,'phase':'admitted','setupSha256':None,'authSha256':None}}
                n.save(input_file,config);host.context_input=n.sha(input_file.read_bytes());before['contextInputSha256']=host.context_input
                historical=copy.deepcopy(host.plan);historical['baselineCatalog']=copy.deepcopy(state['catalog']['read'])
                for field in ['sourceRelease','readIdentity','physicalSchema','physicalSchemaOid','readSchema','readSchemaOid','createdReceiptSha256']:historical[field]='fixed-'+field
                plan=copy.deepcopy(historical);plan.update({'format':m.FORMAT+'-plan','historicalPlanSha256':n.HISTORICAL_SHA,
                    'contextOperatorSha256':'e'*64,'contextInputSha256':host.context_input,'newRoles':0,'loginChanges':0,'newDml':0,
                    'columnsSqlSha256':n.COLUMNS_SHA,'catalogSqlSha256':'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991',
                    'catalogBefore':copy.deepcopy(state['catalog']),'sourceIntakeProducerSha256':m.INTAKE_SHA,'arenaAdmission':config['arenaAdmission']})
                plan['planReviewHash']=n.sha(n.encoded(plan));n.save(plan_file,plan);host.plan=plan;host.plan_sha=n.sha(plan_file.read_bytes());before['planSha256']=host.plan_sha
                before['reviewHash']=n.sha(n.encoded({k:v for k,v in before.items()if k!='reviewHash'}))
                original_document=n.document
                def document(path,expected=None):
                    if str(path).endswith('ypal-combined-read-admission-input-v1-20261024/plan.json'):return copy.deepcopy(historical)
                    return original_document(path,expected)
                with (patch.object(m,'namespace',return_value=n),patch.object(m,'BASE',base),patch.object(m,'PLAN',plan_file),patch.object(m,'INPUT',input_file),
                     patch.object(n,'BASE',base),patch.object(n,'own_sha',return_value='e'*64),patch.object(n,'CONTEXT_SHA','e'*64),patch.object(n,'boot',return_value='boot'),
                     patch.object(n,'module',return_value=oldtest.f.m),patch.object(n,'document',side_effect=document),patch.object(n,'Host',side_effect=AssertionError('no Host/DB/current writer'))):
                    case.prepare(host,before,base);n.commit(host,before['reviewHash'],n.sha(n.encoded(host.helpers.statements(host.plan))))
                    receipt_sha=n.sha((base/'result.json').read_bytes());value=m.acknowledgement(receipt_sha)
                    self.assertTrue(value['immutableAdmissionOnly']);self.assertFalse(value['currentWriterQualified']);self.assertFalse(value['currentRoleGraphQualified'])
                    changed=json.loads((base/'commit-intent.json').read_bytes());changed['postgraphSha256']='f'*64;(base/'commit-intent.json').write_bytes(n.encoded(changed))
                    with self.assertRaisesRegex(RuntimeError,'admission_chain'):m.acknowledgement(receipt_sha)


if __name__=='__main__':unittest.main()
