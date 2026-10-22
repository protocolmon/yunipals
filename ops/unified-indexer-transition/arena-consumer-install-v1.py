#!/usr/bin/env python3
"""Install the completed offline consumer artifact into a fresh, unselected release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import types

OPS=Path('/opt/yunipals-unified/operations/arena-consumer-package-20261021-d')
WORK=Path('/mnt/HC_Volume_107222036/arena-consumer-package-20261021-d')
SOURCE='3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d'
TARGET=Path('/opt/yunipals-unified/releases')/SOURCE
ARTIFACT=Path('/var/tmp/yunipals-runtime-3c8776b9-20261021')
PROOF=WORK/'arena-consumer-package-proof.json'
BUILD_REVIEW='b245d6e199b5aa4306c3e66c3c121c719c6b1951b664dbcc1d4e3e214c866bb9'
PACKAGE_SHA='846e4d641b57c5de5e44ba281636a98b3dedc328e1ffcbf460f3ce156de0793b'
ENV={'PATH':'/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC','PYTHONDONTWRITEBYTECODE':'1'}
FORMAT='yunipals-arena-consumer-install-v1'

def fail(code):raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
def save(path,value):
 with path.open('xb')as f:f.write(encoded(value));f.flush();os.fsync(f.fileno())

def modules():
 path=OPS/'arena-consumer-package-v4.py'
 for p in [*path.parents,path]:
  s=p.lstat()
  if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_package_helper_required')
 raw=path.read_bytes()
 if len(raw)>100000 or sha(raw)!=PACKAGE_SHA:fail('exact_package_helper_required')
 m=types.ModuleType('completed_arena_package');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__)
 return m,m.load(OPS/'source6-package-v3.py',m.PRIMITIVES_SHA),m.load(OPS/'runtime-supplement.py',m.RUNTIME_HELPER_SHA)

def review(pin):
 if not re.fullmatch('[0-9a-f]{64}',pin):fail('exact_completed_build_proof_hash_required')
 m,p,h=modules();proof=json.loads(p.pinned(PROOF,pin,100000))
 result=json.loads(p.trusted(WORK/'attempt-result.json',100000));output=json.loads(p.trusted(OPS/'actual-build.stdout.json',100000))
 if (proof.get('format')!=m.FORMAT or proof.get('status')!='passed'or proof.get('reviewHash')!=BUILD_REVIEW or proof.get('sourceDigest')!=SOURCE or
     result.get('status')!='passed'or result.get('proofSha256')!=pin or output.get('status')!='passed'or output.get('proofSha256')!=pin or
     proof['source'].get('manifestSha256')!='1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8'or
     proof['verification'].get('twoFullTypechecks')is not True or proof['verification'].get('ordinaryMarketBuilds')!=2 or
     proof['runtime'].get('separateRelocatedTreeRebuildByteIdentical')is not True or proof['runtime'].get('entries')!=60918 or
     proof['verification'].get('dependencyPackages')!=330 or proof['verification'].get('nativePonderBuildPerformed')is not False or
     proof['nativeUnits'].get('unitsInstalledOrStarted')is not False or len(proof['nativeUnits'].get('files',{}))!=8):fail('accepted_completed_consumer_build_required')
 r=subprocess.run(['/usr/bin/systemctl','show','yunipals-arena-consumer-package-v4-build-20261021.service','--property=ActiveState,MainPID,Result,ExecMainStatus'],env=ENV,capture_output=True,text=True,check=True,timeout=5)
 if dict(x.split('=',1)for x in r.stdout.splitlines())!={'ActiveState':'inactive','MainPID':'0','Result':'success','ExecMainStatus':'0'}:fail('successful_stopped_offline_build_required')
 if os.path.lexists(TARGET)or os.path.lexists(ARTIFACT):fail('fresh_consumer_artifact_destinations_required')
 for path in [*TARGET.parent.parents,TARGET.parent]:
  st=path.lstat()
  if not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or st.st_mode&0o022:fail('protected_consumer_release_ancestry_required')
 p.checked_file_hash(Path(m.NODE),m.NODE_SHA,150000000)
 if shutil.disk_usage(TARGET.parent).free<27_000_000_000:fail('consumer_install_reserve_required')
 manifest=h.source_check(WORK/'source',SOURCE)
 if len(manifest['files'])!=1746:fail('exact_consumer_source_inventory_required')
 invpath=WORK/'runtime-a/runtime-supplement.inventory.json'
 inventory=json.loads(p.pinned(invpath,proof['runtime']['inventorySha256'],40000000))
 p.checked_file_hash(WORK/'runtime-a/runtime-supplement.tar.gz',proof['runtime']['archiveSha256'],250000000)
 if inventory.get('sourceDigest')!=SOURCE or inventory.get('sourceManifestSha256')!=proof['source']['manifestSha256']or inventory.get('archiveSha256')!=proof['runtime']['archiveSha256']:fail('exact_consumer_runtime_binding_required')
 value={'format':FORMAT,'proofSha256':pin,'sourceDigest':SOURCE,'manifestSha256':proof['source']['manifestSha256'],'runtimeArchiveSha256':proof['runtime']['archiveSha256'],'runtimeInventorySha256':proof['runtime']['inventorySha256'],'target':str(TARGET),'artifact':str(ARTIFACT),'serviceChanges':0,'databaseChanges':0,'sourceSelectionsChanged':0}
 return value,m,p,h,manifest,inventory

def install(data,expected):
 value,m,p,h,manifest,inventory=data
 if sha(encoded(value))!=expected:fail('exact_fresh_install_review_required')
 ARTIFACT.mkdir(mode=0o700);save(ARTIFACT/'install-intent.json',value)
 phase='copy_public_source'
 try:
  p.copy_source(WORK/'source',TARGET,manifest)
  for name,src,pin,limit in [('arena-consumer-package-proof.json',PROOF,value['proofSha256'],100000),('runtime-supplement.tar.gz',WORK/'runtime-a/runtime-supplement.tar.gz',value['runtimeArchiveSha256'],250000000),('runtime-supplement.inventory.json',WORK/'runtime-a/runtime-supplement.inventory.json',value['runtimeInventorySha256'],40000000)]:
   phase='copy_public_runtime_inputs';p.checked_file_hash(src,pin,limit)
   with src.open('rb')as incoming,(ARTIFACT/name).open('xb')as out:shutil.copyfileobj(incoming,out,1048576);out.flush();os.fsync(out.fileno())
   p.checked_file_hash(ARTIFACT/name,pin,limit)
  phase='exclusive_runtime_install'
  args=['/usr/bin/python3','-B',str(OPS/'runtime-supplement.py'),'install','--archive',str(ARTIFACT/'runtime-supplement.tar.gz'),'--inventory',str(ARTIFACT/'runtime-supplement.inventory.json'),'--archive-sha256',value['runtimeArchiveSha256'],'--inventory-sha256',value['runtimeInventorySha256'],'--target',str(TARGET),'--node',m.NODE]
  r=subprocess.run(args,env=ENV,capture_output=True,timeout=240)
  if r.returncode or max(len(r.stdout),len(r.stderr))>100000:fail('exclusive_consumer_runtime_install_failed')
  result=json.loads(r.stdout)
  if result.get('entriesVerified')!=60918 or result.get('sourceDigest')!=SOURCE or result.get('sourceUnchanged')is not True or result.get('networkCalls')!=0:fail('actual_consumer_runtime_install_proof_required')
  phase='public_source_permissions';parents={TARGET}
  for name in ['RELEASE-MANIFEST.json','SHA256SUMS',*[row['path']for row in manifest['files']]]:
   path=TARGET/name
   if path.is_symlink()or not path.is_file():fail('new_regular_public_source_required')
   path.chmod(0o644);parents.update(parent for parent in path.parents if parent==TARGET or parent.is_relative_to(TARGET))
  for path in parents:
   if path.is_symlink()or not path.is_dir():fail('new_public_source_directory_required')
   path.chmod(0o755)
  phase='installed_payload_verification';h.source_check(TARGET,SOURCE);roots,entries=h.inventory_entries(TARGET)
  if roots!=inventory['roots']or entries!=inventory['entries']:fail('actual_installed_runtime_bytes_changed')
  if shutil.disk_usage(TARGET.parent).free<25_000_000_000:fail('consumer_install_reserve_breached')
  result={**value,'installed':True,'installedEntriesVerified':len(entries),'sourceFilesVerified':len(manifest['files']),'runtimeStarted':False,'olderArtifactsModified':False}
  save(ARTIFACT/'install-result.json',result);return result
 except BaseException as error:
  save(ARTIFACT/'install-failed.json',{'format':FORMAT,'phase':phase,'errorClass':type(error).__name__,'partialNewArtifactRetained':True,'automaticRetry':False});raise

def main():
 a=argparse.ArgumentParser(description=__doc__);a.add_argument('--proof-sha256',required=True);a.add_argument('--install');args=a.parse_args()
 if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_root_host_required')
 os.umask(0o077);os.environ.clear();os.environ.update(ENV)
 signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(600)
 data=review(args.proof_sha256)
 result=install(data,args.install)if args.install else{'format':FORMAT,'reviewHash':sha(encoded(data[0])),'applied':False,**data[0]}
 print(json.dumps(result,sort_keys=True))

if __name__=='__main__':
 try:main()
 except BaseException as error:
  print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'rawMessagesExported':False}));raise SystemExit(1)
