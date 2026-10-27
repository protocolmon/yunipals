#!/usr/bin/env python3
"""Create only the new reviewed V5 read schema; preserve V4/native/roles."""
import argparse
import hashlib
import io
import contextlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT='yunipals-ypal-ordinary-readview-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-readview-v5-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-readview-input-v5-20261025/input.json')
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
TEMPLATE=OPS/'ypal-combined-readview-owner-v1.py'
TEMPLATE_SHA='2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058'
PLAN=OPS/'ypal-combined-readview-v5.preparation.json'
PLAN_SHA='d968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7'
COMPILER=OPS/'ypal-combined-readview-v5-plan.mjs'
COMPILER_SHA='91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201'
READ_SCHEMA='yunipals_ownership_4e77f52b_v5'
READ_IDENTITY='0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64
def own_sha():return sha(Path(__file__).read_bytes())

def intake():
    import stat
    for p in [*INTAKE.parents,INTAKE]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_V5_intake_source_required')
    raw=INTAKE.read_bytes();need(len(raw)<200000 and sha(raw)==INTAKE_SHA,'exact_V5_current_intake_source_required')
    v=types.ModuleType('V5_intake');v.__file__=str(INTAKE);exec(compile(raw,str(INTAKE),'exec'),v.__dict__);return v


def checked_input(value):
    need(type(value)is dict and set(value)=={'format','ordinaryRuntime','readAdmissionSha256'}and value['format']==FORMAT+'-input'and
         type(value['ordinaryRuntime'])is dict and set(value['ordinaryRuntime'])=={'resultSha256','inputSha256'}and
         all(pin(x)for x in value['ordinaryRuntime'].values())and pin(value['readAdmissionSha256']),'actual_ordinary_source_and_READ_ancestry_for_V5_required')
    return value

def protected(path,expected=None):
    # The intake reader always requires an explicit hash. For internal journal
    # links whose hash is authenticated by the recorded chain, first capture
    # bytes, then use that same strict reader for ownership/mode/inode CAS.
    expected=expected or sha(Path(path).read_bytes())
    return intake().protected(path,expected)

def document(path,expected=None):return json.loads(protected(path,expected))


def validate_plan(value):
    need(value['format']=='yunipals-combined-readview-offline-preparation-v5'and value['preparedOnly']is True and value['semanticVersion']==5 and
         value['readSchema']==READ_SCHEMA and value['readIdentity']==READ_IDENTITY and value['previousReadSchema']=='yunipals_ownership_4e77f52b_v4'and
         value['previousReadIdentity']=='0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'and
         value['sourceRelease']==intake().DATA['sourceRelease']and value['physicalSchema']==intake().DATA['schema']and
         value['buildId']=='71e2a7f3b7'and value['manifestHash']==intake().DATA['manifestHash']and
         value['producerSha256']==COMPILER_SHA and len(value['officialSourcePins'])==28 and len(value['expectedOwnerStatements'])==19 and
         value['installedCreatorQualified']is value['grantsPrepared']is value['previousSchemaModified']is value['nativeDataWritten']is value['servicesOrSelectorsChanged']is False and
         value['databaseQueries']==value['providerRequests']==0,'exact_reviewed_V5_SQL_and_honest_offline_creator_provenance_required')
    return value


