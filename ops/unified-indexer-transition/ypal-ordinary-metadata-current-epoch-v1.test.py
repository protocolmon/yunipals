"""Real retained metadata body with explicit synthetic lifecycle/host fixtures."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load('ypal-ordinary-metadata-current-epoch-v1.py')
u=load('ypal-ordinary-cache-continuation-context-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.actor={'unit':{'Id':'yunipals-metadata.service','InvocationID':'fixture-new'},'main':{'pid':111,'startTicks':7},'processes':[],'commandSha256':'d'*64}
        self.historical={**self.actor,'unit':{**self.actor['unit'],'InvocationID':'fixture-historical'},'main':{'pid':110,'startTicks':6}}
        self.boot={'fixtureActualRetainedBoot':True};self.input_sha='a'*64;self.operation_sha='b'*64
        self.code=b"SOURCE_PINS={'ypal-ordinary-metadata-handover-v5.py':'"+m.LEGACY_SHA.encode()+b"'}\n"
        self.owner_sha=u.sha(self.code);self.source={'format':m.OWNER_FORMAT+'-source','files':{m.OWNER:self.owner_sha,m.LEGACY.name:m.LEGACY_SHA}}
        self.source_raw=(json.dumps(self.source,sort_keys=True,indent=2)+'\n').encode()
        self.refs={'mode':'current','resultSha256':'e'*64,'inputSha256':self.input_sha,'producerSha256':self.owner_sha,'manifestSha256':u.sha(self.source_raw)}
        self.manifest={'files':{},'dependencies':{**self.source['files'],m.OWNER_MANIFEST:self.refs['manifestSha256']}}
        self.ack={'format':m.OWNER_FORMAT,'validated':True,'operatorSha256':self.owner_sha,'receiptSha256':self.refs['resultSha256'],
            'inputSha256':self.input_sha,'operationSha256':'c'*64,'metadataInputSha256':'f'*64,
            'metadataOperationSha256':self.operation_sha,'metadataSelectedSha256':m.SELECTED_SHA,'actor':self.actor,'boot':self.boot,
            'historicalActor':self.historical,'historicalBoot':self.boot,'artifactDigest':m.ARTIFACT,
            'artifactManifestSha256':m.ARTIFACT_MANIFEST,'workerSha256':m.WORKER_SHA,'immutableAcknowledgementOnly':True,
            'sourceActorQualified':False,'READAuthorityQualified':False,'publicationAuthorityQualified':False,
            'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.current={**copy.deepcopy(self.ack),'currentActorQualified':True}
        self.owner=types.SimpleNamespace(FORMAT=m.OWNER_FORMAT,FILE=m.OPS/m.OWNER,
            acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(self.ack)),
            actor_current=Mock(side_effect=lambda *_:copy.deepcopy(self.current)),
            inverse_acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(self.ack)),
            restored_actor_current=Mock(side_effect=lambda *_:copy.deepcopy(self.current)))
        self.utility=types.SimpleNamespace(**u.__dict__)
        def public(path,digest=None,maximum=4000000):
            path=Path(path)
            raw=self.code if path==m.OPS/m.OWNER else self.source_raw if path==m.OPS/m.OWNER_MANIFEST else(HERE/path.name).read_bytes()
            u.need(digest is None or u.sha(raw)==digest,'actual_fixture_source_digest_required');return raw
        self.utility.public=public;self.utility.load=self.loaded
        self.enterContext(patch.object(m,'utility',return_value=self.utility))

    def loaded(self,path,digest):
        self.utility.public(path,digest)
        if Path(path)==m.OPS/m.OWNER:return self.owner
        if Path(path)==m.LEGACY:return types.SimpleNamespace(namespace=lambda _:self.legacy)
        raise AssertionError('unexpected fixture module '+str(path))

    def epoch(self,inverse=False):return m.Epoch(self.refs,self.manifest,inverse)

    def restored(self):
        forward=copy.deepcopy(self.refs);self.refs['mode']='restored';self.refs['resultSha256']='1'*64
        self.ack.update(receiptSha256=self.refs['resultSha256'],artifactDigest=m.PREDECESSOR_ARTIFACT,
            artifactManifestSha256=m.PREDECESSOR_MANIFEST,workerSha256=m.PREDECESSOR_WORKER_SHA,
            actor={**copy.deepcopy(self.actor),'main':{'pid':112,'startTicks':8}},upgradeResultSha256=forward['resultSha256'])
        self.current={**copy.deepcopy(self.ack),'currentActorQualified':True};return forward

    def legacy_host(self):
        old=load(m.TEMPLATE.name);calls=[];selection={'selected':True,'nativeActor':self.historical,'boot':self.boot};control=self
        operation={'oldWriter':{'fixturePrivate':True}}
        class Host:
            def __init__(self,config,refresh,inverse=False,primitives=None,admission_ref=None):
                self.admission_pin=config['admissionSha256'];self.read_config=config;self.refresh_callback=refresh
                self.s=types.SimpleNamespace(document=lambda path,digest=None:copy.deepcopy(selection),protected=lambda path:b'fixture-private')
                self.refresh()
            def refresh(self):calls.append('complete-current-READ');return self.refresh_callback()
            def query(self,sql):calls.append('current-READ-object-identity');return{'fixtureReadObjectIdentity':True}
            def actor(self,*_):calls.append('genuine-old-actor');return copy.deepcopy(control.ack['actor'])
            def private(self,value):control.assertEqual(value,operation['oldWriter']);calls.append('old-private')
            def database(self):calls.append('native-database');return copy.deepcopy(control.database)
            def publication_proof(self):calls.append('full-canonical-publication');return copy.deepcopy(control.publication)
        old.Host=Host;old.BASE=m.OPS/'fixture-old-metadata';old.operation=lambda host,digest:operation
        old.link=lambda _:copy.deepcopy(self.boot);old.sha=u.sha;old.encoded=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
        old.Host=Host;self.legacy=old;self.calls=calls;self.selection=selection
        self.database={'probe':True,'scan':{'ingestion_mode':'native'},'remainingPublished':0}
        self.publication={'allPublishedCanonical':True,'officialSqlSha256':'4'*64}
        self.read_config={'admissionSha256':'2'*64,'readPlanSha256':'3'*64,'readContextInputSha256':'4'*64}
        self.primitives={'readConfig':self.read_config,'admission_ref':{'fixtureAdmission':True}}
        self.phase=types.SimpleNamespace(metadata_primitives=lambda:self.primitives)
        self.candidate={'metadataOperationSha256':self.operation_sha,'readAdmissionSha256':self.read_config['admissionSha256']}
        return old

    def test_default_import_and_CLI_are_inert(self):
        value=json.loads(subprocess.run(['python3','-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True).stdout)
        self.assertTrue(value['staticOnly']);self.assertFalse(value['historicalSelectedActorQualifiedAsCurrent'])
        self.assertEqual(value['databaseWrites'],value['serviceActions']);self.assertEqual(value['databaseWrites'],0)

    def test_lifecycle_closure_is_authenticated_before_evaluation(self):
        self.assertTrue(self.epoch().ack['validated'])
        bad=copy.deepcopy(self.manifest);bad['dependencies'].pop(m.LEGACY.name)
        with patch.object(self.utility,'load')as evaluated:
            with self.assertRaisesRegex(RuntimeError,'complete_actual_metadata_epoch_closure'):
                m.Epoch(self.refs,bad)
            evaluated.assert_not_called()

    def test_direction_requires_exact_five_actual_refs(self):
        for inverse in [True,'inverse']:
            with self.assertRaisesRegex(RuntimeError,'five_refs_and_direction'):m.Epoch(self.refs,self.manifest,inverse)
        with self.assertRaises(RuntimeError):m.checked_refs(u,{**self.refs,'unownedActor':self.actor},False)

    def test_historical_actor_or_foreign_program_is_never_new_current(self):
        for key,value in [('actor',self.historical),('workerSha256','1'*64),('artifactDigest',m.PREDECESSOR_ARTIFACT),
            ('metadataSelectedSha256','5'*64),('boot',{'different':True})]:
            previous=copy.deepcopy(self.ack);self.ack[key]=value
            with self.assertRaises(RuntimeError):self.epoch()
            self.ack=previous

    def test_current_actor_is_bookended_against_exact_owned_ACK(self):
        epoch=self.epoch();self.assertEqual(epoch.current()['actor'],self.actor)
        self.current['actor']['main']['pid']=999
        with self.assertRaisesRegex(RuntimeError,'same_actual_owned_metadata_epoch_actor'):epoch.current()

    def test_retained_metadata_body_executes_full_READ_database_publication_and_bookends(self):
        self.legacy_host();n=m.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        refresh=Mock(return_value={'fixtureReadProof':True})
        result=n.metadata(self.phase,self.candidate,self.selection,refresh)
        self.assertEqual(self.calls,['complete-current-READ','old-private','native-database','full-canonical-publication','complete-current-READ','old-private'])
        self.assertEqual(refresh.call_count,2);self.assertEqual(self.owner.actor_current.call_count,2)
        self.assertEqual(result['historicalMetadataOperatorSha256'],m.LEGACY_SHA)
        self.assertNotEqual(result['metadataOperatorSha256'],m.LEGACY_SHA)
        self.assertFalse(result['historicalSelectedActorQualifiedAsCurrent']);self.assertTrue(result['allPublishedCanonical'])
        self.assertEqual(n.metadata.__code__.co_freevars,())

    def test_every_genuine_native_canonical_gate_remains_hard(self):
        self.legacy_host();n=m.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        cases=[('probe',False),('remainingPublished',1)]
        for key,value in cases:
            previous=copy.deepcopy(self.database);self.database[key]=value
            with self.assertRaisesRegex(RuntimeError,'current_native_metadata_and_full_published'):
                n.metadata(self.phase,self.candidate,self.selection,lambda:None)
            self.database=previous
        self.publication['allPublishedCanonical']=False
        with self.assertRaisesRegex(RuntimeError,'current_native_metadata_and_full_published'):
            n.metadata(self.phase,self.candidate,self.selection,lambda:None)

    def test_actual_PreparedMetadata_invoke_reuses_host_and_exact_constructor_bindings(self):
        self.legacy_host();n=m.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        first=Mock(return_value={'initialRead':True});host=n.construct_context(self.read_config,first,False,self.primitives,self.primitives['admission_ref'])
        caller=load('ypal-ordinary-publication-caller-v6.py');slot=object.__new__(caller.PreparedMetadata)
        slot.n=n;slot.phase=self.phase;slot.inverse=False;slot.p=self.primitives;slot.host=host
        slot.paths={'fixture-recorded-file'};slot.records={'fixture-file-SHA':'8'*64};slot.sql='fixture-pure-READ-object-SQL'
        slot.target={'fixtureReadObjectIdentity':True}
        slot.g=types.SimpleNamespace(file_frame=lambda paths:copy.deepcopy(slot.records),read_data_identity=lambda value:value)
        refresh=Mock(return_value={'actualPreparedRead':True});self.calls.clear()
        with patch.object(n,'construct_context',side_effect=AssertionError('prepared host reconstructed'))as construct:
            result=caller.PreparedMetadata.invoke(slot,self.candidate,refresh,self.selection)
            construct.assert_not_called()
        self.assertIs(slot.host,host);self.assertIs(host.refresh_callback,refresh)
        self.assertEqual(refresh.call_count,2);self.assertEqual(first.call_count,1)
        self.assertEqual(self.calls,['current-READ-object-identity','complete-current-READ','old-private','native-database',
            'full-canonical-publication','complete-current-READ','old-private'])
        self.assertTrue(result['currentNativeMetadataQualified']);self.assertFalse(result['oldWholeMetadataCurrentPassed'])
        slot.target={'foreignReadObject':True}
        with self.assertRaisesRegex(RuntimeError,'current_V5_marker_object_bodies_and_columns'):
            caller.PreparedMetadata.invoke(slot,self.candidate,refresh,self.selection)

    def test_real_old_selected_file_is_never_virtualized_as_new_actor(self):
        self.legacy_host();n=m.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        changed={**self.selection,'nativeActor':self.actor}
        with self.assertRaisesRegex(RuntimeError,'old_selected282'):
            n.metadata(self.phase,self.candidate,changed,lambda:None)

    def test_restored_worker_is_a_distinct_owned_epoch_with_shared_upgrade_ancestry(self):
        forward_epoch=self.epoch().binding();self.restored();epoch=self.epoch(True)
        epoch.reader_operation(forward_epoch)
        self.assertEqual(epoch.current()['workerSha256'],m.PREDECESSOR_WORKER_SHA)
        self.owner.actor_current.assert_not_called();self.owner.restored_actor_current.assert_called_once()
        bad=copy.deepcopy(forward_epoch);bad['refs']['resultSha256']='7'*64
        with self.assertRaisesRegex(RuntimeError,'same_lifecycle_upgrade_then_owned'):epoch.reader_operation(bad)

    def test_source_guard_and_prior_cache_private_scope_exclude_metadata_actor(self):
        source=load('ypal-ordinary-source-authority-v5.py')
        authority=object.__new__(source.Authority)
        authority.runtime=types.SimpleNamespace(CHAINS=['base','ethereum','polygon','bnb'])
        authority.owner=types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(rpc=types.SimpleNamespace(PROXY_UNITS=['fixture-proxy'])),proxy_unit=lambda chain:'fixture-'+chain))
        self.assertNotIn('yunipals-metadata.service',authority._units())
        cache=load('ypal-cache-guard-owner-v1.py')
        tree=ast.parse((HERE/'ypal-cache-guard-owner-v1.py').read_bytes());host=next(node for node in tree.body if isinstance(node,ast.ClassDef)and node.name=='Host')
        private=next(node for node in host.body if isinstance(node,ast.FunctionDef)and node.name=='private')
        self.assertIn("self.candidate['originalCacheWriter']",ast.unparse(private));self.assertNotIn('metadata',ast.unparse(private))


if __name__=='__main__':unittest.main()
