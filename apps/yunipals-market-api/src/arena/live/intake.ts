import {
  arenaEconomics,
  parseAnimeLoadout,
  type AnimeLoadout
} from "@protopals/yunipals-market-core/anime";
import type { FighterSnapshot } from "./identity";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Address, Hex } from "viem";
import {
  arenaDomain,
  ARENA_STRATEGY_TYPES,
  canonicalStrategy,
  strategyCommitment,
  automaticStrategy,
  ARENA_RESOLUTION_SECONDS,
  type ArenaPublicTournament,
  type ArenaTournament
} from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import { digest, StrategyCipher } from "./crypto";
import type {
  NativeArenaSource,
  NativeArenaObservation,
  NativeArenaTournament
} from "./nativeSource";
import { registerTournamentIdentity } from "./tournamentIdentity";
import type { NativeArenaActionObservation } from "./nativeAction";
import {
  assertArenaSourceBinding,
  sourceLeaseKey,
  type ArenaSourceBinding
} from "./sourceSelection";

export class ArenaRequestError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    message: string
  ) {
    super(message);
  }
}
type Queryable = Pick<PoolClient, "query">;
type Submission = {
  seat: number;
  wallet: Address;
  commitment: Hex;
  signature: Hex;
  ciphertext: string;
  loadout: AnimeLoadout | null;
};
export type StrategySubmission = {
  seat: number;
  text: string;
  salt: Hex;
  signature: Hex;
  incarnation?: string;
  loadout?: AnimeLoadout;
};
export type ArenaTournamentContext = {
  state: ArenaTournament;
  incarnation: string;
  cipherContext: string;
  observation:
    | (NativeArenaObservation & { tournament: NativeArenaTournament })
    | null;
};
export type StrategyApproval = {
  domain: ReturnType<typeof arenaDomain>;
  types: typeof ARENA_STRATEGY_TYPES;
  primaryType: "StrategyApproval";
  message: { tournamentId: bigint; seat: number; commitment: Hex };
  address: Address;
  signature: Hex;
};
export type ArenaSignatureVerifier = {
  message(input: {
    address: Address;
    message: string;
    signature: Hex;
  }): Promise<boolean>;
  strategy(input: StrategyApproval): Promise<boolean>;
};

export class ArenaIntake {
  constructor(
    readonly pool: Pool,
    readonly deployment: string,
    readonly contract: Address,
    readonly origin: string,
    private readonly cipher: StrategyCipher,
    private readonly verify: ArenaSignatureVerifier,
    readonly nativeSource?: Pick<NativeArenaSource, "read"> &
      Partial<
        Pick<
          NativeArenaSource,
          "credit" | "list" | "work" | "transaction" | "browse"
        >
      >,
    readonly sourceSelection?: ArenaSourceBinding,
    readonly mediaKind: "video" | "anime" = "video"
  ) {
    if (nativeSource && deployment !== `8453:${contract.toLowerCase()}`)
      throw new Error("Native Arena deployment identity mismatch.");
  }

  get economics() {
    return arenaEconomics(this.mediaKind);
  }

