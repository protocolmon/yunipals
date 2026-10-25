#!/usr/bin/env python3
"""Thin ordinary Arena handover with genuine retired-feature source callback."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-ypal-ordinary-bound-v1.py'
FORMAT='yunipals-arena-ypal-ordinary-bound-v1'
BASE=Path('/var/backups/yunipals-arena-ypal-ordinary-bound-v1-20261025')
MANIFEST=OPS/'arena-ypal-ordinary-bound-v1.manifest.json'
OBSERVATIONS=Path('/var/backups/yunipals-arena-ypal-ordinary-bound-review-v1-20261025')
SOURCE_CONTINUATION=Path('/var/backups/yunipals-arena-source-continuation-bound-v1-20261025/input.json')
FROZEN=OPS/'arena-ypal-ordinary-v1.py'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
INSTALL_ACK='ad024517f4ae8e348382cea0f589b4c432eaf4261797048cba5c66b676dabe84'
PINS={'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f'}
FROZEN_SHA='60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0'


def public(path,digest,maximum=4000000):
    path=Path(path)
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_bound_Arena_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or hashlib.sha256(raw).hexdigest()!=digest or any(
        getattr(before,key)!=getattr(after,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_bound_Arena_source_required')
    return raw


def module(name):
    raw=public(OPS/name,PINS[name]);value=types.ModuleType('bound_Arena_'+name.replace('-','_'));value.__file__=str(OPS/name)
    exec(compile(raw,value.__file__,'exec'),value.__dict__);return value


def continuation_checked(value):
    if value is None:return None
    refs=module('ypal-ordinary-downstream-refs-v1.py')
    if type(value)is not dict or set(value)!={'mode','refs'} or value['mode']not in {'managed','restored'} or \
       type(value['refs'])is not dict or set(value['refs'])!={'resultSha256','inputSha256','featureInputSha256','producerSha256','manifestSha256'} or \
       not all(refs.pin(item)for item in value['refs'].values()):
        raise RuntimeError('explicit_current_or_completed_restored_managed_source_refs_required')
    return copy.deepcopy(value)


def composition(source_continuation=None):
    source_continuation=continuation_checked(source_continuation)
    changes={'phase-leaf-format':0,'actual-retained-callback':0,'manifest-source-mode':0}
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name=='transform':
            for row in ast.walk(node):
                if isinstance(row,ast.Constant)and row.value=='yunipals-arena-ypal-ordinary-phase-leaf-v1':
                    row.value='yunipals-arena-ypal-ordinary-bound-phase-leaf-v1';changes['phase-leaf-format']+=1
        if isinstance(node,ast.FunctionDef)and node.name in {'validate_manifest','code_manifest'}:
            for row in ast.walk(node):
                if isinstance(row,ast.Constant)and row.value=='standalone':
                    row.value='typed-current-epoch';changes['manifest-source-mode']+=1
        if isinstance(node,ast.FunctionDef)and node.name=='normal':
            calls=[row for row in ast.walk(node)if isinstance(row,ast.Call)and ast.unparse(row.func)=='context.validate_current']
            if len(calls)!=1 or any(key.arg=='retained_current'for key in calls[0].keywords):
                raise RuntimeError('one_original_Arena_source_call_without_retained_override_required')
            calls[0].keywords.append(ast.keyword(arg='retained_current',value=ast.parse('host.bound_references.retained_current',mode='eval').body))
            changes['actual-retained-callback']+=1
        return node
    value=module(FACTORY.name).namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'MANIFEST':MANIFEST,'OBSERVATIONS':OBSERVATIONS,'PINS':PINS},transform=transform)
    if changes!={'phase-leaf-format':1,'actual-retained-callback':1,'manifest-source-mode':2}:raise RuntimeError('exact_bound_Arena_reference_leaf_and_manifest_identity_seams_required')
    old_namespace=value.namespace;old_validate=value.validate_plan;old_normal=value.normal
    def validate_plan(plan):
        if type(plan)is not dict or set(plan)!={'format','roleAuth','currentActorsAck','admissionProposal','floor','manifestSha256','ordinaryRuntime','runtimeInstall','publicationRefs'}:
            raise RuntimeError('exact_bound_Arena_plan_with_actual_publication_refs_required')
        refs=module('ypal-ordinary-downstream-refs-v1.py');refs.references(plan['publicationRefs'])
        if plan['runtimeInstall']['sha256']!=INSTALL_ACK:raise RuntimeError('retain_actual_e6bc_installed_inactive_Arena_ACK_required')
        return old_validate({key:item for key,item in plan.items()if key!='publicationRefs'})
    def normal(host,terminal_ok=False):
        if type(terminal_ok)is not bool:raise RuntimeError('explicit_bound_Arena_inverse_direction_required')
        continuation=source_continuation
        if continuation is None:return old_normal(host,terminal_ok)
        current=host.bound_references.continued_source(continuation)
        data=current['dataIdentity'];native=current['native']
        if data['manifestHash']!=host.manifest['source']['manifestHash'] or data['schemaOid']!='75963410' or \
           native['app']['build_id']!='71e2a7f3b7' or current['currentWriterQualified']is not True:
            raise RuntimeError('same_dataset_and_genuine_current_source_before_Arena_phase_required')
        return {'format':'yunipals-arena-ypal-ordinary-bound-source-context-v1','validated':True,
            **{key:data[key]for key in ['manifestHash','schema','schemaOid','buildId']},
            'releaseId':value.SOURCE_VALUE['releaseId'],'dataIdentity':data,'source':current['source'],
            'sourceTerminal':False,'inverseOnly':terminal_ok,'sourceKind':current['sourceKind'],
            'sourceActorQualified':True,'currentWriterExclusivityQualified':True,
            'sourceReceiptSha256':current['receiptSha256'],'sourceOperatorSha256':current['producerSha256'],
            'sourceRuntimeInputSha256':current['inputSha256'],'sourceRuntimeProofSha256':value.sha(value.encoded(current)),
            'ordinaryRuntimeAncestry':copy.deepcopy(host.plan['ordinaryRuntime']),'ordinaryRuntimeCurrentClaimed':False,
            'ordinaryFinancialProof':{'fullSourceLifecycleProofSha256':value.sha(value.encoded(current['proof']))},
            'financialPolicyCurrent':True,'financialAuthorityQualified':False,'originalWholeValidationPassed':False,
            'nativeReadinessQualified':False,'currentCanonicalCoverageQualified':False,
            'oldRestoredEpochQualified':False,'oldFreeNineRouteValidatorPassed':False,
            'databaseWrites':0,'serviceChanges':0,'providerRequests':0}
    def namespace():
        result=old_namespace();original_init=result.Host.__init__
        def initialize(host,plan):
            original_init(host,plan)
            host.bound_references=module('ypal-ordinary-downstream-refs-v1.py').Reference(plan['publicationRefs'])
            if host.bound_references.ordinary!=plan['ordinaryRuntime']:
                raise RuntimeError('same_recorded_ordinary_source_in_Arena_reader_and_feature_required')
        result.Host.__init__=initialize
        return result
    value.validate_plan=validate_plan;value.normal=normal;value.namespace=namespace
    return value


def namespace(source_continuation=None):return composition(source_continuation).namespace()
def code_manifest():return composition().code_manifest()
def validate_phase_leaf(result_sha,manifest_sha,continuation=None):return composition().validate_phase_leaf(result_sha,manifest_sha,continuation)


def main():
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'migrationInvocations':0,'serviceJobs':0,'databaseWrites':0}));return
    args=list(sys.argv[1:]);option='--source-continuation-sha256'
    if option in args:
        if args.count(option)!=1:raise RuntimeError('one_explicit_source_continuation_SHA_required')
        index=args.index(option)
        if index+1>=len(args):raise RuntimeError('actual_source_continuation_SHA_required')
        digest=args[index+1];refs=module('ypal-ordinary-downstream-refs-v1.py')
        if not refs.pin(digest):raise RuntimeError('actual_source_continuation_SHA_required')
        continued=json.loads(public(SOURCE_CONTINUATION,digest,150000));del args[index:index+2]
    else:continued=None
    sys.argv=[sys.argv[0],*args]
    composition(continued).main()


if __name__=='__main__':main()
