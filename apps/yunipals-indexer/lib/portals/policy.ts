import { z } from "zod";
import {
  portalModels,
  type PortalModelPolicy
} from "@protopals/yunipals-market-core/portals";

const categoryText = z
  .object({
    creativity: z.string().min(1).max(4000),
    harmony: z.string().min(1).max(4000),
    craft: z.string().min(1).max(4000),
    impact: z.string().min(1).max(4000)
  })
  .strict();
const categoryLimits = z
  .object({
    creativity: z.number().int().min(1).max(100).optional(),
    harmony: z.number().int().min(1).max(100).optional(),
    craft: z.number().int().min(1).max(100).optional(),
    impact: z.number().int().min(1).max(100).optional()
  })
  .strict();
export const portalGradingCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(4000),
    criteria: categoryText,
    principles: z.array(z.string().min(1).max(4000)).min(1).max(20),
    bands: z
      .array(
        z
          .object({
            min: z.number().int().min(1).max(100),
            max: z.number().int().min(1).max(100),
            label: z.string().min(1).max(80),
            description: z.string().min(1).max(2000)
          })
          .strict()
      )
      .min(1)
      .max(20)
      .refine(
        (bands) =>
          bands[0].min === 1 &&
          bands[bands.length - 1].max === 100 &&
          bands.every(
            (band, index) =>
              band.min <= band.max &&
              (index === 0 || band.min === bands[index - 1].max + 1)
          ),
        "Score bands must cover 1–100 exactly once in order."
      ),
    checks: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
            label: z.string().min(1).max(160),
            requirement: z.string().min(1).max(4000),
            limits: z
              .object({ partial: categoryLimits, missed: categoryLimits })
              .strict()
          })
          .strict()
      )
      .min(1)
      .max(20)
      .refine(
        (checks) =>
          new Set(checks.map((check) => check.id)).size === checks.length,
        "Check IDs must be unique."
      )
  })
  .strict();

export const portalModelPolicySchema = z
  .object({
    image: z.string().min(1),
    imageQuality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]),
    imageSize: z.string().min(1),
    embeddings: z.string().min(1),
    originality: z.string().min(1),
    grading: z.string().min(1),
    rubric: z.string().min(1),
    copyCap: z.number().int().min(1).max(100),
    portalEffects: z
      .record(
        z.string().regex(/^[1-9][0-9]{0,77}$/),
        z
          .object({
            name: z.string().min(1).max(80),
            instruction: z.string().min(1).max(4000)
          })
          .strict()
      )
      .optional(),
    portalGradingCases: z
      .record(z.string().regex(/^[1-9][0-9]{0,77}$/), portalGradingCaseSchema)
      .optional(),
    competitionThemes: z
      .object({
        version: z.string().min(1),
        model: z.string().min(1),
        extraction: z.string().min(1).max(4000),
        grading: z.string().min(1).max(4000),
        originality: z.string().min(1).max(4000)
      })
      .strict()
      .optional()
  })
  .strict();

export function configuredPortalWorkerPolicy(
  policiesJSON: string | undefined
): PortalModelPolicy {
  const policies = policiesJSON
    ? z.array(portalModelPolicySchema).min(1).parse(JSON.parse(policiesJSON))
    : [portalModels];
  if (policies.length !== 1)
    throw new Error(
      "Run a separately configured worker for each retained model policy."
    );
  return policies[0];
}
