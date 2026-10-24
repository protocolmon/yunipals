#!/usr/bin/env python3
"""Synthetic source/epoch and real-FS recovery controls. No host services/DB/RPC."""
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

PATH = Path(__file__).with_name('ypal-restored-managed-handover-v1.py')


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m = load(PATH, 'tested_restored_managed')
OLD = PATH.with_name('ypal-managed-handover-v1.py')
r = load(PATH.with_name('ypal-source-tail-recovery-v2') / 'recover.py', 'tested_pure_recovery')


def native():
    point = lambda n: str(n).zfill(75)
    return {'schemaOid': '75963410', 'tables': {str(i): {'oid': str(i), 'owner': '73004621', 'kind': 'r'} for i in range(44)},
            'cache': {'schema': 'ponder_sync', 'oid': '900'}, 'clock': 2000,
            'app': {'build_id': m.BUILD, 'is_locked': 1, 'is_ready': 1, 'heartbeat_at': 1999},
            'checkpoints': {c: {'latest': point(110), 'safe': point(100), 'finalized': point(90)} for c in ['1', '56', '137', '8453']}}


def solana():
    return {'format': 'yunipals-solana-supervisor-handover-state-v1', 'readOnly': True,
            'isolation': 'repeatable read', 'databaseWrites': 0, 'providerCalls': 0, 'observedAt': '2026-10-24T04:00:00+00:00',
            'manifest': {'checksum': 'f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07', 'count': 10000},
            'state': {'publishedRunId': 10, 'nextScanAt': '2026-10-24T05:00:00+00:00', 'lastErrorPresent': False, 'rowSha256': 'a' * 64},
            'publishedRun': {'id': 10, 'state': 'published', 'assetCount': 10000, 'missingCount': 0, 'completedAt': '2026-10-24T03:00:00+00:00', 'rowSha256': 'b' * 64},
            'runningScans': 1, 'runningRunStates': [{'id': 11, 'next_batch': 4}], 'stage': {'rows': 4000, 'sha256': 'c' * 64},
            'ledgerPrefix': {'throughId': '30', 'rows': 30, 'credits': '300000', 'sha256': 'd' * 64},
            'ledgerCurrent': {'rows': 30, 'credits': '300000', 'latestId': '30'}, 'workerLock': {'granted': 0, 'waiting': 0}}


def source_manifest():
    return {'format': m.FORMAT + '-sources', 'producers': {k: {'file': v, 'sha256': 'a' * 64} for k, v in m.KNOWN_CODE.items()}}


