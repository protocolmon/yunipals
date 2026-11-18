import { expect, it, vi } from "vitest";
import {
  estimatePortalWait,
  portalProcessing
} from "../lib/portals/processing.js";
import type { PortalRuntime } from "../lib/portals/runtime.js";
import type { PortalChain } from "../lib/portals/chain.js";

it("waits for sufficient observations and estimates a rounded range", () => {
  expect(estimatePortalWait([90, 120, NaN, -1])).toBeNull();
  expect(estimatePortalWait([90, 180, 240, 300, 360])).toEqual({
    minSeconds: 180,
    maxSeconds: 360,
    sampleSize: 5
  });
  expect(estimatePortalWait([60, 60, 60])).toEqual({
    minSeconds: 60,
    maxSeconds: 120,
    sampleSize: 3
  });
});

const card = { pending: 7n, tokenId: 508n, asOfBlock: 100n } as Awaited<
  ReturnType<PortalChain["card"]>
>;
function fixture(job: Record<string, boolean> | undefined, tokenId = 508n) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: job ? [job] : [] })
    .mockResolvedValueOnce({
      rows: [{ seconds: 120 }, { seconds: 180 }, { seconds: 240 }]
    });
  const request = vi
    .fn()
    .mockResolvedValue({ tokenId, acceptedAt: 123n, completed: false });
  const binding = vi.fn().mockResolvedValue("canonical-binding");
  const runtime = {
    chain: { request, binding },
    store: { deployment: "deployment", db: { query } }
  } as unknown as PortalRuntime;
  return { runtime, request, binding, query };
}

it.each([
  [undefined, "queued"],
  [{ working: true }, "creating"],
  [{ working: false, image: true }, "grading"],
  [{ image: true, grading: true }, "publishing"],
  [{ completion: true }, "publishing"]
])("reports only observed progress: %s", async (job, stage) => {
  const { runtime, request, binding, query } = fixture(
    job as Record<string, boolean> | undefined
  );
  const result = await portalProcessing(runtime, card);
  expect(result).toMatchObject({ requestId: "7", acceptedAt: "123", stage });
  expect(Object.keys(result!)).toEqual([
    "requestId",
    "acceptedAt",
    "stage",
    "estimate"
  ]);
  expect(request).toHaveBeenCalledWith(7n, 100n);
  expect(binding).toHaveBeenCalledWith(7n, 100n);
  expect(query.mock.calls[0][1]).toEqual([
    "deployment",
    "7",
    "canonical-binding"
  ]);
});

it("does not reveal another card's job or query finished cards", async () => {
  const { runtime, query } = fixture({ working: true }, 509n);
  expect(await portalProcessing(runtime, card)).toBeNull();
  expect(await portalProcessing(runtime, { ...card, pending: 0n })).toBeNull();
  expect(query).not.toHaveBeenCalled();
});

it("preserves the original acceptance time during publication", async () => {
  const { runtime, request } = fixture({ completion: true });
  request.mockResolvedValue({
    tokenId: 508n,
    acceptedAt: 123n,
    completed: true
  });
  expect(
    await portalProcessing(runtime, { ...card, pending: 0n }, 7n)
  ).toMatchObject({
    requestId: "7",
    acceptedAt: "123",
    stage: "publishing"
  });
});
