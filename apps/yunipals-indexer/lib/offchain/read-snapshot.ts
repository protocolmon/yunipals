import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

type Proof = { fingerprint: string };
type Snapshot = {
  pool: Pool;
  client?: PoolClient;
  opening?: Promise<PoolClient>;
  proof?: Proof;
  queue: Promise<void>;
  failed: boolean;
  savepoint: number;
  validate: (client: PoolClient) => Promise<Proof>;
};
const storage = new AsyncLocalStorage<Snapshot>();
const originals = new WeakMap<Pool, Pool>();
const original = (pool: Pool) => originals.get(pool) ?? pool;

async function open(snapshot: Snapshot) {
  return (snapshot.opening ??= (async () => {
    const client = await snapshot.pool.connect();
    snapshot.client = client;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    snapshot.proof = await snapshot.validate(client);
    return client;
  })());
}
function submit<T>(
  snapshot: Snapshot,
  task: (client: PoolClient) => Promise<T>
) {
  const pending = snapshot.queue.then(async () => task(await open(snapshot)));
  snapshot.queue = pending.then(
    () => undefined,
    () => {
      snapshot.failed = true;
    }
  );
  return pending;
}

/** Existing promise-based API readers use this pool without changing workers. */
export function requestSnapshotPool(pool: Pool): Pool {
  if (originals.has(pool)) return pool;
  const wrapped = new Proxy(pool, {
    get(target, key) {
      if (key === "query")
        return (...args: unknown[]) => {
          const snapshot = storage.getStore();
          if (!snapshot || snapshot.pool !== pool)
            return Reflect.apply(target.query, target, args);
          if (typeof args.at(-1) === "function")
            throw new Error("Request snapshots require promise queries.");
          return submit(snapshot, (client) =>
            Reflect.apply(client.query, client, args)
          );
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  originals.set(wrapped, pool);
  return wrapped;
}

/** Opening is lazy: parsing and ENS resolution happen before a database lease. */
export async function withOwnershipRequest<T>(
  pool: Pool,
  validate: Snapshot["validate"],
  task: () => Promise<T>
): Promise<T> {
  const snapshot: Snapshot = {
    pool: original(pool),
    validate,
    queue: Promise.resolve(),
    failed: false,
    savepoint: 0
  };
  let succeeded = false;
  try {
    const result = await storage.run(snapshot, task);
    succeeded = true;
    return result;
  } finally {
    await snapshot.queue;
    if (snapshot.client) {
      const client = snapshot.client;
      let discard = false;
      try {
        await client.query(
          succeeded && !snapshot.failed ? "COMMIT" : "ROLLBACK"
        );
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        client.release(discard);
      }
    }
  }
}

export function ownershipRequestFingerprint() {
  return storage.getStore()?.proof?.fingerprint ?? null;
}

/** Callbacks use only the provided client. Local planner settings are scoped
 * to a savepoint so count settings cannot leak into later point enrichment. */
export async function apiReadTransaction<T>(
  pool: Pick<Pool, "connect">,
  task: (client: PoolClient) => Promise<T>
): Promise<T> {
  const snapshot = storage.getStore();
  if (snapshot && snapshot.pool === original(pool as Pool)) {
    return submit(snapshot, async (client) => {
      const savepoint = `api_read_${++snapshot.savepoint}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        return await task(client);
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
    });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** General read-only request snapshot for adapters without an ownership-policy proof. */
export function withDatabaseReadSnapshot<T>(
  pool: Pool,
  task: () => Promise<T>
): Promise<T> {
  return withOwnershipRequest(
    pool,
    async () => ({ fingerprint: "database-snapshot" }),
    task
  );
}
