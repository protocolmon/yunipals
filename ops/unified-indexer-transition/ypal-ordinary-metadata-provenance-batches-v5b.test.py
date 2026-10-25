"""Narrow V5b authority/reconciliation seam, genuine retained batch body."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load(HERE / 'ypal-ordinary-metadata-provenance-batches-v5b.py')
old = load(HERE / 'ypal-ordinary-metadata-provenance-batches-v5.test.py')


def fixture(test):
    f = old.Fixture(test)
    completion = load(HERE / m.COMPLETION.name)
    parent = f.completion
    (parent.BASE / 'result.json').unlink()  # Actual9a failed, never acknowledged selection.
    f.op['oldWriter'] = {'same': 'protected-private-inputs'}
    (f.base / 'operation.json').write_bytes(m.encoded(f.op))
    f.value['metadataOperationSha256'] = m.sha((f.base / 'operation.json').read_bytes())
    parent.OPERATION_SHA = f.value['metadataOperationSha256']
    intent = f.document(parent.BASE / 'start-intent.json')
    intent['originalOperationSha256'] = parent.OPERATION_SHA
    intent['binding']['originalOperationSha256'] = parent.OPERATION_SHA
    (parent.BASE / 'start-intent.json').write_bytes(m.encoded(intent))
    f.h.m = types.SimpleNamespace(NODE='/opt/node-v24.18.1/bin/node')
    f.h.installer = types.SimpleNamespace(TARGET=Path('/opt/public-metadata-runtime'))
    entry = str(f.h.installer.TARGET / 'dist/metadata-worker.mjs')
    raw = '{ path=' + f.h.m.NODE + ' ; argv[]=' + f.h.m.NODE + ' ' + entry + ' ; ignore_errors=no ; start_time=[Sun 2026-10-25 04:00:39 UTC] ; stop_time=[n/a] ; pid=123 ; code=(null) ; status=0/0 }'
    cleared = raw.replace('Sun 2026-10-25 04:00:39 UTC', 'n/a').replace('; pid=123 ;', '; pid=0 ;')
    original = f.document(f.base / 'native-started.json')
    original['unit'].update(ExecStart=raw, MainPID='123', InvocationID='owned-native')
    (f.base / 'native-started.json').write_bytes(m.encoded(original))
    (parent.BASE / 'started-actor.json').write_bytes(m.encoded(original))
    f.actor['unit'].update(ExecStart=cleared, MainPID='123', InvocationID='owned-native')
    f.records['selected.json']['nativeActor'] = copy.deepcopy(f.actor)
    (f.base / 'selected.json').write_bytes(m.encoded(f.records['selected.json']))
    f.value['selectedReceiptSha256'] = m.sha((f.base / 'selected.json').read_bytes())
    f.db.update(scan={'ingestion_mode': 'native'}, approval={'state': 'ready', 'read_identity': f.meta.IDENTITY})
    f.h.refresh = lambda: f.guard.metadata_refresh(f.h.read_config)
    f.h.private = lambda old: None
    f.n.loaded = lambda *args: True
    f.n.UNIT = f.real.UNIT
    f.n.no_live_cli = lambda h: None
    f.h.m.run = lambda args: json.dumps({'type': 'a(sasbttttuii)', 'data': [[f.h.m.NODE, [f.h.m.NODE, entry], False, 0, 0, 0, 0, 0, 0, 0]]}).encode()
    completion.BASE = f.base.parent / 'new-reconciliation'
    previous_protected = parent.protected
    parent.protected = lambda p, digest=None: b'actual-fixed-diff-fixture' if p == completion.DIFF else previous_protected(p, digest)
    patcher = patch.object(completion, 'parent', return_value=parent)
    patcher.start()
    test.addCleanup(patcher.stop)
    f.h._completion_base = f.base
    binding, _ = completion.capture(parent, f.n, f.h, f.op)
    f.value['selectionCompletionSha256'] = completion.seal(parent, f.n, f.h, f.op, m.sha(m.encoded(binding)))
    real_module = m.module
    patcher = patch.object(m, 'module', side_effect=lambda p, digest: completion if p == m.COMPLETION else real_module(p, digest))
    patcher.start()
    test.addCleanup(patcher.stop)
    f.new_completion = completion
    _, _, chain = m.selection(f.n, f.h, f.value)
    f.binding = {'metadataChain': chain}
    return f


class Controls(unittest.TestCase):
    def test_all_functions_except_selection_are_AST_exact8076(self):
        raw = (HERE / 'ypal-ordinary-metadata-provenance-batches-v5.py').read_bytes()
        self.assertEqual(m.sha(raw), '8076f82a275d8ab146dee427482f66029e1d44bec36b309eb16afb9d5d524f18')
        def functions(raw):
            return {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(raw).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        before, after = functions(raw), functions(Path(m.__file__).read_bytes())
        self.assertEqual(set(before), set(after))
        self.assertEqual([k for k in before if before[k] != after[k]], ['selection'])
        self.assertNotEqual(m.INPUT, old.m.INPUT)
        self.assertNotEqual(m.BASE, old.m.BASE)
        self.assertNotEqual(m.FORMAT, old.m.FORMAT)

    def test_new_real_producers_pinned_and_old_input_refused(self):
        self.assertEqual(m.GUARD.name, 'ypal-ordinary-source-authority-v3.py')
        self.assertEqual(m.COMPLETION.name, 'ypal-ordinary-metadata-selection-reconcile-v1.py')
        self.assertEqual(m.sha((HERE / m.GUARD.name).read_bytes()), m.GUARD_SHA)
        self.assertEqual(m.sha((HERE / m.COMPLETION.name).read_bytes()), m.COMPLETION_SHA)
        value = old.config()
        self.assertRaises(RuntimeError, m.config, value)
        value['format'] = m.FORMAT + '-input'
        self.assertEqual(m.config(value), value)

    def test_genuine_guard_v3_constructor_is_consumed_without_old_alias(self):
        authority = load(HERE / m.GUARD.name)
        initial = {'ordinaryRuntime': {'resultSha256': 'a' * 64, 'inputSha256': 'b' * 64},
                   'readConfig': {'actual': 'READ'}, 'candidateReceiptSha256': 'c' * 64}
        owner = types.SimpleNamespace(actual=True)
        runtime = types.SimpleNamespace(Owner=lambda pin: owner)
        intake = types.SimpleNamespace(actual=True)
        common = types.SimpleNamespace(load_input=lambda pin: initial, metadata_namespace=lambda pin: 'real9b-namespace')
        with patch.object(authority, 'module', side_effect=lambda p, pin: runtime if p == authority.RUNTIME else intake), \
             patch.object(m, 'module', side_effect=lambda p, pin: common if p == m.COMMON else authority if p == m.GUARD else object()):
            _, value, guard, n = m.construct({'metadataInputSha256': m.METADATA_INPUT_SHA})
        self.assertIs(type(guard), authority.Authority)
        self.assertIs(guard.owner, owner)
        self.assertEqual(guard.result_sha, 'a' * 64)
        self.assertEqual(guard.input_sha, 'b' * 64)
        self.assertFalse(guard.ready)
        self.assertEqual(guard.read_config, initial['readConfig'])
        self.assertEqual(n, 'real9b-namespace')

    def test_actual_reconciliation_chain_and_first_zero_one_900_batch(self):
        f = fixture(self)
        f.value.update(format=m.FORMAT + '-input', firstIndex=0, maxBatches=1, maxSeconds=900)
        result = m.execute(f.n, f.h, f.guard, f.value, f.binding, f.op, f.records['selected.json'], f.run)
        self.assertEqual(result['acknowledgedBatchCount'], 1)
        self.assertEqual(f.dispatch, [('provenance-0', 'native-provenance')])
        self.assertFalse((f.completion.BASE / 'result.json').exists())
        self.assertFalse(f.document(f.new_completion.BASE / 'result.json')['parent9aSuccessClaimed'])

    def test_missing_or_foreign_reconciliation_ACK_is_not_adopted(self):
        f = fixture(self)
        path = f.new_completion.BASE / 'result.json'
        value = f.document(path)
        value['parent9aSuccessClaimed'] = True
        path.write_bytes(m.encoded(value))
        f.value['selectionCompletionSha256'] = m.sha(path.read_bytes())
        self.assertRaises(RuntimeError, m.selection, f.n, f.h, f.value)
        path.unlink()
        self.assertRaises(FileNotFoundError, m.selection, f.n, f.h, f.value)

    def test_changed_private_actor_or_command_cannot_use_reset_projection(self):
        for mode in ['actor', 'command']:
            f = fixture(self)
            if mode == 'actor':
                f.actor['processes'][0]['startTicks'] += 1
            else:
                f.actor['unit']['ExecStart'] = f.actor['unit']['ExecStart'].replace('ignore_errors=no', 'ignore_errors=yes')
            self.assertRaises(RuntimeError, m.selection, f.n, f.h, f.value)
            self.assertEqual(f.dispatch, [])


if __name__ == '__main__':
    unittest.main()
