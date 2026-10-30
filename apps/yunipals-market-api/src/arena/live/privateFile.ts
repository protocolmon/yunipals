import fs, { constants, type Stats } from "node:fs";
import { basename, dirname, normalize } from "node:path";

const credentialRoot = "/run/credentials";
const encryptionKey = "strategy-encryption.key";
const unitCredentials: Readonly<Record<string, readonly string[]>> = {
  "yunipals-arena-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-capacity.service": [encryptionKey],
  "yunipals-arena-control.service": [encryptionKey, "referee.key"],
  "yunipals-arena-lobby.service": [encryptionKey, "operator.key"],
  "yunipals-arena-media.service": [encryptionKey],
  "yunipals-arena-projector.service": [encryptionKey],
  "yunipals-arena-referee.service": [encryptionKey],
  "yunipals-arena-settlement.service": [encryptionKey, "referee.key"],
  "yunipals-arena-native-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-native-capacity.service": [encryptionKey],
  "yunipals-arena-native-client.service": [encryptionKey],
  "yunipals-arena-native-disclosure.service": [encryptionKey],
  "yunipals-arena-native-media.service": [encryptionKey],
  "yunipals-arena-native-referee.service": [encryptionKey],
  "yunipals-arena-native-execution@lobby.service": [
    encryptionKey,
    "execution.key"
  ],
  "yunipals-arena-native-execution@operator.service": [
    encryptionKey,
    "execution.key"
  ],
  "yunipals-arena-native-execution@referee.service": [
    encryptionKey,
    "execution.key"
  ],
  "yunipals-anime-arena-api.service": [encryptionKey, "admission.key"],
  "yunipals-anime-arena-capacity.service": [encryptionKey],
  "yunipals-anime-arena-client.service": [encryptionKey],
  "yunipals-anime-arena-control.service": [encryptionKey],
  "yunipals-anime-arena-lobby.service": [encryptionKey, "operator.key"],
  "yunipals-anime-arena-media.service": [encryptionKey],
  "yunipals-anime-arena-monitor.service": [encryptionKey],
  "yunipals-anime-arena-referee.service": [encryptionKey],
  "yunipals-anime-arena-settlement.service": [encryptionKey, "referee.key"],
  "yunipals-arena-v2-video-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-v2-video-capacity.service": [encryptionKey],
  "yunipals-arena-v2-video-client.service": [encryptionKey],
  "yunipals-arena-v2-video-control.service": [encryptionKey],
  "yunipals-arena-v2-video-lobby.service": [encryptionKey, "operator.key"],
  "yunipals-arena-v2-video-media.service": [encryptionKey],
  "yunipals-arena-v2-video-monitor.service": [encryptionKey],
  "yunipals-arena-v2-video-referee.service": [encryptionKey],
  "yunipals-arena-v2-video-settlement.service": [encryptionKey, "referee.key"],
  "yunipals-arena-v2-anime-api.service": [encryptionKey, "admission.key"],
  "yunipals-arena-v2-anime-capacity.service": [encryptionKey],
  "yunipals-arena-v2-anime-client.service": [encryptionKey],
  "yunipals-arena-v2-anime-control.service": [encryptionKey],
  "yunipals-arena-v2-anime-lobby.service": [encryptionKey, "operator.key"],
  "yunipals-arena-v2-anime-media.service": [encryptionKey],
  "yunipals-arena-v2-anime-monitor.service": [encryptionKey],
  "yunipals-arena-v2-anime-referee.service": [encryptionKey],
  "yunipals-arena-v2-anime-settlement.service": [encryptionKey, "referee.key"]
};

function refuse(): never {
  throw new Error(
    "Arena secret files require owner-only permissions or trusted systemd credentials."
  );
}

function sameFile(a: Stats, b: Stats) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

