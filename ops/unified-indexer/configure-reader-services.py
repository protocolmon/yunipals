#!/usr/bin/env python3
"""Render retained reader definitions without requiring a running old reader.

The caller supplies the existing renderer and captured configuration, and owns
maintenance/start/HTTP acceptance. Import and default execution change nothing.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import types

READ = "yunipals_ownership_4e77f52b_v5"
PHYSICAL = "unified_ypal_20261023_v1"
RELEASE = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
MAIN = Path("/opt/yunipals-unified/nonmarket-consumer-releases/f2fa474602b2df9012b9ce05561445a2247b16bb76808d8c3d6ca1d14b378d9f/dist/main-api.mjs")
PEERS = {"main": ("yunipals-api.service", "yunipals_unified_api", 9011),
         "collector": ("yunipals-collector-api.service", "yunipals_unified_collector", 9012),
         "islands": ("yunipals-islands-api.service", "yunipals_unified_islands_api", 9015)}
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _cold_renderer(proof, raw):
    """Omit compiler-process attribution only; this caller starts no compiler."""
    need(sha(raw) == "9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946",
         "exact original reader renderer source required")
    tree = ast.parse(raw)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "render_reader")
    tail = ast.parse("""esbuild = m.PROJECT / 'node_modules/@esbuild/linux-x64/bin/esbuild'
