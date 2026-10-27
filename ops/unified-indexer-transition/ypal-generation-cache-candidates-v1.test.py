import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

m = load('ypal-generation-cache-candidates-v1')
meta = load('ypal-native-metadata-candidates-v1')
retained = load('retained-workers-stage-v1')


def selector(unit):
    value = dict(retained.PUBLIC)
    value['READ_DATABASE_SCHEMA'] = value['OWNERSHIP_READ_SCHEMA'] = meta.OLD_READ
    if unit == m.CACHE:
        del value['UNIFIED_INDEXER_RELEASE_ID']
        value.update(OFFCHAIN_DB_POOL_MAX='2', API_DB_POOL_MAX='2')
    return value


def payload():
    files = {}
    for unit, name in m.SELECTORS.items():
        files[name] = retained.env_bytes(selector(unit))
        entry = 'lib/leaderboard/worker.ts' if unit == m.LEADERBOARD else 'lib/metadata/read-cache-worker.ts'
        private = ['/etc/yunipals-indexer/read-cache.env', '/etc/yunipals-unified/consumers/yunipals-read-cache.database.env'] if unit == m.CACHE else retained.ENV_FILES[unit]
        files[unit + '.drop-in.candidate'] = ('[Service]\n' + ''.join('EnvironmentFile=' + p + '\n' for p in private) +
            'EnvironmentFile=' + str(meta.PREVIOUS / name) + '\nExecStart=\nExecStart=' + retained.NODE + ' --import tsx ' + str(retained.PROJECT / entry) + '\n').encode()
    return files


def facts():
    return {'generation': {'id': '103', 'state': 'ready', 'release': None, 'identity': None},
        'guards': [{'collection': str(i % 4), 'relation': 'r' + str(i), 'oid': str(i + 1),
                    'schema': 'bnb_indexer' if i < 12 else 'metadata'} for i in range(35)],
        'epochCount': 4,
        'cacheRole': {'name': 'yunipals_unified_read_cache', 'oid': '73187673', 'login': False, 'limit': 6,
                      'super': False, 'createDb': False, 'createRole': False, 'replication': False, 'bypassRls': False}}


