#!/usr/bin/env python3
"""Construct inert productive inputs and bind the explicit eight-restart proof."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FORMAT = 'yunipals-paid-productive-construction-v4'
RUN_ID = '20261021-prod1'
QUALIFICATION_RUN_ID = '20261021-qrepair2'
ORIGINAL_START = '2026-10-21T11:16:25.939473Z'
ORIGINAL_EXPIRES = '2026-10-21T19:16:25.939473Z'
LIVE_SHA = '9db605ca131a1cb22ce160af5c767838e8121851bfdd852c047f087441742a6d'
REPAIR_SHA = '6b06cfb72b23bb584cb49da640d31618ceddd8952692d3c20c035f4516381bb7'
RESTART_SHA = '4668511cb75e917a92185d42f822ed4ed467412d904340344e0fb4ebc1997676'
INVENTORY_SHA = 'b00f666ced357a9d5d2835a4ed5de6efe5ed5cdf395fe3794e651665a826a9f5'
VERIFIER_SHA = 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965'
DEPENDENCY_SHA = '1baaaafca0021ea710f2234b6a705a3fa6a4978608810a51aa9ef56913e544e0'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
CEILINGS = {'56': '130000000', '8453': '55000000'}
DISPATCH = {'56': '19000000', '8453': '995000'}


def fail(label):
    raise RuntimeError(label)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def moment(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def constructor_receipt():
    return OPS / ('paid-productive-v4-' + RUN_ID + '.construction.json')


def modules():
    # Initial loader uses the same root-owned path/ancestry/hash requirements as
    # the reviewed live driver; no private environment or secret file is loaded.
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        props = item.lstat()
        if item.is_symlink() or props.st_uid != 0 or props.st_mode & 0o022:
            fail('protected_Q_loader_required')
    raw = path.read_bytes()
    if sha(raw) != Q_SHA:
        fail('exact_frozen_Q_loader_required')
    q = types.ModuleType('productive_constructor_Q')
    q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    live = q.load(OPS / 'paid-productive-live-v4.py', LIVE_SHA, 'productive_constructor_live')
    _, model, epoch, native = live.modules()
    repair = q.load(OPS / 'paid-qualification-second-repair-live-v2.py', REPAIR_SHA, 'productive_constructor_qualification')
    return q, model, epoch, native, live, repair


def restart_proof(q, expected):
    path = OPS / 'source6-dependent-restarts-v1.json'
    raw = q.protected(path, 150_000)
    if sha(raw) != expected:
        fail('exact_reviewed_restart_receipt_required')
    proof = json.loads(raw)
    restart = q.load(OPS / 'paid-source6-dependent-restarts-v1.py', RESTART_SHA, 'productive_restart_observer')
    inventory = q.load(OPS / 'paid-prepromotion-legacy-inventory-v1.py', INVENTORY_SHA, 'productive_service_inventory')
    verifier = q.load(OPS / 'proxy-upgrade.py', VERIFIER_SHA, 'productive_accepted_public_verifier')
    dependency = q.load(OPS / 'dependency-rebase-range-hints-v5.py', DEPENDENCY_SHA, 'productive_accepted_source_reader')
    if (sha(encoded(proof)) != expected or proof != restart.capture(inventory, verifier, dependency) or
            proof.get('format') != 'yunipals-source6-dependent-restart-equivalence-v1' or
            proof.get('serviceCount') != 8 or proof.get('otherServiceCountUnchanged') != 22 or
            proof.get('baselineAdoptedFromCurrent') is not False or proof.get('promotionAuthorized') is not False):
        fail('exact_current_eight_restart_equivalence_required')
    return proof, inventory


def construct(q, model, live, repair, qualification_live_sha, restart_sha, *, at=None):
    if not model.is_sha(qualification_live_sha) or not model.is_sha(restart_sha):
        fail('explicit_actual_proof_hashes_required')
    directory, specfile, livefile = live.paths(RUN_ID)
    promotionfile = OPS / ('paid-productive-v4-' + RUN_ID + '.promotion.json')
    for path in [directory, specfile, livefile, promotionfile, constructor_receipt()]:
        if os.path.lexists(path):
            fail('fresh_productive_constructor_required')
    proof, _ = restart_proof(q, restart_sha)
    closed = repair.closed_second_repair(q, model.repair_model(), QUALIFICATION_RUN_ID, qualification_live_sha)
    if (closed['plan']['start'] != ORIGINAL_START or closed['plan']['expires'] != ORIGINAL_EXPIRES or
            closed['cleanup']['migrationBookedGrantsCu'] != '5000' or
            closed['probe'].get('aggregateIssuedPermitAuthorityCu') != 1080 or
            closed['probe'].get('denseSourceCapacityQualified') is not False):
        fail('exact_qualified_closed_five_thousand_original_epoch_required')
    promotion = {
        'format': 'yunipals-paid-productive-promotion-v3',
        'originAdmissionSha256': model.digest(closed['plan']['origin']),
        'repairPlanSha256': model.digest(closed['plan']),
        'failedClosureSha256': closed['plan']['failedClosureSha256'],
        'previousRepairPlanSha256': closed['plan']['previousRepairPlanSha256'],
        'probeResultSha256': model.digest(closed['probe']),
        'qualificationCacheReceiptSha256': model.digest(closed['cacheReceipt']),
        'qualificationCleanupAckSha256': model.digest(closed['cleanupAck']),
        'qualificationCleanupReceiptSha256': model.digest(closed['cleanup']),
        'dispatchCu': dict(DISPATCH), 'throughBlocks': dict(CEILINGS),
        'qualificationScope': 'filtered_historical_span_capability',
        'denseSourceCapacityQualified': False
    }
    qe, _, original_model = q.modules()
    current = q.snapshot(qe, original_model)
    plan = model.prepare(closed['plan'], closed['probe'], closed['cleanup'], current, promotion,
                         original_model.text_time(at or datetime.now(timezone.utc)))
    spec = {
        'format': 'yunipals-paid-productive-live-plan-v4', 'runId': RUN_ID, 'plan': plan,
        'qualification': {'runId': QUALIFICATION_RUN_ID, 'livePlanSha256': qualification_live_sha,
                          'controllerResultSha256': closed['controllerResultSha256'],
                          'controllerFinishedAckSha256': closed['controllerFinishedAckSha256'],
                          'epochRecordFile': closed['epochRecord']['path'], 'epochRecordSha256': closed['epochRecord']['sha256']},
        'promotionSha256': model.digest(promotion),
        'drainBoundEvidence': {'operationalDrainSeconds': 90, 'minimumOriginalExpiryBeforeUtcSeconds': 600,
                              'absoluteHandlerDeadlineClaimed': False}
    }
    review = {
        'format': FORMAT, 'runId': RUN_ID, 'qualificationRunId': QUALIFICATION_RUN_ID,
        'operatorSha256': sha(q.protected(Path(__file__).absolute())), 'liveHelperSha256': LIVE_SHA,
        'qualificationLivePlanSha256': qualification_live_sha, 'qualifiedProbeSha256': model.digest(closed['probe']),
        'qualificationCleanedEpochSha256': closed['epochRecord']['sha256'],
        'specSha256': sha(encoded(spec)), 'promotionSha256': model.digest(promotion),
        'productivePlanSha256': model.digest(plan),
        'restartProofFile': str(OPS / 'source6-dependent-restarts-v1.json'), 'restartProofSha256': restart_sha,
        'restartQualifiedThirtySha256': proof['restartQualifiedThirtySha256'],
        'currentPolicySha256': sha(encoded(live.policy_identity(model, current, plan))),
        'originalStart': ORIGINAL_START, 'originalExpires': ORIGINAL_EXPIRES, 'dispatchExpires': plan['dispatchExpires'],
        'fromBlocks': {'56': '7579197', '8453': '22224075'}, 'throughBlocks': dict(CEILINGS),
        'throughBlocksAreObservedHeads': False, 'dispatchCu': dict(DISPATCH),
        'priorBookedCu': 5000, 'priorIssuedPermitAuthorityCu': 1080,
        'maximumAdditionalBookedCuIncludingHistory': 20_000_000,
        'qualificationScope': 'filtered_historical_span_capability', 'denseSourceCapacityQualified': False,
        'automaticRetryAllowed': False, 'inertInputsWritten': False, 'budgetPermitsOrTimersApplied': False,
        'rawPermitRowsExported': False
    }
    return spec, promotion, review


def write_inputs(q, model, live, spec, promotion, review, expected):
    if sha(encoded(review)) != expected:
        fail('fresh_exact_productive_constructor_review_required')
    _, specfile, _ = live.paths(RUN_ID)
    files = [OPS / ('paid-productive-v4-' + RUN_ID + '.promotion.json'), specfile, constructor_receipt()]
    if any(os.path.lexists(path) for path in files):
        fail('fresh_inert_productive_files_required')
    q.save(files[0], promotion)
    q.save(files[1], spec)
    # This separate receipt adds no unreviewed key to the frozen live spec.
    q.save(files[2], {'format': FORMAT, 'reviewHash': expected, 'review': review})
    live.load_spec(q, model, RUN_ID, review['specSha256'])
    return {**review, 'reviewHash': expected, 'inertInputsWritten': True,
            'constructionReceiptSha256': sha(q.protected(files[2]))}


def controller_review_with_restart(q, model, epoch, native, live, value, directory, construction_sha):
    raw = q.protected(constructor_receipt(), 150_000)
    if sha(raw) != construction_sha:
        fail('exact_productive_construction_receipt_required')
    receipt = json.loads(raw)
    review = receipt['review']
    if (receipt.get('format') != FORMAT or receipt.get('reviewHash') != sha(encoded(review)) or
            review.get('operatorSha256') != sha(q.protected(Path(__file__).absolute())) or
            review.get('liveHelperSha256') != LIVE_SHA or review.get('runId') != RUN_ID or
            sha(encoded(value['review']['spec'])) != review['specSha256'] or
            value['review']['operatorSha256'] != LIVE_SHA):
        fail('exact_inert_construction_to_installed_live_binding_required')
    proof, inventory = restart_proof(q, review['restartProofSha256'])
    journal = live.journal_for(q, directory)
    qvalue, _, _, _, _ = live.closed_qualification(q, model, value['review']['spec'])
    with live.session_scope(q, model, epoch, value['review']['spec'], qvalue, journal,
                            value['timerReceiptFile'], value['timerReceiptSha256']) as (session, instance):
        checked, runner = live.review_in_session(q, model, epoch, native, value, journal, session, instance)
        baseline = runner.pre_epoch_binding
        if (not baseline or set(baseline.get('legacyUnits', {})) != set(inventory.UNITS) or
                baseline.get('activeSelector') != []):
            fail('actual_native_pre_epoch_service_inventory_required')
        thirty = {unit: row for unit, row in baseline['legacyUnits'].items() if unit not in inventory.OWNED}
        if (len(thirty) != 30 or sha(encoded(thirty)) != proof['restartQualifiedThirtySha256'] or
                checked['nativeReviewHash'] != sha(encoded(baseline))):
            fail('native_cannot_adopt_unproved_legacy_restart')
        return {'review': checked, 'reviewHash': sha(encoded(checked)),
                'restartBinding': {'constructionReceiptSha256': construction_sha,
                                  'restartProofSha256': review['restartProofSha256'],
                                  'restartQualifiedThirtySha256': proof['restartQualifiedThirtySha256'],
                                  'nativeReviewHash': checked['nativeReviewHash'],
                                  'legacyStatesAdoptedFromCurrent': False,
                                  'onlyTwoOwnedProxyTransitionsRemainAllowed': True}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qualification-live-sha256', required=True)
    parser.add_argument('--restart-proof-sha256', required=True)
    parser.add_argument('--apply')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main':
        fail('exact_root_host_constructor_required')
    os.umask(0o077)
    def expired(*_):
        raise TimeoutError('bounded_inert_productive_constructor')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(180)
    try:
        q, model, _, _, live, repair = modules()
        spec, promotion, review = construct(q, model, live, repair, args.qualification_live_sha256, args.restart_proof_sha256)
        result = write_inputs(q, model, live, spec, promotion, review, args.apply) if args.apply else {**review, 'reviewHash': sha(encoded(review))}
        print(json.dumps(result, sort_keys=True))
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'budgetPermitsOrTimersApplied': False, 'rawPermitRowsExported': False}))
        raise SystemExit(1)
