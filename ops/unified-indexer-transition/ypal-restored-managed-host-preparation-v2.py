#!/usr/bin/env python3
"""Inactive staging with a separately authenticated, preserved legacy parent.

This successor never treats the legacy unit as managed/source/retirement
authority. Published v1 and the actual managed owner remain unchanged.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT='yunipals-restored-managed-host-preparation-v2'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
TEMPLATE=OPS/'ypal-restored-managed-host-preparation-v1.py'
TEMPLATE_SHA='75d376801cee9d55b17df7bc155d30c63460cb4829f347ad372d2d79b7efa673'
BASE=Path('/var/backups/yunipals-restored-managed-host-preparation-v2-20261024')
DIAGNOSTIC=Path('/var/backups/yunipals-restored-managed-bootstrap-review-v1-20261024/parent-diagnostic.json')
DIAGNOSTIC_SHA='efdd2b6162586ec67695b967cfcf0f4b47fd9556bc5cd187f4a9f3c0a0cba8fc'
LEGACY_INPUT=DIAGNOSTIC.parent/'legacy-parent-preservation-v2.json'
LEGACY_INPUT_SHA='88612494b05fb612cc3ec9f501901858c03ee0fcbb726c4f5119ee4ab54ecff2'
PRIOR_INPUT=DIAGNOSTIC.parent/'legacy-parent-preservation.json'
PRIOR_INPUT_SHA='372072446735802e7e6478ac68c186f968e61e07750db6edf77f96835e982ee3'
PONDER_SHA='93bfdc94def0770f03a5527f55448a6048bda3e134def6b1d1905a9f445dadb5'
LEGACY_DEFINITIONS={
    '/etc/systemd/system/yunipals-indexer.service':'2129946a888c459389e80a20c57b57d83175baa8e24b95fff1d60b9272b8a35b',
    '/etc/systemd/system/yunipals-indexer.service.d/60-ponder-reorg-readers.conf':'8ccef54386146e3522b7b1053309f6f69ff5c663f54e9a346acaa407fcfe191f',
    '/etc/systemd/system/yunipals-indexer.service.d/90-rpc-budget.conf':'490432b3e35b3eb0887c0b870c7721ff45541300df1ae56b5e6c745c4f7446fb',
    '/etc/systemd/system/yunipals-indexer.service.d/98-monorepo.conf':'a5cec9a774871fd50faa11a254e05233a9d0980fbaa2256a8cd2be2e11428127'
}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def template():
    import stat
    for path in [*TEMPLATE.parents,TEMPLATE]:
        row=path.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode&0o022,
                             'protected_immutable_inactive_v1_required')
    raw=TEMPLATE.read_bytes();need(len(raw)<200000 and sha(raw)==TEMPLATE_SHA,'exact_published75d_source_required');return raw


def assemble(raw,parent_scope):
    """Only two identities and the explicit capture predicate/binding differ."""
    need(sha(raw)==TEMPLATE_SHA,'exact75d_inactive_stage_body_required')
    tree=ast.parse(raw);changed=set();captures=0;body=[]
    for original in tree.body:
        node=copy.deepcopy(original)
        if isinstance(node,ast.If):
            need(ast.unparse(node.test)=="__name__ == '__main__'",'only_old_main_guard_may_be_omitted');continue
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            name=node.targets[0].id
            if name in {'FORMAT','BASE'}:
                node.value=ast.parse(repr(FORMAT) if name=='FORMAT' else 'Path('+repr(str(BASE))+')',mode='eval').body;changed.add(name)
        if isinstance(node,ast.ClassDef) and node.name=='Host':
            for method in node.body:
                if not isinstance(method,ast.FunctionDef) or method.name!='capture':continue
                expected='inventory.actor(self.sdk.PARENT, True) is None'
                checks=[n for n in ast.walk(method) if isinstance(n,ast.BoolOp) and any(ast.unparse(v)==expected for v in n.values)]
                need(len(checks)==1 and ast.unparse(checks[0].values[0])==expected,'exact_published_parent_terminal_clause_required')
                checks[0].values[0]=ast.parse('legacy_parent["readOnlyPreservationQualified"]',mode='eval').body
                index=next(i for i,row in enumerate(method.body)if isinstance(row,ast.Expr) and isinstance(row.value,ast.Call)and
                    isinstance(row.value.args[0],ast.BoolOp)and row.value.args[0]is checks[0])
                method.body.insert(index,ast.parse('legacy_parent = preserved_legacy_parent(self, inventory)').body[0])
                binding=next(n for n in method.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='binding'for t in n.targets))
                need(isinstance(binding.value,ast.Dict),'literal_original_capture_binding_required')
                binding.value.keys.append(ast.Constant('legacyParentReadOnlyPreservation'));binding.value.values.append(ast.Name(id='legacy_parent',ctx=ast.Load()))
                captures+=1
        body.append(node)
    need(changed=={'FORMAT','BASE'} and captures==1,'exact_two_identity_one_capture_seams_required')
    namespace=types.ModuleType('inactive_managed_preserving_legacy_v2');namespace.__file__=str(Path(__file__).absolute())
    namespace.preserved_legacy_parent=parent_scope
    exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),namespace.__file__,'exec'),namespace.__dict__)
    return namespace


def fingerprint(path,expected,private=False):
    """Read only the existing inode; do not copy or import program/config bytes."""
    import stat
    path=Path(path);need(path.is_absolute()and '..'not in path.parts,'literal_existing_legacy_file_required')
    if expected is None:
        need(private and not os.path.lexists(path),'only_acknowledged_optional_absence_allowed');return None
    need(set(expected)=={'sha256','bytes','identity'}and re.fullmatch('[a-f0-9]{64}',expected['sha256'])and
         type(expected['bytes'])is int and 0<=expected['bytes']<=(1000000 if private else 256000000),
         'bounded_exact_legacy_file_fingerprint_required')
    keys=('st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_mtime_ns','st_ctime_ns')
    need(set(expected['identity'])==set(keys),'complete_recorded_legacy_file_identity_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode)and {k:getattr(before,k)for k in keys}==expected['identity'],
             'same_actual_recorded_legacy_file_inode_and_mode_required')
        digest=hashlib.sha256();size=0
        while True:
            raw=os.read(fd,65536)
            if not raw:break
            size+=len(raw);need(size<=expected['bytes'],'legacy_file_grew_during_read');digest.update(raw)
        need(size==expected['bytes']and digest.hexdigest()==expected['sha256']and
             all(getattr(os.fstat(fd),k)==getattr(before,k)==getattr(path.lstat(),k)for k in keys),
             'actual_legacy_program_or_private_file_changed')
    finally:os.close(fd)
    return expected


def parent_scope(namespace,host,inventory):
    namespace.protected(DIAGNOSTIC,DIAGNOSTIC_SHA)
    namespace.protected(PRIOR_INPUT,PRIOR_INPUT_SHA)
    record=json.loads(namespace.protected(LEGACY_INPUT,LEGACY_INPUT_SHA))
    need(record['format']=='yunipals-existing-legacy-parent-preservation-v2'and record['unit']==host.sdk.PARENT and
         record['bootId']==host.sdk.boot()and record['historicalPonderProgramMatched']is record['existingActorPreservationOnly']is True and
         all(record[k]is False for k in ['installedApplicationClosureQualified','newManagedWriterQualified','retirementQualified',
                                       'sourceReadinessQualified','financialAuthorityQualified'])and
         record['databaseWrites']==record['serviceActions']==record['providerCalls']==0,
         'actual_readonly_legacy_preservation_packet_not_runtime_authority_required')
    actor=inventory.actor(host.sdk.PARENT,True);activation=inventory.activation(host.sdk.PARENT)
    need(actor is not None and actor==record['actor']and activation==record['activation']and
         {p:v['sha256']for p,v in activation['definitions'].items()}==LEGACY_DEFINITIONS,
         'exact_existing_legacy_actor_activation_and_four_historical_definitions_required')
    need(len(actor['processes'])==2 and actor['parent']['uid']==actor['parent']['gid']==0 and
         'start'in actor['parent']['argv']and not any('launcher.mjs'in arg for arg in actor['parent']['argv']),
         'only_existing_root_legacy_Ponder_not_new_managed_launcher_allowed')
    obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in host.sdk.PARENT)
    files=json.loads(host.sdk.command(['/usr/bin/busctl','--json=short','get-property','org.freedesktop.systemd1',obj,
                                     'org.freedesktop.systemd1.Service','EnvironmentFiles']))
    need(files==record['effectiveEnvironmentFiles']and files.get('type')=='a(sb)'and len(files.get('data',[]))==2 and
         all(isinstance(row,list)and len(row)==2 and isinstance(row[0],str)and Path(row[0]).is_absolute()and type(row[1])is bool for row in files['data'])and
         set(record['fileFingerprints'])=={row[0]for row in files['data']},'exact_complete_ordered_two_file_legacy_environment_required')
    for path,optional in files['data']:
        expected=record['fileFingerprints'][path]
        need(optional or expected is not None,'required_legacy_private_file_cannot_be_absent');fingerprint(path,expected,True)
    programs=record['publicPrograms'];need(4<=len(programs)<=8 and sum(v['bytes']for v in programs.values())<=512000000,
                                          'finite_recorded_legacy_programs_config_and_explicit_loaders_required')
    for path,expected in programs.items():fingerprint(path,expected)
    ponder=[path for path,v in programs.items()if v['sha256']==PONDER_SHA and Path(path).name=='ponder.js']
    need(len(ponder)==1 and actor['parent']['executable']in programs and
         all(p['executable']in programs for p in actor['processes']), 'same_current_Node_Ponder_and_compiler_provenance_required')
    actual_arguments=[os.path.realpath(arg if Path(arg).is_absolute()else str(Path(actor['parent']['cwd'])/arg))
                      for arg in actor['parent']['argv']if not arg.startswith('-')]
    need(os.path.realpath(ponder[0])in actual_arguments and record['selectedConfig']['path']in programs and
         isinstance(record['explicitLoaders'],list)and len(record['explicitLoaders'])<=4,
         'actual_legacy_Ponder_entry_selected_config_and_loader_scope_required')
    # Explicit loaders are read only when actually recorded; no implicit module
    # closure is invented or claimed from a main entry/config fingerprint.
    for entry in record['explicitLoaders']:
        path=entry if isinstance(entry,str)else entry['path'];need(path in programs,'every_explicit_loader_must_have_its_own_actual_fingerprint')
    need(inventory.actor(host.sdk.PARENT,True)==actor and inventory.activation(host.sdk.PARENT)==activation,
         'existing_legacy_actor_changed_during_readonly_qualification')
    return {'readOnlyPreservationQualified':True,'packetSha256':LEGACY_INPUT_SHA,'diagnosticSha256':DIAGNOSTIC_SHA,
            'priorPacketSha256':PRIOR_INPUT_SHA,'actorSha256':sha(encoded(actor)),'activationSha256':sha(encoded(activation)),
            'orderedPrivateFileProofSha256':sha(encoded({'files':files,'fingerprints':record['fileFingerprints']})),
            'publicProgramsProofSha256':sha(encoded(programs)),'historicalPonderProgramMatched':True,
            'installedApplicationClosureQualified':False,'managedAuthorityQualified':False,'currentWriterQualified':False,
            'retirementQualified':False,'sourceReadinessQualified':False,'financialAuthorityQualified':False,
            'rawPrivateValuesExported':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group()
    group.add_argument('--review',action='store_true');group.add_argument('--stage');parser.add_argument('--legacy-input-sha');args=parser.parse_args()
    if not(args.review or args.stage):
        need(args.legacy_input_sha is None,'actual_readonly_scope_only_with_explicit_host_phase')
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'managedAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(args.legacy_input_sha is None or args.legacy_input_sha==LEGACY_INPUT_SHA,'only_exact_actual_readonly_legacy_packet_allowed')
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_production_host_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_inactive_preparation_expired'));signal.alarm(300)
    namespace=None
    def preserved(host,inventory):return parent_scope(namespace,host,inventory)
    namespace=assemble(template(),preserved);host=namespace.Host()
    with host.sdk.lock():
        if args.stage:result=namespace.stage(host,args.stage)
        else:
            value,fetched=namespace.review(host)
            result={'format':FORMAT,'reviewHash':value['reviewHash'],'publicCommit':namespace.COMMIT,'planSha256':namespace.PLAN_SHA,
                    'publicFiles':len(value['binding']['files']),'missingPublicFiles':len(fetched),'legacyPreservationPacketSha256':LEGACY_INPUT_SHA,
                    'actualREADAdmissionQualified':False,'completedInverseQualified':False,'nativeAdoptionQualified':False,
                    'currentWriterQualified':False,'retirementQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,
                          'automaticRetryAllowed':False,'stagingMayBePartial':os.path.lexists(BASE),
                          'databaseWrites':0,'serviceActions':0,'providerCalls':0}));raise SystemExit(1)
