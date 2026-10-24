#!/usr/bin/env python3
"""Real held-ACK pipes and sealed descriptors; no SQL/provider/host operations."""
import ast
import contextlib
import fcntl
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


m = load('ypal-native-cutover-v2.py')
transport = load('ypal-reader-peer-runtime-v1.py')
pure = load('ypal-native-cutover-proof-v1.py')
facade = load('ypal-native-cutover-proof-v2.py')
read_pure = load('ypal-combined-read-admission-v2.py')
finish = load('ypal-cache-finish-v3.py')
TEMPLATE = (HERE / 'ypal-native-cutover-v1.py').read_bytes()


class Controls(unittest.TestCase):
    def test_manifest_context_alias_or_missing_real_producer_refuses(self):
        value = json.loads((HERE / 'ypal-native-cutover-v2.manifest.json').read_bytes())
        name = facade.CONTEXT_NAMES['observer']
        value['contexts']['observer']['sha256'] = 'a' * 64
        value['dependencies'][name] = 'a' * 64
        self.assertEqual(facade.manifest_contract(value), value)
        value['contexts']['observer']['sha256'] = 'b' * 64
        with self.assertRaisesRegex(RuntimeError, 'context_pin'):
            facade.manifest_contract(value)
        value['contexts']['observer']['sha256'] = None
        with self.assertRaisesRegex(RuntimeError, 'context_pin'):
            facade.manifest_contract(value)

    def test_recorded_observer_ACK_never_claims_current_and_operational_inspection_can_advance(self):
        value = {'format': 'yunipals-ypal-restored-ordinary-observer-v1', 'recordedActivationQualified': True,
                 'observerScopeOnly': True, 'ordinarySustainedObserver': True, 'receiptSha256': 'a' * 64,
                 'operatorSha256': 'b' * 64, 'releaseId': facade.DATA_IDENTITY['sourceRelease'],
                 'observerCurrentQualified': False, 'sourceActorQualified': False, 'currentWriterQualified': False,
                 'databaseWrites': 0, 'serviceActions': 0, 'providerRequests': 0,
                 'dataIdentity': {'fixture': 'physical44'}, 'initialSourceContext': {'fixture': 'ancestry'}}
        self.assertNotIn('validated', facade.observer_acknowledged(value, 'a' * 64, 'b' * 64))
        with self.assertRaisesRegex(RuntimeError, 'immutable_new_observer'):
            facade.observer_acknowledged({**value, 'observerCurrentQualified': True}, 'a' * 64, 'b' * 64)
        live = {**value, 'validated': True, 'observerCurrentQualified': True, 'freeOnly': True,
                'runtimeMaximumSeconds': None, 'paidAuthority': False, 'actor': {'pid': 100, 'startTicks': 40},
                'bootLink': {'inode': 10}, 'readOnlyInspect': {'completedCycles': 1}}
        self.assertEqual(facade.observer_identity(live),
                         facade.observer_identity({**live, 'readOnlyInspect': {'completedCycles': 2}}))
        self.assertNotEqual(facade.observer_identity(live), facade.observer_identity({**live, 'actor': {'pid': 101}}))
        with self.assertRaisesRegex(RuntimeError, 'current_nonexpiring_observer'):
            facade.observer_identity({**live, 'currentWriterQualified': True})

    def login_journal(self):
        p = facade.inherited_methods((HERE / facade.TEMPLATE).read_bytes(), lambda *args: None)
        directory = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(directory.cleanup)
        p.BASE = Path(directory.name)
        context = p.SourceIndependentReaderMethods()
        before = {'roles': [{'name': name, 'oid': oid, 'login': name not in p.LOGIN_ROLES}
                           for name, oid in p.LEAF_ROLES.items()]}
        after, delta = p.login_postcatalog(before)
        context.sql_ack = {'postProof': {'catalog': before}}
        context.prepared = {'config': {'readAdmissionSha256': 'b' * 64}}
        context.inputs = {'sourceManifestSha256': 'c' * 64}
        owner_sha = m.sha((HERE / 'ypal-native-cutover-v2.py').read_bytes())
        context.manifest = {'files': {'ypal-native-cutover-v2.py': owner_sha}}
        def save(name, value):
            raw = p.encoded(value); path = p.BASE / name; path.write_bytes(raw); path.chmod(0o600); return p.sha(raw)
        binding = {'format': m.FORMAT, 'operatorSha256': owner_sha, 'bootId': p.boot(),
                   'sourceManifestSha256': context.inputs['sourceManifestSha256']}
        operation = {'binding': binding, 'reviewHash': p.sha(p.encoded(binding))}
        operation_sha = save('operation.json', operation)
        intent = {'format': 'yunipals-ypal-native-reader-LOGIN-v1', 'reviewHash': operation['reviewHash'],
                  'bootId': p.boot(), 'authorizationSha256': p.sha(p.encoded(delta)), 'operationSha256': operation_sha}
        intent_sha = save('roles-intent.json', intent)
        prepared_sha = save('roles-prepared.json', {'mode': 'roles', 'xid': '900', 'before': before, 'after': after})
        ack = {'format': 'yunipals-ypal-native-reader-LOGIN-v1', 'operatorSha256': owner_sha,
               'operationSha256': operation_sha, 'intentSha256': intent_sha, 'preparedSha256': prepared_sha,
               'bootId': p.boot(), 'committed': True, 'xid': '900', 'afterCatalogSha256': p.sha(p.encoded(after))}
        save('roles-admitted.json', ack)
        return p, context, before, after, ack, save

    def test_source_dependent_old_constructor_and_factories_are_excluded(self):
        p = facade.inherited_methods((HERE / facade.TEMPLATE).read_bytes(), lambda *args: None)
        self.assertFalse(facade.EXCLUDED_METHODS & set(p.SourceIndependentReaderMethods.__dict__))
        self.assertTrue(callable(p.SourceIndependentReaderMethods.reader))
        self.assertTrue(callable(p.SourceIndependentReaderMethods.logins_enabled))

    def test_real_fs_LOGIN_chain_accepts_only_new_owner_with_unchanged_wire_domain(self):
        p, context, before, after, ack, save = self.login_journal()
        self.assertTrue(context.logins_enabled())
        save('roles-admitted.json', {**ack, 'operatorSha256': m.TEMPLATE_SHA})
        with self.assertRaisesRegex(RuntimeError, 'owned_two_reader_LOGIN'):
            context.logins_enabled()

    def test_terminal_inverse_never_constructs_active_source_validator(self):
        p, context, before, after, ack, save = self.login_journal()
        context.host = types.SimpleNamespace(read=read_pure, read_rehearsal={'after': before})
        context.catalog = lambda: after
        context.columns_current = lambda: True
        context.guard_scope = lambda reads: {'fixture': True, 'reads': reads}
        calls = []
        context.phase = types.SimpleNamespace(inverse_scope=lambda *args: calls.append(args) or {'validated': True})
        source = {'format': 'yunipals-ypal-restored-metadata-context-v1-inverse-source', 'validated': True,
                  'restoreReceiptSha256': '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1',
                  'restoreOperatorSha256': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34',
                  'sourceState': 'terminal', 'poolMaximum': 5, 'frameworkReadinessQualified': False,
                  'currentCanonicalCoverageQualified': False, 'readerRoleGraphQualified': False,
                  'financialAuthorityQualified': False}
        proof = object.__new__(facade.Proof); proof.pure = p; proof.manifest_sha = 'c' * 64
        def module_context(role):
            self.assertEqual(role, 'metadataStatic')
            return types.SimpleNamespace(validate_inverse_runtime=lambda: source)
        proof.module_context = module_context
        result = proof.inverse_scope(context)
        self.assertTrue(result['inverseOnly']); self.assertFalse(result['ready'])
        self.assertEqual(calls[0], (True, True, after))
        self.assertEqual(result['sourceState']['sourceState'], 'terminal')
        source['restoreReceiptSha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'terminal_source_inverse_only'):
            proof.inverse_scope(context)

    def test_forward_scope_stays_closed_on_terminal_source(self):
        p, context, before, after, ack, save = self.login_journal()
        proof = object.__new__(facade.Proof); proof.pure = p
        calls = []
        context.phase = types.SimpleNamespace(scope=lambda *args: calls.append(args))
        def fail(): raise RuntimeError('acknowledged_source_terminal_forward_refused')
        proof.module_context = lambda role: types.SimpleNamespace(validate_runtime=fail)
        with self.assertRaisesRegex(RuntimeError, 'terminal_forward_refused'):
            proof.scope(context)
        self.assertEqual(calls, [])

    def test_metadata_callback_binds_exact_actual_admission_plan_and_context_refs(self):
        proof = object.__new__(facade.Proof)
        ref = {'receiptSha256': 'a' * 64, 'planSha256': 'b' * 64, 'contextInputSha256': 'c' * 64}
        context = types.SimpleNamespace(phase=types.SimpleNamespace(admission_ref=ref),
            inputs={'readPlanSha256': 'b' * 64, 'readContextInputSha256': 'c' * 64},
            scope=lambda: {'validated': True, 'readAdmissionSha256': 'a' * 64},
            inverse_scope=lambda _: {'validated': True, 'readAdmissionSha256': 'a' * 64, 'inverseOnly': True})
        callback = proof.metadata_refresh(context, False)
        self.assertEqual(callback['readPlanSha256'], ref['planSha256'])
        self.assertFalse(callback['originalWholeValidatorPassed'])
        self.assertTrue(proof.metadata_refresh(context, True)['inverseOnly'])
        context.inputs['readContextInputSha256'] = 'd' * 64
        with self.assertRaisesRegex(RuntimeError, 'authenticated_read_context'):
            proof.metadata_refresh(context, False)

    def controller(self):
        source_read = transport.public_bytes
        def local_public(path, pin):
            path = Path(path)
            return source_read(HERE / path.name if path.parent == transport.OPS else path, pin)
        self.enterContext(patch.object(transport, 'public_bytes', local_public))
        proof = types.SimpleNamespace(manifest_sha='a' * 64, transport_module=lambda: transport,
                                     transport_current=lambda: {'fixture': True, 'hostQualified': False})
        c = m.assemble(TEMPLATE, proof)
        return c

    def test_only_new_namespace_and_explicit_input_constants_change(self):
        c = self.controller()
        self.assertEqual(c.FORMAT, m.FORMAT)
        self.assertEqual(c.BASE, m.BASE)
        self.assertEqual(c.ENTRY.name, 'ypal-native-cutover-v1.mjs')
        self.assertEqual(c.reuse_evidence['unchangedFunctionCount'], 84)
        self.assertFalse(c.reuse_evidence['historicalModulePatched'])
        old = load('ypal-native-cutover-v1.py')
        self.assertNotEqual(c.BASE, old.BASE)
        self.assertEqual(old.FORMAT, 'yunipals-ypal-native-cutover-v1')
        self.assertEqual(m.sha(TEMPLATE), m.TEMPLATE_SHA)

    def test_changed_template_and_unknown_launch_function_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'frozen344'):
            m.assemble(TEMPLATE + b'\n', types.SimpleNamespace())
        other = ast.parse('def other():pass').body[0]
        with self.assertRaises(RuntimeError): m.transported_function(other)

    def test_cache_finish_and_inverse_share_new_producer_BASE_and_manifest(self):
        old = load('ypal-cache-finish-v2.py')
        namespace = finish.assemble((HERE / finish.TEMPLATE).read_bytes(), types.SimpleNamespace(), types.SimpleNamespace())
        self.assertEqual(namespace.FORMAT, finish.FORMAT)
        self.assertEqual(namespace.BASE, finish.BASE)
        self.assertNotEqual(namespace.BASE, old.BASE)
        self.assertEqual(namespace.MANIFEST.name, 'ypal-native-cutover-v2.manifest.json')
        for name in ['drain_for_inverse', 'restore_old', 'start', 'reconcile_start', 'accept', 'reload_review']:
            self.assertEqual(getattr(namespace, name).__code__.co_code, getattr(old, name).__code__.co_code)
        with tempfile.TemporaryDirectory() as directory:
            namespace.BASE = Path(directory) / 'absent-new-finish'
            stopped = []
            context = types.SimpleNamespace(cache=types.SimpleNamespace(stopped=lambda host: stopped.append(host)), host=object())
            self.assertEqual(namespace.drain_for_inverse(context), {'nativeCacheNeverStarted': True})
            self.assertEqual(stopped, [context.host])

    def test_cache_template_drift_refuses_before_runtime(self):
        with self.assertRaisesRegex(RuntimeError, 'frozen8dea'):
            finish.assemble((HERE / finish.TEMPLATE).read_bytes() + b'\n', None, None)

    def test_reused_recover_metadata_and_current_owner_reach_owned_terminal_without_dispatch(self):
        class ReachedOriginalStart(Exception): pass
        for failure in (None, 'foreign-invocation', 'orphan'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir=HERE) as directory:
                c = self.controller(); c.BASE = Path(directory) / 'coordinator'; c.BASE.mkdir(mode=0o700)
                metadata = load('ypal-restored-metadata-handover-v1.py')
                metadata.BASE = Path(directory) / 'metadata'; metadata.BASE.mkdir(mode=0o700)
                metadata.DROP = metadata.BASE / 'native.conf'; metadata.DROP.write_bytes(b'accepted public overlay')
                metadata.BOOT = metadata.BASE / 'boot'; metadata.BOOT.symlink_to('/etc/systemd/system/' + metadata.UNIT)
                private = metadata.BASE / 'private.env'; private.write_bytes(b'SYNTHETIC=private\n'); private.chmod(0o600)
                definition = metadata.BASE / 'original.service'; definition.write_bytes(b'[Service]\nType=exec\n')
                original = {'unit': {'InvocationID': 'original'}, 'processes': []}
                selected = {'unit': {'InvocationID': 'selected'}, 'processes': []}
                op = {'candidateDropSha256': c.sha(metadata.DROP.read_bytes()),
                      'oldWriter': {'environmentFileHashes': {str(private): c.sha(private.read_bytes())},
                                    'definitions': {str(definition): c.sha(definition.read_bytes())}},
                      'oldActor': original, 'oldSessions': {'owned': [], 'otherPeers': []}, 'oldBoot': metadata.link(metadata.BOOT)}
                selection = {'nativeActor': selected, 'boot': metadata.link(metadata.BOOT), 'selected': True}
                def metadata_save(path, value):
                    raw = c.encoded(value)
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    try: os.write(fd, raw); os.fsync(fd)
                    finally: os.close(fd)
                    c.sync(Path(path).parent); return c.sha(raw)
                selected_sha = metadata_save(metadata.BASE / 'selected.json', selection)
                metadata_save(metadata.BASE / 'native-drop-created.json', metadata.file_identity(metadata.DROP))
                c.save('inverse-global-restored.json', {'currentGeneration': '103'})
                c.save('operation.json', {'syntheticOwnedRootOperation': True})
                c.save('cache-inverse-catalog.json', {'fourOwnedReadsRemoved': True})
                row = {'MainPID': '0', 'ControlPID': '0', 'Job': '', 'ActiveState': 'failed',
                       'InvocationID': 'foreign' if failure == 'foreign-invocation' else 'selected'}
                calls = []; host = object.__new__(metadata.Host)
                host.m = types.SimpleNamespace(protected=pure.protected)
                host.s = types.SimpleNamespace(protected=pure.protected, document=pure.document,
                    save=metadata_save, sync=c.sync, boot=c.boot)
                host.query = lambda sql: [{'pid': 999999, 'backendStart': 'legitimate-reconnected-other-client'}]
                host.refresh = lambda: {'validated': True}
                host.actor = lambda *args, **kwargs: self.fail('terminal branch must not request an active actor')
                db = {'scan': {'ingestion_mode': 'native', 'next_block': 500}, 'approval': None}
                host.database = lambda: db
                proof = object.__new__(facade.Proof)
                proof.pure = facade.inherited_methods((HERE / facade.TEMPLATE).read_bytes(), lambda *args: None)
                def sessions(actor, role):
                    self.assertEqual((actor, role), (selected, '16388')); calls.append('fresh-kernel-attribution')
                    if failure == 'orphan': raise RuntimeError('unattributed_remaining_backend_refused')
                    return {'owned': [], 'otherPeers': [], 'kernelPeerAttribution': True}
                context = types.SimpleNamespace(inverse_scope=lambda _: {'inverseOnly': True}, terminal_sessions=sessions,
                    metadata_inverse_context=lambda: (metadata, host, op),
                    prepared={'config': {'metadataSelectionSha256': selected_sha}},
                    cache=types.SimpleNamespace(META=metadata.BASE, META_OWNER_SHA='a' * 64, stopped=lambda _: True),
                    host=object(), generation=lambda: (None, {'metadataOperationSha256': 'b' * 64}, None, None))
                host.terminal = types.MethodType(proof.metadata_terminal(metadata, context), host)
                c.metadata_inverse_actor = proof.metadata_inverse_actor
                def sql_adapter(_host, scan):
                    # Real owner traversal, with its external SQL adapter isolated.
                    # This test claims no database execution or catalog proof.
                    calls.append('isolated-SQL-adapter')
                    metadata_save(metadata.BASE / 'inverse-sql-intent.json', {'scan': scan.copy()})
                    db['scan'] = {**scan, 'ingestion_mode': 'rpc'}
                    db['approval'] = {'read_identity': pure.IDENTITY, 'state': 'blocked', 'error_code': 'owned_metadata_inverse'}
                def manager(_m, action):
                    self.assertEqual(action, 'start'); calls.append('original-start-boundary')
                    raise ReachedOriginalStart()
                with patch.object(metadata, 'state', return_value=row), \
                     patch.object(metadata, 'loaded', return_value=True), \
                     patch.object(metadata, 'no_live_cli', return_value=None), \
                     patch.object(metadata, 'lock', contextlib.nullcontext), \
                     patch.object(metadata, 'manager', side_effect=manager), \
                     patch.object(metadata, 'inverse_sql', side_effect=sql_adapter), \
                     patch.object(c, 'all_readers_terminal', return_value=True):
                    # The old current-owner terminal method rejects this new
                    # unrelated session against a stale otherPeers snapshot.
                    with self.assertRaisesRegex(RuntimeError, 'new_unattributed_shared_role_backend'):
                        metadata.Host.terminal(host, op, original, op['oldSessions'])
                    expected = ReachedOriginalStart if failure is None else RuntimeError
                    with self.assertRaises(expected): c.recover_metadata(context, {})
                self.assertEqual((c.BASE / 'metadata-inverse-intent.json').exists(), failure is None)
                self.assertEqual((metadata.BASE / 'inverse-intent.json').exists(), failure is None)
                if failure is None:
                    self.assertGreaterEqual(calls.count('fresh-kernel-attribution'), 3)
                    self.assertEqual(calls.count('original-start-boundary'), 1)
                    self.assertFalse(metadata.DROP.exists())
                    self.assertTrue(metadata.BOOT.is_symlink())
                    self.assertTrue((metadata.BASE / 'old-start-intent.json').exists())
                else: self.assertNotIn('original-start-boundary', calls)

    def test_nine_exact_receipt_inputs_keep_strict_hash_validation(self):
        c = self.controller()
        keys = {'sourceManifestSha256', 'cachePreparedSha256', 'publisherInstallSha256', 'mainInstallSha256',
                'parityWitnessSha256', 'sustainedObserverSha256', 'readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256'}
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            path = Path(directory) / 'inputs.json'; value = {key: 'a' * 64 for key in keys}
            path.write_bytes(c.encoded(value)); self.assertEqual(c.inputs(path, c.sha(path.read_bytes())), value)
            for key in ['readPlanSha256', 'cacheInputsSha256']:
                malformed = {**value, key: 'unknown'}; path.write_bytes(c.encoded(malformed))
                with self.assertRaises(RuntimeError): c.inputs(path, c.sha(path.read_bytes()))
            path.write_bytes(c.encoded({key: val for key, val in value.items() if key != 'readContextInputSha256'}))
            with self.assertRaises(RuntimeError): c.inputs(path, c.sha(path.read_bytes()))

    def protocol(self, lost=False, delay=False, start_failure=False):
        c = self.controller()
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup); root = Path(directory.name)
        base = root / 'operation'; base.mkdir(mode=0o700); publication = base / 'publication'; publication.mkdir(mode=0o700)
        marker = base / 'durable.json'; child = root / 'child.py'
        child.write_text('''import json,sys,os,time
request=json.loads(sys.stdin.readline())
assert request['sourceManifestSha256']==sys.argv[3]
assert 'DATABASE_URL'not in json.dumps(request)
assert 'synthetic-password'not in json.dumps(request)
for fd in json.loads(sys.argv[4]):os.fstat(fd)
if sys.argv[2]=='delay':time.sleep(60)
backend={'pid':9,'backendStart':'123','roleOid':'16388','databaseOid':'17584','xid':None,'clientAddress':None,'clientPort':-1}
print(json.dumps({'event':'session-opened','mode':'publish','currentUser':'yunipals','sessionUser':'yunipals','backend':backend}),flush=True)
assert json.loads(sys.stdin.readline())['phase']=='session-opened'
print(json.dumps({'event':'publication-prepared','xid':'900','backend':{**backend,'xid':'900'}}),flush=True)
ack=json.loads(sys.stdin.readline());assert ack['event']=='root-authorized'and ack['phase']=='publication-prepared'
assert os.path.exists(sys.argv[1])
if sys.argv[2]=='lost':sys.exit(1)
print(json.dumps({'event':'result','value':{'published':True,'xid':'900'}}),flush=True)
''')
        original = subprocess.Popen; calls = []; descriptors = []
        def spawn(args, **kwargs):
            calls.append(args); descriptors.extend(kwargs['pass_fds'])
            self.assertIn('--reuid=0', args); self.assertIn('--bounding-set=-all', args)
            self.assertEqual(len(kwargs['pass_fds']), 9)
            for fd in kwargs['pass_fds']: self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), 15)
            self.assertIn('data:text/javascript;base64,', args[-2]); self.assertEqual(args[-1], str(c.ENTRY))
            self.assertIn('YUNIPALS_READER_PUBLIC_FD', kwargs['env'])
            self.assertFalse(any('synthetic-password' in arg or 'DATABASE_URL' in arg for arg in args))
            self.assertIn('synthetic-password', kwargs['env']['DATABASE_URL'])
            if start_failure: raise OSError('synthetic spawn refusal')
            return original([sys.executable, '-B', str(child), str(marker), 'delay' if delay else 'lost' if lost else 'pass',
                             m.WIRE_MANIFEST_SHA, json.dumps(kwargs['pass_fds'])], **kwargs)
        self.enterContext(patch.object(c, 'BASE', base)); self.enterContext(patch.object(c, 'PUBLICATION', publication))
        self.enterContext(patch.object(c.subprocess, 'Popen', side_effect=spawn))
        self.enterContext(patch.object(c, 'owned_peer_session', return_value=[{'pid': 9, 'backendStart': '123'}]))
        context = types.SimpleNamespace(proof=pure, host=types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=root)),
            manifest={'files': {c.ENTRY.name: transport.PINS[c.ENTRY.name]}}, inputs={'sourceManifestSha256': 'a' * 64},
            business_environment=lambda: {'DATABASE_URL': 'postgresql://synthetic:synthetic-password@localhost/fixture'})
        def acknowledge(message):
            self.assertEqual(message['xid'], '900'); c.save('durable.json', {'fsynced': True}); return True
        return c, context, acknowledge, calls, descriptors, base

    def assert_closed(self, descriptors):
        for fd in descriptors:
            with self.assertRaises(OSError): os.fstat(fd)

    def test_real_pipe_keeps_session_and_fsynced_prepared_boundary_and_wire_manifest(self):
        c, context, acknowledge, calls, fds, base = self.protocol()
        result = c.child(context, 'publish', {'generationId': '104'}, acknowledge)
        self.assertEqual(result, {'published': True, 'xid': '900'})
        self.assertEqual(len(calls), 1); self.assertTrue((base / 'durable.json').exists())
        self.assertNotIn('synthetic-password', (base / 'publication/publish-child.json').read_text())
        self.assert_closed(fds)

    def test_lost_ACK_keeps_intent_and_never_sends_another_child(self):
        c, context, acknowledge, calls, fds, base = self.protocol(lost=True)
        with self.assertRaises(RuntimeError): c.child(context, 'publish', {}, acknowledge)
        self.assertEqual(len(calls), 1); self.assertTrue((base / 'durable.json').exists())
        self.assertFalse((base / 'result.json').exists()); self.assert_closed(fds)

    def test_deadline_and_start_failure_close_all_public_descriptors(self):
        c, context, acknowledge, calls, fds, base = self.protocol(delay=True)
        with patch.object(c, 'MAX_PREPARATION_SECONDS', .05):
            with self.assertRaisesRegex(RuntimeError, 'deadline_expired'):
                c.child(context, 'publish', {}, acknowledge)
        self.assertEqual(len(calls), 1); self.assert_closed(fds)
        self.assertFalse((base / 'durable.json').exists())

    def test_spawn_failure_also_closes_descriptors_without_phase_receipt(self):
        c, context, acknowledge, calls, fds, base = self.protocol(start_failure=True)
        with self.assertRaises(OSError): c.child(context, 'publish', {}, acknowledge)
        self.assertEqual(len(calls), 1); self.assert_closed(fds)
        self.assertFalse((base / 'publication/publish-child.json').exists())

    def test_actual_main_action_launch_uses_sealed_transport_and_frozen_wire(self):
        c = self.controller(); launched = []; fds = []
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'probe.py'
            script.write_text('''import json,sys,os
request=json.loads(sys.stdin.readline())
assert request['sourceManifestSha256']==sys.argv[1]
for fd in json.loads(sys.argv[2]):os.fstat(fd)
print(json.dumps({'format':'yunipals-ypal-native-action-preflight-v1','passed':True,'actualInstalledApp':True,
'listenerStarted':False,'databaseReadOnly':True,'actualCanonicalFullReceiptProof':True,
'sourceRelease':sys.argv[3],'readIdentity':sys.argv[4],'providerAttempts':0,'listenAttempts':0,'databaseWrites':0}))
''')
            context = types.SimpleNamespace(scope=lambda _: True, capacity=lambda _: True,
                query=lambda _: {'format': 'yunipals-ypal-known-bnb-action-v1', 'actualFixtureAvailable': True,
                                 'nativeSchema': pure.PHYSICAL, 'request': {'fixture': True}}, proof=pure,
                host=types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=directory)),
                inputs={'sourceManifestSha256': 'a' * 64})
            original = subprocess.Popen
            def spawn(args, **kwargs):
                launched.append(args); fds.extend(kwargs['pass_fds'])
                self.assertIn('--reuid=968', args); self.assertIn('--regid=962', args)
                self.assertIn('--no-new-privs', args); self.assertEqual(args[-1], str(c.OPS / 'ypal-native-reader-probe-v1.mjs'))
                self.assertEqual(len(fds), 9); self.assertIn('YUNIPALS_READER_PUBLIC_FD', kwargs['env'])
                self.assertNotIn('DATABASE_URL', kwargs['env'])
                for fd in fds: self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), 15)
                return original([sys.executable, str(script), m.WIRE_MANIFEST_SHA, json.dumps(fds), pure.RELEASE, pure.IDENTITY], **kwargs)
            with patch.object(c.subprocess, 'Popen', side_effect=spawn), \
                 patch.object(c.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=968, pw_gid=962)), \
                 patch.object(c, 'public_input', return_value=b'SELECT fixture'):
                self.assertTrue(c.action_preflight(context)['proof']['passed'])
            self.assertEqual(len(launched), 1); self.assert_closed(fds)


if __name__ == '__main__': unittest.main()
