#!/usr/bin/env python3
"""Root-only read-only diagnostic; raw observations remain in a new private audit."""
import ast
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import traceback
import types

FORMAT='yunipals-root-native-derived-boundary-diagnostic-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OWNER=OPS/'arena-native-derived-projector-v3.py'
OWNER_SHA='ecf16bd928226d0ec1ad7dd894deffa0a481101f211f16324dfe000bb5284536'
SOURCE_MANIFEST=OPS/'arena-native-derived-projector-v3.manifest.json'
SOURCE_MANIFEST_SHA='18148bc422d0ec31a3759be81f17d28e222bb8accb66f65167f77318daa5ea93'
NODE_PROGRAM=OPS/'arena-native-derived-boundary-diagnostic-v1.mjs'
NODE_PROGRAM_SHA='6a97f5c6cc37bd4790ef0f9b15438652fc7ba3580de5aad0af4faa16fcadbed7'
SUPPORT_MANIFEST_SHA='b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443'
AUDIT=Path('/var/backups/yunipals-root-native-projector-boundary-diagnostic-v1-20261025')
INPUT=Path('/var/backups/yunipals-arena-native-derived-projector-input-v3-20261025/input.json')
BASE=Path('/var/backups/yunipals-arena-native-derived-projector-v3-20261025')
CLEAN={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','TSX_DISABLE_CACHE':'1'}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64


def protected(path,digest=None,maximum=4000000):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_actual_boundary_diagnostic_file_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
        all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or pin(digest)and sha(raw)==digest),'same_actual_boundary_diagnostic_file_required')
    return raw


def authenticate(input_sha):
    need(pin(input_sha),'actual_projector3_input_SHA_required');raw=protected(OWNER,OWNER_SHA)
    tree=ast.parse(raw)
    def literal(name):
        rows=[n for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id==name]
        need(len(rows)==1,'one_literal_projector3_source_map_required');return ast.literal_eval(rows[0].value)
    expected={'format':'yunipals-arena-native-derived-projector-owner-v3-source',
        'files':{OWNER.name:OWNER_SHA,**literal('SOURCE_PINS')},'externalPrograms':literal('EXTERNAL_PROGRAMS')}
    need(json.loads(protected(SOURCE_MANIFEST,SOURCE_MANIFEST_SHA))==expected,'complete_actual_projector3_source_before_evaluation_required')
    for name,digest in expected['files'].items():
        need(re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)and pin(digest),'finite_projector3_diagnostic_source_map_required')
        protected(OPS/name,digest)
    for name,digest in expected['externalPrograms'].items():
        need(Path(name).parent==Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023')and
            Path(name).name in{'admit-target.py','credentials.py','manifest.json','proposal.json','roles.sql','schema.sql'},
            'only_actual_original_target_sources_allowed');protected(Path(name),digest)
    protected(NODE_PROGRAM,NODE_PROGRAM_SHA);protected(INPUT,input_sha,65536)
    return raw


def runtime(input_sha):
    raw=authenticate(input_sha);value=types.ModuleType('actual_projector3_boundary_diagnostic');value.__file__=str(OWNER)
    exec(compile(raw,str(OWNER),'exec'),value.__dict__);return value.composition()


