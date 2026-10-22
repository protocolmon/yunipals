#!/usr/bin/env python3
"""One normal/free-only restart after the exact reviewed replay closes.

The input pins actual terminal files, not a predicted cleanup or a fresh replay.
The tested adaptive proxy is retained in free-only mode without a new build.
This temporary source precedes canonical/consumer acceptance and final shared
supervision. It never changes source selection or deletes historical permits.
"""
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-post-renewal-ordinary-v3-20261021')
SYSTEMD = Path('/etc/systemd/system')
INPUT = OPS / 'source6-post-renewal-ordinary-v3.plan.json'
FORMAT = 'yunipals-source6-post-renewal-ordinary-v3'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
RENEWAL_SHA = '845d61d2ab662f6edccb184a0fbd2dccb027ebe81bafca038b6d1b4b154075d0'
PARENTS = {RENEWAL_SHA: 'paid-replay-renewal-live-v7.py'}
ADAPTIVE_BUILD_SHA = '528f8bc53d1170431ee560d7967b130c0106d68483fb57e666eea9aafb73bdf6'
ADAPTIVE_RECEIPT_SHA = 'de4bc806e02b55c95064a1d111215c711f0e4bf09c01f42ae7f489bc6cc93b3c'
ADAPTIVE_ENTRY = OPS / 'source6-queued-source-proxy-v1/rpc-budget-proxy.mjs'
ADAPTIVE_ENTRY_SHA = '1fda46cc5f7c12b853664dbc0078c0e54b0aa26ecfc2304b8efb68b4cb588d41'
NORMAL_OVERRIDE = 'zzzzzzzzzzzzzzzzzzzzz-source6-normal-queued-source-v1-20261021.conf'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(code): raise RuntimeError(code)
def encoded(v): return json.dumps(v, sort_keys=True, separators=(',', ':')).encode()
def sha(v): return hashlib.sha256(v).hexdigest()
def now(): return datetime.now(timezone.utc)
def stamp(v): return v.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def modules():
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        s = item.lstat()
        if item.is_symlink() or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_loader_required')
    raw = path.read_bytes()
    if len(raw) > 300000 or sha(raw) != Q_SHA: fail('pinned_loader_required')
    q = types.ModuleType('post_renewal_loader'); q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    parent_sha = json.loads(q.protected(INPUT, 100000)).get('parentOperatorSha256')
    if parent_sha not in PARENTS: fail('known_reviewed_parent_operator_required')
    renewal = q.load(OPS / PARENTS[parent_sha], parent_sha, 'closed_reviewed_replay')
    d = renewal.modules(); d.renewal = renewal; d.parent_sha = parent_sha
    d.normal_proxy = q.load(OPS / 'source6-queued-source-proxy-build-v1.py', ADAPTIVE_BUILD_SHA, 'existing_normal_adaptive_proxy')
    return d


def read(d, path, pin=None): return d.renewal.read(d, path, pin)
def journal(d): return d.live.journal_for(d.q, BASE)


def input_paths(d, segment):
    if segment not in {'day1', 'day2'}: fail('actual_final_segment_required')
    names = {'review': 'review.json', 'plan': 'plan.json', 'ready': 'ready.json',
        'identity': 'controller-identity.json', 'result': 'controller-result.json',
        'journal': 'journal.jsonl', 'runtime': 'runtime-' + segment + '.json',
        'cleanup': 'cleanup-' + segment + '.json'}
    return {key: d.renewal.BASE / name for key, name in names.items()}


