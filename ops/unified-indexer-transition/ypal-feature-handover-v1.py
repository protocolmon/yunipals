#!/usr/bin/env python3
"""Fresh YPAL feature handover. Default review is read-only; every effect is explicit.

This owner acknowledges eight new SELECTs, a public reader overlay, and a later
independently witnessed temporary-source retirement. Historical whole validators
are intentionally not reported passed after the owned feature transition.
"""
import argparse
import copy
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import socket
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-ypal-feature-handover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-feature-handover-v1-20261024')
INPUT = Path('/var/backups/yunipals-ypal-feature-handover-input-v1-20261024/config.json')
MANIFEST = OPS / 'ypal-feature-handover-v1.manifest.json'
PARITY_BASE = Path('/var/backups/yunipals-ypal-booster-source-parity-v1-20261024')
FRESH = 'yunipals_boosters_ypal_v1'
TARGET = 'unified_ypal_20261023_v1'
FRESH_BUILD = '8e88ea2e00'
BUILD = '71e2a7f3b7'
FRESH_OID, TARGET_OID, WRITER_OID, ROLE_OID = '75837058', '75963410', '73004621', '73187672'
ROLE = 'yunipals_unified_collector'
WRITER_ROLE = 'yunipals_unified_shadow'
API, QUEUE, TIMER = 'yunipals-booster-api.service', 'yunipals-booster-artwork-queue.service', 'yunipals-booster-artwork-queue.timer'
SOURCE, COMBINED = 'yunipals-booster-ypal-source.service', 'yunipals-ypal-combined-source.service'
PUBLIC = 'https://api.yunipals.com/yunipals-indexer'
SELECTOR = Path('/etc/yunipals-unified/booster-ypal-combined.public.env')
DROPS = {u: Path('/etc/systemd/system') / (u + '.d/97-ypal-combined.conf') for u in (API, QUEUE)}
BOOT = Path('/etc/systemd/system/multi-user.target.wants') / SOURCE
SELECTOR_BYTES = ('BOOSTER_DATABASE_SCHEMA=' + TARGET + '\n').encode()
DROP_BYTES = ('[Service]\nEnvironmentFile=' + str(SELECTOR) + '\n').encode()
EIGHT = tuple(sorted(['booster_type', 'booster_original', 'booster_request', 'booster_monster', 'booster_refund', 'booster_engine_state', 'booster_checkpoint', 'booster_event']))
TARGET_OIDS = {'_ponder_meta': '75963411', '_ponder_checkpoint': '75963418', 'booster_type': '75963501', 'booster_original': '75963516', 'booster_request': '75963531', 'booster_monster': '75963546', 'booster_refund': '75963561', 'booster_engine_state': '75963576', 'booster_event': '75963591', 'booster_checkpoint': '75963606'}
SOURCE_ACK = '581990e80baa6ae074786b7b2cf7c771c82ebe046253a1de23a96f251d900efd'
FINAL_ACK = '9bf720f7d669b1863184db4214602a16346f7913d6d2fbdcd4090a42c1ba6e1c'
API_BOOT_ACK = '30fabaf05eb34e9b39c513457abf178996deeab72941bc9df9850e5c4ab423a3'
COMBINED_ACK = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
COMBINED_OP = 'a80ce9cca2da0dd5e40958db16e65f46e82ea859e861cfb110407e4bf93b9336'
FIXED = {
 'ypal-reader-cutover-v1.py': (Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py'), 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8'),
 'ypal-combined-release-register-v1.py': (OPS / 'ypal-combined-release-register-v1.py', 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d'),
 'ypal-combined-read-admission-v2.py': (OPS / 'ypal-combined-read-admission-v2.py', 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'),
 'ypal-cache-guard-owner-v1.py': (OPS / 'ypal-cache-guard-owner-v1.py', 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba')}
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def literal(v): return "'" + str(v).replace("'", "''") + "'"
def pin(v): return isinstance(v, str) and re.fullmatch('[a-f0-9]{64}', v) is not None


def protected(path, cap=4_000_000):
    path = Path(path); need(path.is_absolute() and '..' not in path.parts, 'absolute_owner_input_required')
    for p in [*reversed(path.parents), path]:
        s = p.lstat(); need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_feature_input_required')
    s = path.stat(); need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= cap, 'bounded_single_link_owner_input_required')
    raw = path.read_bytes(); need(identity(s) == identity(path.stat()), 'owner_input_changed_during_read'); return raw


def identity(s): return {k: getattr(s, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns')}
def document(p, digest=None):
    raw = protected(p); need(digest is None or sha(raw) == digest, 'exact_feature_receipt_required'); return json.loads(raw)
def sync(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
def save(p, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, mode)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), mode); f.write(raw); f.flush(); os.fsync(f.fileno())
    sync(p.parent); return sha(raw)
def load_fixed(name):
    path, digest = FIXED[name]; return module(path, digest)
def module(path, digest):
    need(pin(digest), 'externally_frozen_dependency_pin_required'); raw = protected(path); need(sha(raw) == digest, 'frozen_feature_dependency_required')
    m = types.ModuleType(Path(path).stem); m.__file__ = str(path); exec(compile(raw, str(path), 'exec'), m.__dict__)
    need(sha(protected(path)) == digest, 'feature_dependency_changed_during_load'); return m


def owned_file(path, record):
    need(str(path) == record['path'] and identity(path.lstat()) == record['identity'] and sha(protected(path)) == record['sha256'], 'owned_feature_file_inode_and_bytes_required')


def create_file(path, raw):
    save(path, raw, 0o644)
    record = {'path': str(path), 'identity': identity(path.lstat()), 'sha256': sha(raw)}
    save(BASE / ('published-' + sha(str(path).encode())[:12] + '.json'), record)
    return record


def complete(point):
    need(isinstance(point, str) and re.fullmatch('[0-9]{75}', point) and int(point[10:26]) == 8453, 'complete_Base_native_checkpoint_required')
    raw = int(point[26:42]); number = raw if point[42:] == '9' * 33 else raw - 1
    need(number > 0, 'positive_completed_Base_block_required')
    return number, int(point[:10])


def validate_native(value, schema, build, minimum=0, require_framework=False):
    app, point, clock = value['app'], value['checkpoint'], int(value['clock'])
    number, moment = complete(point)
    need(value['schemaOid'] == (TARGET_OID if schema == TARGET else FRESH_OID) and value['owner'] == WRITER_OID and
         app['build_id'] == build and str(app['version']) == '6' and str(app['is_dev']) == '0' and str(app['is_locked']) == '1' and
         (not require_framework or str(app['is_ready']) == '1') and 0 <= clock - int(app['heartbeat_at']) <= 180000 and
         number >= minimum and 0 <= clock - moment * 1000 <= 180000, 'fresh_Base_runtime_and_complete_prefix_required')
    need(value['badAddresses'] is False, 'only_actual_fresh_YPAL_contract_events_required')
    return {'schema': schema, 'schemaOid': value['schemaOid'], 'buildId': build, 'completeBlock': number, 'timestamp': moment,
            'frameworkReady': str(app['is_ready']) == '1', 'BaseScopedReady': True}


def after_eight(before, remove=False):
    after = copy.deepcopy(before); base = after['baseline']
    for row in after['target']['tables']:
        if row['name'] not in EIGHT: continue
        need(not any(e['grantee'] == ROLE_OID and e['privilege'] == 'SELECT' for col in row['columnAcl'] for e in col['acl']), 'overlapping_preexisting_collector_column_SELECT_requires_separate_review')
        edge = {'grantee': ROLE_OID, 'grantor': WRITER_OID, 'privilege': 'SELECT', 'grantable': False}
        direct = {'kind': 'relation', 'object': row['oid'], 'grantor': WRITER_OID, 'privilege': 'SELECT', 'grantable': False}
        need(row['select'] is remove, 'exact_eight_read_prestate_required')
        row['select'] = not remove
        if remove:
            need(row['acl'].count(edge) == base['edges'].count(direct) == 1, 'exact_owned_eight_edges_required')
            row['acl'].remove(edge); base['edges'].remove(direct)
        else:
            need(edge not in row['acl'] and direct not in base['edges'], 'new_eight_edges_must_not_preexist')
            row['acl'].append(edge); base['edges'].append(direct)
        row['acl'].sort(key=lambda x: (x['grantee'], x['grantor'], x['privilege'], x['grantable']))
    base['edges'].sort(key=lambda x: (x['kind'], x['object'], x['grantor'], x['privilege'], x['grantable']))
    return after


def validate_catalog(value, expected_baseline, admitted):
    need(value['baseline'] == expected_baseline, 'full_acknowledged_collector_graph_required')
    target = value['target']; need(target['schemaOid'] == TARGET_OID and target['owner'] == WRITER_OID and target['usage'] is True and target['create'] is False, '143_schema_USAGE_must_preexist')
    need({r['name']: r['oid'] for r in target['tables']} == TARGET_OIDS, 'exact_ten_native_OIDs_required')
    for row in target['tables']:
        need(row['columnWrites'] is False and isinstance(row['columnAcl'], list) and not any(e['grantee'] == ROLE_OID and e['privilege'] in {'INSERT', 'UPDATE', 'REFERENCES'} for col in row['columnAcl'] for e in col['acl']), 'collector_column_writes_not_allowed')
        if not admitted and row['name'] in EIGHT:
            need(not any(e['grantee'] == ROLE_OID and e['privilege'] == 'SELECT' for col in row['columnAcl'] for e in col['acl']), 'overlapping_preexisting_collector_column_SELECT_requires_separate_review')
        need(row['owner'] == WRITER_OID and row['kind'] == 'r' and row['rls'] is False and row['forceRls'] is False and row['writes'] is False and
             row['select'] is (admitted or row['name'] not in EIGHT), 'only_eight_new_native_SELECTs_required')
    return value


def grant_sql(before, after, query, commit=False, inverse=False):
    need(after == after_eight(before, inverse), 'exact_eight_delta_required')
    return ("BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';"
            "SELECT pg_advisory_xact_lock(17928000,2401);\n" +
            'DO $feature$ BEGIN IF (' + query + ') IS DISTINCT FROM ' + literal(json.dumps(before)) + "::jsonb THEN RAISE EXCEPTION 'feature_catalog_CAS';END IF;END $feature$;\n" +
            'SET LOCAL ROLE ' + WRITER_ROLE + ';\n' + '\n'.join(('REVOKE SELECT ON TABLE ' if inverse else 'GRANT SELECT ON TABLE ') + TARGET + '.' + n + (' FROM ' if inverse else ' TO ') + ROLE + ';' for n in EIGHT) +
            '\nRESET ROLE;\nDO $feature$ BEGIN IF (' + query + ') IS DISTINCT FROM ' + literal(json.dumps(after)) + "::jsonb THEN RAISE EXCEPTION 'feature_catalog_after_CAS';END IF;END $feature$;\n" +
            ('COMMIT;\n' if commit else 'ROLLBACK;\n'))


def retained_proxy_frame(m, a, acknowledged):
    """Reperform only the five unchanged proxy leaves, not old API/source gates."""
    names = [*(a.old_unit(c) for c in a.CHAINS), a.YPAL_UNITS[0]]
    result = {}
    for name in names:
        state = a.state(m, name)
        chain = next((c for c in a.CHAINS if name == a.old_unit(c)), None)
        files, _ = a.definition(m, state, chain)
        expected = dict(line.split('=', 1) for line in m.env_bytes().decode().splitlines()) if name == a.YPAL_UNITS[0] else None
        actor = a.live_actor(m, state, expected)
        stable = [k for k in state if k not in {'ExecStart', 'Environment', 'EnvironmentFiles'}]
        after = a.state(m, name)
        need(all(after[k] == state[k] for k in stable), 'retained_proxy_changed_during_read')
        current = {**files, 'actor': actor, 'settings': {k: state[k] for k in stable},
                   'environmentPropertySha256': sha(state['Environment'].encode()),
                   'environmentFilesPropertySha256': sha(state['EnvironmentFiles'].encode())}
        need(current == acknowledged[name], 'unchanged_old_four_and_YPAL19212_proxy_leaf_required')
        result[name] = current
    rpc_boot = acknowledged['acceptedYpal']['rpcBoot']
    need(rpc_boot['path'] == str(m.BOOT_LINK), 'same_accepted_YPAL19212_boot_path_required')
    a.check_link(m.BOOT_LINK, rpc_boot)
    return result


class Host:
    def __init__(self, manifest_pin, input_pin, canonical_ref=None, capture_id=None):
        self.manifest = document(MANIFEST, manifest_pin)
        need(self.manifest['format'] == 'yunipals-ypal-feature-code-v1' and
             set(self.manifest['files']) == {'ypal-feature-handover-v1.py', 'ypal-booster-source-parity-v1.py'} and
             self.manifest['files']['ypal-feature-handover-v1.py'] == sha(protected(Path(__file__).absolute())), 'exact_external_feature_code_manifest_required')
        self.config = document(INPUT, input_pin)
        need(set(self.config) == {'readAdmissionSha256', 'cachePreparedSha256'} and all(pin(v) for v in self.config.values()), 'actual_future_read_and_cache_ACKs_required')
        self.reader = load_fixed('ypal-reader-cutover-v1.py'); self.old = self.reader.Host(SOURCE_ACK)
        self.reg = load_fixed('ypal-combined-release-register-v1.py'); self.s, self.h, self.op, self.source_ack = self.reg.load()
        need(sha(protected(self.s.BASE / 'result.json')) == COMBINED_ACK and sha(protected(self.s.BASE / 'operation.json')) == COMBINED_OP, 'same_actual_c96_combined_source_operation_required')
        self.read = load_fixed('ypal-combined-read-admission-v2.py'); self.cache = load_fixed('ypal-cache-guard-owner-v1.py')
        self.parity = module(OPS / 'ypal-booster-source-parity-v1.py', self.manifest['files']['ypal-booster-source-parity-v1.py'])
        self.manifest_pin, self.input_pin = manifest_pin, input_pin
        self.canonical_ref, self.capture_id = canonical_ref, capture_id
        self.inverse_mode = False
        self.first_effect_deadline = None

    def query(self, sql): return self.old.query(sql)
    def state(self, unit):
        need(unit in {API, QUEUE, TIMER, SOURCE, COMBINED}, 'only_fixed_feature_and_source_units_required')
        keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'FragmentPath', 'DropInPaths', 'Job', 'UnitFileState', 'WantedBy', 'RequiredBy', 'UpheldBy', 'TriggeredBy', 'Triggers', 'PartOf']
        if unit != TIMER: keys += ['MainPID', 'ControlPID', 'InvocationID', 'ExecMainStartTimestampMonotonic', 'User', 'Group', 'WorkingDirectory', 'ExecStart', 'NRestarts']
        raw = self.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]], 8)
        state = dict(line.split('=', 1) for line in raw.splitlines())
        need(set(state) == set(keys) and state['Id'] == unit and state['LoadState'] == 'loaded', 'complete_loaded_feature_manager_state_required')
        return state
    def run(self, argv, timeout=30): return self.old.core.run(argv, timeout)

    def baseline(self):
        view, r, s, h, op, ack, p, sql = self.read.load()
        receipt, before, rehearsal = self.read.admitted(s, self.config['readAdmissionSha256'])
        need(receipt['readEdgeCount'] == 143, 'actual_143_READ_ACK_required')
        prepared = document(self.cache.BASE / 'prepared.json', self.config['cachePreparedSha256'])
        saved = document(self.cache.BASE / 'sql-committed.json', prepared['additionalReadAcknowledgementSha256'])
        need(prepared['prepared'] is True and prepared['operatorSha256'] == FIXED['ypal-cache-guard-owner-v1.py'][1] and
             saved['operatorSha256'] == prepared['operatorSha256'] and saved['bootId'] == prepared['bootId'] == boot() and
             saved['readAdmissionSha256'] == self.config['readAdmissionSha256'] and
             saved['commitIntentSha256'] == sha(protected(self.cache.BASE / 'sql-intent.json')) and
             saved['preparedSha256'] == sha(protected(self.cache.BASE / 'sql-prepared.json')) and saved['mode'] == 'apply' and
             saved['result']['committed'] is True and saved['xid'] == document(self.cache.BASE / 'sql-prepared.json')['xid'], 'actual_owned_cache_four_READ_commit_chain_required')
        combined = self.cache.extended_plan(p, saved['result'])
        self.cache.read_extension(rehearsal['after'], saved['postProof']['catalog'], saved['result'], saved['postProof']['catalog'])
        self.read.validate_reader_delta(combined, before['readerBefore'], saved['postProof']['reader'])
        return saved['postProof']['reader']

    def catalog_sql(self):
        names = ','.join(literal(n) for n in TARGET_OIDS)
        return "SELECT jsonb_build_object('baseline',(" + self.reader.catalog_sql() + "),'target',jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + TARGET + "'),'owner',(SELECT nspowner::text FROM pg_namespace WHERE nspname='" + TARGET + "'),'usage',has_schema_privilege('" + ROLE + "','" + TARGET + "','USAGE'),'create',has_schema_privilege('" + ROLE + "','" + TARGET + "','CREATE'),'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'columnWrites',has_any_column_privilege('" + ROLE + "',c.oid,'INSERT,UPDATE,REFERENCES'),'columnAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('number',col.attnum,'name',col.attname,'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',ce.grantee::text,'grantor',ce.grantor::text,'privilege',ce.privilege_type,'grantable',ce.is_grantable)ORDER BY ce.grantee,ce.grantor,ce.privilege_type,ce.is_grantable),'[]'::jsonb)FROM aclexplode(col.attacl)ce))ORDER BY col.attnum),'[]'::jsonb)FROM pg_attribute col WHERE col.attrelid=c.oid AND col.attnum>0 AND NOT col.attisdropped AND col.attacl IS NOT NULL),'select',has_table_privilege('" + ROLE + "',c.oid,'SELECT'),'writes',has_table_privilege('" + ROLE + "',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a))ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + TARGET + "'AND c.relname IN(" + names + '))))'

    def catalog(self): return self.query(self.catalog_sql())

    def old_inputs(self):
        ack = document(self.reader.BASE / 'finalization-v2-result.json', FINAL_ACK)
        need(ack['completed'] is True and ack['sourceReceiptSha256'] == SOURCE_ACK and ack['originalOperatorSha256'] == FIXED['ypal-reader-cutover-v1.py'][1], 'actual_finalized_fresh_YPAL_readers_required')
        for record in ack['published']: self.reader.owned_overlay(record)
        enabled = document(Path('/var/backups/yunipals-ypal-api-enable-boot-v1-20261023/result.json'), API_BOOT_ACK)
        link = Path('/etc/systemd/system/multi-user.target.wants') / API
        need(enabled['format'] == 'yunipals-ypal-api-enable-boot-v1' and enabled['completed'] is True and enabled['bootId'] == boot() and
             enabled['operatorSha256'] == '2612b0f8730f3a70eae3b5bbd848424934ec7bda4f28a23cab5ab547f25429f9' and
             enabled['finalizationSha256'] == FINAL_ACK and enabled['link'] == str(link) and
             self.reader.identity(link.lstat()) == enabled['linkIdentity'] and os.readlink(link) == '/etc/systemd/system/' + API,
             'same_actual_30fa_API_boot_receipt_and_inode_required')
        # Read the already accepted public candidates directly; old.inputs()
        # deliberately calls an obsolete whole-source preservation predicate.
        prepared = self.reader.document(self.reader.PREPARED / 'result.json')
        operation = self.reader.document(self.reader.PREPARED / 'operation.json', prepared['operationSha256'])
        raw = protected(self.reader.PUBLIC_ENV)
        need(sha(raw) == 'a1b21174e5629ff750370a6a613212486687f1b4b3b3f002ab48137ca3e521eb', 'same_existing_95_public_environment_required')
        values = dict(line.split('=', 1) for line in raw.decode().splitlines())
        need(values['BOOSTER_DATABASE_SCHEMA'] == FRESH and values['BOOSTER_ARTWORK_CATALOGS'] == 'base-mainnet-standard-v1', 'fresh_only_existing_reader_scope_required')
        for path, digest in operation['snapshot']['privateInputHashes'].items(): need(self.old.h.observer.file_pin(path) == digest, 'unchanged_original_private_reader_inputs_required')
        return {'finalizerSha256': FINAL_ACK, 'sourceSha256': SOURCE_ACK, 'publications': ack['published'], 'privateInputHashes': operation['snapshot']['privateInputHashes'], 'apiBootReceiptSha256': API_BOOT_ACK, 'apiBootIdentity': enabled['linkIdentity'], 'values': values}

    def definitions(self, selected=False):
        old = self.old_inputs(); result = {}
        for unit, digest in self.reader.UNIT_PINS.items():
            state = self.state(unit); path = Path('/etc/systemd/system') / unit
            expected = [str(self.reader.DROPS[unit])] if unit in self.reader.DROPS else []
            if selected and unit in DROPS: expected.append(str(DROPS[unit]))
            need(state['FragmentPath'] == str(path) and sha(protected(path)) == digest and state['DropInPaths'].split() == expected and
                 (unit == TIMER or state['User'] == state['Group'] == ROLE), 'exact_95_plus_owned_97_definitions_required')
            if unit == API: need(state['UnitFileState'] == 'enabled' and state['WantedBy'] == 'multi-user.target', 'same_API_boot_enablement_required')
            if unit != TIMER:
                args = [shlex.split(line.split('=', 1)[1]) for line in protected(path).decode().splitlines() if line.startswith('ExecStart=')]
                need(args == [shlex.split(v) for v in re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart'])] and len(args) == 1, 'unchanged_41fe_e2b_commands_required')
            result[unit] = {'definitionSha256': digest, 'dropins': expected, 'workingDirectory': state.get('WorkingDirectory', '')}
        for digest, name in [(self.reader.API_SHA, 'booster-api.mjs'), (self.reader.QUEUE_SHA, 'booster-artwork-sync.mjs')]:
            need(sha(protected(Path('/opt/yunipals-unified/booster-api-releases') / digest / name)) == digest, 'same_feature_artifacts_required')
        if selected:
            for p in [SELECTOR, *DROPS.values()]: owned_file(p, document(BASE / ('published-' + sha(str(p).encode())[:12] + '.json')))
        return {'definitions': result, 'privateInputHashes': old['privateInputHashes'], 'oldPublications': old['publications']}

    def actor(self, selected=False):
        self.definitions(selected)
        values = self.old_inputs()['values'] | {'BOOSTER_DATABASE_SCHEMA': TARGET if selected else FRESH}
        return self.old.actor(API, values)

    def combined(self):
        self.s.static_inputs(self.h); self.s.old_private_inputs(self.op)
        need(self.s.base_code() == self.op['sourceCode'] and self.h.role() == self.op['sourceRole'], 'same_combined_code_and_writer_role_required')
        self.h.old_terminal(self.op); self.h.preserved_old_native(self.op)
        state = self.h.state(self.s.NEW)
        if getattr(self, 'inverse_mode', False) and state['MainPID'] == '0':
            need(state['ControlPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'} and state['Job'] in {'', '0'} and
                 state['FragmentPath'] == str(self.s.UNIT) and not state['DropInPaths'] and self.h.files(state) == {str(self.s.UNIT): self.s.TEMPLATE_SHA},
                 'inverse_requires_exact_owned_terminal_combined_definition')
            group = Path('/sys/fs/cgroup/system.slice') / COMBINED / 'cgroup.procs'
            need((not group.exists() or not group.read_text().split()) and all(not Path('/proc', str(v['pid'])).exists() for v in self.source_ack['source']['processes']), 'inverse_combined_terminal_without_surviving_owned_processes_required')
            native = self.h.native()
            need(native['schemaOid'] == TARGET_OID and native['app']['build_id'] == BUILD and native['tables'] == self.source_ack['native']['tables'], 'inverse_exact_combined_native_catalog_required')
            actor = {'inverseOnly': True, 'terminal': True, 'acknowledgedSourceReceiptSha256': COMBINED_ACK, 'schemaOid': TARGET_OID, 'buildId': BUILD}
        else:
            actor = self.s.new_owned(self.h, self.op)
            need(actor == self.source_ack['source'], 'same_acknowledged_combined_actor_required')
        self.s.exact_link(self.s.NEW_LINK, self.source_ack['newBoot'])
        route = self.h.m.route_owner; before = self.h.m.load('before.json'); binding = before['binding']
        need(binding['operatorSha256'] == sha(protected(Path(route.__file__))) and binding['bootId'] == boot() and
             binding['inputs'] == self.h.rpc.inputs(self.h.m, route) and
             {c: route.plan(self.h.m, c)[0] for c in route.CHAINS} == binding['plans'], 'same_acknowledged_free_route_inputs_required')
        retained_proxy_frame(self.h.m, route, binding['retained'])
        routes = document(route.BASE / 'result.json', self.source_ack['rpcResultSha256'])
        need(routes['completed'] is True and routes['operatorSha256'] == binding['operatorSha256'] and
             routes['bootId'] == boot() and not (route.BASE / 'restore-intent.json').exists(), 'unreversed_actual_free_route_ACK_required')
        need(time.time() < datetime.datetime.fromisoformat(route.EXPIRY.replace('Z', '+00:00')).timestamp(), 'existing_free_profile_expiry_must_not_be_extended_or_expired')
        route.exact_catalog(self.h.m, route.catalog(self.h.m), before['catalog'], True)
        need({c: route.owned(self.h.m, c, before) for c in route.CHAINS} == routes['routes'], 'same_four_owned_combined_proxies_required')
        for c in route.CHAINS: self.h.m.check_published(c + '-boot')
        capacity = self.h.rpc.capacity_snapshot(self.h.m)
        need({k: capacity[k] for k in binding['budgetCapacityIdentity']} == binding['budgetCapacityIdentity'], 'unchanged_financial_budget_identity_required')
        return actor

    def native(self, schema, build, minimum=0, framework=False):
        d = self.old_inputs()['values']; addresses = [d[k] for k in ('BOOSTER_REGISTRY', 'BOOSTER_ENGINE', 'BOOSTER_MONSTERS')]
        value = self.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + schema + "'),'owner',(SELECT nspowner::text FROM pg_namespace WHERE nspname='" + schema + "'),'app',(SELECT value FROM " + schema + "._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM " + schema + "._ponder_checkpoint WHERE chain_id=8453),'clock',floor(extract(epoch FROM statement_timestamp())*1000)::bigint,'badAddresses',EXISTS(SELECT 1 FROM " + schema + '.booster_event WHERE address NOT IN(' + ','.join(literal(a) for a in addresses) + ')))')
        return validate_native(value, schema, build, minimum, framework)

    def parity_current(self, result_pin):
        need(self.canonical_ref is not None and re.fullmatch('[a-z][a-z0-9-]{0,47}', self.capture_id or ''), 'explicit_named_capture_and_fresh_canonical_input_required')
        header_path, header_pin = self.canonical_ref
        header_path = Path(header_path)
        need(header_path.parent == INPUT.parent and header_path.name == 'canonical-' + header_pin[:16] + '.json' and pin(header_pin), 'fixed_protected_canonical_data_path_required')
        header = document(header_path, header_pin)
        value = self.parity.validate_current_prefix(result_pin, header, capture_id=self.capture_id)
        need(value.get('validated') is True and value.get('currentPrefixUnchanged') is True and value.get('currentCanonicalInputQualified') is True, 'actual_current_named_prefix_and_external_header_input_required')
        return {**value, 'captureId': self.capture_id, 'canonicalFile': str(header_path), 'canonicalFileSha256': header_pin}

    def source_actor(self, expected=None):
        owner = self.old.source_owner; m = owner.prepare_module(); h = owner.Host(m)
        acknowledged = document(owner.BASE / 'result.json', SOURCE_ACK)
        binding = document(owner.BASE / 'operation.json', acknowledged['operationSha256'])
        need(binding['operatorSha256'] == self.reader.SOURCE_START_SHA and binding['bootId'] == boot() and
             not (owner.BASE / 'inverse-intent.json').exists(), 'original_581_eef_unchanged_source_inputs_required')
        actor = h.fresh_actor(binding)
        need(owner.actor_identity(actor) == owner.actor_identity(expected or acknowledged['source']), 'exact_acknowledged_temporary_source_actor_required')
        return actor

    def restart_temporary_source(self, intent, original):
        self.terminal(SOURCE); self.source_activation(); self.manager('start', SOURCE)
        owner = self.old.source_owner; m = owner.prepare_module(); h = owner.Host(m)
        ack = document(owner.BASE / 'result.json', SOURCE_ACK)
        binding = document(owner.BASE / 'operation.json', ack['operationSha256'])
        def observed():
            actor = h.fresh_actor(binding)
            start = intent['monotonicUs'] * os.sysconf('SC_CLK_TCK') // 1_000_000
            need(actor['invocation'] != original['invocation'] and 0 <= actor['startTicks'] - start <= 45 * os.sysconf('SC_CLK_TCK'), 'restored_source_must_follow_owned_start_intent')
            return actor
        return wait_read(observed, 'restored_owned_YPAL_source_not_running')

    def source_activation(self, retired=False):
        state = self.state(SOURCE)
        need(state['FragmentPath'] == '/etc/systemd/system/' + SOURCE and not state['DropInPaths'] and
             sha(protected(state['FragmentPath'])) == 'f8feeea70910943737605a88a06534993e82f5a92bec1b9fbe5188f8f65eae7e', 'same_owned_temporary_source_definition_required')
        fields = ['WantedBy', 'RequiredBy', 'UpheldBy', 'TriggeredBy', 'Triggers', 'PartOf']
        need(all(not state.get(k) for k in fields if k != 'WantedBy') and state.get('WantedBy') in ({'', None} if retired else {'multi-user.target'}), 'no_other_scanner_activation_authority_allowed')
        paths = []
        for directory in ('/etc/systemd/system', '/run/systemd/system'):
            for p in Path(directory).glob('*/*'):
                if p.name == SOURCE or (p.is_symlink() and p.resolve(strict=False) == Path(state['FragmentPath'])): paths.append(str(p))
        need(sorted(paths) == ([] if retired else [str(BOOT)]), 'all_owned_scanner_restart_paths_accounted_for')
        return state

    def manager(self, action, unit=None, expected=None):
        need((action == 'daemon-reload' and unit is None) or (action in {'start', 'stop'} and unit in {API, QUEUE, TIMER, SOURCE}), 'fixed_feature_only_manager_actions')
        self.old_inputs(); self.combined()
        if (BASE / 'admitted.json').exists(): need(self.catalog() == document(BASE / 'operation.json')['catalogAfter'], 'same_owned_read_graph_at_service_boundary')
        if expected is not None:
            current = self.state(unit)
            need(all(current.get(k) == expected.get(k) for k in ['Id', 'MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic']), 'exact_actor_immediately_before_manager_command')
        if getattr(self, 'first_effect_deadline', None) is not None:
            need(time.time() <= self.first_effect_deadline, 'fresh_canonical_deadline_expired_before_first_service_effect')
            self.first_effect_deadline = None
        r = subprocess.run(['/usr/bin/systemctl', action, *([unit] if unit else [])], env=CLEAN, capture_output=True, timeout=60)
        need(r.returncode == 0 and not r.stdout and not r.stderr, 'manager_ACK_unknown_inspect_not_repeat')

    def terminal(self, unit):
        s = self.state(unit); need((unit == TIMER or s['MainPID'] == s['ControlPID'] == '0') and s['ActiveState'] in {'inactive', 'failed'} and s['Job'] in {'', '0'}, 'feature_owned_unit_must_be_terminal')
        p = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'; need(not p.exists() or not p.read_text().split(), 'feature_unit_cgroup_must_be_empty')
        return {'unit': unit, 'terminal': True}

    def availability(self, minimum, build):
        # Frozen actual reader checks fresh YPAL identity, types/global/recent/art.
        # This new wrapper additionally binds its current native build/prefix.
        deployment = document(self.reader.INPUT / 'confirmed.json', '3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c')
        for public in (False, True):
            for path in ['/v1/boosters/types', '/v1/boosters/monsters?limit=24', '/v1/boosters/recent-openings?limit=12']:
                status, body = self.old.request(path, public)
                need(status == 200 and body['engine'] == deployment['engine'].lower() and body['collection'] == deployment['monsters'].lower() and body['enabled'] is True and body['buildId'] == build and int(body['indexedBlock']) >= minimum, 'actual_selected_fresh_feature_pages_required')
                if path.endswith('/types'):
                    need(len(body['items']) == 1 and body['items'][0]['packTypeId'] == '1' and body['items'][0]['paymentToken'] == deployment['ypal'].lower() and body['items'][0]['catalogHash'] == deployment['catalogHash'], 'same_unlimited_one_YPAL_type_required')
                for row in body['items']:
                    if 'collection' in row: need(row['collection'] == deployment['monsters'].lower(), 'no_old_collection_rows')
                    if 'monster' in row:
                        need(row['monster']['collection'] == deployment['monsters'].lower() and
                             row['requestKey'].startswith('8453:' + deployment['engine'].lower() + ':'), 'no_old_recent_request_or_collection_rows')
        status, artwork = self.old.request('/v1/boosters/art/base-mainnet-standard-v1/81.json', True)
        need(status == 200 and artwork.get('yunipals', {}).get('status') == 'ready' and artwork['yunipals'].get('variantId') == 81 and
             re.fullmatch(re.escape(PUBLIC) + r'/v1/boosters/art-assets/[a-f0-9]{64}\.png', artwork.get('image', '')),
             'same_approved_standard_art_resource_required')
        status, ready = self.old.request('/readyz')
        need(status == 200 and ready['ready'] is True and ready['buildId'] == build and int(ready['indexedBlock']) >= minimum, 'actual_API_readiness_not_parity_claim_required')
        return {'ready': True, 'buildId': build, 'minimumBlock': minimum, 'providerRequests': 0}

    def peers(self):
        # These fixed peers are outside the feature owner's effects. A later
        # coordinated supervisor needs a new explicit phase proof for changes.
        return self.read.consumer_frame(self.h)

    def last_feature_cursor(self):
        row = self.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + TARGET + "'),'build',(SELECT value->>'build_id' FROM " + TARGET + "._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM " + TARGET + "._ponder_checkpoint WHERE chain_id=8453))")
        need(row['schemaOid'] == TARGET_OID and row['build'] == BUILD, 'same_native_feature_catalog_before_inverse_required')
        return complete(row['checkpoint'])[0]

    def inverse_api(self, original, started_intent):
        need(self.inverse_mode, 'inverse_only_API_recovery_guard')
        self.definitions(True); state = self.state(API)
        if state['MainPID'] == '0':
            self.terminal(API)
            need(not Path('/proc', original['MainPID']).exists() and
                 (state['InvocationID'] in {'', original['InvocationID']} or int(state['NRestarts']) > 0), 'only_owned_terminal_API_without_foreign_replacement')
            return {'terminal': True, 'actor': None, 'previousInvocation': state['InvocationID'] or original['InvocationID'], 'NRestarts': int(state['NRestarts']), 'kernelSessions': []}
        actor = self.actor(True)
        if actor != original:
            need(int(state['NRestarts']) > 0 and int(actor['ExecMainStartTimestampMonotonic']) >= started_intent['monotonicUs'], 'inverse_API_restart_must_follow_own_start_and_systemd_restart_counter')
        observer = self.old.h.observer
        rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=" + ROLE_OID + " AND datid=17584")
        need(len(rows) <= 6, 'same_six_slot_collector_budget_required')
        fds = observer.peer_fds([r['pid'] for r in rows], 111, 113)
        peer = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
        tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        own = observer.peer_fds([int(actor['MainPID'])], 967, 961)
        need(own[actor['MainPID']]['startTicks'] == actor['startTicks'], 'same_actual_inverse_API_kernel_identity_required')
        sessions = observer.map_owned_backends(own, fds, rows, peer, tcp)
        need(len(sessions) <= 2 and self.actor(True) == actor, 'bounded_same_owned_API_sessions_required')
        return {'terminal': False, 'actor': actor, 'previousInvocation': actor['InvocationID'], 'NRestarts': int(state['NRestarts']), 'kernelSessions': sessions}

    def inverse_source(self):
        need(self.inverse_mode, 'inverse_only_temporary_source_guard')
        owner = self.old.source_owner; m = owner.prepare_module(); h = owner.Host(m)
        ack = document(owner.BASE / 'result.json', SOURCE_ACK); binding = document(owner.BASE / 'operation.json', ack['operationSha256'])
        h.unit(binding); state = self.state(SOURCE)
        if state['MainPID'] == '0':
            self.terminal(SOURCE)
            need(all(not Path('/proc', str(pid)).exists() for pid in ack['source']['actorPids']) and
                 (state['InvocationID'] in {'', ack['source']['invocation']} or int(state['NRestarts']) > 0), 'only_owned_terminal_temporary_source_allowed')
            return {'terminal': True, 'actor': None}
        actor = h.fresh_actor(binding)
        need(owner.actor_identity(actor) == owner.actor_identity(ack['source']) or
             (int(state['NRestarts']) > 0 and actor['startTicks'] >= ack['source']['startTicks']), 'only_owned_retained_temporary_source_restart_allowed_in_inverse')
        return {'terminal': False, 'actor': actor}

    def queue_proof(self, since, minimum):
        return self.old.core.queue_proof(since, minimum)

    def sessions(self, temporary=None):
        actors = {COMBINED: self.combined()}
        if temporary is not None: actors[SOURCE] = {'processes': [{'pid': p} for p in temporary['actorPids']]}
        return self.h.sessions(actors)

    def fresh_event(self, event, minimum):
        need(set(event) == {'blockNumber', 'blockHash', 'transactionHash', 'logIndex'} and
             type(event['blockNumber']) is int and event['blockNumber'] > minimum and type(event['logIndex']) is int and event['logIndex'] >= 0 and
             all(re.fullmatch('0x[a-f0-9]{64}', event[k]) for k in ['blockHash', 'transactionHash']), 'genuine_post_switch_event_identity_required')
        where = 'block_number=' + str(event['blockNumber']) + ' AND block_hash=' + literal(event['blockHash']) + ' AND transaction_hash=' + literal(event['transactionHash']) + ' AND log_index=' + str(event['logIndex'])
        value = self.query("SELECT jsonb_build_object('left',(SELECT count(*)FROM " + FRESH + '.booster_event WHERE ' + where + "),'right',(SELECT count(*)FROM " + TARGET + '.booster_event WHERE ' + where + "),'canonical',(SELECT block_hash FROM " + TARGET + '.chain_block WHERE chain_id=8453 AND block_number=' + str(event['blockNumber']) + '))')
        need(value == {'left': 1, 'right': 1, 'canonical': event['blockHash']}, 'unique_current_event_in_both_native_sources_and_canonical_header_required')
        self.native(TARGET, BUILD, event['blockNumber']); return event


def wait_read(callback, code, seconds=30):
    deadline = time.monotonic() + seconds
    while True:
        try: return callback()
        except (OSError, RuntimeError):
            if time.monotonic() >= deadline: raise RuntimeError(code) from None
            time.sleep(0.2)


class Owner:
    def __init__(self, host): self.h = host
    def get(self, name, digest=None): return document(BASE / name, digest)
    def put(self, name, value): return save(BASE / name, value)
    def step(self, name, effect):
        need(re.fullmatch('[a-z0-9-]+', name) and not os.path.lexists(BASE / (name + '-intent.json')), 'owned_step_already_attempted_inspect_never_retry')
        intent = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
                  'operationSha256': sha(protected(BASE / 'operation.json')), 'monotonicUs': time.monotonic_ns() // 1000, 'automaticRetryAllowed': False}
        digest = self.put(name + '-intent.json', intent)
        value = effect(intent)
        self.put(name + '-result.json', {'intentSha256': digest, 'result': value}); return value
    def phase(self, name):
        intent = self.get(name + '-intent.json'); ack = self.get(name + '-result.json')
        need(intent['bootId'] == boot() and intent['operationSha256'] == sha(protected(BASE / 'operation.json')) and ack['intentSha256'] == sha(protected(BASE / (name + '-intent.json'))), 'same_boot_owned_phase_ACK_required')
        return intent, ack['result']
    def operation(self):
        value = self.get('operation.json')
        need(value['format'] == FORMAT and value['operatorSha256'] == sha(protected(Path(__file__).absolute())) and value['bootId'] == boot() and
             value['manifestSha256'] == self.h.manifest_pin and value['inputSha256'] == self.h.input_pin, 'same_exact_feature_operation_required')
        return value
    def graph(self, admitted=False):
        baseline = self.h.baseline()
        if admitted:
            review = self.get('operation.json'); expected = review['catalogAfter']
            need(review['catalogBefore']['baseline'] == baseline, 'same_143_plus_cache_baseline_required')
            validate_catalog(expected, expected['baseline'], True)
        else: expected = validate_catalog(self.h.catalog(), baseline, False)
        need(self.h.catalog() == expected, 'unchanged_exact_feature_collector_catalog_required'); return expected
    def review(self):
        need(not getattr(self.h, 'inverse_mode', False), 'inverse_context_never_forward_authority')
        need(not os.path.lexists(BASE), 'feature_owner_must_be_fresh')
        for path in [SELECTOR, *DROPS.values()]: need(not os.path.lexists(path), 'new_feature_publication_paths_must_be_absent')
        before = self.graph(); after = after_eight(before)
        api = self.h.actor(False); old = self.h.old_inputs()
        need(api['MainPID'] == '2334701' and api['InvocationID'] == '3a3b4014f75b4db9968f4c5ee26fa904', 'actual_finalized_initial_API_actor_required')
        source = self.h.source_actor(); activation = self.h.source_activation()
        need(activation['UnitFileState'] == 'enabled', 'retained_temporary_source_enabled_until_retirement')
        timer = self.h.state(TIMER)
        need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'current_original_queue_schedule_required')
        binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'manifestSha256': self.h.manifest_pin,
                   'inputSha256': self.h.input_pin, 'bootId': boot(), 'catalogBefore': before, 'catalogAfter': after,
                   'oldReaderClosure': old, 'api': api, 'source': source, 'sourceBoot': boot_record(),
                   'combined': self.h.combined(), 'peers': self.h.peers(), 'definitions': self.h.definitions(False),
                   'originalWholeValidatorsPassed': False, 'current143WholeGraphQualified': False, 'collectorOnlyCurrentGraphQualified': True, 'newSELECTs': 8, 'LOGINChanges': 0}
        need(self.h.catalog() == before and self.h.actor(False) == api and self.h.source_actor() == source and self.h.peers() == binding['peers'], 'feature_changed_during_review')
        return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0}
    def rehearse(self, expected):
        reviewed = self.review(); need(reviewed['reviewHash'] == expected, 'exact_fresh_feature_review_required')
        BASE.mkdir(mode=0o700); BASE.chmod(0o700); sync(BASE.parent)
        self.put('operation.json', reviewed['binding'])
        query = self.h.catalog_sql(); text = grant_sql(reviewed['binding']['catalogBefore'], reviewed['binding']['catalogAfter'], query)
        self.put('eight-selects.rollback.sql', text.encode())
        self.step('rehearse-eight-selects', lambda _: self.h.old.core.sql(text))
        self.graph(); self.put('rehearsed.json', {'reviewHash': expected, 'rollbackPassed': True, 'catalogUnchanged': True})
        return {'rehearsed': True, 'catalogUnchanged': True, 'operationSha256': sha(protected(BASE / 'operation.json'))}
    def admit(self, operation_sha):
        need(not getattr(self.h, 'inverse_mode', False), 'inverse_context_never_forward_authority')
        op = self.operation(); need(sha(protected(BASE / 'operation.json')) == operation_sha, 'exact_rehearsed_operation_required')
        self.get('rehearsed.json'); self.graph()
        need(self.h.actor(False) == op['api'] and self.h.source_actor() == op['source'] and self.h.peers() == op['peers'] and self.h.combined() == op['combined'], 'same_owned_initial_runtime_before_eight_SELECTs')
        text = grant_sql(op['catalogBefore'], op['catalogAfter'], self.h.catalog_sql(), True)
        self.put('eight-selects.commit.sql', text.encode())
        def commit(_):
            self.h.old.core.sql(text); need(self.h.catalog() == op['catalogAfter'], 'exact_eight_READ_commit_ACK_required')
            return {'catalogSha256': sha(encoded(op['catalogAfter'])), 'committed': True}
        ack = self.step('commit-eight-selects', commit)
        receipt = {'format': FORMAT, 'operatorSha256': op['operatorSha256'], 'operationSha256': operation_sha, 'bootId': boot(),
                   'readAdmissionSha256': self.h.config['readAdmissionSha256'], 'cachePreparedSha256': self.h.config['cachePreparedSha256'],
                   'catalogAfterSha256': ack['catalogSha256'], 'newSELECTs': 8, 'committed': True, 'LOGINChanges': 0, 'originalWholeValidatorsPassed': False, 'current143WholeGraphQualified': False, 'collectorOnlyCurrentGraphQualified': True}
        digest = self.put('admitted.json', receipt); return {**receipt, 'receiptSha256': digest}
    def admitted(self):
        value = self.get('admitted.json'); op = self.operation(); _, ack = self.phase('commit-eight-selects')
        need(value['operationSha256'] == sha(protected(BASE / 'operation.json')) and value['operatorSha256'] == op['operatorSha256'] and value['catalogAfterSha256'] == ack['catalogSha256'] == sha(encoded(op['catalogAfter'])) and value['committed'] is True, 'owned_actual_eight_SELECT_ACK_required')
        self.graph(True); return value
    def invariant(self):
        op = self.operation(); self.admitted(); self.h.old_inputs()
        source = self.h.combined()
        need((source == op['combined'] or (getattr(self.h, 'inverse_mode', False) and source.get('inverseOnly') is True and source.get('terminal') is True)) and self.h.peers() == op['peers'], 'independent_combined_and_reader_peers_unchanged')
    def parity(self, digest):
        value = self.h.parity_current(digest)
        need(type(value.get('boundary')) is int and re.fullmatch('0x[a-f0-9]{64}', value.get('headerHash', '')) and
             0 <= time.time() - value.get('canonicalObservedAtUnix', 0) <= 180 and value.get('currentPrefixUnchanged') is True,
             'fresh_external_header_at_capture_plus_current_prefix_required')
        self.h.native(TARGET, BUILD, value['boundary']); return value
    def switch_review(self, parity_sha):
        need(not getattr(self.h, 'inverse_mode', False), 'inverse_context_never_forward_authority')
        self.invariant(); op = self.operation()
        need(not (BASE / 'switch-operation-intent.json').exists(), 'feature_switch_already_attempted')
        parity = self.parity(parity_sha)
        # The current41fe artifact itself requires Ponder's framework-ready bit.
        # Refuse before stopping the healthy API; do not discover its503 after restart.
        self.h.native(TARGET, BUILD, parity['boundary'], True)
        self.h.native(FRESH, FRESH_BUILD, parity['boundary'], True)
        self.h.availability(parity['boundary'], FRESH_BUILD)
        need(self.h.actor(False) == op['api'] and self.h.source_actor() == op['source'], 'same_pre_switch_API_and_temporary_source_required')
        value = {'operationSha256': sha(protected(BASE / 'operation.json')), 'paritySha256': parity_sha, 'parity': parity,
                 'boundary': parity['boundary'], 'api': op['api'], 'definitions': self.h.definitions(False), 'peers': self.h.peers()}
        return {'binding': value, 'reviewHash': sha(encoded(value))}
    def stop(self, unit, selected, expected=None):
        self.invariant(); self.h.definitions(selected)
        if expected is not None: need(self.h.actor(selected) == expected, 'owned_API_stop_identity_CAS_required')
        elif unit == API and getattr(self.h, 'inverse_mode', False): return self.h.terminal(API)
        if unit == QUEUE: wait_read(lambda: self.h.terminal(QUEUE), 'scheduled_queue_must_finish_after_timer_stop')
        self.h.manager('stop', unit, expected); return wait_read(lambda: self.h.terminal(unit), 'feature_stop_not_terminal')
    def start_api(self, selected, old_actor, intent):
        self.h.terminal(API); self.h.manager('start', API)
        def observe():
            actor = self.h.actor(selected)
            need(actor['InvocationID'] != old_actor['InvocationID'] and int(actor['ExecMainStartTimestampMonotonic']) >= intent['monotonicUs'], 'new_API_must_follow_owned_start_intent')
            return actor
        return wait_read(observe, 'owned_API_not_yet_running')
    def switch(self, parity_sha, expected):
        reviewed = self.switch_review(parity_sha); need(reviewed['reviewHash'] == expected, 'exact_fresh_switch_review_required')
        # Boundary freshness is checked again immediately before the first action.
        need(self.parity(parity_sha) == reviewed['binding']['parity'], 'same_fresh_pre_action_parity_required')
        self.h.availability(reviewed['binding']['boundary'], FRESH_BUILD)
        need(self.parity(parity_sha) == reviewed['binding']['parity'], 'same_final_current_prefix_required')
        self.put('switch-review.json', reviewed)
        self.h.first_effect_deadline = reviewed['binding']['parity']['canonicalObservedAtUnix'] + 180
        self.step('switch-operation', lambda _: self.switch_steps(reviewed['binding']))
        return self.get('switch-result.json')
    def switch_steps(self, binding):
        self.step('stop-queue-timer', lambda _: self.stop(TIMER, False))
        self.step('stop-old-queue', lambda _: self.stop(QUEUE, False))
        self.step('stop-old-api', lambda _: self.stop(API, False, binding['api']))
        for path, raw in [(SELECTOR, SELECTOR_BYTES), *[(p, DROP_BYTES) for p in DROPS.values()]]:
            self.step('publish-' + sha(str(path).encode())[:12], lambda _, p=path, r=raw: create_file(p, r))
        self.step('load-feature-overlay', lambda _: self.h.manager('daemon-reload'))
        actor = self.step('start-new-api', lambda i: self.start_api(True, binding['api'], i))
        available = wait_read(lambda: self.h.availability(binding['boundary'], BUILD), 'new_actual_API_not_ready')
        queue = self.step('one-new-queue', lambda i: self.queue_once(i, binding['boundary'], True))
        self.step('resume-queue-timer', lambda _: self.h.manager('start', TIMER))
        self.invariant(); need(self.h.actor(True) == actor and self.h.source_actor() == self.operation()['source'], 'source_and_newAPI_must_remain_owned')
        timer = self.h.state(TIMER); need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'existing_queue_schedule_resumed_required')
        value = {'format': FORMAT, 'operatorSha256': self.operation()['operatorSha256'], 'operationSha256': sha(protected(BASE / 'operation.json')),
                 'bootId': boot(), 'switched': True, 'schema': TARGET, 'buildId': BUILD, 'api': actor, 'queue': queue,
                 'paritySha256': binding['paritySha256'], 'switchBoundary': binding['boundary'], 'availability': available,
                 'temporarySourceRetired': False, 'freshSchemaAndReadsPreserved': True, 'sourceSelectionsChanged': 0}
        self.put('switch-result.json', value); return value
    def queue_once(self, intent, minimum, selected):
        self.h.definitions(selected); self.h.terminal(QUEUE); self.h.manager('start', QUEUE)
        wait_read(lambda: self.h.terminal(QUEUE), 'one_shot_queue_not_terminal', 45)
        return self.h.queue_proof(intent['monotonicUs'], minimum)
    def selected(self):
        need(not getattr(self.h, 'inverse_mode', False), 'inverse_context_never_forward_authority')
        self.invariant(); switched = self.get('switch-result.json'); need(switched['switched'] is True and switched['operatorSha256'] == self.operation()['operatorSha256'] and switched['bootId'] == boot(), 'exact_owned_reader_switch_receipt_required')
        self.h.definitions(True); need(self.h.actor(True) == switched['api'], 'exact_owned_newAPI_invocation_required'); return switched
    def retirement_review(self, parity_sha, event):
        switched = self.selected(); source = self.h.source_actor(); activation = self.h.source_activation()
        parity = self.parity(parity_sha); self.h.fresh_event(event, switched['switchBoundary'])
        need(parity['boundary'] >= event['blockNumber'], 'post_event_full_eight_table_parity_required')
        self.h.availability(event['blockNumber'], BUILD)
        sessions = self.h.sessions(source)
        binding = {'switchReceiptSha256': sha(protected(BASE / 'switch-result.json')), 'paritySha256': parity_sha, 'parity': parity,
                   'freshEvent': event, 'source': source, 'boot': boot_record(), 'kernelSessionAttributionComplete': True, 'api': switched['api']}
        return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'oldBackendTuples': sessions[SOURCE]}
    def retire(self, parity_sha, event, expected):
        reviewed = self.retirement_review(parity_sha, event); need(reviewed['reviewHash'] == expected, 'fresh_retirement_review_required')
        self.put('retirement-review.json', reviewed); b = reviewed['binding']
        need(self.parity(parity_sha) == b['parity'] and self.h.source_actor() == b['source'], 'same_fresh_retirement_pre_action_authority')
        def stop(_):
            self.selected(); need(self.h.source_actor() == b['source'], 'temporary_source_changed_before_owned_stop')
            expected_state = self.h.source_activation()
            need(expected_state['MainPID'] == str(b['source']['pid']) and expected_state['InvocationID'] == b['source']['invocation'], 'same_temporary_actor_at_stop_boundary')
            self.h.manager('stop', SOURCE, expected_state); self.h.terminal(SOURCE)
            remaining = self.h.sessions()
            remaining_tuples = {(r['pid'], r['backendStart']) for rows in remaining.values() for r in rows}
            need(not remaining_tuples.intersection((r['pid'], r['backendStart']) for r in reviewed['oldBackendTuples']), 'owned_temporary_backend_tuples_must_drain')
            return {'terminal': True, 'allRemainingWriterBackendsKernelOwnedByCombined': True}
        self.h.first_effect_deadline = b['parity']['canonicalObservedAtUnix'] + 180
        self.step('retire-source-stop', stop)
        def disable(_):
            need(boot_record() == b['boot'], 'source_boot_inode_CAS_required')
            target = BASE / 'temporary-source.boot.original'; need(not os.path.lexists(target), 'exclusive_original_boot_archive_required')
            os.rename(BOOT, target); sync(BOOT.parent); sync(BASE)
            need(link_record(target) == b['boot'], 'same_archived_boot_inode_required')
            self.h.manager('daemon-reload'); self.h.source_activation(True); self.h.terminal(SOURCE)
            return {'disabled': True, 'bootArchive': str(target), 'originalInodeRetained': True}
        self.step('retire-source-boot', disable)
        self.selected(); availability = self.h.availability(event['blockNumber'], BUILD)
        queue = wait_read(lambda: self.h.queue_proof(self.get('one-new-queue-intent.json')['monotonicUs'], event['blockNumber']), 'scheduled_queue_must_cover_post_switch_event')
        value = {'format': FORMAT, 'operatorSha256': self.operation()['operatorSha256'], 'operationSha256': sha(protected(BASE / 'operation.json')),
                 'bootId': boot(), 'retired': True, 'source': {'unit': SOURCE, 'terminal': True, 'enabled': False, 'priorInvocation': b['source']['invocation']},
                 'switchReceiptSha256': b['switchReceiptSha256'], 'freshEvent': event, 'postEventParitySha256': parity_sha,
                 'availability': availability, 'queue': queue, 'allActivationPathsAbsent': True, 'nativeSchemasAndReadsRetained': True}
        self.put('retirement-result.json', value); return value
    def inverse_review(self):
        self.h.inverse_mode = True; self.invariant()
        switched = self.get('switch-result.json'); op = self.operation()
        need(switched['switched'] is True and switched['operatorSha256'] == op['operatorSha256'] and switched['bootId'] == boot(), 'exact_owned_switch_for_inverse_required')
        started, actual = self.phase('start-new-api'); need(actual == switched['api'], 'owned_actual_API_start_ACK_required')
        api = self.h.inverse_api(switched['api'], started)
        retired = (BASE / 'retirement-result.json').exists()
        if retired:
            self.h.terminal(SOURCE); self.h.source_activation(True)
            need(link_record(BASE / 'temporary-source.boot.original') == self.get('retirement-review.json')['binding']['boot'], 'only_same_archived_boot_inode_restore_allowed')
            source = {'terminal': True, 'actor': None}
        else:
            self.h.source_activation(); need(boot_record() == op['sourceBoot'], 'same_retained_source_boot_inode_required')
            source = self.h.inverse_source()
        fixed_api = {k: v for k, v in api.items() if k != 'kernelSessions'}
        binding = {'operationSha256': sha(protected(BASE / 'operation.json')), 'switchReceiptSha256': sha(protected(BASE / 'switch-result.json')),
                   'apiProof': fixed_api, 'retired': retired, 'sourceProof': source}
        return {**binding, 'api': api['actor'], 'previousApiInvocation': api['previousInvocation'], 'reviewHash': sha(encoded(binding)),
                'apiKernelSessions': api['kernelSessions'], 'lastFeatureCursor': self.h.last_feature_cursor()}
    def inverse(self, expected):
        review = self.inverse_review(); need(review['reviewHash'] == expected, 'exact_fresh_inverse_review_required')
        self.put('inverse-review.json', review)
        minimum = max(self.get('switch-result.json')['switchBoundary'], review['lastFeatureCursor'])
        if review['retired']:
            original = self.get('retirement-review.json')['binding']['boot']; archived = BASE / 'temporary-source.boot.original'
            def restore_boot(_):
                need(link_record(archived) == original and not os.path.lexists(BOOT), 'only_same_archived_boot_inode_restore_allowed')
                os.rename(archived, BOOT); sync(BASE); sync(BOOT.parent); self.h.manager('daemon-reload'); return boot_record()
            self.step('inverse-source-boot', restore_boot)
            minimum = max(minimum, self.get('retirement-result.json')['freshEvent']['blockNumber'])
        if review['sourceProof']['terminal']:
            self.step('inverse-source-start', lambda intent: self.h.restart_temporary_source(intent, self.operation()['source']))
        wait_read(lambda: self.h.native(FRESH, FRESH_BUILD, minimum, True), 'restored_fresh_YPAL_source_not_caught_up', 150)
        self.step('inverse-stop-timer', lambda _: self.stop(TIMER, True))
        self.step('inverse-stop-queue', lambda _: self.stop(QUEUE, True))
        self.step('inverse-stop-api', lambda _: self.stop(API, True, review['api']))
        minimum = max(minimum, self.h.last_feature_cursor())
        wait_read(lambda: self.h.native(FRESH, FRESH_BUILD, minimum, True), 'restored_source_must_cover_last_accepted_feature_cursor', 150)
        for path in [*DROPS.values(), SELECTOR]:
            def remove(_, p=path):
                record = self.get('published-' + sha(str(p).encode())[:12] + '.json'); owned_file(p, record)
                owned_file(p, record); p.unlink(); sync(p.parent); return {'removed': str(p)}
            self.step('inverse-remove-' + sha(str(path).encode())[:12], remove)
        self.step('inverse-load-original-overlay', lambda _: self.h.manager('daemon-reload'))
        actor = self.step('inverse-start-original-api', lambda i: self.start_api(False, {'InvocationID': review['previousApiInvocation']}, i))
        availability = wait_read(lambda: self.h.availability(minimum, FRESH_BUILD), 'restored_fresh_API_not_ready')
        queue = self.step('inverse-one-queue', lambda i: self.queue_once(i, minimum, False))
        self.step('inverse-resume-timer', lambda _: self.h.manager('start', TIMER))
        # Only the separately owned eight reads are revoked. 143+cache4 and all
        # old/fresh namespace ownership, admissions, and artifacts are retained.
        op = self.operation(); current = self.h.catalog(); need(current == op['catalogAfter'], 'exact_owned_after_graph_before_inverse')
        self.step('inverse-eight-selects', lambda _: self.h.old.core.sql(grant_sql(current, op['catalogBefore'], self.h.catalog_sql(), True, True)))
        need(self.h.catalog() == op['catalogBefore'], 'exact_original_reader_graph_restored')
        value = {'format': FORMAT, 'operatorSha256': op['operatorSha256'], 'operationSha256': review['operationSha256'], 'bootId': boot(),
                 'inverse': True, 'restoredSchema': FRESH, 'restoredBuild': FRESH_BUILD, 'api': actor, 'availability': availability,
                 'queue': queue, 'ownedEightSELECTsRevoked': True, 'prior143AndCache4Preserved': True,
                 'oldAndFreshSchemasAndArtworkRetained': True, 'source': self.phase('inverse-source-start')[1] if review['sourceProof']['terminal'] else self.h.source_actor(review['sourceProof']['actor'])}
        self.put('inverse-result.json', value); return value
    def inspect(self):
        return {'format': FORMAT, 'operationSha256': sha(protected(BASE / 'operation.json')),
                'intents': sorted(p.name for p in BASE.glob('*-intent.json')), 'ACKs': sorted(p.name for p in BASE.glob('*-result.json')),
                'states': {u: {k:v for k,v in self.h.state(u).items() if k != 'ExecStart'} for u in [API, QUEUE, TIMER, SOURCE]}, 'automaticRetryAllowed': False,
                'unknownOrPartialPrefixesRequireManualReconciliation': True, 'serviceActions': 0, 'databaseWrites': 0}


