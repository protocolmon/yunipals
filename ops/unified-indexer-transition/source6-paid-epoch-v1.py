#!/usr/bin/env python3
"""Owned source6 paid-flag epoch adapter. No permit/admission/RPC execution."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-paid-epoch-v1-20261021')
LOCK = Path('/run/lock/yunipals-unified-shadow.lock')
FREE_SHA = '713622752a94d220edcf02ab5d0867616978d145957fe1fe1e1d90b00fdbdd9e'
PLANNER_SHA = 'c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
FORMAT = 'yunipals-source6-paid-epoch-v1'
PLAN_FORMAT = 'yunipals-source6-paid-epoch-plan-v1'
OVERRIDE = 'zzzzzzzzzzzzz-unified-source6-paid-capability-20261021.conf'
FLAG = 'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY'
SOURCE_ROLE = 'yunipals_unified_shadow'
RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
PHYSICAL = 'unified_shadow_20261020_7e7375b0'
NATIVE = 'bf4939b3ff'
MANIFEST = '0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029'
CHAINS = ('base', 'bnb')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def is_sha(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None
def invocation(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{32}', value) is not None
def literal(value): return "'" + str(value).replace("'", "''") + "'"
def epoch_usec(moment):
    delta = moment - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def modules():
    # The pinned free-first helper remains unmodified. Its live validator is
    # used only before the true switch, never relabelled after it.
    path = OPS / 'source6-proxy-upgrade.py'
    for item in [*path.parents, path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('Protected paid epoch prerequisite required.')
    raw = path.read_bytes()
    if sha(raw) != FREE_SHA: fail('Exact frozen free-first prerequisite required.')
    free = types.ModuleType('paid_epoch_frozen_free'); free.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), free.__dict__)
    n, c, v = free.modules()
    model = c.load(OPS / 'paid-backfill-policy-plan-v2.py', PLANNER_SHA, 'paid_epoch_frozen_plan')
    return free, n, c, v, model


def run(args, *, data=None, timeout=5):
    result = subprocess.run(args, input=data, text=True, capture_output=True, env=ENV, timeout=timeout)
    if result.returncode or len(result.stdout.encode()) > 250_000:
        fail('Bounded paid epoch observation failed; raw diagnostics withheld.')
    return result.stdout.strip()


def query(text, *, market=False):
    user, group = pwd.getpwnam('postgres'), grp.getgrnam('postgres')
    if user.pw_uid <= 0 or user.pw_gid <= 0 or user.pw_gid != group.gr_gid:
        fail('Exact nonroot PostgreSQL peer required.')
    args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
            '/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
            'PGHOST=/var/run/postgresql', 'PGPORT=' + ('15438' if market else '5432'), 'PGUSER=postgres',
            'PGDATABASE=' + ('yunipals_market_production' if market else 'yunipals_backfill'), 'PGPASSFILE=/dev/null',
            'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=7000',
            '/usr/bin/psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1']
    return json.loads(run(args, data='BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;\n' + text + ';\nROLLBACK;', timeout=9))


def source_gate():
    value = query("""SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,
       'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,
       'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit) FROM pg_roles WHERE rolname='yunipals_unified_shadow'),
      'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')
        OR roleid=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'),
      'supportSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='yunipals_unified_support'),
      'sourceIdentity',(SELECT jsonb_build_object('release',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash)
        FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'sourceManifest',(SELECT manifest FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','build',value->>'build_id','dev',value->>'is_dev') FROM unified_shadow_20261020_7e7375b0._ponder_meta WHERE key='app'),
      'activeSelectors',(SELECT count(*) FROM yunipals_indexer_control.active_release))""")
    role = value.get('role') or {}
    if (set(value) != {'role', 'memberships', 'sessions', 'supportSessions', 'sourceIdentity', 'sourceManifest', 'runtime', 'activeSelectors'} or
        value['sourceIdentity'] != {'release': RELEASE, 'schema': PHYSICAL, 'build': NATIVE, 'manifestHash': MANIFEST} or
        value['runtime'] != {'version': '6', 'build': NATIVE, 'dev': '0'} or not isinstance(value['sourceManifest'], dict) or
        set(role) != {'oid', 'login', 'inherit', 'super', 'createDb', 'createRole', 'replication', 'bypassRls', 'connectionLimit'} or
        not isinstance(role['oid'], str) or not re.fullmatch('[1-9][0-9]*', role['oid']) or role['login'] is not True or
        role['connectionLimit'] != 32 or type(role['connectionLimit']) is not int or
        any(role[k] is not False for k in ['inherit', 'super', 'createDb', 'createRole', 'replication', 'bypassRls']) or
        any(type(value[k]) is not int or value[k] != 0 for k in ['memberships', 'sessions', 'supportSessions', 'activeSelectors'])):
        fail('Unchanged restricted source peer, no source sessions and empty selector required.')
    return value


def true_file(run_id, name): return OPS / ('source6-paid-' + run_id + '-' + name + '.env')
def true_content(): return (FLAG + '=true\n').encode()
def override_content(path): return ('[Service]\nEnvironmentFile=' + str(path) + '\n').encode()


def load_plan(c, model, path, expected):
    path = Path(path)
    if path.parent != OPS or not re.fullmatch(r'source6-paid-[a-z0-9-]{1,50}\.plan\.json', path.name):
        fail('Exact protected paid epoch plan path required.')
    plan = c.pinned_json(path, expected, 200_000)
    if (set(plan) != {'format', 'runId', 'admission', 'stopProofSha256', 'falseProofs', 'timerReceiptFile', 'timerReceiptSha256'} or
        plan['format'] != PLAN_FORMAT or not re.fullmatch('20261021-[a-z0-9-]{1,30}', plan['runId']) or
        path.name != 'source6-paid-' + plan['runId'] + '.plan.json' or not is_sha(plan['stopProofSha256']) or
        not is_sha(plan['timerReceiptSha256']) or set(plan['falseProofs']) != {'56', '8453'}):
        fail('Exact bounded paid epoch plan required.')
    model.validate_plan(plan['admission'])
    for row in plan['falseProofs'].values():
        if (set(row) != {'directory', 'reviewSha256', 'resultSha256', 'expectedBeforeInvocation'} or
            not all(is_sha(row[k]) for k in ['reviewSha256', 'resultSha256']) or not invocation(row['expectedBeforeInvocation'])):
            fail('Protected exact false receipts required, never booleans.')
    receipt_path = Path(plan['timerReceiptFile'])
    if receipt_path != OPS / ('source6-paid-' + plan['runId'] + '.timers.json'):
        fail('Exact owned timer receipt path required.')
    return plan


def observed(v, unit):
    keys = ['Id', 'LoadState', *v.STATE_KEYS]
    text = v.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]], timeout=4)
    if len(text.encode()) > 100_000: fail('Bounded proxy metadata required.')
    props, repeated = {}, {'EnvironmentFiles': [], 'Environment': []}
    for line in text.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in keys: fail('Unexpected owned proxy metadata.')
        if key in repeated: repeated[key].append(value)
        elif key in props: fail('Duplicate owned proxy metadata.')
        else: props[key] = value
    for key, values in repeated.items():
        if values: props[key] = ' '.join(values)
    props['EnvironmentFilesEntries'] = repeated['EnvironmentFiles']
    if (any(k not in props for k in keys) or props['Id'] != unit or props['LoadState'] != 'loaded' or
        not invocation(props['InvocationID']) or not props['MainPID'].isdigit() or
        not ((props['ActiveState'] == 'active' and props['SubState'] == 'running' and int(props['MainPID']) > 1) or
             (props['ActiveState'] in {'inactive', 'failed'} and props['MainPID'] == '0'))):
        fail('Exact active or terminal owned proxy required.')
    return props


def bus_property(unit, interface, key, expected_type):
    unit_path = json.loads(run(['/usr/bin/busctl', '--json=short', 'call', 'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit]))
    if (set(unit_path) != {'type', 'data'} or unit_path['type'] != 'o' or not isinstance(unit_path['data'], list) or
        len(unit_path['data']) != 1 or not isinstance(unit_path['data'][0], str) or
        not re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', unit_path['data'][0])):
        fail('Exact typed owned systemd object required.')
    value = json.loads(run(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1',
        unit_path['data'][0], interface, key]))
    if set(value) != {'type', 'data'} or value['type'] != expected_type: fail('Exact typed timer property required.')
    return value['data']


def verify_timers(c, model, plan):
    receipt = c.pinned_json(Path(plan['timerReceiptFile']), plan['timerReceiptSha256'], 100_000)
    admission, stamp = plan['admission'], model.digest(plan['admission'])[:16]
    if (set(receipt) != {'format', 'admissionPlanSha256', 'executorFile', 'executorSha256', 'timers'} or
        receipt['format'] != 'yunipals-paid-capability-owned-timers-v1' or receipt['admissionPlanSha256'] != model.digest(admission) or
        receipt['executorFile'] != str(OPS / 'paid-capability-live-v1.py') or not is_sha(receipt['executorSha256']) or
        c.sha(c.trusted(Path(receipt['executorFile']), 250_000)) != receipt['executorSha256'] or
        not isinstance(receipt['timers'], list) or len(receipt['timers']) != 2):
        fail('Protected actual owned cleanup timer receipt required.')
    summaries = []
    for kind, due in [('deadline', admission['qualificationExpiresAt']), ('utc', admission['nextUtc'])]:
        prefix = 'yunipals-paid-capability-' + kind + '-' + stamp
        rows = [r for r in receipt['timers'] if r.get('kind') == kind]
        if len(rows) != 1: fail('Both exact owned cleanup timers required.')
        row = rows[0]; timer, service = prefix + '.timer', prefix + '.service'
        if (set(row) != {'kind', 'timerUnit', 'serviceUnit', 'dueUtc', 'definitions', 'serviceExecStartSha256'} or
            row['timerUnit'] != timer or row['serviceUnit'] != service or row['dueUtc'] != due or not is_sha(row['serviceExecStartSha256']) or
            set(row['definitions']) != {str(Path('/etc/systemd/system') / timer), str(Path('/etc/systemd/system') / service)} or
            any(not is_sha(h) or c.sha(c.trusted(Path(p), 50_000)) != h for p, h in row['definitions'].items())):
            fail('Exact owned timer/service definitions required.')
        raw = run(['/usr/bin/systemctl', 'show', '--all', timer, '--property=Id', '--property=LoadState', '--property=ActiveState', '--property=SubState'])
        state = dict(line.split('=', 1) for line in raw.splitlines())
        if state != {'Id': timer, 'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'waiting'}:
            fail('Owned cleanup timer must already be armed.')
        usec = bus_property(timer, 'org.freedesktop.systemd1.Timer', 'NextElapseUSecRealtime', 't')
        expected = epoch_usec(model.moment(due))
        if type(usec) is not int or usec != expected or bus_property(timer, 'org.freedesktop.systemd1.Timer', 'Unit', 's') != service:
            fail('Actual timer deadline or bound cleanup service differs.')
        if bus_property(timer, 'org.freedesktop.systemd1.Timer', 'RandomizedDelayUSec', 't') != 0:
            fail('Randomized owned cleanup timing forbidden.')
        accuracy = bus_property(timer, 'org.freedesktop.systemd1.Timer', 'AccuracyUSec', 't')
        if type(accuracy) is not int or not 0 < accuracy <= 1_000_000:
            fail('Bounded cleanup timer accuracy required.')
        raw = run(['/usr/bin/systemctl', 'show', '--all', service, '--property=Id', '--property=LoadState', '--property=ActiveState',
                   '--property=User', '--property=Group', '--property=Restart', '--property=ExecStart'])
        props = dict(line.split('=', 1) for line in raw.splitlines())
        if (set(props) != {'Id', 'LoadState', 'ActiveState', 'User', 'Group', 'Restart', 'ExecStart'} or props['Id'] != service or
            props['LoadState'] != 'loaded' or props['ActiveState'] != 'inactive' or props['User'] not in {'', 'root'} or
            props['Group'] not in {'', 'root'} or props['Restart'] != 'no' or sha(props['ExecStart'].encode()) != row['serviceExecStartSha256']):
            fail('Exact inactive root cleanup executor required.')
        expected_argv = '/usr/bin/python3 -B ' + receipt['executorFile'] + ' --run-id ' + plan['runId'] + ' --admission-sha256 ' + model.digest(admission) + ' --phase ' + kind
        paths = re.findall(r'(?:^|[ {;])path=([^ ;]+)', props['ExecStart'])
        argv = re.findall(r'argv\[\]=(.*?)\s+;', props['ExecStart'])
        if paths != ['/usr/bin/python3'] or argv != [expected_argv]:
            fail('Known public cleanup executor selector required.')
        summaries.append({'kind': kind, 'timerUnit': timer, 'serviceUnit': service, 'dueUtc': due, 'definitions': row['definitions']})
    return {'receiptSha256': plan['timerReceiptSha256'], 'executorSha256': receipt['executorSha256'], 'timers': summaries}


def permit_snapshot(model, admission):
    ids = ','.join(literal(r['permitId']) for r in model.qualification_permits(admission))
    return query("SELECT jsonb_build_object('active', (SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()),'owned',COALESCE((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'profileId',profile_id,'chainId',chain_id,'fromBlock',from_block::text,'throughBlock',through_block::text,'maximumCu',maximum_cu::text,'spentCu',spent_cu::text,'enabled',enabled,'expires',expires_at) ORDER BY chain_id) FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN (" + ids + ")), '[]'::jsonb),'sourceGrantedCu',COALESCE((SELECT granted_cu::text FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start=" + literal(admission['grantDay']) + "::date),'0'))", market=True)


def local_state(free, n, c, v, name, *, paid, zero):
    chain, port = v.CHAINS[name]
    if v.request(port, '/health').get('status') != 'ready': fail('Owned source6 proxy not healthy.')
    metrics = v.request(port, '/metrics')
    if any(k not in metrics for k in v.CONFIG_KEYS): fail('Complete unchanged legacy configuration required.')
    config = {k: metrics[k] for k in v.CONFIG_KEYS}
    if config['freeRouting'] is not True or config['paidFallbackOnFreeFailure'] is not False or config['sourcePaidFallbackOnFreeFailure'] is not False:
        fail('Legacy free-first routing changed.')
    if metrics.get('unified', {}).get('sourceRouting') != ('paid_primary' if paid else 'free_first'):
        fail('Exact owned source-routing epoch required.')
    counters = {}
    for workload in ['unified_source', 'unified_evidence']:
        value = v.request(port, '/unified/preflight', headers=v.headers(workload))
        if any(value.get(k) != x for k, x in {'profileId': v.PROFILE_ID, 'chainId': chain, 'manifestHash': v.MANIFEST,
            'scope': 'yunipals-opensea', 'workload': workload, 'paid': 'explicit_bounded_permit_only'}.items()): fail('Existing exact source policy changed.')
        row = metrics.get('unified', {}).get('traffic', {}).get(workload, {})
        counters[workload] = {k: row.get(k) for k in ['paidCalls', 'refused']}
        if any(type(x) is not int or x < 0 or (zero and x != 0) or (workload == 'unified_evidence' and x != 0) for x in counters[workload].values()):
            fail('Owned initial source/evidence counters or evidence isolation changed.')
    return {'configuration': config, 'counters': counters}


class Session:
    """Created only by open_session; the real flock and both chain locks persist."""
    def __init__(self, free, n, c, v, model, plan, lock_fd, record_callback=None):
        self.free, self.n, self.c, self.v, self.model, self.plan, self.fd = free, n, c, v, model, plan, lock_fd
        self.plan_seal = sha(encoded(plan)); self.record_callback = record_callback
        self.closed = False; self.record = None; self.directory = None

    def held(self):
        if self.closed: fail('Live owned paid epoch lease required.')
        if sha(encoded(self.plan)) != self.plan_seal: fail('Reviewed paid epoch plan mutated.')
        a, b = os.fstat(self.fd), LOCK.lstat()
        if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino) or not stat.S_ISREG(a.st_mode) or a.st_uid != 0 or a.st_mode & 0o022:
            fail('Original held source lease identity changed.')
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def quiet(self):
        self.held()
        self.n.stop_proof(self.c, self.v, self.plan['stopProofSha256'])
        value = source_gate()
        profile = json.loads(self.c.trusted(self.v.PROFILE, 2_000_000))
        if sha(encoded(value['sourceManifest'])) != sha(encoded(profile['manifest'])):
            fail('Registered source manifest must equal the exact approved profile manifest.')
        return value

    def window(self):
        admission = self.plan['admission']; now = datetime.now(timezone.utc)
        if not self.model.moment(admission['start']) <= now < self.model.moment(admission['qualificationExpiresAt']):
            fail('Original bounded qualification window required.')

    def publish(self, label):
        if not callable(self.record_callback): fail('Durable acknowledged owned-record sink required before mutations.')
        path = self.directory / (label + '.json')
        raw = encoded({'format': FORMAT, 'ownedState': self.record})
        self.v.save_new(path, raw)
        self.record_callback(str(path), sha(raw))
        return {'recordFile': str(path), 'recordSha256': sha(raw)}

    def restore_record(self, path, expected_sha):
        """Restore only an explicit protected immutable journal pin, never live adoption."""
        self.held()
        if self.record is not None or not is_sha(expected_sha): fail('Fresh session and explicit owned record checksum required.')
        path = Path(path)
        if path.parent.parent != BASE / self.plan['runId'] or not is_sha(path.parent.name): fail('Exact owned epoch record path required.')
        payload = self.c.pinned_json(path, expected_sha, 2_000_000)
        if set(payload) != {'format', 'ownedState'} or payload['format'] != FORMAT: fail('Exact owned phase record required.')
        record = payload['ownedState']
        if (set(record) != {'reviewHash', 'review', 'chains', 'enabled', 'cleaned'} or record['reviewHash'] != path.parent.name or
            sha(encoded(record['review'])) != record['reviewHash'] or record['review'].get('plan') != self.plan or
            record['review'].get('format') != FORMAT or record['review'].get('operatorSha256') != sha(self.c.trusted(Path(__file__).absolute())) or
            type(record['enabled']) is not bool or type(record['cleaned']) is not bool or not isinstance(record['chains'], dict) or
            not set(record['chains']).issubset(CHAINS)):
            fail('Exact original plan/helper/owned phase record required.')
        saved = self.c.pinned_json(path.parent / 'review.json', record['reviewHash'], 2_000_000)
        if saved != record['review']: fail('Immutable owned review differs.')
        for name, row in record['chains'].items():
            if (set(row) != {'publicCreated', 'filesCreated', 'afterInvocationId', 'filesRemoved', 'restoredFalseInvocationId'} or
                any(type(row[k]) is not bool for k in ['publicCreated', 'filesCreated', 'filesRemoved']) or
                any(row[k] is not None and not invocation(row[k]) for k in ['afterInvocationId', 'restoredFalseInvocationId'])):
                fail('Exact acknowledged phase identities required.')
            self.false_history(name)
        self.record, self.directory = record, path.parent
        return {'recordFile': str(path), 'recordSha256': expected_sha, 'reviewHash': record['reviewHash'], 'liveStateAdopted': False}

    def false_history(self, name):
        row = self.plan['falseProofs'][str(self.v.CHAINS[name][0])]; directory = Path(row['directory'])
        if directory.parent != self.n.PROOFS / name or directory.name != row['reviewSha256']:
            fail('Exact retained false proof directory required.')
        review = self.c.pinned_json(directory / 'review.json', row['reviewSha256'], 500_000)
        result = self.c.pinned_json(directory / 'result.json', row['resultSha256'], 750_000)
        if (result.get('review') != review or result.get('applied') is not True or result.get('reviewHash') != directory.name or
            result.get('sourceRouting') != 'free_first' or result.get('sourceDigest') != self.n.SOURCE or
            result.get('runtimeSha256') != self.n.PROXY_SHA or review.get('beforeInvocationId') != row['expectedBeforeInvocation'] or
            not invocation(result.get('afterInvocationId'))): fail('Retained exact free-first history changed.')
        return review, result

    def review(self):
        source = self.quiet(); timers = verify_timers(self.c, self.model, self.plan)
        admission = self.plan['admission']; self.window()
        permits = permit_snapshot(self.model, admission)
        if permits['active'] != 0 or permits['owned'] != []: fail('No unrelated active or preexisting owned permits permitted before true epoch.')
        rows, others = {}, {}
        for name in self.v.CHAINS:
            chain, _ = self.v.CHAINS[name]
            if name in CHAINS:
                row = self.plan['falseProofs'][str(chain)]
                live = self.free.validate_applied(row['directory'], row['expectedBeforeInvocation'])
                old, result = self.false_history(name)
                if live['resultSha256'] != row['resultSha256']: fail('Exact protected false receipt binding differs.')
                props = observed(self.v, old['unit']); definitions = self.v.definitions(props)
                target = self.v.SYSTEMD / (old['unit'] + '.d') / OVERRIDE
                public = true_file(self.plan['runId'], name)
                if os.path.lexists(target) or os.path.lexists(public) or any(Path(p).name >= OVERRIDE for p in list(definitions)[1:]):
                    fail('Fresh final 13z override and public true file required.')
                rows[name] = {'false': live, 'beforeInvocationId': props['InvocationID'], 'definitions': definitions,
                    'privateSettings': self.v.private_settings(props), 'environmentFileHashes': self.c.environment_hashes(self.v, props),
                    'legacyConfiguration': old['legacyConfiguration'], 'overridePath': str(target), 'overrideSha256': sha(override_content(public)),
                    'publicEnvironmentPath': str(public), 'publicEnvironmentSha256': sha(true_content())}
            else:
                props = observed(self.v, 'yunipals-market-production-rpc@' + name + '.service')
                self.v.verify_exec_start(props, self.n.ROOT)
                others[name] = {'invocation': props['InvocationID'], 'definitions': self.v.definitions(props), 'privateSettings': self.v.private_settings(props),
                    'environmentFileHashes': self.c.environment_hashes(self.v, props)}
            health = local_state(self.free, self.n, self.c, self.v, name, paid=False, zero=True)
            if name in rows and health['configuration'] != rows[name]['legacyConfiguration']: fail('Retained legacy configuration changed.')
        return {'format': FORMAT, 'phase': 'review_true_epoch', 'plan': self.plan, 'sourcePeer': source, 'timers': timers,
            'proxies': rows, 'otherProxies': others, 'sourceGrantedCu': permits['sourceGrantedCu'],
            'operatorSha256': self.c.sha(self.c.trusted(Path(__file__).absolute())), 'sourceStarted': False,
            'permitOrBudgetWrites': False, 'providerCalls': 0, 'automaticRetryAllowed': False}

    def check_proxy(self, name, row, *, paid, expected_invocation):
        # Validate the frozen false receipt as history, then compare today's
        # actual selector graph against this new epoch, independently.
        self.false_history(name)
        props = observed(self.v, row['false']['unit']); self.v.verify_exec_start(props, self.n.ROOT)
        definitions = self.v.definitions(props); private = self.v.private_settings(props); files = self.c.environment_hashes(self.v, props)
        if paid:
            if definitions.pop(row['overridePath'], None) != row['overrideSha256']: fail('Only exact owned 13z definition is removable.')
            entry = row['publicEnvironmentPath'] + ' (ignore_errors=no)'
            if not private['orderedEnvironmentFiles'] or private['orderedEnvironmentFiles'].pop() != entry: fail('Exact final true selector required.')
            expected = {'path': row['publicEnvironmentPath'], 'optional': False, 'exists': True, 'sha256': row['publicEnvironmentSha256']}
            if not files or files.pop() != expected: fail('Exact owned public true bytes required.')
            if sha(self.c.trusted(Path(row['publicEnvironmentPath']), 2000)) != row['publicEnvironmentSha256']: fail('Owned true bytes changed.')
        if (props['InvocationID'] != expected_invocation or definitions != row['definitions'] or private != row['privateSettings'] or
            files != row['environmentFileHashes'] or self.v.digest(self.n.ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs') != self.n.PROXY_SHA or
            self.v.digest(self.v.PROFILE) != self.v.PROFILE_SHA): fail('Owned proxy invocation, code, profile or opaque private selectors changed.')
        return props

    def other_guards(self, review):
        if self.quiet() != review['sourcePeer']: fail('Source peer identity changed during owned epoch.')
        for name, expected in review['otherProxies'].items():
            props = observed(self.v, 'yunipals-market-production-rpc@' + name + '.service')
            self.v.verify_exec_start(props, self.n.ROOT)
            actual = {'invocation': props['InvocationID'], 'definitions': self.v.definitions(props), 'privateSettings': self.v.private_settings(props),
                'environmentFileHashes': self.c.environment_hashes(self.v, props)}
            if actual != expected: fail('Unowned peer proxy changed.')
            local_state(self.free, self.n, self.c, self.v, name, paid=False, zero=True)

    def enable(self, marker):
        if self.record is not None: fail('This owned epoch cannot be enabled twice.')
        if not callable(self.record_callback): fail('Durable acknowledged owned-record sink required before mutations.')
        review = self.review()
        if marker != sha(encoded(review)): fail('Exact fresh paid epoch review required.')
        self.directory = private_directory(self.plan['runId'], marker)
        self.v.save_new(self.directory / 'review.json', encoded(review))
        self.record = {'reviewHash': marker, 'review': review, 'chains': {}, 'enabled': False, 'cleaned': False}
        self.publish('prepared')
        phase = 'pre_mutation'
        try:
            for name in CHAINS:
                row = review['proxies'][name]; self.other_guards(review)
                self.window()
                verify_timers(self.c, self.model, self.plan)
                if permit_snapshot(self.model, self.plan['admission'])['active'] != 0: fail('Paid authority cannot precede isolated epoch preparation.')
                for prior_name, prior in self.record['chains'].items():
                    if invocation(prior.get('afterInvocationId')):
                        self.check_proxy(prior_name, review['proxies'][prior_name], paid=True, expected_invocation=prior['afterInvocationId'])
                self.check_proxy(name, row, paid=False, expected_invocation=row['beforeInvocationId'])
                self.record['chains'][name] = {'publicCreated': False, 'filesCreated': False, 'afterInvocationId': None,
                    'filesRemoved': False, 'restoredFalseInvocationId': None}
                phase = 'create_true_file_' + name
                self.v.save_new(Path(row['publicEnvironmentPath']), true_content(), 0o644)
                self.record['chains'][name]['publicCreated'] = True
                self.publish(name + '-public-created')
                phase = 'create_13z_' + name
                self.v.save_new(Path(row['overridePath']), override_content(Path(row['publicEnvironmentPath'])), 0o644)
                self.record['chains'][name]['filesCreated'] = True
                self.publish(name + '-true-selected')
                phase = 'restart_' + name
                self.v.run(['/usr/bin/systemctl', 'daemon-reload'])
                self.v.run(['/usr/bin/systemctl', 'restart', row['false']['unit']], timeout=150)
                props = observed(self.v, row['false']['unit']); current = props['InvocationID']
                if current == row['beforeInvocationId']: fail('New distinct owned true invocation required.')
                self.record['chains'][name]['afterInvocationId'] = current
                self.publish(name + '-true-restarted')
                self.v.save_new(self.directory / (name + '-owned-invocation.json'), encoded({'invocation': current, 'reviewHash': marker}))
                self.check_proxy(name, row, paid=True, expected_invocation=current)
                health = self.v.retry(lambda: local_state(self.free, self.n, self.c, self.v, name, paid=True, zero=True))
                if health['configuration'] != row['legacyConfiguration']: fail('Legacy configuration changed after true flag.')
            self.other_guards(review)
            self.record['enabled'] = True
            result = self.validate_current(zero=True)
            self.v.save_new(self.directory / 'enabled.json', encoded({**self.record, 'actual': result}))
            return {**result, **self.publish('enabled-record')}
        except Exception as error:
            self.v.save_new(self.directory / 'enable-failed.json', encoded({'phase': phase, 'errorClass': type(error).__name__,
                'ownedState': self.record, 'automaticRetryAllowed': False, 'requiresOwnedCleanupOrManualReconcile': True}))
            raise

    def validate_current(self, *, zero=False):
        if self.record is None or not self.record['enabled'] or self.record['cleaned']: fail('Acknowledged owned true epoch required.')
        review = self.record['review']; self.other_guards(review)
        self.window()
        verify_timers(self.c, self.model, self.plan)
        summaries = {}
        for name in CHAINS:
            row = review['proxies'][name]; current = self.record['chains'][name]['afterInvocationId']
            self.check_proxy(name, row, paid=True, expected_invocation=current)
            health = local_state(self.free, self.n, self.c, self.v, name, paid=True, zero=zero)
            if health['configuration'] != row['legacyConfiguration']: fail('Owned legacy configuration changed.')
            summaries[str(self.v.CHAINS[name][0])] = {'invocation': current, 'sourceRouting': 'paid_primary', **health}
        return {'format': FORMAT, 'reviewHash': self.record['reviewHash'], 'sourceDigest': self.n.SOURCE, 'runtimeSha256': self.n.PROXY_SHA,
            'proxies': summaries, 'sourceStarted': False, 'permitOrBudgetWrites': False, 'providerCalls': 0}

    def cleanup(self, receipt_file, receipt_sha):
        if self.record is None: fail('Retained owned epoch record required for cleanup.')
        if not callable(self.record_callback): fail('Durable acknowledged owned-record sink required before cleanup mutations.')
        receipt_file = Path(receipt_file)
        if receipt_file != OPS / ('source6-paid-' + self.plan['runId'] + '.revoked.json') or not is_sha(receipt_sha): fail('Exact protected revocation receipt required.')
        receipt = self.c.pinned_json(receipt_file, receipt_sha, 50_000)
        admission = self.plan['admission']; rows = self.model.qualification_permits(admission)
        if (set(receipt) != {'format', 'admissionPlanSha256', 'transactionOutcome', 'permitIds'} or
            receipt['format'] != 'yunipals-paid-capability-revocation-v1' or receipt['admissionPlanSha256'] != self.model.digest(admission) or
            receipt['transactionOutcome'] not in {'commit_confirmed', 'not_admitted_confirmed'} or
            receipt['permitIds'] != [r['permitId'] for r in rows]): fail('Acknowledged exact owned permit revocation required.')
        self.other_guards(self.record['review'])
        before = permit_snapshot(self.model, admission)
        validate_revoked(self.model, admission, receipt, before)
        if self.record['cleaned']:
            restored = self.restored_state()
            return {'format': FORMAT, 'cleaned': True, 'alreadyAcknowledgedCleanup': True, 'reviewHash': self.record['reviewHash'],
                'proxies': restored, 'sourceBookedCuBefore': before['sourceGrantedCu'], 'sourceBookedCuAfter': before['sourceGrantedCu'],
                'grantCountersWrittenOrReset': False, 'policyWritten': False, 'sourceStarted': False, 'automaticRetryAllowed': False}
        self.v.save_new(self.directory / ('cleanup-review-' + sha(encoded(self.record))[:16] + '.json'), encoded({'receiptSha256': receipt_sha, 'before': before, 'ownedState': self.record}))
        restored = {}; phase = 'owned_true_fence'
        try:
            for name in CHAINS:
                owned = self.record['chains'].get(name)
                if owned is None: continue
                row = self.record['review']['proxies'][name]
                if invocation(owned.get('restoredFalseInvocationId')):
                    self.check_proxy(name, row, paid=False, expected_invocation=owned['restoredFalseInvocationId'])
                    health = local_state(self.free, self.n, self.c, self.v, name, paid=False, zero=True)
                    if health['configuration'] != row['legacyConfiguration']: fail('Previously acknowledged false epoch drifted.')
                    restored[name] = {'beforePaidInvocation': owned['afterInvocationId'], 'afterFalseInvocation': owned['restoredFalseInvocationId'],
                        'zeroRamEraCounters': True, 'original12zAndFalseFileRetained': True, 'ownedPaidProxyCacheDestroyed': True,
                        'previouslyAcknowledgedCleanupRetained': True}
                    continue
                if owned.get('publicCreated') and not owned.get('filesCreated'):
                    self.check_proxy(name, row, paid=False, expected_invocation=row['beforeInvocationId'])
                    if sha(self.c.trusted(Path(row['publicEnvironmentPath']), 2000)) != row['publicEnvironmentSha256']:
                        fail('Unselected owned true file changed.')
                    Path(row['publicEnvironmentPath']).unlink()
                    owned['publicCreated'] = False
                    self.publish(name + '-unselected-public-removed')
                    restored[name] = {'unselectedOwnedTrueFileRemoved': True, 'proxyRestarted': False}
                    continue
                if not owned.get('filesCreated'): continue
                current = owned['afterInvocationId']
                if owned.get('filesRemoved'): fail('Unacknowledged false restart requires manual reconciliation, never a retry.')
                if not invocation(current): fail('Unacknowledged restart requires manual catalog/unit reconciliation, never adoption.')
                self.other_guards(self.record['review'])
                validate_revoked(self.model, admission, receipt, permit_snapshot(self.model, admission))
                self.check_proxy(name, row, paid=True, expected_invocation=current)
                phase = 'remove_only_owned_13z_' + name
                Path(row['overridePath']).unlink(); Path(row['publicEnvironmentPath']).unlink()
                owned['filesRemoved'] = True
                self.publish(name + '-true-files-removed')
                phase = 'restart_false_' + name
                self.v.run(['/usr/bin/systemctl', 'daemon-reload'])
                self.v.run(['/usr/bin/systemctl', 'restart', row['false']['unit']], timeout=150)
                props = observed(self.v, row['false']['unit']); new_id = props['InvocationID']
                if new_id in {current, row['beforeInvocationId']}: fail('Distinct new false invocation required to prove destroyed RAM caches.')
                owned['restoredFalseInvocationId'] = new_id
                self.publish(name + '-false-restarted')
                self.check_proxy(name, row, paid=False, expected_invocation=new_id)
                health = self.v.retry(lambda: local_state(self.free, self.n, self.c, self.v, name, paid=False, zero=True))
                if health['configuration'] != row['legacyConfiguration']: fail('Original false configuration not restored.')
                restored[name] = {'beforePaidInvocation': current, 'afterFalseInvocation': new_id, 'zeroRamEraCounters': True,
                    'original12zAndFalseFileRetained': True, 'ownedPaidProxyCacheDestroyed': True}
            self.other_guards(self.record['review'])
            after = permit_snapshot(self.model, admission); validate_revoked(self.model, admission, receipt, after)
            if after['sourceGrantedCu'] != before['sourceGrantedCu']: fail('Source booked counters changed during quiescent cache cleanup; reconcile without resets.')
            if any(os.path.lexists(row[k]) for row in self.record['review']['proxies'].values() for k in ['overridePath', 'publicEnvironmentPath']):
                fail('Unknown or partially acknowledged true files remain; manual reconciliation required.')
            self.record['cleaned'] = True
            final_record = self.publish('cleaned-record')
            result = {'format': FORMAT, 'cleaned': True, 'reviewHash': self.record['reviewHash'], 'revocationReceiptSha256': receipt_sha,
                'proxies': restored, 'sourceBookedCuBefore': before['sourceGrantedCu'], 'sourceBookedCuAfter': after['sourceGrantedCu'],
                'grantCountersWrittenOrReset': False, 'policyWritten': False, 'sourceStarted': False, 'automaticRetryAllowed': False, **final_record}
            self.v.save_new(self.directory / 'cleaned.json', encoded(result))
            return result
        except Exception as error:
            self.v.save_new(self.directory / 'cleanup-failed.json', encoded({'phase': phase, 'errorClass': type(error).__name__,
                'restored': restored, 'automaticRetryAllowed': False, 'manualReconciliationRequired': True}))
            raise

    def restored_state(self):
        """Fresh proof for a previously acknowledged final cleanup, no restart."""
        self.other_guards(self.record['review']); restored = {}
        for name in CHAINS:
            row = self.record['review']['proxies'][name]; owned = self.record['chains'].get(name)
            if owned is None or not owned.get('filesCreated'):
                current = row['beforeInvocationId']
            else:
                current = owned.get('restoredFalseInvocationId')
                if not invocation(current): fail('Acknowledged final cleanup lacks its exact false invocation.')
            self.check_proxy(name, row, paid=False, expected_invocation=current)
            health = local_state(self.free, self.n, self.c, self.v, name, paid=False, zero=True)
            if health['configuration'] != row['legacyConfiguration']: fail('Acknowledged restored configuration drifted.')
            if os.path.lexists(row['overridePath']) or os.path.lexists(row['publicEnvironmentPath']): fail('Owned true files must remain absent after cleanup.')
            restored[name] = {'afterFalseInvocation': current, 'original12zAndFalseFileRetained': True, 'zeroRamEraCounters': True,
                'ownedPaidProxyCacheDestroyed': True, 'previouslyAcknowledgedCleanupRetained': True}
        return restored


def validate_revoked(model, admission, receipt, snapshot):
    if snapshot.get('active') != 0: fail('No active paid authority permitted during cache cleanup.')
    expected = model.qualification_permits(admission)
    if receipt['transactionOutcome'] == 'not_admitted_confirmed':
        if snapshot.get('owned') != []: fail('Never-admitted cleanup requires actual absent owned rows.')
        return
    if not isinstance(snapshot.get('owned'), list) or len(snapshot['owned']) != 2: fail('Both exact disabled owned permit rows required.')
    for row in expected:
        found = [r for r in snapshot['owned'] if r.get('permitId') == row['permitId']]
        if len(found) != 1: fail('Exact disabled permit identity required.')
        actual = found[0]
        if (set(actual) != set(row) | {'profileId', 'enabled', 'spentCu'} or actual['enabled'] is not False or actual['profileId'] != model.PROFILE or
            any(actual[k] != v for k, v in row.items() if k != 'expires') or model.moment(actual['expires'].replace('+00:00', 'Z')) != model.moment(row['expires']) or
            model.cu(actual['spentCu']) > model.cu(row['maximumCu'])): fail('Disabled permit bytes differ from owned admission.')


def private_directory(run_id, marker):
    if not re.fullmatch('20261021-[a-z0-9-]{1,30}', run_id) or not is_sha(marker): fail('Exact fresh owned proof selector required.')
    for path in BASE.parents:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            fail('Protected root proof ancestry required.')
    for path in [BASE, BASE / run_id]:
        path.mkdir(mode=0o700, exist_ok=True); info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077: fail('Private root owned proof ancestry required.')
    directory = BASE / run_id / marker; directory.mkdir(mode=0o700)
    return directory


@contextmanager
def open_session(plan_file, plan_sha, *, record_callback=None):
    """Own the source+both chain locks across enable, probe integration, cleanup.

    The timer executor must signal/coordinate the exact owned controller BEFORE
    waiting for this lease. It must never deadlock behind a controller waiting
    for that timer to clean up. No nested source_lease() call is permitted.
    """
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main': fail('Exact production root/host required.')
    free, n, c, v, model = modules(); plan = load_plan(c, model, plan_file, plan_sha)
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    instance = None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: fail('Protected exclusive source lease required.')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with ExitStack() as locks:
            for name in CHAINS: locks.enter_context(v.chain_lock(name))
            instance = Session(free, n, c, v, model, plan, fd, record_callback=record_callback)
            yield instance
    finally:
        if instance is not None: instance.closed = True
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True); parser.add_argument('--plan-sha256', required=True)
    args = parser.parse_args()
    with open_session(args.plan, args.plan_sha256) as session:
        review = session.review()
        print(json.dumps({'format': FORMAT, 'applied': False, 'reviewHash': sha(encoded(review)), 'sourceStarted': False,
            'permitOrBudgetWrites': False, 'providerCalls': 0, 'planSha256': args.plan_sha256}, indent=2))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__})); raise SystemExit(1)
