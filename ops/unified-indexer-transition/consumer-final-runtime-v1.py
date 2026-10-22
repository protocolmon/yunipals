#!/usr/bin/env python3
"""Explicit final-artifact view over unchanged consumer peer/catalog primitives."""
import copy,json,re,stat
from pathlib import Path
SOURCE='41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b'
MANIFEST_SHA='6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801'
ROOT=Path('/opt/yunipals-unified/releases')/SOURCE
ARTIFACT=Path('/var/tmp/yunipals-runtime-41e5b5fd-20261021')
OLD_SOURCE='9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d'
OLD_ROOT=Path('/opt/yunipals-unified/releases')/OLD_SOURCE
FORMAT='yunipals-final-consumer-runtime-view-v1'
def fail(code):raise RuntimeError(code)

def accepted(a,file,pin):
 if Path(file)!=ARTIFACT/'install-result.json' or not re.fullmatch('[a-f0-9]{64}',pin):fail('exact_final_artifact_install_receipt_required')
 v=a.document(file,pin)
 if(v.get('format')!='yunipals-consumer-final-artifact-install-v1' or v.get('installed')is not True or v.get('sourceDigest')!=SOURCE or v.get('manifestSha256')!=MANIFEST_SHA or v.get('target')!=str(ROOT) or v.get('artifact')!=str(ARTIFACT) or v.get('sourceFilesVerified')!=1751 or v.get('installedEntriesVerified')!=60918 or v.get('olderArtifactsModified')is not False or v.get('runtimeStarted')is not False or any(v.get(k)!=0 for k in ['databaseChanges','serviceChanges','sourceSelectionsChanged'])):fail('actual_unselected_final_artifact_required')
 for key in ['runtimeArchiveSha256','runtimeInventorySha256','proofSha256']:
  if not re.fullmatch('[a-f0-9]{64}',v.get(key,'')):fail('actual_final_artifact_hashes_required')
 manifest=a.document(ROOT/'RELEASE-MANIFEST.json',MANIFEST_SHA)
 raw=a.protected(ARTIFACT/'runtime-supplement.inventory.json',40000000)
 if a.sha(raw)!=v['runtimeInventorySha256']:fail('final_inventory_hash_changed')
 inv=json.loads(raw)
 proof=a.document(ARTIFACT/'consumer-final-package-proof.json',v['proofSha256'])
 if(inv.get('sourceDigest')!=SOURCE or inv.get('sourceManifestSha256')!=MANIFEST_SHA or inv.get('archiveSha256')!=v['runtimeArchiveSha256'] or len(inv.get('entries',[]))!=60918 or
  proof.get('format')!='yunipals-final-consumer-package-v1' or proof.get('status')!='passed' or proof.get('sourceDigest')!=SOURCE or proof['runtime']['inventorySha256']!=v['runtimeInventorySha256'] or proof['runtime']['archiveSha256']!=v['runtimeArchiveSha256'] or proof['verification'].get('ordinaryMarketBuilds')!=1 or proof['verification'].get('dependencyPackages')!=330 or proof['verification'].get('bundleCount')!=34 or proof['verification'].get('allSourceContentsMatch')is not True or proof['source'].get('acceptedParentBuildProofSha256')!='50491f6ddd840a65cbd07d45eeb2923edd88eb62647a8cce5587050d6077b000' or proof['source'].get('manifestSha256')!=MANIFEST_SHA or proof['source'].get('files')!=1751 or proof['verification'].get('twoApplicationTypechecks')is not True or proof['runtime'].get('exactDelta',{}).get('dependencyBytesLinksShimsAndMetadataUnchanged')is not True):fail('final_build_and_installed_runtime_binding_changed')
 return v,manifest,proof

class Runtime:
 def __init__(self,a,old,file,pin):
  self.a,self.old,self.install_file,self.install_sha=a,old,str(file),pin
  self.receipt,self.manifest,self.proof=accepted(a,file,pin)
  self.SOURCE,self.ROOT,self.MANIFEST_SHA=SOURCE,ROOT,MANIFEST_SHA
  self.INVENTORY=ARTIFACT/'runtime-supplement.inventory.json';self.INVENTORY_SHA=self.receipt['runtimeInventorySha256'];self.ARCHIVE_SHA=self.receipt['runtimeArchiveSha256']
  self.rows={r['path']:r for r in self.manifest['files']}
 def __getattr__(self,name):return getattr(self.old,name)
 def matrix(self):
  value=copy.deepcopy(self.old.matrix());c=value['consumer']
  c.update(sourceDigest=SOURCE,sourceManifestSha256=MANIFEST_SHA,sourceArchiveSha256=self.proof['source']['archiveSha256'],runtimeArchiveSha256=self.ARCHIVE_SHA,runtimeInventorySha256=self.INVENTORY_SHA,packageEvidenceFile=self.install_file,packageEvidenceSha256=self.install_sha,immutableConsumerRoot=str(ROOT),localVerifiedSourceRoot=None,verifiedSourceFiles=1751,verifiedSourceBytes=sum(r['bytes']for r in self.manifest['files']),productionInstallationVerified=True)
  for row in value['services']:
   proposed=row['proposed'];entry=self.rows[proposed['entrypoint']]
   proposed.update(immutableConsumerRoot=str(ROOT),consumerSourceDigest=SOURCE,consumerSourceManifestSha256=MANIFEST_SHA,entrypointManifestSha256=entry['sha256'],entrypointManifestBytes=entry['bytes'])
   proposed['dropInPreview']=proposed['dropInPreview'].replace(str(OLD_ROOT),str(ROOT))
  return value
 def public_unit(self,row,props):
  # These are retained-original checks before any new service admission. Candidate
  # process verification remains the final installer's exact argv/UID/definition
  # check; do not expand the old classifier by accepting arbitrary current paths.
  return self.old.public_unit(row,props)
 def scope(self,original):
  value=copy.deepcopy(original)
  value['readView'].update(consumerSourceDigest=SOURCE,sourceManifestSha256=MANIFEST_SHA)
  for row in value['units']:
   row['dropInTemplate']=row['dropInTemplate'].replace(str(OLD_ROOT),str(ROOT));row['entrypointSha256']=self.rows[row['entrypoint']]['sha256']
  return value
 def check_current(self):
  v,_,_=accepted(self.a,self.install_file,self.install_sha)
  if v!=self.receipt:fail('installed_final_receipt_changed')
  return {'format':FORMAT,'installReceiptSha256':self.install_sha,'sourceDigest':SOURCE,'manifestSha256':MANIFEST_SHA,'inventorySha256':self.INVENTORY_SHA,'acceptedArenaParentPreserved':True,'fullRuntimeRehashed':False}
