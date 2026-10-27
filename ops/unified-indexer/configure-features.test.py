#!/usr/bin/env python3
"""Filesystem/transport controls with explicit artifact and PG I/O fixtures."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
import subprocess
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('features', HERE / 'configure-features.py')
F = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(F)


class Controls(unittest.TestCase):
    def test_public_input_under_sticky_directory_still_requires_protected_file(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as directory:
            path = Path(directory) / 'public-proof.json'
            path.write_bytes(b'{}')
            self.assertEqual(F.read_public(path, F.sha(b'{}')), b'{}')
            path.chmod(0o666)
            with self.assertRaisesRegex(RuntimeError, 'protected input'):
                F.read_public(path)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE); self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def fixture(self):
        files, bodies, workers, pins, outputs = {}, {}, [], {}, []
        for index, unit in enumerate(F.ARENA_UNITS):
            name = ['arena-server.mjs', 'arena-native-disclosure.mjs', 'arena-native-client.mjs',
                    'arena-native-referee.mjs', 'arena-native-media.mjs', 'arena-native-execution.mjs',
                    'arena-native-execution.mjs', 'arena-capacity.mjs'][index]
            original = '/old/dist/' + name
            body = ('[Service]\nUser=yunipals-arena\nEnvironmentFile=/etc/retained-private.env\nExecStart=/usr/bin/env ARENA_INDEXER_RELEASE_ID=' + F.PREPARED_ARENA_RELEASE + ' ARENA_ENTRIES_ENABLED=false ARENA_NEW_LOBBIES_ENABLED=false ' + F.NODE + ' --no-warnings --env-file=/etc/retained-private.env ' + original + '\n[Install]\nWantedBy=multi-user.target\n').encode()
            bodies[unit] = body; pins[unit] = F.sha(body)
            files[str(F.WORK / 'native-units' / unit)] = body
            workers.append({'unit': unit, 'bundleRelative': original})
            artifact = ('// explicit installed-artifact I/O fixture ' + name).encode()
            files[str(F.ARENA_ROOT / 'dist' / name)] = artifact
            if not any(r['path'] == 'dist/' + name for r in outputs):
                outputs.append({'path': 'dist/' + name, 'sha256': F.sha(artifact), 'bytes': len(artifact)})
        files[str(F.PACKAGE / 'constructor-plan-20261023.json')] = F.encoded({'packageProofFile': '/fixture/proof.json'})
        files['/fixture/proof.json'] = F.encoded({'nativeUnits': {'files': pins}})
        files['/opt/yunipals-unified/operations/arena-consumer-package-20261021/proposal.v1.json'] = F.encoded({'workers': workers})
        files[str(F.ARENA_ROOT / 'manifest.json')] = F.encoded({'artifactDigest': F.ARENA_ROOT.name, 'nativeWorkerUnits': 8, 'files': outputs})
        worker = b'// explicit accepted metadata-worker fixture'
        files[str(F.PROJECT / 'lib/islands/worker.ts')] = worker
        files[str(F.PROJECT.parent.parent / 'RELEASE-MANIFEST.json')] = F.encoded({'files': [{'path': 'apps/yunipals-indexer/lib/islands/worker.ts', 'bytes': len(worker), 'sha256': F.sha(worker)}]})
        # Fixed historical receipt hashes are explicit protected-file fixtures;
        # generated current bundle/unit hashes are actually checked here.
        def read(path, expected=None):
            raw = files[str(path)]
            if '/native-units/' in str(path) or str(path).endswith('.mjs') or str(path).endswith('worker.ts'):
                if expected is not None: F.need(F.sha(raw) == expected, 'fixture source drift')
            return raw
        return files, bodies, read

    def test_real_configuration_only_changes_arena_entry_and_public_selectors(self):
        _, bodies, read = self.fixture()
        result = F.configuration(read)
        self.assertEqual(len(result), 13)
        for unit, before in bodies.items():
            after = result[str(F.SYSTEM / unit)]
            name = before.decode().split('ExecStart=')[1].splitlines()[0].split('/')[-1]
            expected = before
            if unit == 'yunipals-arena-native-api.service':
                expected = expected.replace(b' ARENA_ENTRIES_ENABLED=false', b'')
            if unit == 'yunipals-arena-native-execution@lobby.service':
                expected = expected.replace(b' ARENA_NEW_LOBBIES_ENABLED=false', b'')
            self.assertEqual(after.replace(str(F.ARENA_ROOT / 'dist' / name).encode(), ('/old/dist/' + name).encode()).replace(F.RELEASE.encode(), F.PREPARED_ARENA_RELEASE.encode()), expected)
            self.assertIn(('ARENA_INDEXER_RELEASE_ID=' + F.RELEASE).encode(), after)
            self.assertIn(b'EnvironmentFile=/etc/retained-private.env', after)
        self.assertEqual(result[str(F.PUBLIC / 'booster-native.public.env')], ('BOOSTER_DATABASE_SCHEMA=' + F.PHYSICAL + '\n').encode())

    def test_artifact_drift_refuses_configuration(self):
        files, _, read = self.fixture()
        files[str(F.ARENA_ROOT / 'dist/arena-server.mjs')] += b'changed'
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            F.configuration(read)

    def test_real_public_install_private_backup_and_stopped_gate(self):
        system = self.root / 'system'; system.mkdir()
        public = self.root / 'public'; public.mkdir()
        with patch.object(F, 'SYSTEM', system), patch.object(F, 'PUBLIC', public):
            _, _, read = self.fixture(); files = F.configuration(read)
            for name in files:
                p = Path(name); p.parent.mkdir(exist_ok=True); p.write_bytes(b'old public bytes')
            deploy = types.SimpleNamespace(run=Mock(return_value=b'MainPID=0\nControlPID=0\nActiveState=inactive\nJob=\n'),
                                           sync_directory=Mock())
            F.install(files, Mock(), self.root / 'backup', deploy)
            self.assertEqual({p: Path(p).read_bytes() for p in files}, files)
            self.assertEqual(len(list((self.root / 'backup').iterdir())), 13)
            deploy.run.return_value = b'MainPID=1\nControlPID=0\nActiveState=active\nJob=\n'
            with self.assertRaisesRegex(RuntimeError, 'stop feature'):
                F.install(files, Mock(), self.root / 'not-created', deploy)
            self.assertFalse((self.root / 'not-created').exists())

    def test_actual_arena_bodies_sealed_and_journal_exclusive(self):
        journal = self.root / 'arena.jsonl'
        source = HERE.parent / 'unified-indexer-transition'
        def read(path, expected=None):
            p = source / Path(path).name
            if p.exists():
                raw = p.read_bytes(); self.assertEqual(F.sha(raw), expected); return raw
            self.assertEqual(Path(path).name, 'operational-migrations.v1.json')
            return b'{"explicitMarkersFileIOFixture":true}'
        class Child:
            pid = 123; returncode = 0
            def communicate(child, data=None, timeout=None):
                return None, b''
        def spawn(args, **kwargs):
            self.assertEqual(args[0], '/usr/bin/setpriv')
            for fd in kwargs['pass_fds']:
                self.assertEqual(os.fstat(fd).st_nlink, 0)
                self.assertTrue(fcntl.fcntl(fd, fcntl.F_GET_SEALS) & fcntl.F_SEAL_WRITE)
            authority = json.loads(os.pread(kwargs['pass_fds'][0], 1024, 0))
            self.assertEqual(authority['action'], 'commit')
            kwargs['stdout'].write(F.encoded({'format': 'yunipals-arena-ypal-ordinary-child-v1', 'phase': 'publication_complete', 'explicitDatabaseIOFixture': True}) + b'\n')
            return Child()
        with patch.object(F.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=111, pw_gid=113)), patch.object(F.subprocess, 'Popen', side_effect=spawn) as popen:
            rows = F.arena('commit', {'explicitPrivatePayloadFixture': True}, journal, '1' * 64, read)
            self.assertEqual(rows[0]['phase'], 'publication_complete')
            with self.assertRaises(FileExistsError): F.arena('commit', {}, journal, '1' * 64, read)
            self.assertEqual(popen.call_count, 1)

    def test_booster_grants_exact_eight_and_preserves_full_other_graph(self):
        rows = [{'name': name, 'oid': oid, 'owner': '73004621', 'kind': 'r', 'rls': False, 'forceRls': False,
                 'writes': False, 'columnWrites': False, 'columnAcl': [], 'acl': [], 'select': name not in F.EIGHT}
                for name, oid in F.TARGET_OIDS.items()]
        role = {'oid': '73187672', 'name': 'yunipals_unified_collector', 'login': True,
                'super': False, 'createDb': False, 'createRole': False, 'replication': False, 'bypassRls': False}
        before = {'baseline': {'role': role, 'edges': [], 'unrelated': {'strict': True}}, 'target': {'schemaOid': '75963410', 'owner': '73004621', 'usage': True, 'create': False, 'tables': rows}}
        after = copy.deepcopy(before)
        for row in after['target']['tables']:
            if row['name'] not in F.EIGHT: continue
            row['select'] = True
            row['acl'].append({'grantee': '73187672', 'grantor': '73004621', 'privilege': 'SELECT', 'grantable': False})
            after['baseline']['edges'].append({'kind': 'relation', 'object': row['oid'], 'grantor': '73004621', 'privilege': 'SELECT', 'grantable': False})
        after['baseline']['edges'].sort(key=lambda e: (e['kind'], e['object'], e['grantor'], e['privilege'], e['grantable']))
        sql = F.booster_grant_sql(before, after, "SELECT '{}'::jsonb")
        self.assertEqual(sql.count('GRANT SELECT ON TABLE '), 8)
        self.assertTrue(sql.endswith('COMMIT;\n'))
        after['baseline']['unrelated']['strict'] = False
        with self.assertRaises(RuntimeError): F.booster_grant_sql(before, after, "SELECT '{}'::jsonb")

    def test_private_payload_matches_actual_node_source_contract(self):
        files, workers, roles, credential = {}, [], {}, {}
        for index in range(8):
            name = '/etc/yunipals-unified/consumers/arena-' + str(index) + '.env'
            role = 'arena_worker_' + str(index)
            raw = ('ARENA_DATABASE_URL=postgresql://' + role + ':synthetic@127.0.0.1:15438/yunipals_arena\n').encode()
            files[name] = raw; credential[name] = F.sha(raw); roles[role] = 1000 + index
            workers.append({'privateOverlay': name, 'role': role})
        name = '/etc/yunipals-arena/native-read.env'
        raw = ('ARENA_INDEXER_MODE=unified\nARENA_INDEXER_SOURCE_KIND=unified\nARENA_INDEXER_RELEASE_ID=' + F.RELEASE +
               '\nARENA_INDEXER_DATABASE_URL=postgresql://arena_native_reader:synthetic@127.0.0.1:5432/yunipals_backfill\n').encode()
        files[name] = raw; credential[name] = F.sha(raw)
        files['auth-result.json'] = F.encoded({'credentialFiles': credential, 'roles': roles, 'sourceRole': {'oid': 2000}})
        files['arena-ypal-current-admission-v1.proposal.json'] = F.encoded({'workers': workers, 'sourceReader': {'privateFile': name}})
        def read(path, expected=None):
            raw = files.get(str(path), files.get(Path(path).name))
            if str(path).startswith('/etc/'):
                self.assertEqual(F.sha(raw), expected)
            return raw
        payload = F.arena_payload({'block': '52648146', 'hash': '0x' + 'a' * 64}, read)
        self.assertEqual(len(payload['authUrls']), 9)
        source = HERE.parent / 'unified-indexer-transition/arena-ypal-ordinary-v1.mjs'
        js = 'import{validateSourceContext}from' + json.dumps(source.as_uri()) + ';validateSourceContext(JSON.parse(process.argv[1]));'
        result = subprocess.run(['node', '--input-type=module', '-e', js, json.dumps(payload['sourceContext'])], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == '__main__':
    unittest.main()
