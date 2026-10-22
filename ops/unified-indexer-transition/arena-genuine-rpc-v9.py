#!/usr/bin/env python3
"""Reviewed fresh local Arena/Ponder/PG/Anvil lifecycle; never production SQL."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import time

FORMAT = 'yunipals-arena-genuine-rpc-v9'
SOURCE = '6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
INVENTORY_SHA = 'dbc145f11d13c61ce45b2bcf3c557bd90431bda7ce4a6dbe62136a24db84ab58'
MANIFEST_SHA = '905d69f1fddc893e882c1c7695288bed85257e2fe7450b3bdc68db099cb55e38'
OPS = Path('/opt/yunipals-unified/operations/arena-genuine-rpc-20261021')
INVENTORY = OPS / 'runtime-supplement.inventory.json'
VOLUME = Path('/mnt/HC_Volume_107222036')
UNIT = 'yunipals-arena-genuine-rpc-20261021-i.service'
NODE = '/opt/node-v24.18.1/bin/node'
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
PG = Path('/usr/lib/postgresql/16/bin')
PG_SHA = {'postgres':'201d8daff9a5bd9df70b820471b965c39f5a776d677f395232c477d051270722',
          'initdb':'df8c50fd508bb31db312a8519a2e7922c63b44f7d963c39d58dc107169078a0d',
          'psql':'df8031178589c31c7bc20aa2adf902e1cc3f0aa9ea12428aa5db3d476cbcac1a'}
ANVIL_SHA = '00f97668e1ae0fcca118fd7d2d1b6d25c0496447a523ca6bc2dfd10958c99604'
HARNESS_SHA = 'ae702bb83d69017ad0b81adf4243ea5b0d9a4e87bdcf096220dc609e69b0257f'
PROJECT_SHA = 'dff37737e1dd6e13cfe9e8b15e36f9e3301659fd7763335d1a7b96f45d1a2e17'
ADAPTER_SHA = 'a5641bc000945a7500b3e0d625240b6d7660fa5c0ab81b448bb90611014eb29e'
UID, GID = 964, 958
SCRATCH_CAP, TMP_CAP, RESERVE = 3584*1024**2, 512*1024**2, 25_000_000_000
LIMIT = 1800
PORTS = [55446, 55447, 55448]
ARTIFACTS = ['out/YunipalsArena.sol/YunipalsArena.json',*[f'out/YunipalsArena.t.sol/{name}.json' for name in ['MockWrapper','MockNft','MockCurrency']]]
ISLAND_PUBLIC = 'docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public'
ARTWORK = {'docs/arena/identity-registry-v1/references/'+value+'.img':(size,value) for size,value in [
    (54975,'b54e93886c98b5c1eaf6a0e7f66bd077e621acbdd6a5028dcd78ea25221d92ac'),
    (57245,'51dbacaf45e811b8dad37c70e8ed95cc5ad4871cbfef086631ee7f5e87bfe737'),
    (53532,'44ad25444d04e1e12649b7ac8dd2d0271da0c0a559125fe5497e1e28225078f4'),
    (68224,'79503d9875153a1a38bc94fdf3b74fd0713d2f776d5e2e44ba59a1b3bb8c0752')]}
ARTWORK[ISLAND_PUBLIC+'/images/195.png']=(1853360,'d825587422ba9b317413c0c063febac7caf4a96fd865193fa891e37e793bf212')
ARTWORK_MANIFEST_SHA = '0ad47219f10fbaa36d07bee309ad7e9ef22a66846957da9fec8f4e8fff1ce9f9'
MUSIC = 'docs/islands/race-film-v4/audio/split-in-synapse-original.mp3'
MUSIC_SHA = 'a75abb4ea5e2386d0dfea4ff9fa828d6d12359bda068d2dab001d51291f69ac4'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_SHA = '5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895'
PYTHON_SCRIPTS = {'media_tools.py':'dda27362fa8107ff58e03731d61cac76048376fb71197dc0780260374b1b6b75',
    'produce.py':'51ac2ede8666c5879caec4d5dd19383c807d83ff1ca10092148c70861160f63a',
    'referee.py':'f35734d4cde26e12184a8d12746f94294223c96e2cb8daddccc03c713bf43e1a',
    'render.py':'cbcd3c798295c5da70f1366eaf04626510433932a228a1d0b8381a738938944f',
    'validate_candidate.py':'00fdfc5ef120a8ccf330a4da4fb9055a3a930725818cb820cea0eee1f37a079e'}
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC',
       'PGCONNECT_TIMEOUT':'3','PYTHONDONTWRITEBYTECODE':'1'}
LIVE = ['/var/lib/postgresql','/run/postgresql','/var/run/postgresql','/etc/postgresql','/var/backups',str(VOLUME/'typed-20261021-d')]


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()
def trusted(path, expected=None, maximum=5_000_000):
    path=Path(path)
    for ancestor in [*reversed(path.parents),path]:
        info=ancestor.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:fail('Protected public input required.')
    info=path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size>maximum:fail('Bounded public regular file required.')
    raw=path.read_bytes()
    if expected and sha(raw)!=expected:fail('Pinned public input changed.')
    return raw
def once(text,before,after):
    if text.count(before)!=1:fail('Exact frozen harness transformation changed.')
    return text.replace(before,after)


def transformed_harness(raw):
    if sha(raw)!=HARNESS_SHA:fail('Frozen receipt harness differs.')
    text=raw.decode()
    edits=[('createArenaPonderFixture','createArenaRpcFixture'),('arena-ponder-postgres.mjs','arena-rpc-postgres.mjs'),
      ('http://127.0.0.1:55442','http://127.0.0.1:55446'),
      ('    "test test test test test test test test test test test junk",','    process.env.ARENA_FIXTURE_MNEMONIC,'),
      ('  await localRpc("anvil_reset");\n',''),
      ('const storage = await mkdtemp("/tmp/yunipals-native-arena-anvil-");','const storage = await mkdtemp(join(process.env.TMPDIR, "arena-storage-"));'),
      ('  assert.equal(await localRpc("evm_revert", [openingSnapshot]), true);','  await source.pauseForReorg();\n  assert.equal(await localRpc("evm_revert", [openingSnapshot]), true);'),
      ('  assert.equal(await localRpc("evm_revert", [freezeSnapshot]), true);','  await source.pauseForReorg();\n  assert.equal(await localRpc("evm_revert", [freezeSnapshot]), true);'),
      ('    join(root, "docs/unified-indexer/native-arena-anvil-2026-10-20.json"),','    join(process.env.TMPDIR, "arena-lifecycle-report.json"),'),
      ('      "test feed dispatches real receipts; Ponder RPC sync engine is not started",','      "Controlled Ponder outage/restart reorg recovery, not uninterrupted same-process recovery",'),
      ('      "installed Ponder handlers/DDL/checkpoints and rollback",','      "actual Ponder RPC synchronization, native checkpoints and restart-based reorg recovery",')]
    # The imported symbol occurs twice; constrain the exact two contexts.
    text=once(text,'import { createArenaPonderFixture }','import { createArenaRpcFixture }')
    text=once(text,'source = await createArenaPonderFixture({','source = await createArenaRpcFixture({')
    text=once(text,'import { verifyNativeArenaFilm } from "../src/arena/live/mediaAdoption.ts";',
              'import { verifyNativeArenaFilm } from "../src/arena/live/mediaAdoption.ts";\nimport { mediaFolder, mediaIncarnation } from "../src/arena/live/mediaPaths.ts";')
    text=once(text,'import { ArenaIntake } from "../src/arena/live/intake.ts";',
              'import { ArenaIntake } from "../src/arena/live/intake.ts";\nimport { createAdmission } from "../src/arena/live/admission.ts";')
    for before,after in edits[1:]:text=once(text,before,after)
    before='''    const expiry = (await client.getBlock()).timestamp + 480n;
    const permit = await accounts[4].signTypedData({
      domain: arenaDomain(arena.address),
      types: ARENA_ENTRY_TYPES,
      primaryType: "EntryPermit",
      message: { tournamentId: 1n, ...entry, expiry }
    });
    await pool.query(
      `INSERT INTO yunipals_arena.admission(deployment,tournament_id,incarnation,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
      VALUES($1,1,$2,$3,1,$4,$5,$6,$7,$8,$9)`,
      [
        deployment,
        context.incarnation,
        entry.player.toLowerCase(),
        entry.collection,
        String(entry.tokenId),
        String(secondOpening.blockNumber),
        secondOpening.blockHash,
        String(expiry),
        permit
      ]
    );'''
    after='''    await source.sync();
    const ownershipFixture = {
      getBlock: async ({ blockTag }) => {
        assert.equal(blockTag, "finalized");
        return client.getBlock({ blockTag: "latest" });
      },
      readContract: async ({ address, functionName, args }) => {
        assert.equal(address, entry.collection);
        assert.equal(functionName, "ownerOf");
        assert.deepEqual(args, [entry.tokenId]);
        return entry.player;
      }
    };
    const admit = createAdmission(service, accounts[4], new Map([[1, ownershipFixture], [8453, client]]), (id, nft) => identities.ensure(id, nft));
    const request = { nftChainId: 1, collection: entry.collection, tokenId: String(entry.tokenId), incarnation: context.incarnation };
    const admitted = await admit("1", entry.player, request);
    assert.deepEqual(await admit("1", entry.player, request), admitted);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM yunipals_arena.admission WHERE deployment=$1 AND wallet=$2", [deployment, entry.player.toLowerCase()])).rows[0].n, 1);
    const expiry = BigInt(admitted.expiry), permit = admitted.signature;'''
    text=once(text,before,after)
    text=once(text,'  await write(wrapper, "fulfill", [requested.requestId, 777n]);',
'''  // Deliberately controlled mock VRF: retain the recorded candidate's terrain
  // while randomizing test-wallet/contract identities; not a randomness test.
  let fixtureWord = 0n;
  while (fixtureWord < 100000n && onchainIslandDraw(arena.address, "1", String(fixtureWord), catalog.pool.entries).tokenId !== fixture.island.tokenId) fixtureWord++;
  assert.ok(fixtureWord < 100000n);
  assert.equal(fixture.island.tokenId, "195");
  await write(wrapper, "fulfill", [requested.requestId, fixtureWord]);''')
    text=once(text,'    "777",','    String(fixtureWord),')
    # Each preceding join is immediately visible to the next admission.
    text=once(text,'    entries.push(await write(arena, "join", [1n, entry, expiry, permit], seat));',
              '    entries.push(await write(arena, "join", [1n, entry, expiry, permit], seat));\n    await source.sync();')
    snapshot='''
  async function durablePrivateSnapshot() {
    const rows = {};
    for (const table of [...arenaPrivateTables, "tournament_identity", "provider_action_evidence", "media_publication"]) {
      // Scheduler lease/due timestamps may advance on an idempotent worker
      // tick. Every business field, including ciphertext/UUID/cost/intents and
      // publication evidence, must remain identical.
      const result = await pool.query(`SELECT (to_jsonb(t)-'native_check_at'-'native_check_lease')::text AS value FROM yunipals_arena.${table} t ORDER BY 1`);
      assert.ok(result.rows.length <= 1000);
      rows[table] = result.rows.map(row => row.value);
    }
    return sha256(canonicalJson(rows));
  }
  const privateBeforeRestart = await durablePrivateSnapshot();
  const requestsBeforeRestart = stubbedRefereeRequests;
  const filmPath = join(mediaFolder(join(storage, "published"), deployment, "1", mediaIncarnation(deployment, "1", current)), "film.mp4");
  const filmBeforeRestart = sha256(await readFile(filmPath));
  assert.equal(filmBeforeRestart, mediaReport.film.sha256);
  await source.restart();
  assert.equal(await durablePrivateSnapshot(), privateBeforeRestart);
  assert.equal((await refereeWorker.tick()).state, "waiting");
  await disclosure.tick();
  assert.equal(stubbedRefereeRequests, requestsBeforeRestart);
  assert.equal(await durablePrivateSnapshot(), privateBeforeRestart);
  assert.equal(sha256(await readFile(filmPath)), filmBeforeRestart);
  const actualPonderBuild = source.release.buildId;
  const actualPonderManifest = source.release.manifestHash;
'''
    text=once(text,'  const payout = await control.prepare("release-payouts", "1");',snapshot+'  const payout = await control.prepare("release-payouts", "1");')
    text=once(text,'    operationalProjectionRows: 0,','    operationalProjectionRows: 0,\n    actualPonderBuild, actualPonderManifest,\n    controlledMockVrfWord: String(fixtureWord), pilotIslandTokenId: fixture.island.tokenId,\n    privateRestartSnapshotSha256: privateBeforeRestart,\n    realPonderRestartCount: source.processStops.length,\n    realPonderForcedStops: source.processStops.filter(row => row.forced).length,')
    text=once(text,'      "mock currency, islands and VRF wrapper",','      "mock currency, islands and VRF wrapper; bounded chosen word targets recorded island195, no randomness-quality claim",\n      "Ethereum NFT ownership point responses are fixture-only; Base action checks use actual Anvil",')
    text=once(text,'  await source?.close();','  await source?.close();\n  assert.ok(!source || source.processStops.every(row => row.forced === false), "Final owned Ponder shutdown must be graceful");')
    # Provider responses remain explicitly stubbed; unit PrivateNetwork is the
    # separate no-external-network boundary. No provider configuration copied.
    if 'anvil_reset' in text or text.count('await source.pauseForReorg();')!=2:fail('Owned reorg/reset transformation incomplete.')
    return text.encode()


def transformed_project(raw):
    if sha(raw)!=PROJECT_SHA:fail('Frozen RPC fixture configuration helper differs.')
    text=raw.decode()
    # Scratch mirror lib/src are read-only links. cp must dereference into the
    # NEW fixture project before configuration edits; never write through links.
    for name in ['lib','src']:
        text=once(text,f'cp(join(source, "{name}"), join(root, "{name}"), {{ recursive: true }})',
                  f'cp(join(source, "{name}"), join(root, "{name}"), {{ recursive: true, dereference: true }})')
    # Workspace/dependency links resolve into this one fully pinned immutable
    # release. ViteNode's direct SSR module loads still enforce fs.allow.
    text=once(text,'JSON.stringify([repository, directory])',
              'JSON.stringify([repository, directory, '+json.dumps(str(ROOT))+'])')
    return text.encode()


def private_temporary_mounts():
    rows=[line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
    observations=[]
    for target in ['/tmp','/var/tmp']:
        info=Path(target).stat();vfs=os.statvfs(target);device=str(os.major(info.st_dev))+':'+str(os.minor(info.st_dev))
        matches=[row for row in rows if len(row)>9 and row[4]==target and row[2]==device]
        if len(matches)!=1:fail('Exact effective temporary mount device required.')
        row=matches[0];separator=row.index('-');capacity=vfs.f_blocks*vfs.f_frsize
        if row[separator+1]!='tmpfs' or row[3]!='/' or 'rw' not in row[5].split(',') or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o1777 or not 0<capacity<=TMP_CAP//2:fail('Separate bounded private 256MiB temporary filesystems required.')
        observations.append({'target':target,'device':device,'capacityBytes':capacity,'uid':0,'mode':0o1777})
    if observations[0]['device']==observations[1]['device'] or sum(row['capacityBytes'] for row in observations)>TMP_CAP:fail('Distinct private temporary mounts with total512MiB cap required.')
    return observations


def sandbox():
    if os.getresuid()!=(UID,)*3 or os.getresgid()!=(GID,)*3 or set(os.getgroups())-set([GID]):fail('Exact dedicated nonroot fixture identity required.')
    fields={k:v.strip() for k,_,v in (line.partition(':') for line in Path('/proc/self/status').read_text().splitlines())}
    if any(int(fields[k],16)!=0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) or fields['NoNewPrivs']!='1':fail('Capability-free NNP sandbox required.')
    # The unprivileged process cannot inspect PID1's namespace on every host.
    # The exact effective systemd unit below proves PrivateNetwork instead.
    temporary=private_temporary_mounts()
    keys=['Id','MainPID','ExecMainStartTimestampMonotonic','PrivateNetwork','PrivateTmp','NoNewPrivileges','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','RuntimeMaxUSec','Restart','ProtectSystem','ProtectHome','ReadWritePaths','InaccessiblePaths','AmbientCapabilities','CapabilityBoundingSet','EnvironmentFiles','Environment','IOWriteBandwidthMax','KillMode','TimeoutStopUSec']
    raw=subprocess.run(['/usr/bin/systemctl','show','--all',UNIT,*['--property='+k for k in keys]],env=ENV,capture_output=True,timeout=5,check=True).stdout.decode()
    values={}
    for line in raw.splitlines():
        key,sep,value=line.partition('=')
        if not sep or key not in keys or key in values:fail('Unexpected fixture unit shape.')
        values[key]=value
    return {**check_unit_settings(values),'temporaryMounts':temporary}


def check_unit_settings(values):
    expected={'Id':UNIT,'MainPID':str(os.getpid()),'PrivateNetwork':'yes','PrivateTmp':'no','NoNewPrivileges':'yes','MemoryMax':'4294967296','MemorySwapMax':'0','CPUQuotaPerSecUSec':'1s','RuntimeMaxUSec':'30min','Restart':'no','ProtectSystem':'strict','KillMode':'control-group','TimeoutStopUSec':'30s'}
    if any(values.get(k)!=v for k,v in expected.items()) or values.get('ProtectHome') not in {'yes','read-only'}:fail('Exact bounded fixture unit required.')
    if not re.fullmatch('[1-9][0-9]+',values.get('ExecMainStartTimestampMonotonic','')):fail('Actual bounded fixture unit clock required.')
    for key,typ in [('EnvironmentFiles','a(sb)'),('Environment','as')]:
        if key not in values:values[key]=typed_empty(key,typ)
    if values.get('AmbientCapabilities','') or values.get('CapabilityBoundingSet','') or values.get('EnvironmentFiles',''):fail('No capabilities/private environment files allowed.')
    if values['Environment'] or values.get('IOWriteBandwidthMax','').split()!=['/dev/sdb','52428800']:fail('No inherited unit environment; exact 50MiB/s volume write bound required.')
    if not set(LIVE)<=set(values.get('InaccessiblePaths','').split()):fail('Live PostgreSQL paths must be inaccessible.')
    return values


def typed_empty(key,typ):
    def read(argv):
        completed=subprocess.run(argv,env=ENV,capture_output=True,timeout=3,check=True)
        if len(completed.stdout)>16000 or completed.stderr:fail('Bounded public unit property required.')
        return json.loads(completed.stdout)
    obj=read(['/usr/bin/busctl','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT])
    if set(obj)!={'type','data'} or obj['type']!='o' or len(obj['data'])!=1 or not re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',obj['data'][0]):fail('Exact typed fixture unit required.')
    value=read(['/usr/bin/busctl','--json=short','get-property','org.freedesktop.systemd1',obj['data'][0],'org.freedesktop.systemd1.Service',key])
    if value!={'type':typ,'data':[]}:fail('Only proved empty fixture environment properties can be absent.')
    return ''


def runtime_check():
    manifest=json.loads(trusted(ROOT/'RELEASE-MANIFEST.json',MANIFEST_SHA))
    inventory=json.loads(trusted(INVENTORY,INVENTORY_SHA,30_000_000))
    if manifest['sourceDigest']!=SOURCE or inventory['sourceDigest']!=SOURCE or len(inventory['entries'])!=60918:fail('Exact source6/runtime closure required.')
    for row in manifest['files']:
        path=ROOT/row['path']
        if not path.is_relative_to(ROOT) or '..' in path.parts or digest(path)!=row['sha256'] or path.stat().st_size!=row['bytes']:fail('Installed source checksum differs.')
    for row in inventory['entries']:
        path=ROOT/row['path'];info=path.lstat()
        if not path.is_relative_to(ROOT) or '..' in path.parts or stat.S_IMODE(info.st_mode)!=row['mode']:fail('Installed runtime path/mode differs.')
        if row['type']=='file':
            if not stat.S_ISREG(info.st_mode) or digest(path)!=row['sha256'] or info.st_size!=row['bytes']:fail('Installed runtime file differs.')
        elif row['type']=='symlink':
            if not stat.S_ISLNK(info.st_mode) or os.readlink(path)!=row['target'] or not path.resolve(strict=True).is_relative_to(ROOT):fail('Installed runtime link differs.')
        elif row['type']!='directory' or not stat.S_ISDIR(info.st_mode):fail('Installed runtime entry differs.')
    return {'sourceDigest':SOURCE,'sourceFiles':len(manifest['files']),'runtimeEntries':60918,'inventorySha256':INVENTORY_SHA}


def ports_free():
    for port in PORTS:
        with socket.socket() as sock:sock.bind(('127.0.0.1',port))


def contracts_check(expected):
    manifest=json.loads(trusted(OPS/'contracts-manifest.json',expected))
    if set(manifest)!={'format','files'} or manifest['format']!='yunipals-arena-public-contract-fixtures-v1':fail('Exact reviewed public contract closure required.')
    rows=manifest['files'];names=set();required=set(ARTIFACTS);total=0
    if not isinstance(rows,list) or len(rows)>100:fail('Bounded exact public contract closure required.')
    for row in rows:
        if set(row)!={'path','bytes','sha256'} or not isinstance(row['path'],str) or not re.fullmatch('[A-Za-z0-9_./-]+',row['path']) or any(part in {'','.','..'} for part in row['path'].split('/')) or row['path'].startswith('/') or row['path'] in names:fail('Safe unique public contract path required.')
        if type(row['bytes']) is not int or row['bytes']<0 or not re.fullmatch('[0-9a-f]{64}',row['sha256']):fail('Exact public contract file pin required.')
        raw=trusted(OPS/'contracts/arena'/row['path'],row['sha256'])
        if len(raw)!=row['bytes']:fail('Public contract length differs.')
        total+=len(raw);names.add(row['path'])
        if row['path'] in ARTIFACTS:
            artifact=json.loads(raw)
            if artifact.get('metadata',{}).get('compiler',{}).get('version')!='0.8.30+commit.73712a01' or not artifact.get('bytecode',{}).get('object'):fail('Exact precompiled Solidity metadata required; no rebuild.')
            required.update(artifact['metadata']['sources'])
    if names!=required or total>10_000_000 or not set(ARTIFACTS)<=names or any(not name.endswith('.sol') for name in names-set(ARTIFACTS)):fail('Only four artifacts and their entire Solidity metadata source union are permitted.')
    return {'manifestSha256':expected,'files':len(names),'bytes':total,'compiler':'0.8.30+commit.73712a01'}


def artwork_check():
    manifest=json.loads(trusted(OPS/'artwork-manifest.json',ARTWORK_MANIFEST_SHA))
    expected=[{'path':name,'bytes':row[0],'sha256':row[1]} for name,row in ARTWORK.items()]
    if manifest!={'format':'yunipals-arena-public-artwork-fixtures-v1','files':expected}:fail('Exact five public artwork inputs required.')
    result={}
    for relative,(size,expected) in ARTWORK.items():
        source=OPS/'artwork'/relative
        raw=trusted(source,expected)
        if len(raw)!=size:fail('Fixed public artwork length differs.')
        result[relative]={'path':str(source),'bytes':size,'sha256':expected}
    return result


def python_probe():
    # Both unchanged worker subprocesses use this fixed PATH. Discover only
    # its existing public interpreter; no package installation or private env.
    executable=shutil.which('python3',path='/usr/local/bin:/usr/bin:/bin')
    if not executable:fail('Existing worker Python interpreter required.')
    actual=Path(executable).resolve(strict=True)
    if not (str(actual).startswith('/usr/bin/python3') or str(actual).startswith('/usr/local/bin/python3')):fail('Only existing public system Python allowed.')
    binary=trusted(actual,maximum=100_000_000)
    code="import importlib.metadata,json,jsonschema,sys;jsonschema.Draft202012Validator({'type':'object'}).validate({});print(json.dumps({'python':sys.version.split()[0],'jsonschema':importlib.metadata.version('jsonschema'),'module':jsonschema.__file__}))"
    result=subprocess.run([executable,'-I','-c',code],env=ENV,capture_output=True,timeout=5,check=True)
    if len(result.stdout)>16000 or result.stderr:fail('Bounded existing validator dependency probe required.')
    value=json.loads(result.stdout)
    if set(value)!={'python','jsonschema','module'} or not re.fullmatch(r'3\.[0-9]+\.[0-9]+',value['python']) or not re.fullmatch(r'4\.[0-9]+\.[0-9]+',value['jsonschema']):fail('Existing Python3/jsonschema4 validator required.')
    module=Path(value['module'])
    if not (str(module).startswith('/usr/lib/python3/') or re.fullmatch(r'/usr/local/lib/python3\.[0-9]+/site-packages/jsonschema/__init__\.py',str(module))):fail('Only existing public system jsonschema module allowed.')
    return {**value,'executable':executable,'actualExecutable':str(actual),'binarySha256':sha(binary),'moduleSha256':sha(trusted(module))}


def readonly_tree(source,destination,overrides):
    """Make only override ancestors; all other installed inputs remain links."""
    destination.mkdir()
    children={path.name:path for path in source.iterdir()} if source.is_dir() else {}
    names=set(children)|{Path(name).parts[0] for name in overrides}
    for name in names:
        target=destination/name
        if name in overrides:target.symlink_to(overrides[name])
        else:
            nested={key[len(name)+1:]:value for key,value in overrides.items() if key.startswith(name+'/')}
            if nested:readonly_tree(source/name,target,nested)
            else:target.symlink_to(children[name])


def readonly_dependencies(source,destination):
    """Own Vite's config scratch; preserve every installed dependency target."""
    if not source.is_dir():fail('Pinned installed indexer dependencies required.')
    destination.mkdir(mode=0o700)
    for child in sorted(source.iterdir()):
        if child.name!='.vite-temp':(destination/child.name).symlink_to(child)
    # Vite writes bundled ESM configuration below the nearest node_modules.
    # The installed source tree remains immutable; only this empty new cache
    # directory (and the symlink entries' parent) is owned by the fixture.
    (destination/'.vite-temp').mkdir(mode=0o700)


