#!/usr/bin/env python3
"""Offline controls only: synthetic files/processes/PG/RPC; no host or provider."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("preflight", HERE / "arena-modern-runtime-preflight-v1.py")
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
NODE = Path("/root/.nvm/versions/node/v24.18.1/bin/node")


def h(raw):
    return hashlib.sha256(raw).hexdigest()


class Controls(unittest.TestCase):
    def test_process_environment_preserves_private_bytes_only_in_memory(self):
        raw = (b'CREDENTIALS_DIRECTORY=/run/credentials/yunipals-arena-api.service\0'
               b'ARENA_REPOSITORY_ROOT=/retained/release\0ARENA_RULES_HASH=' + m.RULES_HASH.encode() +
               b'\0OPENAI_API_KEY=synthetic-secret\0UNUSUAL=\xff\0')
        env = m.environment(raw, 'yunipals-arena-api.service')
        self.assertEqual(env['OPENAI_API_KEY'], 'synthetic-secret')
        self.assertEqual(os.fsencode(env['UNUSUAL']), b'\xff')
        for suffix in [b'NODE_OPTIONS=--import=worker.mjs\0', b'ARENA_RULES_HASH=no\0', b'OPENAI_API_KEY=duplicate\0']:
            with self.subTest(suffix=suffix), self.assertRaises(m.PreflightFailure):
                m.environment(raw + suffix, 'yunipals-arena-api.service')
        for changed in [raw[:-1], raw.replace(b'/api.service', b'/other.service'), raw.replace(b'yunipals-arena-api.service', b'yunipals-arena-referee.service'), b'a' * 131073]:
            # First replace is deliberately a no-op; ignore it here.
            if changed == raw:
                continue
            with self.subTest(changed=h(changed)), self.assertRaises(m.PreflightFailure):
                m.environment(changed, 'yunipals-arena-api.service')

    def test_fixed_command_never_contains_environment(self):
        args = m.command(1234, 8, Path('/candidate/apps/yunipals-market-api'))
        self.assertIn('--target=1234', args)
        self.assertIn('--reuid=971', args)
        self.assertIn('--regid=965', args)
        self.assertIn('--clear-groups', args)
        self.assertIn('--no-new-privs', args)
        self.assertNotIn('synthetic-secret', repr(args))
        self.assertEqual(args[-1], '8')

    def test_actual_pg_url_cannot_override_scoped_readonly_or_timeout_bounds(self):
        app = Path('/tmp/yunipals-arena-live-compat-20261022/apps/yunipals-market-api')
        if not (app / 'node_modules/pg').exists():
            self.skipTest('retained local accepted pg dependency fixture is absent')
        script = "import {createRequire}from'node:module';const require=createRequire(" + json.dumps(str(app / 'package.json')) + ");const pg=require('pg');" + m.PG_SCOPE + r"""
