import type { Pool } from "pg";
import type { PortalLedgerEvent } from "./ledger-store.js";

export const portalApplicationSchema = `
CREATE TABLE IF NOT EXISTS portal_v5_request (
 deployment text NOT NULL, request_id numeric(78,0) NOT NULL, token_id numeric(78,0) NOT NULL,
 submitter text NOT NULL, portal_id numeric(78,0) NOT NULL, input_version numeric(20,0) NOT NULL,
 commitment text NOT NULL, requested_block numeric(20,0) NOT NULL,
 completed_version numeric(20,0), artwork_hash text, report_hash text, scores jsonb,
 PRIMARY KEY(deployment,request_id)
);
CREATE TABLE IF NOT EXISTS portal_v5_mint (
 deployment text NOT NULL, source text NOT NULL, request_id numeric(78,0) NOT NULL,
 kind_id numeric(78,0) NOT NULL, quantity integer NOT NULL, delivered integer NOT NULL DEFAULT 0,
 PRIMARY KEY(deployment,source,request_id)
);
CREATE TABLE IF NOT EXISTS portal_v5_state (
 deployment text NOT NULL, source text NOT NULL, component text NOT NULL, entity_id text NOT NULL,
 value jsonb NOT NULL, block_number numeric(20,0) NOT NULL, log_index integer NOT NULL,
 PRIMARY KEY(deployment,source,component,entity_id)
);
`;

export function portalStateKey(
  event: PortalLedgerEvent
): [string, string] | null {
  const a = event.args;
  switch (event.type) {
    case "KindConfigured":
      return ["kind", a.kindId];
    case "PaymentPolicySet":
      return ["payment", a.kindId];
    case "RubricConfigured":
      return ["rubric", a.rubricId];
    case "ArtworkRegistered":
      return ["original_artwork", a.variantId];
    case "RandomnessRequested":
      return ["randomness_request", a.requestId];
    case "RandomnessReceived":
      return ["randomness_result", a.requestId];
    case "RotationRequested":
      return ["rotation", a.requestId];
    case "SelectionRequested":
      return ["selection", a.requestId];
    case "PortalActivated":
    case "PortalRoundUnavailable":
      return ["round", a.roundId];
    case "ThemePublished":
      return ["theme", a.batchId];
    case "PaymentAllocated":
      return ["allocation", a.requestId];
    case "CompetitionNotificationDeferred":
      return ["deferred_result", a.requestId];
    case "CompetitionPrizeDeferred":
      return ["deferred_prize", `${a.batchId}:${a.rank}`];
    case "RefundCredited":
      return ["refund", a.payer.toLowerCase()];
    case "AdmissionsPaused":
    case "RandomnessPaused":
    case "CompetitionConfigured":
    case "ClaimControllerBound":
      return [event.type, "current"];
    default:
      return null;
  }
}

/** Runs in the same transaction as ownership, competition projections and cursor.
 * Request/mint rows are application state, not merely a processed-block marker. */
export async function projectPortalApplication(
  db: Pick<Pool, "query">,
  deployment: string,
  event: PortalLedgerEvent
) {
  const a = event.args;
  if (event.type === "GradingRequested") {
    await db.query(
      "INSERT INTO portal_v5_request(deployment,request_id,token_id,submitter,portal_id,input_version,commitment,requested_block) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        deployment,
        a.requestId,
        a.tokenId,
        a.submitter.toLowerCase(),
        a.portalId,
        a.inputVersion,
        a.spellCommitment,
        event.block
      ]
    );
  } else if (event.type === "GradingCompleted") {
    const scores = a.scores.split(",").map(Number);
    if (
      scores.length !== 4 ||
      scores.some((v) => !Number.isInteger(v) || v < 1 || v > 100)
    )
      throw new Error("Invalid indexed grades.");
    const result = await db.query(
      "UPDATE portal_v5_request SET completed_version=$4,artwork_hash=$5,report_hash=$6,scores=$7 WHERE deployment=$1 AND request_id=$2 AND token_id=$3 AND completed_version IS NULL AND input_version+1=$4 RETURNING request_id",
      [
        deployment,
        a.requestId,
        a.tokenId,
        a.version,
        a.artworkHash,
        a.reportHash,
        JSON.stringify(scores)
      ]
    );
    if (!result.rows.length)
      throw new Error("Grade does not match an indexed request.");
  } else if (event.type === "MintCommitted") {
    await db.query(
      "INSERT INTO portal_v5_mint(deployment,source,request_id,kind_id,quantity) VALUES($1,$2,$3,$4,$5)",
      [deployment, event.source, a.requestId, a.kindId, a.quantity]
    );
  } else if (event.type === "PortalMinted" && a.requestId) {
    const result = await db.query(
      "UPDATE portal_v5_mint SET delivered=delivered+1 WHERE deployment=$1 AND source=$2 AND request_id=$3 AND kind_id=$4 AND delivered<quantity RETURNING request_id",
      [deployment, event.source, a.requestId, a.kindId]
    );
    if (!result.rows.length)
      throw new Error("Mint delivery does not match a commitment.");
  }
  const key = portalStateKey(event);
  if (key)
    await db.query(
      `INSERT INTO portal_v5_state(deployment,source,component,entity_id,value,block_number,log_index) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(deployment,source,component,entity_id) DO UPDATE SET value=excluded.value,block_number=excluded.block_number,log_index=excluded.log_index`,
      [
        deployment,
        event.source,
        ...key,
        JSON.stringify(a),
        event.block,
        event.logIndex
      ]
    );
}

