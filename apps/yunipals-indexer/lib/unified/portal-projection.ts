import type { PortalLedgerEvent } from "../portals/ledger-store.js";
import { portalStateKey } from "../portals/ledger-application.js";

export interface PortalRows {
  token: {
    token_id: string;
    owner: string;
    kind_id: string | null;
    retired: boolean;
    earned: string;
    claimed: string;
    balance: string;
    claimant: string | null;
  };
  request: {
    request_id: string;
    token_id: string;
    submitter: string;
    portal_id: string;
    input_version: string;
    commitment: string;
    requested_block: string;
    completed_version: string | null;
    artwork_hash: string | null;
    report_hash: string | null;
    scores: number[] | null;
  };
  mint: {
    source: string;
    request_id: string;
    kind_id: string;
    quantity: number;
    delivered: number;
  };
  state: {
    source: string;
    component: string;
    entity_id: string;
    value: Record<string, string>;
    block_number: string;
    log_index: number;
  };
  entry: {
    entry_id: string;
    batch_id: string;
    request_id: string;
    submitter: string;
    amount: string;
    score: number | null;
  };
  batch: {
    batch_id: string;
    funded: number;
    completed: number;
    pool: string;
    ready: boolean;
    winners: string[] | null;
    leaders: string[];
  };
  prize: { batch_id: string; rank: number; winner: string; amount: string };
}
export type PortalDomain = keyof PortalRows;
export interface PortalProjectionStore {
  get<K extends PortalDomain>(
    domain: K,
    key: string
  ): Promise<PortalRows[K] | null>;
  put<K extends PortalDomain>(
    domain: K,
    key: string,
    value: PortalRows[K]
  ): Promise<void>;
}
function requireState(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Portal projection: ${message}.`);
}
function uint(value: string) {
  requireState(/^(0|[1-9][0-9]*)$/.test(value), "invalid integer");
  return BigInt(value);
}
export async function applySharedPortalEvent(
  store: PortalProjectionStore,
  event: PortalLedgerEvent,
  rules: { batchSize: bigint; contribution: bigint }
) {
  const a = event.args;
  const stateKey = portalStateKey(event);
  if (stateKey)
    await store.put("state", `${event.source}:${stateKey.join(":")}`, {
      source: event.source,
      component: stateKey[0],
      entity_id: stateKey[1],
      value: a,
      block_number: event.block,
      log_index: event.logIndex
    });
  if (event.type === "GradingRequested") {
    requireState(
      !(await store.get("request", a.requestId)),
      "duplicate grading request"
    );
    await store.put("request", a.requestId, {
      request_id: a.requestId,
      token_id: a.tokenId,
      submitter: a.submitter.toLowerCase(),
      portal_id: a.portalId,
      input_version: a.inputVersion,
      commitment: a.spellCommitment,
      requested_block: event.block,
      completed_version: null,
      artwork_hash: null,
      report_hash: null,
      scores: null
    });
  } else if (event.type === "GradingCompleted") {
    const row = await store.get("request", a.requestId);
    const scores = a.scores.split(",").map(Number);
    requireState(
      row &&
        row.token_id === a.tokenId &&
        row.completed_version === null &&
        uint(row.input_version) + 1n === uint(a.version),
      "grade does not match request"
    );
    requireState(
      scores.length === 4 &&
        scores.every((v) => Number.isInteger(v) && v >= 1 && v <= 100),
      "invalid grades"
    );
    await store.put("request", a.requestId, {
      ...row,
      completed_version: a.version,
      artwork_hash: a.artworkHash,
      report_hash: a.reportHash,
      scores
    });
  } else if (event.type === "MintCommitted") {
    const key = `${event.source}:${a.requestId}`;
    requireState(
      !(await store.get("mint", key)) &&
        uint(a.quantity) > 0n &&
        uint(a.quantity) <= 100n,
      "invalid mint commitment"
    );
    await store.put("mint", key, {
      source: event.source,
      request_id: a.requestId,
      kind_id: a.kindId,
      quantity: Number(a.quantity),
      delivered: 0
    });
  } else if (event.type === "PortalMinted") {
    const key = `${event.source}:${a.requestId}`;
    const mint = await store.get("mint", key);
    const token = await store.get("token", a.tokenId);
    requireState(
      mint &&
        mint.kind_id === a.kindId &&
        mint.delivered < mint.quantity &&
        token &&
        !token.retired &&
        token.owner === a.recipient.toLowerCase(),
      "mint delivery mismatch"
    );
    await store.put("mint", key, { ...mint, delivered: mint.delivered + 1 });
    await store.put("token", a.tokenId, { ...token, kind_id: a.kindId });
  } else if (event.type === "Transfer") {
    const prior = await store.get("token", a.tokenId);
    const zero = /^0x0{40}$/i;
    requireState(
      prior
        ? prior.owner === a.from.toLowerCase() && !prior.retired
        : zero.test(a.from),
      "transfer owner mismatch"
    );
    await store.put("token", a.tokenId, {
      token_id: a.tokenId,
      kind_id: null,
      earned: "0",
      claimed: "0",
      balance: "0",
      claimant: null,
      ...prior,
      owner: a.to.toLowerCase(),
      retired: zero.test(a.to)
    });
  } else if (
    event.type === "PortalFeeAccrued" ||
    event.type === "PortalClaimed"
  ) {
    const token = await store.get("token", a.portalId);
    requireState(token, "unknown fee token");
    const amount = uint(a.amount);
    if (event.type === "PortalFeeAccrued") {
      requireState(
        !token.retired && uint(token.balance) + amount === uint(a.newBalance),
        "fee balance mismatch"
      );
      await store.put("token", a.portalId, {
        ...token,
        earned: String(uint(token.earned) + amount),
        balance: a.newBalance
      });
    } else {
      requireState(
        token.retired && token.balance === a.amount && token.claimant === null,
        "claim balance mismatch"
      );
      await store.put("token", a.portalId, {
        ...token,
        claimed: String(uint(token.claimed) + amount),
        balance: "0",
        claimant: a.owner.toLowerCase()
      });
    }
  } else if (event.type === "CompetitionEntered") {
    requireState(
      rules.batchSize >= 3n &&
        rules.contribution > 0n &&
        uint(a.entryId) > 0n &&
        (uint(a.entryId) - 1n) / rules.batchSize + 1n === uint(a.batchId) &&
        uint(a.amount) === rules.contribution,
      "competition allocation mismatch"
    );
    requireState(
      !(await store.get("entry", a.entryId)),
      "duplicate competition entry"
    );
    const batch = (await store.get("batch", a.batchId)) ?? {
      batch_id: a.batchId,
      funded: 0,
      completed: 0,
      pool: "0",
      ready: false,
      winners: null,
      leaders: []
    };
    requireState(BigInt(batch.funded) < rules.batchSize, "competition full");
    await store.put("entry", a.entryId, {
      entry_id: a.entryId,
      batch_id: a.batchId,
      request_id: a.requestId,
      submitter: a.submitter.toLowerCase(),
      amount: a.amount,
      score: null
    });
    await store.put("batch", a.batchId, {
      ...batch,
      funded: batch.funded + 1,
      pool: String(uint(batch.pool) + uint(a.amount))
    });
  } else if (event.type === "CompetitionResult") {
    const entry = await store.get("entry", a.entryId);
    const batch = await store.get("batch", a.batchId);
    const score = Number(a.score);
    requireState(
      entry &&
        batch &&
        entry.batch_id === a.batchId &&
        entry.request_id === a.requestId &&
        entry.score === null &&
        Number.isInteger(score) &&
        score >= 4 &&
        score <= 400,
      "competition result mismatch"
    );
    const updated = { ...entry, score };
    const leaders = [updated];
    for (const id of batch.leaders) {
      const prior = await store.get("entry", id);
      requireState(prior && prior.score !== null, "invalid leader");
      leaders.push(prior as typeof updated);
    }
    leaders.sort(
      (x, y) =>
        y.score - x.score || (uint(x.entry_id) < uint(y.entry_id) ? -1 : 1)
    );
    await store.put("entry", a.entryId, updated);
    await store.put("batch", a.batchId, {
      ...batch,
      completed: batch.completed + 1,
      leaders: leaders.slice(0, 3).map((row) => row.entry_id)
    });
  } else if (
    event.type === "CompetitionReady" ||
    event.type === "CompetitionSettled"
  ) {
    const batch = await store.get("batch", a.batchId);
    requireState(
      batch &&
        BigInt(batch.funded) === rules.batchSize &&
        BigInt(batch.completed) === rules.batchSize,
      "competition not complete"
    );
    if (event.type === "CompetitionReady")
      await store.put("batch", a.batchId, { ...batch, ready: true });
    else {
      const winners = [a.first, a.second, a.third];
      requireState(
        batch.ready &&
          !batch.winners &&
          JSON.stringify(batch.leaders) === JSON.stringify(winners),
        "competition winners mismatch"
      );
      await store.put("batch", a.batchId, { ...batch, winners });
    }
  } else if (event.type === "CompetitionPrizePaid") {
    const batch = await store.get("batch", a.batchId);
    const rank = Number(a.rank);
    requireState(
      batch?.winners && Number.isInteger(rank) && rank >= 0 && rank < 3,
      "invalid prize rank"
    );
    const entry = await store.get("entry", batch.winners[rank]!);
    requireState(
      entry &&
        entry.submitter === a.winner.toLowerCase() &&
        uint(a.amount) === (uint(batch.pool) * [50n, 30n, 20n][rank]!) / 100n &&
        !(await store.get("prize", `${a.batchId}:${rank}`)),
      "competition payout mismatch"
    );
    await store.put("prize", `${a.batchId}:${rank}`, {
      batch_id: a.batchId,
      rank,
      winner: a.winner.toLowerCase(),
      amount: a.amount
    });
  }
}
