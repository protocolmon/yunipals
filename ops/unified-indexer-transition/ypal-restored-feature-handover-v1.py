#!/usr/bin/env python3
"""Restored-source YPAL feature owner; explicit successor, no historical relabel.

The frozen e506 transaction/service bodies execute in a new namespace. Only the
listed constructor and current-source seams are replaced. Default CLI is review.
"""
import ast
import copy
import hashlib
from pathlib import Path
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
TEMPLATE = OPS / 'ypal-feature-handover-v1.py'
TEMPLATE_SHA = 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e'
CONTEXT = OPS / 'ypal-restored-feature-context-v1.py'
CONTEXT_SHA = '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be'
MANIFEST = OPS / 'ypal-restored-feature-handover-v1.manifest.json'
FORMAT = 'yunipals-ypal-restored-feature-handover-v1'
BASE = Path('/var/backups/yunipals-ypal-restored-feature-handover-v1-20261024')
INPUT = Path('/var/backups/yunipals-ypal-restored-feature-input-v1-20261024/config.json')
REPLACED = {'__init__', 'baseline', 'combined', 'source_actor', 'restart_temporary_source',
            'inverse_source', 'sessions', 'peers', 'queue_proof'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def protected(path, digest=None):
    path = Path(path)
    for p in [*path.parents, path]:
        s = p.lstat()
        need(s.st_uid == s.st_gid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
             'protected_restored_feature_source_required')
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and len(raw) == before.st_size <= 200000 and
         all(getattr(before, k) == getattr(after, k) for k in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']) and
         (digest is None or sha(raw) == digest), 'exact_restored_feature_source_required')
    return raw


def assemble(raw, context):
    need(sha(raw) == TEMPLATE_SHA, 'exact_e506_business_template_required')
    tree = ast.parse(raw); body = []; replaced = set(); identities = set(); manager_seams = 0
    values = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')',
              'INPUT': 'Path(' + repr(str(INPUT)) + ')', 'MANIFEST': 'Path(' + repr(str(MANIFEST)) + ')',
              'SELECTOR': "Path('/etc/yunipals-unified/booster-ypal-restored-combined.public.env')",
              'DROPS': "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-restored-combined.conf') for u in (API, QUEUE)}"}
    for original in tree.body:
        node = copy.deepcopy(original)
        if isinstance(node, ast.If): continue  # The only top-level conditional is the old CLI guard.
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in values:
                node.value = ast.parse(values[name], mode='eval').body; identities.add(name)
            elif name in {'COMBINED_ACK', 'COMBINED_OP'}: continue
            elif name == 'FIXED':
                node.value = ast.parse("{'ypal-reader-cutover-v1.py': (Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py'), 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8')}", mode='eval').body
        if isinstance(node, ast.ClassDef) and node.name == 'Host':
            node.name = 'HistoricalHost'; methods = []
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name in REPLACED: replaced.add(method.name)
                else:
                    if isinstance(method, ast.FunctionDef) and method.name == 'manager':
                        calls = [i for i, v in enumerate(method.body) if isinstance(v, ast.Assign) and
                                 isinstance(v.value, ast.Call) and ast.unparse(v.value.func) == 'subprocess.run']
                        need(len(calls) == 1, 'single_final_feature_manager_command_required')
                        method.body.insert(calls[0], ast.parse("if action == 'start': self.terminal(unit)").body[0]); manager_seams += 1
                    methods.append(method)
            node.body = methods
        body.append(node)
    need(replaced == REPLACED and identities == set(values) and manager_seams == 1, 'exact_feature_constructor_and_identity_seams_required')
    value = types.ModuleType('restored_feature_owner'); value.__file__ = str(Path(__file__).absolute())
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), value.__file__, 'exec'), value.__dict__)
    class Host(context.HostMixin, value.HistoricalHost):
        def __init__(self, manifest_pin, input_pin, canonical_ref=None, capture_id=None):
            context.initialize(self, value, manifest_pin, input_pin, canonical_ref, capture_id)
    value.Host = Host
    value.validate_inverse_leaf = lambda result_sha, manifest_sha, input_sha, reader_inverse_refs=None: context.inverse_leaf(value, result_sha, manifest_sha, input_sha, reader_inverse_refs)
    return value


def runtime():
    import json
    manifest = json.loads(protected(MANIFEST))
    need(isinstance(CONTEXT_SHA, str) and len(CONTEXT_SHA) == 64 and
         manifest['format'] == 'yunipals-ypal-restored-feature-code-v1' and
         manifest['files'].get(Path(__file__).name) == sha(protected(Path(__file__).absolute())) and
         manifest['files'].get(CONTEXT.name) == CONTEXT_SHA, 'explicit_new_feature_source_manifest_required')
    raw = protected(CONTEXT, CONTEXT_SHA)
    context = types.ModuleType('restored_feature_context'); context.__file__ = str(CONTEXT)
    exec(compile(raw, str(CONTEXT), 'exec'), context.__dict__)
    return assemble(protected(TEMPLATE, TEMPLATE_SHA), context)


def validate_feature_leaf(result_sha, manifest_sha, input_sha):
    return runtime().validate_feature_leaf(result_sha, manifest_sha, input_sha)


def validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    return runtime().validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs)


if __name__ == '__main__':
    try: runtime().main()
    except BaseException as error:
        import json
        import re
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
