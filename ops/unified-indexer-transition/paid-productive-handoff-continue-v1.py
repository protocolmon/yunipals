#!/usr/bin/env python3
"""Explicit continuation of inert v4 handoff; no reinstall, renewal or retry."""
import argparse
import ctypes
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import signal
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEMD = Path('/etc/systemd/system')
PACKAGE = OPS / 'paid-productive-package-20261021-b'
OUTPUT = OPS / 'paid-productive-v4-handoff-continuation-1'
FORMAT = 'yunipals-productive-handoff-continuation-v1'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
STARTER_SHA = '0605db2a4736c9aba7b078c2a307341aa3bca986c1c6c215801837129c3f5b5d'
RESULT_SHA = '4e7f0712c7b8cf8c3406d6c8d73ec40b69836b326a7036ce48b53da28bca09b8'
INTENT_SHA = 'f7ca26a3139e3545e4d99c2c71d2c35dd75f113e5b637698c413879e9448ef6b'
MAXIMUM_PREPARATION_SECONDS = 1200
FRAME_FILES = {'paid-productive-handoff-continue-v1.py', 'paid-productive-start-v4.py', 'paid-productive-spec-v4.py',
               'paid-productive-live-v4.py', 'paid-productive-epoch-v4.py', 'paid-productive-native-v6.py',
               'paid-owner-workspace-reader-v1.py', 'paid-capability-live-v1.py', 'source6-paid-epoch-v1.py'}


def fail(label): raise RuntimeError(label)


def modules():
    import hashlib
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        value = item.lstat()
        if item.is_symlink() or value.st_uid != 0 or value.st_mode & 0o022: fail('protected_frozen_loader_required')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != Q_SHA: fail('exact_frozen_loader_required')
    q = types.ModuleType('handoff_continuation_Q'); q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    starter = q.load(OPS / 'paid-productive-start-v4.py', STARTER_SHA, 'retained_failed_starter')
    q, constructor, model, epoch, native, live = starter.modules()
    return q, starter, constructor, model, epoch, native, live


class OldExecutorReferences:
    """One persistent bus; only the two exact owned old executor metadata refs."""
    def __init__(self, q, model, plan, prior):
        self.q = q; self.rows = prior['timers']; self.sha = model.digest(plan)
        self.units = []; self.held = []; self.bus = ctypes.c_void_p(); self.lib = None; self.started = None
        if len(self.rows) != 2 or {r['kind'] for r in self.rows} != {'deadline', 'utc'}: fail('exact_old_executor_pair_required')
        for row in self.rows:
            prefix = 'yunipals-paid-productive-v3-' + row['kind'] + '-' + self.sha[:16]
            if (row['timerUnit'] != prefix + '.timer' or row['serviceUnit'] != prefix + '.service' or
                    set(row['definitions']) != {str(SYSTEMD / (prefix + '.timer')), str(SYSTEMD / (prefix + '.service'))}):
                fail('only_exact_old_owned_executor_refs_allowed')
            self.units.append(row['serviceUnit'])
        self.seal = q.sha(q.encoded(self.rows)); self.check_files()
    def check_files(self):
        if self.q.sha(self.q.encoded(self.rows)) != self.seal: fail('immutable_old_executor_reference_binding_required')
        for row in self.rows:
            if any(self.q.sha(self.q.protected(Path(path), 50_000)) != expected for path, expected in row['definitions'].items()):
                fail('old_executor_definition_changed')
    def check_metadata(self):
        for unit in self.units:
            raw = self.q.run(['/usr/bin/systemctl', 'show', '--all', unit, '--property=Id,FragmentPath,DropInPaths'], timeout=5)
            value = {}
            for line in raw.splitlines():
                key, sep, item = line.partition('=')
                if not sep or key in value: fail('unique_referenced_executor_metadata_required')
                value[key] = item
            if value != {'Id': unit, 'FragmentPath': str(SYSTEMD / unit), 'DropInPaths': ''}:
                fail('exact_referenced_executor_fragment_without_dropins_required')
    def call(self, method, unit):
        if method not in {'RefUnit', 'UnrefUnit'} or unit not in self.units: fail('metadata_references_are_not_job_control')
        reply = ctypes.c_void_p()
        try:
            result = self.lib.sd_bus_call_method(self.bus, b'org.freedesktop.systemd1', b'/org/freedesktop/systemd1',
                b'org.freedesktop.systemd1.Manager', method.encode(), None, ctypes.byref(reply), b's', ctypes.c_char_p(unit.encode()))
            if result < 0: fail('exact_old_executor_reference_failed')
        finally:
            if reply.value: self.lib.sd_bus_message_unref(reply)
    def __enter__(self):
        if self.lib is not None: fail('old_executor_reference_cannot_be_reused')
        self.started = time.monotonic(); self.lib = ctypes.CDLL('libsystemd.so.0')
        self.lib.sd_bus_open_system.argtypes = [ctypes.POINTER(ctypes.c_void_p)]; self.lib.sd_bus_open_system.restype = ctypes.c_int
        self.lib.sd_bus_set_method_call_timeout.argtypes = [ctypes.c_void_p, ctypes.c_uint64]; self.lib.sd_bus_set_method_call_timeout.restype = ctypes.c_int
        self.lib.sd_bus_call_method.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p,
            ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p]; self.lib.sd_bus_call_method.restype = ctypes.c_int
        self.lib.sd_bus_message_unref.argtypes = [ctypes.c_void_p]; self.lib.sd_bus_message_unref.restype = ctypes.c_void_p
        self.lib.sd_bus_flush_close_unref.argtypes = [ctypes.c_void_p]; self.lib.sd_bus_flush_close_unref.restype = ctypes.c_void_p
        try:
            if self.lib.sd_bus_open_system(ctypes.byref(self.bus)) < 0 or not self.bus.value: fail('bounded_owned_reference_bus_required')
            if self.lib.sd_bus_set_method_call_timeout(self.bus, 3_000_000) < 0: fail('bounded_owned_reference_call_required')
            # RefUnit loads and references the unit atomically, with no job.
            for unit in self.units: self.call('RefUnit', unit); self.held.append(unit)
            self.check_files(); self.check_metadata(); return self
        except BaseException:
            self.close(); raise
    def close(self):
        try:
            for unit in reversed(self.held): self.call('UnrefUnit', unit)
        finally:
            self.held = []
            if self.lib is not None and self.bus.value:
                self.lib.sd_bus_flush_close_unref(self.bus); self.bus = ctypes.c_void_p()
    def __exit__(self, kind, error, traceback):
        try:
            if kind is None:
                self.check_files()
                self.check_metadata()
                if time.monotonic() - self.started > 120: fail('old_executor_metadata_reference_expired')
        finally: self.close()