def state():
    return {k: '' for k in ['LoadState', 'FragmentPath', 'DropInPaths', 'WorkingDirectory', 'User', 'Group', 'PartOf', 'BindsTo', 'Requisite', 'After', 'ExecStart']}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.restored-managed-test-', dir=PATH.parents[2])
        self.root = Path(self.tmp.name); self.base_path = self.root / 'base'; self.base_path.mkdir(mode=0o700)
        self.system = self.root / 'system'; self.system.mkdir(); self.hold = self.system / '.hold'; self.hold.mkdir(mode=0o700)
        self.stage = self.root / 'runtime'; self.stage.mkdir(mode=0o755)
        self.patches = [patch.multiple(m, TEMPLATE=OLD, BASE=self.base_path, HOLD=self.hold, STAGE=self.stage)]
        for p in self.patches: p.start()
        raw = types.SimpleNamespace(s=object(), raw=object(), source_op={})
        parts = {'privilegedSourcePrimitives': {'host': raw, 'restoreReceipt': {'native': native()}, 'recoveryModule': r}}
        static = types.SimpleNamespace(query_components=lambda: parts, inverse_source=lambda: {'sourceState': 'terminal', 'sourceTerminalQualified': True}, gone=lambda processes: None)
        config = {'format': m.FORMAT + '-input', 'restoreResultSha256': m.RESTORE_ACK, 'rpcReceiptSha256': m.RPC_ACK,
                  'maximumColdStartSeconds': 300, 'writers': {k: {} for k in ['yunipals-ypal-combined-source.service', 'yunipals-solana.service', 'yunipals-indexer.service', 'yunipals-unified-source6-free-v2.service', 'yunipals-booster-ypal-source.service', 'yunipals-booster-launch.service', 'yunipals-bnb.service', 'yunipals-islands-indexer.service', 'yunipals-base-islands-v2.service']}}
        def fake_module(path, digest):
            if path == m.STATIC: return static
            if path in {m.CURRENT, m.OBSERVER}: return types.SimpleNamespace()
            raise AssertionError('unexpected_dependency')
        def doc(path, digest=None):
            return source_manifest() if path == m.MANIFEST else config if path == m.INPUT else json.loads(m.protected(path, digest))
        with patch.object(m, 'module', fake_module), patch.object(m, 'document', doc):
            self.base, self.h, self.Owner = m.build('a' * 64, 'b' * 64)
        self.base.SYSTEM = self.system
        self.static = static; self.parts = parts; self.config = config
        self.owner = self.Owner(self.h)
        self.calls = []
        self.old_actor = {'parent': {'pid': 42, 'startupInjectionAbsent': True}, 'processes': [{'pid': 42, 'startupInjectionAbsent': True}], 'unit': {'InvocationID': 'c' * 32}}
        self.actors = {k: None for k in self.base.WRITERS}
        self.activations = {k: {'boot': None, 'definitions': {}} for k in self.base.WRITERS}
        self.h.actor = lambda unit, allow_terminal=False: self.actors[unit]
        self.h.activation = lambda unit: self.activations[unit]
        self.h.definitions = lambda unit: self.activations[unit]['definitions']
        self.h.state = lambda unit: state()
        self.h.private_inputs = lambda: {}
        self.h.catalog = self.h.columns = self.h.routes = self.h.observer_current = lambda: {}
        self.h.source_current = self.h.readiness = self.h.managed_settings = lambda: {}
        self.h.native = native; self.h.sql_solana = lambda through=0: solana()
        self.h.sessions = lambda actors, all_native=False: {}
        self.h.sessions_gone = lambda proof: None
        self.h.manager = lambda action, unit=None: self.calls.append((action, unit))
        self.op = {'format': m.FORMAT, 'operatorSha256': m.sha(m.protected(PATH)), 'bootId': self.base.boot(), 'inputSha256': 'b' * 64, 'manifestSha256': 'a' * 64,
                   'units': copy.deepcopy(self.actors), 'activations': copy.deepcopy(self.activations),
                   'unitDefinitionFrames': {k: self.base.definition_frame(state()) for k in self.base.WRITERS},
                   'privateInputs': {}, 'catalog': {}, 'columns': {}, 'routes': {}, 'observer': {}, 'native': native()}
        self.base.save(self.base_path / 'operation.json', self.op)

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()

    def reset_operation(self):
        (self.base_path / 'operation.json').unlink(); self.base.save(self.base_path / 'operation.json', self.op)


