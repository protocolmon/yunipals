"""Actual thin namespaces and finite sources; synthetic receipts are fixtures only."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


r = load('ypal-ordinary-downstream-refs-v1.py')
a = load('arena-ypal-ordinary-bound-v1.py')
g = load('ypal-ordinary-managed-handover-bound-v1.py')
b = load('ypal-ordinary-managed-source-binding-v1.py')


def local(path, digest, maximum=4000000):
    path = HERE / Path(path).name
    if not path.exists() and path.name == 'final-supervisor-inventory-v1.py':
        path = HERE.parent / 'solana-acceptance' / path.name
    raw = path.read_bytes()
    r.need(0 < len(raw) <= maximum and r.sha(raw) == digest, 'exact_local_source_fixture_required')
    return raw


def refs():
    return {'reader': {'resultSha256': '1'*64, 'manifestSha256': r.CODE[r.READER_MANIFEST]},
            'feature': {'resultSha256': '2'*64, 'manifestSha256': r.CODE[r.FEATURE_MANIFEST],
                        'inputSha256': '3'*64, 'producerSha256': r.CODE[r.FEATURE],
                        'contextSha256': r.CODE[r.FEATURE_CONTEXT]}}


def body(function):
    code = function.__code__ if hasattr(function, '__code__') else function
    return (code.co_code, code.co_names,
            tuple(body(value) if isinstance(value, types.CodeType) else value for value in code.co_consts))


class References(unittest.TestCase):
    def setUp(self):
        self.refs = refs()
        self.config = {'readerResultSha256': '1'*64, 'readerManifestSha256': r.CODE[r.READER_MANIFEST],
            'readAdmissionSha256': '4'*64, 'readPlanSha256': '5'*64, 'readContextInputSha256': '6'*64,
            'cachePreparedSha256': '7'*64, 'cacheInputsSha256': '8'*64,
            'ordinaryResultSha256': 'a'*64, 'ordinaryInputSha256': 'b'*64}
        self.ack = {'validated': True, 'immutableReaderAcknowledgementOnly': True, 'published': True,
            'receiptSha256': '1'*64, 'manifestSha256': r.CODE[r.READER_MANIFEST],
            'operatorSha256': r.CODE[r.READER], 'operationSha256': '9'*64, 'publicationSha256': 'c'*64,
            'readConfig': {'admissionSha256': '4'*64, 'readPlanSha256': '5'*64, 'readContextInputSha256': '6'*64},
            'cachePreparedSha256': '7'*64, 'cacheInputsSha256': '8'*64,
            'currentReadersQualified': False, 'currentWriterQualified': False, 'sourceActorQualified': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.leaf = {'format': 'yunipals-ypal-ordinary-feature-handover-bound-v1', 'validated': True,
            'temporarySourceRetired': True, 'collectorOnlyCurrentGraphQualified': True,
            'operatorSha256': r.CODE[r.FEATURE], 'contextSha256': r.CODE[r.FEATURE_CONTEXT],
            'receiptSha256': '2'*64, 'manifestSha256': r.CODE[r.FEATURE_MANIFEST], 'inputSha256': '3'*64,
            'api': {'fixtureApi': True}, 'readerAncestry': {
                'readerResultSha256': '1'*64, 'readerManifestSha256': r.CODE[r.READER_MANIFEST],
                'readerOperatorSha256': r.CODE[r.READER], 'readerOperationSha256': '9'*64,
                'readerPublicationSha256': 'c'*64, 'readConfig': self.ack['readConfig'],
                'cachePreparedSha256': '7'*64, 'cacheInputsSha256': '8'*64},
            **{key: False for key in ['sourceActorQualified', 'financialAuthorityQualified',
                'independentPeerLifecyclesQualified', 'allConfiguredSourcesQualified',
                'originalWholeValidatorsPassed', 'current143WholeGraphQualified']},
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.retained = {'validated': True, 'ownedTemporaryTerminal': True, 'actors': {},
            'retirementIntentSha256': 'd'*64, 'sourceActorQualified': False, 'financialAuthorityQualified': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.host = types.SimpleNamespace(retained_current=Mock(side_effect=lambda: copy.deepcopy(self.retained)))
        self.business = types.SimpleNamespace(INPUT=Path('/fixture/feature-input'),
            document=Mock(side_effect=lambda *_: copy.deepcopy(self.config)), Host=Mock(return_value=self.host))
        self.reader = types.SimpleNamespace(acknowledgement=Mock(side_effect=lambda *_: copy.deepcopy(self.ack)))
        self.feature = types.SimpleNamespace(runtime=Mock(return_value=self.business),
            validate_feature_leaf=Mock(side_effect=lambda *_: copy.deepcopy(self.leaf)))
        self.actual_load = r.load
        def module(name):
            if name == r.READER: return self.reader
            if name == r.FEATURE: return self.feature
            return self.actual_load(name)
        self.enterContext(patch.object(r, 'public', side_effect=local))
        self.enterContext(patch.object(r, 'load', side_effect=module))

    def test_actual_immutable_ack_then_exact_retired_feature_callback_without_reader_recursion(self):
        value = r.Reference(self.refs)
        self.business.Host.assert_not_called()
        self.assertEqual(value.ordinary, {'resultSha256': 'a'*64, 'inputSha256': 'b'*64})
        self.assertEqual(value.retained_current(), self.retained)
        self.reader.acknowledgement.assert_called_once_with('1'*64, r.CODE[r.READER_MANIFEST])
        self.assertEqual(self.feature.validate_feature_leaf.call_count, 2)
        self.assertEqual(self.host.retained_current.call_count, 2)

    def test_old_reader_feature_unknown_keys_and_placeholder_references_refuse(self):
        for change in [lambda v: v['reader'].update(manifestSha256='7'*64),
                       lambda v: v['feature'].update(producerSha256='4e66'+'0'*60),
                       lambda v: v['feature'].update(contextSha256='0'*64),
                       lambda v: v.update(oldWholePassed=True)]:
            value = refs(); change(value)
            with self.subTest(change=change), self.assertRaises(RuntimeError): r.references(value)

    def test_unrelated_reader_input_or_claimed_current_ack_refuses(self):
        for key, changed in [('readerResultSha256', 'e'*64), ('cacheInputsSha256', 'e'*64)]:
            old = self.config[key]; self.config[key] = changed
            with self.assertRaises(RuntimeError): r.Reference(self.refs)
            self.config[key] = old
        self.ack['currentReadersQualified'] = True
        with self.assertRaises(RuntimeError): r.Reference(self.refs)

    def test_feature_authority_wrong_ancestry_nonempty_actor_and_missing_stop_refuse(self):
        value = r.Reference(self.refs)
        for change in [lambda: self.leaf.update(sourceActorQualified=True),
                       lambda: self.leaf['readerAncestry'].update(readerPublicationSha256='f'*64),
                       lambda: self.retained.update(actors={'unexpected': {}}),
                       lambda: self.retained.update(retirementIntentSha256=None)]:
            leaf, retained = copy.deepcopy(self.leaf), copy.deepcopy(self.retained); change()
            with self.subTest(change=change), self.assertRaises(RuntimeError): value.retained_current()
            self.leaf, self.retained = leaf, retained

    def test_feature_api_or_owned_stop_proof_race_refuses(self):
        value = r.Reference(self.refs); changed = copy.deepcopy(self.leaf); changed['api'] = {'changed': True}
        self.feature.validate_feature_leaf.side_effect = [self.leaf, changed]
        with self.assertRaisesRegex(RuntimeError, 'epoch_changed'): value.retained_current()
        self.feature.validate_feature_leaf.side_effect = lambda *_: copy.deepcopy(self.leaf)
        changed = {**self.retained, 'retirementIntentSha256': 'e'*64}
        self.host.retained_current.side_effect = [self.retained, changed]
        with self.assertRaisesRegex(RuntimeError, 'epoch_changed'): value.retained_current()


class ContinuedSource(unittest.TestCase):
    def setUp(self):
        self.value = r.Reference.__new__(r.Reference); self.value.refs = refs()
        self.value.ordinary = {'resultSha256': 'a'*64, 'inputSha256': 'b'*64}
        self.value.data_identity = json.loads((HERE/r.READER_MANIFEST).read_bytes())['dataIdentity']
        self.manifest = b.build(HERE); self.owner_sha = self.manifest['files'][b.OWNER]
        self.feature_input = {'format': g.FORMAT+'-feature-input', 'foundationInputSha256': 'c'*64,
                              'publicationRefs': refs()}
        self.feature_raw = json.dumps(self.feature_input).encode()
        self.files = {str(r.OPS/b.MANIFEST): json.dumps(self.manifest).encode(), str(g.FEATURE_INPUT): self.feature_raw}
        self.refs = {'resultSha256': 'd'*64, 'inputSha256': 'c'*64, 'featureInputSha256': r.sha(self.feature_raw),
                     'producerSha256': self.owner_sha, 'manifestSha256': r.sha(self.files[str(r.OPS/b.MANIFEST)])}
        self.data = {**self.value.data_identity, 'nativeTableIdentities': [{'fixtureRelation': i} for i in range(44)],
                     'syncCacheIdentity': {'fixtureCache': True}}
        self.native = {'schemaOid': self.data['schemaOid'], 'tables': self.data['nativeTableIdentities'],
                       'cache': self.data['syncCacheIdentity'], 'app': {'build_id': self.data['buildId']}}
        self.proof = {'validated': True, 'currentWriterQualified': True, 'inputSha256': 'c'*64,
            'featureInputSha256': self.refs['featureInputSha256'], 'financialAuthorityQualified': False,
            'currentCanonicalCoverageQualified': False, 'consumerAcceptanceQualified': False,
            'routingMode': 'ordinary-paid', 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0,
            'lifecycleProducerSha256': self.owner_sha, 'lifecycleReceiptSha256': 'd'*64,
            'sourceKind': 'managed', 'operatorSha256': g.FOUNDATION_SHA,
            'managedProcessTreeQualified': True, 'allSixMountsQualified': True,
            'binding': {'recordedStandaloneReceiptSha256': 'a'*64},
            'observation': {'native': self.native}, 'sourceKernelActors': {'yunipals-indexer.service': {'fixtureActor': 'managed'}}}
        self.events = []
        def public(path, digest, maximum=4000000):
            self.events.append(Path(path).name)
            if str(path) in self.files:
                raw = self.files[str(path)]; r.need(r.sha(raw) == digest, 'exact_fixture_receipt_required'); return raw
            return local(path, digest, maximum)
        self.enterContext(patch.object(r, 'public', side_effect=public))
        actual_evaluate = r.evaluate
        def evaluate(raw, path):
            if Path(path).name == b.OWNER:
                self.assertTrue(set(self.manifest['files']) <= set(self.events))
                owner = actual_evaluate(raw, path)
                owner.validate_current_source = Mock(side_effect=lambda *_: copy.deepcopy(self.proof))
                owner.validate_restored_source = Mock(side_effect=lambda *_: copy.deepcopy(self.proof))
                self.actual_owner = owner
                return owner
            return actual_evaluate(raw, path)
        self.enterContext(patch.object(r, 'evaluate', side_effect=evaluate))
        self.enterContext(patch.object(r, 'load', return_value=types.SimpleNamespace(query_components=lambda: {'dataIdentity': self.data})))

    def current(self, mode='managed'):return self.value.continued_source({'mode': mode, 'refs': self.refs})

    def test_actual_finite_managed_sources_before_evaluation_and_real_current_entrypoint(self):
        proof = self.current()
        self.actual_owner.validate_current_source.assert_called_once_with('d'*64, 'c'*64, self.refs['featureInputSha256'])
        self.assertEqual(proof['sourceKind'], 'managed'); self.assertEqual(proof['producerSha256'], self.owner_sha)
        self.assertNotEqual(proof['receiptSha256'], self.value.ordinary['resultSha256'])
        self.assertFalse(proof['financialAuthorityQualified'])

    def test_completed_restored_epoch_uses_new_actor_and_never_initial_ordinary_receipt(self):
        self.proof.update(operatorSha256=self.owner_sha, receiptSha256='d'*64, sourceKind='restored-ordinary-standalone',
                          oldStandaloneReceiptRelabelled=False, native=self.native,
                          sourceKernelActors={'yunipals-ypal-combined-source.service': {'fixtureActor': 'restored'}})
        proof = self.current('restored')
        self.assertEqual(proof['source'], {'fixtureActor': 'restored'})
        self.actual_owner.validate_restored_source.assert_called_once()
        self.proof['oldStandaloneReceiptRelabelled'] = True
        with self.assertRaises(RuntimeError): self.current('restored')

    def test_wrong_source_mode_unrelated_feature_input_native_or_actor_refuses(self):
        with self.assertRaises(RuntimeError): self.value.continued_source({'mode': 'stopped', 'refs': self.refs})
        for edit in [lambda p: p.update(lifecycleReceiptSha256='f'*64),
                     lambda p: p.update(currentWriterQualified=False),
                     lambda p: p.update(sourceKernelActors={'oldStandalone': {}}),
                     lambda p: p['observation']['native'].update(cache={'foreign': True})]:
            saved = copy.deepcopy(self.proof); edit(self.proof)
            with self.subTest(edit=edit), self.assertRaises(RuntimeError): self.current()
            self.proof = saved
        self.feature_input['publicationRefs']['reader']['resultSha256'] = 'f'*64
        raw = json.dumps(self.feature_input).encode(); self.files[str(g.FEATURE_INPUT)] = raw; self.refs['featureInputSha256'] = r.sha(raw)
        with self.assertRaisesRegex(RuntimeError, 'same_actual_reader_feature'): self.current()

    def test_missing_closure_file_and_extra_untrusted_path_refuse_before_evaluation(self):
        for modify in [lambda m: m['files'].pop('ypal-ordinary-downstream-refs-v1.py'),
                       lambda m: m['files'].update({'../../arbitrary.py': 'a'*64})]:
            self.manifest = b.build(HERE); modify(self.manifest)
            raw = json.dumps(self.manifest).encode(); self.files[str(r.OPS/b.MANIFEST)] = raw; self.refs['manifestSha256'] = r.sha(raw)
            with self.assertRaises(RuntimeError): self.current()
            self.assertFalse(hasattr(self, 'actual_owner'))


class Namespaces(unittest.TestCase):
    def arena(self, continuation=None):
        with patch.object(a, 'public', side_effect=local):value = a.composition(continuation)
        value.protected = local
        return value

    def test_real_managed_namespace_retains_all_lifecycle_methods_and_full_foundation(self):
        old = load('ypal-ordinary-managed-handover-v3.py')
        with patch.object(g, 'public', side_effect=local): value = g.composition()
        self.assertEqual(value.FEATURE_SHA, r.CODE[r.FEATURE]); self.assertEqual(value.FOUNDATION_SHA, old.FOUNDATION_SHA)
        self.assertNotEqual(value.BASE, old.BASE); self.assertNotEqual(value.FEATURE_INPUT, old.FEATURE_INPUT)
        for name, fn in old.Owner.__dict__.items():
            if name not in {'__init__','preserved','stable'} and callable(fn) and hasattr(fn, '__code__'):
                actual = getattr(value.Owner, name)
                self.assertEqual(body(actual), body(fn), name)
        self.assertEqual(set(g.SOURCE_PINS) | {g.FILE.name}, set(b.build(HERE)['files']))
        self.assertNotIn('ypal-ordinary-postmanaged-consumer-v1.py', g.SOURCE_PINS)

    def test_bound_feature_input_only_new_exact_reference_groups_and_same_foundation(self):
        with patch.object(g, 'public', side_effect=local):
            value = {'format': g.FORMAT+'-feature-input', 'foundationInputSha256': 'a'*64, 'publicationRefs': refs()}
            result = g.feature_configuration(value, 'a'*64)
            self.assertEqual(result['feature'], {'retirementSha256': '2'*64, 'manifestSha256': r.CODE[r.FEATURE_MANIFEST], 'inputSha256': '3'*64})
            for bad in [{**value, 'feature': {}}, {**value, 'foundationInputSha256': 'b'*64}]:
                with self.assertRaises(RuntimeError): g.feature_configuration(bad, 'a'*64)

    def test_real_Arena_namespace_preserves_eight_worker_and_transaction_bodies(self):
        old = load('arena-ypal-ordinary-v1.py')
        with patch.object(old, 'protected', side_effect=local): previous = old.namespace()
        value = self.arena()
        with patch.object(a, 'public', side_effect=local): current = value.namespace()
        self.assertEqual(current.SOURCE_ID, previous.SOURCE_ID)
        for name, fn in previous.Host.__dict__.items():
            if callable(fn) and hasattr(fn, '__code__') and name not in {'__init__', 'normal'}:
                self.assertEqual(body(getattr(current.Host, name)), body(fn), name)
        self.assertEqual(body(current.apply), body(previous.apply))
        self.assertEqual(current.installer.ARTIFACT, 'e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234')
        self.assertEqual(a.INSTALL_ACK, 'ad024517f4ae8e348382cea0f589b4c432eaf4261797048cba5c66b676dabe84')

    def test_Arena_exact_initial_plan_retains_actual_install_ACK_and_no_future_source_refs(self):
        fixture = load('arena-ypal-ordinary-v1.test.py')
        value = self.arena()
        with patch.object(a, 'public', side_effect=local): current = value.namespace()
        plan = fixture.plan(); plan.update(format=a.FORMAT, publicationRefs=refs())
        plan['runtimeInstall']['sha256'] = a.INSTALL_ACK
        source = load('arena-ypal-ordinary-v1.source.py')
        with patch.object(value, 'namespace', return_value=current), patch.object(current, 'read_module', return_value=source), \
             patch.object(a, 'public', side_effect=local):
            value.validate_plan(plan)
            for bad in [{**plan, 'sourceContinuation': None}, {**plan, 'publicationRefs': {}},
                        {**plan, 'runtimeInstall': {**plan['runtimeInstall'], 'sha256': 'd'*64}}]:
                with self.assertRaises(RuntimeError): value.validate_plan(bad)

    def test_Arena_original_source_dispatch_gets_only_genuine_retired_feature_callback(self):
        value = self.arena(); callback = Mock()
        source = types.SimpleNamespace(FORMAT='fixture', validate_current=Mock(return_value={
            'format': 'fixture', 'validated': True, 'inverseOnly': False, 'releaseId': value.SOURCE_VALUE['releaseId'],
            'manifestHash': value.SOURCE_VALUE['manifestHash'], 'schemaOid': '75963410', 'buildId': '71e2a7f3b7',
            'sourceKind': 'standalone', 'sourceReceiptSha256': 'a'*64, 'sourceRuntimeInputSha256': 'b'*64,
            'originalWholeValidationPassed': False, 'financialAuthorityQualified': False,
            'currentCanonicalCoverageQualified': False, 'sourceTerminal': False}))
        host = types.SimpleNamespace(ordinary_namespace=types.SimpleNamespace(SOURCE_CONTEXT=Path('/fixture/source'), SOURCE_ID=value.SOURCE_VALUE['releaseId']),
            p=types.SimpleNamespace(load=Mock(return_value=source)), plan={'ordinaryRuntime': {'resultSha256': 'a'*64, 'inputSha256': 'b'*64}},
            manifest={'source': value.SOURCE_VALUE}, bound_references=types.SimpleNamespace(retained_current=callback))
        host.ordinary_namespace.SOURCE_CONTEXT = Path('arena-ypal-ordinary-v1.source.py')
        value.normal(host)
        source.validate_current.assert_called_once_with(host.plan['ordinaryRuntime'], terminal_ok=False, retained_current=callback)

    def test_Arena_managed_source_proof_is_review_bound_and_no_initial_PID_alias(self):
        continuation = {'mode': 'managed', 'refs': {key: str(index)*64 for index, key in enumerate(
            ['resultSha256', 'inputSha256', 'featureInputSha256', 'producerSha256', 'manifestSha256'], 1)}}
        value = self.arena(continuation)
        data = {key: value.SOURCE_VALUE[key] for key in ['manifestHash', 'schema', 'schemaOid', 'buildId']}
        proof = {'dataIdentity': data, 'native': {'app': {'build_id': '71e2a7f3b7'}}, 'currentWriterQualified': True,
            'source': {'fixtureActor': 'managed'}, 'sourceKind': 'managed', 'receiptSha256': '1'*64,
            'producerSha256': '4'*64, 'inputSha256': '2'*64, 'proof': {'fixtureFullManagedProof': True}}
        host = types.SimpleNamespace(plan={'ordinaryRuntime': {'resultSha256': 'a'*64, 'inputSha256': 'b'*64}},
            manifest={'source': value.SOURCE_VALUE}, bound_references=types.SimpleNamespace(continued_source=Mock(return_value=proof)))
        current = value.normal(host, True)
        self.assertEqual(current['sourceReceiptSha256'], '1'*64); self.assertFalse(current['ordinaryRuntimeCurrentClaimed'])
        self.assertTrue(current['inverseOnly']); self.assertFalse(current['sourceTerminal'])
        before = current['sourceRuntimeProofSha256']; proof['source'] = {'fixtureActor': 'replacement'}
        self.assertNotEqual(value.normal(host, True)['sourceRuntimeProofSha256'], before)

    def test_Arena_manifest_current_mode_and_fresh_paths_are_explicit(self):
        value = self.arena(); value.__file__ = str(HERE/a.FILE.name)
        with patch.object(value, 'protected', side_effect=local): manifest = value.code_manifest()
        self.assertEqual(manifest['authority']['sourceKind'], 'typed-current-epoch')
        value.validate_manifest(manifest)
        self.assertEqual(manifest['files'][a.FILE.name], r.sha((HERE/a.FILE.name).read_bytes()))
        self.assertNotEqual(a.BASE, Path('/var/backups/yunipals-arena-ypal-ordinary-v1-20261025'))
        self.assertEqual(load('arena-ypal-ordinary-bound-v1-manifest.py').build(HERE), manifest)

    def test_default_CLIs_are_inert_and_emit_no_current_success(self):
        for name in [r.__file__, g.__file__, a.__file__]:
            result = subprocess.run([sys.executable, name], capture_output=True, text=True, check=True)
            value = json.loads(result.stdout)
            self.assertEqual(value['databaseWrites'], 0)
            self.assertFalse(value.get('currentWriterQualified', False))


if __name__ == '__main__':unittest.main()
