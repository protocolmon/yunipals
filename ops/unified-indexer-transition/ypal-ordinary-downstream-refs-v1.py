#!/usr/bin/env python3
"""Finite downstream ancestry and genuine retired-feature actor references.

An immutable reader ACK is not current reader/source authority. The temporary
actor callback comes only from the actual bound feature owner and stop intent.
"""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ordinary-downstream-refs-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
READER = 'ypal-ordinary-reader-bound-v1.py'
READER_MANIFEST = 'ypal-ordinary-reader-bound-v1.manifest.json'
FEATURE = 'ypal-ordinary-feature-handover-bound-v1.py'
FEATURE_CONTEXT = 'ypal-ordinary-feature-context-bound-v1.py'
FEATURE_MANIFEST = 'ypal-ordinary-feature-handover-bound-v1.manifest.json'
CODE = {'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035'}


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) and value != '0'*64


def public(path, digest, maximum=4000000):
    path = Path(path)
    for part in [*path.parents, path]:
        row = part.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode&0o022,
             'protected_downstream_reference_required')
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= maximum and
         sha(raw) == digest and all(getattr(before, key) == getattr(after, key) for key in
            ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns']),
         'exact_downstream_reference_bytes_required')
    return raw


def evaluate(raw, path):
    value = types.ModuleType('downstream_'+Path(path).name.replace('-', '_'))
    value.__file__ = str(path); exec(compile(raw, value.__file__, 'exec'), value.__dict__); return value


def load(name):return evaluate(public(OPS/name, CODE[name]), OPS/name)


def references(value):
    need(type(value) is dict and set(value) == {'reader', 'feature'}, 'explicit_reader_and_feature_reference_groups_required')
    reader, feature = value['reader'], value['feature']
    need(type(reader) is dict and set(reader) == {'resultSha256', 'manifestSha256'} and all(pin(v) for v in reader.values()) and
         reader['manifestSha256'] == CODE[READER_MANIFEST] and type(feature) is dict and set(feature) == {
            'resultSha256', 'manifestSha256', 'inputSha256', 'producerSha256', 'contextSha256'} and
         all(pin(v) for v in feature.values()) and feature['manifestSha256'] == CODE[FEATURE_MANIFEST] and
         feature['producerSha256'] == CODE[FEATURE] and feature['contextSha256'] == CODE[FEATURE_CONTEXT],
         'actual_bound_reader_feature_receipts_and_exact_producers_required')
    return copy.deepcopy(value)