class Controls(unittest.TestCase):
    def test_generation_five_and_cache_four_exact_public_repins(self):
        for unit, count in [(m.LEADERBOARD, 5), (m.CACHE, 4)]:
            before = selector(unit); after = m.retarget(meta, unit, before)
            self.assertEqual(sum(before[k] != after[k] for k in before), count)
            self.assertEqual(after['DATABASE_SCHEMA'], meta.PHYSICAL)
            self.assertEqual(after['OWNERSHIP_RELEASE_ID'], meta.RELEASE)
            self.assertEqual(after['READ_DATABASE_SCHEMA'], meta.READ)
            self.assertEqual(set(before), set(after))
        self.assertNotIn('UNIFIED_INDEXER_RELEASE_ID', m.retarget(meta, m.CACHE, selector(m.CACHE)))

    def test_wrong_old_selectors_modes_secret_or_rpc_refuse(self):
        for unit in m.SELECTORS:
            before = selector(unit)
            for key in ['DATABASE_SCHEMA', 'OWNERSHIP_READ_SCHEMA', 'READ_DATABASE_SCHEMA', 'OWNERSHIP_RELEASE_ID']:
                with self.subTest(unit=unit,key=key), self.assertRaisesRegex(RuntimeError, 'exact_old_generation_cache_selector'):
                    m.retarget(meta, unit, {**before, key: 'foreign'})
            with self.assertRaisesRegex(RuntimeError, 'retained_generation_cache_modes'):
                m.retarget(meta, unit, {**before, 'BASE_METADATA_INGESTION': 'rpc'})
            for key in ['DATABASE_URL', 'UNIFIED_INDEXER_DATABASE_URL', 'PONDER_RPC_URL_8453']:
                with self.assertRaisesRegex(RuntimeError, 'public_selectors_without_new_credentials_or_rpc'):
                    m.retarget(meta, unit, {**before, key: 'synthetic'})

    def test_render_changes_only_public_values_and_one_selector_path(self):
        before = payload()
        with patch.object(retained, 'node_roundtrip') as roundtrip:
            after = m.render(meta, retained, before); self.assertEqual(roundtrip.call_count, 2)
        self.assertEqual(set(after), set(m.FILES))
        for unit, name in m.SELECTORS.items():
            drop = unit + '.drop-in.candidate'
            self.assertEqual(after[drop].replace(str(m.BASE/name).encode(), str(meta.PREVIOUS/name).encode()), before[drop])
            original = retained.parse_env(before[name]); changed = retained.parse_env(after[name])
            self.assertEqual(original.get('OFFCHAIN_DB_POOL_MAX'), changed.get('OFFCHAIN_DB_POOL_MAX'))
            self.assertEqual(original.get('API_DB_POOL_MAX'), changed.get('API_DB_POOL_MAX'))
            self.assertNotIn(b'DATABASE_URL=', after[name])
            self.assertIn(str(retained.PROJECT).encode(), after[drop])
            self.assertNotIn(b'/cf333', after[drop])

    def test_extra_public_key_wrong_executable_or_path_count_refuse(self):
        for kind in ['extra', 'exec', 'path']:
            files = payload(); name = m.SELECTORS[m.CACHE]; drop = m.CACHE + '.drop-in.candidate'
            if kind == 'extra': files[name] += b"UNEXPECTED='true'\n"
            if kind == 'exec': files[drop] = files[drop].replace(b'read-cache-worker.ts', b'foreign.ts')
            if kind == 'path': files[drop] += ('EnvironmentFile=' + str(meta.PREVIOUS/name) + '\n').encode()
            with patch.object(retained, 'node_roundtrip'), self.assertRaises(RuntimeError):m.render(meta, retained, files)

    def test_generation103_null_identity_and_all35_guards_stay_legacy(self):
        value = facts(); self.assertEqual(m.legacy_facts(value)['generation'], value['generation'])
        for key, wrong in [('id', '104'), ('release', meta.RELEASE), ('identity', meta.IDENTITY), ('state', 'building')]:
            changed = facts(); changed['generation'][key] = wrong
            with self.assertRaisesRegex(RuntimeError, 'historical_generation103'):m.legacy_facts(changed)
        changed = facts(); changed['guards'][0]['schema'] = meta.PHYSICAL
        with self.assertRaisesRegex(RuntimeError, 'unchanged_legacy35_guard'):m.legacy_facts(changed)

    def test_cache_role_login_or_extra_privilege_or_wrong_graph_refuse(self):
        for key in ['login','super','createRole','createDb','replication','bypassRls']:
            value = facts(); value['cacheRole'][key] = True
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'same_dormant_restricted_cache_role'):m.legacy_facts(value)
        for change in ['missing','epoch','oid']:
            value = facts()
            if change == 'missing': value['guards'].pop()
            if change == 'epoch': value['epochCount'] = 5
            if change == 'oid': value['cacheRole']['oid'] = '999'
            with self.assertRaises(RuntimeError):m.legacy_facts(value)

    def test_same_actual_metadata_producer_and_runtime_closure(self):
        import hashlib
        self.assertEqual(hashlib.sha256((HERE/'ypal-native-metadata-candidates-v1.py').read_bytes()).hexdigest(), m.META_SHA)
        self.assertEqual(meta.READ_RESULT_SHA, '17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3')
        self.assertEqual(len(m.CLOSURE), 13)
        self.assertIn('scripts/refresh-leaderboard.ts', m.CLOSURE)
        self.assertIn('scripts/migrate-read-cache.ts', m.CLOSURE)
        self.assertIn('lib/metadata/read-cache-worker.ts', m.CLOSURE)

    def test_no_generation_guard_service_or_provider_execution_mode(self):
        text = (HERE/'ypal-generation-cache-candidates-v1.py').read_text()
        self.assertNotIn("add_argument('--apply'", text)
        self.assertNotIn('Popen(', text); self.assertNotIn('manager(', text)
        sql = m.context_sql(meta)
        self.assertTrue(sql.startswith('SELECT '))
        self.assertNotRegex(sql, r'\b(?:INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE|DROP)\b')
        self.assertIn('systemctl\', \'show\'', text)

    def test_real_filesystem_stage_exclusive_and_no_reuse(self):
        class S:
            def sync(self, path):pass
            def protected(self, path):return path.read_bytes()
            def save(self, path, value, mode=0o600):
                import os
                raw = value if isinstance(value, bytes) else m.encoded(value)
                fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
                with os.fdopen(fd,'wb') as out:out.write(raw)
                return m.sha(raw)
        binding={'format':m.FORMAT}; files={name:b'public fixture' for name in m.FILES}
        with tempfile.TemporaryDirectory() as tmp, patch.object(m,'BASE',Path(tmp)/'owned'):
            with patch.object(m,'prepare',return_value=(S(),binding,{},files)):
                result=m.stage(S(),binding,files)
            self.assertEqual(m.sha((m.BASE/'result.json').read_bytes()),result)
            self.assertEqual(len(list(m.BASE.iterdir())),6)
            with self.assertRaises(FileExistsError):m.stage(S(),binding,files)

    def test_changed_input_after_staging_has_no_success_receipt(self):
        class S:
            def sync(self,path):pass
            def save(self,path,value,mode=0o600):
                with path.open('xb') as f:f.write(value if isinstance(value,bytes) else m.encoded(value))
            def protected(self,path):return path.read_bytes()
        with tempfile.TemporaryDirectory() as tmp, patch.object(m,'BASE',Path(tmp)/'owned'):
            with patch.object(m,'prepare',return_value=(S(),{'changed':True},{},{})), self.assertRaisesRegex(RuntimeError,'inputs_changed_during_dormant_stage'):
                m.stage(S(),{'format':m.FORMAT},{name:b'public' for name in m.FILES})
            self.assertTrue((m.BASE/'intent.json').exists()); self.assertFalse((m.BASE/'result.json').exists())


if __name__ == '__main__': unittest.main()
