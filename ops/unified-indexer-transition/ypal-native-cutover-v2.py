#!/usr/bin/env python3
"""Explicit successor namespace for frozen reader transactions and FD transport.

No old module globals or receipts are changed. A separate current phase facade
must authenticate the fresh READ/cache/metadata/generation/observer receipts.
"""
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import signal
import stat
import sys
import types

FORMAT = 'yunipals-ypal-native-cutover-v2'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-native-cutover-v2-20261024')
MANIFEST = OPS / 'ypal-native-cutover-v2.manifest.json'
PROOF = 'ypal-native-cutover-proof-v2.py'
TEMPLATE = OPS / 'ypal-native-cutover-v1.py'
TEMPLATE_SHA = '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b'
WIRE_MANIFEST_SHA = 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168'


def need(value, reason):
    if not value: raise RuntimeError(reason)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def protected(path, expected=None, maximum=200000):
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_explicit_reader_successor_source_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         'bounded_regular_reader_successor_source_required')
    raw = path.read_bytes(); after = path.lstat()
    need(len(raw) == before.st_size and
         all(getattr(before, key) == getattr(after, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         (expected is None or sha(raw) == expected), 'exact_unchanged_reader_successor_source_required')
    return raw


def statement(text): return ast.parse(text).body[0]


def transported_function(original):
    """Three exact launch seams; held-XID/session/ACK/cleanup body retained."""
    function = copy.deepcopy(original)
    need(function.name in {'child', 'action_preflight'}, 'only_two_fixed_reader_launch_functions_allowed')
    kind = 'postgres' if function.name == 'child' else 'main'
    assignments = [node for node in ast.walk(function) if isinstance(node, ast.Assign) and
                   len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'args']
    need(len(assignments) == 1 and isinstance(assignments[0].value, ast.List), 'single_frozen_setpriv_argument_list_required')
    args = assignments[0].value
    need(ast.unparse(args.elts[-2]) == 'NODE' and
         ast.unparse(args.elts[-1]) == ("str(ENTRY)" if kind == 'postgres' else "str(OPS / 'ypal-native-reader-probe-v1.mjs')"),
         'exact_frozen_Node_and_logical_entry_arguments_required')
    args.elts[-2:] = [ast.Starred(value=ast.parse('public.node_arguments(' + repr(kind) + ')', mode='eval').body, ctx=ast.Load())]
    launches = [node for node in ast.walk(function) if isinstance(node, ast.Call) and ast.unparse(node.func) == 'subprocess.Popen']
    need(len(launches) == 1 and not any(key.arg == 'pass_fds' for key in launches[0].keywords), 'single_frozen_child_spawn_required')
    envs = [key for key in launches[0].keywords if key.arg == 'env']
    need(len(envs) == 1, 'one_existing_private_or_clean_environment_required')
    envs[0].value = ast.Dict(keys=[None, None], values=[envs[0].value, ast.parse('public.environment', mode='eval').body])
    launches[0].keywords.append(ast.keyword(arg='pass_fds', value=ast.parse('public.pass_fds', mode='eval').body))
    # The child protocol still authenticates efca and its unchanged950b bytes.
    # The separate v2 manifest authenticates this owner/facade/transport instead.
    wires = 0
    for node in ast.walk(function):
        if isinstance(node, ast.Dict):
            for index, key in enumerate(node.keys):
                if isinstance(key, ast.Constant) and key.value == 'sourceManifestSha256':
                    need(ast.unparse(node.values[index]) == "context.inputs['sourceManifestSha256']",
                         'single_original_wire_manifest_expression_required')
                    node.values[index] = ast.Constant(WIRE_MANIFEST_SHA); wires += 1
    need(wires == 1, 'exactly_one_frozen_wire_manifest_field_per_launch_required')
    function.body = [ast.With(items=[ast.withitem(context_expr=ast.parse('public_scope(context)', mode='eval').body,
                                                 optional_vars=ast.Name(id='public', ctx=ast.Store()))], body=function.body)]
    return ast.fix_missing_locations(function)


def assemble(template, proof):
    """Construct a NEW explicit namespace, never mutate/import the old owner."""
    need(sha(template) == TEMPLATE_SHA, 'exact_frozen344_transaction_template_required')
    tree = ast.parse(template)
    values = {
        'FORMAT': ("'yunipals-ypal-native-cutover-v1'", repr(FORMAT)),
        'BASE': ("Path('/var/backups/yunipals-ypal-native-cutover-v1-20261024')", repr(str(BASE))),
        'MANIFEST': ("OPS / 'ypal-native-cutover-v1.manifest.json'", "OPS / 'ypal-native-cutover-v2.manifest.json'"),
        'PROOF': ("'ypal-native-cutover-proof-v1.py'", repr(PROOF))
    }
    changed = set(); body = []; definitions = {}
    for node in tree.body:
        if isinstance(node, ast.If):
            need(ast.unparse(node.test) == "__name__ == '__main__'", 'only_original_CLI_guard_may_be_omitted')
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in values:
                expected, replacement = values[name]
                need(ast.unparse(node.value) == expected, 'exact_frozen_owner_identity_constant_required')
                node = copy.deepcopy(node)
                node.value = ast.parse('Path(' + replacement + ')' if name == 'BASE' else replacement, mode='eval').body
                changed.add(name)
        if isinstance(node, ast.FunctionDef):
            definitions[node.name] = ast.dump(node, include_attributes=False)
            if node.name in {'load_proof', 'separate_witnesses', 'cache_finish_module'}:
                continue
            if node.name == 'recover_metadata':
                node = copy.deepcopy(node)
                captures = [call for call in ast.walk(node) if isinstance(call, ast.Call) and
                            ast.unparse(call) == 'h.actor(metadata_op, True, pristine=False)']
                need(len(captures) == 1, 'one_frozen_active_metadata_inverse_capture_required')
                call = captures[0]; call.func = ast.Name(id='metadata_inverse_actor', ctx=ast.Load())
                call.args = [ast.Name(id=name, ctx=ast.Load()) for name in ('context', 'owner', 'h', 'metadata_op', 'selection')]
                call.keywords = []
            if node.name == 'inputs':
                node = copy.deepcopy(node)
                keys = next((row for row in node.body if isinstance(row, ast.Assign) and
                             len(row.targets) == 1 and isinstance(row.targets[0], ast.Name) and row.targets[0].id == 'keys'), None)
                need(keys is not None and isinstance(keys.value, ast.Set) and
                     {value.value for value in keys.value.elts} == {'sourceManifestSha256', 'cachePreparedSha256',
                        'publisherInstallSha256', 'mainInstallSha256', 'parityWitnessSha256', 'sustainedObserverSha256'},
                     'exact_frozen_six_receipt_input_contract_required')
                keys.value.elts.extend(ast.Constant(value) for value in
                                      ('readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256'))
            if node.name in {'child', 'action_preflight'}:
                node = transported_function(node)
        body.append(node)
    need(changed == set(values), 'all_and_only_four_new_owner_identity_constants_required')
    module = types.ModuleType('explicit_ypal_native_cutover_v2')
    module.__file__ = str(Path(__file__).absolute())

    def public_scope(context):
        from contextlib import contextmanager
        @contextmanager
        def opened():
            proof.transport_current()
            transport = proof.transport_module()
            with transport.public_transport() as public:
                yield public
            proof.transport_current()
        return opened()

    def load_proof(pin):
        need(pin == proof.manifest_sha, 'same_explicit_new_root_manifest_required')
        return proof

    def separate_witnesses(context):
        return proof.separate_witnesses(module, context)

    def cache_finish_module(context):
        return proof.cache_finish_module(module, context)

    def metadata_inverse_actor(context, owner, host, operation, selection):
        return proof.metadata_inverse_actor(context, owner, host, operation, selection)

    module.__dict__.update(public_scope=public_scope, load_proof=load_proof, separate_witnesses=separate_witnesses,
                           cache_finish_module=cache_finish_module, metadata_inverse_actor=metadata_inverse_actor)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), module.__file__, 'exec'), module.__dict__)
    module.reuse_evidence = {'templateSha256': TEMPLATE_SHA, 'newOwnerConstants': sorted(changed),
        'launchFunctions': ['child', 'action_preflight'], 'additionalReceiptInputs':
            ['readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256'], 'unchangedFunctionCount': len(definitions) - 7,
        'inverseMetadataCaptureSeam': 'exact_selected_active_or_terminal_without_dispatch',
        'unchangedFunctionsSha256': sha(json.dumps({name: sha(body.encode()) for name, body in definitions.items()
             if name not in {'child', 'action_preflight', 'inputs', 'load_proof', 'separate_witnesses', 'cache_finish_module', 'recover_metadata'}}, sort_keys=True).encode()),
        'wireManifestSha256': WIRE_MANIFEST_SHA, 'historicalModulePatched': False,
        'sourceDependentConstructorInherited': False, 'originalWholeValidatorPassed': False}
    return module