def failure(error):
    frames = []; labels = set(); trace = error.__traceback__
    while trace:
        code = trace.tb_frame.f_code; path = Path(code.co_filename)
        if path.parent == OPS and path.name in FRAME_FILES:
            if re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}', code.co_name):
                frames.append({'file': path.name, 'function': code.co_name, 'line': trace.tb_lineno})
            if error.args and isinstance(error.args[0], str) and error.args[0] in code.co_consts: labels.add(error.args[0])
        trace = trace.tb_next
    return {'errorClass': type(error).__name__, 'fixedCodeLabels': sorted(labels), 'publicFrames': frames[-10:],
            'errno': error.errno if isinstance(error, OSError) and type(error.errno) is int and 0 <= error.errno <= 255 else None,
            'rawMessageExported': False}


def context(q, starter, constructor, model, epoch, native, live):
    result_raw = q.protected(PACKAGE / 'start-result.json', 50_000)
    intent_raw = q.protected(PACKAGE / 'prior-timer-handoff-intent.json', 150_000)
    result = json.loads(result_raw); expected = json.loads(intent_raw)
    saved = json.loads(q.protected(PACKAGE / 'start-review.json', 150_000))
    if (q.sha(result_raw) != RESULT_SHA or q.sha(intent_raw) != INTENT_SHA or saved.get('priorInertAttempt') != expected or
            result.get('completed') is not False or result.get('controllerStartAttempted') is not False or
            result.get('failedStage') != 'exact_prior_inert_timer_handoff' or result.get('errorClass') != 'RuntimeError'):
        fail('exact_failed_inert_v4_handoff_required')
    if os.path.lexists(OUTPUT): fail('one_explicit_continuation_only_no_retry')
    for name in ['prior-timer-handoff-ack.json', 'controller-start-intent.json', 'controller-definition.json', 'controller-review.json']:
        if os.path.lexists(PACKAGE / name): fail('prior_controller_or_completed_handoff_cannot_be_adopted')
    directory, _, livefile = live.paths(constructor.RUN_ID)
    value = json.loads(q.protected(livefile, 1_000_000)); review = value['review']; spec = review['spec']
    install = json.loads(q.protected(PACKAGE / 'install-ack.json', 50_000))
    if (value.get('format') != live.FORMAT or value.get('reviewHash') != q.sha(q.encoded(review)) or
            review.get('operatorSha256') != constructor.LIVE_SHA or install.get('installed') is not True or
            install.get('reviewHash') != value['reviewHash'] or install.get('budgetOrPermitsApplied') is not False or
            install.get('sourceStarted') is not False or review != json.loads(q.protected(PACKAGE / 'install-review.json', 1_000_000))):
        fail('exact_already_installed_v4_context_required')
    if live.load_spec(q, model, constructor.RUN_ID, saved['specSha256']) != spec:
        fail('installed_and_original_spec_must_be_identical')
    if q.sha(q.encoded(saved)) != result.get('reviewHash') or saved['productivePlanSha256'] != model.digest(spec['plan']):
        fail('original_failed_review_binding_changed')
    rows = live.journal_for(q, directory).rows()
    if ([r.get('phase') for r in rows] != ['install_intent', 'productive_execution_context_prepared', 'productive_timers_installed'] or
            rows[-1].get('livePlanSha256') != q.sha(q.encoded(value)) or
            rows[-1].get('repairTimersDisabledAfterReplacementProof') is not True): fail('v4_must_still_be_inert_with_only_install_ACKs')
    for unit in [saved['controllerUnit'], native.unit_name(constructor.RUN_ID)]: starter.unit_unused(unit)
    for path in [SYSTEMD / saved['controllerUnit'], SYSTEMD / (saved['controllerUnit'] + '.d'),
                 Path('/run/systemd/transient') / saved['controllerUnit'], Path('/run/systemd/system') / (saved['controllerUnit'] + '.d'),
                 OPS / ('paid-productive-v6-' + constructor.RUN_ID + '.native.env')]:
        if os.path.lexists(path): fail('fresh_controller_and_native_artifacts_required')
    with OldExecutorReferences(q, model, spec['plan'], expected):
        after = starter.prior_attempt(q, model, live, spec, armed=False)
    if after != expected: fail('exact_completed_old_timer_handoff_equivalence_required')
    journal = live.journal_for(q, directory); qvalue, _, _, _, _ = live.closed_qualification(q, model, spec)
    with live.session_scope(q, model, epoch, spec, qvalue, journal, value['timerReceiptFile'], value['timerReceiptSha256']) as (session, instance):
        instance.timers(); instance.qualification_epoch.verify_cleaned(); q.check_empty_caches(session)
    checked = {'format': FORMAT, 'operatorSha256': q.sha(q.protected(Path(__file__).absolute(), 100_000)),
               'priorFailedResultSha256': RESULT_SHA, 'actualDisableIntentSha256': INTENT_SHA,
               'completedPriorHandoffSha256': q.sha(q.encoded(after)), 'livePlanSha256': q.sha(q.encoded(value)),
               'constructionReceiptSha256': saved['constructionReceiptSha256'], 'productivePlanSha256': model.digest(spec['plan']),
               'newTimerReceiptSha256': value['timerReceiptSha256'], 'controllerUnit': saved['controllerUnit'],
               'originalExpires': spec['plan']['expires'], 'dispatchExpires': spec['plan']['dispatchExpires'],
               'bookedMigrationCu': 5000, 'activeProductivePermits': 0, 'maximumPreparationSeconds': MAXIMUM_PREPARATION_SECONDS,
               'oldTimersAlreadyDisabled': True, 'newTimersVerifiedArmed': True, 'automaticRetryAllowed': False,
               'policyOrPermitsChangedByReview': False, 'sourceStartedByReview': False}
    return checked, value, directory


