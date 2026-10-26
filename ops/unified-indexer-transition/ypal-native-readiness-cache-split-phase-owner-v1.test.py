"""Whole Root dispatch/control bodies; explicit Source, SQL and SSH I/O fixtures."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch

PATH = pathlib.Path(__file__).with_name('ypal-native-readiness-cache-split-phase-owner-v1.py')
spec = importlib.util.spec_from_file_location('owned_split_phase', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
INPUT_SHA = 'a' * 64

def remote(action):
    raw = m.REMOTE
    values = {'__ACTION__': action, '__INPUT_SHA__': INPUT_SHA,
              '__OWNER_SHA__': m.OWNER_SHA, '__OWNER_MANIFEST_SHA__': m.OWNER_MANIFEST_SHA,
              '__CLASSIFIER_REFS__': m.CLASSIFIER_REFS, '__ROOT_SOURCE_SHA__': hashlib.sha256(PATH.read_bytes()).hexdigest()}
    for key, value in values.items():
        raw = raw.replace(key, repr(value))
    ns = {'__name__': 'explicit_phase_control'}
    with patch('os.umask'):
        exec(compile(raw, str(PATH) + ':remote', 'exec'), ns)
    return ns, raw

class Controls(unittest.TestCase):
    def fixture(self, action, *, activated=False, business_error=None, finish_error=None, snapshot_error=None, dependency_error=None):
        ns, _ = remote(action)
        events, saved = [], {}
        bare = Mock(side_effect=AssertionError('no actual subprocess in phase fixture'))
        ns['original_run'] = bare
        self.enterContext(patch.object(ns['subprocess'], 'run', bare))
        config = {'nativePolicyRefs': ns['POLICY'], 'forwardAuthorityInputSha256': ns['AUTH_SHA'],
                  'captureClassifierRefs': ns['CLASSIFIER_REFS']}
        observer = Mock()
        def snapshot():
            self.assertIs(ns['subprocess'].run, bare)
            events.append('restored-snapshot')
            if snapshot_error:
                raise snapshot_error
            return {'explicitCounterIOFixture': True, 'effectsRetried': False}
        observer.snapshot.side_effect = snapshot
        observer.binding.return_value = {'explicitClassifierBindingIOFixture': True}
        classifier = types.SimpleNamespace(authenticate=lambda: events.append('classifier-auth'),
                                          SubprocessDiagnostics=lambda original, save: observer)
        def preflight():
            self.assertIs(ns['subprocess'].run, observer)
            events.append('full-source-preflight')
            return {'explicitSourceIOFixture': True}
        def finish():
            events.append('full-source-postflight')
            if finish_error:
                raise finish_error
            return {'validated': True, 'explicitSourceIOFixture': True}
        session = types.SimpleNamespace(preflight=preflight, cache_context=lambda pin: events.append(('cache-context', pin)), finish=finish)
        def session_ctor(*args):
            self.assertIs(ns['subprocess'].run, observer)
            events.append('fresh-session')
            return session
        context = Mock()
        context.binding.return_value = {'explicitSplitBindingIOFixture': True}
        def effect(stage):
            events.append(('execute', stage))
            if business_error:
                raise business_error
            return {'explicitSQLResultIOFixture': True, 'phase': stage}
        context.execute.side_effect = effect
        context.verify.side_effect = lambda: events.append('verify') or {'explicitFullVerifyIOFixture': True}
        context.accept.side_effect = lambda: events.append('accept') or {'explicitPreparedACKIOFixture': True}
        context.inputs.side_effect = lambda: events.append('input-bookend')
        def dependency_current():
            events.append('accepted-dependency-preauthorization')
            if dependency_error:
                raise dependency_error
            return {'explicitInstalledDependencyIOFixture': True}
        def dependency_load(name):
            self.assertEqual(name, 'ypal-ordinary-reader-peer-v6.py')
            return types.SimpleNamespace(dependency_current=dependency_current)
        owner = types.SimpleNamespace(MANIFEST=pathlib.Path('/explicit/owner.manifest.json'), INPUT=pathlib.Path('/explicit/input.json'),
            BASE=pathlib.Path('/explicit/split'), authenticate=lambda: events.append('owner-auth'),
            bind_session=lambda actual, pin: events.append(('early-activated-route', pin)),
            Context=lambda actual, pin: context, load=dependency_load)
        modules = {ns['OWNER']: owner, ns['CLASSIFIER']: classifier,
                   ns['CALLER']: types.SimpleNamespace(Session=session_ctor),
                   ns['PREPARED']: types.SimpleNamespace(bind=lambda actual: events.append('constructor-binding') or {'explicitConstructorIOFixture': True}),
                   ns['GENERATION']: types.SimpleNamespace(bind=lambda actual: events.append('generation-binding') or {'explicitGenerationIOFixture': True})}
        ns['load'] = lambda path, digest: modules[path]
        ns['public'] = lambda path, digest=None: m.encoded(config if path == owner.INPUT else {'sourceRefs': {'explicitSourceRefIOFixture': True}})
        def save(name, value):
            if name != 'intent.json':
                if name in {'failure.json', 'capture-classifier-snapshot.json', 'result.json'}:
                    self.assertIs(ns['subprocess'].run, bare)
            saved[name] = value
            digest = hashlib.sha256(value if isinstance(value, bytes) else m.encoded(value)).hexdigest()
            ns['proofs'][name] = digest
            return digest
        ns['save'], ns['sync'] = save, Mock()
        self.enterContext(patch.object(pathlib.Path, 'exists', return_value=activated))
        return ns, events, saved, context, observer, bare

    def run_main(self, ns):
        ns['AUDIT'] = Mock()
        with patch.object(ns['os'], 'geteuid', return_value=0), patch.object(ns['os'], 'getegid', return_value=0), \
             patch.object(ns['socket'], 'gethostname', return_value='yunipals-main'), \
             patch.object(ns['sys'], 'gettrace', return_value=None), patch.object(ns['sys'], 'getprofile', return_value=None), \
             patch.object(ns['signal'], 'signal'), patch.object(ns['signal'], 'alarm'), contextlib.redirect_stdout(io.StringIO()):
            return ns['main']()

    def test_01_all_four_real_dispatch_paths_require_preflight_bindings_and_postflight(self):
        for action in ['prepare-guards', 'verify', 'activate-reads', 'accept']:
            with self.subTest(action=action):
                ns, events, saved, ctx, observer, bare = self.fixture(action, activated=action == 'accept')
                self.assertEqual(self.run_main(ns), 0)
                result = saved['result.json']
                self.assertTrue(result['completed'])
                self.assertLess(events.index('classifier-auth'), events.index('fresh-session'))
                self.assertLess(events.index('full-source-preflight'), events.index('constructor-binding'))
                self.assertLess(events.index(('cache-context', ns['CACHE_INPUT_SHA'])), events.index('generation-binding'))
                self.assertEqual(ctx.execute.call_count, int(action in {'prepare-guards', 'activate-reads'}))
                self.assertEqual(ctx.accept.call_count, int(action in {'activate-reads', 'accept'}))
                self.assertEqual(ctx.verify.call_count, int(action == 'verify'))
                self.assertEqual(result['phaseCommitted'], action in {'prepare-guards', 'activate-reads'})
                self.assertFalse(result['heldQualificationPerformed'])
                self.assertFalse(result['oldCachePreparedACKClaimed'])
                self.assertFalse(result['automaticRetryAllowed'])
                self.assertIn('accepted-dependency-preauthorization.json', saved)
                action_event = ('execute', action) if action in {'prepare-guards', 'activate-reads'} else action
                self.assertLess(events.index('accepted-dependency-preauthorization'), events.index(action_event))
                self.assertEqual(events[-2:], ['input-bookend', 'restored-snapshot'])
                self.assertEqual(result['rootProducerSha256'], hashlib.sha256(PATH.read_bytes()).hexdigest())
                self.assertIs(ns['subprocess'].run, bare)
                if action == 'accept':
                    self.assertLess(events.index(('early-activated-route', INPUT_SHA)), events.index(('cache-context', ns['CACHE_INPUT_SHA'])))

    def test_02_actual_error_is_private_and_no_effect_is_replayed(self):
        for after_commit in [False, True]:
            with self.subTest(after_commit=after_commit):
                kwargs = {'finish_error': RuntimeError('explicit_private_postflight_error')} if after_commit else {'business_error': RuntimeError('explicit_private_SQL_error')}
                ns, events, saved, ctx, _, bare = self.fixture('prepare-guards', **kwargs)
                self.assertEqual(self.run_main(ns), 1)
                result = saved['result.json']
                self.assertFalse(result['completed'])
                self.assertTrue(result['unknownOutcomeRequiresInspection'])
                self.assertEqual(result['phaseReturned'], after_commit)
                self.assertEqual(ctx.execute.call_count, 1)
                self.assertIn('explicit_private_', saved['failure.json']['traceback'])
                self.assertNotIn('explicit_private_', json.dumps(result))
                self.assertIs(ns['subprocess'].run, bare)

    def test_03_diagnostic_persistence_failure_cannot_claim_a_complete_run(self):
        ns, _, saved, ctx, _, bare = self.fixture('prepare-guards', snapshot_error=RuntimeError('explicit_counter_write_refusal'))
        self.assertEqual(self.run_main(ns), 1)
        result = saved['result.json']
        self.assertFalse(result['completed'])
        self.assertTrue(result['remoteAuditInspectionRequired'])
        self.assertTrue(result['phaseReturned'])
        self.assertTrue(result['unknownOutcomeRequiresInspection'])
        self.assertEqual(ctx.execute.call_count, 1)
        self.assertNotIn('capture-classifier-snapshot.json', saved)
        self.assertIs(ns['subprocess'].run, bare)

    def test_04_closed_source_or_existing_local_result_stops_before_ssh(self):
        args = [str(PATH), '--run', '--action', 'prepare-guards', '--input-sha', INPUT_SHA]
        with patch.object(sys, 'argv', args), patch.object(m, 'ROOT_PHASE_SOURCE_REVIEWED', False), \
             patch.object(m.subprocess, 'run', side_effect=AssertionError('no SSH')):
            with self.assertRaisesRegex(RuntimeError, 'reviewed_root_split_phase_source'):
                m.main()
        with patch.object(sys, 'argv', args), patch.object(m, 'ROOT_PHASE_SOURCE_REVIEWED', True), \
             patch.object(m.os.path, 'lexists', return_value=True), patch.object(m.subprocess, 'run', side_effect=AssertionError('no SSH')):
            with self.assertRaisesRegex(RuntimeError, 'exclusive_owned_split_action'):
                m.main()

    def test_05_actual_frozen_owner_pair_and_root_hash_enter_one_exact_wire(self):
        calls, outputs = [], []
        args = [str(PATH), '--run', '--action', 'verify', '--input-sha', INPUT_SHA]
        expected, raw = remote('verify')
        def peer(argv, **kw):
            calls.append((argv, kw))
            self.assertEqual(kw['input'], raw.encode())
            self.assertEqual(argv[-2:], ['root@168.119.172.10', 'python3 -I -B -'])
            return types.SimpleNamespace(stdout=m.encoded({'format': m.FORMAT, 'action': 'verify', 'completed': True}), stderr=b'', returncode=0)
        with patch.object(sys, 'argv', args), patch.object(m, 'ROOT_PHASE_SOURCE_REVIEWED', True), \
             patch.object(m.os.path, 'lexists', return_value=False), patch.object(m.subprocess, 'run', side_effect=peer), \
             patch.object(m, 'exclusive', side_effect=lambda path, value: outputs.append((path, value))), patch.object(m.os, 'umask'), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(), 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(outputs), 1)
        self.assertEqual(expected['OWNER_SHA'], '30dfced740a6800af527af8b1ad9d40a480f13eba71151e5a0aa43e378d7d561')
        self.assertNotIn('__ROOT_SOURCE_SHA__', raw)

    def test_06_frozen_owner_drift_or_ambiguous_transport_never_replays(self):
        args = [str(PATH), '--run', '--action', 'verify', '--input-sha', INPUT_SHA]
        original = pathlib.Path.read_bytes
        def drift(path):
            value = original(path)
            return value + b' ' if path == m.OWNER else value
        with patch.object(sys, 'argv', args), patch.object(m, 'ROOT_PHASE_SOURCE_REVIEWED', True), \
             patch.object(m.os.path, 'lexists', return_value=False), patch.object(pathlib.Path, 'read_bytes', drift), \
             patch.object(m.subprocess, 'run', side_effect=AssertionError('no SSH on source drift')):
            with self.assertRaisesRegex(RuntimeError, 'actual_canonical_frozen_split_owner_pair'):
                m.main()
        outputs = []
        with patch.object(sys, 'argv', args), patch.object(m, 'ROOT_PHASE_SOURCE_REVIEWED', True), \
             patch.object(m.os.path, 'lexists', return_value=False), patch.object(m.subprocess, 'run', return_value=types.SimpleNamespace(stdout=b'explicit malformed fixture', stderr=b'', returncode=255)) as peer, \
             patch.object(m, 'exclusive', side_effect=lambda path, value: outputs.append((path, value))), patch.object(m.os, 'umask'), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(), 1)
        self.assertEqual(peer.call_count, 1)
        self.assertEqual(len(outputs), 2)
        self.assertTrue(outputs[-1][1]['transportOutcomeUnknown'])
        self.assertFalse(outputs[-1][1]['automaticRetryAllowed'])

    def test_07_exact_original_dependency_gate_refusal_blocks_every_action(self):
        owner_tree = ast.parse(m.OWNER.read_bytes())
        pins = next(ast.literal_eval(node.value) for node in owner_tree.body
                    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'SOURCE_PINS')
        self.assertEqual(pins['ypal-ordinary-reader-peer-v6.py'], '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6')
        for action in ['prepare-guards', 'verify', 'activate-reads', 'accept']:
            with self.subTest(action=action):
                ns, events, saved, ctx, _, bare = self.fixture(action, dependency_error=RuntimeError('exact_accepted_dependencies_before_evaluation_required'))
                self.assertEqual(self.run_main(ns), 1)
                result = saved['result.json']
                self.assertFalse(result['completed'])
                self.assertFalse(result['effectInvoked'])
                self.assertFalse(result['phaseReturned'])
                self.assertFalse(result['unknownOutcomeRequiresInspection'])
                self.assertEqual(result['stage'], 'accepted-dependency-preauthorization')
                ctx.execute.assert_not_called()
                ctx.verify.assert_not_called()
                ctx.accept.assert_not_called()
                self.assertNotIn('accepted-dependency-preauthorization.json', saved)
                self.assertIs(ns['subprocess'].run, bare)

if __name__ == '__main__':
    unittest.main()