def review(plan):
    if set(plan)!={'format','runId','parent','anvil','ffmpegSha256','ffprobeSha256','contractsManifestSha256'} or plan['format']!=FORMAT or not re.fullmatch('20261021-[a-z0-9-]{1,24}',plan['runId']):fail('Exact bounded public plan required.')
    parent=Path(plan['parent']);work=parent/plan['runId']
    if parent.parent!=VOLUME or parent.name!='arena-genuine-rpc' or parent.is_symlink() or not parent.is_dir() or work.exists():fail('Fresh dedicated supplied-volume fixture path required.')
    info=parent.stat()
    if info.st_uid!=UID or info.st_gid!=GID or stat.S_IMODE(info.st_mode)!=0o700:fail('Dedicated isolated scratch parent required.')
    if shutil.disk_usage(parent).free<RESERVE+SCRATCH_CAP:fail('Initial 25GB reserve plus full scratch allowance required.')
    unit=sandbox()
    if unit['ReadWritePaths'].split()!=[str(parent)]:fail('Only reviewed scratch parent may be writable.')
    # Names/metadata only: every other mounted-volume child must be hidden,
    # including failed/partial typed restores owned by this same isolated UID.
    hidden=set(unit['InaccessiblePaths'].split())
    if any(str(path) not in hidden for path in VOLUME.iterdir() if path!=parent):fail('All other retained volume paths must be inaccessible.')
    ports_free()
    binaries={NODE:NODE_SHA,**{str(PG/name):expected for name,expected in PG_SHA.items()},plan['anvil']:ANVIL_SHA,
              '/usr/bin/ffmpeg':plan['ffmpegSha256'],'/usr/bin/ffprobe':plan['ffprobeSha256']}
    if plan['anvil']!=str(OPS/'bin/anvil') or any(not re.fullmatch('[0-9a-f]{64}',value) for value in binaries.values()):fail('Exact installed public binary pins required.')
    for path,expected in binaries.items():trusted(path,expected,150_000_000)
    source=runtime_check();python=python_probe()
    harness=trusted(ROOT/'apps/yunipals-market-api/scripts/native-arena-anvil.mjs',HARNESS_SHA)
    project=trusted(ROOT/'apps/yunipals-indexer/scripts/fixtures/unified-rpc-project.mjs',PROJECT_SHA)
    trusted(OPS/'arena-rpc-postgres.mjs',ADAPTER_SHA)
    contracts=contracts_check(plan['contractsManifestSha256']);artwork=artwork_check()
    music=OPS/'music'/MUSIC
    if len(trusted(music,MUSIC_SHA))!=1534276:fail('Exact existing public music input required.')
    trusted(FONT,FONT_SHA)
    for name,expected in PYTHON_SCRIPTS.items():trusted(ROOT/'scripts/arena'/name,expected)
    binding={'format':FORMAT,'plan':plan,'operatorSha256':digest(__file__),'unit':{k:v for k,v in unit.items() if k not in {'MainPID','ExecMainStartTimestampMonotonic','temporaryMounts'}},'source':source,'binaries':binaries,
             'harnessSourceSha256':HARNESS_SHA,'generatedHarnessSha256':sha(transformed_harness(harness)),
             'rpcProjectSourceSha256':PROJECT_SHA,'generatedRpcProjectSha256':sha(transformed_project(project)),
             'adapterSha256':ADAPTER_SHA,'contracts':contracts,'artwork':artwork,'music':{'path':str(music),'bytes':1534276,'sha256':MUSIC_SHA},'fontSha256':FONT_SHA,'unchangedPythonScripts':PYTHON_SCRIPTS,'pythonDependency':python,'sourceUid':UID,'sourceGid':GID,'ports':PORTS,'scratchCap':SCRATCH_CAP,'tmpCap':TMP_CAP,'reserve':RESERVE,'seconds':LIMIT}
    return {'format':FORMAT,'reviewHash':sha(encoded(binding)),'binding':binding,'observation':{'freeBytes':shutil.disk_usage(parent).free,'unitStartMonotonicUs':int(unit['ExecMainStartTimestampMonotonic']),'temporaryMounts':unit['temporaryMounts']},'started':False,'databaseCalls':0,'providerCalls':0}