def history(d, spec):
    if (set(spec) != {'format', 'parentOperatorSha256', 'segment', 'references'} or spec['format'] != FORMAT or
        spec['parentOperatorSha256'] not in PARENTS or spec['parentOperatorSha256'] != d.parent_sha):
        fail('exact_terminal_input_shape_required')
    paths = input_paths(d, spec['segment'])
    if set(spec['references']) != set(paths): fail('complete_actual_terminal_references_required')
    values = {}
    for key, path in paths.items():
        pin = spec['references'][key]
        if not d.q.is_sha(pin) or pin == '0' * 64: fail('actual_terminal_hashes_not_yet_supplied')
        raw = d.q.protected(path, 2000000)
        if sha(raw) != pin: fail('actual_v4_terminal_reference_changed')
        if key != 'journal': values[key] = json.loads(raw)
    j = d.renewal.journal(d); segment = spec['segment']; result = values['result']
    finished = j.latest('controller_finished'); prepared = j.latest('segment_cleanup_prepared')
    closed = j.latest('segment_closed'); running = j.latest('source_running'); stopped = j.latest('source_stopped')
    d.financial.validate(values['plan']); d.financial.validate_cleanup(values['plan'], values['cleanup'])
    binding = values['review']['binding']
    if (sha(encoded(binding)) != values['review']['reviewHash'] or binding['operatorSha256'] != d.parent_sha or
        values['identity']['reviewHash'] != values['review']['reviewHash'] or
        values['ready']['planSha256'] != sha(encoded(values['plan'])) or
        result.get('cleaned') is not True or result.get('manualReconcileRequired') is True or
        result.get('cleanupReceiptSha256') != spec['references']['cleanup'] or
        result.get('cumulativeMigrationBookedCu') != values['cleanup']['cumulativeMigrationBookedCu'] or
        finished is None or finished.get('cleaned') is not True or finished.get('resultSha256') != spec['references']['result'] or
        prepared is None or prepared.get('segment') != segment or prepared.get('receiptSha256') != spec['references']['cleanup'] or
        closed is None or closed.get('segment') != segment or closed.get('cleanupReceiptSha256') != spec['references']['cleanup'] or
        j.latest('sql_ack_' + segment + '-revoke') is None or j.latest('sql_ack_' + segment + '-cleanup') is None or
        running is None or running.get('segment') != segment or running.get('receiptFile') != str(paths['runtime']) or
        running.get('receiptSha256') != spec['references']['runtime'] or stopped is None or stopped.get('segment') != segment or
        values['runtime'].get('planSha256') != sha(encoded(values['plan']))):
        fail('actual_final_v4_cleanup_and_running_stopped_ACKs_required')
    return {**values, 'binding': binding, 'prepared': prepared,
        'references': {key: {'file': str(path), 'sha256': spec['references'][key]} for key, path in paths.items()}}


