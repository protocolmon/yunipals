#!/usr/bin/env python3
"""Root-only paired genuine projector reviews; default/import are inert."""
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import traceback
import types

FORMAT='yunipals-root-native-projector-paired-review-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OWNER=OPS/'arena-native-derived-projector-v2.py'
OWNER_SHA='c1d07cad212bf204882b0680cb074803cfa5e139129db369aebb141a5a20a4db'
SOURCE_MANIFEST=OPS/'arena-native-derived-projector-v2.manifest.json'
SOURCE_MANIFEST_SHA='11c769f791261e18787d7c44fcb4c0cb3551e692bdf27dcd6074d38c08ce3d7b'
INPUT=Path('/var/backups/yunipals-arena-native-derived-projector-input-v2-20261025/input.json')
INPUT_SHA='1c43578b31c5c42200b7e5982621b939bd6f083ede581cc7939bc9506a7dd134'
SUPPORT_MANIFEST=OPS/'arena-native-derived-support-v2.manifest.json'
SUPPORT_MANIFEST_SHA='b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443'
AUDIT=Path('/var/backups/yunipals-root-native-projector-paired-review-v1-20261025')
BASE=Path('/var/backups/yunipals-arena-native-derived-projector-v2-20261025')
PUBLIC=Path('/opt/yunipals-unified/arena-recovery-support/projector-v1-20261025')
UNIT='yunipals-arena-native-derived-projector-v1.service'
SOCKET_UNIT='yunipals-arena-native-derived-projector-v1.socket'
SOCKET=PUBLIC/'native-read.sock'
MAXIMUM_SECONDS=420


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def protected(path,digest=None,maximum=4000000,private=False):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_actual_projector_review_file_required')
    key=lambda row:tuple(getattr(row,name)for name in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    before=path.lstat();fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        raw=os.read(fd,maximum+1)
        need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
            key(before)==key(os.fstat(fd))==key(path.lstat())and(digest is None or sha(raw)==digest)and
            (not private or stat.S_IMODE(before.st_mode)==0o600),'same_actual_projector_review_file_required')
        return raw
    finally:os.close(fd)


def authenticate():
    raw=protected(OWNER,OWNER_SHA);manifest=json.loads(protected(SOURCE_MANIFEST,SOURCE_MANIFEST_SHA));tree=ast.parse(raw)
    def literal(name):
        nodes=[n for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and
            isinstance(n.targets[0],ast.Name)and n.targets[0].id==name]
        need(len(nodes)==1,'one_literal_actual_projector_source_map_required');return ast.literal_eval(nodes[0].value)
    need(manifest=={'format':'yunipals-arena-native-derived-projector-owner-v2-source',
        'files':{OWNER.name:OWNER_SHA,**literal('SOURCE_PINS')},'externalPrograms':literal('EXTERNAL_PROGRAMS')},
        'actual_complete_projector2_source_manifest_required_before_evaluation')
    for name,digest in manifest['files'].items():
        need(re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)and re.fullmatch('[a-f0-9]{64}',digest),
            'fixed_finite_projector_review_source_file_required')
        protected(OPS/name,digest)
    for name,digest in manifest['externalPrograms'].items():
        need(Path(name).parent==Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023')and
            Path(name).name in{'admit-target.py','credentials.py','manifest.json','proposal.json','roles.sql','schema.sql'},
            'only_actual_original_target_admission_sources_allowed')
        protected(Path(name),digest)
    protected(INPUT,INPUT_SHA,65536,True);protected(SUPPORT_MANIFEST,SUPPORT_MANIFEST_SHA)
    return raw


def runtime():
    raw=authenticate();value=types.ModuleType('actual_paired_projector2_review');value.__file__=str(OWNER)
    exec(compile(raw,str(OWNER),'exec'),value.__dict__)
    return value.composition()


