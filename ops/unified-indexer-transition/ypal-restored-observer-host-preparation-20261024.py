# Historical one-time public-file staging/read-only preflight runner.
# The actual operation has completed; its exclusive audit path prevents replay.
import json,shlex,subprocess
from pathlib import Path
remote=r'''
import datetime,hashlib,json,os,signal,socket,stat,types,urllib.request
from pathlib import Path
signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(RuntimeError('bounded_observer_preparation_expired')));signal.alarm(240)
assert os.geteuid()==0 and socket.gethostname()=='yunipals-main'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020');AUDIT=Path('/var/backups/yunipals-restored-observer-host-preparation-v1-20261024')
COMMIT='bcd245b5ad437f3726e62cdf571e3758e35a0772'
FILES={
'ypal-restored-read-current-context-v1.py':'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932',
'ypal-restored-metadata-context-v1.py':'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4',
'ypal-restored-read-admission-v1.py':'91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4',
'ypal-restored-read-admission-v1.columns.sql':'8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf',
'ypal-restored-ordinary-observer-v1.py':'62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3',
'ypal-restored-ordinary-observer-v1.service.example':'0f1334d356a2cce76cae585fb60ff920e9d55eb2d8b13c4c0a56c4c4036b9126'}
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
with sdk.lock():
 assert not AUDIT.exists();first=snapshot();AUDIT.mkdir(mode=0o700);save('before.json',first)
 public=json.loads(urllib.request.urlopen('https://api.github.com/repos/protocolmon/yunipals',timeout=10).read(1000000))
 assert public['private']is False and public['full_name']=='protocolmon/yunipals'
 staged=[]
 for name,digest in FILES.items():
  p=OPS/name
  if p.exists():
   protected(p,digest);staged.append({'file':name,'sha256':digest,'new':False,'mode':stat.S_IMODE(p.stat().st_mode)});continue
  url='https://raw.githubusercontent.com/protocolmon/yunipals/'+COMMIT+'/ops/unified-indexer-transition/'+name
  raw=urllib.request.urlopen(url,timeout=15).read(1000000);assert sha(raw)==digest
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
  protected(p,digest);staged.append({'file':name,'sha256':digest,'new':True,'mode':0o600})
 stage_sha=save('staged.json',{'publicCommit':COMMIT,'files':staged,'existingPermissionsChanged':False})
 observer=module(OPS/'ypal-restored-ordinary-observer-v1.py',FILES['ypal-restored-ordinary-observer-v1.py'])
 # No invented READ acknowledgement. Qualify explicit query/installed-data leaves
 # only; actual Host construction and full observer review remain gated.
 leaf=object.__new__(observer.Host)
 leaf.static=observer.module(observer.STATIC,observer.STATIC_SHA)
 leaf.sdk=observer.module(observer.SDK,observer.SDK_SHA)
 leaf.installer=observer.module(observer.INSTALLER,observer.INSTALLER_SHA);leaf.shared=leaf.installer.shared()
 install_raw=protected(leaf.installer.BASE/'result.json');leaf.install_ack=sha(install_raw)
 installed=leaf.inputs();data=leaf.direct_source();routes=leaf.direct_routes()
 assert data['sourceActorQualified']is data['currentWriterQualified']is data['sourceReadinessQualified']is False
 assert routes['validated']is routes['rpcScopeOnly']is routes['freeOnly']is True and routes['paidAuthority']is False
 assert not observer.UNIT_FILE.exists()and not os.path.lexists(observer.BOOT)and not observer.BASE.exists()
 assert snapshot()==first
 result={'format':'yunipals-restored-observer-host-preparation-v1','completed':True,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'publicCommit':COMMIT,'publicFiles':len(staged),'newPublicFiles':sum(v['new']for v in staged),'stageReceiptSha256':stage_sha,
 'operatorSha256':FILES['ypal-restored-ordinary-observer-v1.py'],'readProducerSha256':FILES['ypal-restored-read-admission-v1.py'],
 'dataIdentity':data['dataIdentity'],'nativeDatasetLeafQualified':True,'installedArtifactLeafQualified':True,
 'installationReceiptSha256':leaf.install_ack,'installedInputBindingSha256':sha(encoded(installed)),
 'independentNineRPCQualified':True,'currentRPCReceiptSha256':routes['receiptSha256'],'wholeHostConstructorQualified':False,
 'currentObserverQualified':False,'currentWriterQualified':False,'actualREADAdmissionQualified':False,'restrictedPeerInspectionQualified':False,
 'observerUnitAbsent':True,'observerOperationAbsent':True,'sourceAndServingPeersUnchanged':True,'nativeAndCacheIdentityPreserved':True,
 'existingPermissionsChanged':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'privateRawReportsExported':False,'sourceBytesTransferredOverSSH':0}
 result_sha=save('result.json',result)
 print(json.dumps({**result,'actualResultFile':str(AUDIT/'result.json'),'actualResultSha256':result_sha},sort_keys=True))
'''
cp=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes','-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -c '+shlex.quote(remote)],capture_output=True,text=True,timeout=260)
if cp.returncode:
 print(json.dumps({'completed':False,'exitCode':cp.returncode,'privateDiagnosticBytes':len(cp.stderr)}));raise SystemExit(cp.returncode)
assert not cp.stderr
value=json.loads(cp.stdout);p=Path('/tmp/yunipals-restored-observer-host-preparation-production-20261024.json')
with p.open('x')as f:json.dump(value,f,sort_keys=True);f.write('\n')
p.chmod(0o600);print(json.dumps(value,sort_keys=True))
