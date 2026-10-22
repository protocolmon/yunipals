/** Decode stored Ponder topics. Unused fixed-width slots are trailing nulls. */
export function parseIndexedEventTopics(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 4)
    throw new Error("Invalid indexed event topics.");
  const topics: string[] = [];
  let padding = false;
  for (const topic of value) {
    if (topic === null) {
      padding = true;
      continue;
    }
    if (
      padding ||
      typeof topic !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(topic)
    )
      throw new Error("Invalid indexed event topics.");
    topics.push(topic.toLowerCase());
  }
  return topics;
}
