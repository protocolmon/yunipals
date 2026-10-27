import { describe, expect, it } from "vitest";
import { parseIndexedEventTopics } from "../../../packages/yunipals-indexer-server/src/event-topics.js";

const topic = `0x${"ab".repeat(32)}`;

describe("Ponder indexed event topics", () => {
  it.each([0, 1, 2, 3, 4])("accepts %i topics with or without trailing null padding", (count) => {
    const topics = Array<string>(count).fill(topic);
    expect(parseIndexedEventTopics(JSON.stringify(topics))).toEqual(topics);
    expect(
      parseIndexedEventTopics(JSON.stringify([...topics, ...Array(4 - count).fill(null)]))
    ).toEqual(topics);
  });

  it("normalizes topic hex without changing the indexed payload", () => {
    const raw = JSON.stringify([`0x${"AB".repeat(32)}`, null, null, null]);
    expect(parseIndexedEventTopics(raw)).toEqual([topic]);
    expect(JSON.parse(raw)).toHaveLength(4);
  });

  it.each([
    "null", "{}", "1", '"topic"', "[", '["0x"]',
    JSON.stringify([topic, null, topic]),
    JSON.stringify([null, topic]),
    JSON.stringify([topic, 42]),
    JSON.stringify([topic, {}]),
    JSON.stringify([topic, `0x${"ag".repeat(32)}`]),
    JSON.stringify([topic, `0x${"ab".repeat(31)}`]),
    JSON.stringify([topic, null, null, null, null])
  ])("rejects malformed topic storage %s", (raw) => {
    expect(() => parseIndexedEventTopics(raw)).toThrow();
  });
});