def link_record(path):
    s = path.lstat(); need(stat.S_ISLNK(s.st_mode) and s.st_uid == s.st_gid == 0 and os.readlink(path) == '/etc/systemd/system/' + SOURCE, 'same_root_owned_source_boot_symlink_required')
    return {'dev': s.st_dev, 'ino': s.st_ino, 'uid': s.st_uid, 'gid': s.st_gid, 'target': os.readlink(path)}
def boot_record(): return link_record(BOOT)


def validate_current(result_sha, manifest_sha, input_sha):
    h = Host(manifest_sha, input_sha); owner = Owner(h); receipt = document(BASE / 'retirement-result.json', result_sha)
    need(receipt['retired'] is True and receipt['operatorSha256'] == sha(protected(Path(__file__).absolute())) and receipt['bootId'] == boot() and
         not (BASE / 'inverse-review.json').exists(), 'exact_unreversed_feature_retirement_receipt_required')
    switched = owner.selected(); h.source_activation(True); h.terminal(SOURCE)
    need(receipt['switchReceiptSha256'] == sha(protected(BASE / 'switch-result.json')), 'same_exact_retired_reader_handover_required')
    reviewed = owner.get('retirement-review.json')['binding']
    captured = document(h.parity.capture_path(reviewed['parity']['captureId']), receipt['postEventParitySha256'])
    h.parity.validate_receipt(captured)
    need(reviewed['freshEvent'] == receipt['freshEvent'] and captured['boundary'] >= receipt['freshEvent']['blockNumber'], 'same_immutable_post_event_parity_required')
    h.native(TARGET, BUILD, receipt['freshEvent']['blockNumber']); h.availability(receipt['freshEvent']['blockNumber'], BUILD)
    return {'format': FORMAT, 'validated': True, 'receiptSha256': result_sha, 'operatorSha256': receipt['operatorSha256'],
            'switchReceiptSha256': sha(protected(BASE / 'switch-result.json')), 'api': switched['api'], 'temporarySourceRetired': True,
            'BaseScopedReady': True, 'allConfiguredSourcesQualified': False, 'source': COMBINED, 'databaseWrites': 0, 'serviceActions': 0}


