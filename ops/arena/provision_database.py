"""Create the isolated Arena database on the existing production PG16 cluster.

No services are started. Passwords stay in root-only files and subprocess stdin.
The application role has DML access, not schema ownership or migration rights.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

assert os.geteuid() == 0 and os.uname().nodename == 'yunipals-main'
release = Path(sys.argv[1]).resolve()
assert release.is_relative_to('/srv/yunipals-arena/releases')
migration = release / 'apps/yunipals-market-api/dist/arena-migrate.mjs'
assert migration.is_file()
private = Path('/etc/yunipals-arena/database.env')
database = 'yunipals_arena'
owner = 'yunipals_arena_owner'
app = 'yunipals_arena_app'


def sql(text, db='postgres'):
    result = subprocess.run(
        ['runuser', '-u', 'postgres', '--', 'psql', '-X', '-p', '15438', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'],
        input=text, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, 'Arena database operation failed; details suppressed'
    return result.stdout.strip()


exists = sql("SELECT datname FROM pg_database WHERE datname='yunipals_arena';")
if not exists:
    assert not private.exists(), 'Existing credentials without database; reconcile before proceeding'
    assert not sql("SELECT rolname FROM pg_roles WHERE rolname IN ('yunipals_arena_owner','yunipals_arena_app');"), 'Existing roles; reconcile before proceeding'
    password = secrets.token_urlsafe(36)
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.new(salted, b'Client Key', 'sha256').digest()).digest()
    server = hmac.new(salted, b'Server Key', 'sha256').digest()
    b64 = lambda value: base64.b64encode(value).decode()
    verifier = 'SCRAM-SHA-256$4096:' + b64(salt) + '$' + b64(stored) + ':' + b64(server)
    # Write first: a partially failed provision is visible and cannot silently rotate keys.
    fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(f'ARENA_DATABASE_URL=postgresql://{app}:{password}@127.0.0.1:15438/{database}\n')
    sql(f"CREATE ROLE {owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;\n"
        f"CREATE ROLE {app} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 40 PASSWORD '{verifier}';\n"
        f"CREATE DATABASE {database} OWNER {owner};\n"
        f"REVOKE ALL ON DATABASE {database} FROM PUBLIC; GRANT CONNECT ON DATABASE {database} TO {app};")
assert private.is_file() and private.stat().st_mode & 0o077 == 0
assert sql(f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='{database}';") == owner
sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC;', database)
result = subprocess.run([
    'runuser', '-u', 'postgres', '--', 'env',
    'ARENA_DATABASE_URL=postgresql:///yunipals_arena?host=/var/run/postgresql&port=15438',
    'PGOPTIONS=-c role=yunipals_arena_owner',
    '/srv/yunipals-arena/runtime/node-v24.18.1', str(migration)
], capture_output=True, text=True, timeout=60)
assert result.returncode == 0, 'Arena migration failed; details suppressed'
sql(f"GRANT USAGE ON SCHEMA yunipals_arena TO {app};\n"
    f"GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA yunipals_arena TO {app};\n"
    f"GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA yunipals_arena TO {app};\n"
    f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA yunipals_arena GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {app};\n"
    f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA yunipals_arena GRANT USAGE,SELECT ON SEQUENCES TO {app};", database)
checks = sql(f"SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname='{app}';\n"
             f"SELECT NOT has_schema_privilege('{app}','yunipals_arena','CREATE');\n"
             f"SELECT has_table_privilege('{app}','yunipals_arena.provider_task','SELECT,INSERT,UPDATE,DELETE');\n"
             f"SELECT bool_and(tableowner='{owner}') FROM pg_tables WHERE schemaname='yunipals_arena';", database)
assert checks.splitlines() == ['t'] * 4
tables = int(sql("SELECT count(*) FROM pg_tables WHERE schemaname='yunipals_arena';", database))
report = {'version': 'arena-database-v1', 'database': database, 'port': 15438, 'tables': tables,
          'applicationRole': app, 'ownerRole': owner, 'permissionsVerified': True,
          'credentialsPublic': False, 'servicesStarted': False}
Path('/srv/yunipals-arena/database-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