executable = str(esbuild.resolve(strict=True))
command = [executable, '--service=0.25.12', '--ping']
esbuild_version = json.loads(m.protected(m.PROJECT / 'node_modules/esbuild/package.json'))['version']
command[1] = '--service=' + esbuild_version
""").body
    need([ast.dump(node) for node in function.body[-6:-1]] == [ast.dump(node) for node in tail]
         and isinstance(function.body[-1], ast.Return), "exact five unused compiler attribution statements required")
    outer = function.body[-1].value
    expected = next(value for key, value in zip(outer.keys, outer.values)
                    if isinstance(key, ast.Constant) and key.value == "expected")
    removed = {"esbuildExecutable", "esbuildCommandSha256"}
    need(sum(isinstance(key, ast.Constant) and key.value in removed for key in expected.keys) == 2,
         "exact two unused compiler attribution fields required")
    pairs = [(key, value) for key, value in zip(expected.keys, expected.values)
             if not isinstance(key, ast.Constant) or key.value not in removed]
    expected.keys, expected.values = [p[0] for p in pairs], [p[1] for p in pairs]
    function.body[-6:-1] = []
    namespace = dict(proof.__dict__)
    exec(compile(ast.Module(body=[function], type_ignores=[]), __file__, "exec"), namespace)
    return namespace["render_reader"]


def _loaded_reader_state(m, proof, unit):
    need(unit in {row[0] for row in PEERS.values()}, "fixed reader settings required")
    raw = m.run(["/usr/bin/systemctl", "show", "--all", unit,
                 *["--property=" + key for key in proof.STATE_PROPERTIES]])
    result = {}
    for line in raw.decode().splitlines():
        key, separator, value = line.partition("=")
        need(separator and key in proof.STATE_PROPERTIES, "fixed reader manager property required")
        if key == "EnvironmentFiles":
            result.setdefault(key, []).append(value)
        else:
            need(key not in result, "unique reader manager property required")
            result[key] = value
    empty_arrays = {"ExecReload", "ExecStartPost", "ExecStartPre", "ExecStop", "ExecStopPost"}
    missing = set(proof.STATE_PROPERTIES) - set(result)
    need(missing <= empty_arrays, "all reader identity and non-hook settings required")
    for key in sorted(missing):
        object_path = "/org/freedesktop/systemd1/unit/" + "".join(
            char if char.isalnum() else "_" + format(ord(char), "02x") for char in unit)
        observed = json.loads(m.run(["/usr/bin/busctl", "--system", "--json=short", "get-property",
            "org.freedesktop.systemd1", object_path, "org.freedesktop.systemd1.Service", key]))
        need(observed == {"type": "a(sasbttttuii)", "data": []},
             "omitted reader execution hook must be an actual empty D-Bus command array")
        result[key] = ""
    need(set(result) == set(proof.STATE_PROPERTIES) and result["Id"] == unit,
         "complete reader manager state required")
    return result


def operands():
    """Settings-only cold caller: no Context constructor, actor or old receipt."""
    def load(name, pin):
        path = OPS / name
        raw = _read(path)
        need(sha(raw) == pin, "exact retained public configuration primitive required")
        module = types.ModuleType("cold_reader_configuration_" + name.replace("-", "_"))
        module.__file__ = str(path)
        exec(compile(raw, str(path), "exec"), module.__dict__)
        return module
    m = load("retained-workers-stage-v1.py", "4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416")
    proof = load("ypal-native-cutover-proof-v1.py", "9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946")
    # Fresh renderer namespace only. This is a new V5 configuration, never a
    # claim that the historical V4 Context/current/reader validator passed.
    need(proof.READ == "yunipals_ownership_4e77f52b_v4" and proof.PHYSICAL == PHYSICAL and
         proof.RELEASE == RELEASE, "exact historical renderer selector operands required")
    proof.READ = READ
    proof.render_reader = _cold_renderer(proof, _read(Path(proof.__file__)))
    context = proof.Context.__new__(proof.Context)
    context.host = types.SimpleNamespace(m=m)
    context.main = types.SimpleNamespace(TARGET=MAIN.parent.parent)
    captured = {}
    for name, (unit, _role, _port) in PEERS.items():
        first = _loaded_reader_state(m, proof, unit)
        need(first["LoadState"] == "loaded" and not first["Job"], "loaded stable reader configuration required")
        inline = m.service_property(unit, "Environment")
        need(not any(m.service_property(unit, k) for k in ("PassEnvironment", "UnsetEnvironment")),
             "explicit retained reader environment required")
        merged = dict(item.split("=", 1) for item in inline)
        private = {}
        for path, optional in m.ordered_files(first["EnvironmentFiles"]):
            if optional and not os.path.lexists(path):
                private[path] = None
            else:
                raw = m.protected(path)
                private[path] = sha(raw)
                merged.update(m.parse_env(raw))
        captured[name] = {"unit": first, "definitions": {p: sha(m.protected(p)) for p in
            [first["FragmentPath"], *first["DropInPaths"].split()]}, "privateInputHashes": private,
            "inlineEnvironmentSha256": sha(m.encoded(inline)), "effectiveEnvironmentSha256": sha(m.encoded(merged))}
        need(_loaded_reader_state(m, proof, unit) == first, "reader loaded configuration changed during capture")
    return context, proof, captured


def configuration(context, proof, captured_old):
    """No actor snapshot: retained definition/private-file checks remain genuine."""
    need(set(captured_old) == set(PEERS), "exact three captured readers required")
    result = {}
    for name, (unit, role, port) in PEERS.items():
        value = proof.render_reader(context, name, captured_old[name], False)
        need(value["unit"] == unit and value["name"] == name and
             value["preview"] is False and value["port"] == port,
             "exact final reader descriptor required")
        files, expected = value["files"], value["expected"]
        need(len(files) == 3, "one database file, selector file and drop-in required")
        selectors = [row for path, row in files.items() if path.endswith(".selectors.env")]
        need(len(selectors) == 1, "one public selector file required")
        parsed = context.host.m.parse_env(selectors[0]["text"].encode())
        need(parsed.get("DATABASE_SCHEMA") == PHYSICAL and
             parsed.get("READ_DATABASE_SCHEMA") == parsed.get("OWNERSHIP_READ_SCHEMA") == READ and
             parsed.get("OWNERSHIP_READ_MODE") == "unified" and
             parsed.get("OWNERSHIP_RELEASE_ID") == parsed.get("UNIFIED_INDEXER_RELEASE_ID") == RELEASE and
             parsed.get("BASE_METADATA_INGESTION") == "native" and
             parsed.get("METADATA_SOURCE_MODE") == "archive" and
             parsed.get("YUNIPALS_PROJECTION_MODE") == "generation",
             "native V5 reader selectors required")
        if name == "main":
            need(expected["argv"] == ["/opt/node-v24.18.1/bin/node", str(MAIN)],
                 "installed latest-complete main API required")
        for path, pin in captured_old[name]["privateInputHashes"].items():
            need(expected["privateInputHashes"].get(path) == pin,
                 "all retained private inputs must remain bound")
        retained = context.host.m.ordered_files(captured_old[name]["unit"]["EnvironmentFiles"])
        need(expected["selectors"][:len(retained)] ==
             [{"path": path, "optional": optional} for path, optional in retained],
             "ordered retained private environment files required")
        drop = [row["text"] for path, row in files.items() if path.endswith(".conf")]
        need(len(drop) == 1 and ("User=" + role + "\n") in drop[0] and
             ("Group=" + role + "\n") in drop[0], "retained restricted reader role required")
        result[name] = value
    return result


def _directory(path):
    for parent in [Path(path), *Path(path).parents]:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "protected reader configuration directory required")


def _read(path):
    path = Path(path)
    _directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and
             before.st_nlink == 1 and not before.st_mode & 0o022 and
             before.st_size <= 1_000_000, "protected reader configuration file required")
        raw = os.read(fd, 1_000_001)
        key = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid,
                           row.st_gid, row.st_nlink, row.st_size,
                           row.st_mtime_ns, row.st_ctime_ns)
        need(len(raw) == before.st_size and key(before) == key(os.fstat(fd)) ==
             key(path.lstat()), "reader configuration changed during read")
        return raw
    finally:
        os.close(fd)


def _sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def install(descriptors, record, backup_dir):
    """Install nine exact rendered files; never start, grant LOGIN or publish."""
    need(set(descriptors) == set(PEERS), "exact three reader descriptors required")
    files = {}
    for name, descriptor in descriptors.items():
        unit = PEERS[name][0]
        need(descriptor["unit"] == unit and descriptor["preview"] is False,
             "final reader descriptor required")
        for filename, row in descriptor["files"].items():
            path = Path(filename)
            allowed = (path.parent == Path("/etc/yunipals-unified/consumers") and
                       path.name.endswith((".database.env", ".selectors.env"))) or (
                       path.parent == Path("/etc/systemd/system") / (unit + ".d") and
                       path.suffix == ".conf")
            need(allowed and filename not in files and row["mode"] ==
                 (0o600 if filename.endswith(".database.env") else 0o644),
                 "only owned reader env and service overlay paths allowed")
            files[filename] = row
    need(len(files) == 9, "exact nine reader files required")
    backup_dir = Path(backup_dir)
    need(backup_dir.is_absolute(), "absolute backup directory required")
    backup_dir.mkdir(mode=0o700)
    _directory(backup_dir)
    for filename, row in files.items():
        path = Path(filename)
        path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        _directory(path.parent)
        before = _read(path) if os.path.lexists(path) else None
        raw, label = row["text"].encode(), sha(filename.encode())[:16]
        if before is not None:
            with open(backup_dir / label, "xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(before)
                stream.flush()
                os.fsync(stream.fileno())
            _sync(backup_dir)
        record("reader-install-" + label + "-intent", {"path": filename, "beforeSha256": None if before is None else sha(before),
                                         "afterSha256": sha(raw)})
        temporary = path.with_name(path.name + ".cold-new")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, row["mode"])
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        need((_read(path) if os.path.lexists(path) else None) == before,
             "reader configuration changed before installation")
        os.replace(temporary, path)
        _sync(path.parent)
        need(_read(path) == raw, "reader installed bytes mismatch")
        record("reader-install-" + label + "-complete", {"path": filename, "sha256": sha(raw)})
    return {"readerFilesInstalled": 9, "servicesStarted": False, "applicationHealthAccepted": False}


if __name__ == "__main__":
    print(json.dumps({"staticOnly": True, "readers": list(PEERS)}))
