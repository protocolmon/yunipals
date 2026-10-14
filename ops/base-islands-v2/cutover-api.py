"""Switch the verified replacement API with a preserved rollback configuration."""
import json,subprocess,time,urllib.request
from pathlib import Path
work=Path('/srv/yunipals-islands/base-replacement-v2')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
def run(args):
 r=subprocess.run(args,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r.stdout
(work/'candidate-api-verification.json').write_text(run(['python3',str(work/'verify-api.py'),'http://127.0.0.1:9016']))
snippet=Path('/etc/nginx/snippets/yunipals-islands-indexer-location.conf')
override=Path('/etc/systemd/system/yunipals-islands-api.service.d/zzzz-base-islands.conf')
old=snippet.read_text();previous=override.read_text()
assert 'base-islands-v2/' not in old,'Already cut over; inspect before repeating'
(work/'nginx-before.conf').write_text(old);(work/'api-override-before.conf').write_text(previous)
add=''
for exact in [True,False]:
 tail='' if exact else '/';modifier='=' if exact else '^~'
 add+=f'''\n    location {modifier} /yunipals-indexer/v2/collections/base-islands-v2{tail} {{
        proxy_pass http://127.0.0.1:9015/v2/collections/base-islands-v2{tail};
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
 for n in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:9015/health',timeout=2) as r:assert json.load(r)['status']=='ok'
   break
  except Exception:
   if n==19:raise
   time.sleep(1)
 (work/'loopback-api-verification.json').write_text(run(['python3',str(work/'verify-api.py'),'http://127.0.0.1:9015']))
 run(['systemctl','reload','nginx'])
 (work/'public-api-verification.json').write_text(run(['python3',str(work/'verify-api.py'),'https://api.yunipals.com/yunipals-indexer']))
except BaseException:
 snippet.write_text(old);override.write_text(previous)
 run(['nginx','-t']);run(['systemctl','daemon-reload']);run(['systemctl','restart','yunipals-islands-api']);run(['systemctl','reload','nginx']);raise
report={'deployedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'activeBaseContract':'0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168','rollback':'Restore api-override-before.conf and nginx-before.conf, restart API and reload nginx; old Base schema retained','ethereumWorkersChanged':False}
(work/'api-deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
