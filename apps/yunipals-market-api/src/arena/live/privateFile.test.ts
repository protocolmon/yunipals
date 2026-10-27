import assert from "node:assert/strict";
import fs, { constants, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { readPrivateFile } from "./privateFile";

const syntheticSecret = "  synthetic-test-credential\n";
const refusal = /owner-only permissions or trusted systemd credentials/;

function temporaryFile(t: TestContext, mode: number) {
  const directory = fs.mkdtempSync(join(tmpdir(), "arena-private-file-"));
  const file = join(directory, "key");
  fs.writeFileSync(file, syntheticSecret, { mode });
  fs.chmodSync(file, mode);
  t.after(() => {
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, file };
}

function changed(stat: Stats, properties: Partial<Stats>) {
  return Object.assign(
    Object.create(Object.getPrototypeOf(stat)),
    stat,
    properties
  ) as Stats;
}

/** Exercise real open/read/fstat/close descriptors; only the service's mount/path
 * observations are supplied by a fixture, never a real /run credential. */
function systemdFixture(
  t: TestContext,
  unit = "yunipals-arena-api.service",
  name = "strategy-encryption.key"
) {
  const local = temporaryFile(t, 0o440);
  fs.chmodSync(local.directory, 0o550);
  const directory = `/run/credentials/${unit}`;
  const path = `${directory}/${name}`;
  const original = {
    lstat: fs.lstatSync,
    fstat: fs.fstatSync,
    open: fs.openSync,
    read: fs.readFileSync,
    close: fs.closeSync
  };
  const state = {
    directory,
    path,
    mount: `44 31 0:77 / ${directory} ro,nosuid,nodev,noexec,relatime,nosymfollow - tmpfs tmpfs rw,size=1024k,mode=700,noswap`,
    descriptorMountId: "44",
    file: { uid: 0, gid: 0 } as Partial<Stats>,
    directoryStat: { uid: 0, gid: 0 } as Partial<Stats>,
    parentStat: { uid: 0, gid: 0 } as Partial<Stats>,
    descriptorStat: { uid: 0, gid: 0 } as Partial<Stats>,
    dataReads: 0,
    opens: 0,
    closes: 0,
    afterRead: undefined as (() => void) | undefined
  };
  const previous = process.env.CREDENTIALS_DIRECTORY;
  process.env.CREDENTIALS_DIRECTORY = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY = previous;
  });
  t.mock.method(fs, "lstatSync", ((
    value: fs.PathLike,
    ...options: unknown[]
  ) => {
    if (value === state.path)
      return changed(original.lstat(local.file), state.file);
    if (value === directory)
      return changed(original.lstat(local.directory), state.directoryStat);
    if (value === "/run" || value === "/run/credentials")
      return changed(original.lstat(local.directory), state.parentStat);
    return Reflect.apply(original.lstat, fs, [value, ...options]);
  }) as typeof fs.lstatSync);
  t.mock.method(fs, "openSync", ((
    value: fs.PathLike,
    flags: number,
    mode?: fs.Mode
  ) => {
    if (value === state.path) {
      assert.ok(flags & constants.O_NOFOLLOW);
      assert.ok(flags & constants.O_NONBLOCK);
      state.opens++;
      return original.open(local.file, flags, mode);
    }
    return original.open(value, flags, mode);
  }) as typeof fs.openSync);
  t.mock.method(fs, "fstatSync", ((fd: number) =>
    changed(original.fstat(fd), state.descriptorStat)) as typeof fs.fstatSync);
  t.mock.method(fs, "readFileSync", ((
    value: fs.PathOrFileDescriptor,
    ...options: unknown[]
  ) => {
    if (value === "/proc/self/mountinfo") return `${state.mount}\n`;
    if (
      typeof value === "string" &&
      /^\/proc\/self\/fdinfo\/[0-9]+$/.test(value)
    )
      return `pos:\t0\nflags:\t0504000\nmnt_id:\t${state.descriptorMountId}\n`;
    if (typeof value === "number") {
      state.dataReads++;
      const result = Reflect.apply(original.read, fs, [value, ...options]);
      state.afterRead?.();
      return result;
    }
    return Reflect.apply(original.read, fs, [value, ...options]);
  }) as typeof fs.readFileSync);
  t.mock.method(fs, "closeSync", (fd: number) => {
    state.closes++;
    return original.close(fd);
  });
  return state;
}

test("ordinary private files retain owner-only reads and trimming", (t) => {
  const { file } = temporaryFile(t, 0o600);
  assert.equal(readPrivateFile(file), syntheticSecret.trim());
  fs.chmodSync(file, 0o400);
  assert.equal(readPrivateFile(file), syntheticSecret.trim());
  fs.chmodSync(file, 0o440);
  assert.throws(() => readPrivateFile(file), refusal);
  fs.chmodSync(file, 0o644);
  assert.throws(() => readPrivateFile(file), refusal);
});

