import hashlib,json,os,socket,subprocess,time,urllib.request
from pathlib import Path
assert socket.gethostname()=='yunipals-main' and os.geteuid()==0
base=Path('/opt/yunipals-collector/releases/20260922-search')
unit=Path('/etc/systemd/system/yunipals-collector-api.service')
assert not base.exists() and not unit.exists()
upload=Path('/tmp/yunipals-collector-release')
assert hashlib.sha256((upload/'server.mjs').read_bytes()).hexdigest()=='a2ad62e52c8dbb1a58dac9eb235d41bbe3656631710e405a08a83f0b6fef52e2'
base.mkdir(parents=True,mode=0o755)
for name in ['server.mjs','server.mjs.map']:(base/name).write_bytes((upload/name).read_bytes())
(base/'node_modules').symlink_to('/root/indexer-next/node_modules',target_is_directory=True)
(base/'collector.env').write_text('COLLECTOR_API_PORT=9012\nAPI_DB_POOL_MAX=4\nAPI_DB_ACQUIRE_TIMEOUT_MS=1000\nAPI_DB_STATEMENT_TIMEOUT_MS=1000\nAPI_COLLECTOR_FILTERS_ENABLED=true\nAPI_COLLECTOR_RARITY_RANGE_ENABLED=false\nAPI_COLLECTOR_NAME_SEARCH_ENABLED=false\n')
(base/'collector.env').chmod(0o600)
unit.write_text(f'''[Unit]
Description=Yunipals bounded collection reads
After=network.target postgresql.service
[Service]
Type=simple
WorkingDirectory={base}
EnvironmentFile=/root/indexer-next/.env
EnvironmentFile=/etc/yunipals-marketplace/production/indexer-rpc.env
EnvironmentFile={base}/collector.env
ExecStart=/opt/node-v24.18.1/bin/node {base}/server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/tmp
MemoryMax=512M
CPUQuota=100%
[Install]
WantedBy=multi-user.target
''')
def run(*args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
try:
 run('systemctl','daemon-reload');run('systemctl','start',unit.name)
 for attempt in range(15):
  try:
   with urllib.request.urlopen('http://127.0.0.1:9012/ready',timeout=2) as response:
    assert json.load(response)=={'status':'ready'}
   break
  except Exception:
   if attempt==14:raise
   time.sleep(1)
except Exception:
 subprocess.run(['systemctl','stop',unit.name],check=False)
 raise
print(json.dumps({'status':'private-ready','listener':'127.0.0.1:9012','existingApiRestarted':False,'publicRoutesChanged':False}))
