import { z } from "zod";

import {
  buildPromptBundle,
  PROMPT_VERSION,
  requestSchema,
  validateOutcome,
  type GeneratedRace,
  type RaceRequest
} from "@/lib/racing/llmRace";

const providerResponse = z
  .object({
    id: z.string(),
    status: z.string(),
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional(),
                  refusal: z.string().optional()
                })
                .passthrough()
            )
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

// Used only by the server adapter. The client submits player strategies; it
// cannot replace the system prompt, provider model or private server key.
export async function generateLLMRace(
  input: RaceRequest,
  options: {
    apiKey: string;
    model: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  }
): Promise<GeneratedRace> {
  if (!options.apiKey || !options.model)
    throw new Error(
      "Live generation needs a server API key and model configuration."
    );
  const request = requestSchema.parse(input);
  const bundle = buildPromptBundle(request);
  // API format: https://developers.openai.com/api/docs/guides/structured-outputs
  const response = await (options.fetcher ?? fetch)(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        store: false,
        max_output_tokens: 12000,
        input: [
          { role: "system", content: bundle.system },
          { role: "user", content: bundle.user }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "yunipals_race",
            strict: true,
            schema: bundle.schema
          }
        }
      }),
      signal: options.signal
    }
  );
  if (!response.ok)
    throw new Error(
      `The race provider returned HTTP ${response.status}. No race result was generated.`
    );
  const payload = providerResponse.parse(await response.json());
  if (payload.status !== "completed")
    throw new Error(
      "The model did not complete the race. No result has been substituted."
    );
  const parts = payload.output
    .filter((entry) => entry.type === "message")
    .flatMap((entry) => entry.content ?? []);
  if (parts.some((part) => part.type === "refusal"))
    throw new Error(
      "The model declined to generate this race. Try another strategy."
    );
  const json = parts
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
  if (!json) throw new Error("The model returned no race output.");
  const outcome = validateOutcome(JSON.parse(json), request);
  if (outcome.version !== PROMPT_VERSION)
    throw new Error(
      "The provider returned a different prompt version. Import older races separately."
    );
  return {
    request,
    outcome,
    provenance: {
      source: "live-llm",
      model: options.model,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      responseId: payload.id
    }
  };
}
