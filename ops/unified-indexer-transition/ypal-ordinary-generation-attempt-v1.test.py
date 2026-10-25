"""Source/fixture controls only. No production, service, RPC or real candidate."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent

def load(name):
    path = HERE/name
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value

m = load('ypal-ordinary-generation-attempt-v1.py')
w = load('ypal-ordinary-generation-attempt-watch-v1.py')

def config():
    value = {key: '1'*64 for key in m.KEYS-{'format', 'maximumSeconds', 'metadataProvenanceFile'}}
    return {**value, 'format': m.FORMAT+'-input', 'maximumSeconds': 2400, 'metadataProvenanceFile': 'provenance-2-observed.json'}

def worker_fixture(base, work):
    unit = m.UNIT
    for path in [base/(unit+'-started.json'), work/'intent.json', work/'result.json']:
        path.parent.mkdir(exist_ok=True); path.write_bytes(b'fixture')
    state = {'FragmentPath': '/etc/systemd/system/'+unit, 'DropInPaths': '', 'User': 'root', 'Group': 'root',
        'Restart': 'no', 'MainPID': '0', 'ControlPID': '0', 'Job': '', 'ActiveState': 'inactive',
        'InvocationID': 'a'*32, 'ExecMainStartTimestampMonotonic': '200'}
    start = {'definitionSha256': m.sha(b'definition'), 'monotonicUs': 100, 'publicationAllowed': False}
    runtime = {'unit': unit, 'applicationName': m.APP, 'automaticRetry': False, 'invocation': 'a'*32,
        'mainPid': 77, 'startedUnix': time.time()-60, 'inputSha256Ref': '1'*64, 'artifactDigest': m.ARTIFACT,
        'inputSha256': {'private': 'hash'}, 'maximumSeconds': 2400}
    result = {'invocation': 'a'*32, 'childExit': 0, 'failure': None, 'minimumAvailableBytes': 30000000000,
        'inputSha256': '1'*64, 'artifactDigest': m.ARTIFACT}
    docs = {unit+'-start-intent.json': start, unit+'-file-created.json': {'inode': 1},
        unit+'-started.json': {'invocation': 'a'*32, 'unitSha256': start['definitionSha256'], 'main': {'pid': 77}},
        'intent.json': runtime, 'result.json': result}
    watch = types.SimpleNamespace(node_args=lambda _: ['node'], ARTIFACT=Path('/artifact'))
    docs['child-process.json'] = {'pid': 2000000000, 'startTicks': 1, 'processGroup': 2000000000,
        'artifactDigest': m.ARTIFACT, 'commandSha256': m.sha(m.encoded(['node', '/artifact/dist/generation-prepare.mjs']))}
    h = types.SimpleNamespace(legacy=types.SimpleNamespace(state=Mock(return_value=state)),
        meta=types.SimpleNamespace(file_identity=lambda _: {'inode': 1}, identity_alive=Mock(return_value=False)),
        m=object(), watch=watch, h=types.SimpleNamespace(query=Mock(return_value=0)))
    return h, docs, state, runtime, result


def retained_fixture():
    private = {'environmentFileHashes': {'private': 'hash'}}
    actor = {'main': {'pid': 50}, 'writer': private}
    context = {'generation': {'id': '103', 'state': 'ready'}, 'previous': '102', 'ready': True, 'capsuleSchemaPresent': False}
    op = {'oldActor': actor, 'oldBoot': {'inode': 1}, 'consumerFence': {'apis': 'old'}, 'context': context}
    external = m.sha(m.encoded({'consumers': op['consumerFence'], 'private': private['environmentFileHashes']}))
    capsule = {'externalBinding': external, 'currentGeneration': '103', 'previousGeneration': '102', 'preservedGenerations': ['103', '102']}
    runtime = {'invocation': m.RETAINED_INVOCATION, 'maximumSeconds': 1470, 'inputSha256': {'private': 'hash'}}
    result = {'failure': 'bounded_generation_duration_reached', 'childExit': -15, 'automaticRetry': False, 'elapsedSeconds': 1471.393,
        'ownedTermination': {'remainingBackends': 0, 'terminatedBackends': [{'pid': 531217, 'terminated': True}]}}
    docs = {'operation.json': op, 'drained.json': {'operationSha256': m.RETAINED_OPERATION_SHA, 'stopped': True},
        'drain-sessions.json': {'actor': actor}, 'stop-old-intent.json': {'actor': actor},
        'boot-remove-intent.json': op['oldBoot'], 'boot-remove-result.json': {'removed': True},
        'capsule-result.json': capsule, 'capsule-prepared.json': capsule,
        'capsule-intent.json': {'phase': 'capsule', 'payloadSha256': m.sha(m.encoded({'external': external})), 'automaticRetry': False},
        m.RETAINED_UNIT+'-started.json': {'actual': 'started'}, 'intent.json': runtime, 'result.json': result}
    retained = types.SimpleNamespace(operation=Mock(return_value=op), drained=Mock(),
        read_bridge=Mock(return_value={'validated': True}), read_only_capsule=Mock(return_value={'real': 'global-observation'}))
    legacy = types.SimpleNamespace(external=Mock(return_value=external), context=Mock(return_value={**context, 'capsuleSchemaPresent': True}))
    h = types.SimpleNamespace(retained=retained, legacy=legacy, h=types.SimpleNamespace(query=Mock(return_value=[])))
    return h, docs, op, runtime, result


class AttemptControls(unittest.TestCase):
    def test_defaults_are_inert(self):
        for module in [m, w]:
            value = subprocess.run(['/usr/bin/python3', '-I', '-B', module.__file__], capture_output=True, check=True)
            result = json.loads(value.stdout)
            self.assertTrue(result['staticOnly']); self.assertFalse(result['generationStarted'])
            self.assertEqual(result['databaseWrites'], 0); self.assertEqual(result['serviceActions'], 0)

    def test_actual_fixed_source_closure_is_finite_literal_and_exact(self):
        node = next(node for node in ast.parse(Path(m.__file__).read_bytes()).body if isinstance(node, ast.Assign) and
            any(isinstance(target, ast.Name) and target.id == 'SOURCE_PINS' for target in node.targets))
        self.assertEqual(ast.literal_eval(node.value), m.SOURCE_PINS)
        self.assertNotIn(Path(m.__file__).name, m.SOURCE_PINS)
        for name, digest in m.SOURCE_PINS.items():
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(), digest, name)
        self.assertEqual(m.SOURCE_PINS['ypal-ordinary-generation-v5c.py'], 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da')
        self.assertEqual(m.SOURCE_PINS['ypal-generation-runtime-install-v3.py'], '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b')

    def test_input_exact_actual_refs_and_explicit_bounded_window(self):
        self.assertEqual(m.config_checked(config()), config())
        for key, bad in [('maximumSeconds', True), ('maximumSeconds', 1469), ('maximumSeconds', 2401),
                         ('installSha256', '0'*64), ('originalInstallSha256', None),
                         ('metadataProvenanceFile', '../provenance-2-observed.json')]:
            with self.assertRaises(RuntimeError): m.config_checked({**config(), key: bad})
        with self.assertRaises(RuntimeError): m.config_checked({**config(), 'retry': True})

    def test_namespace_uses_new_real_paths_not_capsule_or_boot_aliases(self):
        result = m.namespace('1'*64, '2'*64)
        self.assertEqual(result.BASE, m.BASE); self.assertEqual(result.WORK, m.WORK)
        self.assertNotEqual(result.BASE, m.RETAINED_BASE); self.assertNotEqual(result.APP, m.RETAINED_APP)
        self.assertNotIn('drain', vars(result)); self.assertNotIn('restore_activation', vars(result))

    def test_real_compiled_metadata_candidate_has_the_actual_RELEASE_IDENTITY_path(self):
        common = load('ypal-ordinary-consumer-handover-v5.py')
        def public(path, digest):
            raw = (HERE/Path(path).name).read_bytes()
            self.assertEqual(m.sha(raw), digest)
            return raw
        with patch.object(common, 'public', side_effect=public):
            metadata_candidate = common.candidate_namespace({'createdReceiptSha256': '1'*64,
                'ordinaryRuntime': {'resultSha256': '2'*64}})
        metadata_host = types.SimpleNamespace(meta=metadata_candidate)
        actual = types.SimpleNamespace(h=metadata_host)
        self.assertEqual(actual.h.meta.RELEASE, '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3')
        self.assertEqual(actual.h.meta.IDENTITY, common.READ_IDENTITY)
        self.assertEqual(actual.h.meta.READ, 'yunipals_ownership_4e77f52b_v5')

    def test_input_render_uses_original_operation_ACK_and_separate_actual_new_install(self):
        old = {key: '1'*64 for key in ['metadataInputSha256', 'candidateSha256', 'installSha256', 'readAdmissionSha256',
            'metadataOperationSha256', 'metadataSelectedSha256', 'metadataProvenanceSha256']}
        old['metadataProvenanceFile'] = 'provenance-2-observed.json'
        installed = Mock(); runtime = object()
        installer = types.SimpleNamespace(installed=installed, shared=lambda: runtime)
        with patch.object(m, 'document', return_value=old) as document, patch.object(m, 'load', return_value=installer):
            value = m.prepare_input('2'*64, 2400)
            document.assert_called_once_with(m.RETAINED_BASE/'operation.json', m.RETAINED_OPERATION_SHA)
            installed.assert_called_once_with(runtime, '2'*64)
            self.assertEqual(value['originalInstallSha256'], '1'*64); self.assertEqual(value['installSha256'], '2'*64)

    def test_no_legacy_mutating_phase_is_called_and_capsule_is_never_copied(self):
        tree = ast.parse(Path(m.__file__).read_bytes())
        forbidden = {'drain', 'bridge', 'restore_activation', 'reconcile_build', 'accept_candidate'}
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
        self.assertFalse(any(isinstance(node.func, ast.Attribute) and node.func.attr in forbidden for node in calls))
        save_calls = [ast.unparse(node.args[0]) for node in calls if isinstance(node.func, ast.Name) and node.func.id == 'save']
        self.assertFalse(any('capsule-result' in call or 'original-boot' in call for call in save_calls))
        self.assertEqual(m.RETAINED_REFERENCE['capsule-result.json'], m.RETAINED_CAPSULE_SHA)

    def test_both_actual_APPs_have_fixed_exact_query_not_historical_literal(self):
        h = types.SimpleNamespace(h=types.SimpleNamespace(query=Mock(return_value=0)))
        for app in [m.APP, m.RETAINED_APP]:
            m.empty_application(h, app)
            self.assertIn("application_name='"+app+"'", h.h.query.call_args.args[0])
        self.assertNotIn('restored_generation_prepare', h.h.query.call_args.args[0])
        h.h.query.return_value = 1
        with self.assertRaises(RuntimeError): m.empty_application(h, m.RETAINED_APP)
        with self.assertRaises(RuntimeError): m.empty_application(h, 'arbitrary')

    def test_terminal_worker_authenticates_definition_epoch_start_and_backend(self):
        with tempfile.TemporaryDirectory() as folder:
            base, work = Path(folder)/'base', Path(folder)/'work'; base.mkdir(); work.mkdir()
            h, docs, state, runtime, result = worker_fixture(base, work)
            with patch.object(m, 'BASE', base), patch.object(m, 'WORK', work), \
                 patch.object(m, 'document', side_effect=lambda path, *args: docs[path.name]), \
                 patch.object(m, 'protected', return_value=b'definition'):
                self.assertEqual(m.terminal_worker(h, m.UNIT, base, work, m.APP)[2], result)
                for target, key, bad in [(state, 'InvocationID', 'b'*32), (runtime, 'applicationName', m.RETAINED_APP),
                    (state, 'Restart', 'on-failure'), (state, 'ExecMainStartTimestampMonotonic', '99')]:
                    prior = target[key]; target[key] = bad
                    with self.assertRaises(RuntimeError): m.terminal_worker(h, m.UNIT, base, work, m.APP)
                    target[key] = prior
                h.meta.identity_alive.return_value = True
                with self.assertRaises(RuntimeError): m.terminal_worker(h, m.UNIT, base, work, m.APP)

    def test_retained_genuine_failure_capsule_and_fences_are_required(self):
        h, docs, op, runtime, result = retained_fixture()
        old_watch = types.SimpleNamespace(protected_inputs=lambda: runtime['inputSha256'])
        with patch.object(m, 'document', side_effect=lambda path, *args: docs[path.name]), \
             patch.object(m, 'terminal_worker', return_value=({}, runtime, result)), patch.object(m, 'load', return_value=old_watch):
            self.assertEqual(m.retained_current(h)[0], op)
            h.retained.drained.assert_called_with(h.legacy, op)
            h.retained.read_bridge.assert_called_with(h.legacy, 'verify-capsule', {'receipt': docs['capsule-result.json']})
            for target, key, bad in [(runtime, 'invocation', 'f'*32), (result, 'childExit', 0), (result, 'failure', None)]:
                prior = target[key]; target[key] = bad
                with self.assertRaises(RuntimeError): m.retained_current(h)
                target[key] = prior
            result['ownedTermination']['remainingBackends'] = 1
            with self.assertRaises(RuntimeError): m.retained_current(h)

    def test_terminal_only_retention_works_after_reader_publication_without_global_claim(self):
        h, docs, op, runtime, result = retained_fixture()
        h.legacy.context.return_value = {'generation': {'id': '777', 'state': 'ready'}}
        with patch.object(m, 'document', side_effect=lambda path, *args: docs[path.name]), \
             patch.object(m, 'terminal_worker', return_value=({}, runtime, result)), \
             patch.object(m, 'load', return_value=types.SimpleNamespace(protected_inputs=lambda: runtime['inputSha256'])):
            answer = m.retained_current(h, '777', global_checks=False)
            self.assertIsNone(answer[2]); h.legacy.context.assert_not_called(); h.legacy.external.assert_not_called()
            h.retained.read_only_capsule.assert_not_called(); h.h.query.assert_not_called()
            with self.assertRaises(RuntimeError): m.retained_current(h, '777', global_checks=True)

    def test_real_new_unit_keeps_caps_and_bounds_runtime_from_actual_input(self):
        fixture = load('ypal-ordinary-generation-v5c.test.py'); retained = fixture.namespaces()
        legacy = types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=Path('/installed/project'), CLEAN={'PATH': '/usr/bin'}))
        h = types.SimpleNamespace(retained=retained, legacy=legacy, entry=fixture.m, config=config(), input_sha='1'*64)
        result = m.unit_bytes(h).decode()
        self.assertIn('RuntimeMaxSec=2430\n', result); self.assertIn('RuntimeDirectory='+m.WORK.name+'\n', result)
        self.assertIn(str(m.MONITOR)+' --run --input-sha '+'1'*64, result)
        for line in ['Restart=no', 'TimeoutStopSec=20', 'KillMode=control-group', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=']:
            self.assertIn(line+'\n', result)
        h.config['maximumSeconds'] = 1470
        self.assertIn('RuntimeMaxSec=1500\n', m.unit_bytes(h).decode())

    def test_capacity_remains_current_and_reserves_not_reviewed_volatile_bytes(self):
        h = types.SimpleNamespace(config=config(), h=types.SimpleNamespace(query=Mock(return_value={'capsule': '1', 'snapshot': '2', 'generation': '3'})),
            watch=types.SimpleNamespace(available=Mock(return_value=50000000000), no_overlap_window=Mock(return_value=None)))
        proof = m.capacity_preflight(h); self.assertEqual(proof['abortFreeBytes'], 30000000000)
        h.watch.no_overlap_window.assert_called_with(2400)
        self.assertNotIn('availableBytes', m.capacity_policy(h))
        h.watch.available.return_value = 30000000001
        with self.assertRaises(RuntimeError): m.capacity_preflight(h)

    def test_failed_node_cannot_become_candidate_even_with_ready_output(self):
        runtime = {'inputSha256Ref': '1'*64, 'inputSha256': {'private': 'hash'}, 'artifactDigest': m.ARTIFACT, 'maximumSeconds': 2400}
        result = {'childExit': 1, 'failure': 'official_generation_child_failed', 'minimumAvailableBytes': 50000000000,
            'inputSha256': '1'*64, 'artifactDigest': m.ARTIFACT}
        h = types.SimpleNamespace(config=config(), input_sha='1'*64, watch=types.SimpleNamespace(protected_inputs=lambda: runtime['inputSha256']))
        with patch.object(m, 'terminal_worker', return_value=({}, runtime, result)), patch.object(m, 'protected') as read:
            with self.assertRaises(RuntimeError): m.successful_worker_evidence(h)
            read.assert_not_called()

    def test_terminal_export_is_narrow_and_calls_no_current_candidate_validator(self):
        value = {'operatorSha256': '2'*64, 'operationSha256': '3'*64, 'generationId': '777'}; host = object()
        with patch.object(m, 'candidate_context', return_value=(value, host)) as context, \
             patch.object(m, 'retained_current') as retained, patch.object(m, 'terminal_worker'):
            result = m.validate_retained_current('4'*64)
            context.assert_called_once_with('4'*64, current=False)
            retained.assert_called_once_with(host, '777', global_checks=False)
            self.assertTrue(result['readOnly']); self.assertEqual(result['capsuleFile'], str(m.RETAINED_BASE/'capsule-result.json'))
            self.assertEqual(result['originalBootArchive'], str(m.RETAINED_BASE/'original-boot-link'))
            self.assertEqual(result['databaseWrites'], 0)

    def test_candidate_requires_new_real_row_validation_and_fresh_snapshot(self):
        now = time.time()
        snapshot = {'version': 1, 'releaseId': 'release', 'readIdentity': 'read', 'physicalSchema': 'unified_ypal_20261023_v1',
            'metadataReleaseId': 'metadata', 'predecessor': '103', 'capturedAt': '2026-10-25T00:00:00Z',
            'anchors': [{'actualFixtureOnly': True}], 'baseMetadataFrontier': 'frontier'}
        captured = m.datetime.datetime.fromisoformat(snapshot['capturedAt'].replace('Z', '+00:00')).timestamp()
        candidate = {'generationId': '777', 'predecessor': '103', 'validation': {'sourceSnapshot': snapshot}}
        generation = {'state': 'ready', 'published_at': None, 'ownership_release_id': 'release', 'ownership_read_identity': 'read',
            'metadata_release_id': 'metadata', 'validation': candidate['validation']}
        h = types.SimpleNamespace(h=types.SimpleNamespace(query=Mock(), meta=types.SimpleNamespace(RELEASE='release', IDENTITY='read')))
        runtime = {'startedUnix': captured-1}
        with patch.object(m, 'successful_worker_evidence', return_value=(candidate, runtime, {})), patch.object(m.time, 'time', return_value=captured+60):
            h.h.query.side_effect = [generation, 1]
            self.assertEqual(m.successful_worker(h)[0]['generationId'], '777')
            for key, bad in [('state', 'building'), ('published_at', 'already-published'), ('ownership_read_identity', 'other')]:
                prior = generation[key]; generation[key] = bad; h.h.query.side_effect = [generation, 1]
                with self.assertRaises(RuntimeError): m.successful_worker(h)
                generation[key] = prior
            snapshot['capturedAt'] = '2026-10-24T00:00:00Z'; h.h.query.side_effect = [generation, 1]
            with self.assertRaises(RuntimeError): m.successful_worker(h)

    def test_known_child_process_epoch_cannot_be_called_terminal(self):
        pid = os.getpid(); raw = (Path('/proc')/str(pid)/'stat').read_text()
        ticks = int(raw[raw.rfind(')')+2:].split()[19])
        with self.assertRaises(RuntimeError): m.child_epoch_gone({'pid': pid, 'startTicks': ticks, 'processGroup': pid})
        m.child_epoch_gone({'pid': pid, 'startTicks': ticks+1, 'processGroup': pid})

    def test_monitor_window_input_is_exact_and_bool_never_is_duration(self):
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder)/'input.json'; value = config(); raw = m.encoded(value); path.write_bytes(raw); path.chmod(0o600)
            with patch.object(w, 'INPUT', path):
                self.assertEqual(w.configuration(m.sha(raw))['maximumSeconds'], 2400)
                with self.assertRaises(RuntimeError): w.configuration('2'*64)
                value['maximumSeconds'] = True; raw = m.encoded(value); path.write_bytes(raw)
                with self.assertRaises(RuntimeError): w.configuration(m.sha(raw))

    def test_private_telemetry_accepts_only_hash_length_start_wait_fields(self):
        row = {'pid': 44, 'backendStartedUnix': '1', 'querySha256': 'a'*64, 'queryBytes': 100,
            'queryStartedUnix': '2', 'state': 'active', 'waitEventType': 'IO', 'waitEvent': 'DataFileRead'}
        with tempfile.TemporaryDirectory() as folder, patch.object(w, 'WORK', Path(folder)), \
             patch.object(w, 'run', return_value=json.dumps({'rows': [row]}).encode()) as command:
            w.capture_telemetry(0, 1)
            captured = json.loads((Path(folder)/'statement-0000.json').read_bytes())
            self.assertFalse(captured['rawSqlExported']); self.assertEqual(captured['rows'], [row])
            self.assertEqual((Path(folder)/'statement-0000.json').stat().st_mode&0o777, 0o600)
            parameters = json.loads(command.call_args.args[1]); self.assertEqual(parameters, {'app': w.APP, 'since': 1})
            command.return_value = json.dumps({'rows': [{**row, 'query': 'forbidden raw SQL'}]}).encode()
            with self.assertRaises(RuntimeError): w.capture_telemetry(1, 1)
            command.return_value = json.dumps({'rows': [row]*5}).encode()
            with self.assertRaises(RuntimeError): w.capture_telemetry(1, 1)
        self.assertIn('application_name=$1', w.TELEMETRY_JS)
        self.assertIn('usename=current_user', w.TELEMETRY_JS)
        self.assertIn('extract(epoch FROM backend_start)>=$2', w.TELEMETRY_JS)
        self.assertIn("encode(sha256(convert_to(query,'UTF8')),'hex')AS", w.TELEMETRY_JS)

    def test_monitor_preserves_owned_cancellation_and_pool_disk_floors(self):
        self.assertEqual((w.MIN_RESERVE, w.ABORT_FREE, w.MIN_SECONDS, w.MAX_SECONDS), (25000000000, 30000000000, 1470, 2400))
        old = load('ypal-ordinary-generation-watch-v5c.py')
        for name in ['stop_owned', 'backend_query', 'no_overlap_window', 'protected_inputs']:
            self.assertEqual(getattr(w, name).__code__.co_code, getattr(old, name).__code__.co_code)
        self.assertEqual(w.ARTIFACT.name, m.ARTIFACT)
        self.assertEqual(w.ENV_FILES[-1], str(m.BASE/'generation.public.env'))


if __name__ == '__main__': unittest.main()
