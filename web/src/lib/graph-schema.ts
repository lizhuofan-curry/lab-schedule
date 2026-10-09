import { z } from "zod";

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const graphQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }).strict(),
  z.object({ scope: z.literal("member"), id }).strict(),
  z.object({ scope: z.literal("group"), id }).strict(),
]);
export type GraphScope = z.infer<typeof graphQuerySchema>;
export const graphSourceKeySchema = z.string().regex(/^(work|round):[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value.split(":")[1])));

export const graphThemesSchema = z.object({
  themes: z.array(z.object({
    label: z.string().trim().min(1).max(40).refine((text) => !/[<>\[\]\n\r]|https?:|javascript:|data:/i.test(text)),
    sourceIds: z.array(graphSourceKeySchema).min(1).max(100),
  }).strict()).max(40),
}).strict();
export type GraphTheme = z.infer<typeof graphThemesSchema>["themes"][number];

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(text => !/[<>]|https?:|javascript:|data:/i.test(text));
export const graphRelationsSchema = z.object({ relations: z.array(z.object({
  from: graphSourceKeySchema, to: graphSourceKeySchema,
  type: z.enum(["similar", "method", "upstream"]),
  reason: safeText(400), fromEvidence: safeText(300), toEvidence: safeText(300),
}).strict().refine(r => r.from !== r.to)).max(500) }).strict();
export type GraphRelation = z.infer<typeof graphRelationsSchema>["relations"][number];
export const graphFeedbackSchema = z.object({
  edgeId: z.string().regex(/^ai\/(work|round):[1-9]\d*\/(work|round):[1-9]\d*\/(similar|method|upstream)$/).max(150),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(1000),
}).strict();
