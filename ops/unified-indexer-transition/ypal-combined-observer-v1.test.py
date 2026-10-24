"""Offline synthetic root-launcher controls; no host, child, SQL or provider execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('observer_owner', HERE / 'ypal-combined-observer-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def config(): return m.configuration('synthetic-base-001', [8453], 'ab' * 32)


def observation():
    return {'revision': '1', 'head_number': '101', 'head_hash': '0x' + '11' * 32, 'head_timestamp': '1000',
            'finalized_number': None, 'finalized_hash': None, 'witness_number': '100', 'witness_hash': '0x' + '22' * 32,
            'observed_at_ms': str(int(time.time() * 1000)), 'provider_id': 'synthetic', 'anchors': {}, 'halted': False,
            'error_code': None, 'finality_error_code': 'finality_unavailable'}


def payload(mode):
    value = {'format': 'yunipals-ypal-combined-observer-v1', 'releaseId': m.RELEASE, 'manifestHash': m.MANIFEST,
             'buildId': '71e2a7f3b7', 'rootReadAdmissionReference': config()['readAdmissionSha256'],
             'rootReadAdmissionVerifiedHere': False, 'sourceReadinessQualified': False}
    if mode == 'inspect': return {**value, 'inspected': True, 'rpcCalls': 0, 'writeStatements': 0}
    return {**value, 'completed': True, 'successful': True, 'paidAuthority': False, 'nativeDataWritten': False,
            'canonicalNativeWitnessCreated': False, 'receiptQueries': 0, 'requests': {'rpcCalls': 5, 'responseBytes': 500, 'failed': False},
            'results': [{'chainId': 8453, 'executed': True, 'observed': 'observed', 'observation': observation()}]}


class Tests(unittest.TestCase):
    def test_frozen_runner_pin_and_bounded_fixed_configuration(self):
        self.assertEqual(hashlib.sha256((HERE / 'ypal-combined-observer-v1.mjs').read_bytes()).hexdigest(), m.ENTRY_SHA)
        self.assertEqual(hashlib.sha256((HERE / 'ypal-combined-observer-context-v1.mjs').read_bytes()).hexdigest(), m.CONTEXT_SHA)
        for run, chains, ack in [('../foreign', [8453], 'ab' * 32), ('valid-run', [8453, 8453], 'ab' * 32), ('valid-run', [10], 'ab' * 32), ('valid-run', [8453], '')]:
            with self.assertRaises(RuntimeError): m.configuration(run, chains, ack)

    def test_exact_peer_command_never_copies_credentials_and_sets_all_capability_guards(self):
        command = m.command(config(), 'observe-once', 1234)
        for value in ['--reuid=969', '--regid=963', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', '/usr/bin/env', '-i']:
            self.assertIn(value, command)
        self.assertIn('YUNIPALS_OBSERVER_PARENT_PID=1234', command)
        self.assertIn('TSX_DISABLE_CACHE=1', command)
        self.assertIn('YUNIPALS_OBSERVER_PUBLIC_CONTEXT=public6e-v1', command)
        self.assertNotIn('tsx', command)
        self.assertLess(command.index(str(m.TSX)), command.index(str(m.CONTEXT)))
        self.assertFalse(any('DATABASE_URL' in v or 'PERMIT' in v or 'PGPASSWORD' in v for v in command))
        self.assertEqual(command[-2:], ['observe-once', '8453'])

    def test_read_ACK_requires_actual_new_producer_and_source_identity(self):
        source = {'releaseId': m.RELEASE, 'schema': m.NATIVE, 'schemaOid': '75963410', 'buildId': '71e2a7f3b7', 'manifestHash': m.MANIFEST,
                  'sourceReceiptSha256': 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'}
        proof = {'validated': True, 'operatorSha256': m.READ_OWNER_SHA, 'receiptSha256': config()['readAdmissionSha256'],
                 'originalWholeValidatorPassed': False, 'consumerSelectionsQualified': False, 'sourceBinding': source}
        owner = types.SimpleNamespace(validate_current=lambda _: proof)
        self.assertEqual(m.qualify(owner, config()), source)
        proof['sourceBinding']['schemaOid'] = 'foreign'
        with self.assertRaises(RuntimeError): m.qualify(owner, config())

    def context(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup); base = Path(temp.name)
        self.enterContext(patch.object(m, 'BASE', base)); self.enterContext(patch.object(m, 'boot', return_value='boot'))
        self.enterContext(patch.object(m, 'protected', side_effect=lambda p, cap=3000000: Path(p).read_bytes()))
        self.enterContext(patch.object(m, 'qualify', return_value={'source': 'same-owned-source'}))
        state = {'native': {'buildId': '71e2a7f3b7', 'frameworkReady': '0', 'heartbeat': 'first'}, 'control': []}
        self.enterContext(patch.object(m, 'current', side_effect=lambda *_: copy.deepcopy(state)))
        return base, state

    def test_default_review_has_no_child_or_artifact_writes_and_hash_ignores_live_heartbeat(self):
        base, state = self.context()
        with patch.object(m, 'child', side_effect=AssertionError('must_not_execute')):
            one = m.review(None, config()); state['native']['heartbeat'] = 'later'; two = m.review(None, config())
        self.assertEqual(one['reviewHash'], two['reviewHash']); self.assertEqual(list(base.iterdir()), [])

    def test_explicit_observe_qualifies_peer_readonly_before_durable_intent_then_once(self):
        base, state = self.context(); seen = []
        def child(conf, mode, deadline, on_started=None):
            seen.append(mode); directory = base / conf['runId']
            if mode == 'inspect': self.assertFalse(directory.exists())
            else:
                self.assertTrue((directory / 'intent.json').exists()); self.assertFalse((directory / 'result.json').exists())
                on_started({'pid': 1234, 'processGroup': 1234, 'bootId': 'boot'})
            value = payload(mode)
            if mode == 'observe-once': state['control'] = [{'chainId': 8453, 'status': value['results'][0]['observation'], 'witnessCanonical': True}]
            return {'returncode': 0, 'timedOut': False, 'stdout': m.encoded(value), 'stderr': b''}
        with patch.object(m, 'child', side_effect=child):
            reviewed = m.review(None, config()); result = m.observe(None, config(), reviewed['reviewHash'])
            self.assertTrue(result['completed']); self.assertFalse(result['sourceReadinessClaimed'])
            with self.assertRaises(RuntimeError): m.observe(None, config(), m.review(None, config())['reviewHash'])
        self.assertEqual(seen, ['inspect', 'observe-once'])

    def test_failed_peer_inspection_has_no_write_intent(self):
        base, _ = self.context(); reviewed = m.review(None, config())
        with patch.object(m, 'child', return_value={'returncode': 1, 'timedOut': False, 'stdout': b'', 'stderr': b'withheld'}):
            with self.assertRaises(RuntimeError): m.observe(None, config(), reviewed['reviewHash'])
        self.assertFalse((base / config()['runId']).exists())

    def test_unknown_child_ACK_preserves_intent_and_inspect_does_not_repeat(self):
        base, state = self.context(); seen = []
        def child(conf, mode, deadline, on_started=None):
            seen.append(mode)
            if mode == 'inspect': return {'returncode': 0, 'timedOut': False, 'stdout': m.encoded(payload(mode)), 'stderr': b''}
            self.assertTrue((base / conf['runId'] / 'intent.json').exists()); raise RuntimeError('lost_child_ACK')
        with patch.object(m, 'child', side_effect=child):
            reviewed = m.review(None, config())
            with self.assertRaisesRegex(RuntimeError, 'lost_child_ACK'): m.observe(None, config(), reviewed['reviewHash'])
            directory = base / config()['runId']; self.assertTrue((directory / 'unknown.json').exists()); self.assertFalse((directory / 'result.json').exists())
            inspected = m.inspect(None, config())
            self.assertTrue(inspected['attempt']['outcomeMayBeUnknown']); self.assertFalse(inspected['successInferredFromCatalogAlone'])
        self.assertEqual(seen, ['inspect', 'observe-once'])

    def test_canonical_confirmation_requires_exact_text_types_revision_branch_and_freshness(self):
        value = payload('observe-once'); status = value['results'][0]['observation']; control = {'control': [{'chainId': 8453, 'status': copy.deepcopy(status), 'witnessCanonical': True}]}
        m.confirm_control(value, control, [8453], int(status['observed_at_ms']))
        for edit in [lambda v: v['control'][0].update(witnessCanonical=False), lambda v: v['control'][0]['status'].update(revision='2'),
                     lambda v: v['control'][0]['status'].update(witness_number=100), lambda v: v['control'][0]['status'].update(halted=True)]:
            bad = copy.deepcopy(control); edit(bad)
            with self.assertRaises(RuntimeError): m.confirm_control(value, bad, [8453], int(status['observed_at_ms']))
        with self.assertRaises(RuntimeError): m.confirm_control(value, control, [8453], int(status['observed_at_ms']) + 180001)

    def test_timeout_kills_only_new_owned_process_group_without_retry(self):
        proc = types.SimpleNamespace(pid=3456, returncode=-9)
        calls = []
        def communicate(timeout):
            calls.append(timeout)
            if len(calls) == 1: raise subprocess.TimeoutExpired('fixed-peer', timeout)
            return b'', b''
        proc.communicate = communicate; proc.poll = lambda: -9; proc.wait = lambda timeout: None
        with patch.object(m.subprocess, 'Popen', return_value=proc) as popen, patch.object(m.os, 'getpgid', return_value=3456), patch.object(m.os, 'killpg') as kill, patch.object(m.time, 'monotonic', return_value=1), patch.object(m, 'boot', return_value='boot'):
            result = m.child(config(), 'observe-once', 151)
        self.assertTrue(result['timedOut']); kill.assert_called_once_with(3456, signal.SIGKILL); self.assertEqual(popen.call_count, 1)
        self.assertEqual(calls[0], 150)

    def test_world_writable_nonsticky_operation_ancestor_refuses_before_create(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        parent = Path(temp.name) / 'untrusted'; parent.mkdir(); parent.chmod(0o777)
        with patch.object(m, 'BASE', parent / 'operations'):
            with self.assertRaisesRegex(RuntimeError, 'protected_observer_operation_ancestry_required'): m.operation_directory(config())
            self.assertFalse(m.BASE.exists())


if __name__ == '__main__': unittest.main()
