"""Read counters through the existing protected budget connection; never print credentials."""
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit,unquote

settings={}
for filename in ['/etc/yunipals-marketplace/production/common.env','/etc/yunipals-marketplace/production/budget/opensea.env']:
    for line in Path(filename).read_text().splitlines():
        key,sep,value=line.partition('=')
        if sep: settings[key.strip()]=value.strip().strip('\"\'')
connection=next((settings[key] for key in ['MARKET_OPENSEA_BUDGET_DATABASE_URL','MARKET_DATABASE_URL','DATABASE_URL'] if key in settings),None)
assert connection
url=urlsplit(connection)
environment={**os.environ,'PGHOST':url.hostname,'PGPORT':str(url.port or 5432),'PGDATABASE':unquote(url.path[1:]),
             'PGUSER':unquote(url.username or ''),'PGPASSWORD':unquote(url.password or '')}
sql="""SELECT json_agg(x) FROM (
 SELECT b.scope,b.enabled,b.daily_cu,b.foreground_reserve_cu,
   COALESCE(w.granted_cu,0) AS today_granted_cu,COALESCE(w.background_granted_cu,0) AS today_background_cu,
   a.workload,a.priority,a.daily_cu AS allocation_cu,COALESCE(aw.granted_cu,0) AS today_workload_cu
 FROM yunipals_market.rpc_compute_budget b JOIN yunipals_market.rpc_compute_allocation a USING(scope)
 LEFT JOIN yunipals_market.rpc_compute_window w ON w.scope=b.scope AND w.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
 LEFT JOIN yunipals_market.rpc_compute_workload_window aw ON aw.scope=b.scope AND aw.workload=a.workload
   AND aw.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
 ORDER BY b.scope,a.workload) x"""
result=subprocess.run(['psql','-X','-A','-t','-c',sql],env=environment,capture_output=True,text=True)
assert result.returncode==0,'Budget read failed; output suppressed'
print(json.dumps(json.loads(result.stdout),indent=2))
