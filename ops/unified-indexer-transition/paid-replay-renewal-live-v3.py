#!/usr/bin/env python3
"""One same-day mixed-routing handover within the existing paid renewal.

The exact plan, ready clock, permit IDs, spent CU and checkpoints are inherited.
No activate/admission path, new allowance, expiry extension or automatic retry.
"""
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-paid-replay-renewal-v3-20261021')
SYSTEMD = Path('/etc/systemd/system')
FORMAT = 'yunipals-paid-replay-renewal-live-v3'
RUN_ID = '20261021-renew1-mixed'
CONTROLLER = 'yunipals-paid-replay-renewal-v3-controller.service'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
ORDINARY_SHA = '74af50abf9ca4f232e1922c0afb91fc8512328b9e194f2e3fc46fd2a148c34e6'
FINANCIAL_SHA = '93dd95ae05def701fbc6f785a8a599f5935254c141c9122e782551054db3402e'
SEAL_SHA = 'a90b1dbf59cc11fd478130003bc6ef7181c59f55737dc069b7025e63bdbc58fb'
PARENT = Path('/var/backups/yunipals-source6-free-transport-v2-20261021/runtime.json')
PARENT_SHA = 'd936bd399f90b8205fcbefe81a8cdef449d824fe3465a30f8ff9627112b610e5'
OLD_SHA = '03ef4a300a31c755f2fe233fbe68c19be0f326ecfee3854f97378e2fe63b632a'
SAME_DAY_SHA = '234fe6a679ea4b7005539137799f3b721f72f47ed48548b141605d89015c05ba'
BUILD_SHA = '12c011e4aa0eec2783ca444673d6e02c5b571d6e14a04b3400dfaa49808f9747'
BUILD_RECEIPT_SHA = 'd78492c63a6bf42adbdcd5f535dea5a68119d1b1215062e04769a420f1bc2ed1'
OLD_BASE = Path('/var/backups/yunipals-paid-replay-renewal-v2-20261021')
OLD_SOURCE_INVOCATION = '95fd97e2ab0b4f29bc76ad2a0e198f7a'
APPROVAL = OPS / 'paid-replay-renewal-v1.approval.json'
OVERRIDE = 'zzzzzzzzzzzzzzzzzzzz-source6-renewal-mixed-v1-20261021.conf'
PUBLIC = OPS / 'paid-replay-renewal-v3-source.env'
TARGETS = {56: 128816538, 8453: 52870977}
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(code): raise RuntimeError(code)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def now(): return datetime.now(timezone.utc)
def moment(value): return datetime.fromisoformat(value.replace('Z', '+00:00'))
def stamp(value): return value.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def modules():
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        s = item.lstat()
        if item.is_symlink() or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_loader_required')
    raw = path.read_bytes()
    if len(raw) > 300000 or sha(raw) != Q_SHA: fail('pinned_loader_required')
    q = types.ModuleType('renewal_pinned_loader'); q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    ordinary = q.load(OPS / 'source6-free-runtime-v3.py', ORDINARY_SHA, 'renewal_current_source')
    q2, handoff, live, model, epoch, native, qe, om, n, c, v = ordinary.modules()
    financial = q.load(OPS / 'paid-continuation-financial-v1.py', FINANCIAL_SHA, 'renewal_finite_financial_owner')
    seal = q.load(OPS / 'paid-productive-failed-start-seal-v1.py', SEAL_SHA, 'renewal_empty_cgroup_reader')
    old = q.load(OPS / 'paid-replay-renewal-live-v2.py', OLD_SHA, 'mixed_exact_parent_lifecycle')
    same_day = q.load(OPS / 'paid-continuation-same-day-v1.py', SAME_DAY_SHA, 'mixed_same_day_financial_owner')
    build = q.load(OPS / 'source6-mixed-proxy-build-v1.py', BUILD_SHA, 'mixed_actual_public_build')
    return types.SimpleNamespace(old=old, same_day=same_day, build=build, q=q, ordinary=ordinary, handoff=handoff, live=live, model=model,
        native=native, qe=qe, om=om, n=n, c=c, v=v, financial=financial, seal=seal)


def read(d, path, expected=None, maximum=2000000):
    raw = d.q.protected(Path(path), maximum)
    if expected is not None and sha(raw) != expected: fail('protected_renewal_reference_changed')
    return json.loads(raw)


def fresh_base():
    if not os.path.lexists(BASE): return
    s = BASE.lstat()
    if not stat.S_ISDIR(s.st_mode) or BASE.is_symlink() or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or any(BASE.iterdir()):
        fail('fresh_empty_renewal_evidence_required')


def journal(d): return d.live.journal_for(d.q, BASE)


def inspect(d, *, prepared=False):
    if not prepared: fresh_base()
    parent_review = read(d, OLD_BASE / 'review.json')
    plan = read(d, OLD_BASE / 'plan.json'); ready = read(d, OLD_BASE / 'ready.json')
    identity = read(d, OLD_BASE / 'controller-identity.json')
    old_journal = d.old.journal(d)
    running = old_journal.latest('source_running')
    if (sha(encoded(parent_review['binding'])) != parent_review['reviewHash'] or
        ready['planSha256'] != sha(encoded(plan)) or running is None or running['segment'] != 'day1' or
        old_journal.latest('work_failed') is not None or old_journal.latest('controller_finished') is not None or
        old_journal.latest('segment_cleanup_prepared') is not None or
        d.old.controller_identity(d, parent_review['reviewHash']) != identity):
        fail('exact_still_running_parent_renewal_required')
    d.financial.validate(plan)
    if (moment(plan['start']) != moment('2026-10-21T20:20:13.731762Z') or
        moment(plan['expires']) != moment('2026-10-22T04:20:13.731762Z') or
        now() + timedelta(minutes=15) >= min(moment(r['expires']) for r in plan['permits'])):
        fail('original_window_with_sufficient_same_day_handoff_time_required')
    parent = read(d, running['receiptFile'], running['receiptSha256'])
    if parent['runtime']['invocation'] != OLD_SOURCE_INVOCATION: fail('exact_reviewed_paid_source_required')
    d.old.runtime(d, parent['definition'], plan, saved=parent['runtime'])
    d.old.verify_inputs(d, parent_review['binding'])
    d.old.check_proxies(d, parent_review['binding'], paid=True)
    current = d.financial.snapshot(d.q.peer); d.financial.progress(plan, current)
    state = permit_state(d, plan)
    if state['active'] != 2 or len(state['owned']) != 2: fail('exact_two_current_renewal_permits_required')
    disabled = deepcopy(state); disabled['active'] = 0
    for row in disabled['owned']:
        if row['enabled'] is not True: fail('owned_current_permit_must_be_enabled')
        row['enabled'] = False
    d.financial.validate_permit_state(plan, disabled)
    candidate = d.build.validate_saved()
    if sha(d.q.protected(d.build.OUTPUT / 'receipt.json', 100000)) != BUILD_RECEIPT_SHA:
        fail('actual_compiled_mixed_proxy_receipt_required')
    candidate_access(d, candidate)
    for name in ['base', 'bnb']:
        public, drop, _, _ = proxy_files(name)
        if any(os.path.lexists(p) for p in [public, drop]): fail('fresh_owned_mixed_proxy_files_required')
        if any(Path(p).name >= OVERRIDE for p in parent_review['binding']['normalProxies'][name]['after']['definitions']):
            fail('mixed_proxy_selector_must_be_last')
    if not prepared and (os.path.lexists(SYSTEMD / CONTROLLER) or os.path.lexists(SYSTEMD / (CONTROLLER + '.d'))):
        fail('one_fresh_mixed_controller_required')
    inherited = parent_review['binding']
    binding = {**inherited, 'format': FORMAT,
        'operatorSha256': sha(d.q.protected(Path(__file__).absolute(), 200000)),
        'sameDayFinancialOperatorSha256': SAME_DAY_SHA, 'candidateReceiptFile': str(d.build.OUTPUT / 'receipt.json'),
        'candidateReceiptSha256': BUILD_RECEIPT_SHA, 'candidate': candidate,
        'parentReviewFile': str(OLD_BASE / 'review.json'), 'parentReviewSha256': sha(d.q.protected(OLD_BASE / 'review.json')),
        'parentPlanSha256': sha(d.q.protected(OLD_BASE / 'plan.json')),
        'parentReadySha256': sha(d.q.protected(OLD_BASE / 'ready.json')),
        'parentController': identity, 'parentSourceFile': running['receiptFile'], 'parentSourceSha256': running['receiptSha256'],
        'parentSourceInvocation': OLD_SOURCE_INVOCATION, 'clockStarted': True, 'clockRenewed': False,
        'sameWindowOnly': True, 'newPermitIds': False, 'paidAuthorityAdded': False}
    return {'reviewHash': sha(encoded(binding)), 'binding': binding}, parent


