#!/usr/bin/env python3
"""Review first; enable only the accepted API at boot, without starting/restarting it."""
import argparse, hashlib, json, os, re, socket, stat, subprocess, types
from pathlib import Path
FORMAT = 'yunipals-ypal-api-enable-boot-v1'
BASE = Path('/var/backups/yunipals-ypal-api-enable-boot-v1-20261023')
CORE = Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py')
CORE_SHA = 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8'
FINAL = CORE.parent.parent / 'yunipals-ypal-reader-cutover-v1-20261023/finalization-v2-result.json'
FINAL_SHA = '9bf720f7d669b1863184db4214602a16346f7913d6d2fbdcd4090a42c1ba6e1c'
UNIT = 'yunipals-booster-api.service'
FRAGMENT = Path('/etc/systemd/system') / UNIT
DROP = Path(str(FRAGMENT) + '.d/95-ypal.conf')
LINK = FRAGMENT.parent / 'multi-user.target.wants' / UNIT
PINS = {FRAGMENT: '5ae76b4b54b359dc63cd9b990b227a32e4c984255308e1cd90982fa7de146414', DROP: 'c1d99ddcc88768fb3a88d94a0df101b23f64207dd9943fa979f64cebf095dac5'}
def need(ok, code):
    if not ok: raise RuntimeError(code)
def load():
    for p in [CORE, *CORE.parents]:
        s = p.lstat(); need(s.st_uid == 0 and not s.st_mode & 0o022 and not p.is_symlink(), 'protected_f603_required')
    raw = CORE.read_bytes(); need(hashlib.sha256(raw).hexdigest() == CORE_SHA, 'exact_f603_required')
    m = types.ModuleType('accepted_reader'); m.__file__ = str(CORE); exec(compile(raw, str(CORE), 'exec'), m.__dict__)
    need(m.sha(m.protected(CORE)) == CORE_SHA, 'f603_changed_during_load'); return m
