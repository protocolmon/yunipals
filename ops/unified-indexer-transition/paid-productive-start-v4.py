#!/usr/bin/env python3
"""One reviewed timer installation, held legacy-bound review and controller start."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
from datetime import datetime, timedelta, timezone

# Load only the exact public constructor through the already frozen root loader.
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEMD = Path('/etc/systemd/system')
OUTPUT = OPS / 'paid-productive-package-20261021-b'
FORMAT = 'yunipals-paid-productive-one-shot-start-v4'
CONSTRUCTOR_SHA = '62ed0c8a91870e288b95ca7b5716a4f5bd5135728bcff352754047ac7b005252'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
PRIOR_LIVE_SHA = 'd0307d243e4d012f4719318c6e808aa90539a71edeee8481ace26b33745d9215'
PRIOR_RESULT_SHA = 'b6f627cd267a1b0cc0b90d6e715023946eea0755f17c1b134ffc862417c4e3a3'
PRIOR_OUTPUT = OPS / 'paid-productive-package-20261021-a'
PRIOR_BASE = Path('/var/backups/yunipals-paid-productive-live-v3-20261021')
MAXIMUM_PREPARATION_SECONDS = 1200
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(label):
    raise RuntimeError(label)


def modules():
    import hashlib
    import types
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        props = item.lstat()
        if item.is_symlink() or props.st_uid != 0 or props.st_mode & 0o022:
            fail('protected_frozen_Q_loader_required')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != Q_SHA:
        fail('exact_frozen_Q_loader_required')
    q = types.ModuleType('productive_start_Q')
    q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    constructor = q.load(OPS / 'paid-productive-spec-v4.py', CONSTRUCTOR_SHA, 'productive_start_constructor')
    _, model, epoch, native, live, _ = constructor.modules()
    return q, constructor, model, epoch, native, live


def unit_unused(unit, *, loaded=False, command=subprocess.run):
    keys = {'Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'FragmentPath', 'DropInPaths'}
    result = command(['/usr/bin/systemctl', 'show', '--all', unit, '--property=' + ','.join(sorted(keys))],
                     env=ENV, capture_output=True, timeout=5)
    if result.returncode not in {0, 1} or not isinstance(result.stdout, bytes) or len(result.stdout) > 20_000:
        fail('bounded_unused_productive_unit_observation_required')
    row = {}
    for line in result.stdout.decode().splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in keys or key in row:
            fail('exact_unused_unit_property_shape_required')
        row[key] = value
    if (set(row) != keys or row['Id'] != unit or row['LoadState'] != ('loaded' if loaded else 'not-found') or
            row['ActiveState'] != 'inactive' or row['SubState'] != 'dead' or row['MainPID'] != '0' or
            row['InvocationID'] or row['DropInPaths'] or row['FragmentPath'] != (str(SYSTEMD / unit) if loaded else '')):
        fail('foreign_or_previously_started_productive_unit_refused')


def prior_timer_pair(q, qe, model, spec, rows, *, armed):
    """Fixed predecessor timer metadata only; no history scan or job control."""
    if len(rows) != 2 or {r['kind'] for r in rows} != {'deadline', 'utc'}:
        fail('exact_prior_timer_pair_required')
    for row in rows:
        prefix = 'yunipals-paid-productive-v3-' + row['kind'] + '-' + model.digest(spec['plan'])[:16]
        due = spec['plan']['dispatchExpires' if row['kind'] == 'deadline' else 'nextUtc']
        if (row['timerUnit'] != prefix + '.timer' or row['serviceUnit'] != prefix + '.service' or row['dueUtc'] != due or
                set(row['definitions']) != {str(SYSTEMD / (prefix + '.timer')), str(SYSTEMD / (prefix + '.service'))}):
            fail('exact_owned_prior_timer_names_required')
        if any(q.sha(q.protected(Path(path), 50_000)) != expected for path, expected in row['definitions'].items()):
            fail('prior_timer_definitions_changed')
        raw = q.run(['/usr/bin/systemctl', 'show', '--all', row['timerUnit'], '--property=Id,LoadState,ActiveState,SubState'], timeout=5)
        props = {}
        for line in raw.splitlines():
            key, sep, value = line.partition('=')
            if not sep or key in props: fail('exact_prior_timer_state_required')
            props[key] = value
        expected = {'Id': row['timerUnit'], 'LoadState': 'loaded', 'ActiveState': 'active' if armed else 'inactive',
                    'SubState': 'waiting' if armed else 'dead'}
        if props != expected: fail('prior_timer_state_not_exact')
        service = q.unit_properties(row['serviceUnit'])
        if (service['Id'] != row['serviceUnit'] or service['ActiveState'] != 'inactive' or service['SubState'] != 'dead' or
                service['MainPID'] != '0' or service['Type'] != 'exec' or service['User'] not in {'', 'root'} or
                service['Group'] not in {'', 'root'} or service['Restart'] != 'no'):
            fail('prior_executor_must_be_unstarted_inactive')
        q.assert_no_unit_environment(qe, row['serviceUnit'])
        link = SYSTEMD / 'timers.target.wants' / row['timerUnit']
        if armed:
            if not link.is_symlink() or link.lstat().st_uid != 0 or link.resolve(strict=True) != SYSTEMD / row['timerUnit']:
                fail('exact_prior_timer_wants_link_required')
            due_time = model.model().moment(due)
            delta = due_time - datetime(1970, 1, 1, tzinfo=timezone.utc)
            stamp = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
            if (qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'NextElapseUSecRealtime', 't') != stamp or
                    qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'Unit', 's') != row['serviceUnit']):
                fail('exact_prior_original_deadline_required')
        elif os.path.lexists(link):
            fail('prior_timer_wants_link_retained_after_disable')


def prior_attempt(q, model, live, spec, *, armed=True):
    """Seal only the observed PermissionError attempt, never adopt authority."""
    result_raw = q.protected(PRIOR_OUTPUT / 'start-result.json', 50_000)
    result = json.loads(result_raw)
    if (q.sha(result_raw) != PRIOR_RESULT_SHA or result.get('completed') is not False or
            result.get('controllerStartAttempted') is not False or result.get('failedStage') != 'held_legacy_bound_controller_review' or
            result.get('errorClass') != 'PermissionError' or result.get('automaticRetryAllowed') is not False or
            result.get('originalExpires') != spec['plan']['expires']):
        fail('exact_failed_pre_authority_prior_attempt_required')
    prior = q.load(OPS / 'paid-productive-live-v3.py', PRIOR_LIVE_SHA, 'retained_failed_productive_live')
    directory, _, livefile = prior.paths(spec['runId'])
    if directory != PRIOR_BASE / spec['runId']: fail('exact_prior_evidence_directory_required')
    value = json.loads(q.protected(livefile, 1_000_000)); review = value.get('review', {})
    install = json.loads(q.protected(PRIOR_OUTPUT / 'install-ack.json', 50_000))
    if (value.get('format') != prior.FORMAT or value.get('reviewHash') != q.sha(q.encoded(review)) or
            review.get('operatorSha256') != PRIOR_LIVE_SHA or review.get('spec', {}).get('plan') != spec['plan'] or
            review['spec']['runId'] != spec['runId'] or install.get('installed') is not True or
            install.get('reviewHash') != value['reviewHash'] or install.get('budgetOrPermitsApplied') is not False or
            install.get('sourceStarted') is not False): fail('exact_retained_inert_productive_context_required')
    if json.loads(q.protected(PRIOR_OUTPUT / 'install-review.json', 1_000_000)) != review:
        fail('prior_install_review_changed')
    journal = prior.journal_for(q, directory); records = journal.rows()
    if ([r.get('phase') for r in records] != ['install_intent', 'productive_execution_context_prepared', 'productive_timers_installed'] or
            records[-1].get('livePlanSha256') != q.sha(q.encoded(value)) or
            records[-1].get('repairTimersDisabledAfterReplacementProof') is not True):
        fail('prior_attempt_contains_unknown_or_admission_activity')
    for name in ['controller-start-intent.json', 'controller-definition.json', 'controller-review.json']:
        if os.path.lexists(PRIOR_OUTPUT / name): fail('prior_controller_start_or_review_evidence_present')
    controller = prior.controller_definition(model, spec['plan'], spec['runId'], '0' * 64)['unit']
    unit_unused(controller)
    unit_unused('yunipals-unified-paid-productive-v5-' + spec['runId'] + '.service')
    for path in [SYSTEMD / controller, SYSTEMD / (controller + '.d'),
                 OPS / ('paid-productive-v5-' + spec['runId'] + '.native.env')]:
        if os.path.lexists(path): fail('prior_runtime_or_controller_definition_present')
    actual = live.permits(q, model, spec['plan'])
    if actual != {'active': 0, 'owned': []}: fail('productive_authority_must_still_be_absent')
    qe, _, original = q.modules(); qe.source_gate()
    current = q.snapshot(qe, original)
    policy = live.policy_identity(model, current, spec['plan'])
    q.same_policy(original, current, spec['plan']['repairCleanupReceipt']['policy'], spec['plan']['otherAllocationsSha256'])
    if model.model().cu(policy['sourceGrantedCu']) - model.model().cu(spec['plan']['baselineSourceGrantedCu']) != 5000:
        fail('prior_five_thousand_booked_policy_must_be_unchanged')
    expected_timers = prior.timer_definitions(q, model, spec['plan'], spec['runId'])
    if review.get('timers') != expected_timers: fail('prior_timer_review_changed')
    receipt_raw = q.protected(Path(value['timerReceiptFile']), 150_000)
    receipt = json.loads(receipt_raw)
    timer_rows = [{key: r[key] for key in ['kind', 'dueUtc', 'timerUnit', 'serviceUnit', 'definitions']} for r in expected_timers]
    if (Path(value['timerReceiptFile']) != OPS / ('paid-productive-v3-' + spec['runId'] + '.timers.json') or
            q.sha(receipt_raw) != value['timerReceiptSha256'] or receipt != {
                'format': 'yunipals-paid-productive-timers-v3', 'productivePlanSha256': model.digest(spec['plan']),
                'runId': spec['runId'], 'executorSha256': PRIOR_LIVE_SHA, 'timers': timer_rows}):
        fail('exact_prior_durable_timer_receipt_required')
    prior_timer_pair(q, qe, model, spec, timer_rows, armed=armed)
    return {'failedStartResultSha256': PRIOR_RESULT_SHA, 'priorLiveSha256': PRIOR_LIVE_SHA,
            'priorLivePlanSha256': q.sha(q.encoded(value)), 'priorTimerReceiptSha256': value['timerReceiptSha256'],
            'priorJournalSha256': q.sha(q.protected(directory / 'journal.jsonl', 50_000)), 'timers': timer_rows,
            'productivePlanSha256': model.digest(spec['plan']), 'bookedMigrationCu': 5000,
            'activePermits': 0, 'admissionOrControllerStarted': False, 'originalExpires': spec['plan']['expires']}


def handoff_prior(q, constructor, model, epoch, live, value, directory, expected):
    spec = value['review']['spec']; journal = live.journal_for(q, directory)
    observed = prior_attempt(q, model, live, spec)
    if observed != expected: fail('exact_prior_attempt_changed_before_handoff')
    qvalue, _, _, _, _ = live.closed_qualification(q, model, spec)
    with live.session_scope(q, model, epoch, spec, qvalue, journal, value['timerReceiptFile'], value['timerReceiptSha256']) as (session, instance):
        instance.timers(); instance.qualification_epoch.verify_cleaned()
        q.check_empty_caches(session)
        # No old timer is disabled until the complete new durable pair is live.
        q.save(OUTPUT / 'prior-timer-handoff-intent.json', expected)
        for row in observed['timers']:
            q.run(['/usr/bin/systemctl', 'disable', '--now', row['timerUnit']], timeout=15)
        q.sync_directory(SYSTEMD / 'timers.target.wants'); q.sync_directory(SYSTEMD)
        after = prior_attempt(q, model, live, spec, armed=False)
        if after != observed: fail('prior_context_changed_during_timer_handoff')
        receipt = {**observed, 'newLivePlanSha256': q.sha(q.encoded(value)),
                   'newTimerReceiptSha256': value['timerReceiptSha256'], 'newPairProvenBeforePriorDisable': True,
                   'oldFilesRetained': True, 'policyOrPermitMutationPerformed': False}
        q.save(OUTPUT / 'prior-timer-handoff-ack.json', receipt)
        journal.emit('prior_inert_productive_timers_disabled', receiptSha256=q.sha(q.encoded(receipt)))
    return receipt


def review(q, constructor, model, epoch, native, live, construction_sha):
    raw = q.protected(constructor.constructor_receipt(), 150_000)
    if q.sha(raw) != construction_sha:
        fail('exact_inert_construction_receipt_required')
    receipt = json.loads(raw)
    prior = receipt['review']
    if (receipt.get('format') != constructor.FORMAT or receipt.get('reviewHash') != q.sha(q.encoded(prior)) or
            prior.get('operatorSha256') != CONSTRUCTOR_SHA or prior.get('liveHelperSha256') != constructor.LIVE_SHA):
        fail('reviewed_productive_constructor_binding_required')
    directory, _, livefile = live.paths(constructor.RUN_ID)
    spec = live.load_spec(q, model, constructor.RUN_ID, prior['specSha256'])
    if model.digest(spec['plan']) != prior['productivePlanSha256']:
        fail('exact_prepared_productive_plan_required')
    definition = live.controller_definition(model, spec['plan'], constructor.RUN_ID, '0' * 64)
    unit = definition['unit']
    if not re.fullmatch('yunipals-paid-productive-controller-v4-20261021-prod1.service', unit):
        fail('fixed_productive_controller_required')
    for path in [OUTPUT, directory, livefile, SYSTEMD / unit, Path('/run/systemd/transient') / unit,
                 SYSTEMD / (unit + '.d'), Path('/run/systemd/system') / (unit + '.d')]:
        if os.path.lexists(path):
            fail('fresh_single_productive_start_required')
    unit_unused(unit)
    predecessor = prior_attempt(q, model, live, spec)
    return {'format': FORMAT, 'operatorSha256': q.sha(q.protected(Path(__file__).absolute())),
            'constructorSha256': CONSTRUCTOR_SHA, 'liveHelperSha256': constructor.LIVE_SHA,
            'constructionReceiptSha256': construction_sha, 'specSha256': prior['specSha256'],
            'productivePlanSha256': prior['productivePlanSha256'], 'controllerUnit': unit,
            'restartProofSha256': prior['restartProofSha256'],
            'restartQualifiedThirtySha256': prior['restartQualifiedThirtySha256'],
            'originalStart': prior['originalStart'], 'originalExpires': prior['originalExpires'],
            'dispatchExpires': prior['dispatchExpires'], 'maximumPreparationSeconds': MAXIMUM_PREPARATION_SECONDS,
            'requiredEvidenceRoots': [str(path) for path in [live.BASE, epoch.BASE, native.BASE]],
            'outputDirectory': str(OUTPUT), 'automaticRetryAllowed': False, 'budgetAppliedByReview': False,
            'nativeStartedByReview': False, 'priorInertAttempt': predecessor}


def prepare_roots(q, reviewed, expected):
    if q.sha(q.encoded(reviewed)) != expected:
        fail('exact_start_review_required_before_evidence_roots')
    for text in reviewed['requiredEvidenceRoots']:
        path = Path(text)
        if not os.path.lexists(path):
            path.mkdir(mode=0o700)
            q.sync_directory(path.parent)
        props = path.lstat()
        if not stat.S_ISDIR(props.st_mode) or props.st_uid != 0 or stat.S_IMODE(props.st_mode) != 0o700:
            fail('exact_private_productive_evidence_root_required')
    return {'format': FORMAT, 'evidenceRootsReady': True, 'budgetPermitsOrTimersApplied': False,
            'reviewHash': expected}


def actual_sandbox(q, status_reader=lambda: Path('/proc/self/status').read_text()):
    q.actual_root_capabilities()
    status = dict(row.split(':', 1) for row in status_reader().splitlines() if ':' in row)
    if status.get('NoNewPrivs', '').strip() != '1' or int(status.get('CapBnd', '-1').strip(), 16) != 0xe0:
        fail('actual_starter_NNP_and_E0_bounding_required')


def launch_definition(q, live, reviewed, expected):
    """Public outer sandbox only; never writes/reloads/starts the unit."""
    if q.sha(q.encoded(reviewed)) != expected:
        fail('exact_start_review_required_for_outer_definition')
    properties = live.service_properties(controller=True)
    if properties.count('RuntimeMaxSec=30600\n') != 1:
        fail('exact_existing_controller_sandbox_required')
    properties = properties.replace('RuntimeMaxSec=30600\n', 'RuntimeMaxSec=1260\n', 1)
    unit = 'yunipals-paid-productive-start-v4-20261021-prod1.service'
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-productive-start-v4.py') + ' --construction-sha256 ' + reviewed['constructionReceiptSha256'] + ' --apply ' + expected
    raw = '[Unit]\nDescription=Yunipals one reviewed productive start ' + expected + '\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + properties
    return {'unit': unit, 'definition': raw, 'definitionSha256': q.sha(raw.encode())}


def execute(q, constructor, model, epoch, native, live, reviewed, expected, *, utc_now=lambda: datetime.now(timezone.utc)):
    if q.sha(q.encoded(reviewed)) != expected or review(q, constructor, model, epoch, native, live, reviewed['constructionReceiptSha256']) != reviewed:
        fail('exact_fresh_productive_start_review_required')
    actual_sandbox(q)
    for text in reviewed['requiredEvidenceRoots']:
        props = Path(text).lstat()
        if not stat.S_ISDIR(props.st_mode) or props.st_uid != 0 or stat.S_IMODE(props.st_mode) != 0o700:
            fail('precreated_exact_evidence_roots_required')
    OUTPUT.mkdir(mode=0o700)
    q.sync_directory(OUTPUT.parent)
    result = {'format': FORMAT, 'reviewHash': expected, 'completed': False,
              'controllerStartAttempted': False, 'automaticRetryAllowed': False,
              'originalExpires': reviewed['originalExpires'], 'rawPermitRowsExported': False}
    stage = 'install_review'
    try:
        q.save(OUTPUT / 'start-review.json', reviewed)
        spec = live.load_spec(q, model, constructor.RUN_ID, reviewed['specSha256'])
        if utc_now() + timedelta(seconds=MAXIMUM_PREPARATION_SECONDS + 90) >= constructor.moment(spec['plan']['dispatchExpires']):
            fail('preparation_and_native_time_must_fit_original_deadline')
        checked = live.prepare(q, model, epoch, native, spec)
        install_hash = q.sha(q.encoded(checked))
        q.save(OUTPUT / 'install-review.json', checked)
        stage = 'exact_timer_install'
        installed = live.install(q, model, epoch, native, checked, install_hash)
        if installed.get('installed') is not True or installed.get('reviewHash') != install_hash:
            fail('exact_productive_timer_install_ACK_required')
        q.save(OUTPUT / 'install-ack.json', installed)
        directory, _, livefile = live.paths(constructor.RUN_ID)
        value = json.loads(q.protected(livefile, 1_000_000))
        if value.get('review') != checked or value.get('reviewHash') != install_hash:
            fail('durable_installed_productive_context_required')
        stage = 'exact_prior_inert_timer_handoff'
        handoff_prior(q, constructor, model, epoch, live, value, directory, reviewed['priorInertAttempt'])
        stage = 'held_legacy_bound_controller_review'
        selected = constructor.controller_review_with_restart(q, model, epoch, native, live, value, directory,
                                                             reviewed['constructionReceiptSha256'])
        q.save(OUTPUT / 'controller-review.json', selected)
        marker = selected['reviewHash']
        if marker != q.sha(q.encoded(selected['review'])):
            fail('exact_held_controller_review_hash_required')
        stage = 'exact_controller_definition'
        definition = live.controller_definition(model, spec['plan'], constructor.RUN_ID, marker)
        if (definition['unit'] != reviewed['controllerUnit'] or definition['definitionSha256'] != q.sha(definition['definition'].encode())):
            fail('exact_reviewed_productive_controller_definition_required')
        unit_unused(definition['unit'])
        q.save(OUTPUT / 'controller-definition.json', definition)
        fd = os.open(SYSTEMD / definition['unit'], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), 0o644)
            out.write(definition['definition'].encode())
            out.flush()
            os.fsync(out.fileno())
        q.sync_directory(SYSTEMD)
        q.run(['/usr/bin/systemctl', 'daemon-reload'])
        unit_unused(definition['unit'], loaded=True)
        if q.sha(q.protected(SYSTEMD / definition['unit'], 50_000)) != definition['definitionSha256']:
            fail('productive_unit_file_changed')
        stage = 'single_controller_start'
        q.save(OUTPUT / 'controller-start-intent.json', {'unit': definition['unit'], 'controllerReviewHash': marker,
               'definitionSha256': definition['definitionSha256'], 'restartBinding': selected['restartBinding']})
        result['controllerStartAttempted'] = True
        q.run(['/usr/bin/systemctl', 'start', '--no-block', definition['unit']])
        result.update(completed=True, controllerUnit=definition['unit'], controllerReviewHash=marker,
                      controllerDefinitionSha256=definition['definitionSha256'], controllerStartJobSubmitted=True)
    except BaseException as error:
        result.update(failedStage=stage, errorClass=type(error).__name__,
                      partialEvidenceRetained=True, manualDiagnosisRequired=True)
    q.save(OUTPUT / 'start-result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--construction-sha256', required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--prepare-roots')
    group.add_argument('--apply')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main':
        fail('exact_root_host_starter_required')
    os.umask(0o077)
    def expired(*_):
        raise TimeoutError('bounded_productive_start_preparation')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(MAXIMUM_PREPARATION_SECONDS)
    try:
        q, constructor, model, epoch, native, live = modules()
        reviewed = review(q, constructor, model, epoch, native, live, args.construction_sha256)
        if args.prepare_roots:
            result = prepare_roots(q, reviewed, args.prepare_roots)
        elif args.apply:
            result = execute(q, constructor, model, epoch, native, live, reviewed, args.apply)
        else:
            result = {**reviewed, 'reviewHash': q.sha(q.encoded(reviewed)), 'applied': False}
        print(json.dumps(result, sort_keys=True))
        if result.get('completed') is False:
            raise SystemExit(1)
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'automaticRetryAllowed': False, 'rawPermitRowsExported': False}))
        raise SystemExit(1)
