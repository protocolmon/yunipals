#!/usr/bin/env python3
"""Fixed existing Arena configuration observation; no service, DB or provider action."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import subprocess
import types
from urllib.parse import unquote,urlsplit

FORMAT='yunipals-arena-config-observer-v4'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASELINE=OPS/'arena-config-public-baseline-v1.json'
BASELINE_SHA='374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa'
VERIFIER_SHA='ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965'
CANDIDATE_MANIFEST_SHA='5e06ff4b9d86859814f1fd1d2b24d1db38278eec75a7c2cefcdd3689103f27e0'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
ROLES=('api','capacity','control','lobby','media','projector','referee','settlement')
ENV_FILES={Path('/etc/yunipals-arena')/name for name in ['runtime.env','database.env','arena.env','runware.env']}
KEYS={'strategy-encryption.key':'ARENA_ENCRYPTION_KEY_FILE','admission.key':'ARENA_ADMISSION_KEY_FILE',
      'operator.key':'ARENA_LOBBY_KEY_FILE','referee.key':'ARENA_REFEREE_KEY_FILE'}
PROVIDER={'OPENAI_API_KEY':{'referee'},'RUNWARE_API_KEY':{'media','capacity'}}

def fail(label):raise RuntimeError(label)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def metadata(s):return [s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def loaded_credential_mode(path,s):
    allowed={Path('/run/credentials')/('yunipals-arena-'+role+'.service')/key for role in ROLES for key in KEYS}
    return path in allowed and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o440
def read(path,maximum=1000000,*,uid=0,private=False):
    path=Path(path)
    for ancestor in reversed(path.parents):
        s=ancestor.lstat()
        if not stat.S_ISDIR(s.st_mode)or stat.S_ISLNK(s.st_mode)or s.st_uid not in {0,uid}or s.st_mode&0o022:
            fail('protected_fixed_input_ancestry_required')
    before=path.lstat()
    if (not stat.S_ISREG(before.st_mode)or before.st_uid not in {0,uid}or before.st_nlink!=1 or before.st_size>maximum or
        before.st_mode&0o022 or private and before.st_mode&0o077 and not loaded_credential_mode(path,before)):fail('bounded_fixed_regular_input_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as stream:
        if metadata(os.fstat(stream.fileno()))!=metadata(before):fail('fixed_input_inode_changed')
        raw=stream.read(maximum+1)
        if metadata(os.fstat(stream.fileno()))!=metadata(before):fail('fixed_input_changed_during_read')
    if metadata(path.lstat())!=metadata(before)or len(raw)!=before.st_size:fail('fixed_input_changed_during_read')
    return raw,metadata(before)
def command(argv):
    r=subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=5)
    if r.returncode or r.stderr or len(r.stdout)>200000:fail('bounded_fixed_metadata_command_failed')
    return r.stdout.decode()
def unit_state(v,unit):
    if unit not in {'yunipals-arena-'+name+'.service'for name in ROLES}:fail('fixed_arena_unit_required')
    keys=['Id',*v.STATE_KEYS]
    raw=v.run(['/usr/bin/systemctl','show','--all',unit,*['--property='+key for key in keys]],timeout=5)
    if not isinstance(raw,str)or len(raw.encode())>200000:fail('bounded_arena_unit_metadata_required')
    props={};repeated={'Environment':[],'EnvironmentFiles':[]}
    for line in raw.splitlines():
        key,sep,value=line.partition('=')
        if not sep or key not in keys:fail('fixed_unit_property_shape_required')
        if key in repeated:repeated[key].append(value)
        elif key in props:fail('unique_arena_unit_property_required')
        else:props[key]=value
    if (set(props)!=set(keys)-set(repeated)or props['Id']!=unit or props['ActiveState']!='active'or props['SubState']!='running'or
        not re.fullmatch('[0-9a-f]{32}',props['InvocationID'])or not re.fullmatch('[1-9][0-9]*',props['MainPID'])):fail('same_active_arena_unit_required')
    # Empty complex manager properties may be omitted by systemctl. Their
    # actual values are separately read with mandatory typed D-Bus arrays.
    props['managerRepeatedProperties']=repeated
    return props
def typed_properties(unit,run=command):
    args=['/usr/bin/busctl','--json=short']
    obj=json.loads(run([*args,'call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit]))
    if (set(obj)!={'type','data'}or obj['type']!='o'or not isinstance(obj['data'],list)or len(obj['data'])!=1 or
        not isinstance(obj['data'][0],str)or not re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',obj['data'][0])):fail('fixed_loaded_unit_object_required')
    out={}
    for name,kind in [('EnvironmentFiles','a(sb)'),('Environment','as'),('LoadCredential','a(ss)')]:
        value=json.loads(run([*args,'get-property','org.freedesktop.systemd1',obj['data'][0],'org.freedesktop.systemd1.Service',name]))
        if set(value)!={'type','data'}or value['type']!=kind or not isinstance(value['data'],list):fail('exact_typed_unit_property_required')
        out[name]=value['data']
    if (any(not isinstance(r,list)or len(r)!=2 or not isinstance(r[0],str)or type(r[1])is not bool for r in out['EnvironmentFiles'])or
        any(not isinstance(r,str)or '='not in r for r in out['Environment'])or
        any(not isinstance(r,list)or len(r)!=2 or any(not isinstance(x,str)for x in r)for r in out['LoadCredential'])):fail('typed_unit_array_shape_required')
    return out
def parse_env(raw):
    if len(raw)>65536 or b'\0'in raw:fail('bounded_environment_file_required')
    text=raw.decode('utf-8').replace('\\\n','');out={}
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith(('#',';')):continue
        key,sep,value=line.partition('=')
        if not sep or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key.strip()):fail('supported_environment_assignment_required')
        tokens=shlex.split(value,comments=False,posix=True)
        if len(tokens)>1:fail('bounded_unambiguous_environment_value_required')
        out[key.strip()]=tokens[0]if tokens else ''
    if len(out)>256:fail('bounded_environment_key_count_required')
    return out
def exec_settings(unit,raw,baseline):
    matches=re.findall(r'argv\[\]=(.*?)\s+;',raw)
    if len(matches)!=1:fail('single_fixed_arena_exec_required')
    words=shlex.split(matches[0]);assignments={};public=[]
    for word in words:
        key,sep,value=word.partition('=')
        if sep and re.fullmatch('[A-Z_][A-Z0-9_]*',key):
            if key in assignments:fail('unique_exec_assignment_required')
            assignments[key]=value
        else:public.append(word)
    expected=[word for word in baseline['execStartPublicTokens']if word!='<REDACTED_ARGUMENT>']
    if public!=expected or set(assignments)!=set(baseline['inlineSettingNames']):fail('existing_public_exec_selector_changed')
    expected_ids={name for name,_ in [row.split(':',1)for row in baseline['credentialFileReferences']]}
    for name,key in KEYS.items():
        if key in assignments:
            expected={f'%d/{name}',f'/run/credentials/{unit}/{name}'}if name in expected_ids else {''}
            if assignments[key]not in expected:fail('fixed_credential_assignment_changed')
    if 'ARENA_ENTRIES_ENABLED'in assignments and assignments['ARENA_ENTRIES_ENABLED']!='false':fail('existing_entry_gate_changed')
    return assignments
def role_identity(value):
    try:
        url=urlsplit(value)
        if url.scheme not in {'postgres','postgresql'}or not url.username:raise ValueError()
        name=unquote(url.username)
        if not name or len(name)>128:raise ValueError()
        return sha(name.encode())
    except ValueError:fail('configured_database_role_identity_required')
def request_policy(raw):
    # Public source literals only; no application module import or API request.
    patterns=[r'model:\s*"([^"\n]+)"',r'effort:\s*"([^"\n]+)"',r'service_tier:\s*"([^"\n]+)"',
              r'background:\s*(true|false)',r'store:\s*(true|false)',r'max_output_tokens:\s*([0-9]+)']
    text=raw.decode();values=[re.findall(p,text)for p in patterns]
    if any(len(v)!=1 for v in values):return None
    return sha(encoded([v[0]for v in values]))

def observe(v,baseline,*,read_file=read,typed=typed_properties):
    rows=baseline['services']
    if (baseline.get('format')!='yunipals-arena-config-public-baseline-v1'or len(rows)!=8 or
        {r['unit']for r in rows}!={'yunipals-arena-'+name+'.service'for name in ROLES}or
        baseline.get('privateValueBaselineIncluded')is not False):fail('exact_public_eight_unit_baseline_required')
    release=Path(baseline['resolvedRelease']);watched={};secrets={};envs={};states={};typed_states={};outputs=[]
    def capture(path,maximum=65536,*,uid=0,private=False):
        raw,meta=read_file(path,maximum,uid=uid,private=private);seal={'metadata':meta,'sha256':sha(raw)}
        if str(path)in watched and watched[str(path)]!=seal:fail('configuration_input_changed_between_roles')
        watched[str(path)]=seal;return raw
    for row in rows:
        unit=row['unit'];name=unit.removeprefix('yunipals-arena-').removesuffix('.service')
        props=unit_state(v,unit);states[unit]=props;account=pwd.getpwnam(props['User'])
        if (props['User']!=row['User']or props['Group']!=row['Group']or props['WorkingDirectory']!=row['WorkingDirectory']or
            Path(props['WorkingDirectory']).resolve(strict=True)!=release/'apps/yunipals-market-api'or account.pw_uid<=0):fail('retained_arena_runtime_user_or_directory_changed')
        values=typed(unit);typed_states[unit]=values
        if values['EnvironmentFiles']!=[[p,False]for p in row['environmentFiles']]or any(Path(p)not in ENV_FILES for p,_ in values['EnvironmentFiles']):fail('ordered_existing_environment_selectors_changed')
        expected=[item.split(':',1)for item in row['credentialFileReferences']]
        if len({key for key,_ in values['LoadCredential']})!=len(values['LoadCredential'])or dict(values['LoadCredential'])!=dict(expected) or any(Path(path)!=Path('/etc/yunipals-arena')/key or key not in KEYS for key,path in expected):fail('fixed_existing_credential_mapping_changed')
        env={}
        for item in values['Environment']:
            key,_,value=item.partition('=');env[key]=value
        for path in row['environmentFiles']:env.update(parse_env(capture(Path(path),private=True)))
        inline=exec_settings(unit,props['ExecStart'],row);env.update(inline);envs[name]=env
        definitions=v.definitions(props)
        expected_definitions={row['FragmentPath'],*shlex.split(row['DropInPaths'])}
        if set(definitions)!=expected_definitions:fail('existing_unit_definition_selectors_changed')
        for path,expected_hash in definitions.items():
            definition=capture(Path(path),1000000)
            if sha(definition)!=expected_hash:fail('unit_definition_changed_during_read')
            if re.search(rb'(?m)^\s*(?:LoadCredentialEncrypted|SetCredential|SetCredentialEncrypted|ImportCredential|PassEnvironment|UnsetEnvironment)\s*=\s*[^\r\n\s]',definition):fail('additional_credential_or_inherited_environment_mechanism_unsupported')
        matches=[]
        for key,path in expected:
            source=capture(Path(path),4096,private=True)
            loaded=capture(Path('/run/credentials')/unit/key,4096,uid=account.pw_uid,private=True)
            if source!=loaded:fail('loaded_credential_differs_from_configured_source')
            if key=='strategy-encryption.key':valid=re.fullmatch(b'[0-9a-fA-F]{64}',source.strip())is not None
            else:valid=re.fullmatch(b'0x[0-9a-fA-F]{64}',source.strip())is not None
            if not valid:fail('existing_credential_shape_invalid')
            material=source.strip().lower()
            if key in secrets and secrets[key]!=material:fail('shared_credential_material_changed')
            secrets[key]=material;matches.append({'idSha256':sha(key.encode()),'present':True,'loadedBytesMatchSource':True})
        entry=release/'apps/yunipals-market-api'/row['execStartPublicTokens'][-1]
        runtime=sha(capture(entry,4000000))
        source_role=role_identity(env['ARENA_INDEXER_DATABASE_URL'])if env.get('ARENA_INDEXER_DATABASE_URL')else None
        providers={key:bool(env.get(key,''))for key in PROVIDER}
        unexpected=[key for key,allowed in PROVIDER.items()if providers[key]and name not in allowed]
        required={'referee':'OPENAI_API_KEY','media':'RUNWARE_API_KEY','capacity':'RUNWARE_API_KEY'}.get(name)
        outputs.append({'role':name,'unit':unit,'invocation':props['InvocationID'],'uid':account.pw_uid,
            'configuredOsIdentitySha256':sha(encoded([props['User'],props['Group']])),'configuredDatabaseRoleSha256':role_identity(env.get('ARENA_DATABASE_URL','')),
            'configuredSourceRoleSha256':source_role,'orderedEnvironmentSelectorsMatchBaseline':True,'credentialMappingsMatchBaseline':True,
            'loadedCredentials':matches,'providerKeyPresence':providers,'unexpectedProviderKeys':unexpected,'requiredProviderKeyPresent':not required or providers[required],
            'executionSignerConfigured':bool(env.get('ARENA_REFEREE_KEY_FILE')or env.get('ARENA_LOBBY_KEY_FILE')),
            'admissionSignerConfigured':bool(env.get('ARENA_ADMISSION_KEY_FILE')),'runtimeSha256':runtime,
            'unitDefinitionsSha256':definitions,'inlineEnvironmentSha256':sha(encoded(values['Environment']))})
    policy_path=release/'apps/yunipals-market-api/src/arena/live/refereeApi.ts'
    try:policy_raw=capture(policy_path,100000)
    except FileNotFoundError:policy_raw=None
    policy=request_policy(policy_raw)if policy_raw is not None else None
    candidate=Path('/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d/apps/yunipals-market-api/src/arena/live/refereeApi.ts')
    candidate_raw=capture(candidate,100000)
    candidate_manifest=capture(candidate.parents[5]/'RELEASE-MANIFEST.json',2000000)
    if sha(candidate_manifest)!=CANDIDATE_MANIFEST_SHA:fail('exact_retained_candidate_manifest_required')
    candidate_rows=[r for r in json.loads(candidate_manifest)['files']if r['path']=='apps/yunipals-market-api/src/arena/live/refereeApi.ts']
    if len(candidate_rows)!=1 or candidate_rows[0]['sha256']!=sha(candidate_raw)or candidate_rows[0]['bytes']!=len(candidate_raw):fail('candidate_referee_source_differs_from_manifest')
    candidate_policy=request_policy(candidate_raw)
    for unit,previous in states.items():
        if unit_state(v,unit)!=previous or typed(unit)!=typed_states[unit]:
            fail('unit_configuration_or_invocation_changed_during_observation')
    for path,expected in watched.items():
        raw,meta=read_file(Path(path),4000000,uid=expected['metadata'][2],private=str(path).startswith(('/etc/yunipals-arena/','/run/credentials/')))
        if {'metadata':meta,'sha256':sha(raw)}!=expected:fail('configuration_bytes_changed_during_observation')
    if policy_raw is None:
        try:read_file(policy_path,100000)
        except FileNotFoundError:pass
        else:fail('supplementary_deployed_source_appeared_during_observation')
    signer_keys=[secrets[key]for key in ['admission.key','operator.key','referee.key']]
    provider_scope=all(not r['unexpectedProviderKeys']and r['requiredProviderKeyPresent']for r in outputs)
    signer_scope=all(bool(envs[name].get('ARENA_ADMISSION_KEY_FILE'))==(name=='api')and
        bool(envs[name].get('ARENA_LOBBY_KEY_FILE'))==(name=='lobby')and
        bool(envs[name].get('ARENA_REFEREE_KEY_FILE'))==(name in {'control','settlement'})for name in ROLES)
    return {'format':FORMAT,'status':'observed','roles':outputs,'unitSelectorsRetained':True,'configurationBytesStableDuringObservation':True,
        'allLoadedCredentialBytesMatchSources':True,'signerKeyMaterialsDistinct':len(set(signer_keys))==3,'providerSelectorScopeMatchesIntendedRoles':provider_scope,
        'signerSelectorScopeMatchesIntendedRoles':signer_scope,
        'sharedOsIdentityObserved':len({r['configuredOsIdentitySha256']for r in outputs})==1,
        'sharedDatabaseRoleConfigured':len({r['configuredDatabaseRoleSha256']for r in outputs})==1,
        'environmentFileSha256':{Path(path).name:value['sha256']for path,value in watched.items()if Path(path)in ENV_FILES},
        'deployedRefereeSourceSha256':sha(policy_raw)if policy_raw is not None else None,'deployedRefereePolicySourceStatus':'present'if policy_raw is not None else'missing_deployed_source','candidateRefereeSourceSha256':sha(candidate_raw),
        'refereeRequestPolicyComparable':policy is not None and candidate_policy is not None,
        'refereeRequestPolicyEquivalent':policy==candidate_policy if policy is not None and candidate_policy is not None else None,
        'refereeRequestPolicyComparisonScope':'public_source_literals_only','deployedBundlePolicyEquivalenceProven':False,
        'providerKeyPresenceFromConfiguredInputsOnly':True,'runningProviderEnvironmentEquivalenceProven':False,'processEnvironmentRead':False,
        'historicalPrivateValueEquivalenceProven':False,'databaseRolePrivilegesQueried':False,'osCrossRoleSecretIsolationClaimed':False,
        'newSourceSwitchAccepted':False,'newOperationalRoleWritesAccepted':False,'runtimeInvoked':False,'databaseCalls':0,'providerCalls':0,'mutations':False}

def main():
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_root_host_required')
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(180)
    try:
        raw,_=read(BASELINE)
        if sha(raw)!=BASELINE_SHA:fail('public_configuration_baseline_changed')
        body,_=read(OPS/'proxy-upgrade.py')
        if sha(body)!=VERIFIER_SHA:fail('frozen_metadata_reader_changed')
        v=types.ModuleType('arena_existing_metadata');v.__file__=str(OPS/'proxy-upgrade.py');exec(compile(body,v.__file__,'exec'),v.__dict__)
        out=observe(v,json.loads(raw));out['baselineSha256']=BASELINE_SHA;print(json.dumps(out,sort_keys=True))
    finally:signal.alarm(0)
if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'format':FORMAT,'status':'refused','errorClass':type(error).__name__,'rawValuesExported':False,'databaseCalls':0,'providerCalls':0,'mutations':False}))
        raise SystemExit(1)