def allocated(work):
    # Ponder/Vite/PG may unlink an entry between enumeration and accounting.
    # fwalk descriptors + no-follow stats never follow a substituted child link.
    work=Path(work);root=work.lstat()
    identity=lambda info:(info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode)
    if not stat.S_ISDIR(root.st_mode) or root.st_uid!=UID or root.st_gid!=GID or stat.S_IMODE(root.st_mode)!=0o700:fail('Exact owned allocation root required.')
    def vanished_child(error):
        if not isinstance(error,FileNotFoundError):raise error
    total=0
    try:
        for directory,dirs,files,fd in os.fwalk(work,follow_symlinks=False,onerror=vanished_child):
            entries=[os.fstat(fd)]
            for name in [*files,*dirs]:
                try:entries.append(os.stat(name,dir_fd=fd,follow_symlinks=False))
                except FileNotFoundError:continue
            for info in entries:
                if info.st_dev!=root.st_dev or stat.S_ISCHR(info.st_mode) or stat.S_ISBLK(info.st_mode):fail('Foreign allocation device refused.')
                # Readonly mirror symlinks are counted as links, never followed.
                total+=info.st_blocks*512
            if total>SCRATCH_CAP:break
    finally:
        if identity(work.lstat())!=identity(root):fail('Owned allocation root identity changed.')
    return total


