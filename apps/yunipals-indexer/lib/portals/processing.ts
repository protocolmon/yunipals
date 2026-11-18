import type { PortalChain } from "./chain.js";
import type { PortalRuntime } from "./runtime.js";

export function estimatePortalWait(durations: number[]) {
  const samples = durations
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
    .sort((a, b) => a - b);
  if (samples.length < 3) return null;
  const minutes = (percentile: number) =>
    Math.max(
      60,
      Math.ceil(
        samples[Math.max(0, Math.ceil(samples.length * percentile) - 1)] / 60
      ) * 60
    );
  return {
    minSeconds: minutes(0.25),
    maxSeconds: Math.max(minutes(0.25) + 60, minutes(0.9)),
    sampleSize: samples.length
  };
}

/** Public progress contains no spell text, generated assets or worker errors. */
export async function portalProcessing(
  runtime: PortalRuntime,
  card: Awaited<ReturnType<PortalChain["card"]>>,
  unpublishedRequestId?: bigint
) {
  const requestId = card.pending || unpublishedRequestId;
  if (!requestId) return null;
  const [request, binding] = await Promise.all([
    runtime.chain.request(requestId, card.asOfBlock),
    runtime.chain.binding(requestId, card.asOfBlock)
  ]);
  if (request.tokenId !== card.tokenId || request.acceptedAt === 0n)
    return null;
  const [jobs, samples] = await Promise.all([
    runtime.store.db.query<{
      working: boolean;
      image: boolean;
      grading: boolean;
      completion: boolean;
    }>(
      `SELECT lease_until > now() AS working,
        progress ? 'image' AS image, progress ? 'grading' AS grading,
        progress ? 'completion' AS completion
       FROM portal_v1_job WHERE deployment=$1 AND request_id=$2 AND binding=$3`,
      [runtime.store.deployment, requestId.toString(), binding]
    ),
    runtime.store.db.query<{ seconds: number }>(
      `SELECT (EXTRACT(EPOCH FROM p.published_at)-j.accepted_at)::float8 AS seconds
       FROM portal_v1_publication p JOIN portal_v1_job j USING (deployment,request_id)
       WHERE p.deployment=$1 AND j.completed
         AND p.result->'result'->>'requestBinding'=j.binding
         AND p.published_at > now()-interval '30 days'
       ORDER BY p.published_at DESC LIMIT 100`,
      [runtime.store.deployment]
    )
  ]);
  const job = jobs.rows[0];
  const stage =
    request.completed || job?.completion || job?.grading
      ? "publishing"
      : job?.image
        ? "grading"
        : job?.working
          ? "creating"
          : "queued";
  return {
    requestId: requestId.toString(),
    acceptedAt: request.acceptedAt.toString(),
    stage,
    estimate: estimatePortalWait(samples.rows.map((row) => row.seconds))
  };
}
