#!/usr/bin/env python3
import importlib.util
import http.client
import json
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("redirect", Path(__file__).with_name("canonical-www-redirect.py"))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
FIXTURE = b'''# All unrelated hosts and certificate declarations must survive byte-for-byte.
server {
    server_name api.yunipals.com;
    location / { proxy_pass http://127.0.0.1:9011; }
}
# webapp
server {
    server_name app.yunipals.com; # managed by Certbot
    listen 443;
    listen [::]:443;
    # ssl_certificate /etc/letsencrypt/live/app.yunipals.com/fullchain.pem;
    location / { root /var/www/yunipals/releases/retained; try_files $uri /index.html; }
    add_header X-Fixture "a quoted { brace } # is not a comment";
}
server {
    if ($host = app.yunipals.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot
    listen 80;
    listen [::]:80;
    server_name app.yunipals.com;
    return 404; # managed by Certbot
}
'''


class RedirectTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.config = self.directory / "site.conf"
        self.config.write_bytes(FIXTURE)
        self.config.chmod(0o640)
        self.backups = self.directory / "backups"
        self.before_sha = M.sha(FIXTURE)
        self.after, self.delta = M.render(FIXTURE)
        self.after_sha = M.sha(self.after)
        self.calls = []

    def command(self, arguments):
        self.calls.append(arguments)

    def apply(self, command=None):
        with patch.object(M, "validate_shadow"), patch.object(M, "run", command or self.command):
            return M.apply(self.before_sha, self.after_sha, self.config, self.backups)

    def test_exact_two_insertions_preserve_every_original_byte(self):
        self.assertEqual(self.after.count(M.INSERTION), 2)
        self.assertEqual(self.after.replace(M.INSERTION, b""), FIXTURE)
        self.assertEqual({row["listener"] for row in self.delta}, {"http", "https"})
        self.assertIn(b"server {" + M.INSERTION + b"\n    if ($host", self.after)
        self.assertNotIn(b"server {" + M.INSERTION + b"\n    server_name api", self.after)

    def test_path_query_encoding_and_fragment_free_request_uri_preserved(self):
        for uri in ("/", "/boosters/setup?stage=smoke&next=%2Fcollection", "/monsters/a/1?x=a%20b&x=2"):
            rendered_return = M.DIRECTIVE.removeprefix("return 308 ").removesuffix(";")
            self.assertEqual(rendered_return.replace("$request_uri", uri), "https://www.yunipals.com" + uri)
        self.assertNotIn("$uri;", M.DIRECTIVE)

    def test_ambiguous_or_duplicate_targets_refused(self):
        for fixture in (FIXTURE.replace(b"server_name app.yunipals.com;", b"server_name app.yunipals.com other.example;", 1),
                        FIXTURE + b"server { listen 80; server_name app.yunipals.com; }",
                        FIXTURE.replace(b"listen 80;", b"listen 8080;"), self.after):
            with self.subTest(fixture=M.sha(fixture)), self.assertRaises(RuntimeError):
                M.render(fixture)

    @unittest.skipUnless(shutil.which("nginx"), "nginx binary unavailable")
    def test_rewritten_fixture_passes_actual_nginx_syntax(self):
        main = self.directory / "nginx.conf"
        main.write_text(f"pid {self.directory}/nginx.pid;\nerror_log stderr;\nevents {{}}\n"
                        "http {\naccess_log off;\ninclude /etc/nginx/sites-enabled/*;\n}\n")
        enabled = self.directory / "enabled"
        enabled.mkdir()
        (enabled / "fixture").symlink_to(self.config)
        M.validate_shadow(self.after, self.config, main, enabled)
        self.assertEqual(self.config.read_bytes(), FIXTURE)

    @unittest.skipUnless(shutil.which("nginx") and shutil.which("openssl"), "nginx/openssl unavailable")
    def test_actual_http_and_https_redirect_keep_full_query_before_certbot_if(self):
        def free_port():
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                return listener.getsockname()[1]
        http_port, https_port = free_port(), free_port()
        key, certificate = self.directory / "key.pem", self.directory / "cert.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=app.yunipals.com", "-keyout", str(key), "-out", str(certificate)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        servers = self.after[self.after.index(b"# webapp"):]
        servers = servers.replace(b"listen 443;", (f"listen 127.0.0.1:{https_port} ssl;\n"
                                  f"ssl_certificate {certificate};\nssl_certificate_key {key};").encode())
        servers = servers.replace(b"listen [::]:443;", b"").replace(b"listen [::]:80;", b"")
        servers = servers.replace(b"listen 80;", f"listen 127.0.0.1:{http_port};".encode())
        main = self.directory / "nginx-live.conf"
        main.write_bytes(f"pid {self.directory}/nginx.pid;\nerror_log stderr;\nevents {{}}\nhttp {{ access_log off;\n".encode()
                         + servers + b"}\n")
        process = subprocess.Popen(["nginx", "-c", str(main), "-p", str(self.directory), "-g",
                                    "daemon off; master_process off;"], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE)
        try:
            uri = "/monsters/one/1?next=%2Fcollection&label=a%20b&x=1&x=2"
            for secure, port in ((False, http_port), (True, https_port)):
                for attempt in range(50):
                    connection = (http.client.HTTPSConnection("127.0.0.1", port, timeout=1,
                                  context=ssl._create_unverified_context()) if secure else
                                  http.client.HTTPConnection("127.0.0.1", port, timeout=1))
                    try:
                        connection.request("GET", uri, headers={"Host": "app.yunipals.com"})
                        response = connection.getresponse()
                        self.assertEqual(response.status, 308)
                        self.assertEqual(response.getheader("Location"), "https://www.yunipals.com" + uri)
                        break
                    except ConnectionRefusedError:
                        if attempt == 49:
                            raise
                        time.sleep(0.02)
                    finally:
                        connection.close()
        finally:
            process.terminate()
            _, diagnostics = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, diagnostics.decode())

    def test_default_cli_is_readonly_review(self):
        with patch("sys.argv", [str(M.__file__)]), patch.object(M, "review", return_value=(None, None, None, {})) as review, \
                patch("builtins.print"), patch.object(M, "apply") as apply:
            M.main()
        review.assert_called_once_with(M.EXPECTED_BEFORE)
        apply.assert_not_called()

    def test_before_and_candidate_cas_mismatch_never_mutates(self):
        with patch.object(M, "validate_shadow"), patch.object(M, "run", self.command):
            for before, after in (("0" * 64, self.after_sha), (self.before_sha, "0" * 64)):
                with self.assertRaises(RuntimeError):
                    M.apply(before, after, self.config, self.backups)
        self.assertEqual(self.config.read_bytes(), FIXTURE)
        self.assertEqual(self.calls, [])

    def test_success_backups_metadata_and_explicit_owned_inverse(self):
        result = self.apply()
        operation = Path(result["operation"])
        self.assertEqual(self.config.read_bytes(), self.after)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o640)
        self.assertEqual((operation / "before.conf").read_bytes(), FIXTURE)
        self.assertEqual(operation.stat().st_mode & 0o777, 0o700)
        self.assertEqual((operation / "before.conf").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.calls, [["nginx", "-t"], ["systemctl", "reload", "nginx"]])
        with patch.object(M, "validate_shadow"), patch.object(M, "run", self.command):
            restored = M.inverse(operation, self.before_sha, self.after_sha, self.config, self.backups)
        self.assertEqual(restored["status"], "RESTORED")
        self.assertEqual(self.config.read_bytes(), FIXTURE)

    def test_syntax_failure_restores_only_owned_candidate_without_reload(self):
        def fail_once(arguments):
            self.command(arguments)
            if len(self.calls) == 1:
                raise RuntimeError("fixture nginx failure")
        with self.assertRaisesRegex(RuntimeError, "restored_owned_input"):
            self.apply(fail_once)
        self.assertEqual(self.config.read_bytes(), FIXTURE)
        self.assertEqual(self.calls, [["nginx", "-t"], ["nginx", "-t"]])

    def test_reload_failure_restores_and_reloads_original(self):
        def fail_once(arguments):
            self.command(arguments)
            if len(self.calls) == 2:
                raise RuntimeError("fixture reload failure")
        with self.assertRaisesRegex(RuntimeError, "restored_owned_input"):
            self.apply(fail_once)
        self.assertEqual(self.config.read_bytes(), FIXTURE)
        self.assertEqual(self.calls[-2:], [["nginx", "-t"], ["systemctl", "reload", "nginx"]])

    def test_failed_reload_never_overwrites_foreign_edit(self):
        def foreign_edit(arguments):
            self.command(arguments)
            if len(self.calls) == 2:
                self.config.write_bytes(b"# foreign edit\n")
                raise RuntimeError("fixture reload failure")
        with self.assertRaisesRegex(RuntimeError, "refused_foreign_configuration"):
            self.apply(foreign_edit)
        self.assertEqual(self.config.read_bytes(), b"# foreign edit\n")
        self.assertEqual(len(self.calls), 2)

    def test_replace_ack_failure_still_recognizes_owned_candidate(self):
        replace = M.replace_config
        count = []
        def lost_ack(*arguments):
            replace(*arguments)
            count.append(True)
            if len(count) == 1:
                raise RuntimeError("fixture directory fsync failure")
        with patch.object(M, "replace_config", lost_ack), self.assertRaisesRegex(RuntimeError, "restored_owned_input"):
            self.apply()
        self.assertEqual(self.config.read_bytes(), FIXTURE)

    def test_inverse_rejects_changed_operation_or_foreign_config(self):
        result = self.apply()
        operation = Path(result["operation"])
        self.config.write_bytes(b"# foreign\n")
        with patch.object(M, "validate_shadow"), patch.object(M, "run", self.command), \
                self.assertRaisesRegex(RuntimeError, "inverse_refuses"):
            M.inverse(operation, self.before_sha, self.after_sha, self.config, self.backups)
        self.config.write_bytes(self.after)
        plan_file = operation / "plan.json"
        plan = json.loads(plan_file.read_text())
        plan["operatorSha256"] = "0" * 64
        plan_file.write_text(json.dumps(plan))
        with self.assertRaisesRegex(RuntimeError, "operation_binding"):
            M.inverse(operation, self.before_sha, self.after_sha, self.config, self.backups)
        self.assertEqual(self.config.read_bytes(), self.after)

    def test_symlink_or_writable_config_refused(self):
        self.config.chmod(0o666)
        with self.assertRaisesRegex(RuntimeError, "unprotected_file"):
            M.protected_bytes(self.config)
        self.config.unlink()
        self.config.symlink_to(self.directory / "other")
        with self.assertRaises(OSError):
            M.protected_bytes(self.config)


if __name__ == "__main__":
    unittest.main()