  get indexerMode() {
    return this.nativeSource ? ("unified" as const) : ("legacy" as const);
  }
  async assertSourceSelection(db: Queryable = this.pool) {
    // An operational transaction holds the shared source fence through commit.
    if (db !== this.pool)
      await db.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
        sourceLeaseKey(this.deployment)
      ]);
    const row = (
      await db.query<{ indexer_mode: string }>(
        "SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",
        [this.deployment]
      )
    ).rows[0];
    if (!row || row.indexer_mode !== this.indexerMode)
      throw new ArenaRequestError(503, "Arena source selection is not ready.");
    try {
      await assertArenaSourceBinding(db, this.deployment, this.sourceSelection);
    } catch {
      throw new ArenaRequestError(
        503,
        "Arena source epoch changed. Please try again shortly."
      );
    }
  }

  async ready(db: Queryable = this.pool) {
    await this.assertSourceSelection(db);
    const row = (
      await db.query<{ ready: boolean }>(
        `SELECT NOT halted AND indexer_mode=$2 AND ($2='unified' OR finalized_at > now()-interval '3 minutes') AS ready
      FROM yunipals_arena.deployment WHERE id=$1`,
        [this.deployment, this.indexerMode]
      )
    ).rows[0];
    if (!row?.ready)
      throw new ArenaRequestError(
        503,
        "Tournament synchronization is catching up. Please try again shortly."
      );
    if (this.nativeSource) {
      const observed = await this.nativeSource.read("0");
      if (db !== this.pool)
        await db.query(
          `INSERT INTO yunipals_arena.source_operational_cursor(deployment,indexed_block,source_id)
          VALUES($1,$2,$3) ON CONFLICT(deployment) DO UPDATE SET indexed_block=EXCLUDED.indexed_block,
          source_id=EXCLUDED.source_id,observed_at=now()
          WHERE source_operational_cursor.indexed_block<=EXCLUDED.indexed_block`,
          [this.deployment, observed.indexedThroughBlock, observed.releaseId]
        );
    }
  }

  async challenge(wallet: Address) {
    const id = randomUUID();
    const nonce = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 300_000);
    const message = `${new URL(this.origin).host} wants you to sign in with your Ethereum account:\n${wallet}\n\nSign in to Yunipals Arena. This does not authorize a payment.\n\nURI: ${this.origin}/arena\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires.toISOString()}\nRequest ID: ${id}\nResources:\n- urn:yunipals:arena:${this.deployment}`;
    await this.pool.query(
      "INSERT INTO yunipals_arena.challenge(id,deployment,wallet,message,expires_at) VALUES($1,$2,$3,$4,$5)",
      [id, this.deployment, wallet.toLowerCase(), message, expires]
    );
    return { id, message, expiresAt: expires.toISOString() };
  }

  async authenticate(id: string, signature: Hex) {
    const challenge = (
      await this.pool.query<{ wallet: Address; message: string }>(
        `SELECT wallet,message FROM yunipals_arena.challenge
      WHERE id=$1 AND deployment=$2 AND used_at IS NULL AND expires_at>now()`,
        [id, this.deployment]
      )
    ).rows[0];
    if (
      !challenge ||
      !(await this.verify.message({
        address: challenge.wallet,
        message: challenge.message,
        signature
      }))
    )
      throw new ArenaRequestError(401, "Invalid or expired wallet signature.");
    const token = randomBytes(32).toString("hex");
    await transaction(this.pool, async (db) => {
      const consumed = await db.query(
        "UPDATE yunipals_arena.challenge SET used_at=now() WHERE id=$1 AND deployment=$2 AND used_at IS NULL AND expires_at>now() RETURNING id",
        [id, this.deployment]
      );
      if (!consumed.rowCount)
        throw new ArenaRequestError(
          401,
          "Wallet challenge already used or expired."
        );
      await db.query(
        "INSERT INTO yunipals_arena.session VALUES($1,$2,$3,now()+interval '24 hours')",
        [digest(token), this.deployment, challenge.wallet]
      );
    });
    return { token, wallet: challenge.wallet };
  }

  async wallet(token: string | undefined) {
    if (!token || !/^[0-9a-f]{64}$/.test(token))
      throw new ArenaRequestError(401, "Sign in with your wallet first.");
    const session = (
      await this.pool.query<{ wallet: Address }>(
        "SELECT wallet FROM yunipals_arena.session WHERE token_hash=$1 AND deployment=$2 AND expires_at>now()",
        [digest(token), this.deployment]
      )
    ).rows[0];
    if (!session)
      throw new ArenaRequestError(
        401,
        "Wallet session expired. Please sign in again."
      );
    return session.wallet;
  }

  async tournamentContext(
    id: string,
    db: Queryable = this.pool,
    lock = false,
    expectedIncarnation?: string
  ): Promise<ArenaTournamentContext> {
    await this.assertSourceSelection(db);
    if (this.nativeSource) {
      const observed = await this.nativeSource.read(id),
        t = observed.tournament;
      if (!t) throw new ArenaRequestError(404, "Tournament not found.");
      if (
        t.deployment !== this.deployment ||
        t.id !== id ||
        t.state.id !== id ||
        (expectedIncarnation && expectedIncarnation !== t.incarnation)
      )
        throw new ArenaRequestError(
          409,
          "The tournament opening changed. Refresh before trying again."
        );
      const observation = { ...observed, tournament: t };
      const stored = lock
        ? await registerTournamentIdentity(db, observation)
        : (
            await db.query<{ cipher_context: string }>(
              "SELECT cipher_context FROM yunipals_arena.tournament_identity WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
              [this.deployment, id, t.incarnation]
            )
          ).rows[0];
      return {
        state: t.state,
        incarnation: t.incarnation,
        cipherContext:
          stored?.cipher_context ?? `${this.deployment}/${id}/${t.incarnation}`,
        observation
      };
    }
    const result = await db.query<{ state: ArenaTournament }>(
      `SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [this.deployment, id]
    );
    if (!result.rows[0])
      throw new ArenaRequestError(404, "Tournament not found.");
    return {
      state: result.rows[0].state,
      incarnation: "legacy",
      cipherContext: `${this.deployment}/${id}`,
      observation: null
    };
  }
  async state(
    id: string,
    db: Queryable = this.pool,
    lock = false
  ): Promise<ArenaTournament> {
    return (await this.tournamentContext(id, db, lock)).state;
  }
  async balance(wallet: string) {
    await this.assertSourceSelection();
    if (this.nativeSource) {
      if (!this.nativeSource.credit)
        throw new ArenaRequestError(
          503,
          "Arena balance indexing is not ready."
        );
      return (await this.nativeSource.credit(wallet)).amount;
    }
    return (
      (
        await this.pool.query<{ amount: string }>(
          "SELECT amount FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
          [this.deployment, wallet.toLowerCase()]
        )
      ).rows[0]?.amount ?? "0"
    );
  }
  async listIds(wallet?: string) {
    await this.assertSourceSelection();
    if (this.nativeSource) {
      if (!this.nativeSource.list)
        throw new ArenaRequestError(
          503,
          "Arena tournament indexing is not ready."
        );
      return (await this.nativeSource.list(wallet)).ids;
    }
    return (
      await this.pool.query<{ id: string }>(
        `SELECT id::text FROM yunipals_arena.tournament WHERE deployment=$1
      ${wallet ? "AND (state->>'islandBeneficiary'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$2))" : ""}
      ORDER BY id DESC LIMIT 30`,
        wallet ? [this.deployment, wallet.toLowerCase()] : [this.deployment]
      )
    ).rows.map((row) => row.id);
  }

  private async strategyLoadout(
    db: Queryable,
    id: string,
    context: ArenaTournamentContext,
    seatIndex: number,
    value?: unknown
  ) {
    if (this.mediaKind !== "anime") {
      if (value !== undefined)
        throw new ArenaRequestError(
          400,
          "Attack loadouts are available in Anime Arena."
        );
      return undefined;
    }
    const seat = context.state.seats[seatIndex]!;
    const row = (
      await db.query<{ snapshot: FighterSnapshot; snapshot_hash: string }>(
        "SELECT snapshot,snapshot_hash FROM yunipals_arena.fighter_snapshot WHERE deployment=$1 AND tournament_id=$2 AND nft_chain_id=$3 AND collection=$4 AND token_id=$5 AND incarnation=$6",
        [
          this.deployment,
          id,
          seat.nftChainId,
          seat.collection.toLowerCase(),
          seat.tokenId,
          context.incarnation
        ]
      )
    ).rows[0];
    if (!row || digest(canonicalJson(row.snapshot)) !== row.snapshot_hash)
      throw new ArenaRequestError(
        409,
        "Fighter art needs to be prepared before choosing a loadout."
      );
    try {
      return parseAnimeLoadout(
        {
          kits: row.snapshot.animeKits,
          defaultLoadout: row.snapshot.animeDefaultLoadout
        },
        value
      );
    } catch {
      throw new ArenaRequestError(
        400,
        "Choose two different kits from this fighter."
      );
    }
  }

  async submit(id: string, wallet: Address, input: StrategySubmission) {
    let text: string;
    let commitment: Hex;
    try {
      text = canonicalStrategy(input.text);
      commitment = strategyCommitment(
        this.contract,
        BigInt(id),
        input.seat,
        text,
        input.salt
      );
    } catch {
      throw new ArenaRequestError(
        400,
        "Provide a non-empty strategy within the character limit and a 32-byte salt."
      );
    }
    const prior = await this.tournamentContext(id),
      state = prior.state;
    if (
      this.nativeSource &&
      input.incarnation !== undefined &&
      input.incarnation !== prior.incarnation
    )
      throw new ArenaRequestError(
        409,
        "The tournament opening changed. Refresh before trying again."
      );
    const seat = state.seats[input.seat];
    if (!seat || seat.player.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(403, "This seat belongs to another wallet.");
    const valid = await this.verify.strategy({
      address: wallet,
      domain: arenaDomain(this.contract),
      types: ARENA_STRATEGY_TYPES,
      primaryType: "StrategyApproval",
      message: { tournamentId: BigInt(id), seat: input.seat, commitment },
      signature: input.signature
    });
    if (!valid)
      throw new ArenaRequestError(
        401,
        "The strategy signature does not match its text and seat."
      );
    return transaction(this.pool, async (db) => {
      await this.ready(db);
      const context = await this.tournamentContext(
          id,
          db,
          true,
          prior.incarnation
        ),
        current = context.state;
      if (
        current.seats[input.seat]?.player.toLowerCase() !== wallet.toLowerCase()
      )
        throw new ArenaRequestError(409, "The tournament seat changed.");
      const loadout = await this.strategyLoadout(
        db,
        id,
        context,
        input.seat,
        input.loadout
      );
      const existing = (
        await db.query<{
          commitment: Hex;
          wallet: string;
          loadout: AnimeLoadout | null;
        }>(
          "SELECT commitment,wallet,loadout FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND seat=$3 AND incarnation=$4",
          [this.deployment, id, input.seat, context.incarnation]
        )
      ).rows[0];
      if (existing) {
        if (existing.wallet.toLowerCase() !== wallet.toLowerCase())
          throw new ArenaRequestError(
            409,
            "This seat changed and needs reconciliation."
          );
        if (existing.commitment !== commitment)
          throw new ArenaRequestError(
            409,
            "Your first strategy is locked and cannot be replaced."
          );
        if (canonicalJson(existing.loadout) !== canonicalJson(loadout ?? null))
          throw new ArenaRequestError(
            409,
            "Your first strategy and loadout are already locked."
          );
        return {
          seat: input.seat,
          commitment,
          locked: true,
          ...(loadout ? { loadout } : {})
        };
      }
      if (
        this.nativeSource &&
        (
          await db.query(
            `SELECT 1 FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2
        AND seat=$3 AND incarnation<>$4 AND wallet=$5 AND (signature=$6 OR commitment=$7) LIMIT 1`,
            [
              this.deployment,
              id,
              input.seat,
              context.incarnation,
              wallet.toLowerCase(),
              input.signature,
              commitment
            ]
          )
        ).rowCount
      )
        throw new ArenaRequestError(
          409,
          "Sign a fresh strategy for this tournament opening."
        );
      if (
        current.phase !== "strategies" ||
        current.deadline * 1000 <= Date.now()
      )
        throw new ArenaRequestError(
          409,
          "The strategy submission deadline has passed."
        );
      const ciphertext = this.cipher.seal(
        `${context.cipherContext}/seat/${input.seat}`,
        {
          text,
          salt: input.salt
        }
      );
      await db.query(
        "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation,loadout) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          this.deployment,
          id,
          input.seat,
          wallet.toLowerCase(),
          commitment,
          input.signature,
          ciphertext,
          context.incarnation,
          loadout ? JSON.stringify(loadout) : null
        ]
      );
      return {
        seat: input.seat,
        commitment,
        locked: true,
        ...(loadout ? { loadout } : {})
      };
    });
  }

  async ownStrategy(id: string, wallet: Address, seat: number) {
    await this.ready();
    const context = await this.tournamentContext(id);
    if (
      context.state.seats[seat]?.player.toLowerCase() !== wallet.toLowerCase()
    )
      throw new ArenaRequestError(403, "This seat belongs to another wallet.");
    const row = (
      await this.pool.query<Submission & { created_at: Date }>(
        `SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2
        AND seat=$3 AND wallet=$4 AND incarnation=$5`,
        [this.deployment, id, seat, wallet.toLowerCase(), context.incarnation]
      )
    ).rows[0];
    if (!row) return { seat, locked: false as const };
    const value = this.cipher.open<{ text: string; salt: Hex }>(
      `${context.cipherContext}/seat/${seat}`,
      row.ciphertext
    );
    const current = await this.tournamentContext(id);
    if (
      current.incarnation !== context.incarnation ||
      current.state.seats[seat]?.player.toLowerCase() !== wallet.toLowerCase()
    )
      throw new ArenaRequestError(
        409,
        "The tournament opening changed. Refresh before trying again."
      );
    return {
      seat,
      locked: true as const,
      commitment: row.commitment,
      text: value.text,
      receivedAt: row.created_at.toISOString(),
      ...(row.loadout ? { loadout: row.loadout } : {})
    };
  }

  // Only a confirmed InputFrozen matching this bundle allows the public view to open it.
  async prepareInput(
    id: string,
    build: (
      state: ArenaTournament,
      strategies: NonNullable<ArenaPublicTournament["strategies"]>
    ) => unknown,
    expectedIncarnation?: string
  ) {
    return transaction(this.pool, async (db) => {
      await this.ready(db);
      const context = await this.tournamentContext(
          id,
          db,
          true,
          expectedIncarnation
        ),
        state = context.state;
      if (
        state.phase !== "strategies" ||
        (state.deadline + ARENA_RESOLUTION_SECONDS) * 1000 <= Date.now()
      )
        throw new ArenaRequestError(409, "Tournament is not ready to freeze.");
      const rows = (
        await db.query<Submission>(
          "SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 ORDER BY seat",
          [this.deployment, id, context.incarnation]
        )
      ).rows;
      if (state.seats.length !== 4)
        throw new ArenaRequestError(
          409,
          "The roster and island must be ready."
        );
      const strategies: NonNullable<ArenaPublicTournament["strategies"]> =
        state.seats.map((seat) => {
          const row = rows.find((r) => r.seat === seat.seat);
          if (row && row.wallet.toLowerCase() !== seat.player.toLowerCase())
            throw new ArenaRequestError(
              409,
              "The roster changed and needs reconciliation."
            );
          if (row)
            return {
              seat: row.seat,
              commitment: row.commitment,
              signature: row.signature,
              ...this.cipher.open<{ text: string; salt: Hex }>(
                `${context.cipherContext}/seat/${row.seat}`,
                row.ciphertext
              ),
              source: "player" as const,
              ...(row.loadout ? { loadout: row.loadout } : {})
            };
          if (Date.now() < state.deadline * 1000)
            throw new ArenaRequestError(
              409,
              "Waiting for all four strategies."
            );
          if (state.randomWord === null)
            throw new ArenaRequestError(409, "The island draw is not ready.");
          return automaticStrategy(
            this.contract,
            BigInt(id),
            seat.seat,
            state.rulesHash,
            BigInt(state.randomWord!)
          );
        });
      if (this.mediaKind === "anime")
        for (const strategy of strategies) {
          const chosen = await this.strategyLoadout(
            db,
            id,
            context,
            strategy.seat,
            strategy.loadout
          );
          if (chosen) strategy.loadout = chosen;
        }
      const automaticStrategyMask = strategies.reduce(
        (mask, strategy) =>
          mask | (strategy.source === "automatic" ? 1 << strategy.seat : 0),
        0
      );
      const input = build(state, strategies);
      const inputHash = `0x${digest(canonicalJson(input))}` as Hex;
      await db.query(
        "INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext,incarnation) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          this.deployment,
          id,
          inputHash,
          this.cipher.seal(`${context.cipherContext}/input`, {
            input,
            strategies
          }),
          context.incarnation
        ]
      );
      const saved = (
        await db.query<{ input_hash: Hex }>(
          "SELECT input_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
          [this.deployment, id, context.incarnation]
        )
      ).rows[0]!;
      if (saved.input_hash !== inputHash)
        throw new ArenaRequestError(
          409,
          "Prepared tournament input is immutable."
        );
      return {
        inputHash,
        commitments: strategies.map((s) => s.commitment),
        signatures: strategies.map((s) => s.signature),
        automaticStrategyMask,
        ...(this.nativeSource
          ? { incarnation: context.incarnation as Hex }
          : {})
      };
    });
  }

  /** Private InputFrozen handling is application work. The native reader
   * supplies public evidence; the caller supplies bounded canonical RPC checks.
   */
  async reconcileInputFrozen(
    id: string,
    verifyAction: (observed: NativeArenaActionObservation) => Promise<void>
  ) {
    if (!this.nativeSource)
      throw new Error("Native Arena disclosure requires its selected source.");
    await this.ready();
    const initial = await this.tournamentContext(id),
      observed = initial.observation!;
    const freeze = observed.tournament.inputFrozen;
    if (
      !freeze ||
      !["resolving", "settled"].includes(initial.state.phase) ||
      !initial.state.inputHash
    )
      return false;
    if (
      (
        await this.pool.query(
          `SELECT 1 FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2
      AND incarnation=$3 AND input_hash=$4 AND revealed_at IS NOT NULL AND revealed_event_id=$5 AND revealed_block_hash=$6`,
          [
            this.deployment,
            id,
            initial.incarnation,
            initial.state.inputHash,
            freeze.id,
            freeze.blockHash
          ]
        )
      ).rowCount
    )
      return true;
    // No operational transaction spans external point reads.
    await verifyAction(observed);
    return transaction(this.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await this.ready(db);
      const current = await this.tournamentContext(
          id,
          db,
          true,
          initial.incarnation
        ),
        state = current.state;
      const proof = current.observation!.tournament.inputFrozen;
      if (
        !proof ||
        proof.id !== freeze.id ||
        proof.blockHash !== freeze.blockHash ||
        state.inputHash !== initial.state.inputHash ||
        !["resolving", "settled"].includes(state.phase) ||
        canonicalJson(state.seats) !== canonicalJson(initial.state.seats) ||
        canonicalJson(state.commitments) !==
          canonicalJson(initial.state.commitments)
      )
        throw new ArenaRequestError(
          409,
          "The canonical frozen input changed during verification."
        );
      const saved = (
        await db.query<{ ciphertext: string }>(
          `SELECT ciphertext FROM yunipals_arena.frozen_input
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$4 FOR UPDATE`,
          [this.deployment, id, current.incarnation, state.inputHash]
        )
      ).rows[0];
      if (!saved || state.seats.length !== 4 || !state.commitments)
        return false;
      const submissions = (
        await db.query<Submission>(
          "SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
          [this.deployment, id, current.incarnation]
        )
      ).rows;
      const mask = state.automaticStrategyMask ?? 0;
      const matches = state.seats.every((seat) => {
        const row = submissions.find((row) => row.seat === seat.seat);
        if (!(mask & (1 << seat.seat)))
          return (
            row?.wallet.toLowerCase() === seat.player.toLowerCase() &&
            row?.commitment === state.commitments![seat.seat]
          );
        return (
          !row &&
          state.randomWord !== null &&
          automaticStrategy(
            this.contract,
            BigInt(id),
            seat.seat,
            state.rulesHash,
            BigInt(state.randomWord)
          ).commitment === state.commitments![seat.seat]
        );
      });
      if (!matches) return false;
      const bundle = this.cipher.open<{
        input: unknown;
        strategies: NonNullable<ArenaPublicTournament["strategies"]>;
      }>(`${current.cipherContext}/input`, saved.ciphertext);
      if (
        `0x${digest(canonicalJson(bundle.input))}` !== state.inputHash ||
        !Array.isArray(bundle.strategies) ||
        bundle.strategies.length !== 4 ||
        !bundle.strategies.every((strategy, seat) => {
          if (
            strategy.seat !== seat ||
            strategy.commitment !== state.commitments![seat]
          )
            return false;
          if (mask & (1 << seat)) {
            if (state.randomWord === null) return false;
            const automatic = automaticStrategy(
              this.contract,
              BigInt(id),
              seat,
              state.rulesHash,
              BigInt(state.randomWord)
            );
            return (
              strategy.source === "automatic" &&
              strategy.text === automatic.text &&
              strategy.salt === automatic.salt &&
              strategy.signature === automatic.signature
            );
          }
          return (
            strategy.source !== "automatic" &&
            strategyCommitment(
              this.contract,
              BigInt(id),
              seat,
              strategy.text,
              strategy.salt
            ) === strategy.commitment
          );
        })
      )
        throw new Error("Prepared Arena input and commitments disagree.");
      await db.query(
        `UPDATE yunipals_arena.frozen_input SET revealed_at=COALESCE(revealed_at,now()),revealed_event_id=$5,revealed_block_hash=$6
        WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND input_hash=$4`,
        [
          this.deployment,
          id,
          current.incarnation,
          state.inputHash,
          proof.id,
          proof.blockHash
        ]
      );
      return true;
    });
  }

  async publicView(id: string): Promise<ArenaPublicTournament> {
    // One DB snapshot prevents a reveal/state race between reads.
    const view = await transaction(this.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const context = await this.tournamentContext(id, db),
        state = context.state;
      const seats = await db.query<{ seat: number; wallet: string }>(
        "SELECT seat,wallet FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 ORDER BY seat",
        [this.deployment, id, context.incarnation]
      );
      const frozen = (
        await db.query<{ ciphertext: string }>(
          `SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2 AND revealed_at IS NOT NULL AND input_hash=$3
            AND incarnation=$4 ${this.nativeSource ? "AND revealed_event_id=$5 AND revealed_block_hash=$6" : ""}`,
          [
            this.deployment,
            id,
            state.inputHash,
            context.incarnation,
            ...(this.nativeSource
              ? [
                  context.observation?.tournament.inputFrozen?.id ?? null,
                  context.observation?.tournament.inputFrozen?.blockHash ?? null
                ]
              : [])
          ]
        )
      ).rows[0];
      const strategies = frozen
        ? this.cipher.open<{
            strategies: NonNullable<ArenaPublicTournament["strategies"]>;
          }>(`${context.cipherContext}/input`, frozen.ciphertext).strategies
        : null;
      return {
        ...state,
        submittedSeats: seats.rows
          .filter(
            (s) =>
              state.seats[s.seat]?.player.toLowerCase() ===
              s.wallet.toLowerCase()
          )
          .map((s) => s.seat),
        strategies,
        ...(this.nativeSource
          ? { incarnation: context.incarnation as Hex }
          : {})
      };
    });
    // The RR snapshot may have been captured before waiting for its source
    // lease. Validate the selected epoch again after that snapshot commits.
    await this.assertSourceSelection();
    return view;
  }
}
