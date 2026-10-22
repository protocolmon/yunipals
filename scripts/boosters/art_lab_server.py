"""Loopback-only UI for preparing Codex-assisted artwork jobs; no API credentials."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from art_lab import DEFAULT_LAB, ROOT, export, next_stage, prepare


def handler_for(lab, directory):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def allowed_origin(self):
            port = self.server.server_port
            allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            origin = self.headers.get("Origin")
            return (self.headers.get("Host") in allowed_hosts and
                    (origin is None or origin in {f"http://{host}" for host in allowed_hosts}))

        def send_json(self, status, value):
            content = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            if not self.allowed_origin():
                self.send_json(403, {"error": "Use the local art lab origin"})
                return
            url = urlparse(self.path)
            if url.path == "/api/status":
                self.send_json(200, {"subscriptionAssisted": True, "apiGenerationEnabled": False})
            elif url.path == "/api/next":
                try:
                    run_id = parse_qs(url.query).get("run", [""])[0]
                    self.send_json(200, next_stage(lab, run_id))
                except (ValueError, OSError, KeyError):
                    self.send_json(404, {"error": "Unknown or invalid artwork run"})
            elif url.path.startswith("/api/"):
                self.send_json(404, {"error": "Unknown art lab operation"})
            else:
                super().do_GET()

        def list_directory(self, path):
            self.send_error(404)
            return None

        def do_POST(self):
            if not self.allowed_origin():
                self.send_json(403, {"error": "Use the local art lab origin"})
                return
            if self.path != "/api/prepare":
                self.send_json(404, {"error": "Unknown art lab operation"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 4096:
                    self.send_json(413, {"error": "Send a small JSON trait request"})
                    return
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    self.send_json(415, {"error": "JSON is required"})
                    return
                data = json.loads(self.rfile.read(length))
                required = {"type", "color", "horn", "glitter"}
                if not isinstance(data, dict) or not required.issubset(data) or set(data) - required - {"frameStyle"}:
                    raise ValueError("Provide type, color, horn, glitter and an optional frameStyle")
                if any(not isinstance(value, str) or len(value) > 40 for value in data.values()):
                    raise ValueError("Invalid trait value")
                result = prepare(lab, data["type"], data["color"], data["horn"], data["glitter"], frame_style=data.get("frameStyle", "brand"))
                export(lab, directory)
                self.send_json(200, result)
            except (ValueError, KeyError, OSError) as error:
                self.send_json(400, {"error": str(error)})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", type=Path, default=DEFAULT_LAB)
    parser.add_argument("--directory", type=Path, default=ROOT / "sites/yunipals-booster-art-review/dist")
    parser.add_argument("--port", type=int, default=5197)
    args = parser.parse_args()
    export(args.lab, args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(args.lab, args.directory))
    print(f"Yunipals art lab: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