test("ordinary directories and symlinks cannot be secret files", (t) => {
  const { directory, file } = temporaryFile(t, 0o600);
  const link = join(directory, "link");
  fs.symlinkSync(file, link);
  assert.throws(() => readPrivateFile(directory), refusal);
  assert.throws(() => readPrivateFile(link), refusal);
});

test("ordinary files still reject a permission change during the descriptor read", (t) => {
  const { file } = temporaryFile(t, 0o600);
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", ((
    value: fs.PathOrFileDescriptor,
    ...options: unknown[]
  ) => {
    const result = Reflect.apply(originalRead, fs, [value, ...options]);
    if (typeof value === "number") fs.chmodSync(file, 0o644);
    return result;
  }) as typeof fs.readFileSync);
  assert.throws(() => readPrivateFile(file), refusal);
});

test("exact root-owned systemd credential on a private read-only bind mount is readable", (t) => {
  const state = systemdFixture(t);
  assert.equal(readPrivateFile(state.path), syntheticSecret.trim());
  assert.equal(state.dataReads, 1);
  assert.equal(state.opens, 1);
  assert.equal(state.closes, 1);
});

test("all deployed legacy and native credential unit/key combinations remain supported", async (t) => {
  const pairs = [
    ["api", "admission.key"],
    ["capacity", "strategy-encryption.key"],
    ["control", "referee.key"],
    ["lobby", "operator.key"],
    ["media", "strategy-encryption.key"],
    ["projector", "strategy-encryption.key"],
    ["referee", "strategy-encryption.key"],
    ["settlement", "referee.key"],
    ["native-api", "admission.key"],
    ["native-capacity", "strategy-encryption.key"],
    ["native-client", "strategy-encryption.key"],
    ["native-disclosure", "strategy-encryption.key"],
    ["native-media", "strategy-encryption.key"],
    ["native-referee", "strategy-encryption.key"],
    ["native-execution@lobby", "execution.key"],
    ["native-execution@operator", "execution.key"],
    ["native-execution@referee", "execution.key"]
  ];
  for (const [role, name] of pairs)
    await t.test(role!, (child) => {
      const state = systemdFixture(
        child,
        `yunipals-arena-${role}.service`,
        name
      );
      assert.equal(readPrivateFile(state.path), syntheticSecret.trim());
    });
});

test("the exact environment directory and direct canonical child path are mandatory", async (t) => {
  for (const variant of [
    "absent",
    "other-unit",
    "trailing-slash",
    "traversal",
    "nested",
    "wrong-root"
  ])
    await t.test(variant, (child) => {
      const state = systemdFixture(child);
      let path = state.path;
      if (variant === "absent") delete process.env.CREDENTIALS_DIRECTORY;
      if (variant === "other-unit")
        process.env.CREDENTIALS_DIRECTORY =
          "/run/credentials/yunipals-arena-referee.service";
      if (variant === "trailing-slash")
        process.env.CREDENTIALS_DIRECTORY += "/";
      if (variant === "traversal")
        path =
          state.path = `${state.directory}/../yunipals-arena-api.service/strategy-encryption.key`;
      if (variant === "nested")
        path = state.path = `${state.directory}/nested/strategy-encryption.key`;
      if (variant === "wrong-root") {
        process.env.CREDENTIALS_DIRECTORY = `/tmp/${state.directory.split("/").pop()}`;
        path =
          state.path = `${process.env.CREDENTIALS_DIRECTORY}/strategy-encryption.key`;
      }
      assert.throws(() => readPrivateFile(path), refusal);
      assert.equal(state.dataReads, 0);
      assert.equal(state.opens, 0);
    });
});

test("unknown units, execution instances and keys cannot borrow systemd trust", async (t) => {
  for (const [unit, name] of [
    ["yunipals-arena-backup.service", "strategy-encryption.key"],
    ["yunipals-arena-native-execution@unexpected.service", "execution.key"],
    ["yunipals-arena-api.service", "operator.key"],
    ["yunipals-arena-referee.service", "admission.key"],
    ["yunipals-arena-api.service", "unknown.key"]
  ])
    await t.test(`${unit}/${name}`, (child) => {
      const state = systemdFixture(child, unit, name);
      assert.throws(() => readPrivateFile(state.path), refusal);
      assert.equal(state.dataReads, 0);
      assert.equal(state.opens, 0);
    });
});