def absent(owner):
    need(owner.BASE==BASE and owner.PUBLIC==PUBLIC and owner.UNIT==UNIT and owner.SOCKET_UNIT==SOCKET_UNIT and owner.SOCKET==SOCKET,
        'actual_inherited_projector2_runtime_namespace_required')
    paths=[BASE,PUBLIC,Path('/etc/systemd/system')/UNIT,Path('/etc/systemd/system')/SOCKET_UNIT,SOCKET]
    need(not any(os.path.lexists(path)for path in paths),'projector_BASE_PUBLIC_unit_and_socket_must_all_be_absent')
    values={name:owner.Owner.state(owner.Owner.__new__(owner.Owner),name)for name in[UNIT,SOCKET_UNIT]}
    need(all(value['LoadState']=='not-found'and value['ActiveState']=='inactive'and value['SubState']=='dead'and
        value['MainPID']==value['ControlPID']=='0'and value['Job']==value['FragmentPath']==value['DropInPaths']==''
        for value in values.values()),'both_projector_manager_units_must_be_absent_and_terminal')
    return values


def save(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())


def changes(first,last,path='',depth=0):
    if first==last:return []
    if depth>=8 or type(first)is not dict or type(last)is not dict:return[path or '$']
    result=[]
    for key in sorted(set(first)|set(last)):
        label=key if type(key)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_-]{0,79}',key)else'keySha256_'+sha(encoded(key))
        target=(path+'.'if path else'')+label
        result+=[target]if key not in first or key not in last else changes(first[key],last[key],target,depth+1)
    return result


def capture():
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_readonly_projector_review_host_required')
    os.umask(0o077);owner=runtime();before=absent(owner)
    for parent in[AUDIT.parent,*AUDIT.parent.parents]:
        row=parent.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_exclusive_projector_review_audit_parent_required')
    os.mkdir(AUDIT,0o700);values=[];owners=[];failure=None;post=None
    try:
        for index in range(2):
            absent(owner);fresh=owner.Owner(INPUT_SHA,SUPPORT_MANIFEST_SHA);owners.append(fresh)
            value=owner.review_start(fresh)
            raw=owner.encoded(value);need(type(raw)is bytes,'genuine_original_review_encoding_required')
            save(AUDIT/(str(index)+'-review.private.json'),raw);values.append(value)
        need(owners[0]is not owners[1],'two_genuine_separately_constructed_owner_reviews_required')
    except BaseException as error:
        private=traceback.format_exc().encode();save(AUDIT/'failure.private.txt',private)
        failure={'exceptionClass':type(error).__name__,'privateTraceSha256':sha(private)}
    try:
        post=absent(owner);need(post==before,'projector_manager_absent_state_changed_during_paired_review')
        authenticate()
    except BaseException as error:
        private=traceback.format_exc().encode();save(AUDIT/'postflight-failure.private.txt',private)
        failure={'exceptionClass':type(error).__name__,'privateTraceSha256':sha(private),'postflightFailed':True}
    paths=changes(*values)if len(values)==2 else[]
    result={'format':FORMAT,'completed':failure is None and len(values)==2,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'projectorProducerSha256':OWNER_SHA,'inputSha256':INPUT_SHA,'supportManifestSha256':SUPPORT_MANIFEST_SHA,
        'separateOwnerObjects':len(owners)==2 and owners[0]is not owners[1],'sameProcess':True,'reviewCount':len(values),
        'reviewHashes':[owner.sha(owner.encoded(value))for value in values],
        'topFieldHashes':{key:[sha(owner.encoded(value[key]))if key in value else None for value in values]
            for key in sorted(set().union(*(v.keys()for v in values)))},
        'changedPaths':paths[:256],'changedPathCount':len(paths),'changedPathsTruncated':len(paths)>256,
        'namespaceAndManagerAbsentBeforeAfter':post is not None and post==before,
        'managerStateSha256Before':sha(encoded(before)),'managerStateSha256After':None if post is None else sha(encoded(post)),
        'failure':failure,'historicalFailedPairCauseProved':False,'runtimeStarted':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    raw=encoded(result);save(AUDIT/'result.json',raw)
    return{**result,'resultSha256':sha(raw)}


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--capture',action='store_true');args=parser.parse_args()
    if not args.capture:print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_paired_readonly_projector_review_expired'));signal.alarm(MAXIMUM_SECONDS)
    try:print(json.dumps(capture(),sort_keys=True))
    finally:signal.alarm(0)


if __name__=='__main__':main()
