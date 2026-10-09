import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ids = z
  .array(id)
  .max(200)
  .refine((a) => new Set(a).size === a.length, "请勿重复选择成员或小组。");
const fileIds = z
  .array(z.string().uuid())
  .max(5, "最多上传5个附件。")
  .refine((a) => new Set(a).size === a.length, "附件不能重复。");
const deadline = z.string().datetime({ offset: true }).nullable();
const content = {
  title: z
    .string()
    .trim()
    .min(1, "请输入任务标题。")
    .max(120, "标题最多120字。"),
  description: z.string().trim().min(1, "请填写任务要求。").max(20000),
  deadline,
  capacity: z.number().int().min(1).max(1000).nullable(),
  fileIds,
};
export const taskCreateSchema = z
  .object({
    ...content,
    kind: z.enum(["announcement", "assigned"]),
    delivery: z.enum(["shared", "individual"]),
    directIds: ids,
    groupIds: ids,
  })
  .strict()
  .refine(
    (v) => v.kind !== "announcement" || v.groupIds.length === 0,
    "公告任务不能选择目标小组。",
  )
  .refine(
    (v) => v.kind !== "assigned" || v.directIds.length + v.groupIds.length > 0,
    "请选择执行成员或小组。",
  )
  .refine(
    (v) => v.kind !== "assigned" || v.capacity === null,
    "指定任务无需人数上限。",
  );
const revision = { expectedRevision: id };
export const taskCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), ...revision, ...content }).strict(),
  z
    .object({
      action: z.literal("targets"),
      ...revision,
      directIds: ids,
      groupIds: ids,
      capacity: content.capacity,
    })
    .strict(),
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("close"), ...revision }).strict(),
  z.object({ action: z.literal("cancel"), ...revision }).strict(),
  z
    .object({
      action: z.literal("reopen"),
      ...revision,
      claimsOpen: z.boolean(),
      deadline,
    })
    .strict(),
  z
    .object({
      action: z.literal("submit"),
      roundId: id,
      expectedVersion: z.number().int().nonnegative(),
      requestKey: z.string().uuid(),
      body: z.string().trim().max(20000),
      links: z
        .array(
          z
            .string()
            .url()
            .max(2000)
            .refine((s) => /^https?:\/\//i.test(s), "链接仅支持http或https。"),
        )
        .max(20),
      fileIds,
    })
    .strict(),
  z
    .object({
      action: z.literal("review"),
      roundId: id,
      submissionId: id,
      decision: z.enum(["approve", "return"]),
      reason: z.string().trim().max(2000),
    })
    .strict(),
]);
export const notificationReadSchema = z
  .object({ ids: z.array(id).min(1).max(200) })
  .strict();
export const notificationDeleteSchema = z
  .object({
    ids: z.array(id).min(1, "请选择已读消息。")
      .max(10000, "一次最多清理10000条消息，请减少选择后重试。")
      .refine((values) => new Set(values).size === values.length, "请勿重复选择消息。"),
    confirm: z.literal(true),
  })
  .strict();
export const taskFileUploadSchema = z
  .object({
    file: z
      .custom<File>((value) => value instanceof File, "请选择有效文件。")
      .refine(
        (file) => file.size > 0 && file.size <= 10 * 1024 * 1024,
        "文件须非空且不超过10MB，请压缩或改用链接。",
      ),
  })
  .strict();
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export const taskFileDeleteSchema = z.object({ confirm: z.literal(true) }).strict();
export type TaskCommand = z.infer<typeof taskCommandSchema>;