def terminal_source(d, saved):
    actual = saved['runtime']; definition = saved['definition']; unit = d.ordinary.UNIT
    ref = {'serviceUnit': unit, 'definitions': {str(SYSTEMD / unit): definition['sha256']}}
    with d.handoff.new_reference(d.q, ref):
        p = d.renewal.terminal_source_properties(d)
        if (p['Id'] != unit or p['LoadState'] != 'loaded' or p['Type'] != 'exec' or p['Restart'] != 'no' or
            p['MainPID'] != '0' or p['ActiveState'] not in {'inactive', 'failed'} or p['SubState'] not in {'dead', 'failed'} or
            p['InvocationID'] not in {'', actual['invocation']} or
            (p['InvocationID'] and int(p['ExecMainStartTimestampMonotonic']) != actual['startMonotonicUs']) or
            p['User'] != d.native.USER or p['Group'] != d.native.USER or
            re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(d.renewal.source_command(d))] or
            sha(d.q.protected(SYSTEMD / unit, 50000)) != definition['sha256']):
            fail('exact_final_v4_source_terminal_required')
        gone = {'pid': actual['process']['pid'], 'startTicks': actual['process']['startTicks'], 'bootId': actual['bootId']}
        if not d.live.original_process_gone(gone): fail('final_v4_source_process_lifetime_not_gone')
        d.q.assert_no_unit_environment(d.qe, unit); d.ordinary.readonly_bind(d.qe, unit)
        if (d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(SYSTEMD / unit) or
            d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != []):
            fail('final_v4_source_fragment_changed')
        return {'unit': unit, 'savedInvocation': actual['invocation'], 'processGone': True,
            'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / unit)}


def terminal_controller(d, identity):
    # v7 exposes the pinned v4 generic reader separately from its v6 parent.
    # Bind the CURRENT controller definition/argv and saved identity.
    return d.terminal.terminal_controller(d, d.renewal, identity)


def profile(d, plan, cleanup):
    # The approved profile JSON has permits:[]; its database retains exactly the
    # two disabled replay rows. Zero total historical rows is not a requirement.
    o = d.ordinary; raw = d.q.protected(o.PROFILE, 100000)
    if sha(raw) != o.PROFILE_SHA: fail('exact_normal_profile_file_required')
    approved = read(d, o.APPROVAL)
    expected = {'format': 'yunipals-normal-rpc-profile-approved-v1', 'profileFile': str(o.PROFILE),
        'profileSha256': o.PROFILE_SHA, 'profileId': o.PROFILE_ID, 'expiresAt': o.PROFILE_EXPIRES,
        'manifestHash': d.native.MANIFEST, 'coordinatorId': o.COORDINATOR, 'scope': 'yunipals-opensea', 'permits': []}
    if (set(approved) != set(expected) | {'officialApprovalOutputSha256'} or
        any(approved.get(k) != value for k, value in expected.items()) or
        not d.q.is_sha(approved['officialApprovalOutputSha256']) or
        d.financial.moment(o.PROFILE_EXPIRES) <= now()): fail('approved_unexpired_normal_profile_required')
    state = d.renewal.permit_state(d, plan)
    if state != cleanup['permitState']: fail('exact_retained_disabled_permits_and_spend_required')
    rows = d.qe.query('SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id=' + d.qe.literal(o.PROFILE_ID), market=True)
    if rows != 2: fail('only_the_two_retained_normal_profile_permits_required')
    return {**expected, 'approvalFile': str(o.APPROVAL), 'approvalSha256': sha(encoded(approved)),
        'disabledPermitStateSha256': cleanup['permitStateSha256'], 'activePaidPermits': 0, 'historicalPermitRowsRetained': 2}


def utc_ack(d, spec, plan):
    key = 'sql_ack_utc' if spec['segment'] == 'day1' else 'sql_ack_final-utc'
    ack = journal(d).latest('sql_ack_utc') or d.renewal.journal(d).latest(key)
    if ack is None: fail('actual_financial_only_UTC_ACK_required')
    expected = {'planSha256': sha(encoded(plan)), 'phase': 'utc', 'applied': True, 'grantCountersReset': False}
    if ack.get('receipt') != expected: fail('actual_normal_policy_restore_ACK_required')
    return ack


def financial_state(d, spec, h):
    current = d.financial.snapshot(d.q.peer); cleanup = h['cleanup']; plan = h['plan']
    _, reserve, allocations, _, _, grants = d.financial.policy(current)
    if reserve != 200000 or d.financial.other(allocations) != plan['otherAllocationsSha256']:
        fail('normal_reserve_and_other_allocations_changed')
    day = current['grants']['day']; due = d.financial.moment(cleanup['grantDay'] + 'T00:00:00Z') + timedelta(days=1)
    if day == cleanup['grantDay']:
        if (d.financial.policy_value(current) != cleanup['policy'] or
            not int(cleanup['sourceGrantedCu']) <= grants['unified_source'] <= int(cleanup['policy']['unifiedSourceDailyCu'])):
            fail('sealed_migration_plus_bounded_normal_source_ledger_required')
    elif day == due.date().isoformat():
        utc_ack(d, spec, plan)
        if d.financial.policy_value(current) != plan['originalPolicy'] or grants['unified_source'] > 25000:
            fail('ACKed_original_normal_policy_required')
    else: fail('temporary_ordinary_source_day_outside_reviewed_financial_duty')
    return {'day': day, 'policy': d.financial.policy_value(current), 'bookedMigrationCu': cleanup['cumulativeMigrationBookedCu'],
        'cleanupFile': h['references']['cleanup']['file'], 'cleanupSha256': h['references']['cleanup']['sha256'],
        'UTCdue': stamp(due), 'UTCpending': day == cleanup['grantDay'], 'grantCountersReset': False}


def check_proxies(d, binding, *, zero=False):
    # All four original normal-profile proxy processes are retained unchanged.
    d.renewal.check_proxies(d, binding, paid=False, zero=zero)
    return {name: {'metadata': d.renewal.proxy_metadata(d, name),
        'configuration': binding['normalProxies'][name]['configuration']} for name in d.ordinary.CHAINS}



def adaptive_candidate(d):
    receipt = d.normal_proxy.validate_saved()
    path = d.normal_proxy.OUTPUT / 'receipt.json'
    if (sha(d.q.protected(path, 100000)) != ADAPTIVE_RECEIPT_SHA or
        receipt.get('entry') != str(ADAPTIVE_ENTRY) or receipt.get('entrySha256') != ADAPTIVE_ENTRY_SHA or
        d.normal_proxy.NODE != d.build.NODE or d.normal_proxy.APP != d.build.APP):
        fail('exact_existing_adaptive_proxy_candidate_required')
    d.renewal.candidate_access(d, receipt)
    return {'buildOperatorSha256': ADAPTIVE_BUILD_SHA, 'buildReceiptFile': str(path),
        'buildReceiptSha256': ADAPTIVE_RECEIPT_SHA, 'entry': str(ADAPTIVE_ENTRY),
        'entrySha256': ADAPTIVE_ENTRY_SHA, 'node': str(d.normal_proxy.NODE),
        'workingDirectory': str(d.normal_proxy.APP), 'maximumResponseBytes': 33554432,
        'paidPrimary': False, 'paidLogs': False, 'newBuild': False}


def normal_proxy_files(name):
    if name not in {'base', 'bnb'}: fail('only_Base_BNB_normal_adaptive_overlay_allowed')
    public = OPS / ('source6-normal-queued-source-v1-' + name + '.env')
    drop = SYSTEMD / ('yunipals-market-production-rpc@' + name + '.service.d') / NORMAL_OVERRIDE
    body = b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false\nMARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false\n'
    text = ('[Service]\nEnvironmentFile=' + str(public) + '\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node ' + str(ADAPTIVE_ENTRY) + '\n').encode()
    return public, drop, body, text


def normal_proxy_metadata(d, name):
    if name not in {'base', 'bnb'}:
        return d.renewal.proxy_metadata(d, name)
    unit = 'yunipals-market-production-rpc@' + name + '.service'
    p = d.qe.observed(d.v, unit)
    public, drop, body, text = normal_proxy_files(name)
    if (p['ActiveState'] != 'active' or p['SubState'] != 'running' or
        not re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [str(d.normal_proxy.NODE) + ' ' + str(ADAPTIVE_ENTRY)] or
        p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(d.normal_proxy.APP) or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.normal_proxy.NODE)] or
        sha(d.q.protected(ADAPTIVE_ENTRY, 3000000)) != ADAPTIVE_ENTRY_SHA or
        d.q.protected(public, 2000) != body or d.q.protected(drop, 2000) != text):
        fail('exact_free_only_adaptive_proxy_required')
    return {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}


