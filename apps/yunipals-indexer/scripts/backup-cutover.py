#!/usr/bin/env python3
"""Create and verify an encrypted, off-host Yunipals indexer cutover backup.

Run as root on yunipals-main with the existing Storage Box backup environment
loaded through systemd. Never print the environment or subprocess stderr.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


BACKUP_ROOT = Path("/var/backups")
RELEASE = os.environ.get("YUNIPALS_BACKUP_RELEASE", "f0bd9a0")
MARKET_RELEASE = os.environ.get("YUNIPALS_BACKUP_MARKET_RELEASE")
DATABASE = "yunipals_backfill"
KNOWN_HOSTS = "/etc/yunipals-marketplace/backup-known-hosts"
TARGET_PATTERN = re.compile(r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+")
REMOTE_PATTERN = re.compile(r"[A-Za-z0-9._/-]+")
SERVICE_NAMES = (
    "yunipals-indexer",
    "yunipals-bnb",
    "yunipals-api",
    "yunipals-metadata",
    "yunipals-leaderboard",
    "yunipals-collector-api",
    "yunipals-market-monitor",
)


def run(command: list[str], *, env: dict[str, str] | None = None, timeout: int = 3600) -> None:
    result = subprocess.run(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{command[0]} failed with exit {result.returncode}; output suppressed")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def protected(path: Path) -> None:
    path.chmod(0o600)


def postgres_archive(destination: Path) -> None:
    with destination.open("xb") as output:
        result = subprocess.run(
            [
                "ionice", "-c2", "-n7", "nice", "-n", "10", "runuser", "-u", "postgres", "--",
                "/usr/lib/postgresql/16/bin/pg_dump", "-h", "/var/run/postgresql", "-p", "5432",
                "-U", "postgres", "-d", DATABASE, "-Fc", "-Z", "6",
            ],
            stdout=output,
            stderr=subprocess.PIPE,
            timeout=3600,
        )
    protected(destination)
    if result.returncode or destination.stat().st_size < 1_000_000_000:
        raise RuntimeError("Production database archive failed or is unexpectedly small")
    run(["/usr/lib/postgresql/16/bin/pg_restore", "--list", str(destination)], timeout=300)


def globals_archive(destination: Path) -> None:
    with destination.open("xb") as output:
        result = subprocess.run(
            [
                "runuser", "-u", "postgres", "--", "/usr/lib/postgresql/16/bin/pg_dumpall",
                "-h", "/var/run/postgresql", "-p", "5432", "-U", "postgres", "--globals-only",
            ],
            stdout=output,
            stderr=subprocess.PIPE,
            timeout=120,
        )
    protected(destination)
    if result.returncode or destination.stat().st_size == 0:
        raise RuntimeError("PostgreSQL globals backup failed")


def recovery_archive(destination: Path) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", RELEASE):
        raise RuntimeError("Invalid indexer backup release")
    if MARKET_RELEASE and not re.fullmatch(r"[A-Za-z0-9._-]+", MARKET_RELEASE):
        raise RuntimeError("Invalid marketplace backup release")
    paths = [
        "root/indexer-next",
        f"opt/yunipals/releases/{RELEASE}",
        "opt/node-v24.18.1",
        "opt/yunipals/tools/pnpm-9.12.0-pinned",
        "opt/yunipals/pnpm-store",
        "opt/yunipals-collector/releases/20260923-rarity-range",
        "opt/yunipals-indexer-ops",
        "etc/yunipals-indexer",
        "etc/yunipals-metadata-cutover.env",
        "etc/yunipals-market-monitor",
        "etc/yunipals-marketplace/production/indexer-rpc.env",
        "etc/nginx",
        "etc/letsencrypt",
        "etc/postgresql",
        "var/lib/yunipals-market-monitor",
        "var/backups/yunipals-indexer-premerge-20260928TAduj0X/rehearsal",
    ]
    if Path("/opt/yunipals-ops").exists():
        paths.append("opt/yunipals-ops")
    if MARKET_RELEASE:
        paths.append(f"opt/yunipals-marketplace/releases/{MARKET_RELEASE}")
        paths.append("etc/yunipals-marketplace/production")
    for name in SERVICE_NAMES:
        for suffix in (".service", ".service.d"):
            path = f"etc/systemd/system/{name}{suffix}"
            if (Path("/") / path).exists():
                paths.append(path)
    timer = Path("/etc/systemd/system/yunipals-market-monitor.timer")
    if timer.exists():
        paths.append(str(timer).lstrip("/"))
    if MARKET_RELEASE:
        for suffix in (".service", ".service.d"):
            path = f"etc/systemd/system/yunipals-market-production-api{suffix}"
            if (Path("/") / path).exists():
                paths.append(path)
        for suffix in (".service", ".service.d", ".timer"):
            path = f"etc/systemd/system/mongodb-backupmon{suffix}"
            if (Path("/") / path).exists():
                paths.append(path)
    for path in paths:
        if not (Path("/") / path).exists():
            raise RuntimeError(f"Missing recovery input: {path}")
    run(
        [
            "tar", "--zstd", "-cf", str(destination),
            "--exclude=*/.ponder", "--exclude=*/.git",
            "--exclude=root/indexer-next/.ops-backups", "--exclude=root/indexer-next/backups",
            "--exclude=opt/yunipals-indexer-ops/rarity-local-v1-20260918",
            "-C", "/", *paths,
        ],
        timeout=600,
    )
    protected(destination)


def gpg(source: Path, destination: Path, passphrase_file: Path, *, decrypt: bool = False) -> None:
    command = [
        "gpg", "--batch", "--yes", "--no-options", "--pinentry-mode", "loopback",
        "--passphrase-file", str(passphrase_file), "--output", str(destination),
    ]
    if decrypt:
        command += ["--decrypt", str(source)]
    else:
        command += ["--symmetric", "--cipher-algo", "AES256", "--compress-algo", "none", str(source)]
    run(command, timeout=1800)
    protected(destination)


def remote_command(command: str, *, env: dict[str, str], target: str, port: str, timeout: int = 1800) -> str:
    result = subprocess.run(
        [
            "sshpass", "-e", "ssh", "-p", port, "-o", "BatchMode=no",
            "-o", "PasswordAuthentication=yes", "-o", "KbdInteractiveAuthentication=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
            "-o", "ConnectTimeout=15", target, command,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(f"Storage Box command failed with exit {result.returncode}; output suppressed")
    return result.stdout.strip()


def transfer(source: Path, destination: str, *, env: dict[str, str], target: str, port: str, download: bool) -> None:
    from_path, to_path = (f"{target}:{destination}", str(source)) if download else (str(source), f"{target}:{destination}")
    run(
        [
            "sshpass", "-e", "scp", "-P", port, "-o", "BatchMode=no",
            "-o", "PasswordAuthentication=yes", "-o", "KbdInteractiveAuthentication=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
            "-o", "ConnectTimeout=15", from_path, to_path,
        ],
        env=env,
        timeout=3600,
    )


def main() -> None:
    os.umask(0o077)
    if os.geteuid() != 0:
        raise RuntimeError("Run as root")
    required = (
        "MARKET_BACKUP_SSH_TARGET", "MARKET_BACKUP_SSH_PORT", "MARKET_BACKUP_REMOTE_ROOT",
        "MARKET_BACKUP_SSH_PASSWORD", "MARKET_BACKUP_ENCRYPTION_PASSPHRASE",
    )
    if any(not os.environ.get(name) for name in required):
        raise RuntimeError("Storage Box backup environment is incomplete")
    target = os.environ["MARKET_BACKUP_SSH_TARGET"]
    port = os.environ["MARKET_BACKUP_SSH_PORT"]
    remote_root = os.environ["MARKET_BACKUP_REMOTE_ROOT"].rstrip("/")
    if not TARGET_PATTERN.fullmatch(target) or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise RuntimeError("Invalid Storage Box target")
    if not REMOTE_PATTERN.fullmatch(remote_root) or ".." in Path(remote_root).parts:
        raise RuntimeError("Invalid Storage Box root")
    if len(os.environ["MARKET_BACKUP_ENCRYPTION_PASSPHRASE"]) < 32:
        raise RuntimeError("Invalid backup passphrase")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = BACKUP_ROOT / f"yunipals-indexer-cutover-{stamp}"
    destination.mkdir(mode=0o700)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    postgres_archive(destination / "database.dump")
    globals_archive(destination / "globals.sql")
    recovery_archive(destination / "recovery.tar.zst")
    files = [destination / name for name in ("database.dump", "globals.sql", "recovery.tar.zst")]
    manifest = {
        "format": "yunipals-indexer-cutover-backup-v1",
        "database": DATABASE,
        "release": RELEASE,
        "marketRelease": MARKET_RELEASE,
        "startedAt": started,
        "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "files": {path.name: {"bytes": path.stat().st_size, "sha256": digest(path)} for path in files},
    }
    manifest_path = destination / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    protected(manifest_path)
    files.append(manifest_path)

    environment = os.environ.copy()
    environment["SSHPASS"] = environment["MARKET_BACKUP_SSH_PASSWORD"]
    remote_dir = f"{remote_root}/indexer-next-recovery/cutover-{stamp}"
    remote_command(f"mkdir -p {shlex.quote(remote_dir)}", env=environment, target=target, port=port)
    report = {"format": "yunipals-indexer-offhost-cutover-v1", "remoteDirectory": remote_dir, "files": {}}
    with tempfile.TemporaryDirectory(prefix="yunipals-cutover-verify-") as temporary:
        scratch = Path(temporary)
        passphrase = scratch / "passphrase"
        passphrase.write_text(environment["MARKET_BACKUP_ENCRYPTION_PASSPHRASE"] + "\n")
        protected(passphrase)
        for source in files:
            cipher = destination / f"{source.name}.gpg"
            gpg(source, cipher, passphrase)
            remote_file = f"{remote_dir}/{cipher.name}"
            transfer(cipher, remote_file + ".part", env=environment, target=target, port=port, download=False)
            remote_command(
                f"mv {shlex.quote(remote_file + '.part')} {shlex.quote(remote_file)}",
                env=environment, target=target, port=port,
            )
            remote_hash = remote_command(
                f"sha256sum {shlex.quote(remote_file)}", env=environment, target=target, port=port,
            ).split()[0]
            if remote_hash != digest(cipher):
                raise RuntimeError(f"Remote ciphertext hash differs: {source.name}")
            downloaded = scratch / cipher.name
            transfer(downloaded, remote_file, env=environment, target=target, port=port, download=True)
            if digest(downloaded) != remote_hash:
                raise RuntimeError(f"Downloaded ciphertext hash differs: {source.name}")
            decrypted = scratch / source.name
            gpg(downloaded, decrypted, passphrase, decrypt=True)
            if digest(decrypted) != digest(source):
                raise RuntimeError(f"Downloaded plaintext hash differs: {source.name}")
            report["files"][source.name] = {
                "plaintextSha256": digest(source), "ciphertextSha256": remote_hash,
                "downloadDecryptionVerified": True,
            }
            downloaded.unlink()
            decrypted.unlink()
    report["complete"] = True
    report["verifiedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    report_path = destination / "offhost-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    protected(report_path)
    print(json.dumps({"directory": str(destination), "remoteDirectory": remote_dir, "verified": True}))


if __name__ == "__main__":
    main()