export async function portalProjectionApplied(
  db: Pick<Pool, "query">,
  deployment: string,
  event: PortalLedgerEvent
): Promise<boolean> {
  const a = event.args;
  const key = portalStateKey(event);
  if (key)
    return (
      (
        await db.query(
          "SELECT 1 FROM portal_v5_state WHERE deployment=$1 AND source=$2 AND component=$3 AND entity_id=$4 AND (block_number>$5 OR (block_number=$5 AND log_index>=$6))",
          [deployment, event.source, ...key, event.block, event.logIndex]
        )
      ).rows.length === 1
    );
  if (event.type === "GradingRequested" || event.type === "GradingCompleted") {
    const row = (
      await db.query<{
        token_id: string;
        submitter: string;
        commitment: string;
        completed_version: string | null;
        artwork_hash: string | null;
        report_hash: string | null;
      }>(
        "SELECT token_id::text,submitter,commitment,completed_version::text,artwork_hash,report_hash FROM portal_v5_request WHERE deployment=$1 AND request_id=$2",
        [deployment, a.requestId]
      )
    ).rows[0];
    return (
      !!row &&
      row.token_id === a.tokenId &&
      (event.type === "GradingRequested"
        ? row.submitter === a.submitter.toLowerCase() &&
          row.commitment === a.spellCommitment
        : row.completed_version === a.version &&
          row.artwork_hash === a.artworkHash &&
          row.report_hash === a.reportHash)
    );
  }
  if (event.type === "MintCommitted" || event.type === "PortalMinted") {
    const row = (
      await db.query<{ quantity: number; delivered: number; kind_id: string }>(
        "SELECT quantity,delivered,kind_id::text FROM portal_v5_mint WHERE deployment=$1 AND source=$2 AND request_id=$3",
        [deployment, event.source, a.requestId]
      )
    ).rows[0];
    if (
      !row ||
      row.kind_id !== a.kindId ||
      (event.type === "MintCommitted"
        ? row.quantity !== Number(a.quantity)
        : row.delivered < 1)
    )
      return false;
    if (event.type === "MintCommitted") return true;
  }
  if (
    [
      "Transfer",
      "PortalMinted",
      "PortalRetired",
      "PortalFeeAccrued",
      "PortalClaimed"
    ].includes(event.type)
  ) {
    const row = (
      await db.query<{
        retired: boolean;
        claimed: string;
        claimant: string | null;
        kind: string | null;
      }>(
        "SELECT retired,claimed::text,claimant,kind_id::text AS kind FROM portal_v2_token WHERE deployment=$1 AND token_id=$2",
        [deployment, event.tokenId]
      )
    ).rows[0];
    if (!row) return false;
    if (event.type === "PortalClaimed")
      return (
        row.retired &&
        row.claimed === a.amount &&
        row.claimant === a.owner.toLowerCase()
      );
    if (event.type === "PortalRetired") return row.retired;
    if (event.type === "PortalMinted") return row.kind === a.kindId;
    return true;
  }
  if (
    event.type === "CompetitionEntered" ||
    event.type === "CompetitionResult"
  ) {
    const row = (
      await db.query<{ request: string; batch: string; score: number | null }>(
        "SELECT request_id::text AS request,batch_id::text AS batch,score FROM portal_v3_competition_entry WHERE deployment=$1 AND entry_id=$2",
        [deployment, a.entryId]
      )
    ).rows[0];
    return (
      !!row &&
      row.request === a.requestId &&
      row.batch === a.batchId &&
      (event.type !== "CompetitionResult" || row.score === Number(a.score))
    );
  }
  if (
    event.type === "CompetitionReady" ||
    event.type === "CompetitionSettled"
  ) {
    const row = (
      await db.query<{ ready: boolean; winners: string[] | null }>(
        "SELECT ready,winners FROM portal_v3_competition_batch WHERE deployment=$1 AND batch_id=$2",
        [deployment, a.batchId]
      )
    ).rows[0];
    return (
      !!row?.ready &&
      (event.type !== "CompetitionSettled" ||
        JSON.stringify(row.winners) ===
          JSON.stringify([a.first, a.second, a.third]))
    );
  }
  if (event.type === "CompetitionPrizePaid")
    return (
      (
        await db.query(
          "SELECT 1 FROM portal_v3_competition_prize WHERE deployment=$1 AND batch_id=$2 AND rank=$3 AND winner=$4 AND amount=$5",
          [deployment, a.batchId, a.rank, a.winner.toLowerCase(), a.amount]
        )
      ).rows.length === 1
    );
  return false;
}
