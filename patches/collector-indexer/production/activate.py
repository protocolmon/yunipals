import hashlib,json,subprocess,time,urllib.request
from pathlib import Path
base=Path('/opt/yunipals-collector/releases/20260922-search')
config=Path('/etc/nginx/sites-enabled/polychainmonsters').resolve()
snippet=Path('/etc/nginx/snippets/yunipals-collector-location.conf')
backup=Path('/opt/yunipals-collector/rollout-20260922');backup.mkdir(mode=0o700,exist_ok=True)
include='    include /etc/nginx/snippets/yunipals-collector-location.conf;\n'
anchor='    include /etc/nginx/snippets/yunipals-marketplace-location.conf;\n'
before=config.read_text();assert before.count(anchor)==1 and include not in before and not snippet.exists()
assert hashlib.sha256((base/'server.mjs').read_bytes()).hexdigest()=='a2ad62e52c8dbb1a58dac9eb235d41bbe3656631710e405a08a83f0b6fef52e2'
def read(url):
 with urllib.request.urlopen(url,timeout=5) as r:return json.load(r)
assert read('http://127.0.0.1:9012/ready')=={'status':'ready'}
assert read('http://127.0.0.1:9012/v1/collector-capabilities')['version']==1
assert json.loads(Path('/tmp/yunipals-collector-production-smoke.json').read_text())['passed']
legacy=subprocess.check_output(['systemctl','show','yunipals-api','-p','MainPID','--value'],text=True).strip()
(backup/'nginx-before.conf').write_text(before);(backup/'nginx-before.conf').chmod(0o600)
snippet.write_text('''location = /yunipals-indexer/v1/collector-capabilities {
    proxy_pass http://127.0.0.1:9012/v1/collector-capabilities;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ^~ /yunipals-indexer/v2/owners/ {
    proxy_pass http://127.0.0.1:9012/v2/owners/;
    proxy_read_timeout 5s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
''')
after=before.replace(anchor,anchor+include);config.write_text(after)
try:
 subprocess.run(['nginx','-t'],check=True,capture_output=True)
 subprocess.run(['systemctl','enable','yunipals-collector-api'],check=True,capture_output=True)
 subprocess.run(['systemctl','reload','nginx'],check=True)
 time.sleep(1)
 public=json.loads(subprocess.check_output(['/opt/node-v24.18.1/bin/node','--input-type=module','-e',"const r=await fetch('https://api.yunipals.com/yunipals-indexer/v1/collector-capabilities',{signal:AbortSignal.timeout(5000)});if(r.status!==200)throw new Error('Capabilities HTTP '+r.status);console.log(JSON.stringify(await r.json()));"],text=True));assert public=={'version':1,'namePrefixSearch':False,'rarityRange':False}
 assert read('http://127.0.0.1:9011/ready')['status']=='ready'
 assert subprocess.check_output(['systemctl','show','yunipals-api','-p','MainPID','--value'],text=True).strip()==legacy
except Exception:
 assert config.read_text()==after
 config.write_text(before);snippet.unlink()
 subprocess.run(['nginx','-t'],check=True,capture_output=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 raise
record={'status':'collector-routes-live','legacyApiRestarted':False,'serverSha256':hashlib.sha256((base/'server.mjs').read_bytes()).hexdigest(),'nginxBeforeSha256':hashlib.sha256(before.encode()).hexdigest(),'nginxAfterSha256':hashlib.sha256(after.encode()).hexdigest()}
(backup/'backend.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