def save(name,raw):
    path=AUDIT/name;fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:os.fchmod(stream.fileno(),0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())
    fd=os.open(AUDIT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return sha(raw)


def invoke(owner,node):
    need(node==Path('/opt/node-v24.18.1/bin/node'),'actual_fixed_installed_Node_required')
    native=owner.connect_pool('native')
    try:target=owner.connect_pool('target')
    except BaseException:native.close();raise
    descriptor=os.memfd_create('arena-native-derived-config',os.MFD_CLOEXEC|os.MFD_ALLOW_SEALING)
    try:
        config={**owner.public_config(),'nativeReadPoolFd':native.fileno(),'publicReadPoolFd':target.fileno(),
            'readPoolIdentity':owner.pool_identity(owner.actor())}
        os.fchmod(descriptor,0o600);os.write(descriptor,encoded(config));os.lseek(descriptor,0,0)
        fcntl.fcntl(descriptor,fcntl.F_ADD_SEALS,fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL)
        user=pwd.getpwnam('postgres');need(user.pw_uid>0 and user.pw_gid>0,'actual_restricted_postgres_identity_required')
        args=['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','--inh-caps=-all',
            '--ambient-caps=-all','--bounding-set=-all','--no-new-privs',str(node),str(NODE_PROGRAM),'--diagnose','--config-fd',str(descriptor)]
        return subprocess.run(args,env=CLEAN,pass_fds=(descriptor,native.fileno(),target.fileno()),capture_output=True,timeout=120)
    finally:os.close(descriptor);native.close();target.close()


def capture(input_sha):
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_readonly_boundary_diagnostic_host_required')
    os.umask(0o077);namespace=runtime(input_sha)
    need(namespace.BASE==BASE and namespace.INPUT==INPUT,'actual_projector3_runtime_and_input_namespace_required')
    need(not os.path.lexists(BASE/'result.json'),'preserve_original_absent_projector3_capture_result_required')
    owner=namespace.Owner(input_sha,SUPPORT_MANIFEST_SHA);before=owner.actor()
    need(namespace.document(BASE/'started.json')==before,'same_genuine_once_started_projector3_epoch_required')
    socket_before=owner.socket_identity(before)
    for parent in[AUDIT.parent,*AUDIT.parent.parents]:
        row=parent.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_new_boundary_audit_parent_required')
    os.mkdir(AUDIT,0o700);failure=None;private=None;child=None;after=None;socket_after=None
    try:
        child=invoke(owner,namespace.NODE)
        need(len(child.stdout)<=8000000 and len(child.stderr)<=8000000,'bounded_private_boundary_child_output_required')
        save('child.stdout.private.json',child.stdout);save('child.stderr.private.txt',child.stderr)
        rows=child.stdout.splitlines();need(len(rows)==1,'one_private_boundary_diagnostic_record_required')
        private=json.loads(rows[0]);need(private['format']==FORMAT and private['databaseWrites']==private['serviceActions']==private['providerCalls']==0,
            'actual_readonly_boundary_diagnostic_envelope_required')
    except BaseException as error:
        raw=traceback.format_exc().encode();save('failure.private.txt',raw);failure={'exceptionClass':type(error).__name__,'privateTraceSha256':sha(raw)}
    try:
        after=owner.actor();socket_after=owner.socket_identity(after)
        need(after==before and socket_after==socket_before and namespace.document(BASE/'started.json')==before and
            not os.path.lexists(BASE/'result.json'),'same_worker_epoch_socket_and_absent_original_result_after_diagnostic_required')
        authenticate(input_sha)
    except BaseException as error:
        raw=traceback.format_exc().encode();save('postflight-failure.private.txt',raw)
        failure={'exceptionClass':type(error).__name__,'privateTraceSha256':sha(raw),'postflightFailed':True}
    summary=private.get('summary',{})if type(private)is dict else{}
    allowed={'sampledNativeAndTarget','cursorRelation','savedHashMatchesNativeComplete','savedBoundaryCanonical',
        'finalizedAgeMilliseconds','finalizedFresh180Seconds','nativeFrameworkReady','nativeRunning'}
    need(type(summary)is dict and set(summary)<=allowed and all(type(value)in{bool,int,float,str,type(None)}for value in summary.values())and
        summary.get('cursorRelation','unavailable')in{'strictly-behind','equal','ahead','unavailable'},
        'only_scalar_boundary_diagnostic_summary_allowed')
    result={'format':FORMAT,'completed':failure is None and private is not None and private.get('completed')is True and
        private.get('bothReadClientsClosed')is True and child.returncode==0 and not child.stderr,
        'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectorProducerSha256':OWNER_SHA,
        'inputSha256':input_sha,'diagnosticNodeSha256':NODE_PROGRAM_SHA,'supportManifestSha256':SUPPORT_MANIFEST_SHA,
        'sameWorkerEpoch':after==before,'samePoolSocket':socket_after==socket_before,'originalCaptureResultStillAbsent':not os.path.lexists(BASE/'result.json'),
        'summary':summary,'inspectionSucceeded':private.get('inspectionSucceeded',False)if private else False,
        'canonicalProbeIsSeparateFreshSnapshot':True,
        'genuineUnchangedExportedInspector':private.get('genuineUnchangedExportedInspector')is True if private else False,
        'privateChildStdoutSha256':None if child is None else sha(child.stdout),'privateChildStderrSha256':None if child is None else sha(child.stderr),
        'failure':failure,'currentProjectionQualified':False,'retryAuthorized':False,'runtimeRestarted':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    digest=save('result.json',encoded(result));return{**result,'resultSha256':digest}


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--capture',action='store_true');parser.add_argument('--input-sha');args=parser.parse_args()
    if not args.capture:
        need(args.input_sha is None,'explicit_capture_required_with_actual_input_SHA')
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(pin(args.input_sha),'actual_projector3_input_SHA_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_readonly_boundary_diagnostic_expired'));signal.alarm(240)
    try:print(json.dumps(capture(args.input_sha),sort_keys=True))
    finally:signal.alarm(0)

if __name__=='__main__':main()