const original='postgresql://fixture-user:fixture-password@localhost/fixture?options=-c%20default_transaction_read_only%3Doff&statement_timeout=0&lock_timeout=0&idle_in_transaction_session_timeout=0&query_timeout=0&connectionTimeoutMillis=0';
const config={connectionString:original,options:'-c default_transaction_read_only=off',statement_timeout:0,lock_timeout:0,connectionTimeoutMillis:0};
const scoped=scopedPgConfig(config),client=new pg.Client(scoped),params=client.connectionParameters;
const unchanged=new URL(original),actual=new URL(scoped.connectionString);
const preserved=['protocol','hostname','port','username','password','pathname'].every(k=>unchanged[k]===actual[k]);
const bounds=params.statement_timeout==='5000'&&params.lock_timeout==='2000'&&params.idle_in_transaction_session_timeout==='15000'&&params.query_timeout==='5000'&&params.connect_timeout===2&&client._connectionTimeoutMillis===2000;
const readonly=params.options.endsWith('-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000');
const prefix=params.options.startsWith('-c default_transaction_read_only=off ');
process.stdout.write(JSON.stringify({preserved,bounds,readonly,prefix,originalConfigUnchanged:config.connectionString===original,noConnectionCreated:!client._connecting&&!client._connected}));
"""
        result = subprocess.run([str(NODE), '--input-type=module', '-'], input=script.encode(), capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(result.stderr)
        self.assertEqual(json.loads(result.stdout), {'preserved': True, 'bounds': True, 'readonly': True, 'prefix': True, 'originalConfigUnchanged': True, 'noConnectionCreated': True})
        self.assertNotIn(b'fixture-password', result.stdout)

    def test_generated_script_is_valid_node_and_keeps_repository_env_name(self):
        script = m.constructor_script(Path('/candidate'))
        self.assertIn(b'process.env.ARENA_REPOSITORY_ROOT', script)
        result = subprocess.run([str(NODE), '--input-type=module', '--check'], input=script, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertFalse(result.stderr)

    def test_relay_refuses_wrong_identity_without_executing(self):
        fd = os.memfd_create('synthetic-env')
        try:
            os.write(fd, m.encoded({'environment': {'SECRET': 'never-print'}, 'app': '/', 'node': '/not/executed', 'script': 'secret'}))
            os.lseek(fd, 0, 0)
            result = subprocess.run(['/usr/bin/python3', '-I', '-c', m.RELAY, str(fd)], pass_fds=(fd,), capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['code'], 'credential_context_relay_failed')
            self.assertNotIn(b'never-print', result.stdout + result.stderr)
        finally:
            os.close(fd)

    def test_internal_fd_is_sealed_and_env_not_in_child_argv_or_bootstrap(self):
        seen = {}
        class Child:
            returncode = 0
            pid = 999999
            def __init__(self, argv, **kwargs):
                seen['argv'] = argv
                seen['kwargs'] = kwargs
                fd = kwargs['pass_fds'][0]
                seen['seals'] = m.fcntl.fcntl(fd, m.fcntl.F_GET_SEALS)
                seen['payload'] = json.loads(os.read(fd, 524288))
            def communicate(self, timeout):
                return m.encoded(success()), b''
        with patch.object(m.subprocess, 'Popen', Child):
            actual = m.invoke(12, {'SECRET': 'only-in-fd'}, Path('/candidate'), Path('/node'))
        self.assertTrue(actual['completed'])
        self.assertEqual(seen['payload']['environment'], {'SECRET': 'only-in-fd'})
        self.assertNotIn('only-in-fd', repr(seen['argv']) + repr(seen['kwargs']['env']))
        self.assertTrue(seen['seals'] & m.fcntl.F_SEAL_WRITE)
        self.assertTrue(seen['kwargs']['start_new_session'])

    def test_child_result_only_exports_allowlisted_success(self):
        self.assertEqual(m.child_result(m.encoded(success())), success())
        for value in [{**success(), 'key': 'never-export'}, {**success(), 'closed': False}, {**success(), 'rpcReadCalls': 0}, {**success(), 'rpcReadCalls': 4}, {**success(), 'pgReadOnly': False}, {'completed': False, 'code': 'candidate_constructor_refused'}]:
            with self.subTest(value=value), self.assertRaises(m.PreflightFailure):
                m.child_result(m.encoded(value))

    def test_actor_changed_before_constructor_prevents_dispatch(self):
        owner = types.SimpleNamespace(verify_inputs=lambda *_: None)
        row = {'unit': 'yunipals-arena-api.service'}
        identity = {'process': {'pid': 12}}
        with patch.object(m, 'actor', side_effect=[identity, {'changed': True}]), patch.object(m, 'process_environment', return_value=({}, 'a' * 64)), patch.object(m, 'invoke') as invoke:
            with self.assertRaisesRegex(m.PreflightFailure, 'actor_changed_before'):
                m.qualify_one(None, owner, row, None, Path('/candidate'), None, {})
            invoke.assert_not_called()

    def test_actor_changed_after_constructor_refuses_success(self):
        owner = types.SimpleNamespace(verify_inputs=lambda *_: None, NODE=Path('/node'))
        row = {'unit': 'yunipals-arena-api.service'}
        identity = {'process': {'pid': 12}}
        with patch.object(m, 'actor', side_effect=[identity, identity, {'changed': True}]), patch.object(m, 'process_environment', return_value=({}, 'a' * 64)), patch.object(m, 'invoke', return_value=success()):
            with self.assertRaisesRegex(m.PreflightFailure, 'actor_changed_during'):
                m.qualify_one(None, owner, row, None, Path('/candidate'), None, {})

    def test_private_hash_rechecked_after_constructor(self):
        calls = []
        owner = types.SimpleNamespace(verify_inputs=lambda *_: calls.append(1), NODE=Path('/node'))
        row = {'unit': 'yunipals-arena-api.service'}
        identity = {'process': {'pid': 12}}
        with patch.object(m, 'actor', return_value=identity), patch.object(m, 'process_environment', return_value=({'PRIVATE': 'unchanged'}, 'a' * 64)), patch.object(m, 'invoke', return_value=success()):
            value = m.qualify_one(None, owner, row, None, Path('/candidate'), None, {})
        self.assertEqual(calls, [1, 1])
        self.assertNotIn('PRIVATE', repr(value))

    def test_changed_private_input_refuses(self):
        owner = types.SimpleNamespace(verify_inputs=lambda *_: (_ for _ in ()).throw(m.PreflightFailure('private_input_changed')), NODE=Path('/node'))
        row = {'unit': 'yunipals-arena-api.service'}
        with patch.object(m, 'actor', return_value={'process': {'pid': 12}}), patch.object(m, 'process_environment', return_value=({}, 'a' * 64)), patch.object(m, 'invoke') as invoke:
            with self.assertRaisesRegex(m.PreflightFailure, 'private_input_changed'):
                m.qualify_one(None, owner, row, None, Path('/candidate'), None, {})
            invoke.assert_not_called()

    def test_only_exact_sticky_var_tmp_and_private_root_artifact_directory(self):
        import stat
        def info(mode, uid=0, gid=0):
            return types.SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=uid, st_gid=gid)
        self.assertTrue(m.trusted_ancestor(Path('/var/tmp'), info(0o1777)))
        self.assertFalse(m.trusted_ancestor(Path('/tmp'), info(0o1777)))
        self.assertFalse(m.trusted_ancestor(Path('/var/tmp'), info(0o777)))
        self.assertFalse(m.trusted_ancestor(Path('/var/tmp'), info(0o1777, uid=971)))
        self.assertTrue(m.trusted_ancestor(Path('/var/tmp/yunipals-runtime-actual'), info(0o700)))
        self.assertFalse(m.trusted_ancestor(Path('/var/tmp/yunipals-runtime-actual'), info(0o755)))

    def test_protected_reader_rejects_symlink_and_writable_payload(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp:
            root = Path(temp)
            regular = root / 'file'
            regular.write_bytes(b'public')
            regular.chmod(0o600)
            self.assertEqual(m.protected(regular), b'public')
            alias = root / 'alias'
            alias.symlink_to(regular)
            with self.assertRaises(m.PreflightFailure):
                m.protected(alias)
            regular.chmod(0o666)
            with self.assertRaises(m.PreflightFailure):
                m.protected(regular)


class CandidateBindings(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self.temp.name)
        self.release = self.root / ('a' * 64)
        self.release.mkdir()
        self.manifest = {'files': [{'path': 'public.txt', 'bytes': 1, 'sha256': 'b' * 64}]}
        (self.release / 'public.txt').write_bytes(b'x')
        (self.release / 'node_modules').mkdir()
        manifest_raw = m.encoded(self.manifest)
        (self.release / 'RELEASE-MANIFEST.json').write_bytes(manifest_raw)
        self.inventory = {'format': 'yunipals-runtime-supplement-v1', 'sourceDigest': 'a' * 64, 'sourceManifestSha256': h(manifest_raw), 'archiveSha256': 'c' * 64, 'roots': ['node_modules'], 'entries': [{'path': 'node_modules', 'type': 'directory'}]}
        self.proof = {'format': 'yunipals-arena-modern-package-v1', 'status': 'passed', 'sourceDigest': 'a' * 64, 'source': {'manifestSha256': h(manifest_raw), 'files': 1}, 'runtime': {'separateRelocatedTreeRebuildByteIdentical': True, 'archiveSha256': 'c' * 64, 'entries': 1}, 'verification': {'twoFullTypechecks': True, 'targetedCredentialReaderSuites': 2, 'credentialControlsPerSuite': 79, 'modernAcceptanceSuites': 2, 'modernChecksPerSuite': 21, 'ordinaryMarketBuilds': 2, 'bundleCount': 36, 'dependencyPackages': 330, 'catalog': {'rulesHash': m.RULES_HASH, 'poolHash': m.POOL_HASH, 'islands': 898}}}
        self.installed = {'format': 'yunipals-arena-modern-install-v1', 'installed': True, 'sourceDigest': 'a' * 64, 'manifestSha256': h(manifest_raw), 'runtimeArchiveSha256': 'c' * 64, 'runtimeStarted': False, 'serviceChanges': 0, 'databaseChanges': 0, 'sourceSelectionsChanged': 0, 'installedEntriesVerified': 1, 'sourceFilesVerified': 1}
        self.helper = types.SimpleNamespace(source_check=lambda *_: self.manifest, inventory_entries=lambda *_: (self.inventory['roots'], self.inventory['entries']))
        self.patch = patch.object(m, 'RELEASES', self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def plan(self):
        def write(name, value):
            raw = m.encoded(value)
            path = self.root / name
            path.write_bytes(raw)
            return str(path), h(raw)
        invfile, invhash = write('runtime-supplement.inventory.json', self.inventory)
        self.proof['runtime']['inventorySha256'] = invhash
        prooffile, proofhash = write('arena-consumer-package-proof.json', self.proof)
        self.installed.update(runtimeInventorySha256=invhash, proofSha256=proofhash)
        installfile, installhash = write('install-result.json', self.installed)
        return {'format': m.FORMAT, 'sourceDigest': 'a' * 64, 'sourceManifestSha256': self.inventory['sourceManifestSha256'], 'runtimeArchiveSha256': 'c' * 64, 'packageProofFile': prooffile, 'packageProofSha256': proofhash, 'runtimeInventoryFile': invfile, 'runtimeInventorySha256': invhash, 'installResultFile': installfile, 'installResultSha256': installhash}

    def test_actual_completed_source_runtime_install_bindings(self):
        root, proof = m.candidate(self.plan(), self.helper)
        self.assertEqual(root, self.release)
        self.assertFalse(proof['mediaQualified'])

    def test_reject_missing_or_guessed_pins_and_paths(self):
        plan = self.plan()
        for change in [{'sourceDigest': '0' * 64}, {'extra': True}, {'packageProofFile': '/tmp/not-a-build-proof.json'}]:
            with self.subTest(change=change), self.assertRaises(m.PreflightFailure):
                m.validate_plan({**plan, **change})

    def test_reject_unknown_install_receipt_and_stale_hash(self):
        plan = self.plan()
        plan['installResultSha256'] = 'd' * 64
        with self.assertRaises(m.PreflightFailure):
            m.candidate(plan, self.helper)
        self.installed['installed'] = False
        with self.assertRaises(m.PreflightFailure):
            m.candidate(self.plan(), self.helper)

    def test_reject_wrong_protocol_or_incomplete_actual_suites(self):
        for key, value in [('modernChecksPerSuite', 20), ('bundleCount', 34), ('twoFullTypechecks', False)]:
            previous = self.proof['verification'][key]
            self.proof['verification'][key] = value
            with self.subTest(key=key), self.assertRaises(m.PreflightFailure):
                m.candidate(self.plan(), self.helper)
            self.proof['verification'][key] = previous
        self.proof['verification']['catalog']['rulesHash'] = '0x' + '1' * 64
        with self.assertRaises(m.PreflightFailure):
            m.candidate(self.plan(), self.helper)

    def test_runtime_inventory_mutation_refused(self):
        plan = self.plan()
        helper = types.SimpleNamespace(source_check=self.helper.source_check, inventory_entries=lambda *_: (['node_modules'], [{'path': 'unowned'}]))
        with self.assertRaises(m.PreflightFailure):
            m.candidate(plan, helper)


class RetainedReceiptBindings(unittest.TestCase):
    def test_actual_owner_restore_schema_and_original_runtime_bindings(self):
        roles = ['api', 'capacity', 'control', 'lobby', 'media', 'projector', 'referee', 'settlement']
        units = ['yunipals-arena-' + role + '.service' for role in roles]
        base = {'resolvedRelease': '/original', 'services': [{'role': role, 'unit': unit} for role, unit in zip(roles, units)]}
        binding = {'operatorSha256': 'owner-pin', 'currentUnits': [{'role': role, 'unit': unit, 'runtimeSha256': h(b'original-runtime')} for role, unit in zip(roles, units)], 'privateInputHashes': {'fixed-private-input': 'a' * 64}}
        schema = {'fixed': 'committed12'}
        post = {'officialObjects': {'objectsSha256': h(m.encoded(schema))}}
        owner_review = h(m.encoded(binding))
        result = {'reviewHash': owner_review, 'migrationCommitOutcome': 'commit_confirmed', 'sourceSelectionChanged': False, 'sourceModeAfter': 'legacy', 'postcheck': post}
        restored = {'format': 'restore-format', 'restored': True, 'overrideFilesRemoved': 8, 'schemaWrites': 0, 'privateDataRestores': 0, 'originalActors': {unit: {'invocation': 'known'} for unit in units}}
        inputs = {'/owner/result.json': m.encoded(result), '/owner/review.json': m.encoded(binding), '/owner/postcheck.json': m.encoded(post), '/restore/result.json': m.encoded(restored), str(m.OPS / 'arena-config-public-baseline-v1.json'): m.encoded(base)}
        for role in roles:
            inputs['/original/apps/yunipals-market-api/dist/arena-' + role + '.mjs'] = b'original-runtime'
        observer = types.SimpleNamespace(BASELINE_SHA=h(m.encoded(base)), read=lambda path, *_: (inputs[str(path)], None))
        owner = types.SimpleNamespace(UNITS=units, verify_inputs=lambda *_: None, legacy_row=lambda baseline, role: (None, [None, None, 'dist/arena-' + role + '.mjs']), schema_objects=lambda: schema)
        restore = types.SimpleNamespace(PARENT=Path('/owner'), BASE=Path('/restore'), FORMAT='restore-format', RESULT_SHA=h(m.encoded(result)), OWNER_SHA='owner-pin', OWNER_REVIEW=owner_review, read=lambda o, path: o.read(path)[0], no_jobs=lambda _: None, graph=lambda *_a, **_kw: {'fixed': 'original'}, database=lambda _: {'markers': list(range(12))})
        with patch.object(m, 'RESTORE_RESULT_SHA', h(m.encoded(restored))):
            _, _, _, proof = m.retained(restore, owner, observer)
            self.assertEqual(proof['committedMigrationMarkers'], 12)
            for path in ['/owner/result.json', '/owner/review.json', '/restore/result.json', '/original/apps/yunipals-market-api/dist/arena-api.mjs']:
                old = inputs[path]
                inputs[path] = m.encoded({'unknown': True})
                with self.subTest(path=path), self.assertRaises(m.PreflightFailure):
                    m.retained(restore, owner, observer)
                inputs[path] = old
            schema['changed'] = 'not-the-committed-graph'
            with self.assertRaisesRegex(m.PreflightFailure, 'committed_schema_graph_changed'):
                m.retained(restore, owner, observer)


class ActualJavascriptBoundary(unittest.TestCase):
    """Execute the generated script with synthetic module adapters, no sockets/DB."""
    def run_fixture(self, mode='valid'):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'apps/yunipals-market-api'
            (app / 'node_modules/tsx').mkdir(parents=True)
            (app / 'node_modules/pg').mkdir()
            (root / 'docs/arena').mkdir(parents=True)
            (root / 'docs/arena/mainnet-rules-manifest-v1.json').write_text(json.dumps({'rulesHash': m.RULES_HASH, 'manifest': {'version': 'actual-fixture'}}))
            (app / 'package.json').write_text('{"type":"module"}')
            (app / 'node_modules/tsx/package.json').write_text('{"type":"module","exports":{"./esm/api":"./api.mjs"}}')
            (app / 'node_modules/pg/index.js').write_text("module.exports={Pool:class{constructor(c){if(!c.options.includes('-c default_transaction_read_only=on')||new URL(c.connectionString).searchParams.get('statement_timeout')!=='5000'||c.connectionTimeoutMillis!==2000)throw Error('not_readonly');}}};")
            code = """
