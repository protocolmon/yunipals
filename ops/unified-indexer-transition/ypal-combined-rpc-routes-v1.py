#!/usr/bin/env python3
"""Own four free combined routes after the separately acknowledged admission."""
import argparse
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path
import re
import signal
import stat
import types
import time

FORMAT = 'yunipals-ypal-combined-rpc-routes-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-combined-rpc-routes-v1-20261023')
ADMISSION_FILE = OPS / 'ypal-combined-rpc-admission-v3.py'
ADMISSION_HELPER_SHA = '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862'
ADMISSION_BASE = Path('/var/backups/yunipals-ypal-combined-rpc-admission-v3-20261023')
ADMISSION_SHA = 'b47cd2411c3e10c8b0538761d88b26e0aa14b78b3aa7510a2c314fd1ab581430'
ARTIFACT = OPS / 'ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs'
ARTIFACT_SHA = '8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c'
PREIMAGE = OPS / 'source6-selective-source-proxy-v6/rpc-budget-proxy.mjs'
PREIMAGE_SHA = 'd8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8'
STAGE = Path('/var/backups/yunipals-ypal-combined-pool-one-stage-v1-20261023/result.json')
STAGE_SHA = '302757381870bbe92e07754deb25fa62d2ccfe972d8ad84bde24ed208516757d'
RELEASE = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
CONTEXT = RELEASE / 'apps/yunipals-market-api/node_modules'
DEPENDENCIES = {
 'node_modules/.pnpm/pg@8.23.0/node_modules/pg/esm/index.mjs': '5ef4d06556eeb775987759c2c09229dca2139421ee40e819b566612db2b4a8dc',
 'node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js': '3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c',
 'node_modules/.pnpm/pg@8.23.0/node_modules/pg/package.json': 'e42dd36cba6e9dd8dbb6f773a2f7be8a8c3c273e18b155e42e75961a4cb8bc28',
 'node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem/_esm/index.js': 'ef21c6b781a763af96a5503e7ed9288108d6ba229db16210fd4ad40b718db6ec',
 'node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem/package.json': '16b801dd5bfceb81ed9efb05c342a3675a865d0ce33446e54fb6e6c907045183'}
PACKAGE_TARGETS = {
 'pg': '../../../node_modules/.pnpm/pg@8.23.0/node_modules/pg',
 'viem': '../../../node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem'}
LOCK = '/run/lock/yunipals-ypal-combined-transition.lock'


def need(v, code):
    if not v: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()


def load_admission():
    for p in [*ADMISSION_FILE.parents, ADMISSION_FILE]:
        s = p.lstat(); need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_frozen_admission_required')
    raw = ADMISSION_FILE.read_bytes(); need(sha(raw) == ADMISSION_HELPER_SHA, 'exact_admission_helper_required')
    a = types.ModuleType('combined_admission'); a.__file__ = str(ADMISSION_FILE)
    exec(compile(raw, str(ADMISSION_FILE), 'exec'), a.__dict__)
    return a