def compare_normal_proxy(before, after, name):
    actual = deepcopy(after); public, drop, body, text = normal_proxy_files(name)
    if (actual['definitions'].pop(str(drop), None) != sha(text) or
        not actual['privateSettings']['orderedEnvironmentFiles'] or
        actual['privateSettings']['orderedEnvironmentFiles'].pop() != str(public) + ' (ignore_errors=no)' or
        not actual['environmentFileHashes'] or
        actual['environmentFileHashes'].pop() != {'path': str(public), 'optional': False, 'exists': True, 'sha256': sha(body)} or
        {k: v for k, v in actual.items() if k != 'invocation'} != {k: v for k, v in before.items() if k != 'invocation'}):
        fail('only_exact_normal_adaptive_proxy_delta_allowed')


def check_normal_proxies(d, reviewed, *, zero=False):
    if adaptive_candidate(d) != reviewed['adaptiveProxy']: fail('normal_adaptive_candidate_changed')
    result = {}
    for name, old in reviewed['proxies'].items():
        current = normal_proxy_metadata(d, name)
        if name in {'base', 'bnb'}: compare_normal_proxy(old['metadata'], current, name)
        elif current != old['metadata']: fail('unowned_normal_proxy_changed')
        d.renewal.proxy_health(d, name, old['configuration'], paid=False, zero=zero)
        result[name] = {'metadata': current, 'configuration': old['configuration']}
    return result


def retain_adaptive_proxies(d, reviewed):
    # Only called with source+all chain leases held, after current closed-parent
    # terminal/profile/checkpoint/cache proof. This is not paid epoch adoption.
    baseline = reviewed['proxies']
    if adaptive_candidate(d) != reviewed['adaptiveProxy']: fail('normal_adaptive_candidate_changed')
    for name in ['base', 'bnb']:
        public, drop, body, text = normal_proxy_files(name)
        if any(os.path.lexists(p) for p in [public, drop]): fail('fresh_normal_adaptive_overlay_required')
        before = d.renewal.proxy_metadata(d, name)
        if before != baseline[name]['metadata']: fail('exact_old_normal_proxy_before_transition_required')
        journal(d).emit('normal_adaptive_proxy_change_intent', chain=name, beforeInvocation=before['invocation'], paidAuthority=False)
        d.ordinary.public_write(d.q, public, body); d.ordinary.public_write(d.q, drop, text)
        d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
        d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
        after = normal_proxy_metadata(d, name); compare_normal_proxy(before, after, name)
        if after['invocation'] == before['invocation']: fail('new_normal_proxy_invocation_required_for_zero_cache')
        d.v.retry(lambda: d.renewal.proxy_health(d, name, baseline[name]['configuration'], paid=False, zero=True))
        pin = d.q.save(BASE / (name + '-normal-proxy.json'), {'before': before, 'after': after, 'paidAuthority': False})
        journal(d).emit('normal_adaptive_proxy_changed', chain=name, receiptFile=str(BASE / (name + '-normal-proxy.json')), receiptSha256=pin)
    proxies = check_normal_proxies(d, reviewed, zero=True)
    proof = {'proxies': proxies, 'adaptiveProxy': reviewed['adaptiveProxy'], 'freeOnly': True, 'paidAuthority': False, 'permitIds': []}
    pin = d.q.save(BASE / 'normal-proxies.json', proof)
    journal(d).emit('normal_adaptive_proxy_baseline', receiptFile=str(BASE / 'normal-proxies.json'), receiptSha256=pin)
    return proof, pin


def normal_baseline(d, reviewed, value):
    path = BASE / 'normal-proxies.json'
    if value.get('normalProxyBaselineFile') != str(path): fail('exact_acknowledged_normal_proxy_baseline_required')
    proof = read(d, path, value['normalProxyBaselineSha256']); ack = journal(d).latest('normal_adaptive_proxy_baseline')
    if (ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != value['normalProxyBaselineSha256'] or
        proof != {'proxies': value['proxies'], 'adaptiveProxy': reviewed['adaptiveProxy'], 'freeOnly': True, 'paidAuthority': False, 'permitIds': []} or
        value.get('adaptiveProxy') != reviewed['adaptiveProxy']):
        fail('actual_free_only_normal_proxy_baseline_ACK_required')
    if check_normal_proxies(d, reviewed) != proof['proxies']: fail('normal_adaptive_proxy_identity_changed')
    return proof