def failure_location(error,work):
    area='unclassified_or_unretained';filename=getattr(error,'filename',None)
    if isinstance(filename,(str,bytes)):
        try:
            path=Path(os.fsdecode(filename));base=Path(work)
            if path==base:area='workspace_root'
            elif path==base/'fixture-empty.pgpass':area='owned_empty_passfile'
            elif path.is_relative_to(base/'pgdata'):area='fixture_pgdata'
            elif path.is_relative_to(base/'socket'):area='owned_pg_socket'
            elif path.is_relative_to(base/'tmp') or path.is_relative_to(base/'mirror'):
                area='owned_vite_cache' if '.vite-temp'in path.parts else 'owned_temporary_fixture' if path.is_relative_to(base/'tmp') else 'owned_scratch_mirror'
            elif re.fullmatch('/proc/[1-9][0-9]*/(?:stat|status|cgroup)',str(path)):area='process_metadata'
        except (TypeError,ValueError):pass
    frames=[];trace=error.__traceback__
    labels={'allocated','guard','wait','launch','run','sql','process_stat','stop_groups','members','prepare_root','prepare_passfile','check_passfile','mnemonic'}
    while trace:
        if trace.tb_frame.f_code.co_filename==__file__:
            name=trace.tb_frame.f_code.co_name
            frames.append({'source':name if name in labels else 'other_operator_frame','line':trace.tb_lineno})
        trace=trace.tb_next
    number=getattr(error,'errno',None)
    return {'relativeArea':area,'errno':number if type(number)is int and 0<=number<=255 else None,'operatorFrames':frames[-16:]}


