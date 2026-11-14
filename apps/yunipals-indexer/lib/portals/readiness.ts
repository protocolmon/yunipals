import { PortalSourceError } from "./errors.js";
import type { PortalRuntime } from "./runtime.js";
import type { PortalChain } from "./chain.js";

/** Keep admission checks live at the current block, while requiring its round,
 * price and theme to be indexed before presenting a payable application state. */
export async function portalReadiness(
  runtime: PortalRuntime,
  status: Awaited<ReturnType<PortalChain["active"]>>
) {
  try {
    return await runtime.ledger.snapshot(() =>
      indexedReadiness(runtime, status)
    );
  } catch (error) {
    if (!(error instanceof PortalSourceError)) throw error;
    return {
      indexing: true,
      rotationIndexed: false,
      indexedThroughBlock: null,
      sourceError: error.code
    };
  }
}
async function indexedReadiness(
  runtime: PortalRuntime,
  status: Awaited<ReturnType<PortalChain["active"]>>
) {
  const cursor = await runtime.ledger.cursor();
  const state = async (source: string, component: string, id: string) =>
    (
      await runtime.ledger.db.query<{ value: Record<string, string> }>(
        "SELECT value FROM portal_v5_state WHERE deployment=$1 AND source=$2 AND component=$3 AND entity_id=$4 AND block_number<=$5",
        [
          runtime.ledger.deployment,
          source.toLowerCase(),
          component,
          id,
          status.asOfBlock.toString()
        ]
      )
    ).rows[0]?.value;
  if (
    !cursor ||
    (await runtime.ledger.requiresReplay()) ||
    (await runtime.chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
      .hash !== cursor.hash
  )
    return {
      indexing: true,
      rotationIndexed: false,
      indexedThroughBlock: null
    };
  let ready = true;
  if (status.round.id > 0n) {
    const round = await state(
      status.deployment.registry,
      "round",
      status.round.id.toString()
    );
    ready =
      round?.portalId === status.round.portalId.toString() &&
      round?.startsAt === status.round.startsAt.toString() &&
      round?.endsAt === status.round.endsAt.toString();
  }
  if (status.portal) {
    const payment = await state(
      status.deployment.grading,
      "payment",
      status.portal.kindId.toString()
    );
    const kind = await state(
      status.deployment.collection,
      "kind",
      status.portal.kindId.toString()
    );
    ready =
      ready &&
      !!kind &&
      payment?.version === status.portal.payment.version.toString();
  }
  if (status.competition?.accepting) {
    const theme = await state(
      status.competition.address,
      "theme",
      status.competition.nextBatch.toString()
    );
    ready = ready && theme?.themeHash === status.competition.theme.hash;
    if (ready && status.competition.nextBatch > 1n) {
      try {
        await runtime.assets.read(
          status.competition.theme.artifactHash.slice(2),
          "json"
        );
      } catch {
        ready = false;
      }
    }
  }
  const rotationIndexed =
    !status.rotation.ready ||
    !!(await state(
      status.deployment.registry,
      "randomness_result",
      status.rotation.requestId.toString()
    ));
  const current = await runtime.ledger.cursor();
  if (
    current?.generation !== cursor.generation ||
    (await runtime.chain.client.getBlock({ blockNumber: status.asOfBlock }))
      .hash !== status.asOfBlockHash ||
    (await runtime.chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
      .hash !== cursor.hash
  )
    return {
      indexing: true,
      rotationIndexed: false,
      indexedThroughBlock: null
    };
  return {
    indexing: !ready,
    rotationIndexed,
    indexedThroughBlock: cursor.block
  };
}
