#!/usr/bin/env python3
"""Explicit current-actor context over immutable v1 admission leaves.

No historical module is patched. Historical restored tuples stay historical;
current actors are admitted only through the separately acknowledged producer.
"""
import json
import os
from pathlib import Path
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
ACTOR_HELPER = OPS / 'arena-ypal-native-v1.actors.py'
ACTOR_HELPER_SHA = '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46'
ACTOR_ACK_FILE = Path('/var/backups/yunipals-arena-ypal-actor-ack-v1-20261024/result.json')
ACTOR_ACK_SHA = 'd3f1b61c244979dbf8b94281ba0d062e35fbca5ee52a1c92d9b9d97bd52781d4'
ACTOR_ACK_REVIEW = 'c7b78f2b5c149d9c21aec4bbaf9dd83fab19f6a3ad5a5b6469c70820872f95bf'
V1 = OPS / 'arena-ypal-native-v1.rehearsal.py'
V1_SHA = '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf'
PRODUCER = OPS / 'arena-ypal-native-v2.rehearsal.py'
FORMAT = 'yunipals-arena-ypal-admission-rehearsal-v2'


def modules():
    # The actual07ea loader is a pure protected-reader/code-pin leaf. Importing
    # these modules has no manager, SQL, service, provider or capture effect.
    import hashlib, stat
    for p in [*ACTOR_HELPER.parents, ACTOR_HELPER]:
        s = p.lstat()
        if s.st_uid != 0 or stat.S_ISLNK(s.st_mode) or s.st_mode & 0o022: raise RuntimeError('protected_actual_actor_helper_required')
    raw = ACTOR_HELPER.read_bytes()
    if len(raw) > 200000 or hashlib.sha256(raw).hexdigest() != ACTOR_HELPER_SHA: raise RuntimeError('exact_07ea_actor_helper_required')
    actors = types.ModuleType('actual_actor_ack'); actors.__file__ = str(ACTOR_HELPER); exec(compile(raw, str(ACTOR_HELPER), 'exec'), actors.__dict__)
    actors.protected(ACTOR_HELPER, ACTOR_HELPER_SHA)
    return actors.load(V1, V1_SHA), actors


