"""Execute the user's approved temporary allocation, qualify, then start Base backfill."""
import json,os,subprocess,time,urllib.request
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
release=Path(json.loads((work/'worker-preparation.json').read_text())['release'])
def budget_snapshot(name):
 r=subprocess.run(['python3',str(work/'read-rpc-budget.py')],check=True,capture_output=True,text=True)
 (work/name).write_text(r.stdout)
 return json.loads(r.stdout)
def admin_sql(filename):
 subprocess.run(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-p','15438','-d','yunipals_market_production','-f',str(work/filename)],check=True)
budget_snapshot('budget-before-backfill.json')
admin_sql('temporary-backfill-budget.sql')
budget_snapshot('budget-rebalanced.json')
try:
 with urllib.request.urlopen('http://127.0.0.1:19202/metrics',timeout=10) as r:
  (work/'rpc-before-backfill.json').write_text(json.dumps(json.load(r),indent=2)+'\n')
 r=subprocess.run(['/opt/node-v24.18.1/bin/node','--import','tsx','scripts/qualify-base-islands.ts'],cwd=release,env={**os.environ,'BASE_ISLANDS_RPC_URL':'http://127.0.0.1:19202'},capture_output=True,text=True,timeout=120)
 if r.returncode:
  print(r.stderr[-2500:]);raise RuntimeError('RPC qualification failed')
 q=json.loads(r.stdout)
 assert q['runtimeAndProvenanceVerified'] and q['logCount']>=898
 (work/'rpc-qualification.json').write_text(json.dumps(q,indent=2)+'\n')
 subprocess.run(['systemctl','enable','--now','yunipals-base-islands.service'],check=True)
 report={'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'qualification':q,'temporaryAllocation':{'source':210000,'order_projection':390000},'globalCap':1000000,'foregroundReserve':200000}
 (work/'backfill-start.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
except BaseException:
 admin_sql('restore-backfill-budget.sql')
 raise