import {createRequire} from 'node:module';
const catalog={rulesHash:__RULES__,manifest:{version:'actual-fixture'},islands:Array(898).fill({})};
export async function tsImport(path){
 if(path.endsWith('/rpcBudgetProxyRegistry.ts')){globalThis.fetch=async()=>new Response('{}');return{rpcBudgetProxyUrl:()=> 'http://127.0.0.1:12345'};}
 if(path.endsWith('/catalog.ts'))return{ARENA_POOL_HASH:__POOL__,loadLiveArenaCatalog:root=>__MODE__==='bad-catalog'&&root==='/actual/retained'?{...catalog,rulesHash:'bad'}:catalog};
 if(path.endsWith('/runtime.ts'))return{arenaRuntime:async options=>{
  if(options.native!==false)throw Error('native_wrong');
  const require=createRequire(path);new (require('pg').Pool)({connectionString:'postgresql:///fixture?host=%2Ftmp&options=-c%20default_transaction_read_only%3Doff&statement_timeout=0&lock_timeout=0&query_timeout=0&connectionTimeoutMillis=0',options:'-c lock_timeout=1'});
  const method=__MODE__==='broadcast'?'eth_sendRawTransaction':'eth_call';
  const url=__MODE__==='provider'?'https://provider.invalid/private':'http://127.0.0.1:12345/';
  await fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='eth_call'?[{to:'0x0',data:'0x'},'latest']:['secret']})});
  if(__MODE__==='secret-error'){console.error('synthetic-private-value');throw Error('synthetic-private-value');}
  return{catalog,config:{rulesHash:__RULES__},close:async()=>{if(__MODE__==='close-error')throw Error('synthetic-private-value');},loop:()=>{throw Error('loop_must_not_run');}};
 }};throw Error('unexpected_import');}