test("untrusted file, directory, parent ownership/modes or symlinks fail before reading", async (t) => {
  const cases: [
    string,
    "file" | "directoryStat" | "parentStat",
    Partial<Stats>
  ][] = [
    ["file-user", "file", { uid: 971 }],
    ["file-group", "file", { gid: 965 }],
    ["file-mode", "file", { mode: constants.S_IFREG | 0o640 }],
    ["file-other", "file", { mode: constants.S_IFREG | 0o444 }],
    ["file-link", "file", { mode: constants.S_IFLNK | 0o440 }],
    ["directory-user", "directoryStat", { uid: 971 }],
    ["directory-group", "directoryStat", { gid: 965 }],
    ["directory-mode", "directoryStat", { mode: constants.S_IFDIR | 0o750 }],
    ["directory-link", "directoryStat", { mode: constants.S_IFLNK | 0o550 }],
    ["parent-write", "parentStat", { mode: constants.S_IFDIR | 0o775 }],
    ["parent-link", "parentStat", { mode: constants.S_IFLNK | 0o550 }]
  ];
  for (const [label, field, properties] of cases)
    await t.test(label, (child) => {
      const state = systemdFixture(child);
      state[field] = properties;
      assert.throws(() => readPrivateFile(state.path), refusal);
      assert.equal(state.dataReads, 0);
      assert.equal(state.opens, 0);
    });
});

test("read-only credential mounts support valid kernel propagation metadata", async (t) => {
  for (const fields of [
    "shared:657 master:526",
    "shared:657",
    "master:526 propagate_from:520",
    "unbindable"
  ])
    await t.test(fields, (child) => {
      const state = systemdFixture(child);
      state.mount = state.mount.replace(" - ", ` ${fields} - `);
      assert.equal(readPrivateFile(state.path), syntheticSecret.trim());
      assert.equal(state.dataReads, 1);
      assert.equal(state.closes, 1);
    });
});

test("mount trust retains read-only flags, exact target, tmpfs and valid optional fields", async (t) => {
  for (const variant of [
    "rw",
    "missing-nosuid",
    "missing-nodev",
    "missing-noexec",
    "missing-nosymfollow",
    "shared-zero",
    "shared-empty",
    "master-negative",
    "master-text",
    "propagate-zero",
    "propagate-empty",
    "unknown-field",
    "wrong-fs",
    "parent-only",
    "duplicate",
    "file-overlay"
  ])
    await t.test(variant, (child) => {
      const state = systemdFixture(child);
      if (variant === "rw") state.mount = state.mount.replace(" ro,", " rw,");
      if (variant.startsWith("missing-"))
        state.mount = state.mount.replace(`,${variant.slice(8)}`, "");
      const invalidFields: Record<string, string> = {
        "shared-zero": "shared:0",
        "shared-empty": "shared:",
        "master-negative": "master:-1",
        "master-text": "master:x",
        "propagate-zero": "propagate_from:0",
        "propagate-empty": "propagate_from:",
        "unknown-field": "unexpected:7"
      };
      if (invalidFields[variant])
        state.mount = state.mount.replace(
          " - ",
          ` ${invalidFields[variant]} - `
        );
      if (variant === "wrong-fs")
        state.mount = state.mount.replace(" - tmpfs ", " - ext4 ");
      if (variant === "parent-only")
        state.mount = state.mount.replace(state.directory, "/run/credentials");
      if (variant === "duplicate")
        state.mount += `\n${state.mount.replace(/^44 /, "45 ")}`;
      if (variant === "file-overlay")
        state.mount += `\n45 44 0:78 / ${state.path} ro,nosuid,nodev,noexec,nosymfollow - tmpfs tmpfs rw`;
      assert.throws(() => readPrivateFile(state.path), refusal);
      assert.equal(state.dataReads, 0);
      assert.equal(state.opens, 0);
    });
});

test("descriptor must bind the observed inode and actual credential mount before any content read", async (t) => {
  for (const variant of ["inode", "mode", "mount"])
    await t.test(variant, (child) => {
      const state = systemdFixture(child);
      if (variant === "inode") state.descriptorStat = { ino: -1 };
      if (variant === "mode")
        state.descriptorStat = { mode: constants.S_IFREG | 0o644 };
      if (variant === "mount") state.descriptorMountId = "999";
      assert.throws(() => readPrivateFile(state.path), refusal);
      assert.equal(state.dataReads, 0);
      assert.equal(state.closes, 1);
    });
});

test("read-time inode, permission, directory and mount replacement never returns secret contents", async (t) => {
  for (const variant of ["inode", "mode", "directory", "mount", "propagation"])
    await t.test(variant, (child) => {
      const state = systemdFixture(child);
      state.afterRead = () => {
        if (variant === "inode") state.file = { ino: -1 };
        if (variant === "mode")
          state.descriptorStat = { mode: constants.S_IFREG | 0o644 };
        if (variant === "directory") state.directoryStat = { ino: -1 };
        if (variant === "mount")
          state.mount = state.mount.replace("0:77", "0:78");
        if (variant === "propagation")
          state.mount = state.mount.replace(" - ", " shared:657 master:526 - ");
      };
      assert.throws(() => readPrivateFile(state.path), refusal);
      assert.equal(state.dataReads, 1);
      assert.equal(state.closes, 1);
    });
});