def candidate_access(d, candidate):
    # Source-only entry readability and dependency resolution; no app imports.
    code = """const fs=require('node:fs'),crypto=require('node:crypto'),m=require('node:module');const v=Object.fromEntries(fs.readFileSync('/proc/self/status','utf8').split('\\n').filter(x=>x.includes(':')).map(x=>[x.slice(0,x.indexOf(':')),x.slice(x.indexOf(':')+1).trim()]));if(v.Uid.split(/\\s+/).some(x=>x!=='974')||v.Gid.split(/\\s+/).some(x=>x!=='968')||v.Groups!==''||v.NoNewPrivs!=='1'||['CapInh','CapPrm','CapEff','CapAmb'].some(k=>BigInt('0x'+v[k])!==0n))throw Error('proxy_identity');const entry=process.argv[1],pg=m.createRequire(entry).resolve('pg');fs.readFileSync(pg);console.log(JSON.stringify({entrySha256:crypto.createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),dependencyResolvable:true,uid:974,gid:968,groups:[],capabilities:0,noNewPrivileges:true}));"""
    actual = json.loads(d.q.run(['/usr/bin/setpriv', '--reuid=974', '--regid=968', '--clear-groups',
        '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', str(d.build.NODE), '-e', code, candidate['entry']], timeout=5, cap=10000))
    if actual != {'entrySha256': candidate['entrySha256'], 'dependencyResolvable': True, 'uid': 974, 'gid': 968,
                  'groups': [], 'capabilities': 0, 'noNewPrivileges': True}: fail('actual_proxy_UID_candidate_access_required')
    return actual


def proxy_metadata(d, name):
    if name not in {'base', 'bnb'} or not os.path.lexists(proxy_files(name)[1]):
        return d.ordinary.proxy_metadata(d.q, d.qe, d.n, d.c, d.v, name)
    unit = 'yunipals-market-production-rpc@' + name + '.service'
    p = d.qe.observed(d.v, unit)
    entry = d.build.OUTPUT / 'rpc-budget-proxy.mjs'
    if (p['ActiveState'] != 'active' or p['SubState'] != 'running' or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [str(d.build.NODE) + ' ' + str(entry)] or
        p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(d.build.APP) or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.build.NODE)] or
        sha(d.q.protected(entry, 3000000)) != '68916fb58eb1ba761de2d4ee17348fb1e45c1466c8bd06532fd76fa640ab37b9'):
        fail('exact_built_mixed_proxy_required')
    return {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}


def stop_parent_controller(d, binding):
    expected = binding['parentController']
    row = {'serviceUnit': d.old.CONTROLLER, 'definitions': {str(SYSTEMD / d.old.CONTROLLER): expected['definitionSha256']}}
    with d.handoff.new_reference(d.q, row):
        if d.old.controller_identity(d, expected['reviewHash']) != expected: fail('foreign_parent_controller_stop_refused')
        fd = os.pidfd_open(expected['process']['pid'])
        try:
            journal(d).emit('parent_controller_stop_intent', invocation=expected['invocation'], sameWindowOnly=True)
            signal.pidfd_send_signal(fd, signal.SIGTERM)
            poll = select.poll(); poll.register(fd, select.POLLIN)
            if not poll.poll(360000): fail('parent_controller_did_not_finish_cleanup')
        finally: os.close(fd)
        p = d.q.unit_properties(d.old.CONTROLLER)
        if (p['MainPID'] != '0' or p['ActiveState'] not in {'inactive', 'failed'} or
            p['InvocationID'] not in {'', expected['invocation']} or not d.live.original_process_gone(expected['process'])):
            fail('exact_parent_controller_terminal_required')
    journal(d).emit('parent_controller_stopped', invocation=expected['invocation'])


def parent_terminal_source(d, binding):
    saved = read(d, binding['parentSourceFile'], binding['parentSourceSha256'])
    actual = saved['runtime']; definition = saved['definition']
    reference = {'serviceUnit': d.ordinary.UNIT, 'definitions': {str(SYSTEMD / d.ordinary.UNIT): definition['sha256']}}
    with d.handoff.new_reference(d.q, reference):
        p = props(d)
        if (p['Id'] != d.ordinary.UNIT or p['LoadState'] != 'loaded' or p['Type'] != 'exec' or p['Restart'] != 'no' or
            p['MainPID'] != '0' or p['ActiveState'] not in {'inactive', 'failed'} or p['SubState'] not in {'dead', 'failed'} or
            p['InvocationID'] not in {'', actual['invocation']} or
            (p['InvocationID'] and int(p['ExecMainStartTimestampMonotonic']) != actual['startMonotonicUs']) or
            p['User'] != d.native.USER or p['Group'] != d.native.USER or
            re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(d.old.source_command(d))] or
            sha(d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000)) != definition['sha256']):
            fail('exact_parent_source_terminal_definition_required')
        gone = {'pid': actual['process']['pid'], 'startTicks': actual['process']['startTicks'], 'bootId': actual['bootId']}
        if not d.live.original_process_gone(gone): fail('parent_source_lifetime_not_gone')
        d.q.assert_no_unit_environment(d.qe, d.ordinary.UNIT); d.ordinary.readonly_bind(d.qe, d.ordinary.UNIT)
        if (d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(SYSTEMD / d.ordinary.UNIT) or
            d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != []):
            fail('parent_source_terminal_fragment_changed')
        return {'unit': d.ordinary.UNIT, 'invocation': actual['invocation'], 'mainPID': 0,
            'processGone': True, 'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT)}


def parent_closure(d, binding):
    parent_journal = d.old.journal(d)
    finished = parent_journal.latest('controller_finished'); closed = parent_journal.latest('segment_closed')
    prepared = parent_journal.latest('segment_cleanup_prepared')
    result = read(d, OLD_BASE / 'controller-result.json')
    receipt = read(d, OLD_BASE / 'cleanup-day1.json')
    d.financial.validate_cleanup(read(d, OLD_BASE / 'plan.json'), receipt)
    if (finished is None or finished.get('cleaned') is not True or
        finished.get('resultSha256') != sha(d.q.protected(OLD_BASE / 'controller-result.json')) or
        result.get('cleaned') is not True or result.get('manualReconcileRequired') is True or
        closed is None or closed.get('segment') != 'day1' or prepared is None or prepared.get('segment') != 'day1' or
        closed.get('cleanupReceiptSha256') != sha(encoded(receipt)) or prepared.get('receiptSha256') != sha(encoded(receipt)) or
        parent_journal.latest('sql_ack_day1-cleanup') is None or parent_journal.latest('sql_ack_day1-revoke') is None):
        fail('actual_parent_stopped_sealed_and_cleanup_ACK_required')
    stopped = parent_terminal_source(d, binding)
    d.old.check_proxies(d, binding, paid=False, zero=True)
    peer = d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)
    if sha(encoded(peer['checkpoints'])) != prepared['sourceCheckpointsSha256']:
        fail('parent_closed_checkpoint_seal_changed')
    if permit_state(d, read(d, OLD_BASE / 'plan.json')) != receipt['permitState']:
        fail('actual_disabled_parent_permit_state_changed')
    current = d.financial.snapshot(d.q.peer)
    d.same_day.review(read(d, OLD_BASE / 'plan.json'), current, receipt, at=stamp(now()))
    refs = {name: {'file': str(OLD_BASE / name), 'sha256': sha(d.q.protected(OLD_BASE / name))}
        for name in ['controller-result.json', 'cleanup-day1.json', 'plan.json', 'ready.json', 'journal.jsonl']}
    return {'format': FORMAT, 'parentController': binding['parentController'], 'references': refs,
        'cleanupReceipt': receipt, 'checkpoints': peer['checkpoints'], 'sourceStopped': stopped,
        'originalWindowUnchanged': True, 'samePermitIds': True, 'sourceBaselineReset': False}


def proxy_files(name):
    if name not in {'base', 'bnb'}: fail('only_base_bnb_mixed_proxies_allowed')
    public = OPS / ('paid-replay-renewal-v3-' + name + '.env')
    drop = SYSTEMD / ('yunipals-market-production-rpc@' + name + '.service.d') / OVERRIDE
    body = b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false\nMARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=true\n'
    entry = OPS / 'source6-mixed-proxy-v1/rpc-budget-proxy.mjs'
    text = '[Service]\nEnvironmentFile=' + str(public) + '\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node ' + str(entry) + '\n'
    return public, drop, body, text.encode()


def same_proxy(d, before, after, name, *, paid):
    actual = deepcopy(after)
    if paid:
        public, drop, body, text = proxy_files(name)
        if (actual['definitions'].pop(str(drop), None) != sha(text) or
            actual['privateSettings']['orderedEnvironmentFiles'].pop() != str(public) + ' (ignore_errors=no)' or
            actual['environmentFileHashes'].pop() != {'path': str(public), 'optional': False, 'exists': True, 'sha256': sha(body)}):
            fail('only_exact_owned_paid_selector_allowed')
    if {k: v for k, v in actual.items() if k != 'invocation'} != {k: v for k, v in before.items() if k != 'invocation'}:
        fail('proxy_code_definitions_or_private_inputs_changed')