class Reference:
    def __init__(self, value):
        self.refs = references(value)
        for name, digest in CODE.items(): public(OPS/name, digest)
        manifest = json.loads(public(OPS/READER_MANIFEST, CODE[READER_MANIFEST]))
        self.data_identity = manifest['dataIdentity']
        need(manifest['acknowledgementRoute'] == {'file': READER, 'sha256': CODE[READER], 'method': 'acknowledgement'},
             'actual_immutable_bound_reader_acknowledgement_route_required')
        self.reader = load(READER); self.feature = load(FEATURE)
        r, f = self.refs['reader'], self.refs['feature']
        self.ack = self.reader.acknowledgement(r['resultSha256'], r['manifestSha256'])
        self.business = self.feature.runtime(f['manifestSha256'])
        config = self.business.document(self.business.INPUT, f['inputSha256'])
        read_config = {'admissionSha256': config['readAdmissionSha256'], 'readPlanSha256': config['readPlanSha256'],
                       'readContextInputSha256': config['readContextInputSha256']}
        need(self.ack['validated'] is self.ack['immutableReaderAcknowledgementOnly'] is self.ack['published'] is True and
             self.ack['receiptSha256'] == config['readerResultSha256'] == r['resultSha256'] and
             self.ack['manifestSha256'] == config['readerManifestSha256'] == r['manifestSha256'] and
             self.ack['operatorSha256'] == CODE[READER] and self.ack['readConfig'] == read_config and
             all(self.ack[key] == config[key] for key in ['cachePreparedSha256', 'cacheInputsSha256']) and
             all(self.ack[key] is False for key in ['currentReadersQualified', 'currentWriterQualified', 'sourceActorQualified']) and
             self.ack['databaseWrites'] == self.ack['serviceActions'] == self.ack['providerCalls'] == 0,
             'same_actual_immutable_reader_and_feature_input_chain_without_whole_validator_recursion_required')
        self.ordinary = {'resultSha256': config['ordinaryResultSha256'], 'inputSha256': config['ordinaryInputSha256']}
        need(all(pin(v) for v in self.ordinary.values()), 'actual_recorded_ordinary_ancestry_required')

    def feature_current(self):
        f, r = self.refs['feature'], self.refs['reader']
        value = self.feature.validate_feature_leaf(f['resultSha256'], f['manifestSha256'], f['inputSha256'])
        expected = {'readerResultSha256': r['resultSha256'], 'readerManifestSha256': r['manifestSha256'],
            'readerOperatorSha256': CODE[READER], 'readerOperationSha256': self.ack['operationSha256'],
            'readerPublicationSha256': self.ack['publicationSha256'], 'readConfig': self.ack['readConfig'],
            'cachePreparedSha256': self.ack['cachePreparedSha256'], 'cacheInputsSha256': self.ack['cacheInputsSha256']}
        need(value['validated'] is value['temporarySourceRetired'] is value['collectorOnlyCurrentGraphQualified'] is True and
             value['operatorSha256'] == f['producerSha256'] and value['contextSha256'] == f['contextSha256'] and
             value['receiptSha256'] == f['resultSha256'] and value['manifestSha256'] == f['manifestSha256'] and
             value['inputSha256'] == f['inputSha256'] and value['readerAncestry'] == expected and
             all(value[key] is False for key in ['sourceActorQualified', 'financialAuthorityQualified', 'independentPeerLifecyclesQualified',
                'allConfiguredSourcesQualified', 'originalWholeValidatorsPassed', 'current143WholeGraphQualified']) and
             value['databaseWrites'] == value['serviceActions'] == value.get('providerCalls', 0) == 0,
             'genuine_bound_feature_retirement_with_this_exact_reader_chain_required')
        return value

    def retained_current(self):
        before = self.feature_current(); f = self.refs['feature']
        host = self.business.Host(f['manifestSha256'], f['inputSha256']); result = host.retained_current()
        need(result['validated'] is result['ownedTemporaryTerminal'] is True and result['actors'] == {} and
             pin(result['retirementIntentSha256']) and result['sourceActorQualified'] is result['financialAuthorityQualified'] is False and
             result['databaseWrites'] == result['serviceActions'] == result['providerCalls'] == 0,
             'actual_feature_owned_stop_and_empty_temporary_actor_set_required')
        after = self.feature_current()
        stable = lambda value: {key:value[key] for key in ['format', 'operatorSha256', 'receiptSha256', 'api', 'readerAncestry',
            'temporarySourceRetired', 'collectorOnlyCurrentGraphQualified']}
        need(stable(before) == stable(after) and host.retained_current() == result,
             'bound_feature_epoch_changed_during_retained_actor_proof')
        return result

    def continued_source(self, value):
        """Explicit genuine managed/restored epoch; no initial-PID relabelling."""
        need(type(value) is dict and set(value) == {'mode', 'refs'} and value['mode'] in {'managed', 'restored'},
             'explicit_live_managed_or_completed_restored_source_mode_required')
        refs = value['refs']; keys = {'resultSha256', 'inputSha256', 'featureInputSha256', 'producerSha256', 'manifestSha256'}
        need(type(refs) is dict and set(refs) == keys and all(pin(v) for v in refs.values()),
             'five_actual_managed_lifecycle_source_refs_required')
        name = 'ypal-ordinary-managed-handover-bound-v1.py'
        manifest = json.loads(public(OPS/'ypal-ordinary-managed-handover-bound-v1.manifest.json', refs['manifestSha256']))
        need(type(manifest) is dict and set(manifest) == {'format', 'files'} and
             manifest['format'] == 'yunipals-ordinary-managed-source-binding-v1' and
             type(manifest['files']) is dict and 1 <= len(manifest['files']) <= 256 and
             manifest['files'].get(name) == refs['producerSha256'], 'actual_finite_managed_source_manifest_required')
        for file, digest in manifest['files'].items():
            need(isinstance(file, str) and re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)', file) and pin(digest),
                 'fixed_basename_only_managed_source_closure_required')
            public(OPS/file, digest)
        raw = public(OPS/name, refs['producerSha256']); tree = ast.parse(raw)
        maps = [node for node in tree.body if isinstance(node, ast.Assign) and
                any(isinstance(target, ast.Name) and target.id == 'SOURCE_PINS' for target in node.targets)]
        need(len(maps) == 1 and manifest['files'] == {name: refs['producerSha256'], **ast.literal_eval(maps[0].value)},
             'same_literal_managed_owner_complete_source_closure_required')
        owner = evaluate(raw, OPS/name)
        need(owner.FOUNDATION_SHA == '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199',
             'actual_unchanged_full_managed_foundation_required')
        feature_input = json.loads(public(owner.FEATURE_INPUT, refs['featureInputSha256']))
        need(type(feature_input) is dict and feature_input.get('publicationRefs') == self.refs and
             feature_input.get('foundationInputSha256') == refs['inputSha256'],
             'same_actual_reader_feature_and_foundation_inputs_in_current_source_lifecycle_required')
        function = owner.validate_current_source if value['mode'] == 'managed' else owner.validate_restored_source
        proof = function(refs['resultSha256'], refs['inputSha256'], refs['featureInputSha256'])
        need(proof['validated'] is proof['currentWriterQualified'] is True and
             proof['inputSha256'] == refs['inputSha256'] and proof['featureInputSha256'] == refs['featureInputSha256'] and
             proof['financialAuthorityQualified'] is proof['currentCanonicalCoverageQualified'] is False and
             proof['consumerAcceptanceQualified'] is False and proof['routingMode'] == 'ordinary-paid' and
             proof['databaseWrites'] == proof['serviceActions'] == proof.get('providerCalls', 0) == 0,
             'actual_current_epoch_without_financial_or_canonical_authority_alias_required')
        if value['mode'] == 'managed':
            need(proof['lifecycleProducerSha256'] == refs['producerSha256'] and
                 proof['lifecycleReceiptSha256'] == refs['resultSha256'] and proof['sourceKind'] == 'managed' and
                 proof['operatorSha256'] == owner.FOUNDATION_SHA and
                 proof['managedProcessTreeQualified'] is proof['allSixMountsQualified'] is True and
                 proof['binding']['recordedStandaloneReceiptSha256'] == self.ordinary['resultSha256'],
                 'genuine_full_managed_tree_mounts_and_recorded_ordinary_ancestry_required')
            native = proof['observation']['native']; unit = 'yunipals-indexer.service'
        else:
            need(proof['operatorSha256'] == refs['producerSha256'] and proof['receiptSha256'] == refs['resultSha256'] and
                 proof['sourceKind'] == 'restored-ordinary-standalone' and proof['oldStandaloneReceiptRelabelled'] is False,
                 'genuine_completed_managed_inverse_restored_epoch_required')
            native = proof['native']; unit = 'yunipals-ypal-combined-source.service'
        recorded = load('ypal-alchemy-ordinary-consumer-context-v1.py').query_components()['dataIdentity']
        need(native['schemaOid'] == recorded['schemaOid'] == self.data_identity['schemaOid'] and
             native['tables'] == recorded['nativeTableIdentities'] and len(native['tables']) == 44 and
             native['cache'] == recorded['syncCacheIdentity'] and native['app']['build_id'] == self.data_identity['buildId'] and
             set(proof['sourceKernelActors']) == {unit}, 'actual_same_native44_cache_build_and_exact_live_source_actor_required')
        return {'format': FORMAT+'-continued-source', 'validated': True, 'proof': proof, 'native': native,
                'source': proof['sourceKernelActors'][unit], 'sourceKind': proof['sourceKind'],
                'producerSha256': refs['producerSha256'], 'receiptSha256': refs['resultSha256'],
                'inputSha256': refs['inputSha256'], 'dataIdentity': recorded,
                'sourceActorQualified': True, 'currentWriterQualified': True,
                'financialAuthorityQualified': False, 'currentCanonicalCoverageQualified': False,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


if __name__ == '__main__':
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'currentWriterQualified': False,
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
