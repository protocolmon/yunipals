"""Real provenance body and constructor contract, with synthetic live facts."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


m = load(HERE / 'ypal-ordinary-metadata-provenance-batches-v5.py')
c = load(HERE / m.COMMON.name)


def local(path, pin):
    raw = (HERE / Path(path).name).read_bytes()
    m.need(m.sha(raw) == pin, 'exact_local_source_required')
    return raw


def genuine():
    with patch.object(c, 'public', local):
        return c.metadata_namespace('c' * 64)


def config():
    return {'format': m.FORMAT + '-input', 'metadataInputSha256': m.METADATA_INPUT_SHA,
        'metadataOperationSha256': m.OPERATION_SHA, 'selectedReceiptSha256': 'b' * 64,
        'selectionCompletionSha256': 'd' * 64,
        'firstIndex': 0, 'maxBatches': 3, 'maxSeconds': 3600}


class Fixture:
    def __init__(self, test, genuine_body=True):
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.base, self.run = root / 'metadata', root / 'run'
        self.base.mkdir(mode=0o700)
        self.run.mkdir(mode=0o700)
        self.actor = {'unit': {'ExecMainStartTimestampMonotonic': '12', 'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target'},
                      'main': {'pid': 123, 'startTicks': 456}, 'processes': [{'pid': 123, 'startTicks': 456}]}
        self.boot = {'inode': 99, 'target': 'metadata-unit'}
        self.op = {'bootId': 'boot', 'oldBoot': self.boot, 'operation': 'actual-original'}
        self.meta = types.SimpleNamespace(IDENTITY='v5-identity', RELEASE='actual-release')
        self.db = {'remainingPublished': 10, 'probe': True}
        self.official_results = [{'stamped': 5000}, {'stamped': 5000}, {'stamped': 1}]
        self.dispatch, self.calls, self.finish_calls = [], [], 0
        self.fail, self.alter = None, None
        self.h = types.SimpleNamespace(s=types.SimpleNamespace(protected=lambda p: p.read_bytes(), document=self.document,
            save=lambda p, v: self.write(p, v), boot=lambda: 'boot'), meta=self.meta, query=self.query,
            actor=lambda *a: copy.deepcopy(self.actor), read_config={'admissionSha256': 'a' * 64},
            official=self.official, database=lambda: copy.deepcopy(self.db), publication_proof=lambda: {'allPublishedCanonical': True})
        self.guard = types.SimpleNamespace(metadata_refresh=self.refresh, finish=self.finish,
            binding={'source': 'same'}, expected={'private': 'same'})
        self.n = types.SimpleNamespace(BASE=self.base, BOOT=root / 'boot', operation=lambda *a: copy.deepcopy(self.op),
            link=lambda _: copy.deepcopy(self.boot), provenance=self.fake_provenance)
        self.real = genuine()
        self.real.BASE = self.base
        self.n.start_intent_actor = self.real.start_intent_actor
        if genuine_body:
            self.n.provenance = self.real.provenance
        self.value = config()
        started = copy.deepcopy(self.actor)
        started['unit'].update(UnitFileState='disabled', WantedBy='')
        result = {'adopted': True, 'releaseId': self.meta.RELEASE, 'readIdentity': self.meta.IDENTITY, 'legacyNextBlock': '11'}
        sample = {'scan': {'ingestion_mode': 'native'}, 'probe': True,
                  'approval': {'read_identity': self.meta.IDENTITY, 'state': 'ready'}}
        self.records = {name: {} for name in m.CHAIN}
        self.records.update({'operation.json': self.op, 'drained.json': {'scan': {'next_block': 11}},
            'adopt-intent.json': {'command': 'native-adopt', 'bootId': 'boot'}, 'adopt-result.json': result,
            'adopted.json': {'officialAcknowledgementPresent': True, 'result': result},
            'native-start-intent.json': {'bootId': 'boot', 'monotonicUs': 10}, 'native-started.json': started,
            'native-observed.json': {'nativeWorkerFunctional': True, 'elapsedSeconds': 20, 'samples': [sample] * 3},
            'boot-publish-intent.json': self.boot,
            'selected.json': {'nativeActor': self.actor, 'boot': self.boot, 'selected': True, 'provenanceComplete': False}})
        for name, value in self.records.items():
            self.write(self.base / name, value)
        self.value['metadataOperationSha256'] = m.sha((self.base / 'operation.json').read_bytes())
        self.value['selectedReceiptSha256'] = m.sha((self.base / 'selected.json').read_bytes())
        self.binding = {'metadataChain': {name: m.sha((self.base / name).read_bytes()) for name in m.CHAIN}}
        self.completion = load(HERE / m.COMPLETION.name)
        self.completion.BASE = root / 'completion'
        self.completion.BASE.mkdir(mode=0o700)
        self.completion.OPERATION_SHA = self.value['metadataOperationSha256']
        self.completion.protected = lambda path, digest=None: Path(path).read_bytes()
        own_intent = {'format': self.completion.FORMAT, 'operatorSha256': m.COMPLETION_SHA,
            'originalOperationSha256': self.value['metadataOperationSha256'], 'originalInputSha256': m.METADATA_INPUT_SHA,
            'bootId': 'boot', 'monotonicUs': 10, 'deadlineUs': 900000010,
            'binding': {'originalOperationSha256': self.value['metadataOperationSha256'],
                        'records': {'native-start-intent.json': m.sha((self.base / 'native-start-intent.json').read_bytes())}}}
        intent_sha = self.write(self.completion.BASE / 'start-intent.json', own_intent)
        actor_sha = self.write(self.completion.BASE / 'started-actor.json', started)
        result = {'format': self.completion.FORMAT, 'operatorSha256': m.COMPLETION_SHA,
            'originalOperationSha256': self.value['metadataOperationSha256'], 'actualSelectedReceiptSha256': self.value['selectedReceiptSha256'],
            'ownStartIntentSha256': intent_sha, 'completed': True, 'originalFailedSelectReclassified': False,
            'originalSelectCliAcknowledgementClaimed': False}
        self.value['selectionCompletionSha256'] = self.write(self.completion.BASE / 'result.json', result)
        self.binding['metadataChain'].update(selectionCompletionSha256=self.value['selectionCompletionSha256'],
            selectionCompletionStartIntentSha256=intent_sha, selectionCompletionActorSha256=actor_sha)
        original_module = m.module
        patcher = patch.object(m, 'module', side_effect=lambda path, digest: self.completion if path == m.COMPLETION else original_module(path, digest))
        patcher.start()
        test.addCleanup(patcher.stop)

    def write(self, path, value):
        raw = m.encoded(value)
        with path.open('xb') as stream:
            stream.write(raw)
        path.chmod(0o600)
        return m.sha(raw)

    def document(self, path, digest=None):
        raw = path.read_bytes()
        if digest is not None:
            m.need(m.sha(raw) == digest, 'wrong_document_hash')
        return json.loads(raw)

    def query(self, sql):
        if sql != m.INDEX_SQL:
            raise AssertionError('unexpected query')
        return copy.deepcopy(m.INDEX_EXPECTED)

    def refresh(self, config):
        self.calls.append('current')
        if self.fail == 'current':
            raise RuntimeError('fresh_source_or_READ_changed')
        return {'validated': True}

    def finish(self):
        self.finish_calls += 1
        if self.fail == 'finish':
            raise RuntimeError('full_postflight_refused')
        return {'validated': True, 'full5aPostflight': True}

    def official(self, name, command):
        self.dispatch.append((name, command))
        self.write(self.base / (name + '-intent.json'), {'command': command, 'bootId': 'boot'})
        self.write(self.base / (name + '-child.json'), {'pid': 1234, 'startTicks': 789})
        if self.fail == 'unknown':
            raise RuntimeError('official_metadata_command_ack_unknown_inspect_do_not_repeat')
        result = self.official_results.pop(0)
        self.write(self.base / (name + '-result.json'), result)
        if self.alter == 'actor':
            self.actor['main']['startTicks'] += 1
        if self.alter == 'selection':
            (self.base / 'selected.json').write_bytes(m.encoded({'foreign': True}))
        if self.alter == 'source':
            self.fail = 'current'
        return result

    def fake_provenance(self, h, op, index):
        raise AssertionError('genuine body required')

    def execute(self):
        return m.execute(self.n, self.h, self.guard, self.value, self.binding, self.op,
                         copy.deepcopy(self.records['selected.json']), self.run)


class Controls(unittest.TestCase):
    def test_fixed_dependencies_and_inert_default(self):
        for path, digest in [(m.COMMON, m.COMMON_SHA), (m.OWNER, m.OWNER_SHA), (m.GUARD, m.GUARD_SHA), (m.COMPLETION, m.COMPLETION_SHA)]:
            self.assertEqual(m.sha((HERE / path.name).read_bytes()), digest)
        out = subprocess.run(['/usr/bin/python3', '-I', '-B', m.__file__], capture_output=True, check=True)
        value = json.loads(out.stdout)
        self.assertTrue(value['staticOnly'])
        self.assertEqual(value['databaseWrites'], 0)

    def test_actual_input_no_future_defaults_or_expanded_limits(self):
        self.assertEqual(m.config(config()), config())
        for field, values in {'metadataInputSha256': ['0' * 64, '1' * 64], 'metadataOperationSha256': ['1' * 64],
            'selectedReceiptSha256': ['0' * 64, None], 'firstIndex': [-1, 128, True],
            'selectionCompletionSha256': ['0' * 64, None],
            'maxBatches': [0, 129, True], 'maxSeconds': [719, 3601, True]}.items():
            for value in values:
                changed = config()
                changed[field] = value
                self.assertRaises(RuntimeError, m.config, changed)
        value = config()
        value.update(firstIndex=127, maxBatches=2)
        self.assertRaises(RuntimeError, m.config, value)

    def test_genuine_provenance_body_is_not_replaced(self):
        f = Fixture(self)
        raw = ast.parse((HERE / 'ypal-restored-metadata-handover-v1.py').read_text())
        actual = next(n for n in raw.body if isinstance(n, ast.FunctionDef) and n.name == 'provenance')
        self.assertEqual(f.real.provenance.__code__.co_code, compile(ast.Module([actual], []), '<real>', 'exec').co_consts[0].co_code)
        source = Path(m.__file__).read_text()
        self.assertIn('result = n.provenance(h, op, number)', source)
        self.assertNotIn('Popen(', source)
        for index in [-1, 128, True]:
            self.assertRaises(RuntimeError, f.real.provenance, f.h, f.op, index)
        self.assertEqual(f.dispatch, [])

    def test_actual_constructor_receives_fresh_guard_and_original_execution(self):
        events = []
        refs = {'readPlanSha256': 'p'}
        initial = {'readConfig': refs, 'candidateInputSha256': 'candidate', 'sourcesSha256': 'source'}
        guard = types.SimpleNamespace(preflight=lambda: events.append('preflight'),
                                     metadata_refresh=lambda v: events.append(('refresh', v)) or 'live')
        genuine_construct = load(HERE / 'ypal-restored-metadata-handover-v1.py').construct_context
        class Host:
            def __init__(self, *args, **kwargs):
                events.append(('construct', args, kwargs))
                self.refresh_callback = args[1]
        fn = types.FunctionType(genuine_construct.__code__, {**genuine_construct.__globals__, 'Host': Host},
                                argdefs=genuine_construct.__defaults__)
        common = types.SimpleNamespace(metadata_primitives=lambda v: {'candidate': v}, admission_reference=lambda v: {'refs': v},
            execution_context=lambda h, v: events.append(('execution', v)))
        h = m.host(common, initial, guard, types.SimpleNamespace(construct_context=fn), 'originalbc')
        self.assertEqual(events[0], 'preflight')
        self.assertEqual(events[1][1][2:], (False, {'candidate': 'candidate'}, {'refs': refs}))
        self.assertEqual(h.execution_context, {'inputSha256': 'originalbc', 'sourcesSha256': 'source'})
        self.assertEqual(h.refresh_callback(), 'live')
        self.assertEqual(events[-1], ('refresh', refs))

    def test_selection_actual_start_boot_and_adoption_chain(self):
        f = Fixture(self)
        op, selected, hashes = m.selection(f.n, f.h, f.value)
        self.assertEqual(op, f.op)
        self.assertEqual(selected['nativeActor'], f.actor)
        self.assertEqual(hashes, f.binding['metadataChain'])
        (f.base / 'inverse-intent.json').write_text('{}')
        self.assertRaises(RuntimeError, m.selection, f.n, f.h, f.value)

    def test_selection_hash_actor_epoch_boot_and_acceptance_refusals(self):
        for mode in ['hash', 'actor', 'boot', 'start', 'acceptance', 'adopt']:
            f = Fixture(self)
            if mode == 'hash':
                f.value['selectedReceiptSha256'] = '0' * 64
            elif mode == 'actor':
                f.actor['main']['startTicks'] += 1
            elif mode == 'boot':
                f.boot['inode'] += 1
            else:
                name = {'start': 'native-start-intent.json', 'acceptance': 'native-observed.json', 'adopt': 'adopted.json'}[mode]
                value = f.document(f.base / name)
                if mode == 'start': value['monotonicUs'] = 13
                if mode == 'acceptance': value['nativeWorkerFunctional'] = False
                if mode == 'adopt': value['officialAcknowledgementPresent'] = False
                (f.base / name).write_bytes(m.encoded(value))
            self.assertRaises(RuntimeError, m.selection, f.n, f.h, f.value)

    def test_missing_foreign_or_old_select_claimed_completion_refuses(self):
        for mode in ['missing', 'foreign', 'old-select-claim', 'wrong-selected', 'wrong-start-intent']:
            f = Fixture(self)
            path = f.completion.BASE / 'result.json'
            if mode == 'missing':
                path.unlink()
                self.assertRaises(FileNotFoundError, m.selection, f.n, f.h, f.value)
                continue
            value = f.document(path)
            if mode == 'foreign': value['operatorSha256'] = 'f' * 64
            if mode == 'old-select-claim': value['originalSelectCliAcknowledgementClaimed'] = True
            if mode == 'wrong-selected': value['actualSelectedReceiptSha256'] = 'e' * 64
            if mode == 'wrong-start-intent': value['ownStartIntentSha256'] = 'e' * 64
            path.write_bytes(m.encoded(value))
            f.value['selectionCompletionSha256'] = m.sha(path.read_bytes())
            self.assertRaises(RuntimeError, m.selection, f.n, f.h, f.value)

    def test_actual_first_index_zero_single_batch_900_second_proposal(self):
        f = Fixture(self)
        f.value.update(firstIndex=0, maxBatches=1, maxSeconds=900)
        result = f.execute()
        self.assertEqual(f.dispatch, [('provenance-0', 'native-provenance')])
        self.assertEqual(result['acknowledgedBatchCount'], 1)
        self.assertEqual(result['stamped'], 5000)

    def test_genuine_lost_start_ACK_completion_without_optional_actor_record(self):
        f = Fixture(self)
        (f.completion.BASE / 'started-actor.json').unlink()
        f.binding['metadataChain']['selectionCompletionActorSha256'] = None
        f.value['maxBatches'] = 1
        self.assertEqual(f.execute()['acknowledgedBatchCount'], 1)

    def test_exact_installed_index_required_without_DDL(self):
        f = Fixture(self)
        self.assertEqual(m.index_current(f.h)['indexOid'], '77273352')
        for key in ['indexOid', 'tableOid', 'databaseOid', 'definition', 'valid', 'ready', 'live', 'method', 'keys']:
            value = copy.deepcopy(m.INDEX_EXPECTED)
            value[key] = False if type(value[key]) is bool else 'changed'
            f.h.query = lambda sql, value=value: value
            self.assertRaises(RuntimeError, m.index_current, f.h)
        self.assertNotIn('CREATE INDEX', m.INDEX_SQL)

    def test_contiguous_genuine_5000_batches_and_original_receipts(self):
        f = Fixture(self)
        value = f.execute()
        self.assertEqual(f.dispatch, [('provenance-' + str(i), 'native-provenance') for i in range(3)])
        self.assertEqual(value['stamped'], 10001)
        self.assertEqual(value['acknowledgedBatchCount'], 3)
        self.assertEqual(f.finish_calls, 1)
        for index in range(3):
            observed = f.document(f.base / ('provenance-' + str(index) + '-observed.json'))
            self.assertTrue(observed['unmatchedRowsNotDeletedOrManufactured'])
            self.assertFalse(observed['completeForCurrentPublishedArchiveBase'])
        self.assertTrue(f.document(f.run / 'result.json')['unmatchedRowsDeleted'] is False)

    def test_busy_stops_after_one_and_does_not_retry(self):
        f = Fixture(self)
        f.official_results = [{'busy': True}]
        value = f.execute()
        self.assertEqual(value['stopReason'], 'busy')
        self.assertEqual(len(f.dispatch), 1)
        self.assertTrue(f.document(f.base / 'provenance-0-observed.json')['busy'])

    def test_zero_progress_stops_even_when_remaining_is_nonzero(self):
        f = Fixture(self)
        f.official_results = [{'stamped': 0}]
        value = f.execute()
        self.assertEqual(value['stopReason'], 'zero-progress')
        self.assertEqual(len(f.dispatch), 1)
        self.assertFalse(value['completeForCurrentPublishedArchiveBase'])

    def test_only_genuine_publication_proof_completes(self):
        f = Fixture(self)
        f.db['remainingPublished'] = 0
        f.official_results = [{'stamped': 7}]
        value = f.execute()
        self.assertEqual(value['stopReason'], 'original-publication-complete')
        self.assertTrue(value['completeForCurrentPublishedArchiveBase'])
        self.assertEqual(len(f.dispatch), 1)
        f = Fixture(self)
        f.db['remainingPublished'] = 0
        f.h.publication_proof = lambda: {'allPublishedCanonical': False}
        self.assertFalse(f.execute()['completeForCurrentPublishedArchiveBase'])

    def test_original_stamped_cap_enforced_and_unknown_retained(self):
        for result in [{'stamped': 5001}, {'stamped': True}, {'stamped': -1}]:
            f = Fixture(self)
            f.official_results = [result]
            self.assertRaises(RuntimeError, f.execute)
            self.assertTrue((f.base / 'provenance-0-result.json').exists())
            self.assertFalse((f.base / 'provenance-0-observed.json').exists())
            self.assertEqual(len(f.dispatch), 1)
            self.assertEqual(f.finish_calls, 1)

    def test_every_existing_unknown_prefix_refuses_without_dispatch(self):
        for suffix in ['-intent.json', '-child.json', '-result.json', '-observed.json', '.stdout.private', '.stderr.private', '-foreign.json']:
            f = Fixture(self)
            (f.base / ('provenance-0' + suffix)).write_text('{}')
            self.assertRaises(RuntimeError, f.execute)
            self.assertEqual(f.dispatch, [])
            self.assertEqual(f.finish_calls, 1)
        f = Fixture(self)
        (f.base / 'provenance-10-intent.json').write_text('{}')
        self.assertEqual(m.attempt_files(f.base, 1), [])

    def test_lost_original_ack_never_replayed_or_relabelled(self):
        f = Fixture(self)
        f.fail = 'unknown'
        self.assertRaises(RuntimeError, f.execute)
        self.assertEqual(len(f.dispatch), 1)
        self.assertTrue((f.base / 'provenance-0-intent.json').exists())
        self.assertTrue((f.base / 'provenance-0-child.json').exists())
        self.assertFalse((f.base / 'provenance-0-observed.json').exists())
        self.assertFalse((f.run / 'result.json').exists())
        self.assertFalse(f.document(f.run / 'failed.json')['automaticRetryAllowed'])

    def test_actor_selection_or_fresh_source_change_after_effect_fails(self):
        for mode in ['actor', 'selection', 'source']:
            f = Fixture(self)
            f.alter = mode
            self.assertRaises((RuntimeError, KeyError), f.execute)
            self.assertEqual(len(f.dispatch), 1)
            self.assertTrue((f.base / 'provenance-0-observed.json').exists())
            self.assertFalse((f.run / '0-observed.json').exists())
            self.assertEqual(f.finish_calls, 1)

    def test_source_before_dispatch_and_postflight_failure_do_not_fabricate_success(self):
        f = Fixture(self)
        f.fail = 'current'
        self.assertRaises(RuntimeError, f.execute)
        self.assertEqual(f.dispatch, [])
        f = Fixture(self)
        f.fail = 'finish'
        self.assertRaises(RuntimeError, f.execute)
        self.assertEqual(len(f.dispatch), 3)
        self.assertFalse((f.run / 'result.json').exists())

    def test_660_child_time_reserved_and_no_dispatch_after_deadline(self):
        f = Fixture(self)
        with patch.object(m.time, 'monotonic', side_effect=[0, 3000, 3001]):
            value = f.execute()
        self.assertEqual(value['stopReason'], 'dispatch-deadline')
        self.assertEqual(f.dispatch, [])

    def test_slow_fresh_prechecks_cannot_consume_child_reservation(self):
        f = Fixture(self)
        with patch.object(m.time, 'monotonic', side_effect=[0, 1, 3000, 3001]):
            value = f.execute()
        self.assertEqual(value['stopReason'], 'dispatch-deadline')
        self.assertEqual(f.dispatch, [])

    def test_prior_requires_actual_result_intent_observed_chain(self):
        f = Fixture(self)
        self.assertRaises(FileNotFoundError, m.prior, f.n, f.h, 1)
        f.value['maxBatches'] = 1
        f.execute()
        result = m.prior(f.n, f.h, 1)
        self.assertIn('provenance-0', result)
        observed = f.document(f.base / 'provenance-0-observed.json')
        observed['officialResult'] = {'stamped': 123}
        (f.base / 'provenance-0-observed.json').write_bytes(m.encoded(observed))
        self.assertRaises(RuntimeError, m.prior, f.n, f.h, 1)

    def test_exclusive_real_FS_journals_do_not_replace_foreign_files(self):
        f = Fixture(self)
        m.save(f.run, 'foreign.json', {'preserved': True})
        before = (f.run / 'foreign.json').stat()
        self.assertEqual(before.st_mode & 0o777, 0o600)
        self.assertRaises(FileExistsError, m.save, f.run, 'foreign.json', {'overwrite': True})
        self.assertEqual((f.run / 'foreign.json').stat().st_ino, before.st_ino)
        (f.run / 'symlink.json').symlink_to(f.run / 'foreign.json')
        self.assertRaises(FileExistsError, m.save, f.run, 'symlink.json', {})
        m.mkdir(f.run / 'new')
        self.assertEqual((f.run / 'new').stat().st_mode & 0o777, 0o700)
        self.assertRaises(FileExistsError, m.mkdir, f.run / 'new')


if __name__ == '__main__':
    unittest.main()