def build(input_sha):
    need(pin(input_sha),'actual_V5_creator_input_hash_required');i=intake();config=checked_input(i.document(INPUT,input_sha))
    factory=i.module(FACTORY,FACTORY_SHA);i.protected(COMPILER,COMPILER_SHA);p=validate_plan(i.document(PLAN,PLAN_SHA))
    parts=i.query_components()['components'];sdk=parts['privilegedSourcePrimitives']['sdk'];s=parts['privilegedSourcePrimitives']['host'].s
    peer=lambda:['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs']
    h=types.SimpleNamespace(m=types.SimpleNamespace(peer=peer,run=sdk.command,protected=sdk.protected))
    ack=i.read_acknowledgement(config['readAdmissionSha256'])
    r=types.SimpleNamespace(sha=sha,encoded=encoded,RELEASE_ID=i.DATA['sourceRelease'],MANIFEST_HASH=i.DATA['manifestHash'],
        SOURCE_ACK_SHA=config['ordinaryRuntime']['resultSha256'])
    def source_binding(*_):
        need(i.document(INPUT,input_sha)==config,'same_immutable_V5_creator_input_required')
        ordinary=i.validate_runtime(config['ordinaryRuntime']['resultSha256'],config['ordinaryRuntime']['inputSha256'])
        return {'ordinaryRuntime':ordinary,'readAdmissionSha256':config['readAdmissionSha256'],'initialReadAncestrySha256':sha(encoded(ack)),
                'inputSha256':input_sha,'planSha256':PLAN_SHA,'creatorCompilerSha256':COMPILER_SHA,'installedCreatorArtifactClaimed':False}
    def labels(node):
        import ast
        if isinstance(node,ast.FunctionDef)and node.name=='review':
            for v in ast.walk(node):
                if isinstance(v,ast.Constant)and v.value=='artifactInstallReceiptSha256':v.value='historicalArtifactInstallReceiptSha256'
        return node
    n=factory.namespace(i.protected(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,Path(__file__).absolute(),{
      'FORMAT':FORMAT,'BASE':BASE,'PLAN':PLAN,'PLAN_SHA':PLAN_SHA,'READ_SCHEMA':READ_SCHEMA,'READ_IDENTITY':READ_IDENTITY},
      {'load':lambda:(r,s,h,config,ack,p),'source_binding':source_binding},labels)
    return n,(r,s,h,config,ack,p)


def acknowledgement(result_sha):
    """Recorded creator/rehearsal/intent/result chain; no current writer proof."""
    need(pin(result_sha),'actual_V5_created_receipt_required');i=intake();result=document(BASE/'created.json',result_sha)
    before=document(BASE/'before.json');rehearsal=document(BASE/'rehearsed.json');intent=document(BASE/'commit-intent.json')
    need(before['format']==result['format']==rehearsal['format']==FORMAT and before['operatorSha256']==own_sha()and
         before['reviewHash']==result['reviewHash']==rehearsal['reviewHash']==intent['reviewHash']and
         before['reviewHash']==sha(encoded({k:v for k,v in before.items()if k!='reviewHash'}))and before['planSha256']==intent['planSha256']==PLAN_SHA and
         intent['rehearsalSha256']==sha(protected(BASE/'rehearsed.json'))and intent['automaticRetryAllowed']is False and
         result['created']is rehearsal['rehearsed']is rehearsal['catalogUnchanged']is True and result['selected']is result['grantsChanged']is result['servicesChanged']is result['nativeDataWritten']is False and
         result['readSchema']==READ_SCHEMA and result['readIdentity']==READ_IDENTITY and result['sourceRelease']==i.DATA['sourceRelease']and
         result['sourceReceiptSha256']==before['binding']['ordinaryRuntime']['runtimeReceiptSha256'],'actual_V5_creator_operation_chain_required')
    # Use only pure target/semantic validation; do not call the new load/source fence.
    factory=i.module(FACTORY,FACTORY_SHA)
    n=factory.namespace(i.protected(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,Path(__file__).absolute(),{'READ_SCHEMA':READ_SCHEMA,'READ_IDENTITY':READ_IDENTITY})
    p=validate_plan(i.document(PLAN,PLAN_SHA));n.validate_target(p,result['target'])
    need(n.semantics(result['target'])==rehearsal['targetSemantics'],'same_actual_rehearsed_V5_function_view_and_owner_ACL_semantics_required')
    return {'format':FORMAT+'-acknowledgement','validated':True,'createdAcknowledged':True,'receiptSha256':result_sha,
      'readSchema':READ_SCHEMA,'readIdentity':READ_IDENTITY,'schemaOid':result['target']['schemaOid'],'sourceRelease':result['sourceRelease'],
      'sourceActorQualified':False,'currentWriterQualified':False,'permissionAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def data_current(result_sha):
    """Created object/OID/body/marker identity; a separate owner qualifies grants."""
    recorded=acknowledgement(result_sha);i=intake();saved=document(BASE/'created.json',result_sha)
    factory=i.module(FACTORY,FACTORY_SHA)
    n=factory.namespace(i.protected(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,Path(__file__).absolute(),{'READ_SCHEMA':READ_SCHEMA,'READ_IDENTITY':READ_IDENTITY})
    query=i.query_components()['components']['readerHost'].query;value=query(n.target_sql(validate_plan(i.document(PLAN,PLAN_SHA))))
    def identity(target):
        return {k:([{key:v for key,v in row.items()if key!='acl'}for row in val]if k in{'relations','functions'}else val)
                for k,val in target.items()if k!='nonownerPermissions'}
    need(identity(value)==identity(saved['target']),'actual_created_V5_OIDs_owner_body_columns_and_marker_must_stay_exact')
    return {**recorded,'readviewDataOnly':True,'currentRoleGraphQualified':False,'dataIdentitySha256':sha(encoded(identity(value)))}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-sha');g=p.add_mutually_exclusive_group()
    g.add_argument('--rehearse');g.add_argument('--commit');g.add_argument('--reconcile');g.add_argument('--acknowledgement');g.add_argument('--data-current');a=p.parse_args()
    if not any([a.input_sha,a.rehearse,a.commit,a.reconcile,a.acknowledgement,a.data_current]):
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'newReadSchema':READ_SCHEMA,'grantsPrepared':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_V5_creator_host_required');os.umask(0o077)
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_V5_creator_phase_expired'));signal.alarm(240)
    if a.acknowledgement or a.data_current:
        print(json.dumps(data_current(a.data_current)if a.data_current else acknowledgement(a.acknowledgement),sort_keys=True));return
    n,args=build(a.input_sha)
    with args[1].transition_lock():
        fn,value=(n.rehearse,a.rehearse)if a.rehearse else(n.commit,a.commit)if a.commit else(n.reconcile,a.reconcile)if a.reconcile else(n.review,None)
        result=fn(*args,*([value]if value else[]))
    # Detailed private catalog/body observations remain local to the owned BASE.
    out={k:v for k,v in result.items()if k in{'format','reviewHash','rehearsed','created','catalogUnchanged','databaseCommitted','selected','grantsChanged','servicesChanged','nativeDataWritten','providerRequests','readSchema','readIdentity'}}
    if result.get('created'):out['receiptSha256']=sha(protected(BASE/'created.json'))
    print(json.dumps(out,sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