class Pure(unittest.TestCase):
    def test_default_is_zero_effect_and_has_no_module_import(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(PATH)], capture_output=True, check=True)
        value = json.loads(result.stdout)
        self.assertTrue(value['sourceOnly']); self.assertFalse(value['managedWriterQualified'])
        self.assertEqual((value['databaseWrites'], value['serviceActions'], value['providerCalls']), (0, 0, 0))
        self.assertEqual(result.stderr, b'')

    def test_whole_epoch_heartbeat_not_predecessor_fresh_lock(self):
        intent = {'preStartDatabaseClock': 1900, 'predecessorHeartbeat': 1800}
        m.epoch_heartbeat(native(), intent)
        for key, value in [('heartbeat_at', 1800), ('heartbeat_at', 1899), ('heartbeat_at', 2001), ('is_locked', 0), ('is_ready', 0)]:
            v = native(); v['app'][key] = value
            with self.assertRaises(RuntimeError): m.epoch_heartbeat(v, intent)
        v = native(); v['clock'] = 182000
        with self.assertRaises(RuntimeError): m.epoch_heartbeat(v, intent)

    def test_inverse_epoch_can_index_without_fabricating_source_ready(self):
        v = native(); v['app']['is_ready'] = 0
        m.epoch_heartbeat(v, {'preStartDatabaseClock': 1900, 'predecessorHeartbeat': 1800}, ready=False)
        self.assertEqual(m.heartbeat_floor(v), {'preStartDatabaseClock': 2000, 'predecessorHeartbeat': 1999})
        v['app']['heartbeat_at'] = True
        with self.assertRaises(RuntimeError): m.heartbeat_floor(v)

    def test_positive_kernel_source_session_is_mandatory(self):
        proof = {'73004621': {'owned': {m.PARENT: [{'pid': 1, 'backendStart': 'actual-tuple'}]}, 'other': []}}
        self.assertEqual(len(m.require_positive_backends(proof, m.PARENT)), 1)
        for owned, other in [([], []), ([{}], [{}])]:
            bad = {'73004621': {'owned': {m.PARENT: owned}, 'other': other}}
            with self.assertRaises(RuntimeError): m.require_positive_backends(bad, m.PARENT)

    def test_producer_manifest_is_finite_and_has_no_old_fallback_or_null_pin(self):
        m.validate_producer_manifest(source_manifest())
        for kind, filename in [('feature', 'ypal-feature-handover-v1.py'), ('arena', 'arena-ypal-native-v2.py'), ('readerInverse', '../ypal-native-inverse-leaf-v1.py')]:
            v = source_manifest(); v['producers'][kind]['file'] = filename
            with self.assertRaises(RuntimeError): m.validate_producer_manifest(v)
        v = source_manifest(); v['producers']['readerCachePhase']['sha256'] = None
        with self.assertRaises(RuntimeError): m.validate_producer_manifest(v)

    def test_actual_producer_manifest_closes_exact_local_source_bytes(self):
        value = json.loads(PATH.with_suffix('.manifest.json').read_bytes()); m.validate_producer_manifest(value)
        for row in value['producers'].values():
            self.assertEqual(m.sha(PATH.with_name(row['file']).read_bytes()), row['sha256'])
        inverse = ast.parse(PATH.with_name(value['producers']['readerInverse']['file']).read_text())
        entry = next(v for v in inverse.body if isinstance(v, ast.FunctionDef) and v.name == 'validate_inverse_leaf')
        self.assertEqual([v.arg for v in entry.args.args], ['result_sha', 'manifest_sha'])

    def test_review_hash_excludes_live_observations_but_retains_all_authority(self):
        first={'format':m.FORMAT,'inputSha256':'a'*64,'manifestSha256':'b'*64,'units':{'source':'exactepoch'},
               'catalog':{'allDirectEdges':'exact'},'columns':{'allColumnACLs':'exact'},'privateInputs':{'sha256':'c'*64},
               'native':native(),'solana':solana(),'sessions':{'tuple':'volatile'},'resources':{'free':12},'acceptance':{'HTTPindexedTime':1}}
        second=copy.deepcopy(first);second['native']['clock']+=100;second['native']['app']['heartbeat_at']+=100
        second['solana']['stage']['rows']+=1;second['sessions']={'tuple':'new'};second['resources']['free']=11;second['acceptance']['HTTPindexedTime']=2
        self.assertEqual(m.review_binding(first),m.review_binding(second))
        for field in ['catalog','columns','privateInputs','units','inputSha256']:
            changed=copy.deepcopy(second);changed[field]='changed'
            self.assertNotEqual(m.review_binding(first),m.review_binding(changed))

    def test_unstopped_Solana_observation_allows_finish_not_budget_rewind(self):
        before = solana(); after = solana(); after['ledgerCurrent']['credits'] = '300100'; after['state']['publishedRunId'] = 11
        m.live_solana_progress(before, after)
        after['ledgerCurrent']['credits'] = '299999'
        with self.assertRaises(RuntimeError): m.live_solana_progress(before, after)

    def test_managed_runtime_changes_only_path_and_deadline_mount(self):
        runtime = PATH.with_name('ypal-restored-managed-indexer-v1')
        old = PATH.with_name('ypal-managed-indexer-v1')
        for name in ['launcher.mjs', 'service.public.env']:
            self.assertEqual((runtime / name).read_bytes(), (old / name).read_bytes())
            self.assertEqual(m.sha((runtime / name).read_bytes()), m.PINS[name])
        unit = (runtime / 'yunipals-indexer.service.example').read_text()
        expected = (old / 'yunipals-indexer.service.example').read_text().replace('/ypal-managed-indexer-v1/', '/ypal-restored-managed-indexer-v1/').replace('/ypal-combined-source-v1-stage/rpc-preflight.ts:', '/ypal-rpc-deadline-host-build-v1/rpc-preflight.ts:')
        self.assertEqual(unit, expected); self.assertEqual(m.sha(unit.encode()), m.PINS['yunipals-indexer.service.example'])