def artifact_inputs(m):
    stage = json.loads(m.pinned(STAGE, STAGE_SHA))
    need(stage['completed'] is True and stage['format'] == 'yunipals-combined-rpc-pool-one-production-stage-v1' and
         stage['existingArtifactUnchanged'] is True and stage['files'][str(ARTIFACT)] == ARTIFACT_SHA and
         stage['runtimeImport'] == {'actualInstalledModuleImport': True, 'databaseQueries': 0, 'networkAttempts': 0, 'serviceStarted': False}, 'actual_inactive_artifact_import_required')
    candidate = m.pinned(ARTIFACT, ARTIFACT_SHA); original = m.pinned(PREIMAGE, PREIMAGE_SHA)
    before = b'function createOpenSeaRequestBudget(input = process.env) {\n  const { databaseUrl, scope, coordinatorId } = readOpenSeaBudgetEnvironment(input);\n  const pool = new pg3.Pool({\n    connectionString: databaseUrl,\n    application_name: "yunipals_opensea_budget",\n    max: 2,\n'
    after = before.replace(b'max: 2,', b'max: 1,')
    need(len(candidate) == len(original) == 111657 and original.count(before) == candidate.count(after) == 1 and
         original.replace(before, after) == candidate, 'exact_one_byte_pool_one_artifact_required')
    link = ARTIFACT.parent / 'node_modules'; ls = link.lstat(); target = CONTEXT.lstat()
    need(stat.S_ISLNK(ls.st_mode) and ls.st_uid == ls.st_gid == 0 and os.readlink(link) == str(CONTEXT) and
         stat.S_ISDIR(target.st_mode) and target.st_uid == target.st_gid == 0 and not target.st_mode & 0o022 and
         target.st_dev == 2049 and target.st_ino == 1430272, 'exact_retained_dependency_context_required')
    need(stage['dependencyLink'] == {'path': str(link), 'target': str(CONTEXT), 'identity': m.identity(ls)}, 'actual_owned_staged_context_link_required')
    packages = {}
    for name, expected in PACKAGE_TARGETS.items():
        p = CONTEXT / name; s = p.lstat()
        need(stat.S_ISLNK(s.st_mode) and s.st_uid == s.st_gid == 0 and os.readlink(p) == expected, 'exact_retained_package_link_required')
        packages[name] = {'target': expected, 'identity': m.identity(s)}
    for path, pin in DEPENDENCIES.items(): m.pinned(RELEASE / path, pin)
    return {'artifact': str(ARTIFACT), 'artifactSha256': ARTIFACT_SHA, 'preimageSha256': PREIMAGE_SHA,
            'budgetPoolMax': 1, 'stageReceiptSha256': STAGE_SHA, 'contextTarget': str(CONTEXT), 'contextIdentity': m.identity(target),
            'ownedContextLinkIdentity': m.identity(ls), 'packageLinks': packages, 'dependencies': DEPENDENCIES}


def admission_inputs(m, full=False):
    need(isinstance(ADMISSION_SHA, str) and re.fullmatch('[0-9a-f]{64}', ADMISSION_SHA), 'actual_admission_receipt_required')
    raw = m.pinned(ADMISSION_BASE / 'admitted.json', ADMISSION_SHA); saved = json.loads(raw)
    before_raw = m.protected(ADMISSION_BASE / 'before.json'); before = json.loads(before_raw)
    need(saved['format'] == 'yunipals-ypal-combined-rpc-admission-v3' and saved['admitted'] is True and
         saved['reviewHash'] == before['reviewHash'] and saved['newPermits'] == 0 and saved['paidAuthority'] is False and
         saved['budgetUnchanged'] is True and not (ADMISSION_BASE / 'restore-intent.json').exists(), 'successful_unreversed_admission_required')
    if full:
        a = load_admission(); original, _ = a.core()
        need(a.baseline(original) == before, 'actual_admission_baseline_required')
        a.exact_catalog(original, a.catalog(original), before['catalog'], True)
    return {'admissionHelperSha256': ADMISSION_HELPER_SHA, 'admissionReceiptSha256': ADMISSION_SHA,
            'admissionReviewFileSha256': sha(before_raw)}, raw, before


def capacity_snapshot(m):
    return m.query("SELECT jsonb_build_object('roleOid',(SELECT oid::text FROM pg_roles WHERE rolname='market_prod_budget'),'roleLimit',(SELECT rolconnlimit FROM pg_roles WHERE rolname='market_prod_budget'),'roleSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='market_prod_budget'),'clientSessions',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),'maxConnections',current_setting('max_connections')::int,'reserved',current_setting('superuser_reserved_connections')::int+coalesce(nullif(current_setting('reserved_connections',true),''),'0')::int)")


