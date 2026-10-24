# Historical one-time public-file staging/namespace/dependency preflight.
# Completed operation: its exclusive audit path prevents replay.
import json,shlex,subprocess
from pathlib import Path
remote=r'''
import datetime,hashlib,json,os,signal,socket,stat,types,urllib.request
from pathlib import Path
signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(RuntimeError('bounded_coordinator_preparation_expired')));signal.alarm(360)
assert os.geteuid()==0 and socket.gethostname()=='yunipals-main'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020');AUDIT=Path('/var/backups/yunipals-restored-coordinator-host-preparation-v1-20261024')
COMMIT='6bd0f3d772efb968bcc106292f208ccb45acbd21';MANIFEST_SHA='15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
encoded=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def protected(p,expected=None):
 p=Path(p)
 for q in [p,*p.parents]:
  s=q.lstat();assert s.st_uid==s.st_gid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022
 raw=p.read_bytes();assert expected is None or sha(raw)==expected;return raw
def module(p,expected):
 raw=protected(p,expected);v=types.ModuleType(p.stem);v.__file__=str(p);exec(compile(raw,str(p),'exec'),v.__dict__);return v
def save(name,value):
 raw=encoded(value);fd=os.open(AUDIT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 return sha(raw)
restore=module(OPS/'ypal-source-tail-restore-v1.py','de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34')
r,sdk,h,op=restore.load();owner=restore.Owner(r,sdk,h,op)
receipt=json.loads(protected(restore.BASE/'result.json','0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'))
def snapshot():
 actor=restore.canonical_actor(owner.owned());assert actor==receipt['source']
 native=h.native();assert native['tables']==receipt['native']['tables']and native['cache']==receipt['native']['cache'];owner.floors(native)
 return {'source':actor,'peers':owner.preserved(),'inputs':h.inputs(),'nativeTables':native['tables'],'syncCache':native['cache']}
def fetch(name,digest):
 assert '/'not in name and name not in {'.','..'}
 p=OPS/name
 if p.exists():protected(p,digest);return {'file':name,'sha256':digest,'new':False,'mode':stat.S_IMODE(p.stat().st_mode)}
 url='https://raw.githubusercontent.com/protocolmon/yunipals/'+COMMIT+'/ops/unified-indexer-transition/'+name
 raw=urllib.request.urlopen(url,timeout=15).read(1000000);assert sha(raw)==digest
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 protected(p,digest);return {'file':name,'sha256':digest,'new':True,'mode':0o600}
with sdk.lock():
 assert not AUDIT.exists();first=snapshot();AUDIT.mkdir(mode=0o700);save('before.json',first)
 public=json.loads(urllib.request.urlopen('https://api.github.com/repos/protocolmon/yunipals',timeout=10).read(1000000))
 assert public['private']is False and public['full_name']=='protocolmon/yunipals'
 manifest_name='ypal-native-cutover-v2.manifest.json';staged=[fetch(manifest_name,MANIFEST_SHA)]
 manifest=json.loads(protected(OPS/manifest_name,MANIFEST_SHA))
 assert manifest['format']=='yunipals-ypal-native-cutover-source-v2'and len(manifest['files'])==6 and len(manifest['dependencies'])==30
 files={**manifest['files'],**manifest['dependencies']};assert len(files)==36
 for name,digest in files.items():staged.append(fetch(name,digest))
 stage_sha=save('staged.json',{'publicCommit':COMMIT,'files':staged,'existingPermissionsChanged':False})
 root=module(OPS/'ypal-native-cutover-v2.py',files['ypal-native-cutover-v2.py'])
 controller=root.core(MANIFEST_SHA);proof=controller.load_proof(MANIFEST_SHA)
 assert controller.FORMAT=='yunipals-ypal-native-cutover-v2'and controller.BASE==Path('/var/backups/yunipals-ypal-native-cutover-v2-20261024')
 assert not controller.BASE.exists()
 evidence=controller.reuse_evidence
 assert evidence['historicalModulePatched']is evidence['sourceDependentConstructorInherited']is evidence['originalWholeValidatorPassed']is False
 transport=proof.transport_current();assert transport['qualified']is True and transport['receiptSha256']=='521e0bb514f1f6ba306b82d489f19ea53183dcdd2aa1e76aa65498cc184f1899'
 dep=transport['dependencyAuthorizationAtCommandStart'];assert dep['allDependencyTreesMatchedBeforeEvaluation']is True and dep['moduleEvaluationPerformed']is False
 assert snapshot()==first
 result={'format':'yunipals-restored-coordinator-host-preparation-v1','completed':True,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'publicCommit':COMMIT,'manifestSha256':MANIFEST_SHA,'publicFiles':len(staged),'newPublicFiles':sum(v['new']for v in staged),'stageReceiptSha256':stage_sha,
 'operatorSha256':files['ypal-native-cutover-v2.py'],'proofProducerSha256':files['ypal-native-cutover-proof-v2.py'],
 'coordinatorNamespaceQualified':True,'fullMigrationContextQualified':False,'runtimeReceiptsSupplied':False,'actualREADAdmissionQualified':False,
 'currentTransportPrerequisiteQualified':True,'actualPriorPeerQualificationSha256':transport['receiptSha256'],
 'dependencyNodesAuthenticated':dep['dependencyNodes'],'dependencyFilesAuthenticated':dep['dependencyFiles'],'dependencyLinksAuthenticated':dep['dependencyLinks'],
 'unchangedReusedFunctions':evidence['unchangedFunctionCount'],'historicalModulesPatched':False,'nativeAndCacheIdentityPreserved':True,
 'sourceAndServingPeersUnchanged':True,'migrationOperationAbsent':True,'applicationStarted':False,'poolConstructed':False,'sqlChildrenStarted':0,
 'existingPermissionsChanged':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'privateRawReportsExported':False,'sourceBytesTransferredOverSSH':0}
 result_sha=save('result.json',result)
 print(json.dumps({**result,'actualResultFile':str(AUDIT/'result.json'),'actualResultSha256':result_sha},sort_keys=True))
'''
cp=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes','-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -c '+shlex.quote(remote)],capture_output=True,text=True,timeout=380)
if cp.returncode:
 print(json.dumps({'completed':False,'exitCode':cp.returncode,'privateDiagnosticBytes':len(cp.stderr)}));raise SystemExit(cp.returncode)
assert not cp.stderr
value=json.loads(cp.stdout);p=Path('/tmp/yunipals-restored-coordinator-host-preparation-production-20261024.json')
with p.open('x')as f:json.dump(value,f,sort_keys=True);f.write('\n')
p.chmod(0o600);print(json.dumps(value,sort_keys=True))