class Context:
    """Finite facade: unchanged pure leaves plus a new current-actor predicate."""
    def __init__(self):
        self.leaf, self.actors = modules()
        self.ack = self.actors.acknowledgement(ACTOR_ACK_SHA)
        self.leaf.need(self.actors.RESULT == ACTOR_ACK_FILE and self.ack['operatorSha256'] == ACTOR_HELPER_SHA and
                       self.ack['reviewHash'] == ACTOR_ACK_REVIEW, 'actual_current_actor_capture_required')
        self.FORMAT, self.OPS = FORMAT, OPS
        self.PINS=dict(self.leaf.PINS)
        for name in ['ENV', 'TARGETS', 'HISTORICAL_OP', 'RESTORE', 'RESTORE_SHA', 'NO_PASSWORD']:
            setattr(self, name, getattr(self.leaf, name))

    def __getattr__(self, name):
        if name not in {'need', 'sha', 'encoded', 'read', 'module', 'run', 'peer_args', 'rollback_sql', 'catalog', 'source_ambient', 'load_proposal'}:
            raise AttributeError(name)
        return getattr(self.leaf, name)

    def acknowledged(self):
        # Pure immutable acknowledgement, usable after this operation stops old
        # actors. It never asserts those historical/current processes are live.
        value = self.actors.acknowledgement(ACTOR_ACK_SHA)
        self.need(value == self.ack, 'same_actual_actor_acknowledgement_required')
        return {'file': str(ACTOR_ACK_FILE), 'sha256': ACTOR_ACK_SHA, 'operatorSha256': ACTOR_HELPER_SHA,
                'reviewHash': value['reviewHash'], 'historicalRestoreSha256': value['binding']['historicalRestoreSha256'],
                'actorsSha256': self.sha(self.encoded(value['binding']['snapshot']['actors']))}

    def current_actors(self):
        value = self.actors.validate_current(ACTOR_ACK_SHA)
        self.need(value['validated'] is True and value['acknowledgementSha256'] == ACTOR_ACK_SHA and
                  value['binding'] == self.ack['binding'] and all(value[k] == 0 for k in ['databaseWrites', 'serviceChanges', 'providerCalls']), 'actual_fresh_eight_actor_acknowledgement_required')
        return {'acknowledgedCurrentActors': self.acknowledged(), 'actors': value['binding']['snapshot']['actors'],
                'definitionsSha256': value['binding']['snapshot']['definitionsSha256'],
                'privateInputHashes': value['binding']['snapshot']['privateInputHashes'], 'oldWholeInvocationGatePassed': False}

    def context(self, proposal):
        value = self.current_actors(); source = self.source_ambient()
        for row in proposal['filesAbsent']:
            self.need(not os.path.lexists(row['path']), 'native_private_overlays_must_remain_absent_before_admission')
        return {'acknowledgedCurrentActors': value['acknowledgedCurrentActors'], 'actorsSha256': self.sha(self.encoded(value['actors'])),
                'definitionsSha256': value['definitionsSha256'], 'privateInputsUnchanged': True, 'privateOverlaysAbsent': 9,
                'ownerResultSha256': proposal['current']['ownerResultSha256'], 'restoreResultSha256': proposal['current']['restoreResultSha256'],
                'sourceCatalogSha256': source['sourceCatalogSha256'], 'sourceAmbientSha256': source['sourceAmbientSha256'],
                'oldWholeInvocationGatePassed': False}

    def inspect(self):
        proposal = self.load_proposal()
        self.need(sum(len(w['requiredEdges']) for w in proposal['workers']) == 227 and len(proposal['sourceReader']['tables']) == 13, 'unchanged_227_and13_scope_required')
        sqls = [self.read(self.HISTORICAL_OP, self.PINS['operational-roles.current.sql.review']), self.read(OPS / 'arena-ypal-native-v1.source.sql.review', self.PINS['arena-ypal-native-v1.source.sql.review'])]
        for raw in sqls: self.rollback_sql(raw)
        roles = [[w['role'] for w in proposal['workers']], [proposal['sourceReader']['role']]]
        before = [self.catalog(*target, names) for target, names in zip(self.TARGETS, roles)]
        binding = {'format': FORMAT, 'operatorSha256': self.sha(self.read(PRODUCER)), 'proposalSha256': self.PINS['arena-ypal-native-v1.proposal.json'],
                   'context': self.context(proposal), 'catalogSha256': [self.sha(self.encoded(row)) for row in before],
                   'sourceAmbient': self.source_ambient(), 'acknowledgedCurrentActors': self.acknowledged(), 'oldWholeInvocationGatePassed': False}
        return proposal, sqls, roles, before, binding

    def rehearse(self, proposal, sqls, roles, before, binding, review_hash):
        self.need(review_hash == self.sha(self.encoded(binding)), 'fresh_exact_readonly_review_required')
        completed = []
        for target, raw, names, baseline in zip(self.TARGETS, sqls, roles, before):
            self.need(self.context(proposal) == binding['context'] and self.catalog(*target, names) == baseline, 'retained_context_or_catalog_changed')
            payload = self.rollback_sql(raw); output = self.run(self.peer_args(*target, write=True), payload, timeout=45)
            self.need(not output.strip() and not os.path.lexists(self.NO_PASSWORD) and self.catalog(*target, names) == baseline, 'rollback_role_or_acl_catalog_changed')
            completed.append({'port': target[0], 'database': target[1], 'sqlSha256': self.sha(raw), 'rollbackSqlSha256': self.sha(payload), 'rolesAbsentAfterRollback': len(names), 'catalogUnchanged': True})
        self.need(self.context(proposal) == binding['context'], 'retained_context_changed_after_rehearsal')
        return {'format': FORMAT, 'status': 'rollback_rehearsal_passed', 'reviewHash': review_hash, 'rehearsals': completed,
                'acknowledgedCurrentActors': self.acknowledged(), 'persistentRoleOrGrantChanges': 0, 'loginChanges': 0, 'privateFileWrites': 0,
                'serviceJobs': 0, 'schemaMigrations': 0, 'sourceSelectionsChanged': 0, 'providerCalls': 0, 'inTransactionEffectiveRoleProof': False,
                'oldWholeInvocationGatePassed': False, 'automaticRetryAllowed': False}