def capacity(m, remaining=4):
    need(type(remaining) is int and 0 <= remaining <= 4, 'fixed_remaining_proxy_count_required')
    row = capacity_snapshot(m)
    # Retained five pools may each reach2; already-started new pools reach1.
    # Keep two further slots rather than changing the role/global limits.
    required = max(row['roleSessions'], 10 + 4 - remaining) + remaining + 2
    need(row['roleOid'] and row['roleLimit'] == 16 and row['maxConnections'] == 96 and row['reserved'] == 3 and row['roleLimit'] >= required and row['clientSessions'] + remaining + 2 <= row['maxConnections'] - row['reserved'], 'existing_budget_connection_headroom_required')
    return {**row, 'remainingProxies': remaining, 'newPoolMax': 1, 'retainedPoolCapacity': 10,
            'requiredRoleCapacity': required, 'reserve': 2, 'roleOrGlobalLimitsChanged': False}


def route_plan(m, a, chain):
    plan, body = a.original_plan(m, chain)
    prior = plan['entry']; last = ('ExecStart=' + a.NODE + ' ' + prior + '\n').encode()
    need(body.count(last) >= 1, 'retained_rendered_command_required')
    # Replace only the final owned override; preserve inherited definitions.
    offset = body.rfind(last); body = body[:offset] + ('ExecStart=' + a.NODE + ' ' + str(ARTIFACT) + '\n').encode() + body[offset + len(last):]
    plan = {**plan, 'entry': str(ARTIFACT), 'entrySha256': ARTIFACT_SHA, 'unitSha256': sha(body),
            'retainedEntry': prior, 'retainedEntrySha256': plan['entrySha256'], 'budgetPoolMax': 1}
    return plan, body


def inputs(m, a):
    admitted, _, _ = admission_inputs(m)
    return {**a.original_profile_inputs(m), **admitted, 'routeArtifact': artifact_inputs(m)}


def baseline(m, a):
    before = m.load('before.json'); b = before['binding']
    need(b['operatorSha256'] == sha(m.protected(Path(__file__).absolute())) and b['bootId'] == m.boot() and
         b['inputs'] == inputs(m, a) and b['retained'] == a.retained(m), 'exact_route_direct_binding_required')
    need({c: a.plan(m, c)[0] for c in a.CHAINS} == b['plans'], 'retained_route_inputs_changed')
    current_capacity = capacity_snapshot(m)
    need({k: current_capacity[k] for k in b['budgetCapacityIdentity']} == b['budgetCapacityIdentity'], 'unchanged_budget_connection_limits_required')
    need(before['reviewHash'] == sha(encoded({'binding': b, 'catalog': before['catalog']})), 'authenticated_route_review_required')
    return before


