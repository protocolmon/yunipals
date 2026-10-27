#!/usr/bin/env python3
"""Read-only owned feature inverse actors, with no reader/catalog authority."""
import ast
import copy
import hashlib
import json
from pathlib import Path

FORMAT = 'yunipals-ordinary-feature-inverse-actors-v1'
SOURCE = 'ypal-restored-feature-context-v1.py'
SOURCE_SHA = '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be'


def need(value, code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()


def actor_tree(raw):
    need(sha(raw) == SOURCE_SHA, 'exact_frozen_feature_inverse_actor_body_required')
    tree = ast.parse(raw)
    fn = copy.deepcopy(next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'inverse_leaf'))
    removed = {'assignment': 0, 'bookend': 0, 'return': 0}
    body = []
    for node in fn.body:
        if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == '(expected_catalog, catalog_phase)':
            need(ast.unparse(node.value) == 'inverse_catalog_phase(h, op, reader_inverse_refs)', 'exact_inverse_catalog_assignment_seam_required')
            removed['assignment'] += 1; continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'need' and \
           any(isinstance(item, ast.Call) and ast.unparse(item.func) == 'inverse_catalog_phase' for item in ast.walk(node)):
            need(ast.unparse(node.value.args[0]) == 'inverse_catalog_phase(h, op, reader_inverse_refs) == (expected_catalog, catalog_phase)',
                 'exact_inverse_catalog_bookend_seam_required')
            removed['bookend'] += 1; continue
        if isinstance(node, ast.Return):
            need(isinstance(node.value, ast.Dict), 'one_original_feature_inverse_result_dictionary_required')
            pairs = [(key, value) for key, value in zip(node.value.keys, node.value.values) if not
                     (isinstance(key, ast.Constant) and key.value == 'inverseCatalogPhase')]
            need(len(pairs)+1 == len(node.value.keys), 'exact_inverse_catalog_return_seam_required')
            node.value.keys = [key for key, _ in pairs]; node.value.values = [value for _, value in pairs]; removed['return'] += 1
        body.append(node)
    need(removed == {'assignment': 1, 'bookend': 1, 'return': 1}, 'only_three_named_inverse_catalog_authority_slices_removed')
    fn.body = body
    return ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))


def validate_actors(b, result_sha, manifest_sha, input_sha):
    """b is the exact authenticated bound feature business namespace."""
    raw = b.protected(b.OPS/SOURCE)
    # Use the actual bound context helper methods: their kernel SQL retains
    # host(client_addr), and their source program/private checks remain intact.
    scope = {'need': b.need, 'heartbeat_current': lambda h, actor: h.helpers.heartbeat_current(h, actor),
             'temporary_sessions': lambda h, actor: h.helpers.temporary_sessions(h, actor)}
    exec(compile(actor_tree(raw), str(b.OPS/SOURCE), 'exec'), scope)
    proof = scope['inverse_leaf'](b, result_sha, manifest_sha, input_sha)
    return {**proof, 'format': FORMAT, 'featureOperatorSha256': proof['operatorSha256'],
            'operatorSha256': sha(Path(__file__).read_bytes()), 'manifestSha256': manifest_sha, 'inputSha256': input_sha,
            'currentCatalogQualified': False, 'readerAuthorityQualified': False,
            'originalWholeFeatureInverseLeafPassed': False}


if __name__ == '__main__':
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'sourceActorQualified': False,
                      'currentCatalogQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
