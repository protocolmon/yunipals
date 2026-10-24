"""Synthetic owner controls. No production, DB, manager, provider or role calls."""
import copy
import hashlib
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
spec = importlib.util.spec_from_file_location('cache_owner', HERE / 'ypal-cache-guard-owner-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def plan():
    grants = [{'name': name, 'role': m.COLLECTOR, 'grantee': m.COLLECTOR_OID, 'grantor': '10',
               'privilege': 'SELECT', 'grantable': False} for name in m.CACHE_TABLES]
    return {'addedSelects': grants, 'before': {'acl': []},
            'after': {'tables': [{'name': name, 'oid': str(100 + i)} for i, name in enumerate(m.CACHE_TABLES)]}}


def catalogs():
    before = {'roles': [{'name': m.COLLECTOR, 'login': True, 'limit': 6}], 'functions': [], 'schemas': [],
              'relations': [{'schema': 'metadata_projection', 'name': n.split('.')[1], 'acl': 'old'} for n in m.CACHE_TABLES],
              'effective': [{'role': m.COLLECTOR, 'relations': {n: {'select': False, 'writes': False} for n in m.CACHE_TABLES}}],
              'directRoleEdges': [], 'nativeMetadataAdoptions': 0, 'activeRelease': []}
    after = copy.deepcopy(before)
    for i, row in enumerate(after['relations']): row['acl'] = 'old+SELECT'
    for n in m.CACHE_TABLES: after['effective'][0]['relations'][n]['select'] = True
    for i, name in enumerate(m.CACHE_TABLES):
        after['directRoleEdges'].append({'kind': 'relation', 'object': str(100 + i), 'object_name': name,
            'grantee': m.COLLECTOR_OID, 'grantor': '10', 'privilege': 'SELECT', 'grantable': False, 'column_number': None})
    return before, after


class Tests(unittest.TestCase):
    def test_exact_four_scope_is_independent_of_original_143(self):
        actual = plan(); m.exact_four(actual)
        for edit in [lambda v: v['addedSelects'].append(v['addedSelects'][0]),
                     lambda v: v['addedSelects'][0].update(privilege='UPDATE'),
                     lambda v: v['addedSelects'][0].update(grantee='0'),
                     lambda v: v['addedSelects'][0].update(grantable=True)]:
            bad = copy.deepcopy(actual); edit(bad)
            with self.assertRaises(RuntimeError): m.exact_four(bad)

    def test_complete_read_graph_retains_login_writes_all_other_roles_and_column_acl(self):
        before, after = catalogs(); m.read_extension(before, after, plan(), after)
        for edit in [lambda v: v['roles'][0].update(login=False),
                     lambda v: v['roles'][0].update(limit=-1),
                     lambda v: v['effective'][0]['relations'][m.CACHE_TABLES[0]].update(writes=True),
                     lambda v: v['directRoleEdges'].append({'kind': 'column', 'object': '100', 'object_name': m.CACHE_TABLES[0],
                         'grantee': m.COLLECTOR_OID, 'grantor': '10', 'privilege': 'SELECT', 'grantable': False, 'column_number': 1})]:
            bad = copy.deepcopy(after); edit(bad)
            with self.assertRaises(RuntimeError): m.read_extension(before, bad, plan(), after)

    def test_unmanaged_foreign_cache_grant_refuses_against_complete_acknowledged_ACL(self):
        before, acknowledged = catalogs()
        # This grantee is outside the admission catalogue's managed roles and
        # leaves their direct/effective permission arrays unchanged.
        current = copy.deepcopy(acknowledged)
        current['relations'][0]['acl'] += '+foreign_unmanaged_role_SELECT'
        with self.assertRaisesRegex(RuntimeError, 'acknowledged_cache_relation_ACLs'):
            m.read_extension(before, current, plan(), acknowledged)
        self.assertEqual(current['directRoleEdges'], acknowledged['directRoleEdges'])
        self.assertEqual(current['effective'], acknowledged['effective'])
        m.read_extension(before, acknowledged, plan(), copy.deepcopy(acknowledged))

    def test_preservation_scope_does_not_mutate_or_claim_143_grant_authority(self):
        original = {'format': 'owned143', 'missingCount': 143, 'missingPermissions': [{'role': 'synthetic_original'}]}
        saved = copy.deepcopy(original); combined = m.extended_plan(original, plan())
        self.assertEqual(original, saved); self.assertNotEqual(combined['format'], original['format'])
        self.assertEqual(combined['missingCount'], 5); self.assertFalse(combined['readGrantAuthorityClaimed'])
        self.assertEqual(combined['original143PlanSha256'], m.sha(m.encoded(original)))

    def test_candidate_leaf_is_exact_and_unfrozen_coordinator_is_closed(self):
        self.assertEqual(m.GENERATION_OWNER_SHA, '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6')
        self.assertIsNone(m.COORDINATED_OWNER_SHA)
        with self.assertRaisesRegex(RuntimeError, 'not_yet_frozen'): m.module('/never/read', None)

    def test_old_cache_private_change_refuses_before_same_pid_capture(self):
        with tempfile.TemporaryDirectory() as temporary:
            p = Path(temporary) / 'original.env'; p.write_bytes(b'synthetic=one\n')
            host = m.Host.__new__(m.Host); host.candidate = {'originalCacheWriter': {'inputHashes': {str(p): m.sha(p.read_bytes())}, 'managerEnvironmentHashes': {}}}
            host.m = types.SimpleNamespace(); p.write_bytes(b'synthetic=two\n')
            with patch.object(m, 'protected', side_effect=lambda name, cap=0: Path(name).read_bytes()):
                with self.assertRaisesRegex(RuntimeError, 'private_file_or_definition'): host.actor()

    def test_metadata_leaf_keeps_actual_actor_and_provenance_under_explicit_read_scope(self):
        state = {'actor': {'pid': 10, 'definitions': 'same', 'private': 'same'}, 'scan': 'native', 'remaining': 0,
                 'canonical': True, 'captures': 0, 'changeAfterDB': False, 'refreshes': 0}
        class MetadataHost:
            def actor(self, op, native):
                self_test.assertEqual(op, {'actual': 'owned-operation'}); self_test.assertTrue(native)
                state['captures'] += 1
                return {**state['actor'], **({'private': 'changed'} if state['changeAfterDB'] and state['captures'] > 1 else {})}
            def database(self): return {'probe': True, 'scan': {'ingestion_mode': state['scan']}, 'remainingPublished': state['remaining']}
            def publication_proof(self): return {'allPublishedCanonical': state['canonical'], 'officialSqlSha256': 'fixed-official-sql'}
        self_test = self; candidate = {'staged': True, 'selected': False, 'adopted': False, 'readviewResultSha256': 'actual-created', 'files': {}}
        meta = types.SimpleNamespace(READ_RESULT_SHA='actual-created', load=lambda pin: (None,) * 8)
        def operation(context, pin):
            self.assertEqual(pin, 'actual-operation-sha'); context.refresh(); return {'actual': 'owned-operation'}
        owner = types.SimpleNamespace(Host=MetadataHost, META_FILE=Path('/fixed/metadata-candidate.py'), META_SHA='fixed',
            CANDIDATES=Path('/fixed/candidates'), CANDIDATE_SHA='actual-candidate', operation=operation,
            BOOT=Path('/fixed/boot'), link=lambda path: {'inode': 77})
        host = m.Host.__new__(m.Host); host.config = {'readAdmissionSha256': 'owned143'}
        def refresh(): state['refreshes'] += 1; return {'separateFourReadsAcknowledged': True, 'original143WholeValidatorPassed': False}
        host.refresh = refresh
        generation = {'metadataOperationSha256': 'actual-operation-sha'}; selection = {'nativeActor': state['actor'], 'boot': {'inode': 77}}
        with patch.object(m, 'module', side_effect=lambda path, pin: owner if path == m.META_OWNER else meta), patch.object(m, 'document', return_value=candidate):
            proof = host.metadata_current(generation, selection)
            self.assertTrue(proof['currentNativeMetadataQualified']); self.assertFalse(proof['original143WholeValidatorPassed'])
            self.assertEqual(state['refreshes'], 2)
            for key, value in [('remaining', 1), ('scan', 'rpc'), ('canonical', False), ('changeAfterDB', True)]:
                original = state[key]; state[key] = value; state['captures'] = 0
                with self.assertRaises(RuntimeError): host.metadata_current(generation, selection)
                state[key] = original

    def test_current_official_worker_bytes_are_rechecked_before_read_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); worker = root / 'lib/metadata/read-cache-worker.ts'; worker.parent.mkdir(parents=True)
            worker.write_bytes(b'accepted public worker')
            host = m.Host.__new__(m.Host); host.candidate_owner = types.SimpleNamespace(CLOSURE=('lib/metadata/read-cache-worker.ts',))
            host.candidate = {'files': {}, 'officialSourceClosure': [{'path': 'lib/metadata/read-cache-worker.ts', 'bytes': worker.stat().st_size, 'sha256': m.sha(worker.read_bytes())}]}
            host.config = {'readAdmissionSha256': 'actual-read-ack'}; calls = []
            host.read = types.SimpleNamespace(validate_current=lambda pin: calls.append(pin) or {'validated': True})
            with patch.object(m, 'PROJECT', root), patch.object(m, 'BASE', root / 'unstarted'), patch.object(m, 'protected', side_effect=lambda p, cap=0: Path(p).read_bytes()):
                self.assertTrue(host.refresh()['validated']); self.assertEqual(len(calls), 1)
                worker.write_bytes(b'altered public worker!')
                with self.assertRaisesRegex(RuntimeError, 'unchanged_accepted_official'): host.refresh()
                self.assertEqual(len(calls), 1)

    def test_only_fixed_gets_and_actual_readiness_nonempty_rarity(self):
        class Response:
            status = 200
            def __init__(self, body): self.body = m.encoded(body)
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, cap): return self.body[:cap]
        response = Response({'status': 'ready'})
        def open_request(request, timeout):
            self.assertEqual(request.get_method(), 'GET'); self.assertEqual(timeout, 4)
            self.assertTrue(request.full_url.startswith('http://127.0.0.1:9011/')); return response
        opener = types.SimpleNamespace(open=open_request)
        with patch.object(m.urllib.request, 'build_opener', return_value=opener):
            self.assertTrue(m.public_get('/ready')['ready'])
            response = Response({'items': [{'rarityPointsCapped': '9'}, {'rarityPointsCapped': '3'}]})
            path = '/v1/tokens?chain=base&limit=2&metadata=all&sort=rarity-capped-desc'
            proof = m.public_get(path); self.assertTrue(proof['nonempty']); self.assertNotIn('itemsRaw', proof)
            response = Response({'items': []})
            with self.assertRaisesRegex(RuntimeError, 'nonempty'): m.public_get(path)
            response = Response({'items': [{'rarityPointsCapped': 1}, {'rarityPointsCapped': 2}]})
            with self.assertRaisesRegex(RuntimeError, 'rarity_sort'): m.public_get(path)
            response = Response({'items': [{'rarityPointsCapped': None}, {'rarityPointsCapped': '2'}]})
            with self.assertRaisesRegex(RuntimeError, 'rarity_values'): m.public_get(path)
            ordinary = m.public_get('/v1/tokens?chain=base&limit=2&metadata=all&sort=token-id-asc')
            self.assertTrue(ordinary['nonempty']); self.assertFalse(ordinary['rarityPresent'])
            for path in ['https://elsewhere/', '/v1/tokens?owner=foreign', '/v1/tokens?chain=base&limit=100', '/v1/visibility']:
                with self.assertRaisesRegex(RuntimeError, 'only_fixed'): m.public_get(path)

    def test_legacy_http_needs_103_and_direct_fallback_not_actor_claim(self):
        value = {'id': '103', 'state': 'ready', 'release': None, 'identity': None, 'freshSets': 0}
        frame = {'yunipals-api.service': {'state': {'ActiveState': 'active', 'MainPID': '42'}}}
        host = types.SimpleNamespace(read=types.SimpleNamespace(consumer_frame=lambda _: frame), h=None,
            m=types.SimpleNamespace(process_env=lambda _: {'YUNIPALS_PROJECTION_MODE':'generation','METADATA_SOURCE_MODE':'archive','RARITY_READ_SOURCE':'local','YUNIPALS_READ_CACHE':'1'}),
            query=lambda _: copy.deepcopy(value))
        with patch.object(m, 'public_get', side_effect=lambda path: {'path': path, 'status': 200, 'nonempty': True}):
            result = m.legacy_http(host, True); self.assertTrue(result['directFallbackProven']); self.assertEqual(len(result['samples']), 9)
            value['freshSets'] = 1
            with self.assertRaisesRegex(RuntimeError, 'direct_fallback'): m.legacy_http(host, True)
            value.update(freshSets=0, id='104', release=m.RELEASE, identity=m.IDENTITY)
            with self.assertRaisesRegex(RuntimeError, 'unlabelled_legacy103'): m.legacy_http(host, True)

    def protocol(self, lost=False):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup); directory = Path(temporary.name)
        sql = directory / 'catalog.sql'; sql.write_text('synthetic SQL;')
        script = directory / 'child.py'; intent = directory / 'durable-intent.json'
        script.write_text("""import json,sys,os
request=json.loads(sys.stdin.readline());assert request['planJson']=='{\"synthetic\":true}'
print(json.dumps({'event':'transaction-opened','format':'yunipals-ypal-cache-guard-sql-v1','mode':'apply','xid':'900','backend':{'pid':9,'backendStart':'123','roleOid':'10','databaseOid':'17584','xid':'900'}}),flush=True)
opened=json.loads(sys.stdin.readline());assert opened['event']=='transaction-opened-recorded' and opened['xid']=='900'
message={'event':'commit-prepared','xid':'900','format':'synthetic','mode':'apply'}
print(json.dumps(message),flush=True)
reply=json.loads(sys.stdin.readline());assert reply['event']=='commit-authorized' and reply['xid']=='900'
assert os.path.exists(sys.argv[1])
if sys.argv[2]=='lost':sys.exit(1)
print(json.dumps({'event':'result','value':{'format':'yunipals-ypal-cache-guard-sql-v1','acknowledged':True,'mode':'apply','xid':'900','result':{'synthetic':True},'resultJson':'{\"synthetic\":true}'}}),flush=True)
""")
        original = subprocess.Popen; calls = []
        def spawn(args, **kwargs):
            calls.append(args); self.assertIn('--reuid=111', args); self.assertIn('--pdeathsig=KILL', args)
            self.assertFalse(any('DATABASE_URL' in a or 'PGPASSWORD' in a for a in args))
            return original([sys.executable, '-B', str(script), str(intent), 'lost' if lost else 'pass'], **kwargs)
        host = types.SimpleNamespace(read=types.SimpleNamespace(SQL=sql), reader_sql='synthetic reader',
            m=types.SimpleNamespace(process=lambda pid: {'pid': int(pid), 'startTicks': 1}),
            sql_session=lambda actor, backend, xid: [{'pid': 9, 'backendStart': '123'}])
        self.enterContext(patch.object(m, 'BASE', directory)); self.enterContext(patch.object(m, 'PROJECT', directory))
        self.enterContext(patch.object(m, 'protected', side_effect=lambda name, cap=0: Path(name).read_bytes()))
        self.enterContext(patch.object(m.subprocess, 'Popen', side_effect=spawn))
        def prepared(message):
            self.assertEqual(message['xid'], '900'); m.save(intent.name, {'prepared': True})
        return host, prepared, calls, directory

    def test_real_pipe_requires_root_fsynced_intent_before_child_commit_ack(self):
        host, prepared, calls, directory = self.protocol()
        result = m.sql_child(host, 'apply', {'synthetic': True}, prepared, plan_json='{"synthetic":true}')
        self.assertTrue(result['acknowledged']); self.assertEqual(len(calls), 1)
        self.assertTrue((directory / 'apply-sql-child.json').exists()); self.assertTrue((directory / 'durable-intent.json').exists())

    def test_lost_child_ack_preserves_intent_never_restarts_or_claims_success(self):
        host, prepared, calls, directory = self.protocol(True)
        with self.assertRaises(RuntimeError): m.sql_child(host, 'apply', {'synthetic': True}, prepared, plan_json='{"synthetic":true}')
        self.assertEqual(len(calls), 1); self.assertTrue((directory / 'durable-intent.json').exists())
        self.assertFalse((directory / 'sql-committed.json').exists())

    def test_stop_actor_CAS_after_fsynced_intent_prevents_foreign_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / 'operation'; base.mkdir(mode=0o700)
            boot = root / 'boot'; boot.symlink_to('/etc/systemd/system/' + m.UNIT)
            actor = {'main': {'pid': 1111, 'startTicks': 100}, 'processes': [{'pid': 1111, 'startTicks': 100}]}
            before = {'binding': {'boot': m.inode(boot, True), 'prerequisites': {'candidate': 'unpublished'}, 'originalActor': actor}, 'reviewHash': 'review'}
            rehearsed = {'additionalReadDeltaSha256': 'four'}; observed = []
            def current_actor():
                if (base / 'stop-intent.json').exists(): return {**actor, 'main': {'pid': 2222, 'startTicks': 200}}
                return actor
            host = types.SimpleNamespace(config={'readAdmissionSha256': 'synthetic'}, refresh=lambda: None, prerequisites=lambda: {'candidate': 'unpublished'},
                actor=current_actor, sessions=lambda _: {'owned': [{'pid': 600, 'backendStart': 'synthetic'}]})
            with (patch.object(m, 'BASE', base), patch.object(m, 'BOOT', boot), patch.object(m, 'owned', return_value=(before, rehearsed)),
                  patch.object(m, 'manager', side_effect=lambda action: observed.append(action) or {'acknowledged': True})):
                with self.assertRaisesRegex(RuntimeError, 'after_fsynced_stop'): m.drain(host, 'review', 'four')
            self.assertEqual(observed, ['daemon-reload']); self.assertTrue((base / 'stop-intent.json').exists())
            self.assertTrue((base / 'original-boot-link').is_symlink())

    def reconcile_context(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup); base = Path(temporary.name)
        for name in ['rehearsed.json', 'authorization.json']: (base / name).write_bytes(b'{}\n')
        before = {'reviewHash': 'review'}; rehearsal = {'sql': {'resultJson': '{}', 'result': {}}}
        intent = {'format': m.FORMAT, 'bootId': 'boot', 'reviewHash': 'review',
                  'rehearsalSha256': m.sha((base / 'rehearsed.json').read_bytes()), 'authorizationSha256': m.sha((base / 'authorization.json').read_bytes())}
        prepared = {'format': 'yunipals-ypal-cache-guard-sql-v1', 'event': 'commit-prepared', 'mode': 'apply',
                    'planSha256': m.sha(b'{}'), 'xid': '100', 'afterCatalogSha256': 'expected'}
        (base / 'sql-intent.json').write_bytes(m.encoded(intent)); (base / 'sql-prepared.json').write_bytes(m.encoded(prepared))
        self.enterContext(patch.object(m, 'BASE', base)); self.enterContext(patch.object(m, 'boot', return_value='boot'))
        self.enterContext(patch.object(m, 'protected', side_effect=lambda path, cap=0: Path(path).read_bytes()))
        self.enterContext(patch.object(m, 'stopped', return_value=(before, rehearsal, {})))
        return base

    def test_unknown_or_aborted_XID_cannot_fabricate_commit_or_repeat_SQL(self):
        base = self.reconcile_context()
        with patch.object(m, 'sql_child', side_effect=AssertionError('no_child_before_committed_XID')), patch.object(m, 'manager', side_effect=AssertionError('no_service_action')):
            for value in ['in progress', 'aborted', None]:
                host = types.SimpleNamespace(query=lambda sql: 0 if 'application_name' in sql else value)
                with self.assertRaisesRegex(RuntimeError, 'not_proven'): m.reconcile_commit(host)
        self.assertFalse((base / 'sql-committed.json').exists())

    def test_committed_XID_with_foreign_postcatalog_refuses_readonly(self):
        base = self.reconcile_context(); calls = []
        host = types.SimpleNamespace(query=lambda sql: 0 if 'application_name' in sql else 'committed')
        with patch.object(m, 'sql_child', side_effect=lambda h, mode: calls.append(mode) or {'catalogSha256': 'foreign'}), patch.object(m, 'manager', side_effect=AssertionError('no_service_action')):
            with self.assertRaisesRegex(RuntimeError, 'exact_committed'): m.reconcile_commit(host)
        self.assertEqual(calls, ['inspect']); self.assertFalse((base / 'sql-committed.json').exists())

    def test_failed_preparation_HTTP_never_starts_worker_or_acknowledges_serving(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); before = {'binding': {'prerequisites': {'gen': 'unpublished'}, 'consumerFrame': {'main': 'same'}}}
            host = types.SimpleNamespace(prerequisites=lambda: {'gen': 'unpublished'}, read=types.SimpleNamespace(consumer_frame=lambda _: {'main': 'same'}), h=None)
            with (patch.object(m, 'BASE', base), patch.object(m, 'stopped', return_value=(before, {}, {})),
                 patch.object(m, 'validate_reads', return_value={'preservation': {}}),
                 patch.object(m, 'legacy_http', side_effect=RuntimeError('actual_nonempty_legacy_collection_required')),
                 patch.object(m, 'manager', side_effect=AssertionError('no_automatic_start_or_stop'))):
                with self.assertRaisesRegex(RuntimeError, 'nonempty'): m.prepare_ack(host)
            self.assertFalse((base / 'prepared.json').exists()); self.assertFalse((base / 'native-start-intent.json').exists())

    def test_real_owned_publication_resumes_lost_link_or_file_ACK_without_overwrite(self):
        for prefix in ['before_link', 'after_link', 'after_unlink']:
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); base = root / 'operation'; base.mkdir(mode=0o700)
                candidates = root / 'candidates'; candidates.mkdir(); raw = b'[Service]\n# synthetic public paths only\n'
                candidate = candidates / (m.UNIT + '.drop-in.candidate'); candidate.write_bytes(raw)
                drop = root / 'unit.d/cache.conf'; host = types.SimpleNamespace(candidate={'files': {m.UNIT + '.drop-in.candidate': m.sha(raw)}})
                original_link, original_unlink, original_save = os.link, Path.unlink, m.save
                link_calls = []
                def link(a, b):
                    link_calls.append((a, b))
                    if prefix == 'before_link' and len(link_calls) == 1: raise RuntimeError('injected_before_link')
                    return original_link(a, b)
                failed = []
                def unlink(path, *args, **kwargs):
                    if prefix == 'after_link' and path.name == 'worker-drop.staged' and not failed:
                        failed.append(True); raise RuntimeError('injected_after_link')
                    return original_unlink(path, *args, **kwargs)
                def save(name, value):
                    if prefix == 'after_unlink' and name == 'drop-published.json' and not failed:
                        failed.append(True); raise RuntimeError('injected_after_unlink')
                    return original_save(name, value)
                with (patch.object(m, 'BASE', base), patch.object(m, 'CANDIDATES', candidates), patch.object(m, 'DROP', drop),
                      patch.object(m, 'protected', side_effect=lambda path, cap=0: Path(path).read_bytes()), patch.object(m.os, 'link', side_effect=link),
                      patch.object(m.Path, 'unlink', new=unlink), patch.object(m, 'save', side_effect=save)):
                    with self.assertRaises(RuntimeError): m.publish_drop(host)
                    m.publish_drop(host); self.assertEqual(drop.read_bytes(), raw)
                    identity = m.document(base / 'drop-published.json'); self.assertEqual(m.inode(drop), identity)
                    self.assertEqual(drop.stat().st_nlink, 1); self.assertFalse((base / 'worker-drop.staged').exists())
                    self.assertEqual(len(link_calls), 2 if prefix == 'before_link' else 1)
                    m.publish_drop(host); self.assertEqual(m.inode(drop), identity)

    def test_only_owned_boot_activation_can_differ_after_lost_enable_ACK(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / 'operation'; base.mkdir(); boot = root / 'boot'; boot.symlink_to('/synthetic/original.service')
            expected = {'main': {'pid': 11, 'startTicks': 100}, 'unit': {'UnitFileState': 'disabled', 'WantedBy': '', 'InvocationID': 'owned'}, 'processes': []}
            actual = copy.deepcopy(expected); actual['unit'].update(UnitFileState='enabled', WantedBy='multi-user.target')
            with patch.object(m, 'BASE', base), patch.object(m, 'BOOT', boot), patch.object(m, 'protected', side_effect=lambda p, cap=0: Path(p).read_bytes()):
                m.save('boot-publish-intent.json', m.inode(boot, True))
                self.assertTrue(m.same_activation(actual, expected, 'boot-publish-intent.json'))
                foreign = copy.deepcopy(actual); foreign['main']['pid'] = 22
                self.assertFalse(m.same_activation(foreign, expected, 'boot-publish-intent.json'))
                boot.unlink(); boot.symlink_to('/synthetic/foreign.service')
                with self.assertRaisesRegex(RuntimeError, 'recorded_cache_boot'): m.same_activation(actual, expected, 'boot-publish-intent.json')

    def archive_context(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup); root = Path(temporary.name)
        base = root / 'operation'; base.mkdir(mode=0o700); boot = root / 'boot'; boot.symlink_to('/synthetic/original.service')
        self.enterContext(patch.object(m, 'BASE', base)); self.enterContext(patch.object(m, 'BOOT', boot))
        self.enterContext(patch.object(m, 'DROP', root / 'unpublished.conf')); self.enterContext(patch.object(m, 'boot', return_value='boot'))
        self.enterContext(patch.object(m, 'ENTRY_SHA', 'ab' * 32))
        self.enterContext(patch.object(m, 'protected', side_effect=lambda p, cap=0: Path(p).read_bytes()))
        config = {'readAdmissionSha256': 'actual-synthetic'}; actor = {'main': {'pid': 123, 'startTicks': 10}}
        frame = {'main': 'same'}; epochs = [{'collection': c, 'revision': '9'} for c in ['base', 'bnb', 'ethereum', 'polygon']]
        proof = {'catalog': {'roles': [{'login': True}], 'columnACLs': []}, 'reader': {'edges': ['retained']}}
        binding = {'format': m.FORMAT, 'operatorSha256': m.sha(Path(m.__file__).read_bytes()), 'bootId': 'boot', 'config': config,
            'originalActor': actor, 'boot': m.inode(boot, True), 'consumerFrame': frame, 'catalogSha256': 'same-catalog'}
        before = {'binding': binding, 'reviewHash': m.sha(m.encoded(binding)), 'catalog': {'postProof': proof, 'state': {'epochs': epochs}}}
        m.save('before.json', before); m.save('rehearsal-intent.json', {'format': m.FORMAT, 'reviewHash': before['reviewHash'], 'bootId': 'boot', 'databaseCommitAllowed': False})
        child = {'bootId': 'boot', 'mode': 'rehearse', 'entrySha256': m.ENTRY_SHA, 'componentSha256': m.COMPONENT_SHA,
                 'actor': {'pid': 456, 'startTicks': 20}, 'processGroup': 456}
        m.save('rehearse-sql-child.json', child)
        message = {'format': 'yunipals-ypal-cache-guard-sql-v1', 'event': 'transaction-opened', 'mode': 'rehearse', 'xid': '900',
                   'backend': {'pid': 789, 'backendStart': '1000000'}}
        m.save('rehearse-sql-opened.json', {'message': message, 'sessions': [{'pid': 789, 'backendStart': '1000000'}],
              'childFileSha256': m.sha((base / 'rehearse-sql-child.json').read_bytes())})
        snapshot = {'catalogSha256': 'same-catalog', 'postProof': copy.deepcopy(proof), 'state': {'epochs': [{**e, 'revision': '12'} for e in epochs]}}
        state = {'status': 'aborted', 'actor': actor, 'peer': None}
        def query(sql):
            if 'pg_xact_status' in sql:
                self.assertTrue(sql.startswith('SELECT COALESCE(to_json(')); return state['status']
            if 'application_name' in sql: return 0
            return state['peer']
        def gone(_): raise FileNotFoundError()
        host = types.SimpleNamespace(config=config, h=None, read=types.SimpleNamespace(consumer_frame=lambda _: frame),
            m=types.SimpleNamespace(process=gone), query=query, refresh=lambda: None, actor=lambda: state['actor'])
        self.enterContext(patch.object(m, 'sql_child', side_effect=lambda h, mode: copy.deepcopy(snapshot)))
        self.enterContext(patch.object(m, 'manager', side_effect=AssertionError('archive_must_not_call_manager')))
        return host, base, state, snapshot

    def test_archive_real_exclusive_rename_preserves_all_evidence_and_monotonic_epochs(self):
        host, base, _, _ = self.archive_context()
        inventory = {p.name: m.inode(p) for p in base.iterdir()}
        reviewed = m.archive_review(host); result = m.archive_aborted(host, reviewed['reviewHash'])
        self.assertTrue(result['archived']); self.assertFalse(base.exists()); target = Path(result['target'])
        self.assertTrue(target.is_dir()); self.assertTrue((target / 'archive-result.json').exists())
        for name, identity in inventory.items(): self.assertEqual(m.inode(target / name), identity)
        self.assertEqual({e['revision'] for e in result['actualEpochs']['archiveEpochs']}, {'12'})
        self.assertFalse(result['databaseByteEqualityClaimed']); self.assertFalse(result['automaticRerunAllowed'])

    def test_archive_refuses_epoch_decrease_missing_or_extra_collection(self):
        host, base, _, snapshot = self.archive_context()
        original = copy.deepcopy(snapshot['state']['epochs'])
        for epochs in [[{**e, 'revision': '8'} for e in original], original[:-1], original + [{'collection': 'foreign', 'revision': '20'}]]:
            snapshot['state']['epochs'] = epochs
            with self.assertRaises(RuntimeError): m.archive_review(host)
            self.assertTrue(base.exists())

    def test_archive_refuses_acl_actor_live_peer_or_unknown_XID_and_mutation_intent(self):
        host, base, state, snapshot = self.archive_context()
        snapshot['postProof']['catalog']['roles'][0]['login'] = False
        with self.assertRaisesRegex(RuntimeError, 'column_ACLs'): m.archive_review(host)
        snapshot['postProof']['catalog']['roles'][0]['login'] = True
        original = state['actor']; state['actor'] = {'main': {'pid': 999, 'startTicks': 30}}
        with self.assertRaisesRegex(RuntimeError, 'actor_boot_private'): m.archive_review(host)
        state['actor'] = original; state['peer'] = {'pid': 789, 'backendStart': '1000000'}
        with self.assertRaisesRegex(RuntimeError, 'session_must_be_terminal'): m.archive_review(host)
        state['peer'] = None; state['status'] = 'in progress'
        with self.assertRaisesRegex(RuntimeError, 'must_be_aborted'): m.archive_review(host)
        state['status'] = 'aborted'; m.save('commit-intent.json', {'mustNotArchive': True})
        with self.assertRaisesRegex(RuntimeError, 'no_mutation_start_stop'): m.archive_review(host)
        self.assertTrue(base.exists())

    def test_archive_rename_never_overwrites_foreign_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / 'source'; target = root / 'foreign'; source.mkdir(); target.mkdir()
            (source / 'evidence').write_bytes(b'original'); (target / 'foreign').write_bytes(b'keep')
            with self.assertRaises(OSError): m.rename_exclusive(source, target)
            self.assertEqual((source / 'evidence').read_bytes(), b'original'); self.assertEqual((target / 'foreign').read_bytes(), b'keep')


if __name__ == '__main__': unittest.main()