def core(manifest_sha):
    manifest = json.loads(protected(MANIFEST, manifest_sha, 100000))
    need(manifest.get('format') == 'yunipals-ypal-native-cutover-source-v2' and
         manifest['files'][Path(__file__).name] == sha(protected(Path(__file__).absolute())),
         'exact_new_external_coordinator_manifest_required')
    raw = protected(OPS / PROOF, manifest['files'][PROOF])
    facade = types.ModuleType('explicit_current_reader_proof'); facade.__file__ = str(OPS / PROOF)
    exec(compile(raw, facade.__file__, 'exec'), facade.__dict__)
    proof = facade.Proof(manifest_sha)
    return assemble(protected(TEMPLATE, TEMPLATE_SHA), proof)


def main():
    if len(sys.argv) == 1 or sys.argv[1:] == ['--static']:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'sourceQualified': False,
                          'fresh143AndCacheAcknowledgementsRequired': True, 'coordinatorIntegrated': False,
                          'wireManifestSha256': WIRE_MANIFEST_SHA, 'databaseWrites': 0, 'serviceActions': 0})); return
    parser = argparse.ArgumentParser(add_help=False); parser.add_argument('--source-manifest-sha', required=True)
    args, _ = parser.parse_known_args()
    controller = core(args.source_manifest_sha)
    controller.main()


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_cutover_owner_deadline_unknown_effect_reconcile_only'))
    signal.alarm(1800)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and str(error).replace('_', '').isalnum() else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
    finally: signal.alarm(0)
