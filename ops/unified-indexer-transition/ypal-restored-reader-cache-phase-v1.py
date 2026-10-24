#!/usr/bin/env python3
"""Explicit new-feature predicate for frozen reader/cache phase acceptance."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-restored-reader-cache-phase-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
ROOT = OPS / 'ypal-native-cutover-v2.py'
ROOT_SHA = '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003'
PROOF_SHA = 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14'
FINISH = OPS / 'ypal-cache-finish-v3.py'
FINISH_SHA = 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374'
MANIFEST_SHA = '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8'
FEATURE = OPS / 'ypal-restored-feature-handover-v1.py'
FEATURE_SHA = '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035'
FEATURE_CONTEXT = OPS / 'ypal-restored-feature-context-v1.py'
FEATURE_CONTEXT_SHA = '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be'


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def protected(path, expected):
    for p in [*path.parents, path]:
        row = p.lstat(); need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
                              'protected_post_feature_phase_source_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size < 200000,
         'bounded_single_post_feature_phase_source_required')
    raw = path.read_bytes(); after = path.lstat()
    need(all(getattr(before, k) == getattr(after, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         len(raw) == before.st_size and sha(raw) == expected, 'exact_post_feature_phase_source_required')
    return raw


def module(path, digest):
    raw = protected(path, digest); value = types.ModuleType(path.stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def feature_current(refs):
    need(type(refs) is dict and set(refs) == {'retirementSha256', 'manifestSha256', 'inputSha256'} and
         all(pin(value) for value in refs.values()), 'actual_exact_new_feature_receipt_triple_required')
    code = module(FEATURE, FEATURE_SHA)
    need(code.CONTEXT == FEATURE_CONTEXT and code.CONTEXT_SHA == FEATURE_CONTEXT_SHA,
         'same_reviewed_new_feature_context_required')
    protected(FEATURE_CONTEXT, FEATURE_CONTEXT_SHA)
    result = code.validate_feature_leaf(refs['retirementSha256'], refs['manifestSha256'], refs['inputSha256'])
    need(result['format'] == 'yunipals-ypal-restored-feature-handover-v1' and result['validated'] is True and
         result['operatorSha256'] == FEATURE_SHA and result['receiptSha256'] == refs['retirementSha256'] and
         result['temporarySourceRetired'] is result['collectorOnlyCurrentGraphQualified'] is True and
         all(result[key] is False for key in ('sourceActorQualified', 'financialAuthorityQualified',
             'independentPeerLifecyclesQualified', 'allConfiguredSourcesQualified', 'originalWholeValidatorsPassed',
             'current143WholeGraphQualified')) and result['databaseWrites'] == result['serviceActions'] == 0,
         'actual_new_feature_owned_retirement_and_collector_scope_required')
    return {'producerFile': str(FEATURE), 'producerSha256': FEATURE_SHA, 'contextSha256': FEATURE_CONTEXT_SHA,
            'receiptSha256': refs['retirementSha256'], 'manifestSha256': refs['manifestSha256'],
            'inputSha256': refs['inputSha256'], 'api': result['api'], 'temporarySourceRetired': True,
            'sourceActorQualified': False, 'financialAuthorityQualified': False}


def role_scope(context, proof, refs):
    need(context.logins_enabled() is True and not (proof.BASE / 'inverse-intent.json').exists(),
         'completed_uninversed_owned_reader_LOGIN_phase_required')
    feature = feature_current(refs)
    expected, _ = proof.login_postcatalog(context.sql_ack['postProof']['catalog'])
    current = context.catalog()
    # Reuse the exact four-role slice and exact eight table delta. The new
    # predicate above is explicit; the historical e506 loader is never called.
    value = proof.reader_role_slice(expected, current, True)
    need(context.query(proof.column_authority_sql([int(v) for v in proof.LEAF_ROLES.values()])) == 0,
         'no_untracked_PUBLIC_or_foreign_column_authority_for_owned_roles_allowed')
    columns = context.host.read_host.catalog()['allColumnAcl']
    need(columns == context.sql_ack['postProof']['allColumnAcl'],
         'all_grantee_column_ACLs_must_match_authenticated_reader_cache_baseline')
    guard = context.guard_scope(True)
    need(context.catalog() == current and context.host.read_host.catalog()['allColumnAcl'] == columns and
         feature_current(refs) == feature, 'current_feature_reader_catalog_columns_or_actor_changed')
    return {**value, 'validated': True, 'readAdmissionSha256': context.phase.admission_ref['receiptSha256'],
            'feature': feature, 'cacheGuard': guard, 'allColumnAclSha256': sha(encoded(columns)),
            'allGranteeColumnACLsQualified': True, 'sourceReadinessQualified': False, 'currentWriterQualified': False,
            'originalWholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def reader_namespace(root, proof, refs):
    """Only acceptance functions get a new global namespace, never mutations."""
    value = types.ModuleType('explicit_new_feature_reader_phase')
    value.__dict__.update(root.__dict__)
    def reader_context(actual_proof, operation, feature_refs=None):
        need(actual_proof is proof and feature_refs == refs, 'same_fixed_post_feature_phase_context_required')
        class PostFeatureContext(proof.Context):
            def scope(self, enabled=None):
                need(enabled is None or enabled is True, 'completed_reader_phase_requires_owned_LOGIN_true')
                return role_scope(self, proof, refs)
            def business_environment(self):
                return super().business_environment(operation['binding']['generationPublicInlineEnvironment'])
        context = PostFeatureContext(operation['binding']['inputs']); context.proof = proof
        return context
    value.reader_leaf_context = reader_context
    original = root.validate_reader_leaf
    need(not original.__code__.co_freevars, 'frozen_reader_acceptance_must_have_no_hidden_closure')
    value.validate_reader_leaf = types.FunctionType(original.__code__, value.__dict__, original.__name__, original.__defaults__)
    return value


def load(manifest_sha, refs):
    need(manifest_sha == MANIFEST_SHA, 'only_exact1599_reader_manifest_required_for_new_feature_phase')
    root_code = module(ROOT, ROOT_SHA); root = root_code.core(manifest_sha); proof = root.load_proof(manifest_sha)
    need(proof.manifest['files']['ypal-native-cutover-proof-v2.py'] == PROOF_SHA and
         proof.manifest['files'][FINISH.name] == FINISH_SHA, 'exact_frozen_reader_proof_and_cache_acceptance_required')
    feature = feature_current(refs)
    return reader_namespace(root, proof, copy.deepcopy(refs)), proof, feature


def validate_reader_leaf(result_sha, manifest_sha, feature_refs):
    root, proof, first = load(manifest_sha, feature_refs)
    result = root.validate_reader_leaf(result_sha, manifest_sha, feature_refs)
    need(feature_current(feature_refs) == first, 'new_feature_changed_during_full_reader_acceptance')
    return {**result, 'format': FORMAT + '-reader-leaf', 'originalAcceptanceFormat': result['format'],
            'phaseFacadeOperatorSha256': sha(protected(Path(__file__).absolute(), sha(Path(__file__).read_bytes()))),
            'newFeature': first, 'historicalFeatureOwnerAccepted': False}


def validate_cache_leaf(result_sha, manifest_sha, feature_refs):
    root, proof, first = load(manifest_sha, feature_refs)
    finish = module(FINISH, FINISH_SHA).runtime(root, proof)
    result = finish.validate_cache_leaf(result_sha, manifest_sha, feature_refs)
    need(feature_current(feature_refs) == first, 'new_feature_changed_during_full_cache_acceptance')
    return {**result, 'format': FORMAT + '-cache-leaf', 'originalAcceptanceFormat': result['format'],
            'phaseFacadeOperatorSha256': sha(protected(Path(__file__).absolute(), sha(Path(__file__).read_bytes()))),
            'newFeature': first, 'historicalFeatureOwnerAccepted': False}


def main():
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'sourceActorQualified': False,
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))


if __name__ == '__main__': main()