def proxy_health(d, name, expected_config, *, paid, zero=False):
    chain, port = d.ordinary.CHAINS[name]
    if d.v.request(port, '/health').get('status') != 'ready': fail('owned_proxy_unhealthy')
    metrics = d.v.request(port, '/metrics'); unified = metrics.get('unified', {})
    config = {k: metrics.get(k) for k in d.v.CONFIG_KEYS}
    if config != expected_config or unified.get('profileId') != d.ordinary.PROFILE_ID or unified.get('chainId') != chain or unified.get('sourceRouting') != ('paid_logs_free_blocks' if paid else 'free_first'):
        fail('owned_proxy_routing_or_normal_configuration_changed')
    if zero:
        budget = metrics.get('workloadBudgets', {}).get('unified_source', {})
        if (budget.get('workload') != 'unified_source' or budget.get('priority') != 'background' or
            any(type(budget.get(k)) is not int or budget[k] != 0 for k in ['grantedCu', 'usedCu', 'remainingCu'])):
            fail('owned_source_RAM_grant_cache_not_empty')
    return {'configuration': config, 'counters': unified.get('traffic', {}).get('unified_source', {})}


def check_proxies(d, binding, *, paid, zero=False):
    result = {}
    for name, saved in binding['normalProxies'].items():
        current = proxy_metadata(d, name)
        ours = paid and name in {'base', 'bnb'}
        same_proxy(d, saved['after'], current, name, paid=ours)
        if name not in {'base', 'bnb'} and current != saved['after']: fail('unowned_proxy_changed')
        proxy_health(d, name, saved['configuration'], paid=ours, zero=zero)
        result[name] = current
    return result


def change_proxies(d, binding, *, paid):
    j = journal(d); before = check_proxies(d, binding, paid=not paid, zero=paid)
    for name in ['base', 'bnb']:
        public, drop, body, text = proxy_files(name)
        j.emit('proxy_change_intent', chain=name, paid=paid, beforeInvocation=before[name]['invocation'])
        if paid:
            d.ordinary.public_write(d.q, public, body); d.ordinary.public_write(d.q, drop, text)
        else:
            if d.q.protected(public, 2000) != body or d.q.protected(drop, 2000) != text: fail('owned_paid_files_changed')
            drop.unlink(); public.unlink(); d.q.sync_directory(drop.parent); d.q.sync_directory(public.parent)
        d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
        d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
        current = proxy_metadata(d, name)
        same_proxy(d, binding['normalProxies'][name]['after'], current, name, paid=paid)
        if current['invocation'] == before[name]['invocation']: fail('new_proxy_invocation_required_to_drop_RAM_cache')
        d.v.retry(lambda: proxy_health(d, name, binding['normalProxies'][name]['configuration'], paid=paid, zero=True))
        path = BASE / (name + ('-paid-' if paid else '-false-') + str(len(j.rows())) + '.json')
        pin = d.q.save(path, {'before': before[name], 'after': current, 'paid': paid})
        j.emit('proxy_changed', chain=name, paid=paid, receiptFile=str(path), receiptSha256=pin)
    return check_proxies(d, binding, paid=paid, zero=True)


def restore_false_proxies(d, binding):
    """Recover partial setup too, using exact owned files and current metadata."""
    for name in ['base', 'bnb']:
        public, drop, body, text = proxy_files(name)
        current = proxy_metadata(d, name)
        selected = os.path.lexists(drop)
        same_proxy(d, binding['normalProxies'][name]['after'], current, name, paid=selected)
        if selected:
            if d.q.protected(drop, 2000) != text or d.q.protected(public, 2000) != body: fail('exact_owned_paid_cleanup_files_required')
            drop.unlink(); public.unlink(); d.q.sync_directory(drop.parent); d.q.sync_directory(public.parent)
            journal(d).emit('proxy_false_restart_intent', chain=name, beforeInvocation=current['invocation'])
            d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
            d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
            after = proxy_metadata(d, name)
            if after['invocation'] == current['invocation']: fail('fresh_false_proxy_required_for_cache_destruction')
            same_proxy(d, binding['normalProxies'][name]['after'], after, name, paid=False)
        elif os.path.lexists(public):
            if d.q.protected(public, 2000) != body: fail('unselected_public_paid_file_changed')
            public.unlink(); d.q.sync_directory(public.parent)
        d.v.retry(lambda: proxy_health(d, name, binding['normalProxies'][name]['configuration'], paid=False, zero=True))
        journal(d).emit('owned_proxy_false', chain=name)
    return check_proxies(d, binding, paid=False, zero=True)


def props(d):
    p = d.native.unit_props(types.SimpleNamespace(command=lambda argv, env=ENV, timeout=5: d.q.run(argv, timeout=timeout)), d.ordinary.UNIT)
    p['Type'] = d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Service', 'Type', 's')
    return p


def source_command(d):
    argv = d.ordinary.source_command()
    old = '--env-file=' + str(OPS / 'source6-free-runtime-v2.env')
    if argv.count(old) != 1: fail('exact_original_source_command_required')
    return [('--env-file=' + str(PUBLIC)) if part == old else part for part in argv]


def source_environment(d, plan):
    rows = plan['permits']
    if len(rows) != 2 or {r['chainId'] for r in rows} != {56, 8453}: fail('two_fixed_renewal_permits_required')
    body = ('UNIFIED_RPC_PROFILE_FILE=' + str(d.ordinary.PROFILE) + '\nUNIFIED_RPC_PROFILE_ID=' + d.ordinary.PROFILE_ID + '\nUNIFIED_RPC_POLICY_REQUIRED=true\n')
    for row in sorted(rows, key=lambda row: row['chainId']):
        if not re.fullmatch('0x[0-9a-f]{64}', row['permitId']): fail('exact_bounded_renewal_permit_required')
        body += 'UNIFIED_RPC_REPLAY_PERMIT_ID_' + str(row['chainId']) + '=' + row['permitId'] + '\n'
    return body.encode()


def source_definition(d, parent, plan, ready, *, phase='day1'):
    properties = deepcopy(parent['definition']['properties'])
    # This is a new explicitly approved cutoff; the old definition is archived.
    cutoff = plan['permits'][0]['expires'] if phase == 'day1' else plan['dispatchExpires']
    maximum = int((moment(cutoff) - now()).total_seconds()) - 30
    if not 30 <= maximum < 28800: fail('finite_remaining_renewal_runtime_required')
    properties['RuntimeMaxSec'] = str(maximum)
    text = '[Unit]\nDescription=Yunipals approved paid renewal ' + sha(encoded(plan)) + '\n[Service]\nType=exec\n'
    text += ''.join(k + '=' + v + '\n' for k, v in properties.items())
    text += 'ExecStart=' + ' '.join(source_command(d)) + '\n'
    return {'unit': d.ordinary.UNIT, 'text': text, 'sha256': sha(text.encode()), 'properties': properties,
        'maximumRuntimeSeconds': maximum, 'planSha256': sha(encoded(plan)),
        'segmentDispatchExpires': cutoff,
        'dispatchExpiresMonotonicUs': ready['monotonicUs'] + int((moment(cutoff) - moment(plan['start'])).total_seconds() * 1000000)}


