#!/usr/bin/env python3
"""Acknowledge only the already completed f603 reader switch; no service/SQL actions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import time
import types

FORMAT = 'yunipals-ypal-reader-finalization-v2'
CORE_FILE = Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py')
CORE_SHA = 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8'
SOURCE_SHA = '581990e80baa6ae074786b7b2cf7c771c82ebe046253a1de23a96f251d900efd'
ADMISSION_SHA = '4743a743eb20b6f5fe0cc867683d27d3cea953bd64d30be50303e31a09b358a1'
SWITCH_SHA = '0b8a816ce0d6224d5c6f57779571f20fca02ab2770ed3baafd68a24ad306d9f4'
BOUNDARY = 52999805  # Actual root-reviewed switch readiness, never a fetched/reserved token ID.
API_IDENTITY = {'MainPID': '2334701', 'InvocationID': '3a3b4014f75b4db9968f4c5ee26fa904'}
PHASES = ('stop-original-readers', 'load-overlays', 'start-fresh-api', 'fresh-queue-once', 'resume-original-queue-schedule')


def need(value, code):
    if not value: raise RuntimeError(code)


def core():
    # Reuse only the frozen reader's protected file parser. Executing definitions
    # creates no Host and invokes no old CLI/effect or altered validator.
    path = CORE_FILE
    for p in [path, *path.parents]:
        st = p.lstat(); need(st.st_uid == 0 and not st.st_mode & 0o022 and not p.is_symlink(), 'protected_original_reader_required')
    raw = path.read_bytes(); need(hashlib.sha256(raw).hexdigest() == CORE_SHA, 'exact_f603_reader_required')
    m = types.ModuleType('frozen_ypal_reader'); m.__file__ = str(path); exec(compile(raw, str(path), 'exec'), m.__dict__)
    need(m.sha(m.protected(path)) == CORE_SHA, 'reader_changed_during_load'); return m


def phases(m):
    hashes, intents = {}, {}
    last = 0
    for phase in PHASES:
        intent = m.BASE / (phase + '-intent.json'); ack = m.BASE / (phase + '-result.json')
        value = m.document(intent)
        need(value.get('bootId') == m.boot() and value.get('automaticRetryAllowed') is False and type(value.get('monotonicUs')) is int and value['monotonicUs'] > last, 'all_ordered_same_boot_original_phase_intents_required')
        need(m.document(ack) == {'completed': True}, 'all_original_phase_ACKs_required')
        last = value['monotonicUs']; intents[phase] = value
        hashes[intent.name] = m.sha(m.protected(intent)); hashes[ack.name] = m.sha(m.protected(ack))
    return hashes, intents


def definitions(m, h, expected, seconds=20):
    # A normal timer start job can race the old prewrite/static check. Retry only
    # read observations; the original complete definitions() must itself pass.
    deadline = time.monotonic() + seconds
    while True:
        try:
            value = h.definitions(True)
            need(value == expected, 'exact_original_reader_static_and_private_inputs_required')
            return value
        except RuntimeError as error:
            if str(error) != 'same_reader_base_definitions_required': raise
            for unit, pin in m.UNIT_PINS.items():
                state = h.state(unit); path = Path('/etc/systemd/system') / unit
                need(state['FragmentPath'] == str(path) and m.sha(m.protected(path)) == pin, 'actual_reader_definition_drift_refused')
                need(state['DropInPaths'] == (str(m.DROPS[unit]) if unit in m.DROPS else ''), 'actual_reader_overlay_drift_refused')
                need(unit == m.QUEUE or state['Job'] in {'', '0'}, 'non_queue_job_refused')
            if time.monotonic() >= deadline: raise RuntimeError('normal_queue_job_did_not_become_terminal')
            time.sleep(0.2)


def publications(m):
    rows = m.publications()  # Reconciliation is false: it cannot unlink anything.
    need(len(rows) == 3 and {r['path'] for r in rows} == {str(m.PUBLIC_ENV), *map(str, m.DROPS.values())}, 'all_three_acknowledged_publications_required')
    hashes = {}
    for row in rows:
        m.owned_overlay(row)
        key = m.sha(row['path'].encode())[:8]
        intent, ack = m.BASE / ('file-intent-' + key + '.json'), m.BASE / ('published-' + key + '.json')
        need(m.document(intent) == m.document(ack) == row and not os.path.lexists(row['temporary']), 'exact_original_publication_ACK_and_inode_required')
        hashes[intent.name] = m.sha(m.protected(intent)); hashes[ack.name] = m.sha(m.protected(ack))
    return rows, hashes


def queue_proof(m, h, intents):
    start = intents['fresh-queue-once']['monotonicUs']; end = intents['resume-original-queue-schedule']['monotonicUs']
    need(0 < end - start <= 120_000_000, 'bounded_original_one_shot_interval_required')
    first = (m.BASE / 'fresh-queue-once-intent.json').stat().st_mtime_ns // 1_000_000_000 - 2
    last = (m.BASE / 'resume-original-queue-schedule-intent.json').stat().st_mtime_ns // 1_000_000_000 + 2
    raw = h.core.run(['/usr/bin/journalctl', '--unit=' + m.QUEUE, '--boot=0', '--no-pager', '--output=json', '--since=@' + str(first), '--until=@' + str(last)], 10)
    rows = [json.loads(line) for line in raw.splitlines() if line]
    proof = h.core_module.queue_completion(rows, start, BOUNDARY)
    need(proof['monotonicUs'] < end, 'actual_one_shot_completion_before_timer_resume_required')
    return proof


def review(m, h):
    need(not (m.BASE / 'result.json').exists() and not (m.BASE / 'inverse-intent.json').exists() and not (m.BASE / 'inverse-result.json').exists(), 'only_unfinalized_noninversed_original_switch_required')
    binding = m.document(m.BASE / 'switch-review.json', SWITCH_SHA)
    need(binding['operatorSha256'] == CORE_SHA and binding['sourceReceiptSha256'] == SOURCE_SHA and binding['admissionSha256'] == ADMISSION_SHA and binding['bootId'] == m.boot(), 'exact_actual_original_switch_refs_required')
    admission = m.document(m.BASE / 'admission.json', ADMISSION_SHA)
    phase_hashes, intents = phases(m); published, publication_hashes = publications(m)
    source = h.source(); inputs, _, _ = h.inputs()
    need(source['receiptSha256'] == SOURCE_SHA and source['native']['ready'] is True and inputs == binding['inputs'], 'same_actual_ready_source_and_reader_inputs_required')
    need(h.catalog() == admission['after'] and h.independent() == binding['independent'], 'same_admitted_graph_and_independent_actors_required')
    definitions(m, h, binding['definitions'])
    actor = h.actor(m.API, binding['inputs']['values'])
    need(all(actor[k] == v for k, v in API_IDENTITY.items()) and intents['start-fresh-api']['monotonicUs'] <= int(actor['ExecMainStartTimestampMonotonic']) < intents['fresh-queue-once']['monotonicUs'], 'same_actual_API_inside_acknowledged_start_window_required')
    timer = h.state(m.TIMER)
    need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled' and timer['Job'] in {'', '0'}, 'same_restored_queue_schedule_required')
    queue = queue_proof(m, h, intents)
    availability = h.availability(binding['inputs']['deployment']); native = h.ready()
    need(native['completeBlock'] >= queue['indexedBlock'], 'current_native_coverage_of_completed_queue_required')
    # Last fence is read-only and phase-aware; never restart a successful worker.
    definitions(m, h, binding['definitions']); need(h.actor(m.API, binding['inputs']['values']) == actor and h.catalog() == admission['after'] and h.independent() == binding['independent'], 'reader_changed_during_finalization_review')
    fixed = {'format': FORMAT, 'finalizerSha256': m.sha(m.protected(Path(__file__).absolute())), 'originalOperatorSha256': CORE_SHA, 'sourceReceiptSha256': SOURCE_SHA, 'admissionSha256': ADMISSION_SHA, 'switchReviewSha256': SWITCH_SHA, 'bootId': m.boot(), 'API': actor, 'queue': queue, 'phaseReceiptHashes': phase_hashes, 'publicationReceiptHashes': publication_hashes, 'published': published, 'roleGraphSha256': m.sha(m.encoded(admission['after'])), 'independentActorsSha256': m.sha(m.encoded(binding['independent']))}
    return {'binding': fixed, 'reviewHash': m.sha(m.encoded(fixed)), 'currentProof': {'availability': availability, 'native': native}, 'serviceActions': 0, 'ACLChanges': 0, 'originalResultCreated': False}


def apply(m, h, expected):
    checked = review(m, h); need(checked['reviewHash'] == expected, 'exact_fresh_finalization_review_required')
    for name in ('finalization-v2-review.json', 'finalization-v2-intent.json', 'finalization-v2-result.json'): need(not os.path.lexists(m.BASE / name), 'exclusive_finalization_prefix_required')
    m.save(m.BASE / 'finalization-v2-review.json', checked)
    m.save(m.BASE / 'finalization-v2-intent.json', {'format': FORMAT, 'reviewHash': expected, 'bootId': m.boot(), 'automaticRetryAllowed': False, 'serviceActions': 0})
    value = {**checked['binding'], 'completed': True, 'reconciledAcknowledgementOnly': True, 'currentProof': checked['currentProof'], 'schema': m.SCHEMA, 'oldTenReadsPreserved': True, 'roleAttributesChanged': False, 'sourceChanges': 0, 'serviceActions': 0, 'ACLChanges': 0, 'originalResultCreated': False, 'inverseReference': {'operatorSha256': CORE_SHA, 'switchReviewSha256': SWITCH_SHA}}
    m.save(m.BASE / 'finalization-v2-result.json', value); return value


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError())); signal.alarm(300)
    m = core(); h = m.Host(SOURCE_SHA); value = apply(m, h, args.apply) if args.apply else review(m, h)
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as e:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(e).__name__, 'fixedCode': str(e) if type(e) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(e)) else 'private_diagnostics_withheld', 'serviceActions': 0, 'automaticRetryAllowed': False})); raise SystemExit(1)
