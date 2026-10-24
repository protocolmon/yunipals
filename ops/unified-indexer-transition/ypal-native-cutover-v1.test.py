"""Synthetic phase/FS/protocol controls; no production, DB or provider calls."""
import copy
import contextlib
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
    path = HERE / name
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


p = load('ypal-native-cutover-proof-v1.py')
m = load('ypal-native-cutover-v1.py')
finish = load('ypal-cache-finish-v2.py')


def catalog():
    return {'roles': [
        {'name': 'yunipals_unified_api', 'oid': '73187671', 'login': False, 'limit': 6},
        {'name': 'yunipals_unified_collector', 'oid': '73187672', 'login': True, 'limit': 6},
        {'name': 'yunipals_unified_islands_api', 'oid': '73187674', 'login': False, 'limit': 6},
        {'name': 'yunipals', 'oid': '16388', 'login': True, 'limit': 32}],
        'relations': [{'schema': 'metadata_projection', 'name': name, 'oid': str(100 + i),
                       'acl': 'owned+fourSELECT', 'columnACLs': []} for i, name in enumerate(sorted(p.CACHE_TABLES))],
        'retainedOperationalWrites': True, 'retainedSolanaReads': True, 'retainedTCGReads': 20}


class Tests(unittest.TestCase):
    def test_only_two_existing_LOGIN_bits_and_existing_collector_true_are_allowed(self):
        before = catalog(); after, delta = p.login_postcatalog(before)
        self.assertEqual(len(delta), 2); self.assertTrue(p.exact_login_catalog(before, after, True))
        self.assertTrue(before['roles'][0]['login'] is False); self.assertTrue(before['roles'][1]['login'])
        for mutate in [lambda value: value['roles'][1].update(login=False),
                       lambda value: value['roles'][0].update(limit=-1),
                       lambda value: value['roles'][2].update(oid='999'),
                       lambda value: value.update(retainedSolanaReads=False),
                       lambda value: value.update(retainedTCGReads=10)]:
            bad = copy.deepcopy(after); mutate(bad)
            with self.assertRaises(RuntimeError): p.exact_login_catalog(before, bad, True)

    def test_no_preexisting_foreign_LOGIN_may_be_adopted_without_own_ACK(self):
        before = catalog(); before['roles'][0]['login'] = True
        with self.assertRaisesRegex(RuntimeError, 'existing_NOLOGIN'): p.login_postcatalog(before)
        before = catalog(); before['roles'][1]['login'] = False
        with self.assertRaisesRegex(RuntimeError, 'collector_original_LOGIN'): p.login_postcatalog(before)

    def test_complete_cache_ACLs_include_unmanaged_grants_columns_and_OIDs(self):
        before = catalog(); p.complete_cache_acl_baseline(before, copy.deepcopy(before))
        for mutate in [lambda value: value['relations'][0].update(acl='owned+fourSELECT+foreign_unmanaged'),
                       lambda value: value['relations'][0]['columnACLs'].append({'grantee': 'foreign', 'SELECT': True}),
                       lambda value: value['relations'][0].update(oid='999'),
                       lambda value: value['relations'].pop()]:
            bad = copy.deepcopy(before); mutate(bad)
            with self.assertRaisesRegex(RuntimeError, 'full_ACLs'): p.complete_cache_acl_baseline(before, bad)

    def test_full_component_guard_allows_only_monotonic_same_four_epochs(self):
        before = {'epochs': [{'collection': n, 'revision': '9'} for n in ['base', 'bnb', 'ethereum', 'polygon']],
            'tables': [{'oid': 'real-owned', 'columns': ['same']}], 'acl': [{'grantee': 'owned'}],
            'columnAcl': [], 'functions': [{'definition': 'exact'}], 'guards': ['all35'], 'triggers': ['same']}
        after = copy.deepcopy(before); after['epochs'][0]['revision'] = '12'
        self.assertEqual(p.semantic_guard(before, after), p.semantic_guard(before, before))
        for mutate in [lambda value: value['epochs'][0].update(revision='0'),
                       lambda value: value['epochs'].pop(),
                       lambda value: value['acl'].append({'grantee': 'foreign'}),
                       lambda value: value['columnAcl'].append({'grantee': 'PUBLIC', 'privilege': 'UPDATE'}),
                       lambda value: value['functions'][0].update(definition='changed')]:
            bad = copy.deepcopy(after); mutate(bad)
            with self.assertRaises(RuntimeError): p.semantic_guard(before, bad)

    def test_phase_leaf_four_role_slices_require_explicit_feature_eight_and_never_source_authority(self):
        before, _ = p.login_postcatalog(catalog()); before.update(schemas=[], functions=[], directRoleEdges=[])
        before['relations'] += [{'schema': p.PHYSICAL, 'name': name, 'oid': str(500 + i), 'owner': '73004621', 'acl': 'private'} for i, name in enumerate(p.FEATURE_EIGHT)]
        before['effective'] = [{'role': role, 'relations': {p.PHYSICAL + '.' + name: {'select': False, 'writes': False} for name in p.FEATURE_EIGHT},
                                'schemas': {}, 'functions': {}} for role in p.LEAF_ROLES]
        current = copy.deepcopy(before)
        value = p.reader_role_slice(before, current)
        self.assertTrue(value['fourOwnedRoleSlicesQualified']); self.assertFalse(value['sourceActorQualified']); self.assertFalse(value['fullGlobalRoleGraphQualified'])
        collector = next(r for r in current['effective'] if r['role'] == p.PEERS['collector']['role'])
        for i, name in enumerate(p.FEATURE_EIGHT):
            collector['relations'][p.PHYSICAL + '.' + name]['select'] = True
            current['directRoleEdges'].append({'kind': 'relation', 'object': str(500 + i), 'object_name': p.PHYSICAL + '.' + name,
                'grantee': 73187672, 'grantor': 73004621, 'privilege': 'SELECT', 'grantable': False, 'column_number': None})
        with self.assertRaises(RuntimeError): p.reader_role_slice(before, current)
        self.assertTrue(p.reader_role_slice(before, current, True)['featureEightComposed'])
        current['directRoleEdges'][0]['privilege'] = 'UPDATE'
        with self.assertRaises(RuntimeError): p.reader_role_slice(before, current, True)

    def test_fixed_metadata_proof_recomputes_all_sixteen_partitions_but_never_current_readiness(self):
        producer = types.SimpleNamespace(FORMAT='yunipals-metadata-fixed-parity-v4', CONTEXT={'synthetic': 'same-lineage'},
            EXECUTION_SQL='synthetic execution', SQL='synthetic query', PARTITIONS=tuple('0123456789abcdef'))
        scan = {'chainId': 8453, 'contract': '0x98433df878e8c898cb907345c3a7756e5f72240f', 'deploymentBlock': '22224075', 'nextBlock': '52870978'}
        parts = []
        for index, name in enumerate(producer.PARTITIONS):
            rows = 440194 if index == 0 else 0
            old = {'rows': rows, 'unique_keys': rows, 'mints': rows, 'updates': 0, 'payload_sha256': 'ab' * 32}
            parts.append({'partition': name, 'legacy': old, 'native': {**old, 'unexpected_identities': 0}, 'legacyScan': scan,
                'comparison': {'missing_legacy': 0, 'missing_native': 0, 'changed_payloads': 0}})
        digest = p.sha(('ab' * 32 * 16).encode()); aggregate = {'rows': 440194, 'unique_keys': 440194, 'mints': 440194, 'updates': 0, 'partition_digest_sha256': digest}
        value = {'format': producer.FORMAT, 'completed': True, 'exactDataParity': True, 'context': producer.CONTEXT,
            'producerSha256': p.METADATA_FIXED_PRODUCER, 'executionSqlSha256': p.sha(producer.EXECUTION_SQL.encode()), 'sqlSha256': p.sha(producer.SQL.encode()),
            'canonicalAcceptance': False, 'sourceSelected': False, 'databaseWrites': 0, 'providerCalls': 0, 'serviceJobs': 0,
            'comparison': {'boundary': 52870977, 'partitions': parts, 'invalidKeys': {'legacy': 0, 'native': 0}, 'legacyScan': scan,
                'legacy': aggregate, 'native': {**aggregate, 'unexpected_identities': 0}, 'comparison': {'missing_legacy': 0, 'missing_native': 0, 'changed_payloads': 0}}}
        proof = p.validate_metadata_fixed(value, producer)
        self.assertTrue(proof['dataParityAtCapture']); self.assertFalse(proof['canonicalAcceptance']); self.assertFalse(proof['currentReadinessQualified'])
        for change in [lambda item: item['comparison']['partitions'].pop(),
                       lambda item: item['comparison']['partitions'][0]['native'].update(payload_sha256='cd' * 32),
                       lambda item: item['comparison']['partitions'][0]['comparison'].update(changed_payloads=1),
                       lambda item: item['comparison']['native'].update(rows=440195),
                       lambda item: item.update(canonicalAcceptance=True)]:
            bad = copy.deepcopy(value); change(bad)
            with self.assertRaises(RuntimeError): p.validate_metadata_fixed(bad, producer)

    def test_source_manifest_is_exact_finite_no_arbitrary_producer_alias(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory); code = ('root.py', 'proof.py', 'child.mjs', 'finish.py')
            for name in [*code, 'dep.py', 'cache.py']: (root / name).write_bytes(('synthetic ' + name).encode())
            files = {name: p.sha((root / name).read_bytes()) for name in code}; deps = {'dep.py': p.sha((root / 'dep.py').read_bytes())}
            path = root / 'manifest.json'; value = {'format': 'yunipals-ypal-native-cutover-source-v1', 'files': files, 'dependencies': deps}
            path.write_bytes(p.encoded(value)); pin = p.sha(path.read_bytes())
            with patch.object(p, 'OPS', root), patch.object(p, 'SOURCE_MANIFEST', path), patch.object(p, 'CODE', code), patch.object(p, 'DEPENDENCIES', deps), patch.object(p, 'CACHE_FILE', 'cache.py'), patch.object(p, 'CACHE_SHA', p.sha((root / 'cache.py').read_bytes())):
                self.assertEqual(p.source_manifest(pin), value)
                (root / 'child.mjs').write_bytes(b'altered')
                with self.assertRaisesRegex(RuntimeError, 'exact_public'): p.source_manifest(pin)
                value['files']['outside.py'] = 'a' * 64; path.write_bytes(p.encoded(value))
                with self.assertRaisesRegex(RuntimeError, 'finite_frozen'): p.source_manifest(p.sha(path.read_bytes()))

    def test_private_inputs_refuse_hardlinks_and_symlinks(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory); path = root / 'receipt.json'; path.write_bytes(b'{}')
            self.assertEqual(p.protected(path), b'{}')
            alias = root / 'alias.json'; os.link(path, alias)
            with self.assertRaisesRegex(RuntimeError, 'single_link'): p.protected(path)
            alias.unlink(); alias.symlink_to(path)
            with self.assertRaisesRegex(RuntimeError, 'protected'): p.protected(alias)

    def test_terminal_proof_requires_no_jobs_no_cgroup_and_prior_PID_gone(self):
        state = {'Id': 'synthetic-cutover-never-created.service', 'MainPID': '0', 'ControlPID': '0', 'Job': '', 'ActiveState': 'inactive', 'SubState': 'dead'}
        self.assertTrue(p.terminal(state)['terminal'])
        for key, value in [('MainPID', '42'), ('Job', '77/start'), ('ActiveState', 'active')]:
            with self.assertRaises(RuntimeError): p.terminal({**state, key: value})
        own = p.process(os.getpid())
        with self.assertRaisesRegex(RuntimeError, 'prior_process'): p.terminal(state, [own])
        self.assertTrue(p.terminal(state, [{**own, 'startTicks': own['startTicks'] - 1}])['terminal'])

    def protocol(self, lost=False, delay=False):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup); root = Path(temporary.name)
        base = root / 'operation'; base.mkdir(mode=0o700); script = root / 'child.py'; intent = base / 'durable.json'
        publication = base / 'publication'; publication.mkdir(mode=0o700)
        script.write_text("""import json,sys,os,time
request=json.loads(sys.stdin.readline());assert 'DATABASE_URL'not in json.dumps(request)
if sys.argv[2]=='delay':time.sleep(60)
backend={'pid':9,'backendStart':'123','roleOid':'16388','databaseOid':'17584','xid':None,'clientAddress':None,'clientPort':-1}
print(json.dumps({'event':'session-opened','mode':'publish','currentUser':'yunipals','sessionUser':'yunipals','backend':backend}),flush=True)
assert json.loads(sys.stdin.readline())['phase']=='session-opened'
message={'event':'publication-prepared','xid':'900','backend':{**backend,'xid':'900'}}
print(json.dumps(message),flush=True)
reply=json.loads(sys.stdin.readline());assert reply['event']=='root-authorized'and reply['phase']=='publication-prepared'
assert os.path.exists(sys.argv[1])
if sys.argv[2]=='lost':sys.exit(1)
print(json.dumps({'event':'result','value':{'published':True,'xid':'900'}}),flush=True)
""")
        original = subprocess.Popen; calls = []
        def spawn(args, **kwargs):
            calls.append(args); self.assertIn('--reuid=0', args); self.assertIn('--bounding-set=-all', args)
            self.assertFalse(any('DATABASE_URL' in arg or 'synthetic-password' in arg for arg in args))
            self.assertIn('synthetic-password', kwargs['env']['DATABASE_URL'])
            return original([sys.executable, '-B', str(script), str(intent), 'delay' if delay else 'lost' if lost else 'pass'], **kwargs)
        context = types.SimpleNamespace(proof=p, host=types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=root)),
            manifest={'files': {m.ENTRY.name: 'a' * 64}}, inputs={'sourceManifestSha256': 'b' * 64},
            business_environment=lambda: {'DATABASE_URL': 'postgresql://synthetic:synthetic-password@localhost/example'})
        self.enterContext(patch.object(m, 'BASE', base)); self.enterContext(patch.object(m, 'PUBLICATION', publication)); self.enterContext(patch.object(m.subprocess, 'Popen', side_effect=spawn))
        self.enterContext(patch.object(m, 'owned_peer_session', return_value=[{'pid': 9, 'backendStart': '123'}]))
        def prepared(message):
            self.assertEqual(message['xid'], '900'); m.save('durable.json', {'actualPrepared': True}); return True
        return context, prepared, calls, base

    def test_real_pipe_never_authorizes_commit_before_fsynced_record_and_keeps_URL_out_of_protocol(self):
        context, prepared, calls, base = self.protocol()
        result = m.child(context, 'publish', {'generationId': '104'}, prepared)
        self.assertTrue(result['published']); self.assertEqual(len(calls), 1); self.assertTrue((base / 'durable.json').exists())
        self.assertNotIn('synthetic-password', (base / 'publication/publish-child.json').read_text())

    def test_lost_commit_ACK_preserves_intent_never_resubmits_or_fabricates_result(self):
        context, prepared, calls, base = self.protocol(lost=True)
        with self.assertRaises(RuntimeError): m.child(context, 'publish', {'generationId': '104'}, prepared)
        self.assertEqual(len(calls), 1); self.assertTrue((base / 'durable.json').exists()); self.assertFalse((base / 'result.json').exists())

    def test_deadline_kills_only_its_owned_process_group(self):
        context, prepared, calls, base = self.protocol(delay=True)
        with patch.object(m, 'MAX_PREPARATION_SECONDS', .05):
            with self.assertRaisesRegex(RuntimeError, 'deadline_expired'): m.child(context, 'publish', {}, prepared)
        self.assertEqual(len(calls), 1); self.assertFalse((base / 'durable.json').exists())

    def filesystem(self):
        temporary = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(temporary.cleanup)
        root = Path(temporary.name); base = root / 'owned'; base.mkdir(mode=0o700)
        self.enterContext(patch.object(m, 'BASE', base)); self.enterContext(patch.object(m, 'PUBLICATION', base / 'publication'))
        return root, base

    def test_exclusive_file_publication_never_adopts_foreign_same_bytes(self):
        root, base = self.filesystem(); target = root / 'public' / 'reader.env'; spec = {'text': 'PUBLIC=only\n', 'mode': 0o644}
        m.publish_file('reader', target, spec); first = m.inode(target)
        m.publish_file('reader', target, spec); self.assertEqual(m.inode(target), first)
        foreign = root / 'foreign.env'; foreign.write_text(spec['text']); os.replace(foreign, target)
        with self.assertRaisesRegex(RuntimeError, 'same_acknowledged'): m.publish_file('reader', target, spec)

    def test_publication_recovers_exact_linked_inode_prefix_without_overwrite(self):
        root, base = self.filesystem(); parent = root / 'public'; parent.mkdir(); target = parent / 'reader.env'
        spec = {'text': 'PUBLIC=only\n', 'mode': 0o644}
        m.save('reader.staged', spec['text'].encode(), spec['mode']); identity = m.inode(base / 'reader.staged')
        m.save('reader-publish-intent.json', {'path': str(target), 'identity': identity})
        os.link(base / 'reader.staged', target)
        self.assertEqual(target.stat().st_nlink, 2)
        m.publish_file('reader', target, spec)
        self.assertEqual({k: v for k, v in m.inode(target).items() if k != 'ctimeNs'}, {k: v for k, v in identity.items() if k != 'ctimeNs'})
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertFalse((base / 'reader.staged').exists())

    def test_inverse_unlink_reuses_only_its_exact_intent_and_inode(self):
        root, base = self.filesystem(); target = root / 'public' / 'reader.env'; spec = {'text': 'PUBLIC=only\n', 'mode': 0o644}
        m.publish_file('reader', target, spec); m.unlink_owned_file('reader', target); m.unlink_owned_file('reader', target)
        target.write_text(spec['text'])
        with self.assertRaisesRegex(RuntimeError, 'foreign_or_changed'): m.unlink_owned_file('reader', target)
        self.assertTrue(target.exists())

    def test_stop_rechecks_actor_after_fsynced_intent_and_never_stops_replacement(self):
        root, base = self.filesystem(); actor = {'main': {'pid': 99, 'startTicks': 1}, 'unit': {'InvocationID': 'a'}}
        context = types.SimpleNamespace(proof=types.SimpleNamespace(PEERS={'main': {'unit': 'yunipals-api.service', 'oid': '73187671'}}), sessions=lambda *args: {'owned': []}, state=lambda unit: {'MainPID': '99'})
        with patch.object(m, 'public_input', return_value=b'owned operation'), patch.object(m, 'owned_reader', side_effect=[actor, actor, {**actor, 'main': {'pid': 100}}]), patch.object(m, 'manager') as manager:
            with self.assertRaisesRegex(RuntimeError, 'changed_after_fsynced_stop'): m.stop_reader(context, {}, 'main')
            manager.assert_not_called()
        self.assertTrue((base / 'reader-main-stop-intent.json').exists())

    def test_lost_start_ACK_uses_exact_real_actor_without_manager_or_second_start(self):
        root, base = self.filesystem(); descriptor = {'unit': 'yunipals-api.service', 'expected': {}, 'files': {}}
        actor = {'main': {'pid': 99, 'startTicks': 51}, 'unit': {'InvocationID': 'new'}}
        intent = {'format': m.FORMAT, 'bootId': m.boot(), 'operationSha256': m.sha(b'owned operation'),
                  'descriptorSha256': m.sha(m.encoded(descriptor)), 'before': {'InvocationID': 'old'}, 'minimumStartTicks': 50}
        m.save('reader-main-start-intent.json', intent)
        context = types.SimpleNamespace(reader=lambda *args: actor)
        original_input = m.public_input
        def read(path, pin=None):
            return b'owned operation' if Path(path).name == 'operation.json' else original_input(path, pin)
        with patch.object(m, 'public_input', side_effect=read), patch.object(m, 'reader_descriptor', return_value=descriptor), patch.object(m, 'manager') as manager:
            self.assertEqual(m.start_reader(context, {}, 'main', reconcile=True), actor); manager.assert_not_called()
        self.assertTrue((base / 'reader-main-started.json').exists())

    def test_same_PID_private_input_drift_is_rejected_after_async_work(self):
        root, base = self.filesystem(); path = root / 'private.env'; path.write_text('UNCHANGED=expected\n')
        op = {'binding': {'originalReaders': {'main': {'definitions': {}, 'privateInputHashes': {str(path): m.sha(path.read_bytes())},
            'inlineEnvironmentSha256': m.sha(m.encoded([]))}}}}
        context = types.SimpleNamespace(host=types.SimpleNamespace(m=types.SimpleNamespace(protected=lambda p: Path(p).read_bytes(), service_property=lambda *args: [])),
                                        proof=types.SimpleNamespace(PEERS={'main': {'unit': 'yunipals-api.service'}}))
        m.original_inputs(context, op); path.write_text('CHANGED=after_start\n')
        with self.assertRaisesRegex(RuntimeError, 'private_input_drift'): m.original_inputs(context, op)

    def inverse_context(self):
        root, base = self.filesystem(); source_dir = root / 'source'; source_dir.mkdir(); route_dir = root / 'routes'; route_dir.mkdir()
        route_file = root / 'routes.py'; route_file.write_text('# exact synthetic pinned routes\n')
        peers = {name: {'pid': i + 40} for i, name in enumerate(('ethereum', 'base', 'polygon', 'bnb'))}
        routes = {'completed': True, 'operatorSha256': p.sha(route_file.read_bytes()), 'bootId': p.boot(), 'routes': {k: {'actor': v} for k, v in peers.items()}}
        route_bytes = p.encoded(routes); (route_dir / 'result.json').write_bytes(route_bytes)
        old_reader, current_reader = {'edges': []}, {'edges': [{'SELECT': 'synthetic'}]}
        prior = {'acceptedYpal': {'readerCatalogSha256': p.sha(p.encoded(old_reader)), 'actual': True}, 'otherRetained': 'same'}
        current = {'acceptedYpal': {'readerCatalogSha256': p.sha(p.encoded(current_reader)), 'actual': True}, 'otherRetained': 'same'}
        b = {'inputs': {'fixed': True}}; route_before = {'binding': b, 'catalog': {'budget': 'unchanged'}}
        route_before['reviewHash'] = p.sha(p.encoded({'binding': b, 'catalog': route_before['catalog']}))
        calls = []; native = {'schemaOid': 'native-oid', 'tables': {'token': {'oid': 'fixed', 'owner': 'fixed'}}, 'app': {'build_id': 'current-build', 'is_dev': 0, 'is_locked': 0}}
        actor = {'pid': 99999999, 'processes': [{'pid': 99999999, 'startTicks': 1}]}
        source_state = {'MainPID': '0', 'ControlPID': '0', 'Job': '', 'ActiveState': 'failed', 'FragmentPath': str(root / 'source.service'),
                        'DropInPaths': '', 'MemoryMax': '6442450944', 'RuntimeMaxUSec': 'infinity'}
        s = types.SimpleNamespace(BASE=source_dir, NEW='synthetic-never-created-source.service', UNIT=root / 'source.service', TEMPLATE_SHA='unit-sha', BUILD='current-build', NEW_LINK=root / 'source.boot',
            static_inputs=lambda h: calls.append('static'), old_private_inputs=lambda op: calls.append('private'), base_code=lambda: 'code',
            exact_link=lambda *args: calls.append('boot'), new_owned=lambda *args: (_ for _ in ()).throw(AssertionError('active bootstrap called for terminal source')))
        a = types.SimpleNamespace(BASE=route_dir, __file__=str(route_file), CHAINS=tuple(peers), exact_catalog=lambda *args: calls.append('route_catalog'), catalog=lambda m: route_before['catalog'])
        guard = types.SimpleNamespace(route_owner=a, load=lambda name: route_before, check_published=lambda name: calls.append(name))
        h = types.SimpleNamespace(m=guard, role=lambda: 'source-role', old_terminal=lambda op: calls.append('old_terminal'),
            preserved_old_native=lambda op: calls.append('old_native'), native=lambda: native, state=lambda name: source_state,
            files=lambda state: {str(s.UNIT): 'unit-sha'}, rpc=types.SimpleNamespace(inputs=lambda *args: b['inputs'],
                owned_stop_identity=lambda m, a, chain, before: {'actor': peers[chain]}))
        read_impl = load('ypal-combined-read-admission-v2.py')
        read = types.SimpleNamespace(acl_catalog=read_impl.acl_catalog, reader_catalog=lambda h: (current_reader, ''),
            retained_namespace=lambda *args: {'retained': lambda m: current}, compare_retained=read_impl.compare_retained)
        host = types.SimpleNamespace(read=read, h=h, s=s, source_op={'sourceCode': 'code', 'sourceRole': 'source-role', 'retained': prior},
            source_ack={'source': actor, 'native': copy.deepcopy(native), 'newBoot': 'same', 'rpcResultSha256': p.sha(route_bytes)},
            read_before={'readerBefore': old_reader}, read_rehearsal={'after': catalog(), 'readerAfter': current_reader}, plan={})
        context = p.Context.__new__(p.Context); context.host = host; context.inputs = {'sourceManifestSha256': 'a' * 64}
        context.prepared = {'config': {'readAdmissionSha256': 'b' * 64}}; context.logins_enabled = lambda: False; context.catalog = catalog
        context.guard_scope = lambda _present: {'completeColumns': True}; context.columns_current = lambda: True
        return context, native, source_state, calls

    def test_source_terminal_inverse_is_distinct_from_forward_readiness_and_preserves_all_four_routes(self):
        context, native, state, calls = self.inverse_context()
        value = context.inverse_scope(False)
        self.assertTrue(value['validated'] and value['inverseOnly']); self.assertFalse(value['ready'])
        self.assertEqual(value['sourceState'], 'acknowledged_actor_terminal')
        for name in ('ethereum', 'base', 'polygon', 'bnb'): self.assertIn(name + '-boot', calls)
        native['tables']['token']['oid'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'table_OIDs'): context.inverse_scope(False)

    def test_terminal_inverse_refuses_live_prior_PID_foreign_ACLs_or_replacement_source(self):
        context, native, state, calls = self.inverse_context()
        actual = p.process(os.getpid()); context.host.source_ack['source']['processes'] = [actual]
        with self.assertRaisesRegex(RuntimeError, 'process_still_exists'): context.inverse_scope(False)
        context.host.source_ack['source']['processes'] = []
        context.catalog = lambda: {**catalog(), 'foreignGrant': True}
        with self.assertRaisesRegex(RuntimeError, 'full_role_relation'): context.inverse_scope(False)
        context.catalog = catalog; state['MainPID'] = '123'
        context.host.s.new_owned = lambda *args: {'pid': 'unowned replacement'}
        with self.assertRaisesRegex(RuntimeError, 'without_replacement'): context.inverse_scope(False)

    def test_metadata_recovery_accepts_owned_advancing_cursor_but_not_changed_contract_or_actor(self):
        root, base = self.filesystem(); metadata = root / 'metadata'; metadata.mkdir(); baseline = {'ingestion_mode': 'rpc', 'next_block': '50', 'contract_address': 'same', 'target_block': '90'}
        old = {'definitions': {'old.service': 'old-sha'}, 'environmentFileHashes': {'private.env': 'same-sha'}, 'configuredEnvironmentSha256': 'same-env', 'process': {'pid': 17}}
        op = {'oldWriter': old, 'oldBoot': {'inode': 123}}
        (metadata / 'inverse-result.json').write_bytes(m.encoded({'restored': True, 'oldWriter': old, 'journalOrProvenanceRowsDeleted': 0,
            'sourceSelectionChanged': False, 'readGrantsChanged': False}))
        (metadata / 'old-start-intent.json').write_bytes(m.encoded({'bootId': m.boot(), 'monotonicUs': 10, 'scan': baseline}))
        scan = {**baseline, 'next_block': '75', 'target_block': '95'}
        h = types.SimpleNamespace(m=types.SimpleNamespace(snapshot=lambda unit: (old, {})), meta=types.SimpleNamespace(IDENTITY='new-read'),
            database=lambda: {'scan': scan, 'approval': {'read_identity': 'new-read', 'state': 'blocked', 'error_code': 'owned_metadata_inverse'}}, refresh=lambda: {'inverseOnly': True, 'ready': False})
        owner = types.SimpleNamespace(BASE=metadata, DROP=metadata / 'absent.conf', BOOT=metadata / 'boot', UNIT='metadata.service',
            stable_scan=lambda value: {k: v for k, v in value.items() if k not in {'updated_at', 'ingestion_mode'}},
            link=lambda path: op['oldBoot'], state=lambda helper: {'ExecMainStartTimestampMonotonic': '12'})
        context = types.SimpleNamespace(metadata_inverse_context=lambda: (owner, h, op), cache=types.SimpleNamespace(META_OWNER_SHA='exact-772'),
            generation=lambda: (None, {'metadataOperationSha256': 'same-operation'}, None, None))
        self.assertTrue(m.validate_metadata_restored(context)['monotonicCursorPreserved'])
        scan['contract_address'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'advance_only'): m.validate_metadata_restored(context)

    def test_aborted_publication_archive_is_exclusive_and_preserves_actual_file_inodes(self):
        root, base = self.filesystem(); publication = base / 'publication'; publication.mkdir(mode=0o700)
        file = publication / 'intent.json'; file.write_bytes(b'{"owned":true}\n'); file.chmod(0o600)
        identity = m.inode(file); target = base / 'publication-aborted-1'
        value = {'binding': {'target': str(target), 'sourceDirectory': {'dev': publication.stat().st_dev, 'ino': publication.stat().st_ino, 'mode': publication.stat().st_mode},
                             'files': {'intent.json': identity}}, 'reviewHash': 'exact-review'}
        with patch.object(m, 'archive_publication_review', return_value=value):
            result = m.archive_publication(None, 'exact-review')
        self.assertTrue(result['archived']); self.assertFalse(publication.exists()); self.assertEqual(m.inode(target / 'intent.json'), identity)

    def test_pending_configuration_detects_new_unloaded_fragment_dropin_and_symlink(self):
        root, base = self.filesystem(); directory = root / 'units'; directory.mkdir()
        unit = 'yunipals-api.service'; fragment = directory / unit; fragment.write_text('[Service]\nExecStart=/bin/true\n')
        drops = directory / (unit + '.d'); drops.mkdir(); owned = drops / 'owned.conf'; owned.write_text('[Service]\nRestart=no\n')
        expected = {str(path): m.sha(path.read_bytes()) for path in [fragment, owned]}
        with patch.object(m, 'SYSTEMD_ROOTS', (str(directory),)):
            m.pending_definitions(unit, expected)
            foreign = drops / 'later.conf'; foreign.write_text('[Service]\nEnvironment=UNREVIEWED=yes\n')
            with self.assertRaisesRegex(RuntimeError, 'unreviewed_pending_unit_dropin'): m.pending_definitions(unit, expected)
            foreign.unlink(); foreign.symlink_to(owned)
            with self.assertRaisesRegex(RuntimeError, 'unreviewed_pending_unit_dropin'): m.pending_definitions(unit, expected)
            foreign.unlink(); shared = directory / 'service.d'; shared.mkdir(); (shared / 'shared.conf').write_text('[Service]\nRestart=always\n')
            with self.assertRaisesRegex(RuntimeError, 'unreviewed_pending_unit_dropin'): m.pending_definitions(unit, expected)
            (shared / 'shared.conf').unlink(); fragment.write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'same_on_disk'): m.pending_definitions(unit, expected)

    def test_expired_critical_window_never_dispatches_systemd(self):
        with patch.object(m.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'expired_before_manager_dispatch'):
                m.manager('start', 'yunipals-api.service', deadline=0)
            run.assert_not_called()

    def test_configuration_reconciliation_never_reloads_without_explicit_fresh_review(self):
        root, base = self.filesystem(); checked = {'binding': {'actualFiles': 'same'}, 'reviewHash': 'fresh'}; calls = []
        post = lambda: calls.append('actual-loaded-proof')
        frame = (None, {}, 'runtime-reload', post, None, checked)
        with patch.object(m, 'reload_target', return_value=frame), patch.object(m, 'original_inputs'), patch.object(m, 'manager') as manager:
            self.assertTrue(m.recover_reload(None, 'runtime', 'fresh')['configurationRecovered']); manager.assert_not_called()
        self.assertEqual(calls, ['actual-loaded-proof'])
        with patch.object(m, 'reload_target', side_effect=[frame, (*frame[:-1], {**checked, 'reviewHash': 'changed'})]), patch.object(m, 'manager') as manager:
            with self.assertRaisesRegex(RuntimeError, 'changed_after_reload_recovery_intent'): m.recover_reload(None, 'runtime', 'fresh', True)
            manager.assert_not_called()

    def test_actual_frozen_metadata_finish_reconciles_lost_old_start_ACK_with_advancing_cursor(self):
        root, base = self.filesystem(); metadata = root / 'metadata'; metadata.mkdir()
        owner = load('ypal-native-metadata-handover-v1.py')
        self.assertEqual(m.sha(Path(owner.__file__).read_bytes()), '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1')
        old = {'definitions': {'old.service': 'old-sha'}, 'environmentFileHashes': {'private.env': 'same'}, 'configuredEnvironmentSha256': 'unchanged', 'process': {'pid': 17}}
        boot_link = {'inode': 123}; metadata_op = {'oldWriter': old, 'oldBoot': boot_link}
        frozen = {'ingestion_mode': 'rpc', 'next_block': '50', 'contract_address': 'same', 'target_block': '90'}
        scan = {**frozen, 'next_block': '75', 'target_block': '100'}
        def store(path, value):
            path = Path(path); path.write_bytes(m.encoded(value)); return m.sha(path.read_bytes())
        for name, value in {'inverse-intent.json': {'nativeActor': None, 'nativeSessions': [], 'oldStillRunning': False},
                            'old-start-intent.json': {'bootId': m.boot(), 'monotonicUs': 10, 'scan': frozen},
                            'inverse-boot-publish-intent.json': boot_link, 'inverse-sql-intent.json': {'owned': True}}.items(): store(metadata / name, value)
        m.save('operation.json', {'owned': 'original'}); m.save('inverse-global-restored.json', {'currentGeneration': '103'}); m.save('cache-inverse-catalog.json', {'restored': True})
        m.save('metadata-inverse-intent.json', {'bootId': m.boot(), 'operationSha256': m.sha((base / 'operation.json').read_bytes()),
            'metadataOperationSha256': 'metadata-op', 'metadataProducerSha256': m.sha(Path(owner.__file__).read_bytes()),
            'globalInverseSha256': m.sha((base / 'inverse-global-restored.json').read_bytes())})
        h = types.SimpleNamespace(m=types.SimpleNamespace(snapshot=lambda unit: (old, {})), meta=types.SimpleNamespace(IDENTITY='native-read'),
            s=types.SimpleNamespace(document=m.document, save=store, boot=m.boot), refresh=lambda: None, private=lambda old: None,
            database=lambda: {'scan': scan, 'approval': {'read_identity': 'native-read', 'state': 'blocked', 'error_code': 'owned_metadata_inverse'}})
        context = types.SimpleNamespace(metadata_inverse_context=lambda: (owner, h, metadata_op), cache=types.SimpleNamespace(META_OWNER_SHA=m.sha(Path(owner.__file__).read_bytes()), stopped=lambda h: None),
            inverse_scope=lambda flag: {'inverseOnly': True, 'ready': False}, host=h, generation=lambda: (None, {'metadataOperationSha256': 'metadata-op'}, None, None))
        with patch.object(owner, 'BASE', metadata), patch.object(owner, 'DROP', metadata / 'absent.conf'), patch.object(owner, 'BOOT', metadata / 'boot'), \
             patch.object(owner, 'link', return_value=boot_link), patch.object(owner, 'state', return_value={'MainPID': '17', 'ExecMainStartTimestampMonotonic': '12'}), \
             patch.object(owner, 'lock', side_effect=contextlib.nullcontext), patch.object(owner, 'manager') as manager, patch.object(m, 'all_readers_terminal'):
            result = m.recover_metadata(context, {})
            self.assertTrue(result['monotonicCursorPreserved']); self.assertTrue(m.document(metadata / 'inverse-result.json')['completedByOwnedResumeReconciliation'])
            manager.assert_not_called()
            scan['next_block'] = '80'
            with patch.object(m, 'all_readers_terminal', side_effect=AssertionError('serving readers need not be stopped twice')):
                self.assertEqual(m.recover_metadata(context, {}), result)

    def test_cache_lost_start_ACK_is_readonly_and_foreign_or_earlier_actor_refuses(self):
        root, base = self.filesystem(); cache_base = root / 'cache-finish'; cache_base.mkdir()
        actor = {'main': {'pid': 55, 'startTicks': 51}, 'unit': {'InvocationID': 'owned-new'}}
        intent = {'bootId': finish.boot(), 'cutoverSha256': 'actual-cutover', 'dropIdentity': {'ino': 9}, 'minimumStartTicks': 50, 'previousInvocation': 'old'}
        (cache_base / 'start-intent.json').write_bytes(m.encoded(intent))
        c = types.SimpleNamespace(host=types.SimpleNamespace(actor=lambda native: actor), cache=types.SimpleNamespace(DROP=root / 'drop', inode=lambda path: {'ino': 9}, manager=lambda *args: self.fail('manager must not be called')))
        with patch.object(finish, 'BASE', cache_base), patch.object(finish, 'operation', return_value={'binding': {'cutoverSha256': 'actual-cutover'}}), patch.object(finish, 'context', return_value=(c, {}, {})):
            self.assertTrue(finish.reconcile_start(m, None)['reconciled'])
            (cache_base / 'started.json').unlink(); actor['main']['startTicks'] = 49
            with self.assertRaisesRegex(RuntimeError, 'actual_owned_cache_start'): finish.reconcile_start(m, None)

    def test_original_cache_resume_after_lost_start_ACK_does_not_send_again_or_adopt_replacement(self):
        root, base = self.filesystem(); cache = root / 'original-cache'; cache.mkdir(); boot = root / 'cache.boot'
        parked = cache / 'original-boot-link'; parked.symlink_to('/etc/systemd/system/yunipals-read-cache.service')
        original_boot = m.inode(parked, True)
        actor = {'main': {'pid': 55, 'startTicks': 51}, 'unit': {'InvocationID': 'owned-new'}}
        m.save('inverse-global-restored.json', {'currentGeneration': '103'}); m.save('metadata-restored.json', {'actualRPCModeAndOwnedOriginalWriter': True})
        m.save('cache-old-load-result.json', {'originalDefinitionsLoaded': True})
        m.save('cache-old-start-intent.json', {'bootId': finish.boot(), 'before': {'InvocationID': 'old'}, 'minimumStartTicks': 50})
        manager_calls = []
        c = types.SimpleNamespace(inverse_scope=lambda flag: {'inverseOnly': True},
            host=types.SimpleNamespace(state=lambda: {'MainPID': '55'}, actor=lambda *args: copy.deepcopy(actor)),
            cache=types.SimpleNamespace(BASE=cache, DROP=root / 'absent.conf', BOOT=boot, stopped=lambda h: self.fail('already resumed cache cannot be stopped again'),
                manager=lambda action: manager_calls.append(action), inode=m.inode))
        with patch.object(finish, 'before', return_value={'boot': original_boot}):
            result = finish.restore_old(c, m, {})
            self.assertTrue(result['restored']); self.assertEqual(manager_calls, ['daemon-reload'])
            self.assertEqual(finish.restore_old(c, m, {}), result); self.assertEqual(manager_calls, ['daemon-reload'])
            actor['unit']['InvocationID'] = 'foreign-replacement'
            with self.assertRaisesRegex(RuntimeError, 'same_acknowledged_original_cache_resume'): finish.restore_old(c, m, {})

    def test_reader_phase_leaf_exports_owned_catalog_evidence_without_old_source_or_observer_authority(self):
        root, base = self.filesystem(); cache = root / 'cache'; cache.mkdir(); (cache / 'sql-committed.json').write_bytes(b'{}')
        m.save('operation.json', {'actual': 'owned'}); m.save('roles-prepared.json', {'after': catalog()})
        publication = base / 'publication'; publication.mkdir(); (publication / 'published.json').write_bytes(b'{}')
        manifest_sha = 'b' * 64; peers = {'main': {'oid': '73187671'}}; actors = {'main': {'main': {'pid': 55}}}; boots = {'main': {'identity': 'owned'}}
        result = {'format': m.FORMAT, 'completed': True, 'readersCutOver': True, 'operatorSha256': 'owned-operator', 'bootId': m.boot(),
            'operationSha256': m.sha((base / 'operation.json').read_bytes()), 'sourceManifestSha256': manifest_sha,
            'publicationSha256': m.sha((publication / 'published.json').read_bytes()), 'readerActors': actors, 'readerBootLinks': boots,
            'generationId': '104'}
        m.save('result.json', result); result_sha = m.sha((base / 'result.json').read_bytes())
        op = {'binding': {'operatorSha256': 'owned-operator', 'metadataFixedComparison': {'captureOnly': True}, 'afterLoginCatalog': catalog()}}
        proof = types.SimpleNamespace(PEERS=peers, RELEASE=p.RELEASE, IDENTITY=p.IDENTITY)
        context = types.SimpleNamespace(inputs={'cachePreparedSha256': 'cache-proof'}, cache=types.SimpleNamespace(BASE=cache),
            scope=lambda enabled: {'ownRolesOnly': True}, accepted_source_closure=lambda: {'sameArtifact': True},
            metadata_comparison=lambda: {'captureOnly': True}, metadata=lambda: {'currentNativeMetadataQualified': True},
            sessions=lambda actor, role: {'owned': [], 'kernelPeerAttribution': True})
        with patch.object(m, 'load_proof', return_value=proof), patch.object(m, 'published', return_value=(op, {}, {})), \
             patch.object(m, 'reader_leaf_context', return_value=context), patch.object(m, 'owned_reader', side_effect=lambda c, o, name: actors[name]), \
             patch.object(m, 'reader_boot', side_effect=lambda p, name: boots[name]), patch.object(m, 'current_published'), patch.object(m, 'original_inputs'), \
             patch.object(m, 'current_context', side_effect=AssertionError('old composite must not run in phase leaf')), \
             patch.object(m, 'separate_witnesses', side_effect=AssertionError('old observer must not run in phase leaf')):
            value = m.validate_reader_leaf(result_sha, manifest_sha)
        self.assertEqual(value['recordedRead143AndCache4Catalog']['jsonPointer'], '/postProof/catalog')
        self.assertEqual(value['recordedRead143Cache4AndTwoLOGINCatalog']['jsonPointer'], '/after')
        self.assertEqual(value['readerSessions']['main']['owned'], [])
        for key in ('sourceActorQualified', 'sourceReadinessQualified', 'observerAuthorityQualified', 'financialAuthorityQualified',
                    'fullGlobalRoleGraphQualified', 'cacheActorQualified', 'originalWholeValidatorsPassed', 'laterGenerationLineageOr24HourRefreshQualified'):
            self.assertIs(value[key], False)

    def test_already_terminal_role_requires_actual_live_kernel_owners_for_every_remaining_backend(self):
        path = HERE.parent / 'booster-launch/ypal-old-runtime-inventory-v1.py'
        spec = importlib.util.spec_from_file_location('frozen_kernel_observer', path); observer = importlib.util.module_from_spec(spec); spec.loader.exec_module(observer)
        rows = [{'pid': 701, 'backendStart': 'actual-start', 'clientAddress': None, 'clientPort': -1}]
        unix = b'u_str ESTAB 0 0 * 101 * 202 users:(("node",pid=8,fd=4))\nu_str ESTAB 0 0 * 202 * 101 users:(("postgres",pid=701,fd=8))\n'
        def fds(pids, uid, gid):
            return {str(pid): {'startTicks': 77, 'socketInodes': [202 if pid == 701 else 101]} for pid in pids}
        fake = types.SimpleNamespace(peer_fds=fds, run=lambda args: unix if '-xHnp' in args else b'', unix_peers=observer.unix_peers,
            tcp_clients=observer.tcp_clients, map_owned_backends=observer.map_owned_backends)
        context = p.Context.__new__(p.Context); context.host = types.SimpleNamespace(h=types.SimpleNamespace(observer=fake)); context.query = lambda sql: rows
        def proc(pid):
            if pid == 44: raise FileNotFoundError('owned actor is gone')
            return {'pid': pid, 'startTicks': 77, 'parentPid': 1, 'bootId': p.boot()}
        actor = {'processes': [{'pid': 44, 'startTicks': 50}]}
        with patch.object(p, 'process', side_effect=proc), patch.object(p, 'proc_status', return_value={'uid': [0] * 4, 'gid': [0] * 4}):
            value = context.terminal_sessions(actor, '16388')
            self.assertEqual(value['owned'], []); self.assertEqual(value['otherLiveKernelPeers'][0]['pid'], 701)
            self.assertFalse(value['globalRoleZeroRequired'])
            fake.run = lambda args: b''
            with self.assertRaisesRegex(RuntimeError, 'unknown_or_orphan_terminal_role_backend'): context.terminal_sessions(actor, '16388')
        with patch.object(p, 'process', return_value={'pid': 44, 'startTicks': 50}):
            with self.assertRaisesRegex(RuntimeError, 'owned_terminal_actor_process'): context.terminal_sessions(actor, '16388')

    def test_already_failed_acknowledged_reader_is_reconciled_without_a_stop_request(self):
        root, base = self.filesystem(); actor = {'main': {'pid': 99, 'startTicks': 1}, 'unit': {'InvocationID': 'owned'}}
        context = types.SimpleNamespace(proof=types.SimpleNamespace(PEERS={'main': {'unit': 'yunipals-api.service'}}),
            state=lambda unit: {'MainPID': '0'}, drained=lambda *args: {'terminal': True})
        with patch.object(m, 'public_input', return_value=b'owned operation'), patch.object(m, 'terminal_owned_reader', return_value=(actor, {'owned': [], 'alreadyTerminal': True})), patch.object(m, 'manager') as manager:
            result = m.stop_reader(context, {}, 'main')
            self.assertTrue(result['alreadyTerminalNoStopDispatched']); manager.assert_not_called()
        self.assertTrue((base / 'reader-main-stopped.json').exists())


if __name__ == '__main__': unittest.main()
