#!/usr/bin/env python3
"""Read only an owned Node process identity as its existing unprivileged UID."""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess

USER = 'yunipals_unified_shadow'
NODE = '/opt/node-v24.18.1/bin/node'
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}

# Four fixed proc entries only. No cmdline, environment, memory, ptrace or file
# content reader is exposed. The caller still binds systemd invocation/argv.
PEER = r'''import json,os,pathlib,re,sys
pid=int(sys.argv[1]);unit=sys.argv[2]
if not 0<pid<2147483648 or not re.fullmatch(r'yunipals-unified-paid-productive-v[78]-20261021-[a-z0-9-]{1,30}\.service',unit):raise RuntimeError('owned_native_selector_required')
me=dict(line.split(':',1)for line in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in line)
if os.getuid()!=970 or os.geteuid()!=970 or os.getgid()!=964 or os.getegid()!=964 or os.getgroups()!=[] or me['NoNewPrivs'].strip()!='1' or int(me['CapBnd'],16)!=224 or any(int(me[k],16)for k in ['CapPrm','CapEff','CapInh','CapAmb']):raise RuntimeError('restricted_source_proc_reader_required')
root=pathlib.Path('/proc')/str(pid)
def snapshot():
 raw=(root/'stat').read_text();end=raw.rfind(') ');fields=raw[end+2:].split()
 if not raw.startswith(str(pid)+' (')or end<0 or len(fields)<20 or not fields[19].isdigit():raise RuntimeError('native_start_ticks_unavailable')
 s=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if ':'in line)
 if s['Uid'].split()!=['970']*4 or s['Gid'].split()!=['964']*4:raise RuntimeError('native_os_identity_changed')
 if(root/'cgroup').read_text().splitlines()!=['0::/system.slice/'+unit]:raise RuntimeError('native_cgroup_changed')
 if os.readlink(root/'exe')!='/opt/node-v24.18.1/bin/node':raise RuntimeError('native_executable_changed')
 return{'pid':pid,'startTicks':int(fields[19]),'uid':970,'gid':964,'executable':'/opt/node-v24.18.1/bin/node'}
first=snapshot()
if snapshot()!=first:raise RuntimeError('native_identity_changed_during_read')
print(json.dumps(first,sort_keys=True))
'''

def identity(pid, unit):
    if (type(pid)is not int or not 0<pid<2147483648 or not isinstance(unit,str) or
        not re.fullmatch(r'yunipals-unified-paid-productive-v[78]-20261021-[a-z0-9-]{1,30}\.service',unit)):
        raise RuntimeError('Exact owned native process selector required.')
    account=pwd.getpwnam(USER)
    if (account.pw_uid,account.pw_gid)!=(970,964):raise RuntimeError('Prepared source OS peer changed.')
    argv=['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',
        '/usr/bin/env','-i','/usr/bin/python3','-I','-c',PEER,str(pid),unit]
    result=subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=5)
    if result.returncode or result.stderr or len(result.stdout)>2048:
        raise RuntimeError('Bounded source-user native process identity unavailable.')
    try:value=json.loads(result.stdout)
    except (ValueError,UnicodeError):raise RuntimeError('Exact source-user native identity result required.')from None
    if (not isinstance(value,dict) or set(value)!={'pid','startTicks','uid','gid','executable'} or
        value['pid']!=pid or type(value['pid'])is not int or type(value['startTicks'])is not int or value['startTicks']<=0 or
        value['uid']!=970 or type(value['uid'])is not int or value['gid']!=964 or type(value['gid'])is not int or value['executable']!=NODE):
        raise RuntimeError('Exact source-user native identity result required.')
    return value
