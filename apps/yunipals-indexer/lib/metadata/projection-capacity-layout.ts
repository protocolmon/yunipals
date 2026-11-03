import { readdir, readFile, realpath, stat, statfs } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { PoolClient } from "pg";

export type StorageCharge = { name: string; path: string; bytes: number };
export type StorageObservation = { device: number; freeBytes: number };
export type FilesystemBudget = StorageObservation & {
  paths: string[];
  requiredBytes: number;
  charges: Array<{ name: string; bytes: number }>;
};

/** Existing WAL files already occupy disk space and can be recycled. Charge
 * the remaining growth to the same 150% peak, rather than reserving that peak
 * again on top of it. Retained slots keep their additional allowance. */
export function remainingWalHeadroom(
  maximum: number,
  retained: number,
  allocated: number
) {
  if (
    [maximum, retained, allocated].some(
      (value) => !Number.isSafeInteger(value) || value < 0
    ) ||
    !Number.isSafeInteger(Math.ceil(maximum * 1.5) + retained)
  )
    throw new Error("Invalid WAL storage observation");
  return Math.max(0, Math.ceil(maximum * 1.5) + retained - allocated);
}

async function allocatedWalBytes(directory: string) {
  let allocated = 0;
  const device = (await stat(directory)).dev;
  for (const name of await readdir(directory)) {
    if (!/^[0-9A-F]{24}(?:\.partial)?$/.test(name)) continue;
    try {
      const file = await stat(join(directory, name));
      if (!file.isFile() || file.dev !== device)
        throw new Error("Unexpected WAL segment storage");
      allocated += file.blocks * 512;
    } catch (error) {
      // Checkpoints can remove a segment during this bounded observation.
      // A missing file receives no reusable-space credit.
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
    }
  }
  return allocated;
}

/** Charge each real filesystem once for its free-space reserve. Multiple
 * components on the same device share a budget rather than borrowing space
 * from another disk or counting the same free bytes more than once. */
export async function verifyFilesystemBudgets(
  charges: StorageCharge[],
  reserve: number,
  observe: (path: string) => Promise<StorageObservation> = async (path) => {
    const [file, disk] = await Promise.all([stat(path), statfs(path)]);
    return {
      device: file.dev,
      freeBytes: Number(disk.bavail) * Number(disk.bsize)
    };
  }
): Promise<FilesystemBudget[]> {
  const budgets = new Map<number, FilesystemBudget>();
  if (!Number.isSafeInteger(reserve) || reserve < 0)
    throw new Error("Invalid storage reserve");
  for (const charge of charges) {
    if (
      !isAbsolute(charge.path) ||
      !Number.isSafeInteger(charge.bytes) ||
      charge.bytes < 0
    )
      throw new Error("Invalid filesystem charge");
    const observed = await observe(charge.path);
    const budget = budgets.get(observed.device) ?? {
      ...observed,
      paths: [],
      requiredBytes: reserve,
      charges: []
    };
    budget.freeBytes = Math.min(budget.freeBytes, observed.freeBytes);
    budget.requiredBytes += charge.bytes;
    if (!budget.paths.includes(charge.path)) budget.paths.push(charge.path);
    budget.charges.push({ name: charge.name, bytes: charge.bytes });
    budgets.set(observed.device, budget);
  }
  for (const budget of budgets.values())
    if (budget.freeBytes < budget.requiredBytes)
      throw new Error(
        `projection_capacity_insufficient: device=${budget.device} free=${budget.freeBytes} required=${budget.requiredBytes}`
      );
  return [...budgets.values()];
}

