#!/usr/bin/env python3
"""Read-only completed reader recovery, with no current writer authority."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-native-inverse-leaf-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
ROOT = OPS / 'ypal-native-cutover-v2.py'
ROOT_SHA = '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003'
MANIFEST_SHA = '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8'


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def protected(path, digest):
    for p in [*path.parents, path]:
        row = p.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_inverse_leaf_source_required')
    first = path.lstat()
    need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and first.st_size < 200000,
         'bounded_regular_inverse_leaf_source_required')
    raw = path.read_bytes(); last = path.lstat()
    need(all(getattr(first, k) == getattr(last, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         len(raw) == first.st_size and sha(raw) == digest, 'exact_inverse_leaf_source_required')
    return raw


def load_root(manifest_sha):
    need(manifest_sha == MANIFEST_SHA, 'only_exact_frozen1599_coordinator_manifest_required')
    value = types.ModuleType('frozen_restored_reader_coordinator'); value.__file__ = str(ROOT)
    exec(compile(protected(ROOT, ROOT_SHA), str(ROOT), 'exec'), value.__dict__)
    root = value.core(manifest_sha)
    return root, root.load_proof(manifest_sha)


def completed_catalog(context):
    need(context.logins_enabled() is False, 'completed_inverse_requires_reversed_two_LOGIN_bits')
    reference = context.phase.admission_ref
    graph = context.host.new_read.validate_catalog_current(reference['receiptSha256'])
    need(graph['validated'] is graph['catalogOnly'] is True and graph['readEdgeCount'] == 143 and
         graph['receiptSha256'] == reference['receiptSha256'] and graph['planSha256'] == reference['planSha256'] and
         graph['contextInputSha256'] == reference['contextInputSha256'] and
         graph['sourceActorQualified'] is graph['sourceReadinessQualified'] is graph['financialAuthorityQualified'] is False,
         'actual_source_independent_full143_and_all_column_catalog_required')
    current = context.catalog(); baseline = context.host.read_rehearsal['after']
    need(context.host.read.acl_catalog(current) == context.host.read.acl_catalog(baseline),
         'exact_restored143_catalog_NOLOGIN_and_no_cache4_required')
    context.columns_current(); guard = context.guard_scope(False)
    need(context.catalog() == current, 'restored_reader_catalog_changed_during_guard_validation')
    return {'format': FORMAT + '-catalog', 'validated': True,
            'readAdmissionSha256': reference['receiptSha256'], 'readPlanSha256': reference['planSha256'],
            'readContextInputSha256': reference['contextInputSha256'],
            'catalogSha256': sha(encoded(context.host.read.acl_catalog(current))),
            'allColumnAclSha256': sha(encoded(context.sql_ack['postProof']['allColumnAcl'])), 'cacheGuard': guard,
            'twoLOGINReversed': True, 'cache4Reversed': True, 'read143Preserved': True,
            'sourceActorQualified': False, 'currentWriterQualified': False, 'financialAuthorityQualified': False,
            'originalWholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def completed_context(proof, operation):
    class CompletedInverseContext(proof.Context):
        def scope(self, enabled=None):
            raise RuntimeError('completed_inverse_leaf_has_no_forward_source_scope')
        def inverse_scope(self, cache_reads=False):
            need(cache_reads is False, 'completed_inverse_only_after_four_cache_reads_reversed')
            return completed_catalog(self)
    context = CompletedInverseContext(operation['binding']['inputs']); context.proof = proof
    return context


def authenticate_result(root, proof, expected, manifest_sha):
    need(pin(expected), 'actual_completed_inverse_result_pin_required')
    operation, initial = root.inverse_operation(proof)
    result = root.document(root.BASE / 'inverse-result.json', expected)
    refs = {name: sha(root.public_input(root.BASE / name)) for name in
            ('operation.json', 'inverse-intent.json', 'inverse-global-restored.json',
             'metadata-restored.json', 'cache-inverse-catalog.json')}
    need(result['format'] == root.FORMAT and result['restored'] is True and result['bootId'] == root.boot() and
         result['operatorSha256'] == operation['binding']['operatorSha256'] == ROOT_SHA and
         operation['binding']['inputs']['sourceManifestSha256'] == manifest_sha and
         initial['binding']['sourceManifestSha256'] == manifest_sha and
         result['operationSha256'] == refs['operation.json'] and result['inverseIntentSha256'] == refs['inverse-intent.json'] and
         result['globalInverseSha256'] == refs['inverse-global-restored.json'] and
         result['metadataInverseSha256'] == refs['metadata-restored.json'] and
         result['cacheInverseSha256'] == refs['cache-inverse-catalog.json'] and
         result['globalGeneration'] == '103' and result['allOwnedCacheFourReadsAndTwoLOGINChangesReversed'] is
         result['fullLegacyServingAccepted'] is result['recurringGenerationKeptStoppedUntilSupervisedLineagePolicy'] is True and
         result['originalPIDReturnedClaimed'] is result['frozenPriorAcknowledgementsRewritten'] is False and
         result['sourceActions'] == result['financialActions'] == 0 and result['serving']['realServingAccepted'] is True,
         'actual_complete_owned_inverse_chain_not_raw_restored_flag_required')
    return operation, initial, result, refs


def committed(root, context, xid):
    need(root.xid_status(context, xid) == 'committed', 'actual_owned_inverse_XID_must_be_committed')


def recovery_journals(root, context, operation, initial, result):
    operation_sha = sha(root.public_input(root.BASE / 'operation.json'))
    inverse_sha = sha(root.public_input(root.BASE / 'inverse-intent.json'))
    if (root.BASE / 'roles-admitted.json').exists():
        # The frozen method authenticates the entire admission+inverse pair.
        need(context.logins_enabled() is False, 'exact_two_owned_LOGIN_inverse_chain_required')
        restored = root.document(root.BASE / 'roles-restored.json')
        committed(root, context, restored['xid'])
        root.child_terminal(context, 'roles-inverse')
    elif (root.BASE / 'roles-intent.json').exists():
        root.child_terminal(context, 'roles')
        if (root.BASE / 'roles-prepared.json').exists():
            packet = root.document(root.BASE / 'roles-prepared.json')
            need(root.xid_status(context, packet['xid']) == 'aborted', 'unacknowledged_reader_LOGIN_requires_known_aborted_XID')
    cache = root.document(root.BASE / 'cache-inverse-catalog.json')
    intent = root.document(root.BASE / 'cache-inverse-intent.json', cache['intentSha256'])
    packet = root.document(root.BASE / 'cache-inverse-prepared.json', cache['preparedSha256'])
    need(cache['format'] == 'yunipals-ypal-native-cutover-cache-inverse-v1' and cache['restored'] is True and
         cache['bootId'] == intent['bootId'] == root.boot() and cache['operatorSha256'] == ROOT_SHA and
         cache['operationSha256'] == intent['operationSha256'] == operation_sha and
         cache['inverseIntentSha256'] == intent['inverseIntentSha256'] == inverse_sha and
         cache['cacheOriginalProducerSha256'] == context.proof.CACHE_SHA and
         cache['cachePreparedSha256'] == context.inputs['cachePreparedSha256'] and
         cache['generationCandidateSha256'] == context.prepared['config']['generationSha256'] and
         cache['readAdmissionSha256'] == context.phase.admission_ref['receiptSha256'] and
         intent['format'] == root.FORMAT and intent['cacheCommitSha256'] == sha(root.public_input(context.cache.BASE / 'sql-committed.json')) and
         packet['mode'] == 'inverse' and packet['xid'] == cache['result']['xid'] and
         packet['planSha256'] == sha(context.sql_ack['resultJson'].encode()) and
         cache['result']['format'] == 'yunipals-ypal-cache-guard-sql-v1' and
         cache['result']['acknowledged'] is True and cache['result']['mode'] == 'inverse' and
         json.loads(cache['result']['resultJson']) == cache['result']['result'] and
         cache['cacheInactive'] is cache['cacheBootDisabled'] is cache['fourOwnedReadsRemoved'] is True and
         cache['frozenCacheOwnerInverseReceiptFabricated'] is cache['legacyWorkerMayStartBeforeCapsuleRestore'] is False,
         'exact_owned_four_cache_READ_inverse_intent_prepared_and_ACK_required')
    baseline = context.host.read_rehearsal['after']
    need(context.host.read.acl_catalog(packet['postProof']['catalog']) == context.host.read.acl_catalog(baseline),
         'cache_inverse_prepared_catalog_must_be_exact143')
    need(packet['postProof']['allColumnAcl'] == context.sql_ack['postProof']['allColumnAcl'],
         'cache_inverse_must_preserve_all_grantee_column_ACLs')
    committed(root, context, packet['xid']); context.cache.child_gone(context.host, 'inverse-sql-child.json')
    global_state = root.document(root.BASE / 'inverse-global-restored.json')
    _, candidate, _, capsule = context.generation()
    need(global_state['format'] == root.FORMAT and global_state['globalRestored'] is True and
         global_state['currentGeneration'] == capsule['currentGeneration'] == '103' and
         global_state['previousGeneration'] == capsule['previousGeneration'] and
         global_state['ownedGenerationRetained'] == candidate['generationId'], 'exact_owned_global103_capsule_recovery_required')
    if initial['binding']['publication']['published']:
        _, publication, _ = root.published(context.proof)
        gi = root.document(root.BASE / 'capsule-inverse-intent.json', global_state['intentSha256'])
        gp = root.document(root.BASE / 'capsule-inverse-prepared.json', global_state['preparedSha256'])
        need(global_state['publicationNeverCommitted'] is False and global_state['capsuleSQLPerformed'] is True and
             global_state['result']['restored'] is global_state['result']['allDerivedIdentityColumnsRestored'] is True and
             gi['format'] == root.FORMAT and gi['bootId'] == root.boot() and gi['inverseIntentSha256'] == inverse_sha and
             gi['publicationSha256'] == sha(root.public_input(root.PUBLICATION / 'published.json')) and
             initial['binding']['publication']['publicationSha256'] == gi['publicationSha256'] and
             gi['capsuleResultSha256'] == candidate['capsuleResultSha256'] and
             gi['cacheInverseSha256'] == sha(root.public_input(root.BASE / 'cache-inverse-catalog.json')) and
             gp['event'] == 'capsule-prepared' and gp['format'] == 'yunipals-ypal-native-publication-protocol-v1',
             'acknowledged_capsule_inverse_COMMIT_chain_required')
        committed(root, context, gp['xid']); root.child_terminal(context, 'capsule-inverse')
    else:
        need(global_state['publicationNeverCommitted'] is True and global_state['capsuleSQLPerformed'] is False,
             'unpublished_inverse_must_not_claim_capsule_SQL')
        need(not (root.PUBLICATION / 'published.json').exists(), 'acknowledged_publication_cannot_be_relabelled_unpublished')
        root.child_terminal(context, 'publish')
        if (root.PUBLICATION / 'publication-prepared.json').exists():
            packet = root.document(root.PUBLICATION / 'publication-prepared.json')
            need(root.xid_status(context, packet['xid']) == 'aborted', 'unknown_publication_cannot_be_reported_recovered')
    mi = root.document(root.BASE / 'metadata-inverse-intent.json')
    need(mi['format'] == root.FORMAT and mi['bootId'] == root.boot() and mi['operationSha256'] == operation_sha and
         mi['metadataOperationSha256'] == candidate['metadataOperationSha256'] and
         mi['metadataProducerSha256'] == context.cache.META_OWNER_SHA and
         mi['cacheInverseSha256'] == sha(root.public_input(root.BASE / 'cache-inverse-catalog.json')) and
         mi['globalInverseSha256'] == sha(root.public_input(root.BASE / 'inverse-global-restored.json')) and
         mi['newExplicitInverseContext'] is True, 'same_authenticated_metadata_inverse_delegation_required')
    return capsule


def recovered_readers(root, context, operation):
    actors, boots = {}, {}
    root.original_inputs(context, operation)
    for name in context.proof.PEERS:
        root.original_loaded(context, operation, name)
        actual = root.restored_reader(context, operation, name)
        ack = root.document(root.BASE / ('legacy-' + name + '-restored.json'))
        need(ack['format'] == root.FORMAT and ack['bootId'] == root.boot() and
             ack['actor']['main'] == actual['main'] and ack['actor']['unit']['InvocationID'] == actual['unit']['InvocationID'],
             'exact_acknowledged_restored_reader_invocation_required')
        start = root.BASE / ('legacy-' + name + '-start-intent.json')
        if start.exists():
            intent = root.document(start)
            need(intent['bootId'] == root.boot() and actual['main']['startTicks'] >= intent['minimumStartTicks'] and
                 actual['unit']['InvocationID'] != intent['before']['InvocationID'] and actual['unit']['NRestarts'] == '0',
                 'restored_reader_must_follow_owned_start_without_replacement')
        else:
            old = operation['binding']['originalReaders'][name]
            need(actual['main'] == old['main'] and actual['unit']['InvocationID'] == old['unit']['InvocationID'],
                 'only_same_never_stopped_reader_can_lack_restart_intent')
        boots[name] = root.reader_boot(context.proof, name)
        need(boots[name] == operation['binding']['readerBootLinks'][name] and
             not os.path.lexists(root.BASE / ('original-' + name + '-boot')), 'exact_original_reader_boot_inode_restored')
        expected = operation['binding']['originalReaders'][name]['unit']
        need(all(actual['unit'][key] == expected[key] for key in ('UnitFileState', 'WantedBy')),
             'original_reader_boot_configuration_must_be_loaded')
        entry = boots[name]
        if entry['identity'] is not None:
            for suffix in ('intent', 'result'):
                need(root.document(root.BASE / ('inverse-reader-' + name + '-boot-restore-' + suffix + '.json')) == entry,
                     'same_owned_inverse_reader_boot_recovery_chain_required')
        context.proof.terminal(context.state(context.proof.preview_unit(name)))
        for preview in (False, True):
            for _, path, _ in root.descriptor_files(operation, name, preview):
                need(not os.path.lexists(path), 'all_owned_native_reader_overlays_and_previews_must_be_removed')
        actors[name] = actual
    return actors, boots


def recovered_cache(root, context):
    result = root.document(root.BASE / 'cache-restored.json')
    start = root.document(root.BASE / 'cache-old-start-intent.json')
    ack = root.document(root.BASE / 'cache-old-started.json')
    original = context.cache.document(context.cache.BASE / 'before.json')['binding']
    current = context.host.actor(False, False); context.cache.loaded(context.host, False)
    need(result['format'] == 'yunipals-ypal-cache-finish-v3' and result['restored'] is True and result['bootId'] == start['bootId'] == root.boot() and
         result['globalGeneration'] == '103' and result['read143GraphPreserved'] is True and result['sameOldPIDClaimed'] is False and
         result['oldCacheActor']['main'] == ack['actor']['main'] == current['main'] and
         result['oldCacheActor']['unit']['InvocationID'] == ack['actor']['unit']['InvocationID'] == current['unit']['InvocationID'] and
         ack['intentSha256'] == sha(root.public_input(root.BASE / 'cache-old-start-intent.json')) and
         current['main']['startTicks'] >= start['minimumStartTicks'] and current['unit']['InvocationID'] != start['before']['InvocationID'] and
         result['oldBoot'] == context.cache.inode(context.cache.BOOT, True) == original['boot'] and
         not os.path.lexists(context.cache.BASE / 'original-boot-link') and not os.path.lexists(context.cache.DROP),
         'exact_owned_original_cache_restart_boot_and_configuration_required')
    need(root.document(root.BASE / 'cache-old-load-result.json')['originalDefinitionsLoaded'] is True and
         root.document(root.BASE / 'cache-old-enable-result.json')['acknowledged'] is True,
         'original_cache_loaded_and_boot_reload_ACKs_required')
    if (context.cache.BASE / 'drop-published.json').exists():
        need(root.document(root.BASE / 'cache-drop-unlink-intent.json') == context.cache.document(context.cache.BASE / 'drop-published.json'),
             'owned_cache_drop_removal_inode_chain_required')
    return current, result['oldBoot']


def metadata_journal(root, context, owner, host, operation):
    # Use the already authenticated current owner's fixed records and static
    # operation. No original/source invocation gate belongs to this leaf.
    document = host.s.document
    inverse = document(owner.BASE / 'inverse-intent.json')
    selected = document(owner.BASE / 'selected.json', context.prepared['config']['metadataSelectionSha256'])
    native = inverse['nativeActor'] or selected['nativeActor']
    removal = document(owner.BASE / 'inverse-drop-remove-intent.json')
    created = document(owner.BASE / 'native-drop-created.json')
    need(inverse['oldStillRunning'] is False and removal == {'sha256': operation['candidateDropSha256'], 'identity': created} and
         document(owner.BASE / 'inverse-boot-publish-intent.json') == operation['oldBoot'] and
         document(owner.BASE / 'inverse-enable-reload-observed.json') == {'native': False, 'enabled': True} and
         not os.path.lexists(owner.DROP) and owner.link(owner.BOOT) == operation['oldBoot'],
         'exact_owned_metadata_definition_and_boot_recovery_records_required')
    need(not any(owner.identity_alive(host.m, process) for process in native['processes']),
         'acknowledged_native_metadata_processes_must_remain_gone_after_recovery')
    if inverse['nativeActor'] is not None:
        need(document(owner.BASE / 'inverse-native-terminal.json')['stopped'] is True,
             'owned_native_metadata_stop_completion_required')
    document(owner.BASE / 'inverse-sql-intent.json')
    if (owner.BASE / 'inverse-sql-result.json').exists():
        need(document(owner.BASE / 'inverse-sql-result.json') == {'modeRestored': 'rpc', 'approvalBlocked': True,
             'journalOrProvenanceRowsDeleted': 0}, 'exact_owned_metadata_RPC_inverse_SQL_ACK_required')
    else:
        need(document(owner.BASE / 'inverse-sql-reconciled.json') == {'rpcModeAndOwnedBlockedApprovalObserved': True,
             'originalSqlAcknowledgementPresent': False}, 'explicit_owned_metadata_RPC_SQL_reconciliation_required')
    return {'inverseResultSha256': sha(root.public_input(owner.BASE / 'inverse-result.json')),
            'operationSha256': context.generation()[1]['metadataOperationSha256'],
            'originalStartIntentSha256': sha(root.public_input(owner.BASE / 'old-start-intent.json'))}


def inspect(root, proof, result_sha, manifest_sha):
    operation, initial, result, refs = authenticate_result(root, proof, result_sha, manifest_sha)
    context = completed_context(proof, operation)
    first = completed_catalog(context); capsule = recovery_journals(root, context, operation, initial, result)
    context.generation_terminal(); context.accepted_source_closure()
    global_proof = root.child(context, 'capsule-inspect', {})
    observed = global_proof['observation']
    expected = {'pointer': {'current_id': capsule['currentGeneration'], 'previous_id': capsule['previousGeneration']},
                'generationBindingSha256': capsule['generationBindingSha256'],
                'walletStats': {k: capsule['walletStats'][k] for k in ('count', 'sha256')},
                'derivedStamps': {k: capsule['derivedStamps'][k] for k in ('count', 'sha256')}}
    need(global_proof['inspected'] is True and global_proof['databaseWrites'] == 0 and observed == expected,
         'actual_global103_pointer_wallets_stamps_and_generation_binding_must_match_capsule')
    metadata = root.validate_metadata_restored(context)
    need(metadata == root.document(root.BASE / 'metadata-restored.json'), 'same_recorded_owned_RPC_metadata_recovery_required')
    metadata_owner, metadata_host, metadata_operation = context.metadata_inverse_context()
    metadata_records = metadata_journal(root, context, metadata_owner, metadata_host, metadata_operation)
    metadata_actor = metadata_host.actor()
    actors, boots = recovered_readers(root, context, operation); cache, cache_boot = recovered_cache(root, context)
    serving = root.legacy_serving(context, operation)
    need(serving['realServingAccepted'] is True and serving['readerActors'] == actors and
         recovered_readers(root, context, operation) == (actors, boots) and recovered_cache(root, context) == (cache, cache_boot) and
         metadata_host.actor() == metadata_actor and completed_catalog(context) == first,
         'restored_catalog_or_serving_actors_changed_during_completed_inverse_leaf')
    cursor = metadata_host.database()['scan']
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute(), sha(Path(__file__).read_bytes()))),
        'coordinatorOperatorSha256': ROOT_SHA, 'manifestSha256': manifest_sha, 'inverseResultSha256': result_sha,
        'records': refs, 'sourceRelease': proof.RELEASE, 'readIdentity': proof.IDENTITY, 'globalGeneration': '103',
        'globalObservationSha256': sha(encoded(observed)), 'catalog': first, 'readerActors': actors, 'readerBootLinks': boots,
        'cacheActor': cache, 'cacheBoot': cache_boot, 'metadataActor': metadata_actor, 'metadataRecovery': metadata,
        'metadataRecords': metadata_records,
        'sourceActorQualified': False, 'currentWriterQualified': False, 'financialAuthorityQualified': False,
        'currentReadinessQualified': False, 'originalWholeValidatorsPassed': False}
    return {'format': FORMAT, 'validated': True, 'binding': binding, 'bindingSha256': sha(encoded(binding)),
        'observation': {'legacyServing': serving, 'metadataCursor': {k: cursor.get(k) for k in
            ('ingestion_mode', 'next_block', 'target_block', 'target_hash', 'last_scanned_hash')}},
        'sourceActorQualified': False, 'currentWriterQualified': False, 'financialAuthorityQualified': False,
        'currentReadinessQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def validate_inverse_leaf(result_sha, manifest_sha):
    root, proof = load_root(manifest_sha)
    return inspect(root, proof, result_sha, manifest_sha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inverse-sha'); parser.add_argument('--manifest-sha'); args = parser.parse_args()
    if args.inverse_sha is None and args.manifest_sha is None:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'sourceActorQualified': False,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(args.inverse_sha is not None and args.manifest_sha is not None, 'both_actual_inverse_and_manifest_refs_required')
    print(json.dumps(validate_inverse_leaf(args.inverse_sha, args.manifest_sha), sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'validated': False, 'errorClass': type(error).__name__,
                          'automaticRetryAllowed': False})); raise SystemExit(1)
