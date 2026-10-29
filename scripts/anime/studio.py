#!/usr/bin/env python3
"""Operator-driven, subscription-only fighter studio. Keys never enter this program."""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RECIPE = ROOT / "docs/arena/anime-recipe-v1"
COLLECTION = "0x98433df878e8c898cb907345c3a7756e5f72240f"
ASSETS = "https://assets-anime.yunipals.com"


def normalize(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: normalize(x) for k, x in v.items()}
    if isinstance(v, list):
        return [normalize(x) for x in v]
    return v


def canonical(value):
    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(normalize(value), indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def token_id(value):
    if not re.fullmatch(r"0|[1-9][0-9]{0,77}", value) or int(value) >= 2 ** 256:
        raise ValueError("Invalid Base token ID")
    return value


@contextlib.contextmanager
def locked(lab, tid=None):
    lab.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (lab / ".studio.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_SH if tid is not None else fcntl.LOCK_EX)
        if tid is None:
            yield
        else:
            with (lab / (".token-" + token_id(tid) + ".lock")).open("a") as token:
                fcntl.flock(token, fcntl.LOCK_EX)
                yield


@contextlib.contextmanager
def generation_slot(lab):
    # Separate operator processes can work on five tokens, never the same token concurrently.
    chosen = None
    try:
        for index in range(5):
            handle = (lab / f".generation-slot-{index}.lock").open("a")
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                chosen = handle
                break
            except BlockingIOError:
                handle.close()
        if chosen is None:
            raise ValueError("Five generation jobs are already running; retry when one finishes")
        yield
    finally:
        if chosen is not None:
            chosen.close()


def public_directory(path, root):
    if root.is_symlink():
        raise ValueError("Public asset root must not be a symlink")
    root.mkdir(parents=True, exist_ok=True, mode=0o755)
    root.chmod(0o755)
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Public asset directories must not be symlinks")
        current.mkdir(exist_ok=True, mode=0o755)
        current.chmod(0o755)


def fetch(url, maximum=16 * 1024 * 1024):
    # Refuse redirects so metadata cannot turn an official URL into an arbitrary fetch.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    request = urllib.request.Request(url, headers={"Accept": "application/json,image/*", "User-Agent": "yunipals-anime-studio/v1"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Asset exceeds size limit")
    return data


def recipe():
    lock = read(RECIPE / "recipe-lock.json")
    if any(digest((RECIPE / f).read_bytes()) != h for f, h in lock["files"].items()) or digest(canonical(lock["files"])) != lock["sha256"]:
        raise ValueError("Frozen recipe changed; create a new recipe version")
    return read(RECIPE / "style.json"), lock


def node_helper(*args):
    app = ROOT / "apps/yunipals-market-api"
    built = app / "dist/arena-anime-studio.mjs"
    entry = [str(built)] if built.is_file() else ["--import", "tsx", str(app / "src/arena/live/animeStudio.ts")]
    return json.loads(subprocess.check_output([os.environ.get("ANIME_NODE", "node"), *entry, *map(str, args)], cwd=app))


def fingerprint(folder):
    receipt = read(folder / "key-receipt.json")
    current = {p.name: digest(p.read_bytes()) for p in sorted((folder / "raw").glob("*.png"))}
    if receipt["raw"] != current:
        raise ValueError("Raw images changed; key and fit them before review")
    return digest(canonical({"fighter": read(folder / "fighter.json"), "sprites": {p.name: digest(p.read_bytes()) for p in sorted((folder / "keyed").glob("*.png"))}}))


def prepare(lab, tid):
    folder = lab / tid
    if folder.exists():
        raise ValueError("Token already prepared; retain its receipts or explicitly archive the local folder")
    data = node_helper("prepare", tid)
    style, lock = recipe()
    data["look"] = {**style["defaults"], **style["species"].get(data["identity"]["species"], {})}
    data["recipe"] = {"id": style["id"], "sha256": lock["sha256"]}
    folder.mkdir(parents=True)
    artwork = fetch(data["artwork"]["url"])
    if digest(artwork) != data["artwork"]["sha256"]:
        raise ValueError("Artwork changed during preparation")
    (folder / "artwork.img").write_bytes(artwork)
    from PIL import Image
    import io
    Image.open(io.BytesIO(artwork)).convert("RGBA").save(folder / "artwork.png")
    shutil.copyfile(RECIPE / "board.png", folder / "board.png")
    write(folder / "fighter.json", data)
    for pose, prompt in style["poses"].items():
        (folder / "prompts").mkdir(exist_ok=True)
        (folder / "prompts" / (pose + ".txt")).write_text(style["style"] + "\n" + prompt + "\n" + data["identity"]["text"])
    write(folder / "stage-contract.json", {"tokenId": tid, "recipeSha256": lock["sha256"], "poses": list(style["poses"]), "executor": "codex-subscription", "idleApprovalRequiredBeforeStage2": True})
    return data


def generate(folder, stage=None, only=None):
    with generation_slot(folder.parent):
        return _generate(folder, stage, only)


def _generate(folder, stage=None, only=None):
    style, _ = recipe()
    poses = [only] if only else ["idle"] if stage == 1 or (stage is None and not (folder / "idle-review.json").exists()) else [p for p in style["poses"] if p != "idle"]
    for pose in poses:
        if pose not in style["poses"]:
            raise ValueError("Unknown pose")
        raw = folder / "raw"
        raw.mkdir(exist_ok=True)
        out = raw / (pose + ".png")
        if out.exists():
            continue
        refs = [folder / "artwork.png", folder / "board.png"]
        if pose != "idle":
            approval = read(folder / "idle-review.json")
            if approval["sha256"] != digest((raw / "idle.png").read_bytes()):
                raise ValueError("Review the idle before generating the other poses")
            refs.append(raw / "idle.png")
        prompt = (folder / "prompts" / (pose + ".txt")).read_text()
        prompt += f"\nUse the built-in image tool. Save exactly one generated PNG to {out}. Generate only this image."
        # Subscription auth remains in Codex. Explicitly exclude API-key auth and server secrets.
        env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "USER", "LANG", "CODEX_HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"}}
        auth = subprocess.run(["codex", "login", "status"], env=env, capture_output=True, text=True, timeout=30)
        if auth.returncode != 0 or "chatgpt" not in (auth.stdout + auth.stderr).lower():
            raise ValueError("Log Codex in with the ChatGPT subscription; API-key generation is not supported by this tool")
        command = ["codex", "exec", "--sandbox", "workspace-write", "--cd", str(folder), "--skip-git-repo-check"]
        for ref in refs:
            command += ["--image", str(ref)]
        command += [prompt]
        for attempt in range(3):
            with (raw / f"{pose}.{attempt}.receipt.jsonl").open("wb") as receipt:
                result = subprocess.run(command[:2] + ["--json"] + command[2:], env=env, stdout=receipt, stderr=subprocess.DEVNULL, timeout=1200)
            if result.returncode == 0 and out.is_file():
                from PIL import Image
                with Image.open(out) as image:
                    if image.format != "PNG":
                        raise ValueError("Expected generated PNG")
                    image.verify()
                write(raw / (pose + ".receipt.json"), {"generatedWith": "codex-subscription", "sha256": digest(out.read_bytes()), "attempt": attempt + 1, "references": {p.name: digest(p.read_bytes()) for p in refs}})
                break
        else:
            raise ValueError("Generation failed after at most two retries")
    return {"generated": poses}


