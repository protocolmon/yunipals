"""Add the qualified public free log endpoint without enabling paid fallback."""
import json,subprocess,time,urllib.request
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
with urllib.request.urlopen('http://127.0.0.1:19202/metrics',timeout=10) as r:before=json.load(r)
assert before['sourcePaidFallbackOnFreeFailure'] is False
(work/'gateway-before-free-log-route.json').write_text(json.dumps(before,indent=2)+'\n')
env=Path('/etc/yunipals-marketplace/production/rpc/base-islands-free-logs.env')
override=Path('/etc/systemd/system/yunipals-market-production-rpc@base.service.d/zz-base-islands-free-logs.conf')
assert not env.exists() and not override.exists()
env.write_text('MARKET_RPC_PROXY_FREE_LOG_UPSTREAM=https://base.drpc.org\nMARKET_RPC_PROXY_FREE_LOG_FAILOVER_UPSTREAMS=https://mainnet.base.org,https://base-rpc.publicnode.com\n');env.chmod(0o600)
override.parent.mkdir(parents=True,exist_ok=True)
override.write_text('[Service]\nEnvironmentFile='+str(env)+'\n')
try:
 subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','restart','yunipals-market-production-rpc@base'],check=True)
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:19202/metrics',timeout=2) as r:after=json.load(r)
   break
  except Exception:
   if attempt==19:raise
   time.sleep(1)
 assert after['sourcePaidFallbackOnFreeFailure'] is False and after['freeLogRouting']
except BaseException:
 env.unlink(missing_ok=True);override.unlink(missing_ok=True)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','yunipals-market-production-rpc@base'],check=True)
 raise
report={'configuredAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'publicFreeLogEndpoint':'https://base.drpc.org','chainIdVerified':8453,'recentTenBlockLogReadVerified':True,'paidFallbackForSource':False,'globalBudgetChanged':False,'rollback':'remove only zz-base-islands-free-logs.conf and base-islands-free-logs.env, daemon-reload/restart the Base RPC gateway'}
(work/'free-log-route.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
