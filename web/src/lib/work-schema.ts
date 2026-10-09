import { z } from "zod";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const fields = {
  title: z
    .string()
    .trim()
    .min(1, "请输入工作标题。")
    .max(120, "标题最多120字。"),
  description: z
    .string()
    .trim()
    .min(1, "请填写工作说明。")
    .max(20000, "说明最多20000字。"),
  status: z.enum(["active", "completed", "paused"]),
};
export const workCreateSchema = z
  .object({ ...fields, status: fields.status.default("active") })
  .strict();
export const workUpdateSchema = z
  .object({ ...fields, expectedRevision: id })
  .strict();
export const workDeleteSchema = z.object({ expectedRevision: id }).strict();
export const workCursorSchema = z
  .object({ at: z.string().datetime({ offset: true }), id })
  .strict();
export const workQuerySchema = z
  .object({
    scope: z.enum(["recent", "all"]).default("recent"),
    cursor: z.string().min(1).max(240).optional(),
  })
  .strict();
export const memberTaskQuerySchema = workQuerySchema.omit({ scope: true });