def review(d, spec):
    if os.path.lexists(BASE):
        s = BASE.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or any(BASE.iterdir()):
            fail('fresh_empty_ordinary_continuation_evidence_required')
    h = history(d, spec); terminal_controller(d, h['identity']); terminal_source(d, h['runtime'])
    financial = financial_state(d, spec, h); selected = profile(d, h['plan'], h['cleanup'])
    if financial['UTCpending'] and d.financial.moment(financial['UTCdue']) - now() < timedelta(seconds=90):
        fail('wait_for_original_UTC_before_normal_handover')
    d.renewal.verify_inputs(d, h['binding'])
    peer = d.ordinary.source_state(d.q, d.qe, d.native, h['binding']['sourceRole'], running=False)
    if sha(encoded(peer['checkpoints'])) != h['prepared']['sourceCheckpointsSha256']:
        fail('final_cleanup_checkpoints_changed_before_normal_restart')
    if d.q.protected(OPS / 'source6-free-runtime-v2.env', 2000) != d.ordinary.source_overlay():
        fail('retained_free_only_normal_environment_required')
    d.ordinary.effective_environment(d.q)
    proxies = check_proxies(d, h['binding'], zero=True)
    candidate = adaptive_candidate(d)
    for name in ['base', 'bnb']:
        public, drop, _, _ = normal_proxy_files(name)
        if any(os.path.lexists(p) for p in [public, drop]): fail('fresh_normal_adaptive_overlay_required')
        if any(Path(p).name >= NORMAL_OVERRIDE for p in proxies[name]['metadata']['definitions']):
            fail('normal_adaptive_selector_must_be_last')
    return {'format': FORMAT, 'operatorSha256': sha(d.q.protected(Path(__file__).absolute(), 200000)),
        'terminalInput': spec, 'parentReferences': h['references'], 'sourceRole': peer['role'], 'checkpoints': peer['checkpoints'],
        'codePins': h['binding']['codePins'], 'rpcOverlay': h['binding']['rpcOverlay'], 'profile': selected,
        'financial': financial, 'proxies': proxies, 'adaptiveProxy': candidate, 'freeOnly': True, 'paidAuthority': False, 'permitIds': [],
        'historicalDisabledPermitsRetained': True, 'sourceSelectionChanged': False,
        'runtimeScope': d.ordinary.RUNTIME_SCOPE, 'automaticRetryAllowed': False}


def timer_definition(d, due):
    row = d.renewal.timer_definition('final-utc', due)
    old_prefix = row['timerUnit'].removesuffix('.timer')
    prefix = 'yunipals-source6-post-renewal-financial-utc-v3'
    old_argv = row['argv']; argv = '/usr/bin/python3 -B ' + str(OPS / Path(__file__).name) + ' --phase utc'
    timer = row['timerText'].replace(old_prefix, prefix)
    service = row['serviceText'].replace(old_argv, argv).replace(str(d.renewal.BASE), str(BASE))
    return {**row, 'kind': 'ordinary-utc', 'timerUnit': prefix + '.timer', 'serviceUnit': prefix + '.service', 'argv': argv,
        'timerText': timer, 'serviceText': service,
        'definitions': {str(SYSTEMD / (prefix + '.timer')): sha(timer.encode()), str(SYSTEMD / (prefix + '.service')): sha(service.encode())}}