def process_stat(pid):
    path=Path('/proc')/str(pid);raw=(path/'stat').read_text();tail=raw[raw.rfind(')')+2:].split()
    ids=[int(line.split()[1]) for line in (path/'status').read_text().splitlines() if line.startswith(('Uid:','Gid:'))]
    return {'pid':pid,'state':tail[0],'group':int(tail[2]),'session':int(tail[3]),'startTicks':int(tail[19]),'uid':ids[0],'gid':ids[1],'cgroup':(path/'cgroup').read_text()}


class Runner:
    def __init__(self,checked):
        self.checked=checked;self.plan=checked['binding']['plan'];self.work=Path(self.plan['parent'])/self.plan['runId']
        self.children=[];self.started=checked['observation']['unitStartMonotonicUs']/1_000_000;self.system_id=None;self.closed=[];self.own_cgroup=Path('/proc/self/cgroup').read_text()
        self.phase='fresh_workspace';self.error_label=None;self.sql_count=0;self.last_sql_diagnostic=None;self.passfile_identity=None;self.diagnostic_write_failed=False
        self.env={**ENV,'PGPASSFILE':str(self.work/'fixture-empty.pgpass')}
    def mark(self,phase):
        self.phase=phase
        try:
            with (self.work/'phases.jsonl').open('ab') as stream:
                stream.write(encoded({'phase':phase,'elapsedSeconds':round(time.monotonic()-self.started,3)})+b'\n')
        except OSError:self.diagnostic_write_failed=True
    def prepare_passfile(self):
        path=Path(self.env['PGPASSFILE'])
        with path.open('xb') as stream:os.fchmod(stream.fileno(),0o600)
        info=path.lstat();self.passfile_identity=(info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode,info.st_size)
        self.check_passfile()
    def check_passfile(self):
        info=Path(self.env['PGPASSFILE']).lstat()
        actual=(info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode,info.st_size)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=UID or info.st_gid!=GID or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size!=0 or actual!=self.passfile_identity:fail('Exact owned empty fixture passfile changed.')
    def guard(self):
        if time.monotonic()-self.started>LIMIT-60:fail('Owned fixture cleanup reserve reached.')
        if shutil.disk_usage(self.work).free<RESERVE:fail('Fixture volume reserve reached.')
        if allocated(self.work)>SCRATCH_CAP:fail('Fixture scratch cap reached.')
    def launch(self,name,argv,env=None,cwd=None):
        self.guard();log=(self.work/(name+'.log')).open('xb')
        child=subprocess.Popen(argv,env=env or self.env,cwd=cwd or self.work,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        item={'name':name,'child':child,'log':log,'identity':process_stat(child.pid)};self.children.append(item)
        if item['identity']['group']!=child.pid or item['identity']['session']!=child.pid or item['identity']['uid']!=UID or item['identity']['gid']!=GID or item['identity']['cgroup']!=self.own_cgroup:fail('New owned child session required.')
        return item
    def wait(self,item,seconds):
        deadline=time.monotonic()+seconds
        while item['child'].poll() is None:
            self.guard()
            if time.monotonic()>deadline:fail('Bounded owned child deadline.')
            time.sleep(0.2)
        if item['child'].returncode!=0:fail('Owned fixture child failed; raw log retained locally.')
    def sql(self,statement,database='postgres'):
        self.guard();self.check_passfile();self.sql_count+=1
        argv=[str(PG/'psql'),'-X','--no-password','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--host='+str(self.work/'socket'),'--port=55448','--username=arena_fixture_admin','--dbname='+database,'--command='+statement]
        result=subprocess.run(argv,env=self.env,capture_output=True,timeout=5,check=False)
        if result.returncode or len(result.stdout)>16000 or result.stderr:
            retained=result.stderr[:8192];path=self.work/f'sql-{self.sql_count}.stderr'
            with path.open('xb') as stream:os.fchmod(stream.fileno(),0o600);stream.write(retained)
            self.error_label='synthetic_psql_nonzero' if result.returncode else 'synthetic_psql_stderr' if result.stderr else 'synthetic_psql_stdout_limit'
            self.last_sql_diagnostic={'attempt':self.sql_count,'exitStatus':result.returncode,'label':self.error_label,'stderrBytes':len(result.stderr),'stderrSha256':sha(result.stderr),'retainedBytes':len(retained),'retainedFile':str(path)}
            if result.returncode:raise subprocess.CalledProcessError(result.returncode,['owned-synthetic-psql'])
            fail('Unexpected bounded synthetic PostgreSQL result; private diagnostic retained.')
        self.error_label=None;self.last_sql_diagnostic=None
        return result.stdout.decode().strip()
    def mirror(self):
        mirror=self.work/'mirror';market=mirror/'apps/yunipals-market-api';indexer=mirror/'apps/yunipals-indexer'
        for path in [market/'scripts',indexer/'scripts/fixtures',mirror/'docs/unified-indexer',mirror/'scripts'] :path.mkdir(parents=True)
        for name in ['src','node_modules','package.json','tsconfig.json']:(market/name).symlink_to(ROOT/'apps/yunipals-market-api'/name)
        for name in ['lib','src']:(indexer/name).symlink_to(ROOT/'apps/yunipals-indexer'/name)
        readonly_dependencies(ROOT/'apps/yunipals-indexer/node_modules',indexer/'node_modules')
        for name in ['ponder.schema.ts','ponder-env.d.ts','tsconfig.json','package.json']:
            shutil.copyfile(ROOT/'apps/yunipals-indexer'/name,indexer/name)
        for name in ['packages','node_modules']:(mirror/name).symlink_to(ROOT/name)
        (mirror/'contracts').symlink_to(OPS/'contracts')
        # __file__.resolve() defines the Python tools' repository root. Real
        # unchanged copies are necessary for their reads to use this mirror's
        # pinned public overlays rather than the immutable source directory.
        (mirror/'scripts/arena').mkdir()
        for name,expected in PYTHON_SCRIPTS.items():(mirror/'scripts/arena'/name).write_bytes(trusted(ROOT/'scripts/arena'/name,expected))
        for name in ['arena','islands']:
            prefix='docs/'+name+'/'
            overrides={key[len(prefix):]:Path(row['path']) for key,row in self.checked['binding']['artwork'].items() if key.startswith(prefix)}
            if MUSIC.startswith(prefix):overrides[MUSIC[len(prefix):]]=Path(self.checked['binding']['music']['path'])
            readonly_tree(ROOT/'docs'/name,mirror/'docs'/name,overrides)
        (indexer/'scripts/fixtures/arena-rpc-postgres.mjs').write_bytes(trusted(OPS/'arena-rpc-postgres.mjs',ADAPTER_SHA))
        (indexer/'scripts/fixtures/unified-rpc-project.mjs').write_bytes(transformed_project(trusted(ROOT/'apps/yunipals-indexer/scripts/fixtures/unified-rpc-project.mjs',PROJECT_SHA)))
        harness=market/'scripts/native-arena-genuine-rpc.mjs';harness.write_bytes(transformed_harness(trusted(ROOT/'apps/yunipals-market-api/scripts/native-arena-anvil.mjs',HARNESS_SHA)))
        return harness
    def stop_groups(self):
        failures=[]
        for item in reversed(self.children):
            child=item['child'];leader=item['identity']
            def members():
                rows=[]
                for entry in Path('/proc').iterdir():
                    if not entry.name.isdigit():continue
                    try:row=process_stat(int(entry.name))
                    except (FileNotFoundError,ProcessLookupError,PermissionError):continue
                    if row['session']==leader['session'] and row['group']==leader['group']:
                        if row['uid']!=UID or row['gid']!=GID or row['cgroup']!=self.own_cgroup:fail('Foreign process in owned fixture group; no signal.')
                        if row['state']!='Z':rows.append(row)
                return rows
            forced=False
            if members():
                if child.poll() is None and any(process_stat(child.pid)[k]!=leader[k] for k in ['pid','group','session','startTicks','uid','gid','cgroup']):fail('Owned child PID changed; no signal.')
                os.killpg(leader['group'],signal.SIGTERM)
                deadline=time.monotonic()+12
                while members() and time.monotonic()<deadline:child.poll();time.sleep(.1)
                if members():
                    forced=True;os.killpg(leader['group'],signal.SIGKILL)
                    deadline=time.monotonic()+3
                    while members() and time.monotonic()<deadline:child.poll();time.sleep(.1)
                    if members():fail('Owned fixture descendant failed to stop.')
            child.wait(timeout=2)
            item['log'].close()
            self.closed.append({'name':item['name'],'exitStatus':child.poll(),'forced':forced})
            if forced or (item['name']=='postgres' and child.returncode!=0):failures.append(item['name'])
        if failures:fail('Owned fixture cleanup was not clean; retained evidence requires inspection.')
    def run(self):
        self.work.mkdir(mode=0o700);(self.work/'socket').mkdir(mode=0o700);(self.work/'tmp').mkdir(mode=0o700)
        (self.work/'review.json').write_bytes(encoded(self.checked));report=None;error=None;failure_origin=None
        try:
            self.mark('owned_empty_passfile');self.prepare_passfile()
            self.mark('scratch_mirror')
            harness=self.mirror()
            self.mark('initdb')
            self.wait(self.launch('initdb',[str(PG/'initdb'),'--pgdata='+str(self.work/'pgdata'),'--username=arena_fixture_admin','--encoding=UTF8','--locale=C.UTF-8','--auth-local=trust','--auth-host=trust']),60)
            self.mark('postgres_start')
            server=self.launch('postgres',[str(PG/'postgres'),'-D',str(self.work/'pgdata'),'-c','listen_addresses=127.0.0.1','-c','port=55448','-c','unix_socket_directories='+str(self.work/'socket'),'-c','shared_buffers=64MB','-c','max_connections=32','-c','wal_level=minimal','-c','max_wal_senders=0','-c','max_wal_size=128MB'])
            self.mark('postgres_identity')
            deadline=time.monotonic()+20
            while True:
                if server['child'].poll() is not None:fail('Owned PostgreSQL startup failed.')
                try:
                    identity=json.loads(self.sql("SELECT json_build_object('id',system_identifier::text,'data',current_setting('data_directory'),'port',current_setting('port'),'version',current_setting('server_version')) FROM pg_control_system()"));break
                except (subprocess.CalledProcessError,FileNotFoundError):
                    if time.monotonic()>deadline:fail('Owned PostgreSQL startup deadline.')
                    time.sleep(.2)
            if identity['data']!=str(self.work/'pgdata') or identity['port']!='55448' or not re.fullmatch('[1-9][0-9]+',identity['id']) or not identity['version'].startswith('16.15'):fail('Owned cluster identity differs.')
            self.system_id=identity['id']
            for database in ['yunipals_ponder_dependency_test','arena']:
                self.mark('create_source_database' if database=='yunipals_ponder_dependency_test' else 'create_operational_database');self.sql('CREATE DATABASE '+database)
            # Random secret is test-chain only, generated inside this isolated
            # process and never placed in reports or a real-wallet config.
            self.mark('fresh_test_mnemonic');mnemonic=self.mnemonic()
            self.mark('anvil_start')
            anvil=self.launch('anvil',[self.plan['anvil'],'--host','127.0.0.1','--port','55446','--chain-id','8453','--block-base-fee-per-gas','100000','--gas-price','100000','--disable-min-priority-fee','--mnemonic',mnemonic,'--silent'])
            deadline=time.monotonic()+10
            while True:
                if anvil['child'].poll() is not None:fail('Owned Anvil startup failed.')
                try:
                    with socket.create_connection(('127.0.0.1',55446),timeout=.2):break
                except OSError:
                    if time.monotonic()>deadline:fail('Owned Anvil startup deadline.')
                    time.sleep(.1)
            env={**self.env,'TMPDIR':str(self.work/'tmp'),'ARENA_FIXTURE_MNEMONIC':mnemonic,
                 'PONDER_UNIFIED_TEST_DATABASE_URL':'postgres://arena_fixture_admin@127.0.0.1:55448/yunipals_ponder_dependency_test',
                 'ARENA_TEST_DATABASE_URL':'postgres://arena_fixture_admin@127.0.0.1:55448/arena'}
            self.mark('arena_lifecycle');self.wait(self.launch('arena-harness',[NODE,'--import',str(ROOT/'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'),str(harness)],env,cwd=harness.parent.parent),LIMIT-120)
            self.mark('lifecycle_report_acceptance')
            report=json.loads((self.work/'tmp/arena-lifecycle-report.json').read_bytes())
            if report['status']!='passed' or report['providerRequests']!=0 or report['mainnetTransactions']!=0 or report['stubbedRefereeRequests']!=1 or report['stubbedMediaRequests']!=9 or report['realPonderRestartCount']<3 or report['realPonderForcedStops']!=0:fail('Actual genuine lifecycle acceptance incomplete.')
            self.mark('cluster_identity_before_shutdown')
            if self.system_id!=self.sql('SELECT system_identifier::text FROM pg_control_system()'):fail('Owned cluster changed before shutdown.')
        except BaseException as exc:
            error=type(exc).__name__;failure_origin=failure_location(exc,self.work)
        failed_phase=self.phase if error else None
        self.mark('owned_group_cleanup')
        cleanup_error=None
        try:self.stop_groups()
        except BaseException as exc:
            cleanup_error=type(exc).__name__
            if not error:failed_phase='owned_group_cleanup'
            error=error or type(exc).__name__
        if self.diagnostic_write_failed and not error:error='RuntimeError';failed_phase='private_phase_journal'
        result={'format':FORMAT,'reviewHash':self.checked['reviewHash'],'passed':error is None,'errorClass':error,'elapsedSeconds':round(time.monotonic()-self.started,3),
                'failedPhase':failed_phase,'failureOrigin':failure_origin,'errorLabel':(self.error_label or 'owned_stage_failed') if error else None,'cleanupErrorClass':cleanup_error,'lastSqlDiagnostic':self.last_sql_diagnostic,'sqlAttempts':self.sql_count,
                'clusterSystemIdentifier':self.system_id,'children':self.closed,'reportSha256':sha(encoded(report)) if report else None,
                'scratchBytes':allocated(self.work),'providerCalls':0,'productionCalls':0,'sourceOrSelectorChanged':False,
                'scope':'actual Ponder RPC + Arena workers; controlled restart-based reorg recovery; provider responses stubbed'}
        (self.work/'result.json').write_bytes(encoded(result));return result
    def mnemonic(self):
        code="import {generateMnemonic,english} from 'viem/accounts'; console.log(generateMnemonic(english));"
        result=subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT/'apps/yunipals-market-api',env=self.env,capture_output=True,timeout=5,check=True)
        value=result.stdout.decode().strip()
        if not re.fullmatch('[a-z]+(?: [a-z]+){11}',value) or result.stderr:fail('Fresh disposable mnemonic generation failed.')
        return value


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--run')
    args=parser.parse_args()
    def interrupted(*_):raise InterruptedError('Outer owned fixture stop requested.')
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    plan=json.loads(trusted(args.plan));checked=review(plan)
    if not args.run:print(json.dumps(checked));return
    if args.run!=checked['reviewHash']:fail('Fresh exact genuine fixture review required.')
    print(json.dumps(Runner(checked).run()))


if __name__=='__main__':main()