function trustedDirectory(path: string, exactMode?: number) {
  const stat = fs.lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.uid !== 0 ||
    stat.gid !== 0 ||
    (stat.mode & 0o022) !== 0 ||
    (exactMode !== undefined && (stat.mode & 0o7777) !== exactMode)
  )
    refuse();
  return stat;
}

function privateCredentialMount(directory: string, path: string) {
  const decode = (value: string) =>
    value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
      String.fromCharCode(parseInt(octal, 8))
    );
  const mounts = fs
    .readFileSync("/proc/self/mountinfo", "utf8")
    .trim()
    .split("\n")
    .map((line) => ({ line, fields: line.split(" ") }))
    .filter(({ fields }) => {
      const point = decode(fields[4] ?? "");
      return (
        point === directory || path.startsWith(`${point}/`) || point === path
      );
    })
    .sort((a, b) => (b.fields[4]?.length ?? 0) - (a.fields[4]?.length ?? 0));
  const mount = mounts[0];
  if (!mount || decode(mount.fields[4] ?? "") !== directory) refuse();
  if (
    mounts.filter(({ fields }) => decode(fields[4] ?? "") === directory)
      .length !== 1
  )
    refuse();
  const separator = mount.fields.indexOf("-");
  const options = new Set(mount.fields[5]?.split(","));
  if (
    !/^[1-9][0-9]*$/.test(mount.fields[0] ?? "") ||
    separator < 6 ||
    mount.fields[separator + 1] !== "tmpfs" ||
    mount.fields
      .slice(6, separator)
      .some(
        (field) =>
          field !== "unbindable" &&
          !/^(shared|master|propagate_from):[1-9][0-9]*$/.test(field)
      ) ||
    options.has("rw") ||
    ["ro", "nosuid", "nodev", "noexec", "nosymfollow"].some(
      (option) => !options.has(option)
    )
  )
    refuse();
  // Propagation tags do not make this mount writable. A read-only bind mount
  // can also correctly retain "rw" in its superblock options.
  return { id: mount.fields[0]!, line: mount.line };
}

function systemdCredential(path: string, file: Stats) {
  const directory = process.env.CREDENTIALS_DIRECTORY;
  const names =
    directory && Object.hasOwn(unitCredentials, basename(directory))
      ? unitCredentials[basename(directory)]
      : undefined;
  if (
    !directory ||
    directory !== `${credentialRoot}/${basename(directory)}` ||
    normalize(path) !== path ||
    dirname(path) !== directory ||
    !names?.includes(basename(path)) ||
    file.uid !== 0 ||
    file.gid !== 0 ||
    (file.mode & 0o7777) !== 0o440
  )
    refuse();
  trustedDirectory("/run");
  trustedDirectory(credentialRoot);
  return {
    directory,
    stat: trustedDirectory(directory, 0o550),
    mount: privateCredentialMount(directory, path)
  };
}

/** Read secrets through a bound descriptor; only systemd's exact private mount
 * may use its root-owned, ACL-readable 0440 credential format. */
export function readPrivateFile(path: string) {
  const before = fs.lstatSync(path);
  if (!before.isFile()) refuse();
  const loaded =
    (before.mode & 0o077) !== 0 ? systemdCredential(path, before) : undefined;
  const descriptor = fs.openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    if (!sameFile(before, fs.fstatSync(descriptor))) refuse();
    if (loaded) {
      const mountId = fs
        .readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8")
        .match(/^mnt_id:\s*([1-9][0-9]*)$/m)?.[1];
      if (mountId !== loaded.mount.id) refuse();
    }
    const value = fs.readFileSync(descriptor, "utf8");
    if (
      !sameFile(before, fs.fstatSync(descriptor)) ||
      !sameFile(before, fs.lstatSync(path))
    )
      refuse();
    if (loaded) {
      const after = systemdCredential(path, before);
      if (
        !sameFile(loaded.stat, after.stat) ||
        loaded.mount.line !== after.mount.line
      )
        refuse();
    }
    return value.trim();
  } finally {
    fs.closeSync(descriptor);
  }
}