def launch_definition(q, live, checked, marker):
    if q.sha(q.encoded(checked)) != marker: fail('exact_continuation_review_required')
    props = live.service_properties(controller=True)
    if props.count('RuntimeMaxSec=30600\n') != 1: fail('exact_frozen_outer_sandbox_required')
    props = props.replace('RuntimeMaxSec=30600\n', 'RuntimeMaxSec=1260\n', 1)
    unit = 'yunipals-productive-handoff-continuation-v1-20261021-prod1.service'
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-productive-handoff-continue-v1.py') + ' --apply ' + marker
    text = '[Unit]\nDescription=Yunipals explicit inert v4 handoff continuation ' + marker + '\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + props
    return {'unit': unit, 'definition': text, 'definitionSha256': q.sha(text.encode())}


def execute(q, starter, constructor, model, epoch, native, live, checked, value, directory, marker):
    if q.sha(q.encoded(checked)) != marker: fail('exact_fresh_continuation_apply_required')
    starter.actual_sandbox(q)
    if datetime.now(timezone.utc) + timedelta(seconds=MAXIMUM_PREPARATION_SECONDS + 90) >= constructor.moment(checked['dispatchExpires']):
        fail('preparation_must_fit_original_dispatch_deadline')
    OUTPUT.mkdir(mode=0o700); q.sync_directory(OUTPUT.parent)
    result = {'format': FORMAT, 'reviewHash': marker, 'completed': False, 'controllerStartAttempted': False,
              'automaticRetryAllowed': False, 'originalExpires': checked['originalExpires']}
    stage = 'acknowledge_actual_completed_handoff'
    try:
        q.save(OUTPUT / 'review.json', checked)
        receipt = {**checked, 'originalFailedEvidenceRetained': True, 'oldTimersRestarted': False,
                   'reconciliationOnlyNoRepeatedDisable': True, 'policyOrPermitMutationPerformed': False}
        pin = q.save(OUTPUT / 'handoff-reconciliation.json', receipt)
        live.journal_for(q, directory).emit('prior_inert_productive_handoff_reconciled', receiptFile=str(OUTPUT / 'handoff-reconciliation.json'), receiptSha256=pin)
        stage = 'held_legacy_bound_controller_review'
        selected = constructor.controller_review_with_restart(q, model, epoch, native, live, value, directory, checked['constructionReceiptSha256'])
        q.save(OUTPUT / 'controller-review.json', selected); apply_hash = selected['reviewHash']
        if apply_hash != q.sha(q.encoded(selected['review'])): fail('exact_held_native_review_required')
        stage = 'exact_first_controller_definition'
        definition = live.controller_definition(model, value['review']['spec']['plan'], constructor.RUN_ID, apply_hash)
        if definition['unit'] != checked['controllerUnit'] or definition['definitionSha256'] != q.sha(definition['definition'].encode()): fail('exact_frozen_controller_definition_required')
        starter.unit_unused(definition['unit']); q.save(OUTPUT / 'controller-definition.json', definition)
        fd = os.open(SYSTEMD / definition['unit'], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o644); output.write(definition['definition'].encode()); output.flush(); os.fsync(output.fileno())
        q.sync_directory(SYSTEMD); q.run(['/usr/bin/systemctl', 'daemon-reload'])
        starter.unit_unused(definition['unit'], loaded=True)
        if q.sha(q.protected(SYSTEMD / definition['unit'], 50_000)) != definition['definitionSha256']: fail('new_controller_definition_changed')
        stage = 'single_first_controller_start'
        q.save(OUTPUT / 'controller-start-intent.json', {'unit': definition['unit'], 'controllerReviewHash': apply_hash,
            'definitionSha256': definition['definitionSha256'], 'restartBinding': selected['restartBinding']})
        result['controllerStartAttempted'] = True
        q.run(['/usr/bin/systemctl', 'start', '--no-block', definition['unit']])
        result.update(completed=True, controllerUnit=definition['unit'], controllerReviewHash=apply_hash, controllerStartJobSubmitted=True)
    except BaseException as error:
        result.update(failedStage=stage, failure=failure(error), partialEvidenceRetained=True, manualDiagnosisRequired=True)
    q.save(OUTPUT / 'result.json', result); return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply'); group.add_argument('--definition'); args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_host_required')
    os.umask(0o077)
    def expired(*_): raise TimeoutError('bounded_explicit_continuation')
    signal.signal(signal.SIGALRM, expired); signal.alarm(MAXIMUM_PREPARATION_SECONDS)
    try:
        q, starter, constructor, model, epoch, native, live = modules()
        checked, value, directory = context(q, starter, constructor, model, epoch, native, live)
        if args.apply: result = execute(q, starter, constructor, model, epoch, native, live, checked, value, directory, args.apply)
        elif args.definition: result = launch_definition(q, live, checked, args.definition)
        else: result = {**checked, 'reviewHash': q.sha(q.encoded(checked)), 'applied': False}
        print(json.dumps(result, sort_keys=True))
        if result.get('completed') is False: raise SystemExit(1)
    finally: signal.alarm(0)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': failure(error), 'automaticRetryAllowed': False}, sort_keys=True))
        raise SystemExit(1)