def runtime(d, definition, plan, *, saved=None):
    p = props(d); expected = definition['properties']
    if (p['Id'] != d.ordinary.UNIT or p['Type'] != 'exec' or p['ActiveState'] != 'active' or p['SubState'] != 'running' or
        not p['MainPID'].isdigit() or int(p['MainPID']) <= 1 or p['User'] != d.native.USER or p['Group'] != d.native.USER or
        p['Description'] != 'Yunipals approved paid renewal ' + sha(encoded(plan)) or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(source_command(d))]): fail('exact_renewal_source_required')
    d.q.assert_no_unit_environment(d.qe, d.ordinary.UNIT); d.ordinary.readonly_bind(d.qe, d.ordinary.UNIT)
    parser = d.c.persistent()
    if (any(p[k] != value for k, value in expected.items() if k not in {'RuntimeMaxSec', 'CPUQuota', 'TimeoutStopSec', 'IPAddressDeny', 'IPAddressAllow', 'BindReadOnlyPaths'}) or
        parser.duration_us(p['RuntimeMaxUSec']) != definition['maximumRuntimeSeconds'] * 1000000 or parser.duration_us(p['CPUQuotaPerSecUSec']) != 1000000 or
        parser.duration_us(p['TimeoutStopUSec']) != 30000000 or parser.address_networks(p['IPAddressDeny']) != {'0.0.0.0/0', '::/0'} or
        parser.address_networks(p['IPAddressAllow']) != {'127.0.0.0/8', '::1/128'}): fail('source_sandbox_or_resource_drift')
    if d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != [] or sha(d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000)) != definition['sha256']:
        fail('renewal_source_definition_changed')
    reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'renewal_same_UID_reader')
    actual = {'unit': d.ordinary.UNIT, 'invocation': p['InvocationID'], 'process': reader.identity(int(p['MainPID']), d.ordinary.UNIT),
        'definitionSha256': definition['sha256'], 'startMonotonicUs': int(p['ExecMainStartTimestampMonotonic']),
        'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    if not re.fullmatch('[0-9a-f-]{36}', actual['bootId']): fail('actual_boot_identity_required')
    if actual['startMonotonicUs'] + definition['maximumRuntimeSeconds'] * 1000000 > definition['dispatchExpiresMonotonicUs']:
        fail('actual_runtime_would_extend_frozen_dispatch_expiry')
    if saved is not None and actual != saved: fail('renewal_source_identity_changed')
    if now() >= moment(definition['segmentDispatchExpires']): fail('renewal_dispatch_expired')
    return actual


def stop_source(d, expected):
    p = props(d)
    if p['InvocationID'] != expected['invocation'] or p['MainPID'] != str(expected['process']['pid']): fail('foreign_source_stop_refused')
    reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'renewal_stop_same_UID_reader')
    if reader.identity(int(p['MainPID']), d.ordinary.UNIT) != expected['process']: fail('source_identity_changed_before_stop')
    pidfd = os.pidfd_open(int(p['MainPID']))
    try:
        d.q.run(['/usr/bin/systemctl', 'stop', d.ordinary.UNIT], timeout=45)
        poll = select.poll(); poll.register(pidfd, select.POLLIN)
        if not poll.poll(1000): fail('original_source_process_still_present')
    finally: os.close(pidfd)
    keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID']
    terminal = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', d.ordinary.UNIT, *['--property=' + k for k in keys]]).splitlines())
    if (set(terminal) != set(keys) or terminal['Id'] != d.ordinary.UNIT or terminal['LoadState'] != 'loaded' or
        terminal['ActiveState'] not in {'inactive', 'failed'} or terminal['MainPID'] != '0' or terminal['InvocationID'] not in {'', expected['invocation']}):
        fail('exact_stopped_source_required')
    return {'unit': terminal, 'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT)}


def replace_source_definition(d, definition, previous_sha):
    path = SYSTEMD / d.ordinary.UNIT
    if sha(d.q.protected(path, 50000)) != previous_sha: fail('source_definition_changed_before_replace')
    temp = path.with_name(path.name + '.renewal-v1.tmp')
    d.ordinary.public_write(d.q, temp, definition['text'].encode())
    if sha(d.q.protected(path, 50000)) != previous_sha: fail('source_definition_changed_before_atomic_replace')
    os.replace(temp, path); d.q.sync_directory(path.parent)
    d.q.run(['/usr/bin/systemctl', 'daemon-reload'])


def service_properties(*, controller=False):
    maximum = 32400 if controller else 900
    project = '/var/lib/yunipals-unified-shadow/20261020-008028af-a/apps/yunipals-indexer'
    return ('Restart=no\nUMask=0077\nRuntimeMaxSec=' + str(maximum) + '\nTimeoutStopSec=60\nKillMode=control-group\n'
        'NoNewPrivileges=yes\nAmbientCapabilities=CAP_SETUID CAP_SETGID CAP_KILL\nCapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_KILL\n'
        'PrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n'
        'IPAddressDeny=any\nIPAddressAllow=127.0.0.0/8 ::1\nMemoryMax=536870912\nMemorySwapMax=0\nCPUQuota=50%\nTasksMax=64\n'
        'ReadWritePaths=' + str(BASE) + ' ' + str(OPS) + ' /etc/systemd/system /run/lock ' + project + '/.ponder ' + project + '/ponder-env.d.ts\n')


def controller_definition(review_hash):
    if not re.fullmatch('[0-9a-f]{64}', review_hash): fail('exact_review_hash_required')
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-replay-renewal-live-v3.py') + ' --phase controller --apply ' + review_hash
    text = '[Unit]\nDescription=Yunipals explicitly approved paid renewal ' + review_hash + '\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + service_properties(controller=True)
    return {'unit': CONTROLLER, 'argv': argv, 'text': text, 'sha256': sha(text.encode())}


def timer_definition(kind, due):
    if kind not in {'deadline', 'utc', 'final-utc'}: fail('fixed_owned_timer_kind_required')
    prefix = 'yunipals-paid-replay-renewal-v3-' + kind
    timer = prefix + '.timer'; service = prefix + '.service'
    calendar = moment(due).strftime('%Y-%m-%d %H:%M:%S.%f UTC')
    timer_text = '[Unit]\nDescription=Yunipals approved renewal ' + kind + '\n[Timer]\nOnCalendar=' + calendar + '\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit=' + service + '\n[Install]\nWantedBy=timers.target\n'
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-replay-renewal-live-v3.py') + ' --phase ' + kind
    service_text = '[Unit]\nDescription=Yunipals approved renewal ' + kind + ' executor\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + service_properties()
    return {'kind': kind, 'dueUtc': due, 'timerUnit': timer, 'serviceUnit': service, 'argv': argv,
        'timerText': timer_text, 'serviceText': service_text,
        'definitions': {str(SYSTEMD / timer): sha(timer_text.encode()), str(SYSTEMD / service): sha(service_text.encode())}}


def timer_link(row):
    link = SYSTEMD / 'timers.target.wants' / row['timerUnit']; s = link.lstat()
    if not stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or link.resolve(strict=True) != SYSTEMD / row['timerUnit']:
        fail('exact_root_owned_timer_wants_link_required')


def timer_proof(d, row, *, executing=False):
    # The accepted same-bus RefUnit lifetime includes every typed property read.
    with d.handoff.new_reference(d.q, row):
        for path, pin in row['definitions'].items():
            if sha(d.q.protected(Path(path), 50000)) != pin: fail('owned_timer_definition_changed')
        p = d.q.unit_properties(row['serviceUnit'])
        if (p['Type'] != 'exec' or p['Restart'] != 'no' or p['User'] not in {'', 'root'} or p['Group'] not in {'', 'root'} or
            p['WorkingDirectory'] != str(OPS) or p['NoNewPrivileges'] != 'yes' or
            re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [row['argv']] or
            set(p['AmbientCapabilities'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
            set(p['CapabilityBoundingSet'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'}): fail('exact_owned_timer_executor_required')
        d.q.assert_no_unit_environment(d.qe, row['serviceUnit'])
        if d.qe.bus_property(row['serviceUnit'], 'org.freedesktop.systemd1.Service', 'RuntimeMaxUSec', 't') != 900000000:
            fail('finite_owned_timer_executor_required')
        if executing:
            if (p['ActiveState'], p['SubState'], p['MainPID']) != ('active', 'running', str(os.getpid())):
                fail('actual_owned_timer_main_required')
        else:
            if p['ActiveState'] != 'inactive' or p['MainPID'] != '0': fail('idle_owned_timer_executor_required')
            state = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', row['timerUnit'], '--property=ActiveState', '--property=SubState']).splitlines())
            delta = moment(row['dueUtc']) - datetime(1970, 1, 1, tzinfo=timezone.utc)
            due_us = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
            if (state != {'ActiveState': 'active', 'SubState': 'waiting'} or
                d.qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'NextElapseUSecRealtime', 't') != due_us or
                d.qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'Unit', 's') != row['serviceUnit'] or
                d.qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'AccuracyUSec', 't') != 1 or
                d.qe.bus_property(row['timerUnit'], 'org.freedesktop.systemd1.Timer', 'RandomizedDelayUSec', 't') != 0):
                fail('exact_absolute_renewal_timer_not_armed')
            timer_link(row)


def install_timer(d, row):
    for path, text in [(SYSTEMD / row['timerUnit'], row['timerText']), (SYSTEMD / row['serviceUnit'], row['serviceText'])]:
        if os.path.lexists(path) or os.path.lexists(SYSTEMD / (path.name + '.d')): fail('fresh_timer_selectors_required')
        d.ordinary.public_write(d.q, path, text.encode())
    d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
    journal(d).emit('timer_enable_intent', kind=row['kind'], timerUnit=row['timerUnit'])
    d.q.run(['/usr/bin/systemctl', 'enable', '--now', row['timerUnit']], timeout=15)
    timer_proof(d, row); d.q.sync_directory(SYSTEMD / 'timers.target.wants'); d.q.sync_directory(SYSTEMD)
    pin = d.q.save(BASE / ('timer-' + row['kind'] + '.json'), row)
    journal(d).emit('timer_armed', kind=row['kind'], receiptSha256=pin, dueUtc=row['dueUtc'])


def handoff_old_timers(d):
    ours = [read(d, BASE / ('timer-' + kind + '.json')) for kind in ['utc', 'deadline']]
    for row in ours: timer_proof(d, row)
    rows = [read(d, OLD_BASE / ('timer-' + kind + '.json')) for kind in ['utc', 'deadline']]
    for old in rows:
        with d.handoff.new_reference(d.q, old):
            d.old.timer_proof(d, old)
            journal(d).emit('old_timer_disable_intent', oldTimer=old['timerUnit'], originalDueUtc=old['dueUtc'])
            d.q.run(['/usr/bin/systemctl', 'disable', '--now', old['timerUnit']], timeout=15)
            state = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', old['timerUnit'], '--property=ActiveState']).splitlines())
            if state != {'ActiveState': 'inactive'} or os.path.lexists(SYSTEMD / 'timers.target.wants' / old['timerUnit']):
                fail('old_runtime_timer_not_disabled')
    for row in ours: timer_proof(d, row)
    journal(d).emit('old_timer_duty_handed_off', originalWindowUnchanged=True)


def controller_identity(d, review_hash, *, self_required=False):
    expected = controller_definition(review_hash)
    if sha(d.q.protected(SYSTEMD / CONTROLLER, 50000)) != expected['sha256']:
        fail('exact_renewal_controller_definition_required')
    p = d.q.unit_properties(CONTROLLER)
    if (p['Id'] != CONTROLLER or p['Type'] != 'exec' or p['ActiveState'] != 'active' or p['SubState'] != 'running' or
        p['User'] not in {'', 'root'} or p['Group'] not in {'', 'root'} or p['Restart'] != 'no' or p['NoNewPrivileges'] != 'yes' or
        p['WorkingDirectory'] != str(OPS) or re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [expected['argv']] or
        set(p['AmbientCapabilities'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
        set(p['CapabilityBoundingSet'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
        not p['MainPID'].isdigit() or int(p['MainPID']) <= 1 or not re.fullmatch('[0-9a-f]{32}', p['InvocationID'])):
        fail('exact_owned_root_controller_required')
    d.q.assert_no_unit_environment(d.qe, CONTROLLER)
    if (d.qe.bus_property(CONTROLLER, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(SYSTEMD / CONTROLLER) or
        d.qe.bus_property(CONTROLLER, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != [] or
        d.qe.bus_property(CONTROLLER, 'org.freedesktop.systemd1.Service', 'RuntimeMaxUSec', 't') != 32400000000):
        fail('controller_sandbox_or_runtime_changed')
    if self_required and p['MainPID'] != str(os.getpid()): fail('actual_renewal_controller_main_required')
    return {'unit': CONTROLLER, 'invocation': p['InvocationID'], 'process': d.q.process_identity(int(p['MainPID']), CONTROLLER),
        'definitionSha256': expected['sha256'], 'reviewHash': review_hash}


def execute(d, phase, plan, *, receipt=None, prior=None, key=None):
    j = journal(d); key = phase if key is None else key
    with d.q.mutex(BASE / 'financial.lock', seconds=12):
        ack = j.latest('sql_ack_' + key)
        if ack is not None: return ack['receipt']
        if j.latest('sql_intent_' + key) is not None: fail('ambiguous_SQL_attempt_no_automatic_retry')
        current = d.financial.snapshot(d.q.peer)
        text = (d.same_day.owner_sql(plan, current, receipt, at=stamp(now())) if phase == 'resume_same_day' else
            d.financial.owner_sql(phase, plan, current, receipt=receipt, prior=prior, at=stamp(now())))
        d.q.save(BASE / ('owner-' + key + '.sql.json'), {'sql': text, 'sha256': sha(text.encode())})
        j.emit('sql_intent_' + key, sqlSha256=sha(text.encode()))
        try:
            rows = [json.loads(line) for line in d.q.peer(text, write=True).splitlines() if line.strip()]
            expected = {'planSha256': sha(encoded(plan)), 'phase': phase, 'applied': True, 'grantCountersReset': False}
            if rows != [expected]: fail('finite_SQL_commit_ACK_mismatch')
        except BaseException:
            j.emit('sql_ambiguous_' + key, manualReconcileRequired=True); raise
        j.emit('sql_ack_' + key, receipt=expected)
        return expected


def completed(d, points):
    decoder = d.ordinary.WORKSPACE / 'packages/yunipals-indexer-client/src/ponder.ts'
    if sha(d.q.protected(decoder, 100000)) != '850f53b560c45a7bb3641d90277bdda723e1abdb0fc8a29ce38ec5530f3409ba':
        fail('exact_official_checkpoint_decoder_required')
    code = 'import{completePonderBlock}from' + json.dumps(str(decoder)) + ';console.log(JSON.stringify(JSON.parse(process.argv[1]).map(r=>({chain:r.chain,through:completePonderBlock(r.latest,r.chain)?.toString()??null}))));'
    rows = json.loads(d.q.run(['/usr/bin/env', '-i', '-C', str(d.ordinary.WORKSPACE / 'apps/yunipals-indexer'), 'TSX_DISABLE_CACHE=1', d.ordinary.NODE,
        '--import', 'tsx', '--input-type=module', '-e', code, encoded(points).decode()], timeout=5, cap=10000))
    return {row['chain']: int(row['through']) if row['through'] is not None else None for row in rows}


def verify_inputs(d, binding):
    if sha(d.q.protected(APPROVAL, 100000)) != binding['approvalSha256']: fail('explicit_approval_bytes_changed')
    for path, pin in binding['codePins'].items():
        if sha(d.q.protected(Path(path), 2000000)) != pin: fail('retained_source_code_changed')
    if sha(d.q.protected(d.ordinary.WORKSPACE / 'launch.env', 100000)) != d.ordinary.LAUNCH_SHA:
        fail('retained_normal_launch_changed')
    overlay = d.ordinary.overlay_state(d.q, d.native, offline_proof=binding['rpcOverlay']['offlineBuild'])
    if overlay != binding['rpcOverlay']: fail('corrected_transport_or_original_build_changed')


def start_source(d, binding, parent, plan, ready, *, phase):
    verify_inputs(d, binding)
    before = d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)
    definition = source_definition(d, parent, plan, ready, phase=phase)
    old_sha = sha(d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000))
    definition_file = BASE / ('source-definition-' + phase + '.json')
    d.q.save(definition_file, definition); replace_source_definition(d, definition, old_sha)
    if d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)['checkpoints'] != before['checkpoints']:
        fail('stopped_source_checkpoints_changed_before_start')
    if now() + timedelta(seconds=30) >= moment(definition['segmentDispatchExpires']): fail('insufficient_dispatch_time_for_source_start')
    journal(d).emit('source_start_intent', segment=phase, definitionFile=str(definition_file), definitionSha256=sha(encoded(definition)),
        monotonicUs=time.monotonic_ns() // 1000)
    d.q.run(['/usr/bin/systemctl', 'start', d.ordinary.UNIT], timeout=15)
    # Persist actual start identity before the same-UID process adapter. A late
    # adapter failure leaves a truthful failed-start witness for cleanup.
    p = props(d)
    witness = {'unit': d.ordinary.UNIT, 'invocation': p['InvocationID'], 'pid': p['MainPID'],
        'startMonotonicUs': p['ExecMainStartTimestampMonotonic'], 'definitionFile': str(definition_file), 'definitionSha256': sha(encoded(definition))}
    witness_sha = d.q.save(BASE / ('source-started-' + phase + '.json'), witness)
    journal(d).emit('source_start_observed', segment=phase, receiptSha256=witness_sha, receiptFile=str(BASE / ('source-started-' + phase + '.json')))
    actual = runtime(d, definition, plan)
    if phase == 'day1':
        barrier = read(d, BASE / 'resume-ready.json')
        if barrier.get('planSha256') != sha(encoded(plan)) or actual['startMonotonicUs'] > barrier['monotonicUs'] + 30000000:
            fail('same_day_source_start_missed_30second_execution_barrier')
    d.v.retry(lambda: (d.ordinary.source_health(), d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=True)))
    pin = d.q.save(BASE / ('runtime-' + phase + '.json'), {'definition': definition, 'runtime': actual, 'planSha256': sha(encoded(plan))})
    journal(d).emit('source_running', segment=phase, receiptFile=str(BASE / ('runtime-' + phase + '.json')), receiptSha256=pin)
    return definition, actual


def stop_latest_source(d):
    j = journal(d); running = j.latest('source_running'); observed = j.latest('source_start_observed')
    intent = j.latest('source_start_intent')
    if intent is None: return None
    if observed is None or observed['segment'] != intent['segment']:
        definition = read(d, intent['definitionFile'], intent['definitionSha256'])
        if sha(d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000)) != definition['sha256']:
            fail('unacknowledged_start_definition_changed')
        p = d.q.unit_properties(d.ordinary.UNIT)
        if (p['Id'] != d.ordinary.UNIT or p['Type'] != 'exec' or p['User'] != d.native.USER or p['Group'] != d.native.USER or
            p['Restart'] != 'no' or re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(source_command(d))]):
            fail('unacknowledged_owned_start_selector_changed')
        if p['MainPID'] != '0':
            native = props(d)
            if int(native['ExecMainStartTimestampMonotonic']) < intent['monotonicUs']:
                fail('unacknowledged_start_predates_owned_intent')
            reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'renewal_failed_start_process_reader')
            ended = stop_source(d, {'invocation': native['InvocationID'], 'process': reader.identity(int(native['MainPID']), d.ordinary.UNIT)})
        else:
            # Cancel an exact pending start job too. This is never promoted into
            # a running receipt and cannot target the preserved old definition.
            d.q.run(['/usr/bin/systemctl', 'stop', d.ordinary.UNIT], timeout=45)
            ended = {'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT)}
        j.emit('unacknowledged_source_start_stopped', segment=intent['segment'], terminal=ended, runningAcknowledged=False)
        return ended
    witness = read(d, observed['receiptFile'], observed['receiptSha256'])
    definition = read(d, witness['definitionFile'], witness['definitionSha256'])
    if sha(d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000)) != definition['sha256']:
        fail('failed_start_source_definition_changed')
    keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic']
    p = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', d.ordinary.UNIT, *['--property=' + k for k in keys]]).splitlines())
    if set(p) != set(keys) or p['Id'] != d.ordinary.UNIT or p['LoadState'] != 'loaded': fail('loaded_owned_source_required')
    if p['InvocationID'] not in {'', witness['invocation']}: fail('source_invocation_changed_since_actual_start_witness')
    if p['InvocationID'] and p['ExecMainStartTimestampMonotonic'] != witness['startMonotonicUs']:
        fail('source_start_timestamp_changed_since_actual_start_witness')
    if p['MainPID'] != '0':
        if p['InvocationID'] != witness['invocation']: fail('cleared_invocation_cannot_be_running')
        if p['MainPID'] != witness['pid']: fail('source_PID_changed_since_actual_start_witness')
        reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'renewal_cleanup_same_UID_reader')
        actual = {'invocation': p['InvocationID'], 'process': reader.identity(int(p['MainPID']), d.ordinary.UNIT)}
        ended = stop_source(d, actual)
    else:
        if p['ActiveState'] not in {'inactive', 'failed'}: fail('actual_started_source_not_terminal')
        if p['InvocationID'] == '':
            if running is None or running['segment'] != observed['segment']: fail('cleared_failed_start_without_saved_running_identity')
            saved_runtime = read(d, running['receiptFile'], running['receiptSha256'])['runtime']
            gone = {'pid': saved_runtime['process']['pid'], 'startTicks': saved_runtime['process']['startTicks'], 'bootId': saved_runtime['bootId']}
            if not d.live.original_process_gone(gone): fail('original_source_lifetime_not_gone')
        ended = {'unit': {k: p[k] for k in ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID']},
            'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT)}
    journal(d).emit('source_stopped', segment=observed['segment'], terminal=ended)
    return ended


def permit_state(d, plan):
    ids = ','.join(d.financial.literal(row['permitId']) for row in plan['permits'])
    return d.qe.query("SELECT jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()),'owned',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'profileId',profile_id,'chainId',chain_id,'fromBlock',from_block::text,'throughBlock',through_block::text,'maximumCu',maximum_cu::text,'spentCu',spent_cu::text,'enabled',enabled,'expires',expires_at)ORDER BY chain_id)FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN(" + ids + ")),'[]'::jsonb))", market=True)


def never_resumed(d, binding, plan):
    # Ambiguous SQL never retries: accept only the exact disabled sealed pair,
    # unchanged charged source ledger, and the real old cleanup policy.
    parent = read(d, BASE / 'continuation-parent.json'); receipt = parent['cleanupReceipt']
    if permit_state(d, plan) != receipt['permitState']: fail('never_resumed_exact_disabled_pair_required')
    # Read original grant day even after midnight; this is cleanup, not dispatch.
    d.same_day.review(plan, d.financial.snapshot(d.q.peer, day=plan['grantDay']), receipt)
    parent_terminal_source(d, binding)
    if journal(d).latest('source_start_intent') is not None: fail('never_resumed_has_source_start_intent')
    d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)
    restore_false_proxies(d, binding)
    pin = d.q.save(BASE / 'cleanup-day1.json', receipt)
    journal(d).emit('segment_closed', segment='day1', cleanupReceiptSha256=pin,
        cumulativeMigrationBookedCu=receipt['cumulativeMigrationBookedCu'], inheritedActualParentCleanup=True)
    return receipt


def finish_current_segment(d, binding, plan, *, prior=None, phase='day1'):
    j = journal(d)
    if j.latest('sql_ack_resume_same_day') is None and j.latest('source_start_intent') is None:
        parent = read(d, BASE / 'continuation-parent.json'); closed = parent['cleanupReceipt']
        state = permit_state(d, plan); current = d.financial.snapshot(d.q.peer, day=plan['grantDay'])
        parent_terminal_source(d, binding)
        if (state == closed['permitState'] and d.financial.policy_value(current) == closed['policy'] and
            current['grants']['day'] == plan['grantDay'] and
            current['grants']['workloads']['unified_source'] == closed['sourceGrantedCu']):
            return never_resumed(d, binding, plan)
        # ACK loss never proves rollback. Contain actual possibly committed
        # same-ID authority through the original finite revoke/seal path.
    return seal_segment(d, binding, plan, prior=prior, phase=phase)


def seal_segment(d, binding, plan, *, prior=None, phase='day1'):
    # Revocation precedes every process wait. Grant tails are booked forever.
    revoke_error = None
    try: execute(d, 'revoke', plan, key=phase + '-revoke')
    except BaseException as error: revoke_error = error
    try: stop_latest_source(d)
    finally:
        if revoke_error is not None: raise revoke_error
    peer = d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)
    false = restore_false_proxies(d, binding)
    segment_day = d.financial.segment(plan, prior)[0]
    current = d.financial.snapshot(d.q.peer, day=segment_day)
    receipt = d.financial.cleanup_receipt(plan, current, prior, permitState=permit_state(d, plan))
    pin = d.q.save(BASE / ('cleanup-' + phase + '.json'), receipt)
    journal(d).emit('segment_cleanup_prepared', segment=phase, receiptFile=str(BASE / ('cleanup-' + phase + '.json')), receiptSha256=pin,
        sourceCheckpointsSha256=sha(encoded(peer['checkpoints'])), falseProxiesSha256=sha(encoded(false)))
    if now().date().isoformat() == segment_day:
        execute(d, 'cleanup', plan, receipt=receipt, key=phase + '-cleanup')
        journal(d).emit('segment_closed', segment=phase, cleanupReceiptSha256=pin, cumulativeMigrationBookedCu=receipt['cumulativeMigrationBookedCu'])
    else:
        # A late drain cannot issue an old-day cleanup transaction on the new
        # day. The existing finite boundary branch consumes this real seal.
        journal(d).emit('segment_boundary_sealed', segment=phase, cleanupReceiptSha256=pin)
    return receipt


def source_sample(d, binding, plan, definition, actual, *, prior=None):
    runtime(d, definition, plan, saved=actual)
    peer = d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=True)
    check_proxies(d, binding, paid=True)
    if any(value['counters'].get('refused', 0) != 0 for name, value in
           ((name, proxy_health(d, name, binding['normalProxies'][name]['configuration'], paid=True)) for name in ['base', 'bnb'])):
        fail('owned_paid_provider_or_budget_refusal')
    current = d.financial.snapshot(d.q.peer)
    accounting = d.financial.progress(plan, current, prior)
    coverage = completed(d, peer['checkpoints'])
    return {'completeThrough': {str(k): str(v) if v is not None else None for k, v in coverage.items()},
        'targetsReached': all(coverage.get(k) is not None and coverage[k] >= value for k, value in TARGETS.items()),
        'cumulativeMigrationBookedCu': accounting['cumulativeMigrationBookedCu'], 'remainingNewBookedCu': accounting['remainingNewBookedCu']}


def start(d, expected):
    reviewed, parent = inspect(d)
    if reviewed['reviewHash'] != expected: fail('exact_fresh_renewal_review_required')
    BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
    d.q.save(BASE / 'review.json', reviewed)
    definition = controller_definition(expected)
    d.q.save(BASE / 'controller-definition.json', definition)
    d.q.save(BASE / 'start-intent.json', {'reviewHash': expected, 'controllerUnit': CONTROLLER, 'automaticRetryAllowed': False, 'clockStarted': True, 'clockRenewed': False})
    d.ordinary.public_write(d.q, SYSTEMD / CONTROLLER, definition['text'].encode())
    d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
    d.q.run(['/usr/bin/systemctl', 'start', CONTROLLER], timeout=15)
    return {'format': FORMAT, 'controllerStartJobSubmitted': True, 'nativeStartedClaimed': False,
        'readyClockStartedClaimed': False, 'clockRenewed': False, 'sameWindowOnly': True, 'additionalCuCeiling': '19287000', 'aggregateCuCeiling': '20000000', 'automaticRetryAllowed': False}


def controller(d, expected):
    saved = read(d, BASE / 'review.json')
    if saved['reviewHash'] != expected or sha(encoded(saved['binding'])) != expected: fail('protected_renewal_review_required')
    fresh, parent = inspect(d, prepared=True)
    if fresh != saved: fail('current_runtime_or_approval_changed_before_handover')
    identity = controller_identity(d, expected, self_required=True); d.q.save(BASE / 'controller-identity.json', identity)
    j = journal(d); j.emit('controller_started', identity=identity)
    binding = saved['binding']; plan = None; prior = None; segment_name = 'day1'
    out = {'format': FORMAT, 'cleaned': False, 'automaticRenewal': False, 'clockRenewed': False, 'sameWindowOnly': True}
    stage = 'parent_controller_stop'
    try: stop_parent_controller(d, binding)
    except BaseException as error:
        out.update(failureStage=stage, failure=failure(error), manualReconcileRequired=True)
        pin = d.q.save(BASE / 'controller-result.json', out)
        j.emit('controller_finished', resultSha256=pin, cleaned=False)
        return out
    with ExitStack() as leases:
        leases.enter_context(d.c.source_lease())
        for name in d.ordinary.CHAINS: leases.enter_context(d.v.chain_lock(name))
        try:
            stage = 'actual_parent_closed_seal'; j.emit('stage', name=stage)
            closure = parent_closure(d, binding)
            closure_pin = d.q.save(BASE / 'continuation-parent.json', closure)
            j.emit('parent_closed_verified', receiptSha256=closure_pin)
            plan = read(d, OLD_BASE / 'plan.json', binding['parentPlanSha256'])
            ready = read(d, OLD_BASE / 'ready.json', binding['parentReadySha256'])
            # Byte-identical original plan and clock; no activate/admission.
            d.q.save(BASE / 'plan.json', plan); d.q.save(BASE / 'ready.json', ready)
            d.q.save(BASE / 'cleanup-day1-parent.json', closure['cleanupReceipt'])
            d.ordinary.public_write(d.q, BASE / 'parent-unit.service', d.q.protected(SYSTEMD / d.ordinary.UNIT, 50000))
            j.emit('original_clock_inherited', start=plan['start'], expires=plan['expires'], planSha256=sha(encoded(plan)))
            stage = 'durable_timer_handoff'; j.emit('stage', name=stage)
            install_timer(d, timer_definition('utc', plan['nextUtc']))
            install_timer(d, timer_definition('deadline', plan['dispatchExpires']))
            handoff_old_timers(d)
            stage = 'owned_mixed_proxy_setup'; j.emit('stage', name=stage)
            candidate = d.build.validate_saved()
            if candidate != binding['candidate']: fail('compiled_candidate_changed_before_selection')
            candidate_access(d, candidate)
            change_proxies(d, binding, paid=True)
            verify_inputs(d, binding)
            if d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)['checkpoints'] != closure['checkpoints']:
                fail('stopped_parent_checkpoints_changed_during_setup')
            d.ordinary.public_write(d.q, PUBLIC, source_environment(d, plan))
            stage = 'same_day_existing_rows_resume'; j.emit('stage', name=stage)
            d.q.save(BASE / 'resume-ready.json', {'monotonicUs': time.monotonic_ns() // 1000,
                'at': stamp(now()), 'planSha256': sha(encoded(plan)), 'clockRenewed': False})
            execute(d, 'resume_same_day', plan, receipt=closure['cleanupReceipt'])
            stage = 'same_cache_source_resume'; j.emit('stage', name=stage)
            definition, actual = start_source(d, binding, parent, plan, ready, phase='day1')
            out['sourceStarted'] = True
            while True:
                stage = 'paid_source_monitoring'
                if now() >= moment(plan['dispatchExpires']): out['stopReason'] = 'dispatch_deadline'; break
                if prior is None and now() >= moment(plan['nextUtc']) - timedelta(seconds=480):
                    stage = 'UTC_paid_pause'; j.emit('stage', name=stage)
                    first = seal_segment(d, binding, plan)
                    j.emit('awaiting_UTC_restore', cleanupReceiptSha256=sha(encoded(first)))
                    while j.latest('sql_ack_utc') is None:
                        if now() > moment(plan['nextUtc']) + timedelta(seconds=360): fail('UTC_restore_ACK_missing_no_resume')
                        time.sleep(1)
                    ack = j.latest('sql_ack_utc')
                    prior = d.financial.boundary_receipt(plan, d.financial.snapshot(d.q.peer), first, sha(encoded(ack)), stamp(now()))
                    d.q.save(BASE / 'boundary.json', prior)
                    if int(prior['remainingNewBookedCu']) < 1: out['stopReason'] = 'aggregate_allowance_exhausted'; break
                    segment_name = 'day2'
                    change_proxies(d, binding, paid=True)
                    execute(d, 'resume', plan, receipt=prior)
                    definition, actual = start_source(d, binding, parent, plan, ready, phase='day2')
                state = source_sample(d, binding, plan, definition, actual, prior=prior)
                j.emit('source_sample', **state)
                if state['targetsReached']: out['stopReason'] = 'fixed_parity_boundaries_reached'; break
                if int(state['remainingNewBookedCu']) < 1000: out['stopReason'] = 'aggregate_allowance_exhausted'; break
                time.sleep(min(15, max(0, (moment(plan['dispatchExpires']) - now()).total_seconds())))
        except BaseException as error:
            out.update(failureStage=stage, failure=failure(error)); out.setdefault('stopReason', 'guard_failure')
            j.emit('work_failed', failureStage=stage, failure=out['failure'])
        finally:
            if plan is not None:
                try:
                    if j.latest('segment_closed') is None or j.latest('segment_closed')['segment'] != segment_name:
                        closed = finish_current_segment(d, binding, plan, prior=prior, phase=segment_name)
                        out.update(cleaned=True, cumulativeMigrationBookedCu=closed['cumulativeMigrationBookedCu'], cleanupReceiptSha256=sha(encoded(closed)))
                    else:
                        closed = read(d, BASE / ('cleanup-' + segment_name + '.json'))
                        out.update(cleaned=True, cumulativeMigrationBookedCu=closed['cumulativeMigrationBookedCu'], cleanupReceiptSha256=sha(encoded(closed)))
                    if out['cleaned'] and segment_name == 'day2' and os.path.lexists(BASE / 'cleanup-day2.json'):
                        due = stamp(moment(plan['nextUtc']) + timedelta(days=1))
                        install_timer(d, timer_definition('final-utc', due))
                        j.emit('final_day_UTC_duty_armed', dueUtc=due)
                except BaseException as error:
                    out.update(cleaned=False, cleanupFailure=failure(error), manualReconcileRequired=True)
                    j.emit('cleanup_failed', failure=failure(error), manualReconcileRequired=True)
            else:
                # No new resume was possible; original parent timers still own duty.
                try:
                    d.old.check_proxies(d, binding, paid=False, zero=True)
                    d.ordinary.source_state(d.q, d.qe, d.native, binding['sourceRole'], running=False)
                    out.update(cleaned=True, paidAdmissionAttempted=False, originalParentTimersRetainDuty=True)
                except BaseException as error:
                    out.update(cleaned=False, paidAdmissionAttempted=False, cleanupFailure=failure(error), manualReconcileRequired=True)
    pin = d.q.save(BASE / 'controller-result.json', out); j.emit('controller_finished', resultSha256=pin, cleaned=out['cleaned'])
    return out


