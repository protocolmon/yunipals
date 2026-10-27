#!/usr/bin/env python3
"""Narrow credential composition for an actual current9-role admission.

The frozen password/file/LOGIN/TCP bodies are unchanged. No action occurs on
import or default. An actual admitted-result SHA is mandatory in the plan.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import stat
import sys
import types

FORMAT='yunipals-arena-ypal-current-credentials-v1'
AUTH_FORMAT='yunipals-arena-ypal-current-role-auth-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OLD=OPS/'arena-ypal-native-v2.credentials.py'
OLD_SHA='30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e'
ADMISSION_HELPER=OPS/'arena-ypal-source-completion-v1.py'
ADMISSION_HELPER_SHA='2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6'
ADMISSION=Path('/var/backups/yunipals-arena-ypal-source-completion-v1-20261024/result.json')
PROPOSAL=OPS/'arena-ypal-current-admission-v1.proposal.json'
PROPOSAL_SHA='0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4'
BASE=Path('/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024')


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def own_sha():return sha(Path(__file__).read_bytes())
def protected(path,pin):
    for p in [*path.parents,path]:
        row=p.lstat();need(row.st_uid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_frozen_credential_component_required')
    before=path.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
    raw=path.read_bytes();need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<200000 and key(before)==key(path.lstat())and sha(raw)==pin,'exact_frozen_credential_component_before_evaluation_required');return raw


def transform(raw):
    tree=ast.parse(raw)
    values={'FORMAT':repr(FORMAT),'AUTH_FORMAT':repr(AUTH_FORMAT),'BASE':'Path('+repr(str(BASE))+')',
        'ADMISSION':'Path('+repr(str(ADMISSION))+')','PROPOSAL':'Path('+repr(str(PROPOSAL))+')',
        'PROPOSAL_SHA':repr(PROPOSAL_SHA),'ADMISSION_HELPER_SHA':repr(ADMISSION_HELPER_SHA)}
    found=[]
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in values:
            key=node.targets[0].id;node.value=ast.parse(values[key],mode='eval').body;found.append(key)
    need(set(found)==set(values)and len(found)==len(values),'exact_seven_credential_identity_constants_required')
    changes={'yunipals-arena-ypal-admission-v2':'yunipals-arena-ypal-source-completion-v1',
             'arena-ypal-native-v2.admission.py':'arena-ypal-source-completion-v1.py',
             '/run/lock/yunipals-arena-ypal-credentials-v2.lock':'/run/lock/yunipals-arena-ypal-current-credentials-v1.lock'}
    counts={key:0 for key in changes}
    class Literals(ast.NodeTransformer):
        def visit_Constant(self,node):
            if isinstance(node.value,str)and node.value in changes:
                counts[node.value]+=1;return ast.copy_location(ast.Constant(changes[node.value]),node)
            return node
    tree=Literals().visit(tree);need(all(value==1 for value in counts.values()),'exact_three_credential_plan_domain_literals_required')
    ast.fix_missing_locations(tree);return tree


def build():
    raw=protected(OLD,OLD_SHA);tree=transform(raw);module=types.ModuleType('current_Arena_credentials');module.__file__=str(Path(__file__).absolute())
    exec(compile(tree,module.__file__,'exec'),module.__dict__)
    # Only the new namespace's loader is composed. Frozen30a and currentc04d are
    # unmodified. The adapter exposes actual current catalog methods only.
    inherited_load=module.load
    def load(path,pin):
        value=inherited_load(path,pin)
        if Path(path)==ADMISSION_HELPER:
            need(pin==ADMISSION_HELPER_SHA and callable(value.verify_current)and callable(value.create),'exact_current_admission_catalog_interface_required')
            return types.SimpleNamespace(verify_current=value.verify_current,runner=lambda:value.create()[0])
        return value
    module.load=load
    return module


def plan(admission_sha):
    need(isinstance(admission_sha,str)and len(admission_sha)==64 and all(c in'0123456789abcdef'for c in admission_sha)and admission_sha!='0'*64,
         'actual_current_admission_SHA_required')
    return {'format':FORMAT,'admissionResultFile':str(ADMISSION),'admissionResultSha256':admission_sha,
            'admissionHelperFile':str(ADMISSION_HELPER),'admissionHelperSha256':ADMISSION_HELPER_SHA}


def main():
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'actualAdmissionRequired':True,'roleChanges':0,'privateFileWrites':0,'serviceJobs':0,'providerCalls':0}));return
    if len(sys.argv)==3 and sys.argv[1]=='--admission-plan':
        print(json.dumps(plan(sys.argv[2]),sort_keys=True,separators=(',',':')));return
    module=build()
    module.main()


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'status':'refused','errorClass':type(error).__name__,'rawMessagesExported':False,'automaticRetryAllowed':False}));raise SystemExit(1)