class Namespace(Fixture):
    def test_writer_scope_is_separate_from_global_reader_catalog_but_not_source_role(self):
        self.op['deadlineBuild']={'factory':'exact'};self.reset_operation();self.h.deadline=lambda:{'factory':'exact'}
        self.h.catalog=lambda: (_ for _ in ()).throw(AssertionError('writer_leaf_must_not_claim_consumer_catalog'))
        self.owner.writer_stable(self.op)
        self.h.private_inputs=lambda:{'sourceRole':'changed'}
        with self.assertRaisesRegex(RuntimeError,'writer_private_role'):self.owner.writer_stable(self.op)

    def test_loaded_namespace_refuses_old_transport_extra_env_or_wrong_mount_flags(self):
        b=self.base
        settings={'Restart':'on-failure','RestartPreventExitStatus':'75','TimeoutStopUSec':'1min','KillMode':'control-group',
            'MemoryMax':'6442450944','MemorySwapMax':'0','TasksMax':'128','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'',
            'ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','RestrictSUIDSGID':'yes','IPAddressAllow':' '.join(b.CIDRS|{'127.0.0.0/8','::1/128'}),
            'IPAddressDeny':'0.0.0.0/0 ::/0','Environment':'','PassEnvironment':'','UnsetEnvironment':'DATABASE_URL DATABASE_PRIVATE_URL HELIUS_API_KEY',
            'ExecStart':'{ argv[]='+b.NODE+' '+str(m.STAGE/'launcher.mjs')+' ; }','ExecStartPre':'','ExecStartPost':'','ExecStop':'','ExecStopPost':'',
            'WorkingDirectory':'/','User':'yunipals_unified_shadow','Group':'yunipals_unified_shadow','Conflicts':' '.join(set(b.WRITERS)-{m.PARENT}),
            'Wants':'network-online.target','RuntimeMaxUSec':'infinity','RestrictAddressFamilies':'AF_UNIX AF_INET AF_INET6'}
        typed={'EnvironmentFiles':{'type':'a(sb)','data':[[str(m.STAGE/'service.public.env'),False]]},
            'BindPaths':{'type':'a(ssbt)','data':[[backing,inside,False,0]for inside,backing in list(b.NAMESPACE.items())[:3]]},
            'BindReadOnlyPaths':{'type':'a(ssbt)','data':[[backing,inside,False,16384]for inside,backing in list(b.NAMESPACE.items())[3:]]}}
        def command(argv,*args,**kwargs):
            if argv[0]=='/usr/bin/systemctl':return '\n'.join(k+'='+v for k,v in settings.items()).encode()
            return json.dumps(typed[argv[-1]]).encode()
        with patch.object(b,'command',command):
            b.FrozenHost.managed_settings(self.h)
            original=copy.deepcopy(typed)
            typed['BindReadOnlyPaths']['data'][-1][0]='/old/rpc-preflight.ts'
            with self.assertRaises(RuntimeError):b.FrozenHost.managed_settings(self.h)
            typed=copy.deepcopy(original);typed['BindPaths']['data'][0][3]=True
            with self.assertRaises(RuntimeError):b.FrozenHost.managed_settings(self.h)
            typed=copy.deepcopy(original);typed['EnvironmentFiles']['data'].append(['/private/extra.env',False])
            with self.assertRaises(RuntimeError):b.FrozenHost.managed_settings(self.h)

    def test_only_safe_frozen_methods_remain_byte_equivalent(self):
        tree = ast.parse(OLD.read_text()); classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
        for name in ['Host', 'Owner']:
            actual = getattr(self.base, 'Frozen' + name)
            self.assertNotIn('__init__', actual.__dict__)
            for node in classes[name].body:
                if isinstance(node, ast.FunctionDef) and node.name in actual.__dict__:
                    self.assertEqual(actual.__dict__[node.name].__code__.co_code,
                                     load(OLD, 'pure_original_' + name).__dict__[name].__dict__[node.name].__code__.co_code)
        self.assertNotIn('observer_managed', self.base.FrozenHost.__dict__)
        self.assertNotIn('source_leaf', self.base.FrozenOwner.__dict__)
        self.assertEqual(self.base.UNITS, self.base.WRITERS)

    def test_all_six_mounts_preserved_with_only_reviewed_new_transport(self):
        self.assertEqual(len(self.base.NAMESPACE), 6)
        self.assertEqual(list(self.base.NAMESPACE.values())[-1], str(m.DEADLINE))
        self.assertEqual(self.base.source_arguments()[2:5], ['--env-file=' + p for p in self.base.ENV_FILES[:3]])

    def test_construction_has_no_current_source_or_old_whole_runtime_call(self):
        # setUp loaded the real namespace with no module capable of active994.
        self.assertEqual(self.owner.h.manifest_sha, 'a' * 64)
        self.assertEqual(self.calls, [])
        source = ast.unparse(ast.parse(PATH.read_text()))
        self.assertNotIn('c9.load(', source); self.assertNotIn('validate_source_current(', source)

    def test_latest_recovery_to_safe_is_allowed_but_safe_or_cache_identity_rewind_is_not(self):
        before = native(); after = native(); after['checkpoints']['56']['latest'] = before['checkpoints']['56']['safe']
        self.owner.native_floor(before, after)
        after['checkpoints']['56']['safe'] = '0' * 75
        with self.assertRaises(RuntimeError): self.owner.native_floor(before, after)
        after = native(); after['cache']['oid'] = 'changed'
        with self.assertRaises(RuntimeError): self.owner.native_floor(before, after)


