#!/usr/bin/env python3
"""Reused e506 lifecycle/real-FS controls plus current constructor/epoch seams."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def mod(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


owner = mod('new_feature_owner', HERE / 'ypal-restored-feature-handover-v1.py')
context = mod('new_feature_context', HERE / 'ypal-restored-feature-context-v1.py')
original = (HERE / 'ypal-feature-handover-v1.py').read_bytes()
m = owner.assemble(original, context)

# Re-run the actual 25 frozen filesystem/lifecycle controls on the NEW namespace.
# Only its top-level original module import is replaced; fixture bodies unchanged.
old_tests = (HERE / 'ypal-feature-handover-v1.test.py').read_bytes()
owner.need(owner.sha(old_tests) == 'eaed49340a4ccd59590cf385b28b2763d1440ef5a289f446d1077379a7694255', 'exact_frozen25_feature_controls_required')
old_test = ast.parse(old_tests)
controls = [v for v in old_test.body if isinstance(v, (ast.FunctionDef, ast.ClassDef))]
import os
import tempfile
import time
exec(compile(ast.fix_missing_locations(ast.Module(body=controls, type_ignores=[])), str(__file__), 'exec'), globals())


def packet(pid=1, compiler=2):
    main = {'pid': pid, 'startTicks': pid * 10, 'argv': ['/opt/node/bin/node', '--env-file=/private', 'ponder'],
            'parentPid': 9, 'cwd': '/source', 'executable': '/opt/node/bin/node', 'uid': 970, 'gid': 964, 'groups': [964],
            'noNewPrivileges': True, 'capabilitySetSha256': 'special-retained-caps', 'capabilitiesZero': False,
            'startupInjectionAbsent': True, 'cgroup': '0::/system.slice/' + m.SOURCE,
            'parentPrivateValuesAbsent': True,
            'normalizedEnvironmentSha256': 'original-private-values', 'invocationEnvironmentMatched': True}
    child = {**main, 'pid': compiler, 'startTicks': compiler * 10, 'parentPid': pid, 'argv': ['/esbuild', '--service=0.25.12', '--ping'], 'executable': '/esbuild'}
    return {'unit': {'MainPID': str(pid), 'InvocationID': str(pid).zfill(32)}, 'parent': main, 'processes': [main, child],
            'nativeIdentity': {'schemaOid': m.FRESH_OID, 'buildId': m.FRESH_BUILD}}


class RestoredSeams(unittest.TestCase):
    def test_new_identity_and_exact_business_AST_scope(self):
        self.assertEqual(m.FORMAT, 'yunipals-ypal-restored-feature-handover-v1')
        self.assertIn('restored-feature', str(m.BASE)); self.assertNotIn('97-', str(m.DROPS[m.API]))
        self.assertNotIn('COMBINED_ACK', m.__dict__); self.assertNotIn('COMBINED_OP', m.__dict__)
        self.assertEqual(set(m.FIXED), {'ypal-reader-cutover-v1.py'})
        tree = ast.parse(original)
        before = next(v for v in tree.body if isinstance(v, ast.ClassDef) and v.name == 'Owner')
        # The assembled Owner methods carry exactly the original bytecode.
        old = mod('old_feature_test_only', HERE / 'ypal-feature-handover-v1.py')
        for method in before.body:
            if isinstance(method, ast.FunctionDef):
                self.assertEqual(getattr(m.Owner, method.name).__code__.co_code, getattr(old.Owner, method.name).__code__.co_code)
        with self.assertRaisesRegex(RuntimeError, 'exact_e506'): owner.assemble(original + b'\n', context)
    def test_current_source_and_inverse_are_distinct_explicit_calls(self):
        host = object.__new__(m.Host); host.p = {'restoreReceipt': {'source': {'exact': 'de4'}}}
        host.static = types.SimpleNamespace(RESULT_SHA='0ee', inverse_source=lambda: {'sourceTerminalQualified': True})
        calls = []; host.active = types.SimpleNamespace(validate_runtime=lambda **kw:calls.append(kw) or {})
        host.inverse_mode = False
        first = host.combined(); self.assertEqual(calls, [{'rpc_pin': context.RPC_ACK}]); self.assertFalse(first['oldC96ActorRelabelled'])
        host.inverse_mode = True
        self.assertEqual(host.combined(), {'inverseOnly': True, 'terminal': True, 'restoreReceiptSha256': '0ee'})
        self.assertEqual(len(calls), 1)
    def test_retained_special_caps_and_owned_new_epoch_keep_private_signature(self):
        original = {'sdkActor': packet()}; actor = packet(3, 4)
        self.assertIs(context.source_actor_checks(actor, original), actor)
        for key, value in [('capabilitySetSha256', 'foreign'), ('normalizedEnvironmentSha256', 'new-secret'), ('groups', [0]), ('argv', ['foreign'])]:
            changed = copy.deepcopy(actor); changed['parent'][key] = value
            with self.assertRaises(RuntimeError): context.source_actor_checks(changed, original)
        changed = copy.deepcopy(actor); changed['processes'][1]['parentPid'] = 99
        with self.assertRaisesRegex(RuntimeError, 'direct_child'): context.source_actor_checks(changed, original)
    def test_same_count_second_Node_cannot_replace_esbuild(self):
        actor = packet(3, 4); actor['processes'][1]['argv'] = actor['parent']['argv']
        actor['processes'][1]['executable'] = actor['parent']['executable']
        with self.assertRaisesRegex(RuntimeError, 'direct_child'): context.source_actor_checks(actor, packet())
    def test_exact_current_source_epoch_not_inferred_from_programs(self):
        actor = packet(3, 4)
        with self.assertRaisesRegex(RuntimeError, 'exact_acknowledged'): context.source_actor_checks(actor, {'sdkActor': packet()}, packet())
    def test_scalar_query_adapter_refuses_multiple_rows(self):
        self.assertEqual(context.query_one(types.SimpleNamespace(query=lambda _: [{'x': 1}]), 'SELECT'), {'x': 1})
        with self.assertRaisesRegex(RuntimeError, 'one_bounded'): context.query_one(types.SimpleNamespace(query=lambda _: [1, 2]), 'SELECT')
    def test_consumer_frame_uses_bounded_SDK_command_not_retained_run(self):
        calls = []
        pure = types.SimpleNamespace(consumer_frame=lambda h: h.m.run(['fixed'], timeout=8))
        host = object.__new__(m.Host)
        host.read_host = types.SimpleNamespace(context=types.SimpleNamespace(module=lambda *args:pure, READ_HELPERS='fixed', READ_HELPERS_SHA='pin'))
        host.h = types.SimpleNamespace(m=types.SimpleNamespace(run=lambda args, timeout:calls.append((args, timeout))))
        host.peers(); self.assertEqual(calls, [(['fixed'], 8)])
    def test_peer_hash_excludes_only_two_systemd_restart_fields(self):
        sdk = types.SimpleNamespace(PEER="prefix\nprint(json.dumps(row,sort_keys=True))")
        code = context.peer_program(sdk)
        self.assertIn("{b'INVOCATION_ID',b'JOURNAL_STREAM'}", code)
        self.assertIn("env.get(b'INVOCATION_ID') in {None,v['invocation'].encode()}", code)
        self.assertNotIn("b'DATABASE_URL'", code)
        with self.assertRaisesRegex(RuntimeError, 'single_authenticated'): context.peer_program(types.SimpleNamespace(PEER='foreign'))
    def test_final_start_CAS_runs_after_slow_preservation_calls(self):
        host = object.__new__(m.Host); live = []
        host.old_inputs = lambda: None
        host.combined = lambda: live.append('foreign appeared')
        host.first_effect_deadline = None
        def terminal(unit):
            self.assertEqual(unit, m.SOURCE)
            if live: raise RuntimeError('new_actor_appeared_before_start')
        host.terminal = terminal
        with patch.object(m.subprocess, 'run') as launch:
            with self.assertRaisesRegex(RuntimeError, 'new_actor_appeared'): host.manager('start', m.SOURCE)
            launch.assert_not_called()
    def test_inverse_session_leaf_is_positive_subset_not_global_zero(self):
        actor = packet(3, 4); rows = [{'pid': 100, 'backendStart': 'own'}, {'pid': 200, 'backendStart': 'managed-other'}]
        observer = types.SimpleNamespace(peer_fds=lambda pids, uid, gid: {str(pid): {'startTicks': pid * 10} for pid in pids},
            unix_peers=lambda raw: {}, run=lambda args: b'', tcp_clients=lambda *args: {},
            map_owned_backends=lambda own, fds, rows, peers, tcp: [rows[0]])
        host = types.SimpleNamespace(query=lambda sql: copy.deepcopy(rows), raw=types.SimpleNamespace(observer=observer))
        self.assertEqual(context.temporary_sessions(host, actor), [rows[0]])
        observer.map_owned_backends = lambda *args: []
        with self.assertRaisesRegex(RuntimeError, 'positive_stable'): context.temporary_sessions(host, actor)
    def test_inverse_leaf_never_revalidates_obsolete_combined_actor(self):
        source = context.temporary_value(packet(3, 4)); api = {'actual': 'new-owned-API'}; boot = {'ino': 7}
        op = {'operatorSha256': 'new-owner', 'catalogBefore': {'all': 'exact'}, 'sourceBoot': boot}
        result = {'format': m.FORMAT, 'inverse': True, 'ownedEightSELECTsRevoked': True, 'prior143AndCache4Preserved': True,
                  'operatorSha256': 'new-owner', 'operationSha256': m.sha(b'op'), 'bootId': 'boot', 'restoredSchema': m.FRESH,
                  'restoredBuild': m.FRESH_BUILD, 'source': source, 'api': api}
        touched = []
        host = types.SimpleNamespace(inverse_mode=False, static=types.SimpleNamespace(inverse_source=lambda: self.fail('stale de4 actor invoked')),
            catalog=lambda: {'all': 'exact'}, source_activation=lambda: touched.append('boot'), definitions=lambda selected: None,
            source_actor=lambda expected: source, actor=lambda selected: api, native=lambda *args: {},
            availability=lambda *args: {'ready': True}, state=lambda unit: {'ActiveState': 'active', 'UnitFileState': 'enabled'})
        records = {'switch-result.json': {'switchBoundary': 101}, 'inverse-review.json': {'lastFeatureCursor': 102}}
        own = types.SimpleNamespace(operation=lambda: op, get=lambda name: records[name], phase=lambda name: touched.append(name))
        fake = types.SimpleNamespace(Host=lambda *args: host, Owner=lambda h: own, document=lambda *args: copy.deepcopy(result),
            BASE=Path('/not-an-owned-operation'), protected=lambda path: b'op', boot=lambda: 'boot', boot_record=lambda: boot,
            FORMAT=m.FORMAT, FRESH=m.FRESH, FRESH_BUILD=m.FRESH_BUILD, TIMER=m.TIMER, sha=m.sha)
        with patch.object(context, 'temporary_sessions', return_value=[{'pid': 100, 'backendStart': 'own'}]), \
             patch.object(context, 'inverse_catalog_phase', return_value=({'all':'exact'}, {'phase':'before-reader-inverse-143-plus-cache4'})):
            proof = context.inverse_leaf(fake, 'a'*64, 'b'*64, 'c'*64)
        self.assertEqual(proof['temporarySourceActor'], source['sdkActor'])
        self.assertTrue(proof['temporarySourceActorQualified']); self.assertFalse(proof['combinedSourceActorQualified'])
        self.assertIn('inverse-start-original-api', touched)
    def test_heartbeat_requires_new_locked_epoch_not_still_fresh_predecessor(self):
        floor = {'intentSha256': m.sha(b'intent'), 'predecessorHeartbeat': 500, 'prestartDatabaseClock': 600}
        values = iter([{'build_id': m.FRESH_BUILD, 'is_locked': '1', 'heartbeat_at': 500}, 601])
        host = types.SimpleNamespace(b=types.SimpleNamespace(document=lambda path: floor, BASE=Path('/future-op'), sha=m.sha,
                                                           protected=lambda path: b'intent', FRESH=m.FRESH, FRESH_BUILD=m.FRESH_BUILD),
                                     query=lambda sql: next(values))
        with patch.object(context, 'temporary_sessions') as mapped:
            with self.assertRaisesRegex(RuntimeError, 'genuine_new'): context.heartbeat_current(host, packet(3,4))
            mapped.assert_not_called()
        values = iter([{'build_id': m.FRESH_BUILD, 'is_locked': '1', 'heartbeat_at': 600}, 601])
        with patch.object(context, 'temporary_sessions', return_value=[{'pid': 100}]) as mapped:
            self.assertEqual(context.heartbeat_current(host, packet(3,4)), [{'pid':100}]); mapped.assert_called_once()


def phase_fixture():
    cache = mod('pure_cache_four', HERE / 'ypal-cache-guard-owner-v1.py')
    helpers = mod('pure_reader_delta', HERE / 'ypal-combined-read-admission-v2.py')
    before = fixture(); after = copy.deepcopy(before)
    names = sorted(cache.CACHE_TABLES)
    plan = {'addedSelects': [{'name': name, 'role': cache.COLLECTOR, 'grantee': m.ROLE_OID, 'grantor': '16388',
                             'privilege': 'SELECT', 'grantable': False} for name in names], 'before': {'acl': []},
            'after': {'tables': [{'name': name, 'oid': str(800+i)} for i,name in enumerate(names)]}}
    for row in plan['after']['tables']:
        after['baseline']['edges'].append({'kind': 'relation', 'object': row['oid'], 'grantor': '16388', 'privilege': 'SELECT', 'grantable': False})
    after['baseline']['edges'].sort(key=lambda row: (row['kind'], row['object'], row['grantor'], row['privilege'], row['grantable']))
    return cache, helpers, before, after, plan


class ReaderInversePhase(unittest.TestCase):
    def host(self):
        cache, helpers, old143, with4, plan = phase_fixture()
        columns = [{'schema': 'preserved', 'relation': 'all', 'edges': []}]
        read_catalog = {'roles': ['same143'], 'directRoleEdges': ['same'], 'activeRelease': 'historical-at-capture'}
        config = {'readAdmissionSha256':'a'*64, 'readPlanSha256':'b'*64, 'readContextInputSha256':'c'*64,
                  'readerManifestSha256':'d'*64, 'readerResultSha256':'e'*64}
        reader_result = {'operationSha256':'f'*64}
        catalog = {'validated':True, 'read143Preserved':True, 'cache4Reversed':True, 'twoLOGINReversed':True,
                   **{k:config[k]for k in ['readAdmissionSha256','readPlanSha256','readContextInputSha256']},
                   'catalogSha256':m.sha(m.encoded({k:v for k,v in read_catalog.items()if k!='activeRelease'})),
                   'allColumnAclSha256':m.sha(m.encoded(columns))}
        refs = {'result_sha':'1'*64,'manifest_sha':config['readerManifestSha256']}
        binding = {'operatorSha256':context.DEPENDENCIES['ypal-native-inverse-leaf-v1.py'],
                   'coordinatorOperatorSha256':context.DEPENDENCIES['ypal-native-cutover-v2.py'],
                   'manifestSha256':refs['manifest_sha'],'inverseResultSha256':refs['result_sha'],
                   'records':{'operation.json':reader_result['operationSha256']},'catalog':catalog}
        proof = {'format':'yunipals-ypal-native-inverse-leaf-v1','validated':True,'binding':binding,'bindingSha256':m.sha(m.encoded(binding)),
                 'sourceActorQualified':False,'currentWriterQualified':False,'financialAuthorityQualified':False,'currentReadinessQualified':False,
                 'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        calls=[]
        leaf=types.SimpleNamespace(FORMAT=proof['format'],validate_inverse_leaf=lambda **kw:calls.append(kw) or copy.deepcopy(proof))
        b=types.SimpleNamespace(pin=m.pin,sha=m.sha,encoded=m.encoded,ROLE_OID=m.ROLE_OID,
             document=lambda *args:reader_result,module=lambda path,digest:leaf)
        h=types.SimpleNamespace(b=b,config=config,cache=cache,parts={'historicalReadHelpers':helpers},
             read=types.SimpleNamespace(acl_catalog=lambda v:{k:x for k,x in v.items()if k!='activeRelease'}),
             read_rehearsal={'after':{'read':read_catalog,'allColumnAcl':columns}},catalog=lambda:copy.deepcopy(old143))
        receipts=copy.deepcopy(({'catalog':{'postProof':{'reader':old143['baseline']}}},{'postProof':{'reader':with4['baseline']},'result':plan}))
        return h, {'catalogBefore':with4}, refs, proof, calls, receipts, old143, with4
    def test_old143_plus4_comparison_refuses_same_collector_after_four_REMOVAL(self):
        h,op,refs,proof,calls,receipts,old143,with4=self.host()
        self.assertNotEqual(old143,op['catalogBefore'])
        with patch.object(context,'cache_receipts',return_value=receipts):
            with self.assertRaisesRegex(RuntimeError,'explicit_reader_phase'):context.inverse_catalog_phase(h,op,None)
            expected,phase=context.inverse_catalog_phase(h,op,refs)
        self.assertEqual(expected,old143);self.assertTrue(phase['readerInverseQualified']);self.assertEqual(calls,[refs])
    def test_pre_reader_phase_still_requires_exact143_plus4(self):
        h,op,refs,proof,calls,receipts,old143,with4=self.host();h.catalog=lambda:copy.deepcopy(with4)
        with patch.object(context,'cache_receipts',return_value=receipts):
            expected,phase=context.inverse_catalog_phase(h,op,None)
            self.assertEqual(expected,with4);self.assertFalse(phase['readerInverseQualified']);self.assertEqual(calls,[])
            with self.assertRaisesRegex(RuntimeError,'explicit_reader_phase'):context.inverse_catalog_phase(h,op,refs)
    def test_post_reader_phase_rejects_wrong_refs_plan_columns_operation_or_extra_edge(self):
        for mutate in ['operation','plan','columns','edge','targetColumn']:
            h,op,refs,proof,calls,receipts,old143,with4=self.host()
            if mutate=='operation':proof['binding']['records']['operation.json']='2'*64
            elif mutate=='plan':proof['binding']['catalog']['readPlanSha256']='2'*64
            elif mutate=='columns':proof['binding']['catalog']['allColumnAclSha256']='2'*64
            elif mutate=='edge':
                old143['baseline']['edges'].append({'kind':'relation','object':'foreign','grantor':'16388','privilege':'SELECT','grantable':False})
            else:old143['target']['tables'][0]['columnAcl']=[{'number':1,'name':'foreign','acl':[{'grantee':'PUBLIC','privilege':'UPDATE'}]}]
            proof['bindingSha256']=m.sha(m.encoded(proof['binding']))
            with patch.object(context,'cache_receipts',return_value=receipts),self.assertRaises(RuntimeError):context.inverse_catalog_phase(h,op,refs)
        h,op,refs,proof,calls,receipts,old143,with4=self.host()
        with patch.object(context,'cache_receipts',return_value=receipts),self.assertRaisesRegex(RuntimeError,'explicit_same_reader'):
            context.inverse_catalog_phase(h,op,{**refs,'manifest_sha':'2'*64})
    def test_authenticated_before_catalog_not_arbitrary_four_edge_normalization(self):
        cache,helpers,before,after,plan=phase_fixture();original=copy.deepcopy(after)
        self.assertEqual(context.restored_collector_baseline(m,original,before['baseline'],after['baseline'],plan,cache,helpers),before)
        wrong=copy.deepcopy(after['baseline']);wrong['edges'].append({'kind':'relation','object':'foreign','grantor':'16388','privilege':'SELECT','grantable':False})
        original['baseline']=wrong
        with self.assertRaises(RuntimeError):context.restored_collector_baseline(m,original,before['baseline'],wrong,plan,cache,helpers)
    def test_actual_inverse_leaf_delegates_completed_reader_phase_twice_without_source_recursion(self):
        h,op,refs,reader_proof,calls,receipts,old143,with4=self.host(); b=h.b
        source=context.temporary_value(packet(3,4));api={'owned':'restoredAPI'};boot={'ino':7}
        op.update(operatorSha256='new-owner',sourceBoot=boot)
        result={'format':m.FORMAT,'inverse':True,'ownedEightSELECTsRevoked':True,'prior143AndCache4Preserved':True,
                'operatorSha256':'new-owner','operationSha256':m.sha(b'op'),'bootId':'boot','restoredSchema':m.FRESH,
                'restoredBuild':m.FRESH_BUILD,'source':source,'api':api}
        b.Host=lambda *args:h;b.Owner=lambda host:types.SimpleNamespace(operation=lambda:op,
             get=lambda name:{'switch-result.json':{'switchBoundary':101},'inverse-review.json':{'lastFeatureCursor':102}}[name],phase=lambda name:None)
        prior_document=b.document;b.BASE=Path('/no-real-operation');b.FORMAT=m.FORMAT;b.FRESH=m.FRESH;b.FRESH_BUILD=m.FRESH_BUILD;b.TIMER=m.TIMER
        b.document=lambda path,*args:copy.deepcopy(result)if path==b.BASE/'inverse-result.json'else prior_document(path,*args)
        b.protected=lambda path:b'op';b.boot=lambda:'boot';b.boot_record=lambda:boot
        h.source_activation=lambda:None;h.definitions=lambda selected:None;h.source_actor=lambda expected:source;h.actor=lambda selected:api
        h.native=lambda *args:{};h.availability=lambda *args:{'ready':True};h.state=lambda unit:{'ActiveState':'active','UnitFileState':'enabled'}
        h.static=types.SimpleNamespace(inverse_source=lambda:self.fail('obsolete source predicate invoked'))
        with patch.object(context,'cache_receipts',return_value=receipts),patch.object(context,'temporary_sessions',return_value=[{'pid':100}]):
            proof=context.inverse_leaf(b,'a'*64,'b'*64,'c'*64,reader_inverse_refs=refs)
        self.assertEqual(calls,[refs,refs]);self.assertEqual(proof['temporarySourceActor'],source['sdkActor'])
        self.assertTrue(proof['inverseCatalogPhase']['readerInverseQualified']);self.assertFalse(proof['combinedSourceActorQualified'])


if __name__ == '__main__': unittest.main()
