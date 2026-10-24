#!/usr/bin/env python3
"""Read-only intake controls; real protected source loader, explicit leaf fixtures."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('ypal-alchemy-consumer-current-context-v1.py')
spec=importlib.util.spec_from_file_location('actual_intake',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def fixture():
    actor={'unit':{'Id':m.UNIT,'InvocationID':'actual-fixture-epoch'},'parent':{'pid':123,'startTicks':456},'processes':[{'pid':123,'startTicks':456}]}
    native={'schemaOid':m.DATA['schemaOid'],'tables':{str(i):{'oid':str(i),'owner':'73004621','kind':'r'}for i in range(44)},
        'cache':{'schemaOid':'same-fixture-cache'},'app':{'build_id':m.DATA['buildId'],'is_ready':1,'heartbeat_at':100},'clock':101,'checkpoints':{'8453':{'safe':'point'}}}
    row={'completed':True,'startIntentSha256':m.START_SHA,'original440PaidStartAcknowledged':False,'source':actor,'native':copy.deepcopy(native)}
    proof={'validated':True,'currentWriterQualified':True,'completionResultSha256':m.RESULT_SHA,'original440PaidStartAcknowledged':False,
        'financialAuthorityQualified':False,'sourcePID':123,'sourceReadinessQualified':True,'positiveKernelSessions':5}
    op={'chainRouting':{'ethereum':'paid_primary','base':'paid_primary','polygon':'paid_primary','bnb':'paid_logs_free_blocks'},
        'planSha256':'a'*64,'financialPlan':{'expiresMs':2000000000000}}
    manifest={'sources':[{'id':'source-'+str(i),'chainId':8453,'fixture':i}for i in range(12)]}
    marker={'singleton':True,'identity':m.DATA['readIdentity'],'release_id':m.DATA['sourceRelease'],
        'manifest_hash':m.DATA['manifestHash'],'definitions':[{'collection':'fixture'}]}
    registered={'registered':True,'releaseId':m.DATA['sourceRelease'],'manifestHash':m.DATA['manifestHash'],
        'sourceReceiptSha256':'old-source-receipt','activeReleaseChanged':False}
    created={'created':True,'selected':False,'readSchema':m.DATA['readSchema'],'readIdentity':m.DATA['readIdentity'],
        'sourceRelease':m.DATA['sourceRelease'],'target':{'schemaOid':m.DATA['readSchemaOid'],'marker':copy.deepcopy(marker)}}
    data={'registered':{'id':m.DATA['sourceRelease'],'schema':m.DATA['schema'],'build':m.DATA['buildId'],
        'manifestHash':m.DATA['manifestHash'],'manifest':copy.deepcopy(manifest)},'readSchemaOid':m.DATA['readSchemaOid'],'marker':marker,
        'sources':sorted([{'id':row['id'],'chainId':row['chainId'],'manifestHash':m.DATA['manifestHash'],'definition':row}
        for row in copy.deepcopy(manifest['sources'])],key=lambda row:row['id'])}
    documents={'registered':registered,'profile':{'manifest':manifest},m.READ_CREATED:created}
    registration=types.SimpleNamespace(REGISTERED='registered',REGISTERED_SHA='fixture-sha',PROFILE='profile',PROFILE_SHA='fixture-sha',
        C96='old-source-receipt',document=lambda path,pin:copy.deepcopy(documents[path]),
        validate_runtime=lambda:(_ for _ in()).throw(AssertionError('old active source predicate must never run')))
    c=types.SimpleNamespace(digest=lambda name:m.RESULT_SHA if name=='result.json'else m.START_SHA,current=lambda:copy.deepcopy(proof),
        record=lambda name:copy.deepcopy(row),h=types.SimpleNamespace(source=types.SimpleNamespace(native=lambda:copy.deepcopy(native),query=lambda sql:copy.deepcopy(data))),
        registration=registration,registrationData=data,
        owner=types.SimpleNamespace(c=types.SimpleNamespace(fowner=types.SimpleNamespace(m=types.SimpleNamespace(RELEASE=m.DATA['sourceRelease'],MANIFEST=m.DATA['manifestHash']))),operation=lambda:copy.deepcopy(op)))
    return c,native,row,proof


def observe(c):
    with patch.object(m,'_completion',return_value=c),patch.object(m,'_registration_context',return_value=c.registration):
        return m.observe_runtime()


class Controls(unittest.TestCase):
    def test_fresh_actual_leaf_checks_bound_actor_and_same44_without_consumer_authority(self):
        c,native,row,proof=fixture();calls=[]
        def current():calls.append('full-real-leaf');return copy.deepcopy(proof)
        c.current=current
        v=observe(c)
        self.assertEqual(calls,['full-real-leaf','full-real-leaf'])
        self.assertEqual(v['binding']['sourceKernelActors'],{m.UNIT:row['source']})
        self.assertEqual(len(v['binding']['nativeTableIdentities']),44)
        self.assertTrue(v['binding']['currentWriterQualified']);self.assertFalse(v['binding']['forwardConsumerMutationQualified'])
        self.assertFalse(v['binding']['oldRestoredSourceContextPassed']);self.assertFalse(v['binding']['financialAuthorityQualified'])
        self.assertEqual(v['binding']['automaticReturnAtMs'],v['binding']['expiresMs']-300000)

    def test_progress_readiness_and_pool_count_are_observations_not_stable_identity(self):
        c,native,row,proof=fixture()
        first=observe(c)
        native['clock']+=100;native['app'].update(is_ready=0,heartbeat_at=200);native['checkpoints']['8453']['safe']='new-point'
        proof.update(sourceReadinessQualified=False,positiveKernelSessions=3)
        second=observe(c)
        self.assertEqual(first['binding'],second['binding']);self.assertEqual(first['bindingSha256'],second['bindingSha256'])
        self.assertNotEqual(first['observation'],second['observation'])

    def test_foreign_dataset_epoch_ACK_or_model_refuses(self):
        for kind in ['schema','cache','table','build','pid','ACK','model','registered','manifest','source-definition','read-marker','read-oid']:
            with self.subTest(kind=kind):
                c,native,row,proof=fixture()
                if kind=='schema':native['schemaOid']='foreign'
                elif kind=='cache':native['cache']['schemaOid']='foreign'
                elif kind=='table':native['tables']['0']['oid']='foreign'
                elif kind=='build':native['app']['build_id']='foreign'
                elif kind=='pid':proof['sourcePID']=124
                elif kind=='ACK':c.digest=lambda name:'f'*64
                elif kind=='model':c.owner.c.fowner.m.RELEASE='foreign'
                elif kind=='registered':c.registrationData['registered']['id']='foreign'
                elif kind=='manifest':c.registrationData['registered']['manifest']['sources'][0]['fixture']='foreign'
                elif kind=='source-definition':c.registrationData['sources'][0]['definition']['fixture']='foreign'
                elif kind=='read-marker':c.registrationData['marker']['identity']='foreign'
                else:c.registrationData['readSchemaOid']='foreign'
                with self.assertRaises(RuntimeError):observe(c)

    def test_only_precise_kernel_CAS_error_retries_whole_leaf_at_most_three(self):
        c,_,_,proof=fixture();calls=[]
        def current():
            calls.append(1)
            if len(calls)<3:raise RuntimeError(m.RETRY)
            return proof
        c.current=current
        attempts=[]
        with patch.object(m.time,'sleep')as sleep:self.assertEqual(m.current(c,attempts),proof)
        self.assertEqual(len(calls),3);self.assertEqual(sleep.call_count,2)
        self.assertEqual([row['fixedCode']for row in attempts],[m.RETRY,m.RETRY,None])
        calls.clear()
        def transient():
            calls.append(1)
            if len(calls)in{1,3}:raise RuntimeError(m.RETRY)
            return copy.deepcopy(proof)
        c.current=transient
        with patch.object(m.time,'sleep'):observation=observe(c)['observation']
        for side in ['Before','After']:
            self.assertEqual([row['fixedCode']for row in observation['currentLeafAttempts'+side]],[m.RETRY,None])
        c.current=lambda:(_ for _ in()).throw(RuntimeError(m.RETRY))
        with patch.object(m.time,'sleep')as sleep,self.assertRaisesRegex(RuntimeError,m.RETRY):m.current(c)
        self.assertEqual(sleep.call_count,2)
        c.current=lambda:(_ for _ in()).throw(RuntimeError('foreign_actor'))
        with patch.object(m.time,'sleep')as sleep,self.assertRaisesRegex(RuntimeError,'foreign_actor'):m.current(c)
        self.assertEqual(sleep.call_count,0)

    def test_wrong_dependency_is_refused_before_any_evaluation(self):
        with tempfile.TemporaryDirectory(prefix='.intake-source-',dir=PATH.parent)as tmp:
            root=Path(tmp);marker=root/'effect';source=root/'public.py'
            source.write_text('from pathlib import Path\nPath('+repr(str(marker))+').write_text("ran")\n')
            with self.assertRaisesRegex(RuntimeError,'before_evaluation'):m.module(source,'f'*64)
            self.assertFalse(marker.exists())
            link=root/'alias.py';link.symlink_to(source)
            with self.assertRaises(RuntimeError):m.module(link,m.sha(source.read_bytes()))
            self.assertFalse(marker.exists())

    def test_historical_exports_do_not_invoke_a_current_source_or_claim_roles(self):
        components={'sourceActorQualified':False,'financialAuthorityQualified':False,'historicalReadPlan':{'missingCount':143},
            'readerHost':object(),'historicalReadHelpers':object(),'nativeIdentity':{'static':True}}
        static=types.SimpleNamespace(query_components=lambda:components)
        with patch.object(m,'module',return_value=static),patch.object(m,'_completion',side_effect=AssertionError('current source must be separate')):
            value=m.historical_components()
        self.assertIs(value['components'],components);self.assertFalse(value['currentWriterQualified']);self.assertFalse(value['actualNewReadAdmissionQualified'])


if __name__=='__main__':unittest.main()
