#!/usr/bin/env python3
"""Acceptance producer and original build operation remain separate identities."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS/'ypal-ordinary-read-cache-accept-v1.py'
FORMAT = 'yunipals-ypal-ordinary-read-cache-accept-v1'
BASE = Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v1-20261025')
INPUT = Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-input-v1-20261025/input.json')
READER = OPS/'ypal-ordinary-reader-accept-v1.py'
HELPER = OPS/'ypal-ordinary-generation-accept-binding-v1.py'
HELPER_SHA='4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758'
FROZEN = OPS/'ypal-ordinary-read-cache-bound-v1.py'
FROZEN_SHA = '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f'


def helper():
    for path in [*HELPER.parents, HELPER]:
        row=path.lstat()
        if row.st_uid != 0 or row.st_gid != 0 or stat.S_ISLNK(row.st_mode) or row.st_mode&0o022:
            raise RuntimeError('protected_acceptance_binding_helper_required')
    before=HELPER.lstat();raw=HELPER.read_bytes();after=HELPER.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < len(raw) == before.st_size < 100000 or \
       hashlib.sha256(raw).hexdigest() != HELPER_SHA or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_acceptance_binding_helper_required')
    value=types.ModuleType('acceptance_binding');value.__file__=str(HELPER)
    exec(compile(raw,str(HELPER),'exec'),value.__dict__);return value


def composition():
    h=helper()
    return h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'INPUT':INPUT,'READER':READER,
         'HELPER':HELPER,'HELPER_SHA':HELPER_SHA},{'helper':helper})


def namespace(config,manifest=None,source_guard=None):
    h=helper();value=composition().namespace(config,manifest,source_guard)
    h.need(value.GENERATION==Path(h.BUILD_BASE)/'candidate-result.json',
           'original_build_namespace_must_remain_actual_V2_before_acceptance_receipt_route')
    value.GENERATION=Path(h.ATTEMPT_BASE)/'candidate-result.json'
    raw=h.public(OPS/'ypal-restored-read-cache-provider-v1.py',
        '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9')
    cls=next(node for node in ast.parse(raw).body if isinstance(node,ast.ClassDef)and node.name=='Phase')
    method=copy.deepcopy(next(node for node in cls.body if isinstance(node,ast.FunctionDef)and node.name=='generation'))
    seams={"owner.BASE / 'capsule-result.json'":"Path(candidate['capsuleResultFile'])",
           "owner.BASE / 'operation.json'":"Path(candidate['operationFile'])",
           "candidate['operatorSha256']":"candidate['buildOperatorSha256']"}
    counts=dict.fromkeys(seams,0)
    class Route(ast.NodeTransformer):
        def visit_Call(self,node):
            # These are only the immutable original operation/capsule reads.
            for key in list(seams)[:2]:
                if ast.unparse(node.func)=='r.document' and node.args and ast.unparse(node.args[0])==key:
                    node.args[0]=ast.parse(seams[key],mode='eval').body;counts[key]+=1
            return self.generic_visit(node)
        def visit_Compare(self,node):
            if ast.unparse(node)=="op['operatorSha256'] == candidate['operatorSha256']":
                node.comparators[0]=ast.parse(seams["candidate['operatorSha256']"],mode='eval').body
                counts["candidate['operatorSha256']"]+=1
            return self.generic_visit(node)
    method=Route().visit(method)
    h.need(all(count==1 for count in counts.values()),'exact_three_acceptance_build_and_retained_capsule_predicate_seams_required')
    binding=value.generation_binding
    def validate(phase):
        candidate=phase.host.new_read.document(phase.cache.GENERATION,phase.host.config['generationSha256'])
        binding.candidate(candidate,phase.host.config)
    method.body.insert(0,ast.parse('validate_acceptance_generation(self)').body[0])
    scope={**value.Phase.generation.__globals__,'validate_acceptance_generation':validate}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),str(FILE),'exec'),scope)
    inherited=value.Phase
    class Phase(inherited):
        generation=scope['generation']
    value.Phase=Phase
    return value


def cache_runtime(config=None,manifest=None,source_guard=None):
    if config is None:
        h=helper();raw=h.public(INPUT);config=composition().common().intake().document(INPUT,h.sha(raw))
    return namespace(config,manifest,source_guard).cache_runtime()


def create_phase(inputs,coordinator_manifest,source_guard=None):
    c=composition().common();config=composition().config_checked(c.intake().document(INPUT,inputs['cacheInputsSha256']))
    return namespace(config,coordinator_manifest,source_guard).Phase(inputs,coordinator_manifest)


def __getattr__(name):
    return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('acceptance_cache_effects_require_actual_caller_and_new_timing')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
