#!/usr/bin/env python3
"""Local source controls; synthetic refs never represent runtime acceptance."""
import ast
import copy
import importlib.util
import inspect
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('business_inverse', HERE/'arena-ypal-business-inverse-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
P = 'a'*64; H = '0x'+'b'*64


def local_public(path, expected=None, maximum=4000000, private=False):
    path = Path(path)
    source = HERE/path.name
    if not source.exists()and path.name=='final-supervisor-inventory-v1.py':source=HERE.parent/'solana-acceptance'/path.name
    if path.parent == m.TARGET_HELPER.parent:source = HERE.parent/'arena-public-rollback-target-20261023'/path.name
    raw = source.read_bytes()
    if expected is not None and m.sha(raw) != expected:raise RuntimeError('source_pin_mismatch')
    return raw


def composed():
    with patch.object(m, 'public', local_public):return m.composition()


def plan():
    ref = lambda path: {'file': str(path), 'sha256': P}
    return {'format': m.FORMAT, 'operationId': 'abcdef0123456789', 'cutoverOwner': {'file': str(m.OWNER), 'sha256': m.OWNER_SHA},
            'cutoverResult': ref(m.CUTOVER/'result.json'), 'predecessor': ref(m.CUTOVER/'result.json'),
            'targetAdmission': ref('/var/backups/yunipals-arena-public-rollback-target-v1-20261023/result.json'),
            'targetAuth': ref('/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023/auth-result.json'),
            'targetHelper': {'file': str(m.TARGET_HELPER), 'sha256': m.TARGET_HELPER_SHA}, 'floor': {'block': '52648146', 'hash': H},
            'targetKind': 'legacy_rollback', 'childSha256': m.CHILD_SHA,
            'support': copy.deepcopy(m.SUPPORT),
            'projection': {'resultSha256': P, 'inputSha256': P, 'producerSha256': m.PROJECTION_SHA}, 'financialReceiptSha256': P,
            'effectSource': {'inputSha256': P, 'producerSha256': m.EFFECT_SOURCE_SHA}}


def pool_identity(host, value):
    source={'releaseId':value.NATIVE_RELEASE,'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7',
            'manifestHash':'0x'+'c'*64,'startBlock':'52648146','abiHash':'0x'+'d'*64}
    host.provision={'readerRole':{'name':'fixture_public_reader','oid':345},'database':{'oid':17585}}
    if not hasattr(host,'h'):host.h=types.SimpleNamespace()
    host.h.auth={'sourceRole':{'name':'arena_native_reader','oid':123}}
    host.h.manifest={'source':source};host.h.plan={'roleAuth':{'sha256':P}}
    host.projection_actor={'pid':12345,'startTicks':45678,'invocation':'e'*32,'bootId':'11111111-2222-3333-4444-555555555555'}
    return {'format':'yunipals-arena-native-derived-projector-owner-v1-read-pools','producerSha256':m.PROJECTION_SHA,'inputSha256':P,
        'support':host.plan['support'],'sourceRole':host.h.auth['sourceRole'],'nativeRelease':source,'nativeDatabaseOid':17584,
        'publicReaderRole':host.provision['readerRole'],'publicDatabaseOid':17585,'targetAdmissionSha256':P,'targetAuthSha256':P,
        'nativePoolMaximum':1,'publicReadPoolMaximum':1,'nativeWorkerPoolMaximum':31,'publicWorkerPoolMaximum':31,
        'sourceRoleLimit':32,'publicRoleLimit':32,'runtimeEpoch':copy.deepcopy(host.projection_actor)}


class Controls(unittest.TestCase):
    def test_all_actual_direct_sources_and_external_program(self):
        for name, digest in m.SOURCE_PINS.items():self.assertEqual(m.sha(local_public(m.OPS/name)), digest)
        for path, digest in m.EXTERNAL_PROGRAMS.items():self.assertEqual(m.sha(local_public(path)), digest)
        self.assertNotIn(m.FILE.name, m.SOURCE_PINS)

    def test_static_manifest_is_actual_finite_map_and_refuses_drift_before_runtime_evaluation(self):
        spec=importlib.util.spec_from_file_location('actual_inverse_manifest',HERE/'arena-ypal-business-inverse-v1-manifest.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        expected=builder.build(HERE)
        self.assertEqual(json.loads((HERE/m.MANIFEST.name).read_bytes()),expected)
        with patch.object(m,'public',side_effect=local_public):self.assertEqual(m.code_manifest(),expected)
        bad=copy.deepcopy(expected);bad['files']['unknown.py']='b'*64
        def changed(path,*args,**kwargs):
            return json.dumps(bad).encode()if Path(path)==m.MANIFEST else local_public(path,*args,**kwargs)
        with patch.object(m,'public',side_effect=changed),patch.object(m,'evaluate',side_effect=AssertionError('no_runtime_before_source_auth')):
            with self.assertRaisesRegex(RuntimeError,'complete_business_inverse_source_manifest'):m.composition()

    def test_projector_manifest_and_all_six_external_programs_are_authenticated_before_evaluation(self):
        seen=[]
        def actual(path,*args,**kwargs):
            seen.append(str(path));return local_public(path,*args,**kwargs)
        with patch.object(m,'public',side_effect=actual),patch.object(m,'evaluate',return_value='only_after_auth') as evaluate:
            self.assertEqual(m.projection_namespace(),'only_after_auth')
            evaluate.assert_called_once_with(m.PROJECTION,m.PROJECTION_SHA)
        self.assertTrue(all(str(m.TARGET_HELPER.parent/name)in seen for name in
            ['admit-target.py','credentials.py','manifest.json','proposal.json','roles.sql','schema.sql']))
        for refused in [m.PROJECTION_MANIFEST,m.OPS/'arena-native-read-pool-v1.mjs',m.TARGET_HELPER.parent/'roles.sql']:
            def drift(path,*args,**kwargs):
                if Path(path)==refused:raise RuntimeError('source_pin_mismatch')
                return local_public(path,*args,**kwargs)
            with self.subTest(refused=refused),patch.object(m,'public',side_effect=drift),\
                 patch.object(m,'evaluate',side_effect=AssertionError('no_evaluation_before_all_source_auth')):
                with self.assertRaisesRegex(RuntimeError,'source_pin_mismatch'):m.projection_namespace()

    def test_default_inert(self):
        result = subprocess.run(['python3', '-I', '-B', str(HERE/m.FILE.name)], check=True, capture_output=True)
        value = json.loads(result.stdout); self.assertTrue(value['staticOnly']); self.assertEqual(value['databaseWrites'], 0)

    def test_genuine_Arena_runner_accepts_retained_timeout_and_maximum_keywords(self):
        raw=(HERE/'arena-owner-migration-v11.py').read_bytes()
        self.assertEqual(m.sha(raw),'041063b1ff57139cafe835d0bd8e1fca0bd68f8c757e6e82743c50709e2bcb3c')
        runner=types.ModuleType('actual_Arena_runner');exec(compile(raw,'actual_Arena_runner','exec'),runner.__dict__)
        self.assertEqual(str(inspect.signature(runner.run)),'(argv, *, data=None, timeout=8, output=None, maximum=16000000)')
        calls=[]
        def execute(argv,*,input,stdout,stderr,env,timeout):
            calls.append((argv,timeout));return types.SimpleNamespace(returncode=0,stdout=b'owned_fixture',stderr=b'')
        value=composed();host=value.Host.__new__(value.Host);host.h=types.SimpleNamespace(m=runner)
        with patch.object(runner,'subprocess',types.SimpleNamespace(run=execute,PIPE=-1)):
            self.assertEqual(host.run(['/fixture/systemctl'],timeout=40,maximum=1000),b'owned_fixture')
        self.assertEqual(calls,[(['/fixture/systemctl'],40)])

    def test_exact_plan_and_no_future_success_or_legacy_owner_alias(self):
        m.validate_plan(plan())
        for change in [{'ready': True}, {'cutoverOwner': {'file': str(m.OPS/'arena-direct-native-cutover-v2.py'), 'sha256': P}},
                       {'childSha256': '0'*64}, {'targetKind': 'legacy'}, {'targetKind': 'unified'}, {'financialReceiptSha256': 'pending'}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError):m.validate_plan({**plan(), **change})
        for name in m.SUPPORT:
            value=plan();value['support'][name]='b'*64
            with self.subTest(support=name),self.assertRaises(RuntimeError):m.validate_plan(value)
        value=plan();value['projection']['producerSha256']='b'*64
        with self.assertRaises(RuntimeError):m.validate_plan(value)

    def test_retained_effect_and_reconcile_bodies_are_exact(self):
        value = composed()
        spec = importlib.util.spec_from_file_location('frozen_recovery', HERE/m.TEMPLATE.name)
        old = importlib.util.module_from_spec(spec); spec.loader.exec_module(old)
        for name in ['prepare', 'finish_prepared', 'review_hash', 'acknowledge', 'install_owned_file', 'write_source_overlay']:
            a, b = getattr(value, name).__code__, getattr(old, name).__code__
            self.assertEqual((a.co_code, a.co_consts), (b.co_code, b.co_consts), name)
        a, b = value.publish.__code__, old.publish.__code__
        def truthful(item):
            if isinstance(item,tuple):return tuple(truthful(row)for row in item)
            return 'derivedProjectionContinuous' if item == 'scannerContinuous' else item
        self.assertEqual(a.co_code,b.co_code)
        self.assertEqual(a.co_consts,tuple(truthful(row)for row in b.co_consts))
        for name in ['native', 'links', 'review', 'load_operation', 'status', 'retire_links', 'stop_native', 'quiet', 'install_source', 'restore_links', 'start_native']:
            a, b = getattr(value.Host.__mro__[1], name).__code__, getattr(old.Host, name).__code__
            self.assertEqual((a.co_code, a.co_consts), (b.co_code, b.co_consts), name)

    def test_historical_scanner_and_CLI_are_closed(self):
        value = composed()
        for name in ['main', 'scanner_start', 'scanner_setup_review', 'scanner_stop', 'scanner_inspect', 'scanner_ack_start']:
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'RPC_scanner'):getattr(value, name)(None)
        self.assertEqual(value.Host.scanner_identity, value.Host.projection_current)

    def test_full_current_projection_is_called_and_failed_callback_propagates(self):
        value = composed(); host = value.Host.__new__(value.Host); host.reconcile_only = False; host.plan = plan(); calls = []
        identity=pool_identity(host,value)
        binding={'targetAdmissionSha256':P,'targetAuthSha256':P,'sourceAuthSha256':P,'target':host.provision,
                 'sourceRole':host.h.auth['sourceRole'],'readPoolIdentity':identity,'actor':host.projection_actor}
        proof = {'validated': True, 'producerSha256': m.PROJECTION_SHA, 'receiptSha256': P, 'inputSha256': P, 'support': plan()['support'],
                 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0, 'binding': binding, 'bindingSha256': m.sha(m.encoded(binding))}
        api = types.SimpleNamespace(sha=m.sha, encoded=m.encoded, validate_current=lambda *args: calls.append(args) or copy.deepcopy(proof))
        with patch.object(m, 'projection_namespace', return_value=api):
            self.assertEqual(host.projection_current(), proof['binding']); self.assertEqual(calls, [(P, P, m.SUPPORT['manifestSha256'])])
            api.validate_current = Mock(side_effect=RuntimeError('actual_projection_refused'))
            with self.assertRaisesRegex(RuntimeError, 'actual_projection_refused'):host.projection_current()
        self.assertNotIn('scannerStarted', proof)

    def test_shared_pool_identity_rejects_extra_slots_foreign_role_target_or_native_release(self):
        value=composed();host=value.Host.__new__(value.Host);host.plan=plan();identity=pool_identity(host,value)
        self.assertEqual(host.checked_read_pool_identity(identity),identity)
        for change in [{'nativePoolMaximum':2},{'publicReadPoolMaximum':2},{'nativeWorkerPoolMaximum':32},
                       {'sourceRoleLimit':33},{'publicDatabaseOid':17584},{'targetAuthSha256':'b'*64},
                       {'sourceRole':{'name':'postgres','oid':10}},{'nativeRelease':{**identity['nativeRelease'],'schemaOid':'foreign'}}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):host.checked_read_pool_identity({**identity,**change})
        for change in [{'pid':12346},{'startTicks':45679},{'invocation':'f'*32},{'bootId':'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}]:
            with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'runtime_epoch_before_delegated'):
                host.checked_read_pool_identity({**identity,'runtimeEpoch':{**identity['runtimeEpoch'],**change}})

    def test_payload_keeps_actual_ordinary_native_and_support_domains(self):
        value = composed(); host = value.Host.__new__(value.Host); host.reconcile_only = False; host.plan = plan()
        host.public_url = 'postgresql://synthetic@127.0.0.1/public'; host.h = types.SimpleNamespace(
            source_url='postgresql://synthetic@127.0.0.1/native', child_sha='e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', auth={'sourceRole': {'oid': 123}})
        host.catalog = {'fixtureCatalog': True}; host.expected = {'epoch': 'fixture'}; host.expected_ledger = {}; host.expected_identities = []
        host._transport_action = 'inspect'; host._read_pool_identity = {'fixtureIdentity': True}
        payload = host.payload()
        self.assertEqual(payload['nativeReleaseId'], value.NATIVE_RELEASE); self.assertEqual(payload['support'], plan()['support'])
        self.assertEqual(payload['rpc']['url'], 'http://127.0.0.1:19222/unified'); self.assertEqual(payload['targetKind'], 'legacy_rollback')

    def test_lost_selection_ACK_never_infers_commit_from_after_graph(self):
        value = composed(); previous = {'epoch': 'before'}; selected = {'epoch': 'after'}
        with self.assertRaises(Exception):value.acknowledge({'transactions': [], 'selection': selected, 'mode': {'halted': True}}, [], previous)

    def transported_child(self, reconcile=False):
        value=composed();host=value.Host.__new__(value.Host)
        host.plan=plan();host.reconcile_only=reconcile;host.read_only_leaf=False;host.projection_binding_sha=P
        host.public_url='postgresql://fixture@127.0.0.1/public'
        host.h=types.SimpleNamespace(source_url='postgresql://fixture@127.0.0.1/native',child_sha=m.SOURCE_PINS['arena-ypal-ordinary-v1.mjs'],auth={'sourceRole':{'oid':123}})
        identity=pool_identity(host,value)
        host.catalog={};host.expected={};host.expected_ledger={};host.expected_identities=[]
        spec=importlib.util.spec_from_file_location('actual_seals',HERE/'arena-ypal-restored-v1.py')
        seals=importlib.util.module_from_spec(spec);spec.loader.exec_module(seals)
        host.owner=types.SimpleNamespace(sealed=seals.sealed,CHILD=m.OPS/'arena-ypal-ordinary-v1.mjs')
        connected,peer=socket.socketpair();calls=[];descriptors=[]
        def open_read_pool(result_sha,input_sha,manifest_sha,kind):
            calls.append((result_sha,input_sha,manifest_sha,kind))
            return {'socket':connected,'identity':identity,'bindingSha256':P}
        api=types.SimpleNamespace(open_read_pool=open_read_pool)
        class Process:
            def __init__(self,args,*,stdin,stdout,stderr,env,pass_fds,start_new_session):
                self.returncode=0;descriptors.extend(pass_fds)
                self.args=args;self.fds=pass_fds
                self.assertion=None
                assert len(pass_fds)==4 and start_new_session is True
                assert 'Number(process.argv[5])'in args[args.index('--eval')+1]
                assert args[-1]==str(pass_fds[-1])
            def communicate(self,raw,timeout):
                assert timeout==240
                payload=json.loads(raw);authority=json.loads(os.pread(self.fds[0],100000,0))
                assert authority['payloadSha256']==m.sha(raw)
                assert payload['readPoolKind']==('operational-reconcile'if reconcile else'target')
                if reconcile:assert stat.S_ISREG(os.fstat(self.fds[-1]).st_mode)and payload['readPoolIdentity']is None
                else:assert stat.S_ISSOCK(os.fstat(self.fds[-1]).st_mode)and payload['readPoolIdentity']==identity
                return b'{"phase":"result","result":{"actualFixtureTransport":true}}\n',b''
        parent=value.Host.__mro__[1].child.__globals__
        def read(path,maximum=2000000,private=False):return local_public(path,maximum=maximum)
        try:
            with patch.object(m,'projection_namespace',return_value=api),patch('pwd.getpwnam',return_value=types.SimpleNamespace(pw_uid=54321,pw_gid=54321)), \
                 patch.dict(parent,{'protected':read,'subprocess':types.SimpleNamespace(Popen=Process,PIPE=-1)}):
                result=host.child('reconcile'if reconcile else'inspect')
            for fd in descriptors:
                with self.assertRaises(OSError):os.fstat(fd)
            self.assertFalse(hasattr(host,'_transport_action'))
            self.assertEqual(result,{'actualFixtureTransport':True})
            self.assertEqual(calls,[]if reconcile else[(P,P,m.SUPPORT['manifestSha256'],'target')])
            if not reconcile:self.assertEqual(connected.fileno(),-1)
        finally:connected.close();peer.close()

    def test_actual_original_child_transport_inherits_shared_target_socket_with_sealed_identity(self):
        self.transported_child()

    def test_operational_reconcile_uses_original_readonly_body_without_projector_channel_or_effects(self):
        self.transported_child(reconcile=True)
        value=composed();host=value.Host.__new__(value.Host);host.read_only_leaf=False;host.reconcile_only=True
        with self.assertRaisesRegex(RuntimeError,'reconcile_only'):host.child('inspect')
        with self.assertRaisesRegex(RuntimeError,'read_only_inverse'):host.effect_source()

    def test_main_exposes_no_target_creation_or_scanner_modes(self):
        tree = ast.parse((HERE/m.FILE.name).read_bytes())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        flags = [node.args[0].value for node in ast.walk(main) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and
                 node.func.attr == 'add_argument' and node.args and isinstance(node.args[0], ast.Constant)]
        self.assertEqual(set(flags), {'--plan-sha', '--prepare', '--publish', '--continue-published', '--reconcile', '--accept', '--finish-prepared'})
        statements=[ast.unparse(node)for node in main.body]
        self.assertLess(statements.index('os.umask(63)'),next(i for i,row in enumerate(statements)if row.startswith('host = value.Host(')))
        self.assertEqual(m.MAXIMUM_PARENT_SECONDS,1200)

    def test_complete_source_fence_before_all_real_effect_wrappers_and_leaf_refuses(self):
        value = composed(); host = value.Host.__new__(value.Host); host.reconcile_only = False; host.plan = plan(); host.read_only_leaf = True
        with self.assertRaisesRegex(RuntimeError, 'read_only_inverse_leaf'):host.effect_source()
        for name, args in [('retire_links', ({},)), ('stop_native', ({},)), ('install_source', ({}, {})), ('start_native', ({},)), ('child', ('halt',))]:
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'read_only_inverse_leaf'):getattr(host, name)(*args)
        host.read_only_leaf = False; host.h = types.SimpleNamespace(plan={'ordinaryRuntime': {'resultSha256': P, 'inputSha256': P}})
        proof = {'validated': True, 'currentWriterQualified': True, 'sourceActorQualified': True, 'frameworkReady': True,
                 'operatorSha256': m.EFFECT_SOURCE_SHA, 'inputSha256': P, 'sourceKind': 'restored-owned-prefix', 'routingMode': 'ordinary-paid',
                 'sourceRelease': value.NATIVE_RELEASE, 'schemaOid': '75963410', 'buildId': '71e2a7f3b7',
                 'ordinaryRuntimeAncestry': host.h.plan['ordinaryRuntime'], 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0,
                 'binding': {'realFixtureSource': True}}
        api = types.SimpleNamespace(INPUT=Path('/fixture/source/input.json'), validate_current_source=Mock(return_value=proof))
        config = {'stage': 'managed-restored', 'arenaInverse': None, 'featureInverse': None}
        with patch.object(m, 'evaluate', return_value=api), patch.object(m, 'public', side_effect=lambda *args: json.dumps(config).encode()):
            self.assertEqual(host.effect_source(), proof['binding']); api.validate_current_source.assert_called_once_with(P)
            proof['frameworkReady'] = False
            with self.assertRaisesRegex(RuntimeError, 'same_ready_restored'):host.effect_source()
            proof['frameworkReady'] = True; config['arenaInverse'] = {'future': True}
            with self.assertRaisesRegex(RuntimeError, 'leaf_cycle'):host.effect_source()

    def test_accept_ACK_loss_is_readonly_revalidation_and_exclusive_write(self):
        value = types.SimpleNamespace(save=Mock()); host = types.SimpleNamespace(base=Path('/nonexistent-fixture'))
        binding = {'planSha256': P}
        with patch.object(m, 'current_leaf', return_value=binding), patch.object(m, 'public', return_value=b'actualFixtureSource'), patch.object(Path, 'exists', return_value=False):
            result = m.accept(host, value)
        self.assertEqual(value.save.call_count, 1); self.assertTrue(result['compatibleBusinessInverse'])
        self.assertFalse(value.save.call_args.args[1]['oldOwnerMainInvoked'])


if __name__ == '__main__':unittest.main()