def state(m):
    keys = ['Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ExecMainStartTimestampMonotonic','UnitFileState','FragmentPath','DropInPaths','Job']
    r = subprocess.run(['/usr/bin/systemctl','show','--all',UNIT,*['--property='+k for k in keys]], env=m.CLEAN, capture_output=True, timeout=8, cwd='/')
    need(r.returncode == 0 and not r.stderr, 'manager_read_ACK_required'); s = dict(x.split('=',1)for x in r.stdout.decode().splitlines())
    need(set(s) == set(keys) and s['LoadState'] == 'loaded' and s['ActiveState'] == 'active' and s['SubState'] == 'running' and s['Job'] in {'','0'}, 'running_API_without_job_required')
    need(s['FragmentPath'] == str(FRAGMENT) and s['DropInPaths'] == str(DROP) and all(m.sha(m.protected(p)) == pin for p,pin in PINS.items()), 'exact_loaded_API_definitions_required')
    final = m.document(FINAL, FINAL_SHA); need(final['completed'] is True and final['reconciledAcknowledgementOnly'] is True and final['originalOperatorSha256'] == CORE_SHA and final['bootId'] == m.boot(), 'actual_same_boot_finalized_f603_required')
    actor = {k:s[k]for k in ('Id','MainPID','InvocationID','ExecMainStartTimestampMonotonic')}; raw = (Path('/proc') / s['MainPID'] / 'stat').read_text(); actor['startTicks'] = int(raw[raw.rfind(')')+2:].split()[19])
    need(actor == final['API'] and actor['MainPID'] == '2334701' and actor['InvocationID'] == '3a3b4014f75b4db9968f4c5ee26fa904', 'exact_finalized_API_actor_required')
    need((Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs').read_text().split() == [s['MainPID']], 'same_single_API_process_required'); return s,actor

def links():
    found = []
    for root in ('/etc/systemd/system','/run/systemd/system'):
        for directory,dirs,files in os.walk(root, followlinks=False):
            for name in [*dirs,*files]:
                p = Path(directory) / name
                if p.is_symlink() and (name == UNIT or p.resolve(strict=False) == FRAGMENT): found.append(str(p))
    return sorted(found)
def availability(m):
    status, body = m.Host.request(None, '/v1/boosters/types', True)
    need(status == 200 and body.get('ready') is True and body.get('buildId') == '8e88ea2e00' and body.get('collection') == '0x7d62628806e7eef76a354c7c48787879e3440b16' and body.get('engine') == '0xdf4aaa47fe0e8208b5a33c74898f834b2952189e', 'public_fresh_YPAL_API_200_required'); return {'status':status,'ready':True,'freshYPALIdentity':True}
def review(m):
    need(not os.path.lexists(BASE), 'no_prior_enable_attempt_required'); s,actor = state(m)
    need(s['UnitFileState'] == 'disabled' and not links() and not os.path.lexists(LINK), 'disabled_API_without_existing_boot_links_required')
    install = m.protected(FRAGMENT).decode().split('[Install]'); need(len(install) == 2 and [x.strip() for x in install[1].splitlines()if x.strip() and not x.strip().startswith(('#',';'))] == ['WantedBy=multi-user.target'], 'sole_native_Install_WantedBy_required')
    for p in [LINK.parent,*LINK.parent.parents]:
        st = p.lstat(); need(stat.S_ISDIR(st.st_mode) and st.st_uid == st.st_gid == 0 and not st.st_mode & 0o022, 'protected_existing_boot_directory_required')
    availability(m); need(state(m) == (s,actor), 'API_changed_during_review')
    value = {'format':FORMAT,'operatorSha256':m.sha(m.protected(Path(__file__).absolute())),'finalizationSha256':FINAL_SHA,'readerOperatorSha256':CORE_SHA,'bootId':m.boot(),'actor':actor,'definitionHashes':{str(p):v for p,v in PINS.items()},'link':str(LINK),'target':str(FRAGMENT),'command':['/usr/bin/systemctl','enable',UNIT]}
    return {'binding':value,'reviewHash':m.sha(m.encoded(value)),'serviceRestarts':0,'databaseWrites':0}
def main():
    a = argparse.ArgumentParser(description=__doc__); a.add_argument('--apply'); args = a.parse_args(); need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_host_required'); os.umask(0o077)
    m = load(); before = review(m)
    if not args.apply: print(json.dumps(before,sort_keys=True)); return
    need(args.apply == before['reviewHash'], 'exact_fresh_review_required'); BASE.mkdir(mode=0o700); m.sync(BASE.parent); m.save(BASE / 'intent.json', {**before,'automaticRetryAllowed':False})
    need(review_boundary(m,before), 'unchanged_pre_enable_boundary_required')
    r = subprocess.run(before['binding']['command'],env=m.CLEAN,capture_output=True,timeout=15,cwd='/'); need(r.returncode == 0, 'enable_ACK_unknown_inspect_do_not_retry')
    s,actor = state(m); st = LINK.lstat(); need(s['UnitFileState'] == 'enabled' and actor == before['binding']['actor'] and links() == [str(LINK)] and stat.S_ISLNK(st.st_mode) and st.st_uid == st.st_gid == 0 and os.readlink(LINK) == str(FRAGMENT), 'only_expected_owned_boot_link_required')
    public = availability(m); need(state(m) == (s,actor) and links() == [str(LINK)] and m.identity(LINK.lstat()) == m.identity(st), 'API_or_owned_boot_link_changed_after_enable')
    value = {**before['binding'],'completed':True,'linkIdentity':m.identity(st),'publicAvailability':public,'serviceRestarts':0,'databaseWrites':0,'inverse':{'removeOnlySameSymlink':str(LINK),'target':str(FRAGMENT),'device':st.st_dev,'inode':st.st_ino,'thenDaemonReload':True,'neverStopAPI':True,'originalUnitFileState':'disabled'}}
    m.save(BASE / 'result.json',value); print(json.dumps(value,sort_keys=True))
def review_boundary(m,before):
    s,actor = state(m); return s['UnitFileState'] == 'disabled' and actor == before['binding']['actor'] and not links() and not os.path.lexists(LINK)
if __name__ == '__main__':
    try: main()
    except BaseException as e:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(e).__name__,'fixedCode':str(e)if type(e) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',str(e))else 'private_diagnostics_withheld','automaticRetryAllowed':False})); raise SystemExit(1)
