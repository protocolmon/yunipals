import json,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-replacement-v2')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
subprocess.run(['systemd-run','--unit=yunipals-islands-api-candidate','--property=WorkingDirectory='+str(release),'--property=EnvironmentFile=/etc/yunipals-indexer/islands-api.env','--property=NoNewPrivileges=true','--property=MemoryMax=2G','/usr/bin/env','API_PORT=9016','API_BASE_ISLANDS_ENABLED=true','API_ISLAND_STAKING_ENABLED=true','/opt/node-v24.18.1/bin/node','--import','tsx',str(release/'lib/api/islands-server.ts')],check=True)
print(json.dumps({'candidateAPI':'http://127.0.0.1:9016','release':str(release),'publicReadersChanged':False}))
