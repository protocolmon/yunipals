#!/usr/bin/env python3
"""Fresh restored-epoch READ143: explicit plan, rollback, single commit and inverse.

No source/reader constructor from the old c96 admission is executed. Historical
SQL edge builders are pure scope evidence. Plans/graphs and acknowledgements are
private host files; absent authorization or a real prerequisite never means pass.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = 'yunipals-ypal-restored-read-admission-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-restored-read-admission-v1-20261024')
INPUT_BASE = Path('/var/backups/yunipals-ypal-restored-read-admission-input-v1-20261024')
PLAN = INPUT_BASE / 'plan.json'
CONTEXT = OPS / 'ypal-restored-read-current-context-v1.py'
CONTEXT_SHA = 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932'
STATIC = OPS / 'ypal-restored-metadata-context-v1.py'
STATIC_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
COLUMNS = OPS / 'ypal-restored-read-admission-v1.columns.sql'
COLUMNS_SHA = '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf'
HISTORICAL_SHA = 'fc79c53da5dc2ce3ccc9ce5c86f69ecfb75f0d25b2836d746f90f29e59ce6e0e'
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value: raise RuntimeError(code)
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None
def literal(value): return "'" + value.replace("'", "''") + "'"
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def protected(path, expected=None):
    path = Path(path)
    for p in [*reversed(path.parents), path]:
        st = p.lstat()
        need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             'root_protected_nonsymlink_input_required')
    st = path.lstat(); need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= 8000000, 'bounded_single_link_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 8000001)
        identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns, v.st_nlink)
        need(identity(st) == identity(os.fstat(fd)) == identity(path.lstat()) and len(raw) == st.st_size, 'protected_input_changed_during_read')
    finally: os.close(fd)
    need(expected is None or sha(raw) == expected, 'exact_protected_input_hash_required'); return raw

def document(path, expected=None): return json.loads(protected(path, expected))
def module(path, expected):
    raw = protected(path, expected); value = types.ModuleType(Path(path).stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def save(path, value):
    path = Path(path); raw = encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f: f.write(raw); f.flush(); os.fsync(f.fileno())
    except BaseException: raise
    sync(path.parent); return sha(raw)

def own_sha(): return sha(protected(Path(__file__).absolute()))
def acl_catalog(value): return {k: v for k, v in value.items() if k not in {'activeRelease', 'nativeMetadataAdoptions'}}
def graph(value): return {**value, 'read': acl_catalog(value['read'])}


def combined_sql(catalog, columns):
    return "SELECT jsonb_build_object('read',(" + catalog.strip().rstrip(';') + "),'allColumnAcl',(" + columns.strip().rstrip(';') + '))'


def validate_delta(helpers, plan, before, after):
    need(set(before) == set(after) == {'read', 'allColumnAcl'} and before['allColumnAcl'] == after['allColumnAcl'],
         'all_grantee_column_ACLs_must_remain_exact')
    helpers.validate_delta(plan, before['read'], after['read']); return True


def validate_column_overlap(plan, catalog):
    proposed = {(str(v['object']), str(v['grantee'])) for v in plan['missingPermissions']
                if v['kind'] == 'relation' and v['privilege'] == 'SELECT'}
    for column in catalog['allColumnAcl']:
        need(not any((str(column['relation']), str(edge['grantee'])) in proposed and edge['privilege'] == 'SELECT'
                     for edge in column['edges']), 'existing_column_SELECT_overlap_would_make_table_REVOKE_noninvertible')
    return True


def validate_plan(parts, plan):
    old = parts['historicalReadPlan']; helpers = parts['historicalReadHelpers']
    need(plan['format'] == FORMAT + '-plan' and plan['historicalPlanSha256'] == HISTORICAL_SHA and
         plan['contextOperatorSha256'] == CONTEXT_SHA and pin(plan['contextInputSha256']) and
         plan['planReviewHash'] == sha(encoded({k:v for k,v in plan.items() if k != 'planReviewHash'})) and
         plan['missingPermissions'] == old['missingPermissions'] and plan['missingCount'] == 143 and
         plan['newRoles'] == plan['loginChanges'] == plan['newDml'] == 0 and
         plan['columnsSqlSha256'] == COLUMNS_SHA and plan['catalogSqlSha256'] == parts['catalogSqlSha256'],
         'exact_fresh143_scope_and_new_baseline_required')
    for key in ['sourceRelease', 'readIdentity', 'physicalSchema', 'physicalSchemaOid', 'readSchema', 'readSchemaOid', 'createdReceiptSha256']:
        need(plan[key] == old[key], 'unchanged_created_source_and_read_identity_required')
    need(len(helpers.statements(plan)) == 143 and plan['baselineCatalog'] == plan['catalogBefore']['read'], 'complete_fresh_catalog_required')
    # Object identities/definitions are retained independently of the acknowledged Arena ACL additions.
    for field in ['schemas', 'relations', 'functions']:
        strip = lambda rows: [{k: v for k, v in row.items() if k != 'acl'} for row in rows]
        need(strip(plan['baselineCatalog'][field] or []) == strip(old['baselineCatalog'][field] or []), 'same_original_object_OIDs_owners_and_definitions_required')
    need({v['name']: v['oid'] for v in plan['baselineCatalog']['roles']} == helpers.ROLE_OIDS,
         'exact_original_seven_role_OIDs_required')
    effective = {v['role']: v for v in plan['baselineCatalog']['effective']}
    for edge in plan['missingPermissions']:
        role = effective[edge['role']]
        bit = role['schemas'][edge['name']]['usage'] if edge['kind'] == 'schema' else (role['relations'][edge['name']]['select'] if edge['kind'] == 'relation' else role['functions'][edge['name']])
        need(bit is False, 'each143_effective_read_must_still_be_missing')
        need(not any(v['kind'] == edge['kind'] and v['object'] == edge['object'] and v['grantee'] == edge['grantee'] and
                     v['privilege'] == edge['privilege'] for v in plan['baselineCatalog']['targetEdges']), 'all143_reads_must_still_be_missing')
    validate_column_overlap(plan, plan['catalogBefore']); return plan


class Host:
    def __init__(self, context_input, plan_sha=None, inverse=False):
        need(pin(context_input), 'explicit_restored_context_input_hash_required')
        self.context_input = context_input; self.context = module(CONTEXT, CONTEXT_SHA)
        self.inverse_mode = inverse
        self.static = module(STATIC, STATIC_SHA) if inverse else None
        self.parts = self.static.query_components() if inverse else self.context.load_components(); self.helpers = self.parts['historicalReadHelpers']
        self.primitives = self.parts['privilegedSourcePrimitives']; self.h = self.primitives['host']
        self.columns = protected(COLUMNS, COLUMNS_SHA).decode().strip()
        self.sql = combined_sql(self.parts['catalogSql'], self.columns)
        self.plan_sha = plan_sha
        self.plan = None if plan_sha is None else validate_plan(self.parts, document(PLAN, plan_sha))
        if self.plan: need(self.plan['contextInputSha256'] == context_input, 'same_actual_context_input_required')
    def query(self, sql, readonly=True):
        sentinel = '/run/yunipals-restored-read-no-password-file'
        need(not os.path.lexists(sentinel), 'absent_peer_password_file_required')
        options = '-c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=40000 -c search_path=pg_catalog'
        if readonly: options += ' -c default_transaction_read_only=on'
        args = ['/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
                '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', '/usr/bin/env', '-i', *[k + '=' + v for k, v in CLEAN.items()],
                'PGPASSFILE=' + sentinel, 'PGOPTIONS=' + options, '/usr/bin/psql', '-XwAtq', '-h', '/var/run/postgresql',
                '-p', '5432', '-U', 'postgres', '-d', 'yunipals_backfill', '-v', 'ON_ERROR_STOP=1']
        result = subprocess.run(args, input=sql.encode(), capture_output=True, env=CLEAN, timeout=60)
        need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 8000000, 'bounded_fixed_local_peer_SQL_ACK_required')
        return [json.loads(row) for row in result.stdout.splitlines() if row.strip()]
    def catalog(self):
        return self.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;' + self.sql + ';ROLLBACK;')[0]
    def runtime(self): return self.context.validate_runtime()
    def consumers(self):
        # This frozen body only reads definitions, effective EnvironmentFiles and actor IDs.
        source = self.context.module(self.context.READ_HELPERS, self.context.READ_HELPERS_SHA)
        peer = types.SimpleNamespace(m=types.SimpleNamespace(run=self.primitives['sdk'].command, protected=self.primitives['sdk'].protected))
        return source.consumer_frame(peer)
    def pack_initial(self):
        p = self.primitives; owner = p['restoreModule'].Owner(p['recoveryModule'], p['sdk'], p['host'], p['ancestorOperation'])
        first = owner.preserved()
        packet = {'actors': first, 'packets': p['host'].pack_packets(), 'boots': p['host'].pack_boots()}
        need(owner.preserved() == first, 'initial_pack_actors_or_serving_changed_during_READ_capture')
        return packet
    def stable(self): return {'runtime': self.runtime(), 'consumers': self.consumers(), 'temporaryPackInitial': self.pack_initial()}


def fresh_plan(host):
    first = host.stable(); baseline = host.context.validate_before_baseline(host.context_input)
    current = host.catalog()
    need(current['read'] == baseline['catalogBefore'] and host.stable() == first,
         'same_post_Arena_RR_catalog_and_restored_source_required')
    plan = copy.deepcopy(host.parts['historicalReadPlan'])
    plan.update({'format': FORMAT + '-plan', 'historicalPlanSha256': HISTORICAL_SHA,
                 'contextOperatorSha256': CONTEXT_SHA, 'contextInputSha256': host.context_input,
                 'contextReviewHash': baseline['reviewHash'], 'arenaAdmission': baseline['arenaAdmission'],
                 'baselineCatalog': current['read'], 'catalogBefore': current,
                 'columnsSqlSha256': COLUMNS_SHA, 'operatorSha256': own_sha(), 'bootId': boot(), 'stable': first})
    plan['planReviewHash'] = sha(encoded(plan)); validate_plan(host.parts, plan)
    return plan


def capture_plan(host, expected):
    value = fresh_plan(host); need(value['planReviewHash'] == expected and not os.path.lexists(INPUT_BASE), 'fresh_exact_new_plan_review_required')
    INPUT_BASE.mkdir(mode=0o700); sync(INPUT_BASE.parent); save(PLAN, value)
    return {'captured': True, 'planSha256': sha(protected(PLAN)), 'newRoles': 0, 'databaseWrites': 0}


def review(host):
    need(host.plan is not None and host.plan['bootId'] == boot() and host.plan['operatorSha256'] == own_sha(), 'same_boot_current_producer_plan_required')
    stable = host.stable(); before = host.catalog()
    need(before == host.plan['catalogBefore'] and stable == host.plan['stable'] and host.stable() == stable, 'exact_fresh_plan_catalog_and_private_actors_required')
    # Repeat Arena source-read qualification immediately before opening this operation.
    need(host.context.arena_admission(host.context.document(host.context.INPUT, host.context_input)['arenaAdmission']) == host.plan['arenaAdmission'],
         'same_actual_Arena_admission_before_READ_operation_required')
    value = {'format': FORMAT, 'operatorSha256': own_sha(), 'bootId': boot(), 'planSha256': host.plan_sha,
             'contextInputSha256': host.context_input, 'stable': stable, 'catalogBefore': before,
             'readEdgeCount': 143, 'loginChanges': 0, 'newDml': 0, 'serviceActions': 0}
    return {**value, 'reviewHash': sha(encoded(value))}


def transaction(host, before, after=None, commit=False, inverse=False):
    need(not commit or after is not None, 'exact_rehearsed_postgraph_required')
    guard = lambda v: "DO $guard$ BEGIN IF (" + host.sql + ') IS DISTINCT FROM ' + literal(json.dumps(v)) + "::jsonb THEN RAISE EXCEPTION 'current_read_catalog_changed'; END IF;END $guard$;"
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';"
            "SET LOCAL idle_in_transaction_session_timeout='40s';DO $lock$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('ypal-restored-read-admission-v1'));END $lock$;" +
            guard(before) + '\n' + '\n'.join(host.helpers.statements(host.plan, inverse)) + '\n' +
            (guard(after) if after is not None else '') + '\n' + host.sql + ';' + ('COMMIT;' if commit else 'ROLLBACK;'))


def records(host):
    before = document(BASE / 'before.json'); rehearsal = document(BASE / 'rehearsed.json')
    need(before['format'] == FORMAT and before['operatorSha256'] == own_sha() and before['bootId'] == boot() and
         before['planSha256'] == host.plan_sha and before['contextInputSha256'] == host.context_input and
         before['reviewHash'] == sha(encoded({k: v for k, v in before.items() if k != 'reviewHash'})) and
         rehearsal['format'] == FORMAT and rehearsal['operatorSha256'] == own_sha() and rehearsal['rehearsed'] is True and
         rehearsal['databaseCommitted'] is False and rehearsal['reviewHash'] == before['reviewHash'] and rehearsal['beforeSha256'] == sha(protected(BASE / 'before.json')),
         'same_owned_actual_READ_rollback_chain_required')
    validate_delta(host.helpers, host.plan, before['catalogBefore'], rehearsal['after'])
    return before, rehearsal


def rehearse(host, expected):
    need(not os.path.lexists(BASE), 'fresh_admission_operation_required'); value = review(host)
    need(value['reviewHash'] == expected, 'fresh_exact_READ_review_required')
    BASE.mkdir(mode=0o700); sync(BASE.parent); save(BASE / 'before.json', value)
    save(BASE / 'rehearsal-intent.json', {'format': FORMAT, 'operatorSha256': own_sha(), 'reviewHash': expected, 'bootId': boot(), 'commitAllowed': False})
    rows = host.query(transaction(host, value['catalogBefore']), False)
    need(len(rows) == 1, 'one_actual_ROLLBACK_catalog_required'); validate_delta(host.helpers, host.plan, value['catalogBefore'], rows[0])
    need(host.catalog() == value['catalogBefore'] and host.stable() == value['stable'], 'actual_rollback_restores_all_catalog_private_runtime_inputs_required')
    result = {'format': FORMAT, 'operatorSha256': own_sha(), 'rehearsed': True, 'databaseCommitted': False,
              'reviewHash': expected, 'beforeSha256': sha(protected(BASE / 'before.json')), 'after': rows[0]}
    save(BASE / 'rehearsed.json', result); return result


def acknowledge(host, reconciled=False):
    before, rehearsal = records(host); intent = document(BASE / 'commit-intent.json')
    need(intent == commit_intent(host, before, rehearsal), 'exact_owned_single_commit_intent_required')
    current = host.catalog(); validate_delta(host.helpers, host.plan, before['catalogBefore'], current)
    need(current == rehearsal['after'] and host.stable() == before['stable'] and host.catalog() == current, 'exact_owned_postgraph_and_unchanged_runtime_required')
    result = {'format': FORMAT, 'operatorSha256': own_sha(), 'admitted': True, 'bootId': boot(), 'planSha256': host.plan_sha,
              'contextInputSha256': host.context_input, 'reviewHash': before['reviewHash'],
              'beforeSha256': sha(protected(BASE / 'before.json')), 'rehearsalSha256': sha(protected(BASE / 'rehearsed.json')),
              'commitIntentSha256': sha(protected(BASE / 'commit-intent.json')), 'catalogAfterSha256': sha(encoded(current)),
              'commitOutcome': 'postgraph_reconciled_after_unknown_ACK' if reconciled else 'commit_confirmed',
              'readEdgeCount': 143, 'loginChanges': 0, 'newDml': 0, 'serviceActions': 0,
              'originalWholeValidatorPassed': False, 'sourceReadinessQualified': False}
    save(BASE / 'result.json', result); return result


def commit_intent(host, before, rehearsal):
    return {'format': FORMAT, 'operatorSha256': own_sha(), 'bootId': boot(), 'planSha256': host.plan_sha,
            'contextInputSha256': host.context_input, 'reviewHash': before['reviewHash'],
            'rehearsalSha256': sha(protected(BASE / 'rehearsed.json')), 'postgraphSha256': sha(encoded(rehearsal['after'])), 'automaticRetryAllowed': False}


def commit(host, expected, authorization):
    before, rehearsal = records(host)
    need(expected == before['reviewHash'] and authorization == sha(encoded(host.helpers.statements(host.plan))), 'separate_exact143_SQL_authorization_required')
    need(not any(os.path.lexists(BASE / n) for n in ['commit-intent.json', 'result.json', 'inverse-intent.json']), 'no_repeat_unknown_read_commit')
    need(host.catalog() == before['catalogBefore'] and host.stable() == before['stable'], 'exact_runtime_and_catalog_before_commit_required')
    save(BASE / 'commit-intent.json', commit_intent(host, before, rehearsal))
    rows = host.query(transaction(host, before['catalogBefore'], rehearsal['after'], True), False)
    need(rows == [rehearsal['after']], 'single_actual_commit_ACK_required'); return acknowledge(host)


def admitted(host, receipt_sha, inverse=False):
    value = document(BASE / 'result.json', receipt_sha); before, rehearsal = records(host)
    need(value['format'] == FORMAT and value['operatorSha256'] == own_sha() and value['admitted'] is True and value['bootId'] == boot() and
         value['readEdgeCount'] == 143 and value['loginChanges'] == value['newDml'] == value['serviceActions'] == 0 and
         value['originalWholeValidatorPassed'] is value['sourceReadinessQualified'] is False and
         value['commitOutcome'] in {'commit_confirmed', 'postgraph_reconciled_after_unknown_ACK'} and
         value['planSha256'] == host.plan_sha and value['contextInputSha256'] == host.context_input and value['reviewHash'] == before['reviewHash'] and
         value['beforeSha256'] == sha(protected(BASE / 'before.json')) and value['rehearsalSha256'] == sha(protected(BASE / 'rehearsed.json')) and
         value['commitIntentSha256'] == sha(protected(BASE / 'commit-intent.json')) and value['catalogAfterSha256'] == sha(encoded(rehearsal['after'])) and
         document(BASE / 'commit-intent.json') == commit_intent(host, before, rehearsal) and
         (inverse or not os.path.lexists(BASE / 'inverse-intent.json')), 'exact_new_unreversed_admission_chain_required')
    return value, before, rehearsal


def admitted_components(receipt_sha):
    value = document(BASE / 'result.json', receipt_sha)
    need(value['format'] == FORMAT and value['operatorSha256'] == own_sha() and pin(value['planSha256']) and pin(value['contextInputSha256']),
         'exact_current_producer_ACK_references_required')
    host = Host(value['contextInputSha256'], value['planSha256'], inverse=True)
    receipt, before, rehearsal = admitted(host, receipt_sha)
    return {'host': host, 'receipt': receipt, 'before': before, 'rehearsal': rehearsal, 'plan': host.plan,
            'reference': {'producerFile': str(Path(__file__).absolute()), 'producerSha256': own_sha(),
                          'resultFile': str(BASE / 'result.json'), 'receiptSha256': receipt_sha,
                          'planSha256': host.plan_sha, 'contextInputSha256': host.context_input}}


def validate_receipt(receipt_sha):
    parts = admitted_components(receipt_sha)
    return {'format': FORMAT, 'validated': True, 'immutableAdmissionOnly': True, **parts['reference'],
            'readEdgeCount': 143, 'currentRoleGraphQualified': False, 'sourceActorQualified': False,
            'sourceReadinessQualified': False, 'originalWholeValidatorPassed': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def validate_catalog_current(receipt_sha):
    parts = admitted_components(receipt_sha); host = parts['host']; expected = parts['rehearsal']['after']
    first = host.catalog()
    need(graph(first) == graph(expected) and graph(host.catalog()) == graph(expected),
         'current143_full_catalog_and_all_grantee_columns_required')
    return {'format': FORMAT, 'validated': True, 'catalogOnly': True, **parts['reference'],
            'catalogSha256': sha(encoded(first)), 'readEdgeCount': 143,
            'sourceActorQualified': False, 'sourceReadinessQualified': False,
            'financialAuthorityQualified': False, 'originalWholeValidatorPassed': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def validate_current(receipt_sha, plan_sha=None, context_input=None):
    if plan_sha is None or context_input is None:
        value = document(BASE / 'result.json', receipt_sha)
        need(value['format'] == FORMAT and value['operatorSha256'] == own_sha(), 'exact_new_READ_reference_required')
        need(plan_sha in {None, value['planSha256']} and context_input in {None, value['contextInputSha256']}, 'explicit_ACK_refs_cannot_conflict')
        plan_sha, context_input = value['planSha256'], value['contextInputSha256']
    host = Host(context_input, plan_sha); value, before, rehearsal = admitted(host, receipt_sha)
    need(graph(host.catalog()) == graph(rehearsal['after']) and host.runtime() == before['stable']['runtime'] and
         graph(host.catalog()) == graph(rehearsal['after']), 'exact_current143_graph_all_column_ACLs_and_source_required')
    return {'format': FORMAT, 'validated': True, 'receiptSha256': receipt_sha, 'operatorSha256': own_sha(),
            'planSha256': plan_sha, 'contextInputSha256': context_input, 'sourceBinding': before['stable']['runtime'],
            'catalogSha256': value['catalogAfterSha256'], 'originalWholeValidatorPassed': False,
            'consumerSelectionsQualified': False, 'temporaryPackActorsQualified': False, 'sourceReadinessQualified': False, 'databaseWrites': 0, 'serviceActions': 0}


def inverse_stable(host, before):
    need(host.consumers() == before['stable']['consumers'], 'same_original_consumer_actors_and_private_files_for_READ_inverse')
    if 'temporaryPackInitial' in before['stable']:
        need(host.pack_initial() == before['stable']['temporaryPackInitial'],
             'initial_temporary_pack_phase_only_inverse_requires_separate_feature_recovery_proof')
    proof = host.static.inverse_source() if getattr(host, 'inverse_mode', False) else host.runtime()
    if getattr(host, 'inverse_mode', False):
        need(proof['validated'] is True and proof['recordedSource'] == before['stable']['runtime']['source'] and
             proof['originalWholeValidatorPassed'] is False and proof['frameworkReadinessQualified'] is False,
             'exact_acknowledged_restored_source_active_or_terminal_inverse_only_required')
    else: need(proof == before['stable']['runtime'], 'same_source_epoch_for_READ_inverse_required')
    return proof


def inverse_review(host, receipt_sha):
    value, before, rehearsal = admitted(host, receipt_sha)
    need(host.catalog() == rehearsal['after'], 'owned_postgraph_runtime_before_inverse_required'); inverse_stable(host, before)
    result = {'format': FORMAT, 'operatorSha256': own_sha(), 'bootId': boot(), 'admissionSha256': receipt_sha,
              'reviewHash': before['reviewHash'], 'planSha256': host.plan_sha, 'catalogAfterSha256': value['catalogAfterSha256']}
    return {**result, 'inverseReviewHash': sha(encoded(result))}


def inverse_ack(host, intent, reconciled=False):
    value, before, _ = admitted(host, intent['admissionSha256'], True)
    need(intent['format'] == FORMAT and intent['operatorSha256'] == own_sha() and intent['bootId'] == boot() and
         intent['planSha256'] == host.plan_sha and intent['reviewHash'] == before['reviewHash'] and intent['catalogAfterSha256'] == value['catalogAfterSha256'] and
         intent['inverseReviewHash'] == sha(encoded({k: v for k, v in intent.items() if k != 'inverseReviewHash'})), 'exact_owned_inverse_intent_chain_required')
    need(host.catalog() == before['catalogBefore'], 'exact_all_column_roles_private_runtime_restored_required'); source = inverse_stable(host, before)
    result = {'format': FORMAT, 'operatorSha256': own_sha(), 'inversed': True, 'admissionSha256': intent['admissionSha256'],
              'inverseReviewHash': intent['inverseReviewHash'], 'catalogRestored': True, 'onlyOwnedReadEdgesRemoved': True,
              'reconciledAfterUnknownAck': reconciled, 'inverseSourceProof': source, 'loginChanges': 0, 'serviceActions': 0}
    save(BASE / 'inverse-result.json', result); return result


def inverse(host, receipt_sha, expected):
    intent = inverse_review(host, receipt_sha)
    need(intent['inverseReviewHash'] == expected and not os.path.lexists(BASE / 'inverse-intent.json'), 'one_exact_inverse_attempt_required')
    save(BASE / 'inverse-intent.json', intent); _, before, rehearsal = admitted(host, receipt_sha, True)
    need(host.query(transaction(host, rehearsal['after'], before['catalogBefore'], True, True), False) == [before['catalogBefore']], 'owned_inverse_commit_ACK_required')
    return inverse_ack(host, intent)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--context-input', required=True); parser.add_argument('--plan-sha')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--capture-plan'); group.add_argument('--rehearse'); group.add_argument('--commit', nargs=2, metavar=('REVIEW', 'SQL_AUTH_SHA'))
    group.add_argument('--reconcile'); group.add_argument('--validate'); group.add_argument('--inverse-review')
    group.add_argument('--inverse', nargs=2); group.add_argument('--reconcile-inverse'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_read_admission_expired')); signal.alarm(300)
    host = Host(args.context_input, args.plan_sha, bool(args.inverse or args.inverse_review or args.reconcile_inverse))
    with host.primitives['sdk'].lock():
        if args.capture_plan: result = capture_plan(host, args.capture_plan)
        elif args.validate: result = validate_current(args.validate, args.plan_sha, args.context_input)
        elif args.reconcile_inverse: result = inverse_ack(host, document(BASE / 'inverse-intent.json', args.reconcile_inverse), True)
        elif args.inverse: result = inverse(host, *args.inverse)
        elif args.inverse_review: result = inverse_review(host, args.inverse_review)
        elif args.reconcile:
            document(BASE / 'commit-intent.json', args.reconcile); need(not os.path.lexists(BASE / 'result.json'), 'no_existing_ACK_to_reconcile')
            result = acknowledge(host, True)
        elif args.commit: result = commit(host, *args.commit)
        elif args.rehearse: result = rehearse(host, args.rehearse)
        else: result = fresh_plan(host) if args.plan_sha is None else review(host)
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__, 'automaticRetryAllowed': False})); raise SystemExit(1)
