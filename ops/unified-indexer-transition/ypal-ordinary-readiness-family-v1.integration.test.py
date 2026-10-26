"""Independent actual family6 epoch and post-commit READ integration controls.

Only private journal, process, clock and database I/O use explicit fixtures.
No live database, service, provider, network or effect dispatch is performed.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


family_tests=load('ypal-ordinary-readiness-family-v1.test.py')
cache_tests=load('ypal-cache-guard-owner-v1.test.py')


class Integration(unittest.TestCase):
    def setUp(self):
        self.fixture=family_tests.Controls();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.family=self.fixture.family;self.readiness=self.family.readiness

    def test_actual_new_epoch_executes_policy_actor_proof_with_raw_original_ACK(self):
        actual,controls=self.fixture.native.actor_fixture()
        epoch=self.family.metadata.Epoch(self.fixture.old.refs,self.fixture.manifest,False)
        # Replace only the protected acknowledgement I/O result in the genuine
        # Epoch constructor's owner before constructing a matching fresh Epoch.
        self.enterContext(patch.object(epoch.owner,'acknowledgement',side_effect=lambda *_:copy.deepcopy(controls.ack)))
        old_load=epoch.u.load
        owner_name='ypal-native-metadata-approval-epoch-v3.py'
        def supplied(path,digest):
            return epoch.owner if Path(path).name==owner_name else old_load(path,digest)
        self.enterContext(patch.object(epoch.u,'load',side_effect=supplied))
        refs={'mode':'current','resultSha256':actual.m.RESULT_SHA,'inputSha256':actual.m.INPUT_SHA,
            'producerSha256':actual.m.OWNER_SHA,'manifestSha256':actual.m.OWNER_MANIFEST_SHA}
        current=self.family.metadata.Epoch(refs,self.fixture.manifest,False)
        proof=current.current()
        self.assertEqual(proof['format'],family_tests.context_tests.m.FORMAT+'-metadata-actor-current')
        self.assertEqual(proof['actor'],controls.actualActor);self.assertNotEqual(proof['actor'],controls.ackActor)
        self.assertEqual(proof['upgradeAcknowledgement'],controls.ack)
        self.assertEqual(proof['operatorSha256'],self.fixture.native.ctx.source_sha)
        self.assertFalse(proof['oldMetadataCurrentObserverPassed']);self.assertFalse(proof['originalOwner3CurrentPassed'])
        self.assertEqual(current.current_capture_history[-1]['format'],family_tests.metadata.FORMAT+'-capture')
        self.assertFalse(current.current_capture_history[-1]['attempts'][-1]['discarded'])
        controls.owned=[]
        with self.assertRaises(RuntimeError):current.current()
        self.assertTrue(current.current_capture_history[-1]['attempts'][-1]['discarded'])
        self.assertEqual(len(current.current_capture_history[-1]['attempts']),1)

    def current_read_fixture(self):
        n=self.fixture.provider_namespace()
        cache=n.cache_runtime();before,after=cache_tests.catalogs();plan=cache_tests.plan()
        ack=self.readiness.ack
        row={'schema':self.fixture.native.ctx.policy.READ_SCHEMA,'name':'base_metadata_frame','arguments':'boolean',
            'oid':ack['functionOid'],'definitionMd5':ack['beforeFunctionDefinitionMd5'],'owner':'10','acl':'same-native-execute'}
        before['functions']=[copy.deepcopy(row)];after['functions']=[copy.deepcopy(row)]
        after=self.readiness.expected_catalog(after)
        # Keep actual old and new catalog fields in one real original proof.
        globals_=n.current_reads.__globals__;logins=globals_['LOGINS']
        for name,oid in logins.items():
            for catalog in[before,after]:catalog['roles'].append({'name':name,'oid':oid,'login':False})
        columns=[{'fixture':'all-grantees-all-columns'}]
        frames={'format':globals_['FORMAT'],'reviewHash':'fixture-review','bootId':'fixture-boot'}
        admission='a'*64;delta='b'*64;xid='fixture-xid'
        intent={**frames,'authorizationSha256':None,'rehearsalSha256':None}
        authorization={**frames,'readAdmissionSha256':admission,'additionalReadCount':4,'additionalReadDeltaSha256':delta}
        rehearsal={'additionalReadDeltaSha256':delta,'sql':{'resultJson':json.dumps(plan,separators=(',',':'))}}
        encoded=globals_['encoded'];sha=globals_['sha']
        raw_authorization=encoded(authorization);raw_rehearsal=encoded(rehearsal)
        intent['authorizationSha256']=sha(raw_authorization);intent['rehearsalSha256']=sha(raw_rehearsal)
        prepared={'xid':xid,'planSha256':sha(rehearsal['sql']['resultJson'].encode()),'postProof':{'catalog':after,'allColumnAcl':columns}}
        records={'authorization.json':authorization,'sql-intent.json':intent,'sql-prepared.json':prepared,'rehearsed.json':rehearsal}
        saved={**frames,'operatorSha256':'c'*64,'readAdmissionSha256':admission,'xid':xid,
            'commitIntentSha256':sha(encoded(intent)),'preparedSha256':sha(encoded(prepared)),
            'additionalReadAuthorizationSha256':sha(raw_authorization),'postProof':{'catalog':after,'allColumnAcl':columns},'result':plan}
        records['sql-committed.json']=saved
        operation={'binding':{'operatorSha256':'c'*64},'reviewHash':frames['reviewHash']}
        actual={'read':copy.deepcopy(after),'allColumnAcl':copy.deepcopy(columns)}
        read=load('ypal-restored-read-admission-v1.py')
        r=self.readiness.bind_read_namespace(read)
        r.admitted=lambda *_:({}, {}, {'after':{'read':before,'allColumnAcl':columns}})
        r.boot=lambda:frames['bootId'];r.protected=lambda path:encoded(records[Path(path).name])
        cache.document=lambda path:copy.deepcopy(records[Path(path).name]);cache.owned=lambda _:copy.deepcopy((operation,rehearsal))
        host=types.SimpleNamespace(new_read=r,cache=cache,inverse_mode=False,
            read_host=types.SimpleNamespace(catalog=lambda:copy.deepcopy(actual),runtime=lambda:{'explicitSourceIOFixtureOnly':True}),
            config={'readAdmissionSha256':admission,'readPlanSha256':'d'*64,'readContextInputSha256':'e'*64})
        return n,cache,host,before,after,actual,plan

    def test_real_cache_reads_true_accepts_owned_policy_and_only_four_READ_delta(self):
        n,cache,host,before,after,actual,plan=self.current_read_fixture()
        with self.assertRaisesRegex(RuntimeError,'all_other_roles'):
            cache_tests.m.read_extension(before,after,plan,after)
        self.assertIsNone(cache.read_extension(before,after,plan,copy.deepcopy(after)))
        proof=n.current_reads(host,True)
        self.assertTrue(proof['validated']);self.assertEqual(proof['additionalReadCount'],4)
        self.assertEqual(proof['sourceBinding'],{'explicitSourceIOFixtureOnly':True})
        self.assertEqual(actual['allColumnAcl'],[{'fixture':'all-grantees-all-columns'}])

    def test_cache_reads_true_refuses_unknown_body_foreign_ACL_and_any_column_drift(self):
        n,cache,host,before,after,actual,plan=self.current_read_fixture()
        good=copy.deepcopy(actual)
        for mutate in[lambda v:v['read']['functions'][0].update(definitionMd5='foreign'),
            lambda v:v['read']['relations'][0].update(acl='foreign unmanaged SELECT'),
            lambda v:v['read']['effective'][0]['relations'][cache_tests.m.CACHE_TABLES[0]].update(writes=True),
            lambda v:v['allColumnAcl'].append({'foreign':'column-grantee'})]:
            actual.clear();actual.update(copy.deepcopy(good));mutate(actual)
            with self.assertRaises(RuntimeError):n.current_reads(host,True)


if __name__=='__main__':unittest.main()
