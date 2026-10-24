#!/usr/bin/env python3
"""Local protected-file and reused-validator controls; no production actions."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load('ypal-native-inverse-leaf-v1.py')
coordinator = load('ypal-native-cutover-v2.py')
read = load('ypal-restored-read-admission-v1.py')
pure = load('ypal-native-cutover-proof-v1.py')


class Controls(unittest.TestCase):
    def root_fixture(self):
        directory = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(directory.cleanup)
        proof = types.SimpleNamespace(manifest_sha=m.MANIFEST_SHA, source_manifest=lambda pin: {'fixtureManifest': pin})
        root = coordinator.assemble((HERE / 'ypal-native-cutover-v1.py').read_bytes(), proof)
        root.BASE = Path(directory.name); root.PUBLICATION = root.BASE / 'publication'; root.PUBLICATION.mkdir(mode=0o700)
        binding = {'format': root.FORMAT, 'operatorSha256': m.ROOT_SHA, 'bootId': root.boot(),
                   'sourceManifestSha256': m.MANIFEST_SHA, 'inputs': {'sourceManifestSha256': m.MANIFEST_SHA}}
        operation = {'binding': binding, 'reviewHash': root.sha(root.encoded(binding))}
        root.save('operation.json', operation)
        initial = {'format': root.FORMAT, 'bootId': root.boot(), 'operationSha256': root.sha(root.public_input(root.BASE / 'operation.json')),
                   'sourceManifestSha256': m.MANIFEST_SHA, 'publication': {'published': False}}
        root.save('inverse-intent.json', {'binding': initial, 'reviewHash': root.sha(root.encoded(initial))})
        for name in ('inverse-global-restored.json', 'metadata-restored.json', 'cache-inverse-catalog.json'):
            root.save(name, {'syntheticProtectedOwnedRecord': name})
        refs = {name: root.sha(root.public_input(root.BASE / name)) for name in
            ('operation.json', 'inverse-intent.json', 'inverse-global-restored.json', 'metadata-restored.json', 'cache-inverse-catalog.json')}
        result = {'format': root.FORMAT, 'restored': True, 'bootId': root.boot(), 'operatorSha256': m.ROOT_SHA,
                  'operationSha256': refs['operation.json'], 'inverseIntentSha256': refs['inverse-intent.json'],
                  'globalInverseSha256': refs['inverse-global-restored.json'], 'metadataInverseSha256': refs['metadata-restored.json'],
                  'cacheInverseSha256': refs['cache-inverse-catalog.json'], 'globalGeneration': '103',
                  'allOwnedCacheFourReadsAndTwoLOGINChangesReversed': True, 'fullLegacyServingAccepted': True,
                  'recurringGenerationKeptStoppedUntilSupervisedLineagePolicy': True, 'originalPIDReturnedClaimed': False,
                  'frozenPriorAcknowledgementsRewritten': False, 'sourceActions': 0, 'financialActions': 0,
                  'serving': {'realServingAccepted': True}}
        pin = root.save('inverse-result.json', result)
        return root, proof, operation, result, pin

    def test_actual_frozen_root_manifest_and_static_default(self):
        self.assertEqual(m.sha((HERE / m.ROOT.name).read_bytes()), m.ROOT_SHA)
        self.assertEqual(m.sha((HERE / 'ypal-native-cutover-v2.manifest.json').read_bytes()), m.MANIFEST_SHA)
        result = subprocess.run([sys.executable, '-I', '-B', str(HERE / 'ypal-native-inverse-leaf-v1.py')],
                                capture_output=True, check=True)
        self.assertEqual(result.stderr, b''); self.assertTrue(json.loads(result.stdout)['staticOnly'])

    def test_unknown_manifest_refuses_before_runtime_construction(self):
        with self.assertRaisesRegex(RuntimeError, 'frozen1599'):
            m.load_root('a' * 64)

    def test_real_protected_operation_inverse_and_result_chain(self):
        root, proof, operation, result, pin = self.root_fixture()
        actual = m.authenticate_result(root, proof, pin, m.MANIFEST_SHA)
        self.assertEqual(actual[0], operation); self.assertEqual(actual[2], result)

    def test_raw_restored_flag_or_partial_receipt_is_never_enough(self):
        root, proof, operation, result, pin = self.root_fixture()
        for field, changed in [('fullLegacyServingAccepted', False), ('allOwnedCacheFourReadsAndTwoLOGINChangesReversed', False),
                               ('globalGeneration', '104'), ('operatorSha256', 'a' * 64), ('financialActions', 1)]:
            with self.subTest(field=field):
                path = root.BASE / 'inverse-result.json'; path.write_bytes(root.encoded({**result, field: changed}))
                with self.assertRaises(RuntimeError): m.authenticate_result(root, proof, root.sha(path.read_bytes()), m.MANIFEST_SHA)

    def test_changed_recovery_record_or_foreign_inverse_intent_refuses(self):
        root, proof, operation, result, pin = self.root_fixture()
        path = root.BASE / 'metadata-restored.json'; path.write_bytes(root.encoded({'changed': True}))
        with self.assertRaisesRegex(RuntimeError, 'complete_owned_inverse_chain'):
            m.authenticate_result(root, proof, pin, m.MANIFEST_SHA)
        inverse = root.BASE / 'inverse-intent.json'; row = root.document(inverse)
        row['binding']['operationSha256'] = 'b' * 64; inverse.write_bytes(root.encoded(row))
        with self.assertRaises(RuntimeError): m.authenticate_result(root, proof, pin, m.MANIFEST_SHA)

    def test_completed_context_has_no_forward_or_terminal_writer_callback(self):
        class Base:
            def __init__(self, inputs): self.inputs = inputs
            def inverse_scope(self, *args): raise AssertionError('old source predicate must not execute')
            def scope(self, *args): raise AssertionError('old forward predicate must not execute')
        proof = types.SimpleNamespace(Context=Base); context = m.completed_context(proof, {'binding': {'inputs': {}}})
        with self.assertRaisesRegex(RuntimeError, 'no_forward'): context.scope()
        with self.assertRaisesRegex(RuntimeError, 'after_four_cache_reads'): context.inverse_scope(True)
        with patch.object(m, 'completed_catalog', return_value={'sourceActorQualified': False}):
            self.assertFalse(context.inverse_scope(False)['sourceActorQualified'])

    def graph_fixture(self):
        ref = {'receiptSha256': 'a' * 64, 'planSha256': 'b' * 64, 'contextInputSha256': 'c' * 64}
        before = {'roles': [{'name': 'yunipals_unified_api', 'login': False}], 'targetEdges': []}
        catalog = {'read': before, 'allColumnAcl': []}
        reader = types.SimpleNamespace(catalog=lambda: copy.deepcopy(catalog))
        parts = {'host': reader, 'rehearsal': {'after': copy.deepcopy(catalog)}, 'reference': {
            'receiptSha256': ref['receiptSha256'], 'planSha256': ref['planSha256'], 'contextInputSha256': ref['contextInputSha256']}}
        self.enterContext(patch.object(read, 'admitted_components', return_value=parts))
        context = types.SimpleNamespace(logins_enabled=lambda: False, phase=types.SimpleNamespace(admission_ref=ref),
            host=types.SimpleNamespace(new_read=read, read=read, read_rehearsal={'after': before}), catalog=lambda: copy.deepcopy(before),
            sql_ack={'postProof': {'allColumnAcl': []}},
            columns_current=lambda: True, guard_scope=lambda reads: {'semanticCatalogSha256': 'd' * 64, 'reads': reads})
        return context, catalog, ref

    def test_reused_READ_graph_validator_requires_all_columns_and_exact143(self):
        context, catalog, ref = self.graph_fixture()
        first = m.completed_catalog(context)
        self.assertTrue(first['read143Preserved']); self.assertFalse(first['sourceActorQualified'])
        catalog['read']['nativeMetadataAdoptions'] = [{'state': 'blocked', 'error_code': 'owned_metadata_inverse'}]
        context.catalog = lambda: copy.deepcopy(catalog['read'])
        self.assertEqual(m.completed_catalog(context), first)
        catalog['allColumnAcl'].append({'relation': 'managed', 'edges': [{'privilege': 'UPDATE'}]})
        with self.assertRaisesRegex(RuntimeError, 'all_grantee_columns'):
            m.completed_catalog(context)

    def test_remaining_LOGIN_or_cache4_and_changed_guard_refuse(self):
        context, catalog, ref = self.graph_fixture()
        context.logins_enabled = lambda: True
        with self.assertRaisesRegex(RuntimeError, 'reversed_two_LOGIN'): m.completed_catalog(context)
        context.logins_enabled = lambda: False
        context.catalog = lambda: {'roles': [], 'targetEdges': [{'ownedCache4StillPresent': True}]}
        with self.assertRaisesRegex(RuntimeError, 'no_cache4'): m.completed_catalog(context)
        context.catalog = lambda: context.host.read_rehearsal['after']
        def guard(_): raise RuntimeError('guard_ACL_drift')
        context.guard_scope = guard
        with self.assertRaisesRegex(RuntimeError, 'guard_ACL_drift'): m.completed_catalog(context)

    def test_unknown_XID_never_turns_into_a_recovery_ACK(self):
        for state in ('aborted', 'in progress', None):
            with self.subTest(state=state):
                with self.assertRaisesRegex(RuntimeError, 'must_be_committed'):
                    m.committed(types.SimpleNamespace(xid_status=lambda c, x: state), None, '900')

    def test_actual_restored_reader_private_start_and_boot_records_are_rechecked(self):
        root, _, _, _, _ = self.root_fixture()
        original, current, descriptors, boots = {}, {}, {}, {}
        unit_keys = ('ExecStart', 'WorkingDirectory', 'User', 'Group', 'EnvironmentFiles', 'KillMode',
                     'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload', 'Restart')
        for i, (name, peer) in enumerate(pure.PEERS.items()):
            definition = root.BASE / (name + '.service'); definition.write_bytes(b'[Service]\nType=exec\n')
            private = root.BASE / (name + '.private'); private.write_bytes(b'SYNTHETIC=value\n'); private.chmod(0o600)
            unit = {key: key + '-fixture' for key in unit_keys}
            unit.update(Id=peer['unit'], InvocationID='old-' + name, NRestarts='0', Job='', ControlPID='0',
                        UnitFileState='enabled', WantedBy='multi-user.target', FragmentPath=str(definition), DropInPaths='')
            process = {'pid': 100 + i, 'uid': [968] * 4, 'gid': [962] * 4, 'groups': [962],
                       'capabilities': ['0'] * 5, 'noNewPrivileges': True, 'commandSha256': 'a' * 64, 'executable': '/fixture/node'}
            old = {'unit': unit, 'main': {'pid': 100 + i, 'startTicks': 10}, 'processes': [process],
                   'definitions': {str(definition): root.sha(definition.read_bytes())},
                   'privateInputHashes': {str(private): root.sha(private.read_bytes())},
                   'inlineEnvironmentSha256': root.sha(root.encoded([])), 'effectiveEnvironmentSha256': 'b' * 64,
                   'argv': ['/fixture/node', 'server'], 'argvSha256': 'c' * 64}
            now = copy.deepcopy(old); now['main'] = {'pid': 200 + i, 'startTicks': 30}; now['processes'][0]['pid'] = 200 + i
            now['unit']['InvocationID'] = 'recovered-' + name
            original[name], current[name] = old, now
            boot = root.BASE / (name + '.boot'); boot.symlink_to('/etc/systemd/system/' + peer['unit'])
            boots[name] = {'path': str(boot), 'identity': root.inode(boot, True)}
            for suffix in ('intent', 'result'):
                root.save('inverse-reader-' + name + '-boot-restore-' + suffix + '.json', boots[name])
            root.save('legacy-' + name + '-restored.json', {'format': root.FORMAT, 'bootId': root.boot(), 'actor': now})
            root.save('legacy-' + name + '-start-intent.json', {'bootId': root.boot(), 'minimumStartTicks': 20,
                                                            'before': {'InvocationID': 'old-' + name}})
            descriptors[name] = {kind: {'files': {str(root.BASE / (name + '-' + kind + '.conf')): {'text': 'fixture'}}}
                                 for kind in ('preview', 'final')}
        op = {'binding': {'originalReaders': original, 'readerBootLinks': boots, 'readerDescriptors': descriptors}}
        preview = lambda name: 'preview-' + name + '.service'
        context = types.SimpleNamespace(proof=types.SimpleNamespace(PEERS=pure.PEERS, preview_unit=preview,
                    terminal=lambda state: self.assertEqual(state, {'terminal': True})),
            host=types.SimpleNamespace(m=types.SimpleNamespace(protected=root.public_input, service_property=lambda *a: [])),
            reader=lambda name: copy.deepcopy(current[name]),
            state=lambda unit: next((v['unit'] for v in current.values() if v['unit']['Id'] == unit), {'terminal': True}))
        with patch.object(root, 'reader_boot', side_effect=lambda proof, name: boots[name]):
            self.assertEqual(m.recovered_readers(root, context, op)[0], current)
            original_private = root.BASE / 'main.private'; original_private.write_bytes(b'CHANGED=value\n')
            with self.assertRaisesRegex(RuntimeError, 'private_input_drift'):
                m.recovered_readers(root, context, op)
            original_private.write_bytes(b'SYNTHETIC=value\n')
            current['main']['unit']['InvocationID'] = 'foreign'
            with self.assertRaisesRegex(RuntimeError, 'acknowledged_restored_reader'):
                m.recovered_readers(root, context, op)

    def test_owned_metadata_journal_allows_only_real_SQL_ack_or_explicit_reconciliation(self):
        root, _, _, _, _ = self.root_fixture()
        base = root.BASE / 'metadata'; base.mkdir(mode=0o700)
        boot = base / 'boot'; boot.symlink_to('/fixture/original.service')
        metadata = load('ypal-restored-metadata-handover-v1.py')
        metadata.BASE, metadata.BOOT, metadata.DROP = base, boot, base / 'absent-drop'
        old_boot = metadata.link(boot); created = {'dev': 1, 'ino': 2}; operation = {'candidateDropSha256': 'a' * 64, 'oldBoot': old_boot}
        def write(name, value):
            path = base / name; path.write_bytes(root.encoded(value)); path.chmod(0o600)
        for name, value in [('inverse-intent.json', {'oldStillRunning': False, 'nativeActor': None}), ('native-drop-created.json', created),
            ('inverse-drop-remove-intent.json', {'sha256': 'a' * 64, 'identity': created}),
            ('inverse-boot-publish-intent.json', old_boot), ('inverse-enable-reload-observed.json', {'native': False, 'enabled': True}),
            ('inverse-sql-intent.json', {'scan': {'next_block': 100}}), ('inverse-result.json', {'restored': True}),
            ('old-start-intent.json', {'bootId': root.boot()})]: write(name, value)
        host = types.SimpleNamespace(s=types.SimpleNamespace(document=root.document))
        write('selected.json', {'nativeActor': {'processes': []}})
        context = types.SimpleNamespace(generation=lambda: (None, {'metadataOperationSha256': 'b' * 64}, None, None),
            prepared={'config': {'metadataSelectionSha256': root.sha(root.public_input(base / 'selected.json'))}})
        with self.assertRaises(FileNotFoundError): m.metadata_journal(root, context, metadata, host, operation)
        write('inverse-sql-reconciled.json', {'rpcModeAndOwnedBlockedApprovalObserved': True, 'originalSqlAcknowledgementPresent': False})
        self.assertEqual(m.metadata_journal(root, context, metadata, host, operation)['operationSha256'], 'b' * 64)
        write('inverse-drop-remove-intent.json', {'sha256': 'a' * 64, 'identity': {'dev': 1, 'ino': 99}})
        with self.assertRaisesRegex(RuntimeError, 'metadata_definition_and_boot'):
            m.metadata_journal(root, context, metadata, host, operation)

    def test_real_inverse_cache_and_unpublished_global_journals_require_committed_ACK(self):
        root, _, operation, result, _ = self.root_fixture()
        cache = load('ypal-cache-guard-owner-v1.py'); cache.BASE = root.BASE / 'cache'; cache.BASE.mkdir(mode=0o700)
        (cache.BASE / 'sql-committed.json').write_bytes(root.encoded({'actualCommitFixture': True}))
        baseline = {'roles': [{'name': 'reader', 'login': False}]}
        columns = [{'relation': 'fixture', 'edges': []}]
        ref = 'a' * 64; prepared_sha = 'b' * 64; gen_sha = 'c' * 64; producer = 'd' * 64
        initial = root.document(root.BASE / 'inverse-intent.json')
        inverse_sha = root.sha(root.public_input(root.BASE / 'inverse-intent.json'))
        operation_sha = root.sha(root.public_input(root.BASE / 'operation.json'))
        def write(name, value):
            path = root.BASE / name; path.write_bytes(root.encoded(value)); path.chmod(0o600); return root.sha(path.read_bytes())
        intent = {'format': root.FORMAT, 'bootId': root.boot(), 'operationSha256': operation_sha,
                  'inverseIntentSha256': inverse_sha,
                  'cacheCommitSha256': root.sha(root.public_input(cache.BASE / 'sql-committed.json'))}
        intent_sha = write('cache-inverse-intent.json', intent)
        packet = {'mode': 'inverse', 'xid': '901', 'planSha256': root.sha(b'{}'),
                  'postProof': {'catalog': baseline, 'allColumnAcl': columns}}
        packet_sha = write('cache-inverse-prepared.json', packet)
        ack = {'format': 'yunipals-ypal-native-cutover-cache-inverse-v1', 'restored': True, 'bootId': root.boot(),
               'operatorSha256': m.ROOT_SHA, 'operationSha256': operation_sha, 'inverseIntentSha256': inverse_sha,
               'intentSha256': intent_sha, 'preparedSha256': packet_sha, 'cachePreparedSha256': prepared_sha,
               'cacheOriginalProducerSha256': producer, 'readAdmissionSha256': ref, 'generationCandidateSha256': gen_sha,
               'cacheInactive': True, 'cacheBootDisabled': True, 'fourOwnedReadsRemoved': True,
               'frozenCacheOwnerInverseReceiptFabricated': False, 'legacyWorkerMayStartBeforeCapsuleRestore': False,
               'result': {'format': 'yunipals-ypal-cache-guard-sql-v1', 'mode': 'inverse', 'acknowledged': True,
                          'xid': '901', 'resultJson': '{}', 'result': {}}}
        cache_sha = write('cache-inverse-catalog.json', ack)
        global_sha = write('inverse-global-restored.json', {'format': root.FORMAT, 'globalRestored': True,
            'currentGeneration': '103', 'previousGeneration': '102', 'ownedGenerationRetained': '104',
            'publicationNeverCommitted': True, 'capsuleSQLPerformed': False})
        write('metadata-inverse-intent.json', {'format': root.FORMAT, 'bootId': root.boot(), 'operationSha256': operation_sha,
            'metadataOperationSha256': 'e' * 64, 'metadataProducerSha256': 'f' * 64,
            'cacheInverseSha256': cache_sha, 'globalInverseSha256': global_sha, 'newExplicitInverseContext': True})
        cache.META_OWNER_SHA = 'f' * 64
        host = types.SimpleNamespace(read=read, read_rehearsal={'after': baseline}, query=lambda sql: 0)
        state = ['committed']
        context = types.SimpleNamespace(proof=types.SimpleNamespace(CACHE_SHA=producer), host=host, cache=cache,
            phase=types.SimpleNamespace(admission_ref={'receiptSha256': ref}),
            inputs={'cachePreparedSha256': prepared_sha}, prepared={'config': {'generationSha256': gen_sha}},
            sql_ack={'resultJson': '{}', 'postProof': {'allColumnAcl': columns}}, query=lambda sql: state[0],
            generation=lambda: (None, {'generationId': '104', 'metadataOperationSha256': 'e' * 64}, None,
                                {'currentGeneration': '103', 'previousGeneration': '102'}))
        self.assertEqual(m.recovery_journals(root, context, operation, initial, result)['currentGeneration'], '103')
        state[0] = 'in progress'
        with self.assertRaisesRegex(RuntimeError, 'must_be_committed'):
            m.recovery_journals(root, context, operation, initial, result)
        state[0] = 'committed'; ack['result']['acknowledged'] = False; write('cache-inverse-catalog.json', ack)
        with self.assertRaisesRegex(RuntimeError, 'four_cache_READ_inverse'):
            m.recovery_journals(root, context, operation, initial, result)

    def test_leaf_has_no_execution_entrypoints_or_direct_source_qualification(self):
        tree = ast.parse((HERE / 'ypal-native-inverse-leaf-v1.py').read_bytes())
        denied = {'inverse', 'restore_old', 'start', 'stop', 'validate_runtime', 'validate_inverse_runtime',
                  'inverse_source', 'validate_current', 'stable', 'scope', 'manager', 'save'}
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)]
        self.assertFalse({node.func.attr for node in calls} & denied)


if __name__ == '__main__': unittest.main(verbosity=2)