""".replace('__RULES__', json.dumps(m.RULES_HASH)).replace('__POOL__', json.dumps(m.POOL_HASH)).replace('__MODE__', json.dumps(mode))
            (app / 'node_modules/tsx/api.mjs').write_text(code)
            env = {**os.environ, 'ARENA_REPOSITORY_ROOT': '/actual/retained'}
            script = m.constructor_script(root)
            # Adapt the synthetic fixture's hash consistently; the separate real
            # catalog test below exercises the actual production46a4 envelope.
            fixture_rules = '0x' + h(b'{"version":"actual-fixture"}')
            script = script.replace(m.RULES_HASH.encode(), fixture_rules.encode())
            for path in [root / 'docs/arena/mainnet-rules-manifest-v1.json', app / 'node_modules/tsx/api.mjs']:
                path.write_text(path.read_text().replace(m.RULES_HASH, fixture_rules))
            result = subprocess.run([str(NODE), '--input-type=module', '-'], input=script, env=env, capture_output=True, timeout=15)
            self.assertEqual(result.stderr, b'')
            self.assertNotIn(b'synthetic-private-value', result.stdout)
            return result

    def test_actual_javascript_ctor_close_pg_readonly_and_retained_catalog(self):
        result = self.run_fixture()
        self.assertEqual(result.returncode, 0)
        self.assertTrue(json.loads(result.stdout)['closed'])

    def test_actual_published_envelope_and_real_dynamic_catalog(self):
        root = Path('/tmp/yunipals-arena-live-compat-20261022')
        if not (root / 'apps/yunipals-market-api/node_modules/tsx').exists():
            self.skipTest('retained local modern source/dependency fixture is absent')
        script = m.constructor_script(root)
        # Exercise the exact generated catalog/envelope logic with the real TS
        # loader and898-island inputs, then avoid constructor DB/RPC by substituting
        # only that final seam. Other tests exercise the constructor call itself.
        target = b"const {arenaRuntime}=await tsImport(app+'/src/arena/live/runtime.ts',opts);"
        replacement = b"const arenaRuntime=async()=>({catalog:actual,config:{rulesHash:expectedRules},close:async()=>{}});"
        self.assertIn(target, script)
        script = script.replace(target, replacement)
        result = subprocess.run([str(NODE), '--input-type=module', '-'], input=script, env={**os.environ, 'ARENA_REPOSITORY_ROOT': str(root), 'TSX_DISABLE_CACHE': '1'}, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout.decode())
        self.assertFalse(result.stderr)
        actual = json.loads(result.stdout)
        self.assertEqual(actual['rulesHash'], m.RULES_HASH)
        self.assertEqual(actual['manifestSha256'], m.RULES_HASH[2:])
        self.assertEqual(actual['islands'], 898)
        self.assertEqual(actual['rpcReadCalls'], 0)

    def test_actual_javascript_rejects_broadcast_provider_catalog_and_exceptions(self):
        for mode in ['broadcast', 'provider', 'bad-catalog', 'secret-error', 'close-error']:
            with self.subTest(mode=mode):
                result = self.run_fixture(mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(result.stdout), {'completed': False, 'code': 'candidate_constructor_refused'})


def success():
    return {'completed': True, 'rulesHash': m.RULES_HASH, 'poolHash': m.POOL_HASH, 'islands': 898, 'manifestSha256': 'a' * 64, 'retainedRepositoryRootSha256': 'b' * 64, 'contractSettingsChecked': True, 'pgReadOnly': True, 'rpcReadCalls': 1, 'constructorOnly': True, 'closed': True}


if __name__ == '__main__':
    unittest.main()
