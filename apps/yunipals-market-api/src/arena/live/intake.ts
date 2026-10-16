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
};
export type StrategySubmission = {
  seat: number;
  text: string;
  salt: Hex;
  signature: Hex;
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
    private readonly verify: ArenaSignatureVerifier
  ) {}

  async ready(db: Queryable = this.pool) {
    const row = (
      await db.query<{ ready: boolean }>(
        `SELECT NOT halted AND finalized_at > now()-interval '3 minutes' AS ready
      FROM yunipals_arena.deployment WHERE id=$1`,
        [this.deployment]
      )
    ).rows[0];
    if (!row?.ready)
      throw new ArenaRequestError(
        503,
        "Tournament synchronization is catching up. Please try again shortly."
      );
  }

  async challenge(wallet: Address) {
    const id = randomUUID();
    const nonce = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 300_000);
    const message = `${new URL(this.origin).host} wants you to sign in with your Ethereum account:\n${wallet}\n\nVerify ownership of this wallet for Yunipals Arena. This costs no gas and does not authorize a payment.\n\nURI: ${this.origin}/arena\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires.toISOString()}\nRequest ID: ${id}\nResources:\n- urn:yunipals:arena:${this.deployment}`;
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
      throw new ArenaRequestError(401, "Confirm wallet ownership to continue.");
    const session = (
      await this.pool.query<{ wallet: Address }>(
        "SELECT wallet FROM yunipals_arena.session WHERE token_hash=$1 AND deployment=$2 AND expires_at>now()",
        [digest(token), this.deployment]
      )
    ).rows[0];
    if (!session)
      throw new ArenaRequestError(
        401,
        "Wallet verification expired. Please retry the action."
      );
    return session.wallet;
  }

  private context(id: string, seat: number) {
    return `${this.deployment}/${id}/seat/${seat}`;
  }
  async state(
    id: string,
    db: Queryable = this.pool,
    lock = false
  ): Promise<ArenaTournament> {
    const result = await db.query<{ state: ArenaTournament }>(
      `SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [this.deployment, id]
    );
    if (!result.rows[0])
      throw new ArenaRequestError(404, "Tournament not found.");
    return result.rows[0].state;
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
    const state = await this.state(id);
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
      const current = await this.state(id, db, true);
      if (
        current.seats[input.seat]?.player.toLowerCase() !== wallet.toLowerCase()
      )
        throw new ArenaRequestError(409, "The tournament seat changed.");
      const existing = (
        await db.query<{ commitment: Hex }>(
          "SELECT commitment FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND seat=$3",
          [this.deployment, id, input.seat]
        )
      ).rows[0];
      if (existing) {
        if (existing.commitment !== commitment)
          throw new ArenaRequestError(
            409,
            "Your first strategy is locked and cannot be replaced."
          );
        return { seat: input.seat, commitment, locked: true };
      }
      if (
        current.phase !== "strategies" ||
        current.deadline * 1000 <= Date.now()
      )
        throw new ArenaRequestError(
          409,
          "The strategy submission deadline has passed."
        );
      const ciphertext = this.cipher.seal(this.context(id, input.seat), {
        text,
        salt: input.salt
      });
      await db.query(
        "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          this.deployment,
          id,
          input.seat,
          wallet.toLowerCase(),
          commitment,
          input.signature,
          ciphertext
        ]
      );
      return { seat: input.seat, commitment, locked: true };
    });
  }

  async ownStrategy(id: string, wallet: Address, seat: number) {
    const state = await this.state(id);
    if (state.seats[seat]?.player.toLowerCase() !== wallet.toLowerCase())
      throw new ArenaRequestError(403, "This seat belongs to another wallet.");
    const row = (
      await this.pool.query<Submission & { created_at: Date }>(
        `SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 AND seat=$3 AND wallet=$4`,
        [this.deployment, id, seat, wallet.toLowerCase()]
      )
    ).rows[0];
    if (!row) return { seat, locked: false as const };
    const value = this.cipher.open<{ text: string; salt: Hex }>(
      this.context(id, seat),
      row.ciphertext
    );
    return {
      seat,
      locked: true as const,
      commitment: row.commitment,
      text: value.text,
      receivedAt: row.created_at.toISOString()
    };
  }

  // Only a confirmed InputFrozen matching this bundle allows the public view to open it.
  async prepareInput(
    id: string,
    build: (
      state: ArenaTournament,
      strategies: NonNullable<ArenaPublicTournament["strategies"]>
    ) => unknown
  ) {
    return transaction(this.pool, async (db) => {
      await this.ready(db);
      const state = await this.state(id, db, true);
      if (
        state.phase !== "strategies" ||
        (state.deadline + ARENA_RESOLUTION_SECONDS) * 1000 <= Date.now()
      )
        throw new ArenaRequestError(409, "Tournament is not ready to freeze.");
      const rows = (
        await db.query<Submission>(
          "SELECT * FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat",
          [this.deployment, id]
        )
      ).rows;
      if (state.seats.length !== 4)
        throw new ArenaRequestError(
          409,
          "The roster and island must be ready."
        );
      const strategies = state.seats.map((seat) => {
        const row = rows.find((r) => r.seat === seat.seat);
        if (row)
          return {
            seat: row.seat,
            commitment: row.commitment,
            signature: row.signature,
            ...this.cipher.open<{ text: string; salt: Hex }>(
              this.context(id, row.seat),
              row.ciphertext
            ),
            source: "player" as const
          };
        if (Date.now() < state.deadline * 1000)
          throw new ArenaRequestError(409, "Waiting for all four strategies.");
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
      const automaticStrategyMask = strategies.reduce(
        (mask, strategy) =>
          mask | (strategy.source === "automatic" ? 1 << strategy.seat : 0),
        0
      );
      const input = build(state, strategies);
      const inputHash = `0x${digest(canonicalJson(input))}` as Hex;
      await db.query(
        "INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [
          this.deployment,
          id,
          inputHash,
          this.cipher.seal(`${this.deployment}/${id}/input`, {
            input,
            strategies
          })
        ]
      );
      const saved = (
        await db.query<{ input_hash: Hex }>(
          "SELECT input_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2",
          [this.deployment, id]
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
        automaticStrategyMask
      };
    });
  }

  async publicView(id: string): Promise<ArenaPublicTournament> {
    // One DB snapshot prevents a reveal/state race between reads.
    return transaction(this.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const state = await this.state(id, db);
      const seats = await db.query<{ seat: number }>(
        "SELECT seat FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat",
        [this.deployment, id]
      );
      const frozen = (
        await db.query<{ ciphertext: string }>(
          "SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=$2 AND revealed_at IS NOT NULL AND input_hash=$3",
          [this.deployment, id, state.inputHash]
        )
      ).rows[0];
      const strategies = frozen
        ? this.cipher.open<{
            strategies: NonNullable<ArenaPublicTournament["strategies"]>;
          }>(`${this.deployment}/${id}/input`, frozen.ciphertext).strategies
        : null;
      const projection = (
        await db.query<{
          cursor: string | null;
          ready: boolean;
          finalized_at: Date | null;
        }>(
          `SELECT cursor::text,NOT halted AND finalized_at>now()-interval '3 minutes' AS ready,finalized_at
         FROM yunipals_arena.deployment WHERE id=$1`,
          [this.deployment]
        )
      ).rows[0];
      return {
        ...state,
        serverTime: Math.floor(Date.now() / 1000),
        projection: {
          throughBlock: projection?.cursor ?? null,
          ready: projection?.ready === true,
          checkedAt: projection?.finalized_at?.toISOString() ?? null
        },
        submittedSeats: seats.rows.map((s) => s.seat),
        strategies
      };
    });
  }
}
