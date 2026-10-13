"""Publish the verified additive API routes, preserving a concrete rollback."""
import json,subprocess,time,urllib.request
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
def run(args):
 r=subprocess.run(args,capture_output=True,text=True)
 if r.returncode:
  print(r.stderr[-2000:]);raise RuntimeError('Command failed: '+args[0])
 return r.stdout
# Verify all rows and both collections on the loopback candidate first.
proof=run(['python3',str(work/'verify-api.py'),'http://127.0.0.1:9016'])
(work/'candidate-api-verification.json').write_text(proof)
snippet=Path('/etc/nginx/snippets/yunipals-islands-indexer-location.conf')
old=snippet.read_text();(work/'nginx-before.conf').write_text(old)
override=Path('/etc/systemd/system/yunipals-islands-api.service.d/zzzz-base-islands.conf')
assert not override.exists(),'API override already exists'
add=''
for path in ['v2/collections/base-islands','v2/islands']:
 for exact in [True,False]:
  tail='' if exact else '/';modifier='=' if exact else '^~'
  add+=f'''\n    location {modifier} /yunipals-indexer/{path}{tail} {{
        proxy_pass http://127.0.0.1:9015/{path}{tail};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 2s;
        proxy_read_timeout 15s;
    }}\n'''
try:
 override.write_text(f'''[Service]
WorkingDirectory={release}
Environment=API_BASE_ISLANDS_ENABLED=true
ExecStart=
ExecStart=/opt/node-v24.18.1/bin/node --import tsx {release}/lib/api/islands-server.ts
''')
 snippet.write_text(old+add);run(['nginx','-t'])
 run(['systemctl','daemon-reload']);run(['systemctl','restart','yunipals-islands-api'])
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:9015/health',timeout=2) as response:
    assert json.load(response)['status']=='ok'
   break
  except Exception:
   if attempt==19:raise
   time.sleep(1)
 proof=run(['python3',str(work/'verify-api.py'),'http://127.0.0.1:9015'])
 (work/'loopback-api-verification.json').write_text(proof)
 run(['systemctl','reload','nginx'])
 proof=run(['python3',str(work/'verify-api.py'),'https://api.yunipals.com/yunipals-indexer'])
 (work/'public-api-verification.json').write_text(proof)
except BaseException:
 snippet.write_text(old);override.unlink(missing_ok=True)
 run(['nginx','-t']);run(['systemctl','daemon-reload']);run(['systemctl','restart','yunipals-islands-api']);run(['systemctl','reload','nginx'])
 raise
report={'deployedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'apiOverride':str(override),'nginxSnippet':str(snippet),'rollbackAPI':'remove only zzzz-base-islands.conf, restore nginx-before.conf, daemon-reload/restart API/reload nginx','ethereumIndexerRestarted':False,'ethereumMetadataRestarted':False,'stakingRestarted':False}
(work/'api-deployment.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
