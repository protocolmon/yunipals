"""Actual source closure plus synthetic runtime boundaries; no runtime receipts."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE/name); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = load('ypal-ordinary-restored-source-prefix-v1.py')
h = load('ypal-ordinary-downstream-refs-v1.py')
r = load('ypal-ordinary-downstream-refs-accept-v1.py')
f = load('ypal-ordinary-managed-runtime-v2.py')
old = load('ypal-ordinary-managed-handover-v3.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.data = copy.deepcopy(json.loads((HERE/'ypal-ordinary-reader-accept-v2.manifest.json').read_bytes())['dataIdentity'])
        self.data.update(nativeTableIdentities=[{'fixtureRelation': i} for i in range(44)], syncCacheIdentity={'fixtureCache': True}, registeredDataSha256='d'*64)
        self.native = {'schemaOid': '75963410', 'tables': self.data['nativeTableIdentities'], 'cache': self.data['syncCacheIdentity'],
            'clock': 1000100, 'app': {'build_id': '71e2a7f3b7', 'is_locked': '1', 'is_ready': '0', 'heartbeat_at': 1000050},
            'checkpoints': {chain: {key: '1'.zfill(75) for key in ['latest','safe','finalized']} for chain in ['1','56','137','8453']}}
        self.refs = {'resultSha256': '1'*64, 'inputSha256': '2'*64, 'featureInputSha256': '3'*64,
            'producerSha256': m.SOURCE_PINS[m.MANAGED], 'manifestSha256': m.SOURCE_PINS[m.MANAGED_MANIFEST]}
        self.config = {'format': m.FORMAT+'-input', 'stage': 'managed-restored', 'managedInverse': self.refs,
                       'arenaInverse': None, 'featureInverse': None}
        self.manifest = {'format': m.FORMAT+'-source', 'files': {m.FILE.name: m.own_sha(), **m.SOURCE_PINS}}
        self.envelope = {'format': 'fixtureActualBoundOwner', 'operatorSha256': self.refs['producerSha256'],
            'inputSha256': '2'*64, 'featureInputSha256': '3'*64, 'bootId': 'fixtureBoot'}
        self.actor = {'SOURCE': {'unit': {'NRestarts': '0', 'ExecStart': 'current status'}, 'processes': [{'fixturePid': 100}]},
                      'SOLANA': {'unit': {'NRestarts': '0', 'ExecStart': 'current status'}, 'processes': [{'fixturePid': 101}]}}
        self.inverse = {**self.envelope, 'restored': True, 'operationSha256': '4'*64, 'oldStandaloneReceiptRelabelled': False,
            'originalBootInodesRestored': True, 'observerRetained': True, 'financialPolicyChanged': False,
            'actors': copy.deepcopy(self.actor), 'native': self.native}
        for actor in self.inverse['actors'].values():actor['unit']['ExecStart'] = 'prior daemon presentation'
        self.rows = {'inverse-intent.json': {**self.envelope, 'operationSha256': '4'*64},
            'inverse-drained.json': {'solanaFrozen': True, 'solana': {'ledgerPrefix': {'throughId': 5}}},
            'inverse-start-SOURCE-intent.json': {'native': {'clock': 1000000, 'app': {'heartbeat_at': 999900}}},
            'inverse-start-SOLANA-intent.json': {'fixtureActualStartIntent': True}}
        self.observer = {'validated': True, 'ordinarySustainedObserver': True, 'observerCurrentQualified': True,
            'operatorSha256': '5'*64, 'receiptSha256': '6'*64, 'actor': {'fixtureObserver': True}, 'bootLink': {}, 'dataIdentity': self.data}
        self.sourcefacts = {'routes': {'fixtureActualNineRoutes': True},
            'observer': {key: self.observer[key] for key in ['operatorSha256','receiptSha256','actor','bootLink','dataIdentity']},
            'inputs': {'fixturePrivateSource': True}, 'solanaAuth': {'fixtureSolanaAuth': True}, 'legacySolanaInputs': {'fixture13Sources': True}}
        phase_fixture = load('ypal-ordinary-managed-parent-phase-v1.test.py')
        self.peers = phase_fixture.peer_frame()
        projector = load('ypal-ordinary-managed-parent-phase-v1.py')
        self.op = {'native': self.native, 'preserved': {**copy.deepcopy(self.sourcefacts), 'retainedServingPeers': projector.peer_projection(self.peers)},
            'activations': {unit: {'fixtureDefinitionAndBoot': unit} for unit in ['SOURCE','SOLANA','PARENT','FRESH','OTHER']},
            'unitDefinitionFrames': {unit: {'fixtureLoadedFrame': unit} for unit in ['SOURCE','SOLANA','PARENT','FRESH','OTHER']}}
        self.recorded_feature = {'resultSha256': '7'*64, 'manifestSha256': r.CODE[r.FEATURE_MANIFEST],
            'inputSha256': '8'*64, 'producerSha256': r.CODE[r.FEATURE], 'contextSha256': r.CODE[r.FEATURE_CONTEXT]}
        self.featureproof = {'fixtureGenuineRetirementLeaf': True}
        self.owner = o = types.SimpleNamespace()
        o.feature_runtime = types.SimpleNamespace(SOURCE='FRESH')
        o.feature = types.SimpleNamespace(runtime=lambda *_: o.feature_runtime)
        o.feature_config = {'feature': {'manifestSha256': self.recorded_feature['manifestSha256']},
                            'publicationRefs': {'feature': self.recorded_feature}}
        o.feature_retired = Mock(side_effect=lambda: copy.deepcopy(self.featureproof))
        o.bound_references = types.SimpleNamespace(ordinary={'resultSha256': '9'*64, 'inputSha256': 'a'*64})
        o.m = types.SimpleNamespace(PARENT='PARENT', SOURCE='SOURCE', SOLANA='SOLANA', WRITERS=['SOURCE','SOLANA','PARENT','FRESH','OTHER'],
            document=Mock(side_effect=lambda *_: copy.deepcopy(self.inverse)), definition_frame=lambda state: state,
            prefix_preserved=Mock())
        o.envelope = lambda: self.envelope; o.operation = lambda: self.op; o.digest = lambda _: '4'*64
        o.get = lambda name: self.rows[name]; o.has = lambda name: name in self.rows
        o.f = types.SimpleNamespace(canonical_actor=f.canonical_actor, heartbeat=f.heartbeat)
        o.restored_heartbeat = types.FunctionType(old.Owner.restored_heartbeat.__code__, {**old.__dict__, 'SOURCE': 'SOURCE'}).__get__(o)
        o.foundation = types.SimpleNamespace(dependencies=Mock(), routes=Mock(side_effect=lambda: copy.deepcopy(self.sourcefacts['routes'])),
            observer=types.SimpleNamespace(validate_current=lambda *_: copy.deepcopy(self.observer)),
            config={'observerResultSha256': '6'*64}, intake=types.SimpleNamespace(query_components=lambda: {'dataIdentity': copy.deepcopy(self.data)}))
        o.h = types.SimpleNamespace(retained_solana_auth=lambda: copy.deepcopy(self.sourcefacts['solanaAuth']),
            actor=Mock(side_effect=lambda unit, *_: copy.deepcopy(self.actor.get(unit))),
            activation=lambda unit: self.op['activations'][unit], state=lambda unit: self.op['unitDefinitionFrames'][unit],
            sessions=Mock(side_effect=lambda actors, _: {'73004621': {'owned': {unit: [{'fixtureOwnedBackend': True}] for unit in actors}}}),
            native=lambda: copy.deepcopy(self.native), sql_solana=Mock(return_value={'fixtureRealValidatedScheduleBudget': True}))
        o.legacy_inputs = lambda: copy.deepcopy(self.sourcefacts['legacySolanaInputs'])
        o.o = types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(inputs=lambda: copy.deepcopy(self.sourcefacts['inputs'])),
            r=types.SimpleNamespace(recovery_floor=Mock())), old=types.SimpleNamespace(ns=types.SimpleNamespace(native_order=Mock())), loaded_source=Mock(), peers=lambda: copy.deepcopy(self.peers))
        o.physical_definitions = Mock(); o.managed_known_gone = Mock()
        o.original_actor = Mock(side_effect=lambda unit, _: copy.deepcopy(self.actor[unit]))
        self.events = []
        self.enterContext(patch.object(m, 'bootstrap', return_value=h))
        self.enterContext(patch.object(h, 'public', side_effect=self.read))
        actual = h.evaluate
        def evaluate(raw, path):
            value = actual(raw, path)
            if Path(path).name == m.MANAGED:
                self.assertTrue(set(m.SOURCE_PINS) <= set(self.events))
                value.composition = lambda: types.SimpleNamespace(BASE=Path('/fixtureManaged'), Owner=Mock(return_value=self.owner))
            if Path(path).name == m.ACTORS:value.validate_actors = Mock(side_effect=lambda *_: copy.deepcopy(self.featureproof))
            return value
        self.enterContext(patch.object(h, 'evaluate', side_effect=evaluate))

    def read(self, path, digest, maximum=4000000):
        path = Path(path); self.events.append(path.name)
        if path == m.INPUT:raw = m.encoded(self.config)
        elif path == m.MANIFEST:raw = m.encoded(self.manifest)
        else:
            origin = HERE/path.name
            if path.name == 'final-supervisor-inventory-v1.py':origin = HERE.parent/'solana-acceptance'/path.name
            raw = origin.read_bytes()
        m.need(0 < len(raw) <= maximum and m.sha(raw) == digest, 'exact_actual_source_or_synthetic_receipt_fixture_required'); return raw

    def current(self):return m.validate_current_source(m.sha(m.encoded(self.config)))

    def feature_inverse(self):
        self.config.update(stage='feature-restored', arenaInverse={key: 'b'*64 for key in ['resultSha256','planSha256','producerSha256','manifestSha256']},
            featureInverse={**self.recorded_feature, 'resultSha256': 'c'*64})
        self.featureproof = {'format': 'yunipals-ordinary-feature-inverse-actors-v1', 'validated': True, 'operatorSha256': m.SOURCE_PINS[m.ACTORS],
            'featureOperatorSha256': self.recorded_feature['producerSha256'], 'receiptSha256': 'c'*64, 'operationSha256': 'd'*64,
            'manifestSha256': self.recorded_feature['manifestSha256'], 'inputSha256': self.recorded_feature['inputSha256'],
            'temporarySourceActor': {'unit': {}, 'processes': [{'fixtureFreshPID': 102}]}, 'temporarySourceNativeIdentity': {'fixtureFresh': True},
            'temporarySourceActorQualified': True, 'api': {'fixtureRestoredAPI': True}, 'originalBootInodeRestored': True,
            'sameProgramsPrivateInputsAndPrivilegesQualified': True, 'currentCatalogQualified': False,
            'readerAuthorityQualified': False, 'sourceActorQualified': False, 'originalWholeFeatureInverseLeafPassed': False}
        self.enterContext(patch.object(m, 'arena_current', side_effect=lambda *_: {'binding': {'fixtureActualArenaInverse': True}}))

    def test_all_actual_sources_authenticated_before_owner_and_new_inverse_epoch_proof(self):
        value = self.current()
        self.assertTrue(value['sourceOnlyCurrent']); self.assertTrue(value['currentWriterQualified'])
        self.assertFalse(value['frameworkReady']); self.assertFalse(value['sourceReadinessQualified'])
        self.assertFalse(value['originalWholeStablePassed']); self.assertFalse(value['supersededPeerFrameQualified'])
        self.assertEqual(value['registeredDataSha256'],self.data['registeredDataSha256'])
        self.assertEqual(value['dataIdentitySha256'],m.sha(m.encoded(self.data)))
        self.owner.feature_retired.assert_called(); self.assertEqual(self.owner.foundation.dependencies.call_count, 2)
        self.owner.o.loaded_source.assert_called_once_with('paid')
        self.owner.h.sessions.assert_called_once_with(self.actor, True)
        self.assertEqual(value['sourceKernelActors'], {'SOURCE': f.canonical_actor(self.actor['SOURCE'])})

    def test_owned_feature_inverse_actual_actor_classified_without_retired_or_catalog_recursion(self):
        self.feature_inverse(); value = self.current()
        self.owner.feature_retired.assert_not_called()
        actors, all_native = self.owner.h.sessions.call_args.args
        self.assertTrue(all_native); self.assertEqual(set(actors), {'SOURCE','SOLANA','FRESH'})
        self.assertFalse(value['binding']['featurePhaseBinding']['currentCatalogQualified'])
        self.assertFalse(value['financialAuthorityQualified'])

    def test_missing_owned_inverse_or_wrong_source_producer_refuses(self):
        for change in [lambda: self.inverse.update(restored=False), lambda: self.rows['inverse-intent.json'].update(operationSha256='e'*64),
                       lambda: self.refs.update(producerSha256='e'*64)]:
            saved = (copy.deepcopy(self.inverse), copy.deepcopy(self.rows), copy.deepcopy(self.refs)); change()
            with self.subTest(change=change), self.assertRaises(RuntimeError):self.current()
            self.inverse, self.rows, self.refs = saved; self.config['managedInverse'] = self.refs

    def test_changed_source_private_routes_observer_and_unexpected_other_actor_refuse(self):
        self.sourcefacts['inputs'] = {'changed': True}
        with self.assertRaises(RuntimeError):self.current()
        self.sourcefacts['inputs'] = self.op['preserved']['inputs']
        self.actor['OTHER'] = {'unit': {}, 'processes': []}
        with self.assertRaises(RuntimeError):self.current()

    def test_four_unrelated_consumer_frames_refuse_before_and_after_owned_feature_inverse(self):
        self.peers['og']['currentFrames']['yunipals-api.service'] = {'foreignPrivateOrActor': True}
        with self.assertRaisesRegex(RuntimeError, 'projected_retained'):self.current()
        self.feature_inverse()
        with self.assertRaisesRegex(RuntimeError, 'four_unrelated_consumer'):self.current()

    def test_only_owned_feature_frames_change_after_inverse_and_private_facts_are_bookended(self):
        self.feature_inverse(); self.peers['freshFrame'] = {'fixtureOwnedRestoredFRESH': True}
        self.peers['apiFrame'] = {'fixtureOwnedRestoredFeatureAPI': True}
        self.current()
        def changed(actors, _):
            self.sourcefacts['inputs'] = {'changedDuringKernelCapture': True}
            return {'73004621': {'owned': {unit: [{}] for unit in actors}}}
        self.owner.h.sessions.side_effect = changed
        with self.assertRaisesRegex(RuntimeError, 'source_private_finance'):self.current()

    def test_wrong_native_cache_build_or_restarted_source_refuses(self):
        for change in [lambda: self.native.update(cache={'foreign': True}), lambda: self.native['app'].update(build_id='foreign'),
                       lambda: self.actor['SOURCE']['unit'].update(NRestarts='1')]:
            native, actor = copy.deepcopy(self.native), copy.deepcopy(self.actor); change()
            with self.subTest(change=change), self.assertRaises(RuntimeError):self.current()
            self.native, self.actor = native, actor

    def test_heartbeat_must_advance_and_remain_current_even_when_framework_ready_zero(self):
        self.current()
        for heartbeat in [999900, 1000101, 0]:
            self.native['app']['heartbeat_at'] = heartbeat
            with self.subTest(heartbeat=heartbeat), self.assertRaises(RuntimeError):self.current()

    def test_zero_source_kernel_or_changed_feature_inverse_epoch_refuses(self):
        self.owner.h.sessions.side_effect = lambda *_: {'73004621': {'owned': {'SOURCE': []}}}
        with self.assertRaises(RuntimeError):self.current()
        self.owner.h.sessions.side_effect = lambda actors, _: {'73004621': {'owned': {unit: [{}] for unit in actors}}}
        self.feature_inverse(); self.featureproof['featureOperatorSha256'] = 'e'*64
        with self.assertRaises(RuntimeError):self.current()

    def test_skipped_stage_fake_future_refs_and_changed_source_manifest_refuse(self):
        for value in [{**self.config, 'stage': 'feature-restored'}, {**self.config, 'unexpectedCallback': True}]:
            with self.assertRaises(RuntimeError):m.configuration(value)
        self.manifest['files']['untrusted.py'] = 'e'*64
        with self.assertRaises(RuntimeError):self.current()

    def arena_fixture(self):
        """Authenticate actual current C bytes, mock only its runtime leaf."""
        raw = (HERE/m.ARENA).read_bytes(); source = load(m.ARENA)
        manifest = {'format': 'yunipals-arena-ypal-business-inverse-source-v1',
            'files': {m.ARENA: m.sha(raw), **source.SOURCE_PINS}, 'externalPrograms': source.EXTERNAL_PROGRAMS}
        refs = {'resultSha256': 'b'*64, 'planSha256': 'c'*64, 'producerSha256': m.sha(raw),
                'manifestSha256': m.sha(m.encoded(manifest))}
        binding = {'producerSha256': refs['producerSha256'], 'planSha256': refs['planSha256'],
            'originalArenaProducerSha256': source.OWNER_SHA, 'originalArenaManifestSha256': source.OWNER_MANIFEST_SHA,
            'originalBaseSourceDigest': source.BASE_SOURCE, 'installedArtifactDigest': source.ARTIFACT,
            'runtimeInstallReceiptSha256': source.INSTALL_ACK, 'nativeActors': {str(i): {'fixtureOnlyActor': i} for i in range(8)}}
        proof = {'format': source.FORMAT+'-leaf', 'validated': True, 'producerSha256': refs['producerSha256'],
            'receiptSha256': refs['resultSha256'], 'planSha256': refs['planSha256'], 'binding': binding,
            'bindingSha256': source.sha(source.encoded(binding)), 'compatibleBusinessInverse': True,
            'nativeEightWorkersRetained': True, 'allElevenPrivateLedgerTablesPreserved': True,
            'privateDatabaseRestored': False, 'preAdoptionRuntimeStarted': False,
            'sourceActorQualified': False, 'financialAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        actual_read = self.read; actual_evaluate = h.evaluate
        def read(path, digest, maximum=4000000):
            path = Path(path)
            if path == m.ARENA_MANIFEST:content = m.encoded(manifest)
            elif str(path) == m.TARGET:content = (HERE.parent/'arena-public-rollback-target-20261023'/'admit-target.py').read_bytes()
            else:return actual_read(path, digest, maximum)
            self.events.append(path.name); m.need(m.sha(content) == digest, 'exact_actual_external_source_fixture_required'); return content
        def evaluate(raw, path):
            value = actual_evaluate(raw, path)
            if Path(path).name == m.ARENA:
                self.assertTrue(set(manifest['files']) <= set(self.events)); self.assertIn('admit-target.py', self.events)
                value.validate_inverse_leaf = Mock(side_effect=lambda *_: copy.deepcopy(proof))
            return value
        self.enterContext(patch.object(h, 'public', side_effect=read)); self.enterContext(patch.object(h, 'evaluate', side_effect=evaluate))
        return manifest, refs, proof, source

    def test_actual_external_C_source_map_target_program_and_typed_native8_private_leaf(self):
        _, refs, proof, _ = self.arena_fixture()
        value = m.arena_current(h, refs)
        self.assertEqual(value, proof); self.assertNotEqual(value['binding']['originalBaseSourceDigest'], value['binding']['installedArtifactDigest'])
        proof['binding']['nativeActors'].pop('7')
        with self.assertRaises(RuntimeError):m.arena_current(h, refs)

    def test_external_manifest_unknown_program_path_or_old_install_identity_refuses(self):
        manifest, refs, proof, source = self.arena_fixture()
        manifest['externalPrograms'] = {**manifest['externalPrograms'], '/untrusted/program.py': 'd'*64}
        refs['manifestSha256'] = m.sha(m.encoded(manifest))
        with self.assertRaises(RuntimeError):m.arena_current(h, refs)
        manifest['externalPrograms'] = source.EXTERNAL_PROGRAMS; refs['manifestSha256'] = m.sha(m.encoded(manifest))
        proof['binding']['runtimeInstallReceiptSha256'] = 'd'*64
        proof['bindingSha256'] = source.sha(source.encoded(proof['binding']))
        with self.assertRaises(RuntimeError):m.arena_current(h, refs)


if __name__ == '__main__':unittest.main()