def handoff_utc(d, spec, h, financial):
    j = journal(d); disabled = []
    if financial['UTCpending']:
        row = timer_definition(d, financial['UTCdue'])
        for path, text in [(SYSTEMD / row['timerUnit'], row['timerText']), (SYSTEMD / row['serviceUnit'], row['serviceText'])]:
            if os.path.lexists(path) or os.path.lexists(SYSTEMD / (path.name + '.d')): fail('fresh_financial_only_timer_required')
            d.ordinary.public_write(d.q, path, text.encode())
        d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
        j.emit('financial_timer_enable_intent', dueUtc=row['dueUtc'])
        d.q.run(['/usr/bin/systemctl', 'enable', '--now', row['timerUnit']], timeout=15)
        d.renewal.timer_proof(d, row); d.q.sync_directory(SYSTEMD / 'timers.target.wants'); d.q.sync_directory(SYSTEMD)
        pin = d.q.save(BASE / 'financial-timer.json', row)
        j.emit('financial_only_UTC_armed', receiptSha256=pin, dueUtc=row['dueUtc'])
    else:
        row = None; utc_ack(d, spec, h['plan'])
    # Disable only exact old timers, including elapsed one-shot selectors.
    # Old executors must already be idle; never interrupt a financial commit.
    # Definitions and original ACKs remain untouched.
    for kind in ['utc', 'deadline', 'final-utc']:
        path = d.renewal.BASE / ('timer-' + kind + '.json')
        if not os.path.lexists(path): continue
        old = read(d, path)
        due = h['plan']['nextUtc'] if kind == 'utc' else (h['plan']['dispatchExpires'] if kind == 'deadline' else financial['UTCdue'])
        if old != d.renewal.timer_definition(kind, due): fail('original_v4_absolute_timer_changed')
        if row is not None: d.renewal.timer_proof(d, row)
        with d.handoff.new_reference(d.q, old):
            for path, pin in old['definitions'].items():
                if sha(d.q.protected(Path(path), 50000)) != pin: fail('old_timer_definition_changed')
            p = d.q.unit_properties(old['serviceUnit'])
            if p['ActiveState'] != 'inactive' or p['MainPID'] != '0': fail('old_financial_executor_must_finish_before_handoff')
            d.q.assert_no_unit_environment(d.qe, old['serviceUnit'])
            if d.renewal.moment(old['dueUtc']) > now(): d.renewal.timer_proof(d, old)
            j.emit('old_timer_disable_intent', timerUnit=old['timerUnit'], originalDueUtc=old['dueUtc'])
            d.q.run(['/usr/bin/systemctl', 'disable', '--now', old['timerUnit']], timeout=15)
            state = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', old['timerUnit'], '--property=ActiveState']).splitlines())
            if state != {'ActiveState': 'inactive'} or os.path.lexists(SYSTEMD / 'timers.target.wants' / old['timerUnit']):
                fail('old_runtime_bound_timer_disable_not_proven')
            disabled.append(old['timerUnit'])
    if row is not None: d.renewal.timer_proof(d, row)
    ack = {'financialOnly': True, 'dueUtc': financial['UTCdue'], 'pending': row is not None,
        'timerFile': str(BASE / 'financial-timer.json') if row is not None else None,
        'timerSha256': sha(encoded(row)) if row is not None else None, 'originalPaidExpiry': h['plan']['expires'],
        'bookedMigrationCu': h['cleanup']['cumulativeMigrationBookedCu'], 'disabledTimers': disabled, 'paidAuthority': False}
    pin = d.q.save(BASE / 'financial-handoff.json', ack); j.emit('financial_duty_handed_off', receiptSha256=pin)
    return ack


def validate_handoff(d, spec, h):
    saved = read(d, BASE / 'financial-handoff.json'); ack = journal(d).latest('financial_duty_handed_off')
    if ack is None or ack.get('receiptSha256') != sha(encoded(saved)) or saved.get('financialOnly') is not True or saved.get('paidAuthority') is not False:
        fail('durable_financial_only_handoff_ACK_required')
    for unit in saved['disabledTimers']:
        if unit not in [d.renewal.timer_definition(kind, saved['dueUtc'])['timerUnit'] for kind in ['utc', 'deadline', 'final-utc']]:
            fail('only_exact_parent_timers_may_be_disabled')
        state = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', unit, '--property=ActiveState']).splitlines())
        if state != {'ActiveState': 'inactive'} or os.path.lexists(SYSTEMD / 'timers.target.wants' / unit):
            fail('parent_runtime_bound_timer_reenabled')
    if saved['pending'] and now() < d.financial.moment(saved['dueUtc']):
        row = read(d, saved['timerFile'], saved['timerSha256'])
        if row != timer_definition(d, saved['dueUtc']): fail('financial_only_timer_changed')
        d.renewal.timer_proof(d, row)
    else: utc_ack(d, spec, h['plan'])
    return saved


