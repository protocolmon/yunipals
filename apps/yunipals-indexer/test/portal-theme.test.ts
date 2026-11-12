import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  PortalThemeStore,
  portalThemeSchema
} from "../lib/portals/theme-store.js";

const db = new PGlite();
const store = new PortalThemeStore(db as never, "theme-test");
const input = {
  pool: `0x${"1".repeat(40)}`,
  batchId: "2",
  sourcesHash: `0x${"2".repeat(64)}`,
  policyHash: `0x${"3".repeat(64)}`
};
beforeAll(() => db.exec(portalThemeSchema));
beforeEach(() => db.exec("TRUNCATE portal_v4_theme_job"));
afterAll(() => db.close());
it("leases one theme extraction and resumes its saved result after a restart", async () => {
  const first = await store.claim(input);
  expect(first).not.toBeNull();
  expect(await store.claim(input)).toBeNull();
  first!.progress = {
    output: { title: "Guardians", brief: "Light protects a world." },
    sourceDigest: "verified"
  };
  await store.save(first!);
  await store.release(first!);
  const second = await new PortalThemeStore(db as never, "theme-test").claim(
    input
  );
  expect(second!.progress).toEqual(first!.progress);
  expect(second!.lease).not.toBe(first!.lease);
  await expect(store.save(first!)).rejects.toThrow("lease lost");
  await store.release(first!);
  expect(await store.claim(input)).toBeNull();
});
it("fences an expired worker and separates changed winners or model policies", async () => {
  const first = (await store.claim(input))!;
  await db.exec(
    "UPDATE portal_v4_theme_job SET lease_until=now()-interval '1 second'"
  );
  await expect(store.heartbeat(first)).rejects.toThrow("lease lost");
  const replacement = (await store.claim(input))!;
  expect(replacement.lease).not.toBe(first.lease);
  const changed = await store.claim({
    ...input,
    sourcesHash: `0x${"4".repeat(64)}`
  });
  expect(changed!.progress).toEqual({});
  expect(
    await store.claim({ ...input, policyHash: `0x${"5".repeat(64)}` })
  ).not.toBeNull();
});