def timer_executor(d, kind):
    if kind == 'utc' and not os.path.lexists(BASE / 'plan.json'):
        # Setup failed before the sole clock commit. The old original UTC timer
        # was never disabled; this new timer has no independent authority.
        return {'format': FORMAT, 'setupNeverActivated': True, 'paidAuthorityAdded': False}
    plan = read(d, BASE / 'plan.json'); ready = read(d, BASE / 'ready.json'); saved = read(d, BASE / 'review.json')
    if ready['planSha256'] != sha(encoded(plan)) or sha(encoded(saved['binding'])) != saved['reviewHash']:
        fail('protected_committed_window_required')
    row = read(d, BASE / ('timer-' + kind + '.json'))
    due = plan['nextUtc'] if kind == 'utc' else (stamp(moment(plan['nextUtc']) + timedelta(days=1)) if kind == 'final-utc' else plan['dispatchExpires'])
    if row != timer_definition(kind, due): fail('timer_absolute_due_changed')
    timer_proof(d, row, executing=True)
    if now() < moment(row['dueUtc']): fail('owned_timer_executed_too_early')
    if kind in {'utc', 'final-utc'}:
        segment = 'day1' if kind == 'utc' else 'day2'
        existing = journal(d).latest('sql_ack_utc' if kind == 'utc' else 'sql_ack_final-utc')
        if existing is not None:
            if existing.get('receipt') != {'planSha256': sha(encoded(plan)), 'phase': existing['receipt']['phase'], 'applied': True, 'grantCountersReset': False} or existing['receipt']['phase'] not in {'utc', 'boundary'}:
                fail('exact_prior_UTC_commit_ACK_required')
            return {'format': FORMAT, 'UTCAlreadyAcknowledged': True, 'clockRenewed': False}
        deadline = time.monotonic() + 300
        while True:
            ack = next((row for row in reversed(journal(d).rows()) if row['phase'] in {'segment_closed', 'segment_boundary_sealed', 'segment_cleanup_prepared'} and row.get('segment') == segment), None)
            if ack is not None: break
            if kind == 'utc' and journal(d).latest('source_start_intent') is None and journal(d).latest('sql_ack_resume_same_day') is None:
                parent = read(d, BASE / 'continuation-parent.json')
                parent_ack = journal(d).latest('parent_closed_verified')
                if parent_ack is None or parent_ack['receiptSha256'] != sha(encoded(parent)):
                    fail('durable_parent_cleanup_duty_required')
                finish_current_segment(d, saved['binding'], plan)
                continue
            if kind == 'final-utc' or time.monotonic() >= deadline: fail('actual_quiesced_first_day_cleanup_ACK_required')
            time.sleep(1)
        closed = read(d, BASE / ('cleanup-' + segment + '.json'))
        pin = ack.get('cleanupReceiptSha256', ack.get('receiptSha256'))
        if pin != sha(encoded(closed)):
            fail('actual_quiesced_first_day_cleanup_ACK_required')
        if kind == 'utc':
            check_proxies(d, saved['binding'], paid=False, zero=True)
            d.ordinary.source_state(d.q, d.qe, d.native, saved['binding']['sourceRole'], running=False)
        old = d.financial.snapshot(d.q.peer, day=closed['grantDay'])
        current = d.financial.snapshot(d.q.peer)
        operation = 'utc' if d.financial.policy_value(current) == closed['policy'] else 'boundary'
        if kind == 'final-utc' and operation != 'utc': fail('final_day_cleanup_policy_must_be_acknowledged')
        execute(d, operation, plan, receipt=closed, prior=old, key='utc' if kind == 'utc' else 'final-utc')
        return {'format': FORMAT, 'UTCPolicyRestored': True, 'clockRenewed': False}
    # The financial guard closes dispatch immediately, before the graceful
    # controller wait. A timer never reconstructs old native/workspace history.
    current_day = d.financial.snapshot(d.q.peer)['grants']['day']
    segment = 'day1' if current_day == plan['grantDay'] else 'day2'
    if permit_state(d, plan) == {'active': 0, 'owned': []}:
        return {'format': FORMAT, 'neverAdmitted': True, 'dispatchAuthority': False}
    execute(d, 'revoke', plan, key=segment + '-revoke')
    expected = read(d, BASE / 'controller-identity.json')
    row = {'serviceUnit': CONTROLLER, 'definitions': {str(SYSTEMD / CONTROLLER): expected['definitionSha256']}}
    with d.handoff.new_reference(d.q, row):
        p = d.q.unit_properties(CONTROLLER)
        if p['MainPID'] == '0':
            finished = journal(d).latest('controller_finished')
            if (p['InvocationID'] not in {'', expected['invocation']} or p['ActiveState'] not in {'inactive', 'failed'} or
                finished is None or finished.get('cleaned') is not True or not d.live.original_process_gone(expected['process'])):
                fail('original_controller_terminal_cleanup_not_proven')
            return {'format': FORMAT, 'dispatchRevoked': True, 'controllerAlreadyFinished': True}
        actual = controller_identity(d, saved['reviewHash'])
    if actual != expected: fail('foreign_controller_stop_refused')
    fd = os.pidfd_open(actual['process']['pid'])
    try:
        signal.pidfd_send_signal(fd, signal.SIGTERM)
        poll = select.poll(); poll.register(fd, select.POLLIN)
        if not poll.poll(360000): fail('owned_controller_did_not_finish_cleanup')
    finally: os.close(fd)
    finished = journal(d).latest('controller_finished')
    if finished is None or finished.get('cleaned') is not True: fail('timer_requires_manual_cleanup_reconcile')
    return {'format': FORMAT, 'dispatchRevoked': True, 'controllerCleaned': True, 'clockRenewed': False}


