import { z } from "zod";

export const courseInputSchema = z.object({
  semesterId: z.number().int().positive(),
  name: z.string().trim().min(1, "请填写课程名称").max(100),
  teacher: z.string().trim().max(80).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  weekday: z.number().int().min(1).max(7),
  startPeriod: z.number().int().min(1).max(20),
  endPeriod: z.number().int().min(1).max(20),
  weeks: z.array(z.number().int().min(1).max(30)).min(1, "请至少填写一个周次").max(30, "周次数量不能超过 30"),
  note: z.string().trim().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#dce8e3"),
}).superRefine((value, context) => {
  if (value.endPeriod < value.startPeriod) context.addIssue({ code: "custom", path: ["endPeriod"], message: "结束节次不能早于开始节次" });
  if (new Set(value.weeks).size !== value.weeks.length) context.addIssue({ code: "custom", path: ["weeks"], message: "周次不能重复" });
});

export type CourseInput = z.infer<typeof courseInputSchema>;