export async function assertRoutedProjectionCapacity(
  client: Pick<PoolClient, "query">,
  input: {
    layoutFile: string;
    reserveBytes: number;
    backupPeakBytes: number;
    generationBytes: number;
    snapshotBytes: number;
    phase: "generation" | "leaderboard";
  }
) {
  if (!isAbsolute(input.layoutFile))
    throw new Error("Absolute storage layout required");
  const owner = await stat(input.layoutFile);
  if (
    !owner.isFile() ||
    owner.mode & 0o022 ||
    (owner.uid !== 0 && owner.uid !== process.getuid?.())
  )
    throw new Error("Protected storage layout required");
  const layout = JSON.parse(await readFile(input.layoutFile, "utf8"));
  if (
    Object.keys(layout).sort().join() !==
      [
        "format",
        "tablespace",
        "directory",
        "databaseDirectory",
        "backupDirectories"
      ]
        .sort()
        .join() ||
    layout.format !== "yunipals-projection-storage-v1" ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(layout.tablespace) ||
    typeof layout.directory !== "string" ||
    !isAbsolute(layout.directory) ||
    typeof layout.databaseDirectory !== "string" ||
    !isAbsolute(layout.databaseDirectory) ||
    !Array.isArray(layout.backupDirectories) ||
    !layout.backupDirectories.length ||
    layout.backupDirectories.length > 16 ||
    new Set(layout.backupDirectories).size !==
      layout.backupDirectories.length ||
    layout.backupDirectories.some(
      (path: unknown) =>
        typeof path !== "string" || !isAbsolute(path) || path === "/"
    )
  )
    throw new Error("Invalid projection storage layout");
  const settings = (
    await client.query<{
      port: string;
      started: string;
      temporary: string;
      wal_bytes: string;
      retained_bytes: string;
      archive_mode: string;
    }>(`SELECT current_setting('port') AS port,
    floor(extract(epoch FROM pg_postmaster_start_time()))::text AS started,
    current_setting('temp_tablespaces') AS temporary,
    pg_size_bytes(current_setting('max_wal_size'))::text AS wal_bytes,
    current_setting('archive_mode') AS archive_mode,
    COALESCE((SELECT max(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn))
      FROM pg_replication_slots WHERE restart_lsn IS NOT NULL),0)::text AS retained_bytes`)
  ).rows[0]!;
  // The restricted database writer cannot SHOW data_directory. Bind the
  // operator's protected path to the actual postmaster's directory, port and
  // start time instead of granting server-wide settings access.
  const postmaster = (
    await readFile(join(layout.databaseDirectory, "postmaster.pid"), "utf8")
  ).split("\n");
  if (
    postmaster[1] !== (await realpath(layout.databaseDirectory)) ||
    postmaster[2] !== settings.started ||
    postmaster[3] !== settings.port
  )
    throw new Error("Projection database directory belongs to another server");
  const tablespace = (
    await client.query<{ path: string; can_create: boolean }>(
      `SELECT pg_tablespace_location(oid) AS path,
      has_tablespace_privilege(current_user,oid,'CREATE') AS can_create
      FROM pg_tablespace WHERE spcname=$1`,
      [layout.tablespace]
    )
  ).rows[0];
  if (!tablespace) throw new Error("Projection tablespace is absent");
  if (
    (await realpath(tablespace.path)) !== (await realpath(layout.directory)) ||
    settings.temporary !== layout.tablespace ||
    settings.archive_mode !== "off"
  )
    throw new Error(
      "Projection storage routing differs from the reviewed layout"
    );
  const derivedDevice = (await stat(layout.directory)).dev;
  const parents = [
    "search",
    "trait",
    "revision",
    "facet",
    "facet_status",
    "read_member",
    "read_set",
    "generation",
    "active"
  ].map((table) => `metadata_projection.${table}`);
  const paths = (
    await client.query<{ file: string }>(
      `WITH parents AS (
      SELECT oid,reltoastrelid FROM pg_class WHERE oid=ANY($1::regclass[])),
    tables AS (SELECT oid FROM parents UNION SELECT reltoastrelid FROM parents WHERE reltoastrelid<>0),
    relations AS(SELECT oid FROM tables UNION SELECT indexrelid FROM pg_index WHERE indrelid IN(SELECT oid FROM tables))
    SELECT pg_relation_filepath(oid) AS file FROM relations`,
      [parents]
    )
  ).rows;
  if (paths.length < parents.length)
    throw new Error("Projection relation storage is incomplete");
  for (const path of paths)
    if (
      !path.file ||
      (await stat(join(layout.databaseDirectory, path.file))).dev !==
        derivedDevice
    )
      throw new Error(
        "Projection table or index uses an unreviewed filesystem"
      );
  const walDirectory = join(layout.databaseDirectory, "pg_wal");
  const walHeadroom = remainingWalHeadroom(
    Number(settings.wal_bytes),
    Number(settings.retained_bytes),
    await allocatedWalBytes(walDirectory)
  );
  const charges: StorageCharge[] = [
    {
      name: "database WAL headroom",
      path: walDirectory,
      bytes: walHeadroom
    }
  ];
  const destination =
    input.phase === "generation"
      ? layout.directory
      : join(
          layout.databaseDirectory,
          (
            await client.query<{ file: string }>(
              "SELECT pg_relation_filepath('leaderboard.wallet_stats') AS file"
            )
          ).rows[0]!.file
        );
  charges.push({
    name: input.phase,
    path: destination,
    bytes: input.generationBytes
  });
  charges.push({
    name: "temporary snapshot",
    path: layout.directory,
    bytes: input.snapshotBytes
  });
  if (input.phase === "generation") {
    const cacheBytes = Number(
      (
        await client.query<{ bytes: string }>(
          "SELECT pg_total_relation_size('metadata_projection.read_member')::text AS bytes"
        )
      ).rows[0]!.bytes
    );
    charges.push({
      name: "replacement read cache headroom",
      path: layout.directory,
      bytes: Math.ceil(cacheBytes * 1.5)
    });
  }
  const backupDevices = new Set<number>();
  for (const path of layout.backupDirectories as string[]) {
    const info = await stat(path);
    if (!info.isDirectory())
      throw new Error("Backup workspace directory required");
    if (!backupDevices.has(info.dev)) {
      charges.push({
        name: "backup workspace reserve",
        path,
        bytes: input.backupPeakBytes
      });
      backupDevices.add(info.dev);
    }
  }
  const budgets = await verifyFilesystemBudgets(charges, input.reserveBytes);
  if (!tablespace.can_create) {
    // Report the read-only placement calculation while still refusing the
    // build: PostgreSQL would otherwise silently ignore this temp tablespace.
    console.info("Projection budget diagnostic", {
      budgets,
      temporaryPermission: false
    });
    throw new Error("projection_temp_tablespace_permission_missing");
  }
  return budgets;
}
