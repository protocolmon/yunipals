#!/usr/bin/env python3
"""Explicit v2-reader context for the unchanged cache finish/inverse bodies."""
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import types

FORMAT = 'yunipals-ypal-ordinary-cache-finish-v6'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-ordinary-cache-finish-v6-20261025')
TEMPLATE = 'ypal-cache-finish-v2.py'
TEMPLATE_SHA = '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa'


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()


def assemble(raw, root, proof):
    need(sha(raw) == TEMPLATE_SHA, 'exact_frozen8dea_cache_lifecycle_template_required')
    expected = {'FORMAT': "'yunipals-ypal-cache-finish-v2'",
                'BASE': "Path('/var/backups/yunipals-ypal-native-cache-finish-v2-20261024')",
                'MANIFEST': "OPS / 'ypal-native-cutover-v1.manifest.json'"}
    replacements = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')',
                    'MANIFEST': "OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'"}
    tree = ast.parse(raw); body = []; changed = set(); omitted = 0
    for node in tree.body:
        if isinstance(node, ast.If):
            need(ast.unparse(node.test) == "__name__ == '__main__'", 'only_original_cache_CLI_guard_may_be_omitted')
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in replacements:
                need(ast.unparse(node.value) == expected[name], 'exact_frozen_cache_identity_constant_required')
                node = copy.deepcopy(node); node.value = ast.parse(replacements[name], mode='eval').body; changed.add(name)
        if isinstance(node, ast.FunctionDef) and node.name == 'load':
            omitted += 1; continue
        body.append(node)
    need(changed == set(expected) and omitted == 1, 'exact_three_cache_identity_and_one_context_loader_seams_required')
    namespace = types.ModuleType('explicit_cache_finish_v3'); namespace.__file__ = str(Path(__file__).absolute())
    def load(manifest_sha):
        need(manifest_sha == proof.manifest_sha, 'same_current_reader_manifest_required_for_cache_finish')
        proof.source_manifest(manifest_sha)
        need(proof.manifest['files'][Path(__file__).name] == sha(root.public_input(Path(__file__).absolute())),
             'this_exact_new_cache_finish_owner_must_be_manifest_bound')
        return root, proof
    namespace.load = load
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), namespace.__file__, 'exec'), namespace.__dict__)
    return namespace


def runtime(root, proof):
    return assemble(root.public_input(OPS / TEMPLATE, TEMPLATE_SHA), root, proof)


def core(manifest_sha):
    manifest_path = OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'
    # Bootstrap only the manifest-authenticated new coordinator. Its protected
    # loader then rechecks all source/provider/program/qualification bindings.
    from importlib.util import module_from_spec, spec_from_loader
    import stat
    for path in [manifest_path, *manifest_path.parents]:
        row = path.lstat(); need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
                                'protected_current_reader_manifest_required')
    row = manifest_path.lstat()
    need(stat.S_ISREG(row.st_mode) and row.st_nlink == 1 and row.st_size <= 100000,
         'bounded_regular_current_reader_manifest_required')
    raw = manifest_path.read_bytes(); need(len(raw) <= 100000 and sha(raw) == manifest_sha, 'exact_current_reader_manifest_required')
    manifest = json.loads(raw); path = OPS / 'ypal-ordinary-reader-cutover-v6.py'
    row = path.lstat(); need(stat.S_ISREG(row.st_mode) and row.st_uid == row.st_gid == 0 and row.st_nlink == 1 and
                             not row.st_mode & 0o022 and row.st_size < 200000, 'protected_new_reader_coordinator_required')
    source = path.read_bytes(); need(sha(source) == manifest['files'][path.name], 'exact_new_reader_coordinator_required')
    module = module_from_spec(spec_from_loader('new_reader_coordinator', loader=None)); module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    root,proof = module.core(manifest_sha)
    return runtime(root, proof)


def main():
    need(len(sys.argv)==1 or sys.argv[1:]==['--static'],
         'publication_V6_operations_require_actual_caller_context_and_timing_gate')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'callerRequired':True,
                     'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'automaticRetryAllowed': False})); raise SystemExit(1)
