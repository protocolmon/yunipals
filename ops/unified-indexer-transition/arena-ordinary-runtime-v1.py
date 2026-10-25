#!/usr/bin/env python3
"""Exclusive public Arena readiness artifact installation; no unit or DB effects."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat

FORMAT='yunipals-arena-ordinary-runtime-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
MANIFEST=OPS/'arena-ordinary-latest-complete-v1.manifest.json'
MANIFEST_SHA='73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf'
ARTIFACT='e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234'
PREDECESSOR='264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24'
DEPENDENCIES=Path('/opt/yunipals-unified/releases')/PREDECESSOR/'apps/yunipals-market-api/node_modules'
TARGET=Path('/opt/yunipals-unified/arena-runtime')/ARTIFACT
INPUT=Path('/mnt/HC_Volume_107222036/arena-ordinary-latest-complete-v1/artifact')
BASE=Path('/var/backups/yunipals-arena-ordinary-runtime-v1-20261025')


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def identity(path):
    r=path.lstat();return{k:getattr(r,k)for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink']}
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def new_directory(path,mode):
    path.mkdir(mode=mode);os.chmod(path,mode);sync(path.parent)
def protected(path,maximum=2000000):
    for p in [*path.parents,path]:
        r=p.lstat();need(r.st_uid==0 and not stat.S_ISLNK(r.st_mode)and not r.st_mode&0o022,'protected_public_Arena_runtime_input_required')
    first=path.lstat();key=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        raw=os.read(fd,maximum+1)
        need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and len(raw)==first.st_size<=maximum and
             key(first)==key(os.fstat(fd))==key(path.lstat()),'single_unchanged_public_Arena_runtime_file_required')
    finally:os.close(fd)
    return raw
def manifest():
    raw=protected(MANIFEST);need(sha(raw)==MANIFEST_SHA,'exact_Arena_readiness_artifact_manifest_required');m=json.loads(raw)
    need(m['format']=='yunipals-arena-ordinary-latest-complete-artifact-v1'and m['artifactDigest']==ARTIFACT and
         m['predecessorSourceDigest']==PREDECESSOR and len(m['files'])==16 and m['nativeWorkerUnits']==8 and
         m['businessBodiesChanged']is m['contractsChanged']is False,'only_acknowledged_Arena_readiness_delta_required')
    return raw,m
def layout(root,m):
    need(root.is_dir()and not root.is_symlink()and stat.S_IMODE(root.stat().st_mode)==0o755 and
         stat.S_IMODE((root/'dist').stat().st_mode)==0o755,'owned_public_Arena_runtime_directory_required')
    expected={'manifest.json','dist','node_modules'}
    need({p.name for p in root.iterdir()}==expected and not(root/'dist').is_symlink(),'finite_Arena_runtime_layout_required')
    need({p.name for p in(root/'dist').iterdir()}=={Path(r['path']).name for r in m['files']},'only_exact_sixteen_Arena_outputs_required')
    raw=protected(root/'manifest.json');need(sha(raw)==MANIFEST_SHA,'same_installed_Arena_manifest_required')
    rows={}
    for row in m['files']:
        p=root/row['path'];raw=protected(p,4000000)
        need(len(raw)==row['bytes']and sha(raw)==row['sha256']and stat.S_IMODE(p.stat().st_mode)==0o644,'exact_installed_Arena_artifact_file_required')
        rows[row['path']]={'sha256':row['sha256'],'identity':identity(p)}
    link=root/'node_modules';s=link.lstat()
    need(stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and os.readlink(link)==str(DEPENDENCIES)and DEPENDENCIES.is_dir(),
         'same_previously_installed264a_dependency_link_required')
    return {'files':rows,'manifest':identity(root/'manifest.json'),'root':identity(root),'dist':identity(root/'dist'),'dependencyLink':identity(link)}
def exclusive(path,raw,mode):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),mode);out.write(raw);out.flush();os.fsync(out.fileno())
    sync(path.parent)
def own_sha():return sha(Path(__file__).read_bytes())
def review():
    raw,m=manifest();need(not os.path.lexists(TARGET)and not os.path.lexists(BASE),'fresh_Arena_runtime_and_install_journal_required')
    need(sha(protected(INPUT/'manifest.json'))==MANIFEST_SHA,'actual_local_Arena_build_required_before_install')
    files={r['path']:protected(INPUT/r['path'],4000000)for r in m['files']}
    need(all(len(files[r['path']])==r['bytes']and sha(files[r['path']])==r['sha256']for r in m['files']),
         'all_actual_built_Arena_outputs_must_match_manifest')
    need(DEPENDENCIES.is_dir(),'retained264a_dependencies_must_already_exist')
    return {'format':FORMAT,'operatorSha256':own_sha(),'artifactDigest':ARTIFACT,'manifestSha256':MANIFEST_SHA,
      'inputFiles':{name:{'sha256':sha(body),'identity':identity(INPUT/name)}for name,body in files.items()},
      'dependencies':{'path':str(DEPENDENCIES),'identity':identity(DEPENDENCIES)},'target':str(TARGET),'serviceActions':0,'databaseWrites':0,'providerCalls':0},raw,m,files
def install(expected):
    binding,raw,m,files=review();need(sha(encoded(binding))==expected,'exact_Arena_runtime_install_review_required')
    new_directory(BASE,0o700);exclusive(BASE/'intent.json',encoded(binding),0o600)
    if not TARGET.parent.exists():new_directory(TARGET.parent,0o755)
    r=TARGET.parent.lstat();need(stat.S_ISDIR(r.st_mode)and r.st_uid==r.st_gid==0 and stat.S_IMODE(r.st_mode)==0o755,'protected_new_runtime_parent_required')
    new_directory(TARGET,0o755);new_directory(TARGET/'dist',0o755)
    exclusive(TARGET/'manifest.json',raw,0o644)
    for name,body in files.items():exclusive(TARGET/name,body,0o644)
    (TARGET/'node_modules').symlink_to(DEPENDENCIES,target_is_directory=True);sync(TARGET)
    result={'format':FORMAT,'operatorSha256':own_sha(),'intentSha256':sha(protected(BASE/'intent.json')),
      'artifactDigest':ARTIFACT,'manifestSha256':MANIFEST_SHA,'installed':True,'target':str(TARGET),'layout':layout(TARGET,m),
      'predecessorRuntimeQualified':False,'runtimeDependenciesQualified':False,'workersConstructed':False,'runtimeSelected':False,
      'serviceActions':0,'databaseWrites':0,'providerCalls':0}
    exclusive(BASE/'result.json',encoded(result),0o600);return result
def installed(receipt_sha):
    raw,m=manifest();value=json.loads(protected(BASE/'result.json'));need(sha(protected(BASE/'result.json'))==receipt_sha,'actual_Arena_runtime_install_ACK_required')
    intent_raw=protected(BASE/'intent.json');intent=json.loads(intent_raw)
    need(value['format']==FORMAT and value['operatorSha256']==own_sha()and value['intentSha256']==sha(intent_raw)and
         intent['format']==FORMAT and intent['operatorSha256']==own_sha()and intent['target']==str(TARGET)and
         intent['dependencies']=={'path':str(DEPENDENCIES),'identity':identity(DEPENDENCIES)}and
         value['artifactDigest']==intent['artifactDigest']==ARTIFACT and value['manifestSha256']==intent['manifestSha256']==MANIFEST_SHA and
         value['target']==str(TARGET)and value['installed']is True and value['runtimeSelected']is False and
         value['layout']==layout(TARGET,m),'exact_owned_installed_Arena_artifact_chain_required')
    return value
def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--review',action='store_true');g.add_argument('--install');g.add_argument('--installed');a=p.parse_args()
    if not any([a.review,a.install,a.installed]):print(json.dumps({'format':FORMAT,'sourceOnly':True,'serviceActions':0,'databaseWrites':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and os.uname().nodename=='yunipals-main','fixed_root_Arena_runtime_host_required');os.umask(0o077)
    if a.review:
        value=review()[0];print(json.dumps({'format':FORMAT,'reviewHash':sha(encoded(value)),'files':16,'serviceActions':0,'databaseWrites':0,'providerCalls':0}));return
    value=installed(a.installed)if a.installed else install(a.install)
    print(json.dumps({'format':FORMAT,'installed':True,'receiptSha256':sha(encoded(value)),'artifactDigest':ARTIFACT,'files':16,'runtimeSelected':False,'serviceActions':0,'databaseWrites':0,'providerCalls':0}))
if __name__=='__main__':main()