def status(d):
    j = journal(d); plan = read(d, BASE / 'plan.json') if os.path.lexists(BASE / 'plan.json') else None
    ready = read(d, BASE / 'ready.json') if os.path.lexists(BASE / 'ready.json') else None
    units = {}
    keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID', 'Result', 'ExecMainStatus', 'CPUUsageNSec', 'MemoryCurrent']
    for unit in [CONTROLLER, d.ordinary.UNIT]:
        value = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]]).splitlines())
        if set(value) - set(keys) or value.get('Id') != unit: fail('fixed_status_units_required')
        units[unit] = value
    current = d.financial.snapshot(d.q.peer)
    source = j.latest('source_sample'); failure_row = j.latest('work_failed'); closed = j.latest('segment_closed')
    result = read(d, BASE / 'controller-result.json') if os.path.lexists(BASE / 'controller-result.json') else None
    return {'format': FORMAT, 'observedAt': stamp(now()), 'clockStarted': ready is not None,
        'window': None if plan is None else {k: plan[k] for k in ['start', 'expires', 'dispatchExpires', 'nextUtc']},
        'units': units, 'latestStage': j.latest('stage'), 'latestSourceSample': source,
        'latestFailure': failure_row, 'latestClosedSegment': closed, 'controllerResult': result,
        'governor': {'day': current['grants']['day'], 'sourceGrantedCu': current['grants']['workloads']['unified_source'],
            'globalDailyCu': current['global']['dailyCu'], 'sourceDailyCu': next(r['dailyCu'] for r in current['allocations'] if r['workload'] == 'unified_source'),
            'activePaidPermits': None if plan is None else permit_state(d, plan)['active']},
        'priorBookedCu': '713000', 'aggregateCuCeiling': '20000000', 'newCuCeiling': '19287000',
        'journalRows': len(j.rows()), 'providerRequests': 0, 'historyReconstruction': False}


