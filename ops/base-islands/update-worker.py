import json,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
manifest=json.loads((work/'source-manifest.json').read_text())
release=Path('/opt/yunipals-islands/releases')/manifest['releaseId']
unit=Path('/etc/systemd/system/yunipals-base-islands.service')
s=unit.read_text();old=json.loads((work/'worker-preparation.json').read_text())['release']
assert old in s and (release/'base-islands-source-manifest.json').is_file()
(work/'worker-initial.service').write_text(s)
subprocess.run(['systemctl','stop','yunipals-base-islands'],check=True)
unit.write_text(s.replace(old,str(release)))
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','start','yunipals-base-islands'],check=True)
p=json.loads((work/'worker-preparation.json').read_text());p['release']=str(release)
p['updatedAtUTC']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());(work/'worker-preparation.json').write_text(json.dumps(p,indent=2)+'\n')
print(json.dumps({'workerRelease':str(release),'cursorPreserved':True}))