class Filesystem(Fixture):
    def inverse_restart_fixture(self, lost=False):
        self.parts['privilegedSourcePrimitives']['restoreModule'] = types.SimpleNamespace(OP_SHA='a' * 64)
        self.op['units'][m.SOURCE] = self.old_actor; self.reset_operation()
        self.base.save(self.base_path / 'inverse-quiet.json', {'native': native(), 'solana': solana(), 'solanaFrozen': True})
        self.base.save(self.base_path / 'inverse-drained.json', {'format': m.FORMAT + '-inverse-drained', 'operatorSha256': self.op['operatorSha256'],
            'operationSha256': m.sha(m.protected(self.base_path / 'operation.json')), 'bootId': self.base.boot(),
            'originalDefinitionsAndBootRestored': True, 'standaloneTerminal': True})
        self.new_source = {'parent': {'pid': 100}, 'processes': [{'pid': 100}], 'unit': {'InvocationID': 'd' * 32}}
        self.temporary = {'parent': {'pid': 200}, 'processes': [{'pid': 200}], 'unit': {'Id': 'yunipals-booster-ypal-source.service'}}
        self.inverse_proof = {'readerInverse': {'bindingSha256': 'e' * 64}, 'feature': {'temporarySourceActor': self.temporary}}
        self.h.inverse_leaves = lambda digest: copy.deepcopy(self.inverse_proof)
        self.owner.restored_source = lambda: self.new_source
        self.owner.restored_sessions = lambda actor, leaves: {'kernel': 'positive-source-and-temporary-subsets'}
        self.h.native = lambda: native() if self.actors[m.SOURCE] is None else {**native(), 'clock': 2001,
            'app': {**native()['app'], 'heartbeat_at': 2000, 'is_ready': 0}}
        def manager(action, unit):
            self.calls.append((action, unit)); self.actors[unit] = self.new_source
            if lost: raise RuntimeError('lost_original_start_ACK')
        self.h.manager = manager

    def test_move_no_replace_preserves_foreign_race_and_own_inode(self):
        source = self.hold / 'prepared'; target = self.system / 'target'; source.write_bytes(b'owned')
        record = self.base.identity(source); rename = r.publish_no_replace
        def race(a, b):
            b.write_bytes(b'foreign'); rename(a, b)
        with patch.object(r, 'publish_no_replace', race):
            with self.assertRaises(FileExistsError): self.owner.move(source, target, record, 'test-move')
        self.assertEqual(target.read_bytes(), b'foreign'); self.assertEqual(self.base.identity(source), record)

    def test_lost_rename_ACK_finishes_without_republication(self):
        source = self.hold / 'prepared'; target = self.system / 'target'; source.write_bytes(b'owned'); record = self.base.identity(source)
        intent = {'source': str(source), 'target': str(target), 'identity': record}
        self.base.save(self.base_path / 'test-move-intent.json', intent); r.publish_no_replace(source, target)
        self.owner.move(source, target, record, 'test-move', finish=True)
        self.assertEqual(self.base.identity(target), record)
        with self.assertRaises(RuntimeError): self.owner.move(source, target, record, 'test-move')

    def test_stop_unknown_ACK_is_observed_and_never_stopped_twice(self):
        self.actors[m.SOURCE] = self.old_actor
        def manager(action, unit):
            self.calls.append((action, unit)); self.actors[unit] = None; raise RuntimeError('simulated_lost_stop_ACK')
        self.h.manager = manager
        with self.assertRaises(RuntimeError): self.owner.stop_exact(m.SOURCE, self.old_actor, 'drain-' + m.SOURCE)
        self.owner.finish_stop(m.SOURCE, self.old_actor, 'drain-' + m.SOURCE)
        self.assertEqual(self.calls, [('stop', m.SOURCE)])

    def test_start_unknown_ACK_cannot_resend_start(self):
        self.owner.stable = lambda op: None
        self.base.save(self.base_path / 'drained.json', {'native': native(), 'solana': solana()})
        self.base.save(self.base_path / 'installed.json', {m.PARENT: {'definitions': {}, 'boot': None}})
        def manager(action, unit): self.calls.append((action, unit)); raise RuntimeError('simulated_unknown_start')
        self.h.manager = manager
        with self.assertRaises(RuntimeError): self.owner.start_parent()
        with self.assertRaises(FileExistsError): self.owner.start_parent()
        self.assertEqual(self.calls, [('start', m.PARENT)])

    def test_final_start_CAS_refuses_reappeared_legacy_after_durable_intent(self):
        self.owner.stable=lambda op:None
        self.base.save(self.base_path/'drained.json',{'native':native(),'solana':solana()})
        self.base.save(self.base_path/'installed.json',{m.PARENT:{'definitions':{},'boot':None}})
        put=self.owner.put
        def race(name,value):
            result=put(name,value)
            if name=='parent-start-intent.json':self.actors[m.SOURCE]=self.old_actor
            return result
        self.owner.put=race
        with self.assertRaisesRegex(RuntimeError,'retired_writer_groups'):self.owner.start_parent()
        self.assertEqual(self.calls,[])
        self.assertTrue((self.base_path/'parent-start-intent.json').exists())

    def test_supervised_restart_final_CAS_cannot_implicitly_stop_legacy_writer(self):
        self.owner.source_leaf=lambda digest:{};self.owner.stable=lambda op:None
        self.base.save(self.base_path/'scheduled-result.json',{'resultSha256':'a'*64,'scheduledSolanaAccepted':True})
        self.base.save(self.base_path/'parent-start-intent.json',{})
        self.base.save(self.base_path/'installed.json',{m.PARENT:{'definitions':{},'boot':None}})
        self.actors[m.PARENT]=self.old_actor;self.h.managed=lambda intent:self.old_actor
        self.owner.stop_exact=lambda unit,actor,name:self.actors.__setitem__(unit,None)
        put=self.owner.put
        def race(name,value):
            result=put(name,value)
            if name=='restart-parent-start-intent.json':self.actors[m.SOLANA]=self.old_actor
            return result
        self.owner.put=race
        with self.assertRaisesRegex(RuntimeError,'retired_writer_groups'):self.owner.restart('a'*64)
        self.assertEqual(self.calls,[])

    def test_pre_drain_inverse_preserves_actual_old_source_without_claiming_new_epoch(self):
        self.op['units'][m.SOURCE] = self.old_actor; self.actors[m.SOURCE] = self.old_actor; self.reset_operation()
        result = self.owner.inverse_drained()
        self.assertTrue(result['originalSourceRetained']); self.assertFalse(result['newSourceEpochClaimed'])
        self.assertEqual(self.calls, [])

    def test_source_drained_Solana_not_drained_inverse_is_usable_and_keeps_old_worker(self):
        self.op['units'][m.SOURCE] = self.old_actor; self.op['units'][m.SOLANA] = self.old_actor; self.actors[m.SOLANA] = self.old_actor; self.reset_operation()
        self.base.save(self.base_path / ('drain-' + m.SOURCE + '-intent.json'), {})
        self.base.save(self.base_path / ('drain-' + m.SOURCE + '-result.json'), {})
        result = self.owner.inverse_drained()
        self.assertTrue(result['standaloneTerminal']); self.assertFalse(result['standaloneRestarted']); self.assertFalse(result['solanaFrozen'])
        self.assertEqual(self.calls, [('daemon-reload', None)])

    def test_original_boot_restored_before_fbb_terminal_qualification(self):
        self.op['units'][m.SOURCE] = self.old_actor
        wants = self.system / 'multi-user.target.wants'; wants.mkdir(); boot = wants / m.SOURCE
        boot.symlink_to(str(self.system / m.SOURCE)); original = self.base.link_record(boot)
        self.op['activations'][m.SOURCE]['boot'] = original; self.reset_operation()
        self.base.save(self.base_path / ('drain-' + m.SOURCE + '-intent.json'), {})
        self.base.save(self.base_path / ('drain-' + m.SOURCE + '-result.json'), {})
        r.publish_no_replace(boot, self.hold / (m.SOURCE + '.boot'))
        self.h.activation = lambda unit: {'boot': self.base.link_record(self.h.boot_link(unit)), 'definitions': {}}
        def inverse_source():
            self.assertEqual(self.base.link_record(boot), original)
            self.assertEqual(self.calls, [('daemon-reload', None)])
            return {'sourceState': 'terminal', 'sourceTerminalQualified': True}
        self.static.inverse_source = inverse_source
        result = self.owner.inverse_drained(); self.assertTrue(result['originalDefinitionsAndBootRestored'])

    def test_loaded_definition_mismatch_refuses_without_start(self):
        self.h.state = lambda unit: {**state(), 'WorkingDirectory': '/changed'}
        with self.assertRaisesRegex(RuntimeError, 'original_loaded_definitions'): self.owner.inverse_drained()
        self.assertNotIn(('start', m.SOURCE), self.calls)

    def test_pending_managed_restart_is_not_a_new_accepted_epoch(self):
        self.base.save(self.base_path / 'restart-parent-start-intent.json', {})
        with self.assertRaisesRegex(RuntimeError, 'unknown_ACK'): self.owner.active_prefix()

    def test_inverse_standalone_unknown_start_ACK_finishes_without_resending(self):
        self.inverse_restart_fixture(lost=True)
        with self.assertRaisesRegex(RuntimeError, 'lost_original_start'): self.owner.inverse_restart('f' * 64)
        with self.assertRaisesRegex(RuntimeError, 'explicit_finish'): self.owner.inverse_restart('f' * 64)
        result = self.owner.inverse_restart('f' * 64, finish=True)
        self.assertTrue(result['restored']); self.assertFalse(result['oldDe4ActorRelabelled']); self.assertFalse(result['sourceReadinessQualified'])
        self.assertEqual(self.calls, [('start', m.SOURCE)])
        self.assertTrue(result['readerAndFeatureRecoveredBeforeAndAfterStart'])

    def test_inverse_changed_reader_recovery_after_start_cannot_get_success_ACK(self):
        self.inverse_restart_fixture()
        original = self.h.inverse_leaves; count = []
        def leaves(digest):
            count.append(1); value = original(digest)
            if len(count) >= 4: value['readerInverse']['bindingSha256'] = 'a' * 64
            return value
        self.h.inverse_leaves = leaves
        with self.assertRaisesRegex(RuntimeError, 'must_stay_exact_after_once_restart'): self.owner.inverse_restart('f' * 64)
        self.assertFalse((self.base_path / 'inverse-result.json').exists())
        self.assertEqual(self.calls, [('start', m.SOURCE)])

    def test_restored_program_reuses_de4_body_with_only_own_new_intent_and_producer(self):
        self.op['units'][m.SOURCE] = self.old_actor; self.reset_operation()
        actor = {'unit': {'InvocationID': 'd' * 32}, 'parent': {'pid': 100}}
        intent = {'operationSha256': m.sha(m.protected(self.base_path / 'operation.json')), 'bootId': self.base.boot()}
        self.base.save(self.base_path / 'standalone-start-intent.json', intent)
        test = self
        class Body:
            def __init__(self, recovery, sdk, host, op): pass
            def owned(self):
                test.assertEqual(self.get('start-intent.json'), intent)
                test.assertEqual(self.producer(), test.op['operatorSha256'])
                return actor
        self.parts['privilegedSourcePrimitives'].update({'restoreModule': types.SimpleNamespace(Owner=Body, canonical_actor=lambda a: a),
            'sdk': None, 'ancestorOperation': {}})
        self.assertEqual(self.owner.restored_source(), actor)

    def test_stop_result_does_not_hide_known_process_epoch_escape(self):
        self.actors[m.SOURCE] = self.old_actor
        def manager(action, unit): self.calls.append((action, unit)); self.actors[unit] = None
        self.h.manager = manager
        def gone(processes): raise RuntimeError('known_PID_epoch_still_alive')
        self.static.gone = gone
        with self.assertRaisesRegex(RuntimeError, 'known_PID_epoch_still_alive'): self.owner.stop_exact(m.SOURCE, self.old_actor, 'stop-test')
        self.assertFalse((self.base_path / 'drained.json').exists())
        self.assertEqual(self.calls, [('stop', m.SOURCE)])

    def test_restored_Solana_current_leaf_refuses_unacknowledged_replacement(self):
        self.op['units'][m.SOLANA]=self.old_actor;self.reset_operation()
        self.base.save(self.base_path/('drain-'+m.SOLANA+'-intent.json'),{})
        self.base.save(self.base_path/'standalone-Solana-start-intent.json',{})
        self.base.save(self.base_path/'standalone-Solana-start-result.json',{'actor':self.old_actor})
        self.owner.original_actor=lambda unit,intent:self.old_actor
        self.assertEqual(self.owner.restored_solana(self.op),self.old_actor)
        self.owner.original_actor=lambda unit,intent:{**self.old_actor,'parent':{'pid':999}}
        with self.assertRaisesRegex(RuntimeError,'own_current_epoch_ACK'):self.owner.restored_solana(self.op)


if __name__ == '__main__': unittest.main()
