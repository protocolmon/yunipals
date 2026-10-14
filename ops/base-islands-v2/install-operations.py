import hashlib,json,shutil,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-replacement-v2')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
operations=Path('/opt/yunipals-islands/operations')
for name in ['backup-islands.ts','backup-storage.py','health-islands.py']:
 target=work/('operations-before-'+name)
 assert not target.exists(),'Operations already prepared; inspect first'
 shutil.copy2(operations/name,target)
shutil.copy2(release/'scripts/backup-islands.ts',operations/'backup-islands.ts')
s=(operations/'health-islands.py').read_text()
assert 'yunipals-base-islands' in s and 'base-islands-v2' not in s
s=s.replace("'yunipals-base-islands'", "'yunipals-base-islands-v2'").replace('/collections/base-islands/', '/collections/base-islands-v2/')
(operations/'health-islands.py').write_text(s)
shutil.copy2(work/'backup-storage.py',operations/'backup-storage.py')
report={'installedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backupScriptSha256':hashlib.sha256((operations/'backup-islands.ts').read_bytes()).hexdigest(),'baseV2HealthCoverage':True,'dailyBackupIncludesLegacyAndReplacement':True,'storageBoxPostBackupUpdated':True}
(work/'operations-deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
