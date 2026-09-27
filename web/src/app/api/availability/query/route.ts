import { z } from "zod";
import { AvailabilityError, queryAvailability } from "@/lib/availability-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

const availabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择有效日期。"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择有效结束日期。").optional(),
  studentIds: z.array(z.number().int().positive()).min(1, "请至少选择一位成员。").max(100, "一次最多查询 100 位成员。"),
  minimumConsecutivePeriods: z.number().int().min(1).max(13),
  minimumMinutes: z.number().int().min(0).max(720).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  startPeriod: z.number().int().min(1).max(13).optional(),
  endPeriod: z.number().int().min(1).max(13).optional(),
}).superRefine((value, context) => {
  if ((value.startPeriod === undefined) !== (value.endPeriod === undefined)) {
    context.addIssue({ code: "custom", message: "请同时选择开始节次和结束节次。" });
  } else if (value.startPeriod !== undefined && value.endPeriod !== undefined && value.startPeriod > value.endPeriod) {
    context.addIssue({ code: "custom", message: "结束节次不能早于开始节次。" });
  }
});

export async function POST(request: Request) {
  if (!await getCurrentMember(request.headers)) return unauthorized();
  const parsed = availabilitySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_QUERY", message: parsed.error.issues[0]?.message ?? "查询条件无效。" }, { status: 422 });
  try {
    return Response.json({ data: await queryAvailability(parsed.data) });
  } catch (error) {
    if (error instanceof AvailabilityError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "QUERY_FAILED", message: "空闲时间查询失败，请稍后重试。" }, { status: 500 });
  }
}
