#!/usr/bin/env python3
"""Explicit native120 continuation entry; actual policy and new authority input required."""
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-continue-v6.py'
FORMAT='yunipals-ypal-ordinary-publication-continue-v6'
HELPER=OPS/'ypal-ordinary-readiness-family-v1.py'
HELPER_SHA='fe24870db3a6adb079c28c57c5ae1cfa77bbf8b3e6b039c967b2fc352811c346'

def family(policy_refs,authority_input_sha):
    for item in[*HELPER.parents,HELPER]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_native120_family_entry_required')
    before=HELPER.lstat();raw=HELPER.read_bytes();after=HELPER.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<500000 or hashlib.sha256(raw).hexdigest()!=HELPER_SHA or any(
        getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_native120_family_entry_required')
    value=types.ModuleType('explicit_native120_family');value.__file__=str(HELPER)
    exec(compile(raw,str(HELPER),'exec'),value.__dict__);return value.Family(policy_refs,authority_input_sha)

def composed(manifest_sha,metadata_refs,policy_refs,authority_input_sha,inverse=False):
    return family(policy_refs,authority_input_sha).composed(manifest_sha,metadata_refs,inverse)
def Session(source_refs,manifest_sha,metadata_refs,policy_refs,authority_input_sha,inverse=False):
    value=composed(manifest_sha,metadata_refs,policy_refs,authority_input_sha,inverse)
    session=value.Session(source_refs,inverse);session.continuation_caller=value;return session

def retained(session):
    return session.continuation_caller.native_readiness_family.utility().load(OPS/'ypal-ordinary-publication-continue-v1.py',
        '6bf7e33971d3331d84ba843ca4952db3f9024ebcee56fba0ff67a5cecbab0151')
def construct_records(session,capture_id):return retained(session).construct_records(session,capture_id)
def qualify_held(session,capture_id):return retained(session).qualify_held(session,capture_id)
def execute_cache(session,action,args,attempt_id,held_qualification=None):return retained(session).execute_cache(session,action,args,attempt_id,held_qualification)
def qualify_reader(session,capture_id):return retained(session).qualify_reader(session,capture_id)
def execute_reader(session,action,args,attempt_id,timing_receipt=None):return retained(session).execute_reader(session,action,args,attempt_id,timing_receipt)

if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('actual_native120_policy_receipt_and_new_owned_context_required')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'old90SecondQualificationClaimed':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