def key(folder):
    subprocess.run(["python3", str(ROOT / "apps/yunipals-anime-engine/key.py"), str(folder / "raw"), str(folder / "keyed")], check=True)
    from PIL import Image, ImageOps, ImageDraw
    sprites = sorted((folder / "keyed").glob("*.png"))
    sheet = Image.new("RGB", (768, 768), "#ddd6ec")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(sprites):
        im = ImageOps.contain(Image.open(path).convert("RGBA"), (240, 224))
        x, y = (i % 3) * 256, (i // 3) * 256
        sheet.paste(im, (x + (256-im.width)//2, y), im)
        draw.text((x+8, y+232), path.stem, fill="black")
    sheet.save(folder / "contact-sheet.jpg", quality=90)
    write(folder / "key-receipt.json", {"raw": {p.name: digest(p.read_bytes()) for p in sorted((folder / "raw").glob("*.png"))}})
    return {"contactSheet": str(folder / "contact-sheet.jpg")}


def fit(folder):
    from PIL import Image
    data = read(folder / "fighter.json")
    height = data["look"].pop("height", 260)
    stage = {}
    for path in sorted((folder / "keyed").glob("*.png")):
        if path.stem == "cutin":
            continue
        im = Image.open(path)
        bounds = im.getchannel("A").getbbox()
        if not bounds:
            raise ValueError("Empty keyed sprite")
        stage[path.stem] = round(height * (0.55 if path.stem == "down" else 1))
    idle = Image.open(folder / "keyed/idle.png").convert("RGBA")
    bounds = idle.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("Empty idle sprite")
    # Anchors use the visible alpha bounds; an operator may override them before review.
    left, top, right, bottom = bounds
    visible_h = bottom - top
    data["look"]["torso"] = [round(((left + right) / 2 - idle.width / 2) / idle.height, 4), round((idle.height - top - visible_h * 0.5) / idle.height, 4)]
    data["look"]["origin"] = [round((right - idle.width / 2) / idle.height * 0.8, 4), round((idle.height - top - visible_h * 0.4) / idle.height, 4)]
    data["look"]["stageHeight"] = stage
    data["look"].pop("locomotion", None)
    write(folder / "fighter.json", data)
    return data["look"]


def review(folder, decision, values):
    if decision == "idle":
        write(folder / "idle-review.json", {"sha256": digest((folder / "raw/idle.png").read_bytes())})
    elif decision == "reroll":
        pose = values[0]
        style, _ = recipe()
        if pose not in style["poses"]:
            raise ValueError("Unknown pose")
        old = folder / "raw" / (pose + ".png")
        if old.exists():
            archive = folder / "rerolls" / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            archive.mkdir(parents=True)
            old.replace(archive / old.name)
        (folder / "review.json").unlink(missing_ok=True)
        generate(folder, only=pose)
    elif decision == "reject":
        code, note = int(values[0]), values[1]
        if code not in range(5) or len(note.encode()) > 140:
            raise ValueError("Use reason 0–4 and at most 140 UTF-8 bytes; the note will be public")
        write(folder / "review.json", {"decision": "reject", "code": code, "note": note})
    elif decision == "approve":
        data = read(folder / "fighter.json")
        if data.get("identityDraft"):
            raise ValueError("Review identity text and set identityDraft=false in fighter.json")
        style, _ = recipe()
        if set(p.stem for p in (folder / "keyed").glob("*.png")) != set(style["poses"]):
            raise ValueError("Review all nine keyed poses first")
        write(folder / "review.json", {"decision": "approve", "fingerprint": fingerprint(folder), "reviewedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    return {"decision": decision}


def export(folder):
    from PIL import Image
    data, decision = read(folder / "fighter.json"), read(folder / "review.json")
    if decision["decision"] != "approve" or decision["fingerprint"] != fingerprint(folder):
        raise ValueError("Review current sprites, identity and anchors before export")
    recipe()
    out = folder / "export"
    out.mkdir(exist_ok=True)
    sprites = {}
    for path in sorted((folder / "keyed").glob("*.png")):
        image = Image.open(path)
        with tempfile.NamedTemporaryFile(suffix=".webp") as temp:
            image.save(temp.name, format="WEBP", lossless=True, method=6)
            payload = Path(temp.name).read_bytes()
        sha = digest(payload)
        name = f"{path.stem}.{sha[:8]}.webp"
        (out / name).write_bytes(payload)
        sprites[path.stem] = {"file": name, "sha256": sha, "w": image.width, "h": image.height}
    manifest = {k: data[k] for k in ["chainId", "collection", "tokenId", "traits", "traitsHash", "artwork", "identity", "recipe", "look"]}
    manifest.update(version="anime-fighter/v1", sprites=sprites, generatedWith="codex-subscription", reviewedAt=decision["reviewedAt"])
    if token_id(data["tokenId"]) != folder.name or data["chainId"] != 8453 or data["collection"] != COLLECTION:
        raise ValueError("Manifest belongs to another token or collection")
    if data["traitsHash"] != "0x" + digest(canonical(data["traits"])):
        raise ValueError("Traits changed since preparation")
    # JavaScript number encoding is authoritative, including scientific notation overrides.
    write(out / "manifest.json", manifest)
    validated = node_helper("validate", out / "manifest.json")
    payload = validated["canonical"].encode("utf-8")
    (out / "manifest.json").write_bytes(payload)
    sha = digest(payload)
    if "0x" + sha != validated["manifestHash"]:
        raise ValueError("Manifest canonical hash mismatch")
    (out / f"manifest.{sha}.json").write_bytes(payload)
    idle = Image.open(folder / "keyed/idle.png").convert("RGBA")
    card = Image.new("RGB", idle.size, "#eee8fc")
    card.paste(idle, (0, 0), idle)
    card.save(out / "card.jpg", quality=90)
    write(folder / "export-receipt.json", {"manifestHash": "0x" + sha, "fingerprint": decision["fingerprint"]})
    return {"manifestHash": "0x" + sha, "folder": str(out)}


def publish(lab, destination):
    style, lock = recipe()
    recipe_target = destination / "recipes" / style["id"]
    public_directory(recipe_target, destination)
    for name in [*lock["files"], "recipe-lock.json"]:
        shutil.copyfile(RECIPE / name, recipe_target / name)
        (recipe_target / name).chmod(0o644)
    engine = ROOT / "apps/yunipals-anime-engine"
    engine_lock = read(engine / "engine-lock.json")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", engine_lock["version"]) or digest(canonical(engine_lock["files"])) != engine_lock["sha256"]:
        raise ValueError("Invalid frozen engine lock")
    engine_target = destination / "engine" / engine_lock["version"]
    for name, sha in engine_lock["files"].items():
        if ".." in Path(name).parts or Path(name).is_absolute() or digest((engine / name).read_bytes()) != sha:
            raise ValueError("Frozen engine changed")
        target = engine_target / name
        public_directory(target.parent, destination)
        shutil.copyfile(engine / name, target)
        target.chmod(0o644)
    shutil.copyfile(engine / "engine-lock.json", engine_target / "engine-lock.json")
    (engine_target / "engine-lock.json").chmod(0o644)
    for name in ["Bangers-OFL.txt", "RussoOne-OFL.txt"]:
        shutil.copyfile(engine / name, engine_target / name)
        (engine_target / name).chmod(0o644)
    published = []
    for folder in sorted(lab.iterdir()):
        if not folder.is_dir() or not (folder / "export-receipt.json").is_file():
            continue
        tid = token_id(folder.name)
        receipt = read(folder / "export-receipt.json")
        if receipt["fingerprint"] != fingerprint(folder) or "0x" + digest((folder / "export/manifest.json").read_bytes()) != receipt["manifestHash"]:
            raise ValueError("Reviewed export changed")
        target = destination / "fighters/v1" / tid
        public_directory(target, destination)
        # Assets and immutable manifest first; publish mutable manifest last.
        manifest = read(folder / "export/manifest.json")
        allowed = ["card.jpg", f"manifest.{receipt['manifestHash'][2:]}.json"]
        for sprite in manifest["sprites"].values():
            if not re.fullmatch(r"[a-z]+\.[a-f0-9]{8}\.webp", sprite["file"]):
                raise ValueError("Invalid exported sprite name")
            path = folder / "export" / sprite["file"]
            if path.is_symlink() or digest(path.read_bytes()) != sprite["sha256"]:
                raise ValueError("Exported sprite changed")
            allowed.append(sprite["file"])
        for name in allowed:
            path = folder / "export" / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Unexpected public export file")
            shutil.copyfile(path, target / name)
            (target / name).chmod(0o644)
        shutil.copyfile(folder / "export/manifest.json", target / "manifest.json.tmp")
        (target / "manifest.json.tmp").chmod(0o644)
        (target / "manifest.json.tmp").replace(target / "manifest.json")
        published.append(tid)
    return {"published": published}


def batch(lab, registry, approving):
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", registry) or int(registry, 16) == 0:
        raise ValueError("Provide the deployed registry address")
    result = {"registry": registry, "functionName": "approve" if approving else "reject", "ids": [], "hashes": [], "codes": [], "notes": []}
    for folder in sorted(lab.iterdir()):
        if not folder.is_dir() or not (folder / "review.json").exists():
            continue
        decision = read(folder / "review.json")
        if decision["decision"] != ("approve" if approving else "reject"):
            continue
        tid = token_id(folder.name)
        if approving:
            receipt = read(folder / "export-receipt.json")
            manifest = read(folder / "export/manifest.json")
            if receipt["fingerprint"] != fingerprint(folder) or "0x"+digest((folder / "export/manifest.json").read_bytes()) != receipt["manifestHash"]:
                raise ValueError("Export needs review again")
            remote = fetch(f"{ASSETS}/fighters/v1/{tid}/manifest.json", 65536)
            if "0x" + digest(remote) != receipt["manifestHash"]:
                raise ValueError("Publish and verify the approved manifest first")
            for sprite in manifest["sprites"].values():
                if digest(fetch(f"{ASSETS}/fighters/v1/{tid}/{sprite['file']}")) != sprite["sha256"]:
                    raise ValueError("Published sprite changed")
            result["hashes"].append(receipt["manifestHash"])
        else:
            result["codes"].append(decision["code"])
            result["notes"].append(decision["note"])
        result["ids"].append(tid)
        if len(result["ids"]) == 20:
            break
    if not result["ids"]:
        raise ValueError("No reviewed fighters to batch")
    write(lab / "batch-input.json", result)
    calldata = node_helper("encode", lab / "batch-input.json")
    write(lab / "batch-transaction.json", calldata)
    return {**calldata, "command": f"cast send --chain base --account YOUR_CURATOR_KEYSTORE {registry} --data {calldata['data']}"}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", type=Path, default=ROOT / ".arena-lab/anime-studio")
    sub = parser.add_subparsers(dest="command", required=True)
    queue = sub.add_parser("queue")
    queue.add_argument("--cursor")
    for command in ["prepare", "generate", "key", "fit", "review", "export"]:
        part = sub.add_parser(command)
        part.add_argument("tokenId", type=token_id)
        if command == "generate":
            part.add_argument("--stage", type=int, choices=[1, 2])
        if command == "review":
            part.add_argument("decision", choices=["idle", "approve", "reroll", "reject"])
            part.add_argument("values", nargs="*")
    part = sub.add_parser("publish")
    part.add_argument("--destination", type=Path, default=Path("/var/www/assets-anime.yunipals.com"))
    for command in ["approve-batch", "reject-batch"]:
        part = sub.add_parser(command)
        part.add_argument("--registry", required=True)
    args = parser.parse_args()
    if args.command == "queue":
        from urllib.parse import urlencode
        result = json.loads(fetch("https://www.yunipals.com/api/anime-arena/fighters?" + urlencode({"status": "Applied", **({"cursor": args.cursor} if args.cursor else {})}), 256 * 1024))
    else:
        with locked(args.lab, getattr(args, "tokenId", None)):
            folder = args.lab / args.tokenId if hasattr(args, "tokenId") else args.lab
            if args.command == "prepare": result = prepare(args.lab, args.tokenId)
            elif args.command == "generate": result = generate(folder, args.stage)
            elif args.command == "key": result = key(folder)
            elif args.command == "fit": result = fit(folder)
            elif args.command == "review": result = review(folder, args.decision, args.values)
            elif args.command == "export": result = export(folder)
            elif args.command == "publish": result = publish(args.lab, args.destination)
            else: result = batch(args.lab, args.registry, args.command == "approve-batch")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