def failure(error):
    frames = []; labels = set(); trace = error.__traceback__
    while trace:
        code = trace.tb_frame.f_code; p = Path(code.co_filename)
        if p.parent == OPS and p.name in {'paid-replay-renewal-live-v3.py', 'paid-replay-renewal-live-v2.py', 'paid-continuation-same-day-v1.py', 'paid-continuation-financial-v1.py', 'source6-free-runtime-v3.py', 'source6-mixed-proxy-build-v1.py'}:
            frames.append({'file': p.name, 'function': code.co_name, 'line': trace.tb_lineno})
            if error.args and isinstance(error.args[0], str) and error.args[0] in code.co_consts: labels.add(error.args[0])
        trace = trace.tb_next
    return {'errorClass': type(error).__name__, 'fixedCodeLabels': sorted(labels), 'publicFrames': frames[-16:],
        'errno': error.errno if isinstance(error, OSError) else None, 'rawMessageExported': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['review', 'start', 'controller', 'deadline', 'utc', 'final-utc', 'status'], default='review')
    parser.add_argument('--apply'); args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d = modules(); d.q.actual_root_capabilities()
    if args.phase in {'start', 'controller'} and not re.fullmatch('[0-9a-f]{64}', args.apply or ''): fail('exact_review_apply_hash_required')
    if args.phase == 'review':
        reviewed, _ = inspect(d)
        value = {'format': FORMAT, 'reviewHash': reviewed['reviewHash'], 'clockStarted': True, 'clockRenewed': False, 'sameWindowOnly': True, 'paidAuthorityAdded': False,
            'controller': controller_definition(reviewed['reviewHash'])}
    elif args.phase == 'start': value = start(d, args.apply)
    elif args.phase == 'controller': value = controller(d, args.apply)
    elif args.phase == 'status': value = status(d)
    else: value = timer_executor(d, args.phase)
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    def interrupted(*_): raise InterruptedError('bounded_owned_renewal_interrupted')
    for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGALRM]: signal.signal(sig, interrupted)
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': failure(error), 'automaticRetryAllowed': False}, sort_keys=True))
        raise SystemExit(1)
