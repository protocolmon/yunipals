import hashlib,json,shutil,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
operations=Path('/opt/yunipals-islands/operations')
for name in ['backup-islands.ts','health-islands.py']:
 target=work/('operations-before-'+name)
 if not target.exists():shutil.copy2(operations/name,target)
shutil.copy2(release/'scripts/backup-islands.ts',operations/'backup-islands.ts')
s=(operations/'health-islands.py').read_text()
assert 'yunipals-base-islands' not in s
s=s.replace("'yunipals-islands-staking']", "'yunipals-islands-staking','yunipals-base-islands']")
s=s.replace("print(json.dumps(", '''with urllib.request.urlopen(urllib.request.Request('https://api.yunipals.com/yunipals-indexer/v2/collections/base-islands/indexing-status',headers={'User-Agent':'Yunipals-Indexer-Health/1.0'}),timeout=15) as r:base=json.load(r)
assert base['ready'],'base_islands_not_ready'
print(json.dumps(''')
(operations/'health-islands.py').write_text(s)
shutil.copy2(work/'backup-storage.py',operations/'backup-storage.py')
override=Path('/etc/systemd/system/yunipals-islands-backup.service.d/zz-base-storage.conf')
assert not override.exists();override.parent.mkdir(exist_ok=True)
override.write_text('[Service]\nTimeoutStartSec=600\nExecStartPost=/usr/local/bin/env-cmd -f /root/mongodb-backupmon/2024-11-20T17-13-31/.env /usr/bin/python3 /opt/yunipals-islands/operations/backup-storage.py\n')
subprocess.run(['systemctl','daemon-reload'],check=True)
report={'installedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backupScriptSha256':hashlib.sha256((operations/'backup-islands.ts').read_bytes()).hexdigest(),'baseHealthCoverage':True,'dailyBackupIncludesBaseAndProvenance':True,'storageBoxPostBackupInstalled':True}
(work/'operations-deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
