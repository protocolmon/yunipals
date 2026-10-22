#!/usr/bin/env python3
"""Review, install or reverse only the app.yunipals.com canonical redirect."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time


CONFIG = Path("/etc/nginx/sites-available/polychainmonsters")
MAIN = Path("/etc/nginx/nginx.conf")
ENABLED = Path("/etc/nginx/sites-enabled")
BACKUPS = Path("/var/backups/yunipals-canonical-www-redirect")
LOCK = Path("/run/lock/yunipals-static-publication.lock")
EXPECTED_BEFORE = "59665a6f2fef773f08e162f257c052f02591855a1ec3c1703a619092d1cc9460"
DIRECTIVE = "return 308 https://www.yunipals.com$request_uri;"
INSERTION = ("\n    " + DIRECTIVE).encode()
FORMAT = "yunipals-canonical-www-redirect-v1"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checksum(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), "invalid_sha256")
    return value


def protected_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "not_single_regular_file")
        require(info.st_uid == 0 and not info.st_mode & 0o022, "unprotected_file")
        with os.fdopen(fd, "rb", closefd=False) as source:
            return source.read(), info
    finally:
        os.close(fd)


def tokens(data):
    """Nginx lexical boundaries, ignoring comments and quoted/escaped punctuation."""
    result, offset = [], 0
    while offset < len(data):
        byte = data[offset]
        if chr(byte).isspace():
            offset += 1
            continue
        if byte == ord("#"):
            newline = data.find(b"\n", offset)
            offset = len(data) if newline < 0 else newline + 1
            continue
        start = offset
        if byte in b"{};":
            offset += 1
        else:
            quote = None
            while offset < len(data):
                byte = data[offset]
                if byte == ord("\\"):
                    require(offset + 1 < len(data), "unfinished_escape")
                    offset += 2
                    continue
                if quote:
                    if byte == quote:
                        quote = None
                    offset += 1
                    continue
                if byte in b"\"'":
                    quote = byte
                    offset += 1
                    continue
                if chr(byte).isspace() or byte in b"{};#":
                    break
                offset += 1
            require(quote is None and offset > start, "unfinished_nginx_token")
        result.append((data[start:offset].decode("utf-8"), start, offset))
    return result


def render(before):
    require(b"\r" not in before, "expected_lf_config")
    root = {"head": [], "statements": [], "children": []}
    stack, statement = [root], []
    for token, start, end in tokens(before):
        if token == "{":
            node = {"head": statement, "statements": [], "children": [], "openingEnd": end}
            stack[-1]["children"].append(node)
            stack.append(node)
            statement = []
        elif token == ";":
            require(statement, "empty_nginx_statement")
            stack[-1]["statements"].append(statement)
            statement = []
        elif token == "}":
            require(len(stack) > 1 and not statement, "unbalanced_nginx_block")
            stack.pop()
        else:
            statement.append(token)
    require(len(stack) == 1 and not statement, "unfinished_nginx_config")
    targets = []

    def visit(node):
        if node["head"] == ["server"]:
            names = [row[1:] for row in node["statements"] if row[0] == "server_name"]
            if any("app.yunipals.com" in row for row in names):
                require(names == [["app.yunipals.com"]], "mixed_or_duplicate_app_server_name")
                require(["return", "308", "https://www.yunipals.com$request_uri"]
                        not in node["statements"], "redirect_already_installed")
                listens = [row[1:] for row in node["statements"] if row[0] == "listen"]
                ports = {row[0].rsplit(":", 1)[-1] for row in listens if row}
                require(ports in ({"80"}, {"443"}), "unexpected_app_listeners")
                targets.append({"afterOpeningBraceByte": node["openingEnd"],
                                "listener": "https" if ports == {"443"} else "http",
                                "insert": INSERTION.decode()})
        for child in node["children"]:
            visit(child)

    visit(root)
    require(len(targets) == 2 and {row["listener"] for row in targets} == {"http", "https"},
            "expected_exactly_two_app_http_https_servers")
    after = before
    for target in sorted(targets, key=lambda row: row["afterOpeningBraceByte"], reverse=True):
        position = target["afterOpeningBraceByte"]
        after = after[:position] + INSERTION + after[position:]
    return after, sorted(targets, key=lambda row: row["afterOpeningBraceByte"])


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, timeout=45)
    require(result.returncode == 0, "command_failed:" + arguments[0] + ":diagnostics_sha256="
            + sha(result.stdout + result.stderr))


def validate_shadow(candidate, config=CONFIG, main=MAIN, enabled=ENABLED):
    # Same shadow-main technique as publish-collection-static-v1.py: real certs,
    # API routes and other enabled sites are tested without editing the live file.
    main_bytes, _ = protected_bytes(main)
    include = b"include /etc/nginx/sites-enabled/*;"
    require(main_bytes.count(include) == 1, "unexpected_sites_enabled_include")
    sites = sorted(enabled.iterdir())
    require(sum(path.resolve() == config.resolve() for path in sites) == 1, "site_not_uniquely_enabled")
    with tempfile.TemporaryDirectory(prefix="yunipals-canonical-check-") as temporary:
        directory = Path(temporary)
        shadow = directory / "site.conf"
        shadow.write_bytes(candidate)
        includes = b"\n".join(("include " + str(shadow if path.resolve() == config.resolve() else path)
                                + ";").encode() for path in sites)
        alternate = directory / "nginx.conf"
        alternate.write_bytes(main_bytes.replace(include, includes))
        run(["nginx", "-t", "-c", str(alternate)])


def review(expected=EXPECTED_BEFORE, config=CONFIG):
    before, metadata = protected_bytes(config)
    require(sha(before) == checksum(expected), "before_sha256_changed")
    after, insertions = render(before)
    validate_shadow(after, config=config)
    return before, after, metadata, {"format": FORMAT, "beforeSha256": sha(before),
                                   "candidateSha256": sha(after), "insertions": insertions,
                                   "otherBytesPreserved": True, "shadowNginxTestPassed": True}


def new_file(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def json_file(path, value):
    new_file(path, (json.dumps(value, sort_keys=True, indent=2) + "\n").encode())


def private_directory(path, create=False):
    if create:
        path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            "unprotected_operation_directory")


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace_config(config, expected, data, metadata):
    descriptor, name = tempfile.mkstemp(prefix=".canonical-www-", dir=config.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            os.fchmod(output.fileno(), stat.S_IMODE(metadata.st_mode))
            os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
            output.flush()
            os.fsync(output.fileno())
        current, info = protected_bytes(config)
        require(sha(current) == expected and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) ==
                (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)), "nginx_cas_refused")
        os.replace(temporary, config)
        sync_directory(config.parent)
    finally:
        temporary.unlink(missing_ok=True)


def transition(config, before, after, metadata):
    reload_attempted = False
    try:
        replace_config(config, sha(before), after, metadata)
        run(["nginx", "-t"])
        require(sha(protected_bytes(config)[0]) == sha(after), "changed_before_reload")
        reload_attempted = True
        run(["systemctl", "reload", "nginx"])
        require(sha(protected_bytes(config)[0]) == sha(after), "changed_during_reload")
    except BaseException as error:
        rollback = "not_needed"
        try:
            current = sha(protected_bytes(config)[0])
            if current == sha(after):
                replace_config(config, current, before, metadata)
                run(["nginx", "-t"])
                if reload_attempted:
                    run(["systemctl", "reload", "nginx"])
                rollback = "restored_owned_input"
            elif current != sha(before):
                rollback = "refused_foreign_configuration"
        except BaseException as restore_error:
            rollback = "inverse_failed:" + str(restore_error)
        raise RuntimeError(json.dumps({"error": str(error), "rollback": rollback})) from error


def operator_sha():
    return sha(Path(__file__).read_bytes())


def apply(expected, candidate_sha, config=CONFIG, backups=BACKUPS):
    before, after, metadata, proof = review(expected, config)
    require(sha(after) == checksum(candidate_sha), "candidate_sha256_changed")
    private_directory(backups, create=True)
    operation = backups / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + str(time.time_ns()))
    operation.mkdir(mode=0o700)
    new_file(operation / "before.conf", before)
    new_file(operation / "candidate.conf", after)
    json_file(operation / "plan.json", {**proof, "operatorSha256": operator_sha(), "config": str(config),
                                       "metadata": {"uid": metadata.st_uid, "gid": metadata.st_gid,
                                                    "mode": stat.S_IMODE(metadata.st_mode)}})
    sync_directory(operation)
    sync_directory(backups)
    try:
        transition(config, before, after, metadata)
    except BaseException as error:
        json_file(operation / "result.json", {"status": "FAILED", "error": str(error)})
        raise
    result = {"status": "APPLIED", "operation": str(operation), **proof}
    json_file(operation / "result.json", result)
    return result


def inverse(operation, expected, candidate_sha, config=CONFIG, backups=BACKUPS):
    require(operation.parent == backups and re.fullmatch(r"\d{8}T\d{6}Z-\d+", operation.name),
            "not_an_owned_operation_path")
    private_directory(backups)
    private_directory(operation)
    plan = json.loads(protected_bytes(operation / "plan.json")[0])
    before = protected_bytes(operation / "before.conf")[0]
    after = protected_bytes(operation / "candidate.conf")[0]
    require(plan["format"] == FORMAT and plan["operatorSha256"] == operator_sha()
            and plan["config"] == str(config), "operation_binding_changed")
    require(plan["beforeSha256"] == checksum(expected) == sha(before)
            and plan["candidateSha256"] == checksum(candidate_sha) == sha(after), "operation_hash_changed")
    require(render(before)[0] == after, "operation_delta_changed")
    current, metadata = protected_bytes(config)
    require(sha(current) == candidate_sha, "inverse_refuses_non_candidate_config")
    require(plan["metadata"] == {"uid": metadata.st_uid, "gid": metadata.st_gid,
                                 "mode": stat.S_IMODE(metadata.st_mode)}, "inverse_metadata_changed")
    require(not (operation / "inverse-result.json").exists(), "inverse_already_recorded")
    validate_shadow(before, config=config)
    transition(config, after, before, metadata)
    result = {"status": "RESTORED", "operation": str(operation), "restoredSha256": expected,
              "removedCandidateSha256": candidate_sha}
    json_file(operation / "inverse-result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("review", "apply", "inverse"), default="review")
    parser.add_argument("--expected-before-sha")
    parser.add_argument("--candidate-sha")
    parser.add_argument("--operation", type=Path)
    options = parser.parse_args()
    if options.command == "review":
        result = review(options.expected_before_sha or EXPECTED_BEFORE)[3]
    else:
        require(os.geteuid() == 0, "root_required")
        require(options.expected_before_sha and options.candidate_sha, "explicit_before_and_candidate_required")
        fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "r+") as lock:
            info = os.fstat(lock.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and not info.st_mode & 0o022, "unprotected_lock")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run(["systemctl", "is-active", "nginx"])
            if options.command == "apply":
                require(options.operation is None, "unexpected_operation")
                result = apply(options.expected_before_sha, options.candidate_sha)
            else:
                require(options.operation is not None, "operation_required")
                result = inverse(options.operation, options.expected_before_sha, options.candidate_sha)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
