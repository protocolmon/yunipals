"""Render reviewable v2 units beneath /tmp; never install or start services."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROLES = ("api", "capacity", "client", "control", "lobby", "media", "monitor", "referee", "settlement")


def render(mode, role):
    assert mode in ("video", "anime") and role in ROLES
    value = (ROOT / f"ops/anime-arena/yunipals-anime-arena-{role}.service").read_text()
    value = value.replace("Description=Yunipals Anime Arena", f"Description=Yunipals shared Arena {mode}")
    value = value.replace("/srv/yunipals-anime-arena/current", "/srv/yunipals-arena-modes/current")
    value = value.replace("/etc/yunipals-anime-arena/runtime.env", f"/etc/yunipals-arena-modes/{mode}/runtime.env")
    value = value.replace("/etc/yunipals-anime-arena/roles/", f"/etc/yunipals-arena-modes/{mode}/roles/")
    value = value.replace("/var/lib/yunipals-anime-arena/media", f"/var/lib/yunipals-arena-modes/{mode}/media")
    if mode == "video":
        value = value.replace("dist/arena-anime-media.mjs", "dist/arena-native-media.mjs")
        value = value.replace("/etc/yunipals-anime-arena/openrouter.env", "/etc/yunipals-arena/runware.env")
        if role == "monitor":
            value = value.replace("dist/arena-anime-monitor.mjs", "dist/arena-monitor.mjs")
            # The DB-only health worker needs the actual admission setting to
            # report stale capacity while the pilot is enabled.
            value = value.replace(" ARENA_ENTRIES_ENABLED=false", "")
            value = value.replace("Type=simple", "Type=oneshot")
            value = value.replace("Restart=on-failure\nRestartSec=30\n", "")
            value = value.replace("MemoryMax=512M", "ReadWritePaths=/var/lib/yunipals-arena-modes/video/health\nMemoryMax=512M")
    # Provider credentials cannot override the mode's reviewed public/runtime or
    # database settings. Only referee, media and capacity get provider access.
    provider = [line for line in value.splitlines() if line in (
        "EnvironmentFile=/etc/yunipals-arena/arena.env",
        "EnvironmentFile=/etc/yunipals-arena/runware.env",
        "EnvironmentFile=/etc/yunipals-anime-arena/openrouter.env")]
    lines = [line for line in value.splitlines() if line not in provider]
    insert = next(i for i, line in enumerate(lines) if line.startswith("EnvironmentFile="))
    lines[insert:insert] = provider
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    target = args.output.resolve()
    assert target.is_relative_to("/tmp") and not target.exists(), "Use a new /tmp review directory"
    target.mkdir(parents=True)
    for mode in ("video", "anime"):
        for role in ROLES:
            (target / f"yunipals-arena-v2-{mode}-{role}.service").write_text(render(mode, role))
    (target / "yunipals-arena-v2-video-monitor.timer").write_text(
        "[Unit]\nDescription=Shared video Arena health schedule\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=5min\nUnit=yunipals-arena-v2-video-monitor.service\n[Install]\nWantedBy=timers.target\n")
    print(f"Rendered 18 services and one timer in {target}; none installed or started.")
