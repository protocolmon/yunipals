#!/usr/bin/env python3
"""Separate reviewed password/files, LOGIN, TCP-auth phases for the new target.

No operational role, original worker env, scanner, service or selector changes.
No password rotation, overwrite, retry of unknown SQL, or owner LOGIN command.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import subprocess
import types
from urllib.parse import urlparse

HERE = Path(__file__).parent
FORMAT = "yunipals-arena-public-rollback-credentials-v1"
AUTH_FORMAT = "yunipals-arena-public-rollback-auth-v1"
BASE = Path("/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023")
TARGET_BASE = Path("/var/backups/yunipals-arena-public-rollback-target-v1-20261023")
FILES = {"writer": "/etc/yunipals-arena/public-rollback-writer.env", "reader": "/etc/yunipals-arena/public-rollback-reader.env"}
ENV_KEY = "ARENA_PUBLIC_ROLLBACK_DATABASE_URL"
TCP_PORT = 5432
ENV = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


class Refusal(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Refusal(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def directory(path):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "absolute_owned_directory_required")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
            s = os.fstat(fd)
            need(s.st_uid == 0 and not s.st_mode & 0o022, "protected_owner_directory_required")
        return fd
    except BaseException:
        os.close(fd)
        raise


def save(path, raw):
    path = Path(path)
    parent = directory(path.parent)
    try:
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(parent)
    finally:
        os.close(parent)


def scram(password, salt):
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.new(key, b"Client Key", "sha256").digest()).digest()
    server = hmac.new(key, b"Server Key", "sha256").digest()
    b64 = lambda value: base64.b64encode(value).decode()
    return "SCRAM-SHA-256$4096:" + b64(salt) + "$" + b64(stored) + ":" + b64(server)


def content(role, password, database):
    need(role in {"arena_public_rollback_writer", "arena_public_rollback_reader"} and re.fullmatch("[A-Za-z0-9_-]{48}", password), "fixed_role_and_fresh_password_required")
    url = "postgresql://" + role + ":" + password + "@127.0.0.1:5432/" + database
    if role.endswith("_reader"):
        url += "?options=-c%20default_transaction_read_only%3Don"
    return (ENV_KEY + "=" + url + "\n").encode()


def private(h, path):
    path = Path(path)
    raw = h.protected(path, 10000)
    s = path.lstat()
    need(stat.S_IMODE(s.st_mode) == 0o600, "root_only_private_connection_file_required")
    return raw, h.metadata(s)


def parse(h, role, raw):
    lines = raw.decode().splitlines()
    need(len(lines) == 1 and lines[0].startswith(ENV_KEY + "="), "single_owner_specific_connection_key_required")
    url = lines[0].partition("=")[2]
    u = urlparse(url)
    need(u.scheme == "postgresql" and u.hostname == "127.0.0.1" and u.port == 5432 and u.path == "/" + h.DATABASE and u.username == role and not u.fragment, "fixed_isolated_target_url_required")
    need(content(role, u.password or "", h.DATABASE) == raw, "exact_generated_owner_file_required")
    return u.password


def auth_probe(h, role, password, text, *, failure=None):
    # libpq reads only this inherited anonymous0600 FD. Neither password nor
    # URL is placed in argv or the child environment.
    fd = os.memfd_create("arena-public-rollback-pgpass", os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        os.fchmod(fd, 0o600)
        raw = ("127.0.0.1:" + str(TCP_PORT) + ":" + h.DATABASE + ":" + role + ":" + password + "\n").encode()
        need(os.write(fd, raw) == len(raw), "bounded_anonymous_password_write_required")
        os.lseek(fd, 0, 0)
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_SEAL | fcntl.F_SEAL_WRITE | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW)
        args = ["/usr/bin/psql", "-h", "127.0.0.1", "-p", str(TCP_PORT), "-d", h.DATABASE, "-U", role, "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]
        result = subprocess.run(args, input=text.encode(), env={**ENV, "PGPASSFILE": "/proc/self/fd/" + str(fd), "PGCONNECT_TIMEOUT": "3", "PGOPTIONS": "-c statement_timeout=10000 -c lock_timeout=2000"}, pass_fds=(fd,), capture_output=True, timeout=15)
        if failure:
            proof = b"password authentication failed" in result.stderr.lower() or b"28P01" in result.stderr if failure == "authentication" else failure.encode() in result.stderr
            need(result.returncode != 0 and not result.stdout.strip() and proof and len(result.stderr) < 10000, "actual_expected_auth_or_privilege_sqlstate_required")
            return None
        need(result.returncode == 0 and not result.stderr and len(result.stdout) < 100000, "bounded_dedicated_tcp_probe_required")
        return result.stdout
    finally:
        os.close(fd)


class Operator:
    def __init__(self, h, receipt, receipt_sha):
        self.h, self.receipt, self.receipt_sha = h, receipt, receipt_sha
        self.roles = [receipt["writerRole"], receipt["readerRole"]]

    def stored(self, name):
        return json.loads(self.h.protected(BASE / name))

    def files(self, setup):
        need(set(setup["credentialFiles"]) == set(FILES.values()), "exact_two_owned_private_paths_required")
        passwords = {}
        for kind, role in [("writer", self.h.WRITER), ("reader", self.h.READER)]:
            raw, identity = private(self.h, FILES[kind])
            need(sha(raw) == setup["credentialFiles"][FILES[kind]] and identity == setup["credentialIdentities"][FILES[kind]], "owned_credential_bytes_or_inode_changed")
            passwords[role] = parse(self.h, role, raw)
        return passwords

    def review(self, phase):
        need(phase in {"setup", "enable", "auth"}, "fixed_separate_credential_phase_required")
        setup = None
        if phase == "setup":
            need(not os.path.lexists(BASE) and all(not os.path.lexists(path) for path in FILES.values()), "fresh_two_file_setup_required")
            self.h.validate_target(self.receipt)
        else:
            setup = self.stored("setup-result.json")
            need(setup["operatorSha256"] == sha(Path(__file__).read_bytes()) and setup["targetResultSha256"] == self.receipt_sha and setup["writerRole"] == self.receipt["writerRole"] and setup["readerRole"] == self.receipt["readerRole"], "actual_same_owner_password_setup_required")
            self.files(setup)
            if phase == "enable":
                need(not (BASE / "login-intent.json").exists(), "prior_or_unknown_login_attempt_refused")
            else:
                login = self.stored("login-result.json")
                need(login["setupResultSha256"] == sha(encoded(setup)) and login["loginEnabled"] is True, "acknowledged_owned_login_required")
            self.h.validate_target(self.receipt, auth_phase="passwords" if phase == "enable" else "login", password_sha256=setup["passwordVerifierSha256"])
        rows = self.h.current_roles()
        need(all(r["sessions"] == 0 for r in rows), "dormant_target_roles_required_before_auth_phase")
        return {"format": FORMAT, "phase": phase, "operatorSha256": sha(Path(__file__).read_bytes()), "targetOperatorSha256": self.receipt["operatorSha256"], "targetResultSha256": self.receipt_sha, "databaseOid": self.receipt["database"]["oid"], "writerRole": self.receipt["writerRole"], "readerRole": self.receipt["readerRole"], "setupResultSha256": sha(encoded(setup)) if setup else None, "privateFiles": FILES, "operationalEnvironmentFilesTouched": 0}

    def checked(self, phase, expected):
        review = self.review(phase)
        need(re.fullmatch("[0-9a-f]{64}", expected) and sha(encoded(review)) == expected, "fresh_exact_separate_auth_review_required")
        return review

    def sql(self, action, hashes, verifiers=None):
        need(action in {"password", "login"}, "fixed_two_role_auth_action_required")
        text = "BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';DO $owned$ BEGIN "
        for role in self.roles:
            password = "rolpassword IS NULL" if action == "password" else "encode(sha256(convert_to(rolpassword,'UTF8')),'hex')='" + hashes[role["name"]] + "'"
            text += "IF NOT EXISTS(SELECT 1 FROM pg_authid WHERE oid=" + str(role["oid"]) + " AND rolname='" + role["name"] + "' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND " + password + ") OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=" + str(role["oid"]) + ") THEN RAISE EXCEPTION 'owned_target_auth_state_changed';END IF;"
        text += "END $owned$;\n"
        for role in self.roles:
            if action == "password":
                verifier = verifiers[role["name"]]
                need(re.fullmatch(r"SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+", verifier), "scram_verifier_only_required")
                suffix = "PASSWORD '" + verifier + "'"
            else:
                suffix = "LOGIN"
            text += "ALTER ROLE " + role["name"] + " " + suffix + ";\n"
        return text + "COMMIT;\n"

    def mutate(self, name, action, hashes, verifiers=None):
        ids = {r["name"]: r["oid"] for r in [self.receipt["ownerRole"], *self.roles]}
        _, part = self.h.boundary(name, self.h.DATABASE, self.sql(action, hashes, verifiers), self.h.catalog_query(), lambda doc: self.h.validate_catalog(doc, ids, phase="passwords" if action == "password" else "login", passwords=hashes), directory=BASE)
        proof = self.h.validate_target(self.receipt, auth_phase="passwords" if action == "password" else "login", password_sha256=hashes)
        need(proof["validated"] is True, "actual_target_auth_postcatalog_required")
        return part

    def setup(self, expected):
        review = self.checked("setup", expected)
        BASE.mkdir(mode=0o700)
        material = {role["name"]: secrets.token_urlsafe(36) for role in self.roles}
        need(len(set(material.values())) == 2, "distinct_new_target_passwords_required")
        verifiers = {name: scram(password, secrets.token_bytes(16)) for name, password in material.items()}
        hashes = {name: sha(value.encode()) for name, value in verifiers.items()}
        bodies = {FILES[kind]: content(role, material[role], self.h.DATABASE) for kind, role in [("writer", self.h.WRITER), ("reader", self.h.READER)]}
        save(BASE / "setup-intent.json", encoded({"review": review, "reviewHash": expected, "credentialFiles": {p: sha(raw) for p, raw in bodies.items()}, "passwordVerifierSha256": hashes, "automaticRetryAllowed": False}))
        for path, raw in bodies.items():
            save(path, raw)
        identities = {path: self.h.metadata(Path(path).lstat()) for path in bodies}
        save(BASE / "files-created.json", encoded({"credentialFiles": {p: sha(raw) for p, raw in bodies.items()}, "credentialIdentities": identities}))
        part = self.mutate("passwords", "password", hashes, verifiers)
        value = {"format": FORMAT, "operatorSha256": sha(Path(__file__).read_bytes()), "targetResultSha256": self.receipt_sha, "writerRole": self.receipt["writerRole"], "readerRole": self.receipt["readerRole"], "credentialFiles": {p: sha(raw) for p, raw in bodies.items()}, "credentialIdentities": identities, "passwordVerifierSha256": hashes, "commit": part, "loginEnabled": False, "privateFileWrites": 2, "operationalEnvironmentFilesTouched": 0, "serviceChanges": 0}
        self.files(value)
        save(BASE / "setup-result.json", encoded(value))
        return value

    def enable(self, expected):
        review = self.checked("enable", expected)
        setup = self.stored("setup-result.json")
        save(BASE / "login-intent.json", encoded({"review": review, "reviewHash": expected, "automaticRetryAllowed": False}))
        part = self.mutate("role-login", "login", setup["passwordVerifierSha256"])
        self.files(setup)
        value = {"format": FORMAT, "setupResultSha256": sha(encoded(setup)), "loginEnabled": True, "commit": part, "serviceChanges": 0}
        save(BASE / "login-result.json", encoded(value))
        return value

    def authenticate(self, expected):
        self.checked("auth", expected)
        need(not (BASE / "auth-result.json").exists(), "owned_authentication_already_acknowledged")
        setup = self.stored("setup-result.json")
        passwords = self.files(setup)
        proofs = []
        for role in self.roles:
            password = passwords[role["name"]]
            auth_probe(self.h, role["name"], secrets.token_urlsafe(36), "SELECT 1;", failure="authentication")
            auth_probe(self.h, role["name"], password, "BEGIN;SET LOCAL ROLE " + self.h.OWNER + ";ROLLBACK;", failure="42501")
            denied = "UPDATE yunipals_arena.chain_event SET event_name='forbidden' WHERE false" if role["name"] == self.h.WRITER else "DELETE FROM yunipals_arena.credit WHERE false"
            auth_probe(self.h, role["name"], password, "BEGIN READ WRITE;" + denied + ";ROLLBACK;", failure="42501")
            text = "BEGIN READ ONLY;" + "".join("SELECT 1 FROM yunipals_arena." + table + " LIMIT 0;" for table in self.h.TABLES) + "SELECT jsonb_build_object('currentUser',current_user,'sessionUser',session_user,'roleOid',(SELECT oid::int FROM pg_roles WHERE rolname=current_user),'databaseOid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),'readOnly',current_setting('transaction_read_only')='on');ROLLBACK;"
            proof = json.loads(auth_probe(self.h, role["name"], password, text))
            need(proof == {"currentUser": role["name"], "sessionUser": role["name"], "roleOid": role["oid"], "databaseOid": self.receipt["database"]["oid"], "readOnly": True}, "actual_dedicated_target_tcp_identity_required")
            proofs.append({**proof, "badPasswordRejected": True, "ownerRoleRejected": True, "forbiddenWriteRejected": True, "readTables": 4})
        self.h.validate_target(self.receipt, auth_phase="login", password_sha256=setup["passwordVerifierSha256"])
        self.files(setup)
        value = {"format": AUTH_FORMAT, "operatorSha256": sha(Path(__file__).read_bytes()), "targetOperatorSha256": self.receipt["operatorSha256"], "targetResultSha256": self.receipt_sha, "setupResultSha256": sha(encoded(setup)), "database": self.receipt["database"], "schema": self.receipt["schema"], "tables": self.receipt["tables"], "writerRole": self.receipt["writerRole"], "readerRole": self.receipt["readerRole"], "credentialFiles": setup["credentialFiles"], "credentialIdentities": setup["credentialIdentities"], "passwordVerifierSha256": setup["passwordVerifierSha256"], "authentication": proofs, "credentialsConfigured": True, "loginEnabled": True, "tcpAuthenticationProven": True, "grantsVerified": True, "operationalEnvironmentFilesTouched": 0, "serviceChanges": 0, "sourceSelectionsChanged": 0}
        save(BASE / "auth-result.json", encoded(value))
        return value

    def reconcile(self):
        intent = self.stored("setup-intent.json")
        need(intent["review"]["operatorSha256"] == sha(Path(__file__).read_bytes()) and intent["review"]["targetResultSha256"] == self.receipt_sha, "same_owned_credential_attempt_required")
        created = self.stored("files-created.json")
        need(created["credentialFiles"] == intent["credentialFiles"], "same_two_prepared_credential_files_required")
        self.files(created)
        current = self.h.current_roles()
        changed = [r for r in current if r["name"] in {self.h.WRITER, self.h.READER}]
        if all(r["passwordSha256"] is None and not r["login"] for r in changed):
            phase, hashes = "admitted", None
        elif all(not r["login"] for r in changed):
            phase, hashes = "passwords", intent["passwordVerifierSha256"]
        elif all(r["login"] for r in changed):
            phase, hashes = "login", intent["passwordVerifierSha256"]
        else:
            raise Refusal("unknown_or_mixed_target_auth_state_requires_manual_review")
        self.h.validate_target(self.receipt, auth_phase=phase, password_sha256=hashes)
        statuses = {}
        for name in ["passwords", "role-login"]:
            path = BASE / (name + "-commit-intent.json")
            if path.exists():
                commit = json.loads(self.h.protected(path))
                need(re.fullmatch("[1-9][0-9]*", commit["xid"]), "actual_owned_auth_transaction_id_required")
                statuses[name] = self.h.run(self.h.MAINTENANCE, "BEGIN READ ONLY;SELECT pg_xact_status('" + commit["xid"] + "'::xid8);ROLLBACK;").strip().decode()
        return {"format": FORMAT, "reconciliation": True, "phase": phase, "transactionStatus": statuses, "sameOwnedPrivateFiles": True, "actions": 0, "newAcknowledgementsCreated": 0, "automaticRetryAllowed": False}


def load_target(helper_pin, receipt_pin):
    path = HERE / "admit-target.py"
    # The target helper is public, immutable and same-directory; use a small
    # no-follow bootstrap before its stricter protected-reader interface.
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and s.st_nlink == 1 and not s.st_mode & 0o022, "protected_actual_target_helper_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 100000)
    finally:
        os.close(fd)
    need(re.fullmatch("[0-9a-f]{64}", helper_pin) and sha(raw) == helper_pin, "exact_target_helper_hash_required")
    h = types.ModuleType("public_rollback_target")
    h.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), h.__dict__)
    need(h.protected(path) == raw and h.BASE == TARGET_BASE, "same_protected_target_owner_required")
    receipt_raw = h.protected(TARGET_BASE / "result.json")
    need(re.fullmatch("[0-9a-f]{64}", receipt_pin) and sha(receipt_raw) == receipt_pin, "actual_target_receipt_pin_required")
    receipt = json.loads(receipt_raw)
    need(receipt["operatorSha256"] == helper_pin and receipt["commitOutcome"] == "commit_confirmed", "actual_same_owner_admitted_target_required")
    return h, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admission-helper-sha256", required=True)
    parser.add_argument("--target-result-sha256", required=True)
    parser.add_argument("--phase", choices=["setup", "enable", "auth"], default="setup")
    parser.add_argument("--apply")
    parser.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    need(not (args.reconcile and args.apply), "reconciliation_has_no_apply_mode")
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(180)
    h, receipt = load_target(args.admission_helper_sha256, args.target_result_sha256)
    lock = os.open("/run/lock/yunipals-arena-public-rollback-target-v1.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(lock)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600, "same_owned_target_lease_required")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operator = Operator(h, receipt, args.target_result_sha256)
        if args.reconcile:
            value = operator.reconcile()
        elif args.apply:
            value = getattr(operator, {"setup": "setup", "enable": "enable", "auth": "authenticate"}[args.phase])(args.apply)
        else:
            review = operator.review(args.phase)
            value = {**review, "reviewHash": sha(encoded(review)), "applied": False, "persistentChanges": 0}
        print(json.dumps(value, sort_keys=True))
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "status": "refused", "fixedCode": str(error) if isinstance(error, Refusal) else "bounded_target_auth_failed", "errorClass": type(error).__name__, "rawMessagesExported": False, "automaticRetryAllowed": False}, sort_keys=True))
        raise SystemExit(1)