def owned_stop_identity(m, a, chain, before):
    """Stopping our actor must not depend on its HTTP/DB health succeeding."""
    for tag in ['unit', 'env']: m.check_published(chain + '-' + tag)
    p = before['binding']['plans'][chain]; value = a.state(m, a.unit(chain)); intent = m.load(chain + '-start-intent.json')
    need(value['FragmentPath'] == str(a.paths(chain)['unit']) and not value['DropInPaths'] and
         {k: value[k] for k in m.SECURITY} == p['security'] and intent['bootId'] == m.boot() and
         intent['unitSha256'] == p['unitSha256'], 'exact_owned_stop_definition_required')
    actor = a.live_actor(m, value, dict(line.split('=', 1) for line in a.env_bytes(chain).decode().splitlines()))
    need(len(actor['processes']) == 1, 'single_owned_stop_actor_required')
    process = actor['processes'][0]; priv = process['privileges']; account = pwd.getpwnam('yunipals-market-prod-rpc')
    need(set(priv['Uid'].split()) == {str(account.pw_uid)} and set(priv['Gid'].split()) == {str(account.pw_gid)} and
         set(priv['Groups'].split()) <= {str(account.pw_gid)} and priv['NoNewPrivs'] == '1' and
         all(int(priv[k], 16) == 0 for k in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']), 'unprivileged_owned_stop_actor_required')
    need(process['commandSha256'] == sha((a.NODE + '\0' + p['entry'] + '\0').encode()) and
         sha(m.protected(p['entry'])) == p['entrySha256'] and
         intent['earliestMonotonicUs'] <= actor['startMonotonicMicroseconds'] <= time.monotonic_ns() // 1000 and
         (int(value['NRestarts']) > 0 or actor['startMonotonicMicroseconds'] <= intent['earliestMonotonicUs'] + 130000000), 'exact_owned_stop_process_required')
    return {'actor': actor, 'healthRequiredForOwnedStop': False}


def core():
    a = load_admission(); a.BASE = BASE; a.FORMAT = FORMAT; a.__file__ = str(Path(__file__).absolute())
    a.SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA = ARTIFACT_SHA
    a.original_plan = a.plan; a.original_profile_inputs = a.profile_inputs; original_manager = a.manager; original_owned = a.owned
    a.plan = lambda m, chain: route_plan(m, a, chain)
    a.profile_inputs = lambda m: inputs(m, a)
    a.baseline = lambda m: baseline(m, a)
    def manager(m, verb, chain=None):
        if verb == 'start': capacity(m, 4 - sum((BASE / (c + '-started.json')).exists() for c in a.CHAINS))
        return original_manager(m, verb, chain)
    a.manager = manager
    a.owned = lambda m, chain, before, allow_restart=False: owned_stop_identity(m, a, chain, before) if allow_restart else original_owned(m, chain, before)
    m, _ = a.core(); m.route_owner = a
    return m, a


# Stable direct interfaces for the separate source owner after the old drain.
def retained(m): return m.route_owner.retained(m)
def source_query(m, sql): return m.route_owner.source_query(m, sql)
def live_actor(m, value, expected=None): return m.route_owner.live_actor(m, value, expected)
def state(m, name): return m.route_owner.state(m, name)


def review(m, a):
    need(not BASE.exists(), 'existing_route_operation_requires_explicit_phase')
    admission_inputs(m, True); a.new_absent(m)
    public = inputs(m, a); direct = a.retained(m); plans = {c: a.plan(m, c)[0] for c in a.CHAINS}
    _, _, admitted_before = admission_inputs(m); current = a.catalog(m); a.exact_catalog(m, current, admitted_before['catalog'], True)
    available = capacity(m); need(a.retained(m) == direct, 'retained_actors_changed_during_route_review')
    binding = {'format': FORMAT, 'operatorSha256': sha(m.protected(Path(__file__).absolute())), 'bootId': m.boot(),
               'inputs': public, 'retained': direct, 'plans': plans, 'budgetCapacityIdentity': {k: available[k] for k in ['roleOid', 'roleLimit', 'maxConnections', 'reserved']}}
    result = {'format': FORMAT, 'binding': binding, 'catalog': current}
    return {**result, 'reviewHash': sha(encoded({'binding': binding, 'catalog': current})), 'capacity': available,
            'databaseWrites': 0, 'serviceChanges': 0, 'providerRpcRequests': 0}


def start(m, a, pin):
    before = review(m, a); need(before['reviewHash'] == pin, 'fresh_route_review_required')
    _, raw, _ = admission_inputs(m)
    BASE.mkdir(mode=0o700); m.sync(BASE.parent); m.save('before.json', before)
    m.write(BASE / 'admitted.json', raw)
    return a.start(m, ADMISSION_SHA)


def validate_current(pin):
    _, a = core()
    return a.validate_current(pin)


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['start', 'reconcile-start', 'validate', 'restore']: group.add_argument('--' + name)
    args = parser.parse_args(); need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_route_operation_expired')); signal.alarm(900)
    m, a = core(); lock = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.start: value = start(m, a, args.start)
        elif args.reconcile_start: value = a.reconcile_start(m, args.reconcile_start)
        elif args.validate: value = validate_current(args.validate)
        elif args.restore: value = a.restore(m, args.restore)
        else: value = review(m, a)
        print(json.dumps(value, sort_keys=True))
    finally: os.close(lock)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