def validate_feature_leaf(result_sha, manifest_sha, input_sha):
    """Owned feature facts for a NEW supervisor's explicit source composition.

    This intentionally confers NO source actor, peer lifecycle, financial or
    all-chain readiness authority. The forward CLI never substitutes this leaf
    for its strict current original-source predicate.
    """
    h = Host(manifest_sha, input_sha); owner = Owner(h)
    receipt = document(BASE / 'retirement-result.json', result_sha)
    op = owner.operation(); owner.admitted()
    need(receipt['retired'] is True and receipt['operatorSha256'] == op['operatorSha256'] and
         receipt['operationSha256'] == sha(protected(BASE / 'operation.json')) and receipt['bootId'] == boot() and
         not (BASE / 'inverse-review.json').exists(), 'exact_unreversed_retired_feature_leaf_required')
    switched = owner.get('switch-result.json')
    need(receipt['switchReceiptSha256'] == sha(protected(BASE / 'switch-result.json')) and switched['schema'] == TARGET and
         switched['buildId'] == BUILD and switched['operatorSha256'] == op['operatorSha256'] and switched['bootId'] == boot(),
         'exact_same_owned_selected_feature_required')
    h.definitions(True); need(h.actor(True) == switched['api'], 'same_owned_feature_API_for_new_supervisor')
    h.source_activation(True); h.terminal(SOURCE)
    review = owner.get('retirement-review.json')['binding']
    capture = document(h.parity.capture_path(review['parity']['captureId']), receipt['postEventParitySha256'])
    h.parity.validate_receipt(capture)
    need(capture['boundary'] >= receipt['freshEvent']['blockNumber'] and review['freshEvent'] == receipt['freshEvent'], 'same_acknowledged_post_event_capture_required')
    native = h.native(TARGET, BUILD, receipt['freshEvent']['blockNumber'])
    available = h.availability(receipt['freshEvent']['blockNumber'], BUILD)
    timer = h.state(TIMER); need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'owned_feature_schedule_still_active')
    return {'format': FORMAT, 'validated': True, 'receiptSha256': result_sha, 'operatorSha256': op['operatorSha256'],
            'api': switched['api'], 'native': native, 'availability': available, 'temporarySourceRetired': True,
            'sourceActorQualified': False, 'financialAuthorityQualified': False, 'independentPeerLifecyclesQualified': False,
            'allConfiguredSourcesQualified': False, 'originalWholeValidatorsPassed': False, 'current143WholeGraphQualified': False, 'collectorOnlyCurrentGraphQualified': True, 'databaseWrites': 0, 'serviceActions': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest-sha', required=True); parser.add_argument('--input-sha', required=True)
    parser.add_argument('--capture-id'); parser.add_argument('--canonical-file'); parser.add_argument('--canonical-sha'); parser.add_argument('--parity-sha'); parser.add_argument('--event', help='Explicit public canonical event identity JSON')
    actions = parser.add_mutually_exclusive_group(); actions.add_argument('--rehearse'); actions.add_argument('--admit'); actions.add_argument('--switch-review', action='store_true'); actions.add_argument('--switch'); actions.add_argument('--retirement-review', action='store_true'); actions.add_argument('--retire'); actions.add_argument('--inverse-review', action='store_true'); actions.add_argument('--inverse'); actions.add_argument('--inspect', action='store_true'); actions.add_argument('--validate')
    args = parser.parse_args(); need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_production_owner_host_required'); os.umask(0o077)
    canonical = (args.canonical_file, args.canonical_sha) if args.canonical_file and args.canonical_sha else None
    h = Host(args.manifest_sha, args.input_sha, canonical, args.capture_id); owner = Owner(h)
    lock = os.open('/run/lock/yunipals-ypal-combined-transition.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock); need(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'protected_shared_transition_lock_required')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = Path('/run/lock/yunipals-ypal-combined-transition.lock').lstat(); need((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), 'shared_transition_lock_inode_changed')
        if args.rehearse: value = owner.rehearse(args.rehearse)
        elif args.admit: value = owner.admit(args.admit)
        elif args.switch_review: value = owner.switch_review(args.parity_sha)
        elif args.switch: value = owner.switch(args.parity_sha, args.switch)
        elif args.retirement_review: value = owner.retirement_review(args.parity_sha, json.loads(args.event))
        elif args.retire: value = owner.retire(args.parity_sha, json.loads(args.event), args.retire)
        elif args.inverse_review: value = owner.inverse_review()
        elif args.inverse: value = owner.inverse(args.inverse)
        elif args.inspect: value = owner.inspect()
        elif args.validate: value = validate_current(args.validate, args.manifest_sha, args.input_sha)
        else: value = owner.review()
        print(json.dumps(value, sort_keys=True))
    finally: os.close(lock)

if __name__ == '__main__':
    try: main()
    except BaseException as e:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(e).__name__, 'fixedCode': str(e) if type(e) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(e)) else 'private_diagnostics_withheld', 'automaticRetryAllowed': False})); raise SystemExit(1)
