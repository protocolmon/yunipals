"""Apply the additive migration and install an initially stopped Base worker."""
import json,os,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-replacement-v2')
manifest=json.loads((work/'source-manifest.json').read_text())
release=Path('/opt/yunipals-islands/releases')/manifest['releaseId']
assert (release/'base-islands-source-manifest.json').is_file()
subprocess.run(['/usr/local/bin/env-cmd','-f','/etc/yunipals-indexer/islands-writer.env','/opt/node-v24.18.1/bin/node','--import','tsx','scripts/migrate-base-islands.ts'],cwd=release,check=True,timeout=60)
sql="GRANT USAGE ON SCHEMA yunipals_base_islands_v2 TO yunipals_islands_api; GRANT SELECT ON ALL TABLES IN SCHEMA yunipals_base_islands_v2 TO yunipals_islands_api; GRANT SELECT ON metadata.island_airdrop_origin,metadata.island_replacement_origin TO yunipals_islands_api;"
subprocess.run(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-d','yunipals_backfill','-c',sql],check=True)
unit=Path('/etc/systemd/system/yunipals-base-islands-v2.service')
assert not unit.exists(),'Worker already installed; inspect before resuming'
unit.write_text(f'''[Unit]
Description=Yunipals Base Islands ownership and metadata worker
After=network-online.target postgresql.service yunipals-market-production-rpc@base.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={release}
EnvironmentFile=/etc/yunipals-indexer/islands-writer.env
Environment=PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin
Environment=BASE_ISLANDS_RPC_URL=http://127.0.0.1:19202
Environment=BASE_ISLANDS_POLL_MS=60000
ExecStart=/opt/node-v24.18.1/bin/node --import tsx {release}/lib/islands/base-worker.ts
Restart=on-failure
RestartSec=60
TimeoutStopSec=90
NoNewPrivileges=true
UMask=0077
CPUQuota=50%
MemoryMax=1G

[Install]
WantedBy=multi-user.target
''')
subprocess.run(['systemctl','daemon-reload'],check=True)
report={'preparedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'schema':'yunipals_base_islands_v2','provenanceRows':898,'readOnlyRoleGranted':True,'workerStarted':False,'preChangeBackup':'/var/backups/yunipals-islands-indexer/2026-10-13T21-47-56-258Z'}
(work/'worker-preparation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
