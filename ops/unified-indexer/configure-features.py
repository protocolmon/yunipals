#!/usr/bin/env python3
"""Public cold configuration and retained Arena transaction transport.

Default is inert. Database credentials remain in their existing root-private
files. Arena actions use the installed, unchanged business transaction body;
its journal records actual XIDs, not a historical handover acknowledgement.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import stat
import subprocess
from urllib.parse import unquote, urlsplit

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEM = Path('/etc/systemd/system')
PUBLIC = Path('/etc/yunipals-unified')
WORK = Path('/mnt/HC_Volume_107222036/arena-modern-package-20261022')
PACKAGE = Path('/opt/yunipals-unified/operations/arena-modern-package-20261022')
ARENA_ROOT = Path('/opt/yunipals-unified/arena-runtime/e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234')
PROJECT = Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer')
NODE = '/opt/node-v24.18.1/bin/node'
PHYSICAL = 'unified_ypal_20261023_v1'
READ = 'yunipals_ownership_4e77f52b_v5'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
PREPARED_ARENA_RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
ARENA_UNITS = (
    'yunipals-arena-native-api.service', 'yunipals-arena-native-disclosure.service',
    'yunipals-arena-native-client.service', 'yunipals-arena-native-referee.service',
    'yunipals-arena-native-media.service', 'yunipals-arena-native-execution@lobby.service',
    'yunipals-arena-native-execution@referee.service', 'yunipals-arena-native-capacity.service'
)
BOOSTER_UNITS = ('yunipals-booster-api.service', 'yunipals-booster-artwork-queue.service')
ISLANDS = 'yunipals-islands-metadata.service'
EIGHT = tuple(sorted(('booster_type', 'booster_original', 'booster_request', 'booster_monster',
                      'booster_refund', 'booster_engine_state', 'booster_checkpoint', 'booster_event')))
TARGET_OIDS = {'_ponder_meta': '75963411', '_ponder_checkpoint': '75963418', 'booster_type': '75963501',
               'booster_original': '75963516', 'booster_request': '75963531', 'booster_monster': '75963546',
               'booster_refund': '75963561', 'booster_engine_state': '75963576', 'booster_event': '75963591', 'booster_checkpoint': '75963606'}
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TSX_DISABLE_CACHE': '1'}


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def read_public(path, expected=None):
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat()
        sticky_directory = stat.S_ISDIR(row.st_mode) and bool(row.st_mode & stat.S_ISVTX)
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and
             (not row.st_mode & 0o022 or sticky_directory), 'protected input required')
    before = path.lstat()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 8_000_001)
        key = lambda s: (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and len(raw) == before.st_size <= 8_000_000
             and key(before) == key(os.fstat(fd)) == key(path.lstat()), 'unchanged bounded input required')
        need(expected is None or sha(raw) == expected, 'input digest mismatch')
        return raw
    finally:
        os.close(fd)


def configuration(read=read_public):
    files = {}
    selector = PUBLIC / 'booster-native.public.env'
    files[str(selector)] = ('BOOSTER_DATABASE_SCHEMA=' + PHYSICAL + '\n').encode()
    for unit in BOOSTER_UNITS:
        files[str(SYSTEM / (unit + '.d') / 'zzzzzzzzzzzzzzzzzzzzzzzzz-cold-unified.conf')] = (
            '[Service]\nEnvironmentFile=' + str(selector) + '\n').encode()

    plan = json.loads(read(PACKAGE / 'constructor-plan-20261023.json',
                          '490e5e7620a88a48e34eb4d25ccd93f7a06d9e67c27dd7eed6f293923c7fcf2a'))
    proof = json.loads(read(Path(plan['packageProofFile']), 'a2b353f788d5d6a15408c3ee9cc3e46d100a9fd6a0c4b90230fd9f53091bc01e'))
    historical = json.loads(read(Path('/opt/yunipals-unified/operations/arena-consumer-package-20261021/proposal.v1.json'),
                                 '6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e'))
    manifest = json.loads(read(ARENA_ROOT / 'manifest.json', '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf'))
    need(manifest['artifactDigest'] == ARENA_ROOT.name and manifest['nativeWorkerUnits'] == 8, 'installed Arena artifact required')
    artifact_files = {row['path']: row for row in manifest['files']}
    pins = proof['nativeUnits']['files']
    need(set(pins) == set(ARENA_UNITS), 'exact eight prepared Arena units required')
    for unit in ARENA_UNITS:
        raw = read(WORK / 'native-units' / unit, pins[unit])
        workers = [row for row in historical['workers'] if row['unit'] == unit]
        need(len(workers) == 1, 'one prepared Arena worker required')
        original = workers[0]['bundleRelative']
        name = Path(original).name
        need(re.fullmatch(r'arena-(server|native-(disclosure|client|referee|media|execution)|capacity)\.mjs', name), 'known Arena bundle required')
        entry = 'dist/' + name
        actual = read(ARENA_ROOT / entry, artifact_files[entry]['sha256'])
        need(len(actual) == artifact_files[entry]['bytes'], 'installed Arena bundle size mismatch')
        commands = re.findall(rb'^ExecStart=[^\n]*\n', raw, re.M)
        need(len(commands) == 1, 'one exact prepared Arena command required')
        old = commands[0]
        args = shlex.split(old.decode().split('=', 1)[1])
        operand = rb'(?<= )' + re.escape(original.encode()) + rb'(?=[ \n])'
        need(args.count(NODE) == 1 and args.count(original) == 1 and
             args.index(original) > args.index(NODE) and len(re.findall(operand, old)) == 1,
             'one exact prepared Node bundle operand required')
        # Keep the prepared Node permissions/import flags and private env paths.
        new = re.sub(operand, str(ARENA_ROOT / entry).encode(), old, count=1)
        # /usr/bin/env assignments override EnvironmentFile values. The prepared
        # command must select the same release as the adopted database epoch.
        prior_selector = 'ARENA_INDEXER_RELEASE_ID=' + PREPARED_ARENA_RELEASE
        need(args.count(prior_selector) == 1 and old.count(prior_selector.encode()) == 1,
             'one exact prepared public Arena release selector required')
        new = new.replace(prior_selector.encode(), ('ARENA_INDEXER_RELEASE_ID=' + RELEASE).encode(), 1)
        # Restore the existing production modes from runtime.env. Other workers
        # retain their non-admission settings and cannot create new lobbies.
        mode = ('ARENA_ENTRIES_ENABLED' if unit == 'yunipals-arena-native-api.service' else
                'ARENA_NEW_LOBBIES_ENABLED' if unit == 'yunipals-arena-native-execution@lobby.service' else None)
        if mode is not None:
            assignment = (' ' + mode + '=false').encode()
            need(new.count(assignment) == 1, 'one prepared public Arena mode override required')
            new = new.replace(assignment, b'', 1)
        files[str(SYSTEM / unit)] = raw.replace(old, new, 1)

    # This worker publishes token metadata; it does not ingest chain events.
    # Retain its private env files and limits, and append only public selectors.
    release = PROJECT.parent.parent
    accepted = json.loads(read(release / 'RELEASE-MANIFEST.json',
                               '6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801'))
    row = next(r for r in accepted['files'] if r['path'] == 'apps/yunipals-indexer/lib/islands/worker.ts')
    raw = read(PROJECT / 'lib/islands/worker.ts', row['sha256'])
    need(len(raw) == row['bytes'], 'accepted Islands metadata worker required')
    selector = PUBLIC / 'islands-metadata-native.public.env'
    values = {'DATABASE_SCHEMA': PHYSICAL, 'READ_DATABASE_SCHEMA': READ, 'OWNERSHIP_READ_MODE': 'unified',
              'OWNERSHIP_READ_SCHEMA': READ, 'OWNERSHIP_RELEASE_ID': RELEASE, 'BASE_METADATA_INGESTION': 'native'}
    files[str(selector)] = ''.join(k + '=' + v + '\n' for k, v in sorted(values.items())).encode()
    files[str(SYSTEM / (ISLANDS + '.d') / 'zzzzzzzzzzzzzzzzzzzzzzzzz-cold-unified.conf')] = (
        '[Service]\nWorkingDirectory=' + str(PROJECT) + '\nEnvironmentFile=' + str(selector) +
        '\nExecStart=\nExecStart=' + NODE + ' --import tsx ' + str(PROJECT / 'lib/islands/worker.ts') + '\n').encode()
    return files


def install(files, record, backup_dir, deploy):
    expected = {str(SYSTEM / u) for u in ARENA_UNITS}
    expected |= {str(SYSTEM / (u + '.d') / 'zzzzzzzzzzzzzzzzzzzzzzzzz-cold-unified.conf') for u in (*BOOSTER_UNITS, ISLANDS)}
    expected |= {str(PUBLIC / 'booster-native.public.env'), str(PUBLIC / 'islands-metadata-native.public.env')}
    need(set(files) == expected, 'exact thirteen feature configuration files required')
    for unit in (*ARENA_UNITS, *BOOSTER_UNITS, ISLANDS):
        raw = deploy.run(['/usr/bin/systemctl', 'show', '--all', unit, '--property=LoadState', '--property=MainPID', '--property=ControlPID', '--property=ActiveState', '--property=Job'], 10)
        value = dict(line.split('=', 1) for line in raw.decode().splitlines())
        if value.get('LoadState') == 'not-found':
            value.setdefault('MainPID', '0')
            value.setdefault('ControlPID', '0')
        need(value['MainPID'] == value['ControlPID'] == '0' and not value['Job'] and value['ActiveState'] in {'inactive', 'failed'}, 'stop feature before configuring it: ' + unit)
    backup_dir = Path(backup_dir)
    need(backup_dir.is_absolute(), 'absolute private backup directory required')
    backup_dir.mkdir(mode=0o700)
    for name, raw in files.items():
        path = Path(name)
        path.parent.mkdir(mode=0o755, exist_ok=True)
        for parent in [*path.parents, path.parent, backup_dir, *backup_dir.parents]:
            row = parent.lstat()
            need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022, 'protected installation directory required')
        before = read_public(path) if os.path.lexists(path) else None
        label = sha(name.encode())[:16]
        if before is not None:
            with open(backup_dir / label, 'xb') as stream:
                os.fchmod(stream.fileno(), 0o600); stream.write(before); stream.flush(); os.fsync(stream.fileno())
            deploy.sync_directory(backup_dir)
        record(label + '-intent', {'path': name, 'beforeSha256': None if before is None else sha(before), 'afterSha256': sha(raw)})
        temporary = path.with_name(path.name + '.cold-new')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        need((read_public(path) if os.path.lexists(path) else None) == before, 'feature configuration changed')
        os.replace(temporary, path); deploy.sync_directory(path.parent)
        need(read_public(path) == raw, 'installed feature bytes differ')
        record(label + '-complete', {'path': name, 'sha256': sha(raw)})
    deploy.run(['/usr/bin/systemctl', 'daemon-reload'], 15)


def arena(action, payload, journal, plan_sha256, read=read_public):
    """Dispatch one retained transaction/read action; never retry an unknown XID."""
    need(action in {'review', 'commit', 'status', 'verify-source', 'unhalt'} and
         re.fullmatch('[a-f0-9]{64}', plan_sha256 or ''), 'fixed Arena action and actual cold plan required')
    sources = (
        ('child', OPS / 'arena-ypal-ordinary-v1.mjs', 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf'),
        ('adapter', OPS / 'arena-ypal-native-v1.adoption.mjs', 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162'),
        ('markers', Path('/opt/yunipals-unified/operations/arena-role-inventory-20261021/operational-migrations.v1.json'), 'f6f8c50c7242671f8736acdedb724df7dfd6bf0fb510343af5482e2794cf8f5b')
    )
    bodies = {name: read(path, expected) for name, path, expected in sources}
    raw = encoded(payload)
    need(len(raw) < 500000, 'bounded private Arena payload required')
    authority = encoded({'format': 'yunipals-arena-ypal-ordinary-root-authority-v1', 'action': action,
                         'payloadSha256': sha(raw), 'childSha256': sha(bodies['child']), 'planSha256': plan_sha256})
    fds = []
    try:
        for name, body in [('root-authority', authority), *bodies.items()]:
            fd = os.memfd_create('arena-direct-native-' + name, os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
            fds.append(fd); os.fchmod(fd, 0o600)
            need(os.write(fd, body) == len(body), 'complete sealed Arena input required')
            os.lseek(fd, 0, 0)
            seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
            fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
            need(fcntl.fcntl(fd, fcntl.F_GET_SEALS) == seals, 'sealed Arena inputs required')
        bootstrap = "import{readFileSync}from'node:fs';const m=await import('data:text/javascript;base64,'+readFileSync(Number(process.argv[3])).toString('base64'));await m.main({action:process.argv[1],authorityFd:Number(process.argv[2]),childFd:Number(process.argv[3]),adapterFd:Number(process.argv[4]),markersFd:Number(process.argv[5])});"
        user = pwd.getpwnam('postgres')
        args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
                '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', NODE, '--input-type=module', '--eval', bootstrap, action, *map(str, fds)]
        fd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as output:
            process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.PIPE,
                                       env=CLEAN, pass_fds=tuple(fds), start_new_session=True)
            try:
                _, stderr = process.communicate(raw, timeout=240)
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    process.communicate()
                except BaseException:
                    pass
                raise
            output.flush(); os.fsync(output.fileno())
            if process.returncode or stderr:
                error_fd = os.open(str(journal) + '.stderr.private',
                                   os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(error_fd, 'wb') as errors:
                    errors.write(stderr); errors.flush(); os.fsync(errors.fileno())
                raise subprocess.CalledProcessError(process.returncode, args, stderr=stderr)
        rows = [json.loads(line) for line in Path(journal).read_bytes().splitlines()]
        need(rows and all(row.get('format') == 'yunipals-arena-ypal-ordinary-child-v1' for row in rows), 'actual Arena transaction journal required')
        return rows
    finally:
        for fd in fds:
            os.close(fd)


def arena_payload(floor, read=read_public):
    """Load the existing nine private URLs; return only to the private caller."""
    need(type(floor) is dict and set(floor) == {'block', 'hash'} and
         re.fullmatch('[0-9]+', str(floor['block'])) and re.fullmatch('0x[a-fA-F0-9]{64}', floor['hash']), 'actual canonical Arena floor required')
    base = Path('/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024')
    auth = json.loads(read(base / 'auth-result.json'))
    proposal = json.loads(read(OPS / 'arena-ypal-current-admission-v1.proposal.json',
                              '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4'))
    urls = []
    source_url = None
    source_file = proposal['sourceReader']['privateFile']
    need(source_file == '/etc/yunipals-arena/native-read.env', 'retained dedicated native reader file required')
    for name, expected in auth['credentialFiles'].items():
        need(name == source_file or name.startswith('/etc/yunipals-unified/consumers/'), 'fixed retained credential directory required')
        env = {}
        for line in read(Path(name), expected).decode().splitlines():
            if not line or line.startswith('#'):
                continue
            fields = shlex.split(line)
            need(len(fields) == 1 and '=' in fields[0], 'literal retained credential input required')
            key, value = fields[0].split('=', 1)
            need(key not in env, 'duplicate private credential key'); env[key] = value
        if name.endswith('/native-read.env'):
            need(set(env) == {'ARENA_INDEXER_MODE', 'ARENA_INDEXER_RELEASE_ID', 'ARENA_INDEXER_SOURCE_KIND', 'ARENA_INDEXER_DATABASE_URL'}
                 and env['ARENA_INDEXER_MODE'] == env['ARENA_INDEXER_SOURCE_KIND'] == 'unified'
                 and env['ARENA_INDEXER_RELEASE_ID'] == RELEASE, 'exact retained native source selectors required')
            role, oid, url, database, port = 'arena_native_reader', auth['sourceRole']['oid'], env['ARENA_INDEXER_DATABASE_URL'], 'yunipals_backfill', 5432
            source_url = url
        else:
            workers = [w for w in proposal['workers'] if w['privateOverlay'] == name]
            need(len(workers) == 1 and set(env) == {'ARENA_DATABASE_URL'}, 'one retained operational role required')
            role = workers[0]['role']; oid = auth['roles'][role]; url = env['ARENA_DATABASE_URL']; database, port = 'yunipals_arena', 15438
        target = urlsplit(url)
        need(target.scheme in {'postgres', 'postgresql'} and target.hostname == '127.0.0.1' and target.port == port
             and unquote(target.path) == '/' + database and unquote(target.username or '') == role and bool(target.password), 'retained local dedicated Arena credential required')
        need(type(oid) is int or type(oid) is str and oid.isdecimal(), 'actual dedicated role OID required')
        urls.append({'name': role, 'oid': int(oid), 'url': url})
    need(len(urls) == 9 and len({r['name'] for r in urls}) == 9 and source_url is not None, 'all nine actual Arena roles required')
    context = {'releaseId': RELEASE, 'schema': PHYSICAL, 'schemaOid': '75963410', 'buildId': '71e2a7f3b7',
               'manifestHash': '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
               'profileId': '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff',
               'baseRpc': 'http://127.0.0.1:19222/unified', 'policy': 'latest', 'subsequentBlocks': 0,
               'deployment': '8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca', 'startBlock': '52648146',
               'abiHash': '0x92fff205c89c168c18abdb66ac1f46329941822e998ceccbaa153a13db183f53'}
    return {'sourceContext': context, 'sourceUrl': source_url, 'authUrls': urls, 'floor': floor,
            'expectedOrigins': None, 'intents': [], 'epoch': None, 'retainedLedger': None, 'privateSeal': None}


def booster_after(before):
    """Expected graph with only the eight owned read edges added."""
    import copy
    expected = copy.deepcopy(before)
    role = expected['baseline']['role']
    need(role['oid'] == '73187672' and role['name'] == 'yunipals_unified_collector' and role['login'] is True
         and all(role[key] is False for key in ('super', 'createDb', 'createRole', 'replication', 'bypassRls')),
         'existing restricted collector role required')
    tables = expected['target']['tables']
    need(expected['target']['schemaOid'] == '75963410' and expected['target']['owner'] == '73004621'
         and expected['target']['usage'] is True and expected['target']['create'] is False
         and {r['name']: r['oid'] for r in tables} == TARGET_OIDS, 'actual native Booster schema required')
    for row in tables:
        need(row['owner'] == '73004621' and row['kind'] == 'r' and row['rls'] is False
             and row['forceRls'] is False and row['writes'] is False and row['columnWrites'] is False,
             'unchanged owned Booster table without writer privilege required')
        if row['name'] not in EIGHT:
            continue
        need(row['select'] is False and row['writes'] is False and row['columnWrites'] is False,
             'exact eight SELECT prestate without writer privilege required')
        need(not any(e['grantee'] == '73187672' and e['privilege'] == 'SELECT' for c in row['columnAcl'] for e in c['acl']), 'no overlapping column SELECT')
        row['select'] = True
        row['acl'].append({'grantee': '73187672', 'grantor': '73004621', 'privilege': 'SELECT', 'grantable': False})
        row['acl'].sort(key=lambda e: (e['grantee'], e['grantor'], e['privilege'], e['grantable']))
        expected['baseline']['edges'].append({'kind': 'relation', 'object': row['oid'], 'grantor': '73004621', 'privilege': 'SELECT', 'grantable': False})
    need({r['name'] for r in tables if r['name'] in EIGHT} == set(EIGHT), 'all exact eight Booster tables required')
    expected['baseline']['edges'].sort(key=lambda e: (e['kind'], e['object'], e['grantor'], e['privilege'], e['grantable']))
    return expected


def booster_grant_sql(before, after, catalog_query):
    """Only eight SELECTs; compare the entire caller-captured ACL/column graph."""
    expected = booster_after(before)
    need(after == expected and catalog_query.startswith('SELECT ') and ';' not in catalog_query, 'only exact eight catalog edges may change')
    literal = lambda value: "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    guard = lambda value: 'DO $cold$ BEGIN IF (' + catalog_query + ') IS DISTINCT FROM ' + literal(value) + " THEN RAISE EXCEPTION 'cold_booster_catalog_changed';END IF;END $cold$;\n"
    return ("BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';"
            "SELECT pg_advisory_xact_lock(17928000,2401);\n" + guard(before) +
            'SET LOCAL ROLE yunipals_unified_shadow;\n' + ''.join('GRANT SELECT ON TABLE ' + PHYSICAL + '.' + name + ' TO yunipals_unified_collector;\n' for name in EIGHT) +
            'RESET ROLE;\n' + guard(after) + 'COMMIT;\n')


def booster_catalog_sql():
    """Full existing collector ACL footprint plus the exact ten native tables."""
    names = ','.join("'" + name + "'" for name in TARGET_OIDS)
    return """SELECT jsonb_build_object('baseline',jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,
        'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,
        'bypassRls',rolbypassrls,'inherit',rolinherit,'limit',rolconnlimit)FROM pg_roles WHERE oid=73187672),
      'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)
        FROM pg_auth_members m WHERE roleid=73187672 OR member=73187672),
      'edges',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','relation','object',c.oid::text,
        'grantor',a.grantor::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY c.oid::text,a.grantor::text,a.privilege_type,a.is_grantable),'[]'::jsonb)
        FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a
        WHERE a.grantee=73187672),
      'schemaAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',n.oid::text,'owner',n.nspowner::text,
        'acl',n.nspacl::text)ORDER BY n.oid),'[]'::jsonb)FROM pg_namespace n),
      'columnAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('relation',a.attrelid::text,'number',a.attnum,
        'acl',a.attacl::text)ORDER BY a.attrelid,a.attnum),'[]'::jsonb)FROM pg_attribute a
        WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
      'functionAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid::text,'owner',p.proowner::text,
        'definer',p.prosecdef,'acl',p.proacl::text)ORDER BY p.oid),'[]'::jsonb)FROM pg_proc p WHERE p.proacl IS NOT NULL),
      'defaultAcl',(SELECT coalesce(jsonb_agg(to_jsonb(d)ORDER BY oid),'[]'::jsonb)FROM pg_default_acl d)),
      'target',jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='unified_ypal_20261023_v1'),
        'owner',(SELECT nspowner::text FROM pg_namespace WHERE nspname='unified_ypal_20261023_v1'),
        'usage',has_schema_privilege('yunipals_unified_collector','unified_ypal_20261023_v1','USAGE'),
        'create',has_schema_privilege('yunipals_unified_collector','unified_ypal_20261023_v1','CREATE'),
        'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,
          'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
          'columnWrites',has_any_column_privilege('yunipals_unified_collector',c.oid,'INSERT,UPDATE,REFERENCES'),
          'columnAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('number',col.attnum,'name',col.attname,
            'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',ce.grantee::text,'grantor',ce.grantor::text,
              'privilege',ce.privilege_type,'grantable',ce.is_grantable)ORDER BY ce.grantee,ce.grantor,ce.privilege_type,ce.is_grantable),'[]'::jsonb)
              FROM aclexplode(col.attacl)ce))ORDER BY col.attnum),'[]'::jsonb)FROM pg_attribute col
            WHERE col.attrelid=c.oid AND col.attnum>0 AND NOT col.attisdropped AND col.attacl IS NOT NULL),
          'select',has_table_privilege('yunipals_unified_collector',c.oid,'SELECT'),
          'writes',has_table_privilege('yunipals_unified_collector',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
          'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,
            'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
            FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a))ORDER BY c.relname)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='unified_ypal_20261023_v1' AND c.relname IN(""" + names + "))))"


if __name__ == '__main__':
    print(json.dumps({'staticOnly': True, 'arenaUnits': ARENA_UNITS, 'databaseActions': False}))