def apply(d, spec, expected):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in d.ordinary.CHAINS: locks.enter_context(d.v.chain_lock(name))
        reviewed = review(d, spec)
        if sha(encoded(reviewed)) != expected: fail('exact_fresh_normal_continuation_review_required')
        BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
        d.q.save(BASE / 'review.json', reviewed); d.q.save(BASE / 'intent.json', {'reviewHash': expected, 'automaticRetryAllowed': False})
        stage = 'financial_only_timer_handoff'
        try:
            h = history(d, spec); handoff = handoff_utc(d, spec, h, reviewed['financial'])
            if validate_handoff(d, spec, h) != handoff: fail('financial_handoff_changed_before_normal_start')
            stage = 'normal_source_definition'
            terminal_source(d, h['runtime']); profile(d, h['plan'], h['cleanup']); financial_state(d, spec, h)
            if check_proxies(d, h['binding']) != reviewed['proxies']: fail('false_proxy_identity_changed_before_normal_start')
            peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=False)
            if peer['checkpoints'] != reviewed['checkpoints']: fail('stopped_checkpoints_changed_before_normal_definition')
            stage = 'retain_adaptive_free_only_proxy'
            proxy_proof, proxy_pin = retain_adaptive_proxies(d, reviewed)
            if d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=False)['checkpoints'] != reviewed['checkpoints']:
                fail('stopped_checkpoints_changed_during_normal_proxy_transition')
            stage = 'normal_source_definition'
            d.ordinary.public_write(d.q, BASE / 'parent-unit.service', d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000))
            # A separate temporary NORMAL-service lifetime, never a paid clock.
            # Keep sixty seconds of start headroom inside its existing 8h bound.
            definition = d.ordinary.source_definition(d.native, expected)
            definition['properties']['RuntimeMaxSec'] = '28740'; definition['maximumRuntimeSeconds'] = 28740
            definition['text'] = definition['text'].replace('RuntimeMaxSec=28800\n', 'RuntimeMaxSec=28740\n')
            definition['sha256'] = sha(definition['text'].encode())
            definition['originalRuntimeExpiresMonotonicMicroseconds'] = time.monotonic_ns() // 1000 + 28800000000
            d.q.save(BASE / 'definition.json', definition)
            d.renewal.replace_source_definition(d, definition, h['runtime']['definition']['sha256'])
            if d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=False)['checkpoints'] != reviewed['checkpoints']:
                fail('stopped_checkpoints_changed_before_normal_start')
            if time.monotonic_ns() // 1000 + 28740000000 + 15000000 > definition['originalRuntimeExpiresMonotonicMicroseconds']:
                fail('normal_start_headroom_consumed_no_start')
            stage = 'one_normal_source_start'; journal(d).emit('normal_source_start_intent', definitionSha256=sha(encoded(definition)))
            d.q.run(['/usr/bin/systemctl', 'start', d.ordinary.UNIT], timeout=15)
            actual = d.ordinary.runtime(d.q, d.native, definition)
            d.v.retry(lambda: (d.ordinary.source_health(), d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=True)))
            if check_normal_proxies(d, reviewed) != proxy_proof['proxies']: fail('normal_proxy_identity_changed_during_source_start')
            d.ordinary.runtime(d.q, d.native, definition, saved=actual)
            result = {'format': FORMAT, 'reviewFile': str(BASE / 'review.json'), 'reviewSha256': expected,
                'definition': definition, 'ordinaryRuntime': actual, 'financialHandoff': handoff,
                'profile': reviewed['profile'], 'proxies': proxy_proof['proxies'], 'parentReferences': reviewed['parentReferences'],
                'adaptiveProxy': reviewed['adaptiveProxy'], 'normalProxyBaselineFile': str(BASE / 'normal-proxies.json'), 'normalProxyBaselineSha256': proxy_pin,
                'sourceDigest': d.native.ACTOR, 'schema': d.native.SCHEMA, 'nativeBuild': d.native.NATIVE,
                'freeOnly': True, 'permitIds': [], 'paidAuthority': False, 'sourceSelectionChanged': False,
                'runtimeScope': d.ordinary.RUNTIME_SCOPE, 'sourceAndChainLeaseReleaseRequired': True}
            pin = d.q.save(BASE / 'runtime.json', result); journal(d).emit('ordinary_runtime_started', receiptSha256=pin, invocation=actual['invocation'])
        except BaseException as error:
            d.q.save(BASE / 'failed.json', {'stage': stage, 'failure': failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    released = {'runtimeReceiptSha256': pin, 'sourceAndChainHandoverLeasesReleased': True}
    released_sha = d.q.save(BASE / 'handover-released.json', released)
    return {'format': FORMAT, 'runtimeReceiptFile': str(BASE / 'runtime.json'), 'runtimeReceiptSha256': pin,
        'leaseReleasedFile': str(BASE / 'handover-released.json'), 'leaseReleasedSha256': released_sha,
        'sourceStarted': True, 'paidAuthority': False, 'sourceSelectionChanged': False}


def utc(d):
    reviewed = read(d, BASE / 'review.json'); spec = reviewed['terminalInput']; h = history(d, spec)
    row = read(d, BASE / 'financial-timer.json')
    due = d.financial.moment(h['cleanup']['grantDay'] + 'T00:00:00Z') + timedelta(days=1)
    if row != timer_definition(d, stamp(due)) or now() < due: fail('exact_original_UTC_due_required')
    d.renewal.timer_proof(d, row, executing=True)
    with d.q.mutex(BASE / 'financial.lock', seconds=12):
        j = journal(d)
        if j.latest('sql_ack_utc') is not None:
            utc_ack(d, spec, h['plan']); return {'format': FORMAT, 'UTCAlreadyAcknowledged': True}
        if j.latest('sql_intent_utc') is not None: fail('ambiguous_UTC_SQL_no_automatic_retry')
        profile(d, h['plan'], h['cleanup'])
        # Before restore, old-day ledger remains checked against the raised
        # closed policy. Never request it again after an acknowledged restore.
        prior = d.financial.snapshot(d.q.peer, day=h['cleanup']['grantDay'])
        current = d.financial.snapshot(d.q.peer)
        sql = d.financial.owner_sql('utc', h['plan'], current, receipt=h['cleanup'], prior=prior, at=stamp(now()))
        d.q.save(BASE / 'owner-utc.sql.json', {'sql': sql, 'sha256': sha(sql.encode())})
        j.emit('sql_intent_utc', sqlSha256=sha(sql.encode()))
        rows = [json.loads(line) for line in d.q.peer(sql, write=True).splitlines() if line.strip()]
        expected = {'planSha256': sha(encoded(h['plan'])), 'phase': 'utc', 'applied': True, 'grantCountersReset': False}
        if rows != [expected]: fail('finite_financial_only_UTC_commit_ACK_mismatch')
        j.emit('sql_ack_utc', receipt=expected)
    return {'format': FORMAT, 'UTCPolicyRestored': True, 'grantCountersReset': False}


def validate_current(receipt_file, receipt_sha):
    d = modules()
    if Path(receipt_file) != BASE / 'runtime.json': fail('exact_post_replay_normal_receipt_required')
    value = read(d, receipt_file, receipt_sha); reviewed = read(d, value['reviewFile'], value['reviewSha256'])
    released = read(d, BASE / 'handover-released.json')
    if (os.path.lexists(BASE / 'failed.json') or value.get('format') != FORMAT or value.get('paidAuthority') is not False or
        value.get('permitIds') != [] or value.get('freeOnly') is not True or
        reviewed['operatorSha256'] != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
        released != {'runtimeReceiptSha256': receipt_sha, 'sourceAndChainHandoverLeasesReleased': True}):
        fail('acknowledged_released_normal_runtime_required')
    h = history(d, reviewed['terminalInput'])
    financial_state(d, reviewed['terminalInput'], h); profile(d, h['plan'], h['cleanup'])
    if validate_handoff(d, reviewed['terminalInput'], h) != value['financialHandoff']:
        fail('acknowledged_financial_handoff_changed')
    d.renewal.verify_inputs(d, h['binding'])
    actual = d.ordinary.runtime(d.q, d.native, value['definition'], saved=value['ordinaryRuntime'])
    d.ordinary.source_health(); peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=True)
    normal_baseline(d, reviewed, value)
    return {**value, 'ordinaryRuntime': {**actual, 'roleOid': peer['role']['oid']},
        'checkpoints': peer['checkpoints'], 'financialCurrent': financial_state(d, reviewed['terminalInput'], h),
        'leaseReleasedFile': str(BASE / 'handover-released.json'), 'leaseReleasedSha256': sha(encoded(released))}


def failure(error):
    frames = []; labels = set(); trace = error.__traceback__
    while trace:
        code = trace.tb_frame.f_code; path = Path(code.co_filename)
        if path.absolute() == Path(__file__).absolute() or path.name in {*PARENTS.values(), 'source6-free-runtime-v4.py', 'paid-continuation-financial-v1.py'}:
            frames.append({'file': path.name, 'function': code.co_name, 'line': trace.tb_lineno})
            if error.args and isinstance(error.args[0], str) and error.args[0] in code.co_consts: labels.add(error.args[0])
        trace = trace.tb_next
    return {'errorClass': type(error).__name__, 'fixedCodes': sorted(labels), 'publicFrames': frames[-12:],
        'errno': error.errno if isinstance(error, OSError) else None, 'rawMessageExported': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--phase', choices=['review', 'apply', 'utc'], default='review'); parser.add_argument('--apply')
    args = parser.parse_args(); d = modules()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d.q.actual_root_capabilities(); os.umask(0o077)
    def interrupted(*_): raise InterruptedError('bounded_normal_continuation_interrupted')
    for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]: signal.signal(sig, interrupted)
    signal.alarm(300)
    try:
        if args.phase == 'utc': out = utc(d)
        else:
            spec = read(d, INPUT)
            if args.phase == 'apply': out = apply(d, spec, args.apply)
            else:
                reviewed = review(d, spec)
                out = {'format': FORMAT, 'reviewHash': sha(encoded(reviewed)), 'applied': False,
                    'bookedMigrationCu': reviewed['financial']['bookedMigrationCu'], 'UTCdue': reviewed['financial']['UTCdue'],
                    'paidAuthority': False, 'sourceSelectionChanged': False}
        print(json.dumps(out, sort_keys=True))
    finally: signal.alarm(0)


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': failure(error), 'automaticRetryAllowed': False}, sort_keys=True)); raise SystemExit(1)
