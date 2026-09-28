import { z } from "zod";
import { AvailabilityError, queryAvailability } from "@/lib/availability-service";
import { getCurrentViewer, maskStudentNo, unauthorized } from "@/lib/server-auth";

const timePattern = /^\d{2}:\d{2}$/;
const availabilitySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  week: z.number().int().min(1).max(30).optional(),
  studentIds: z.array(z.number().int().positive()).min(1, "请至少选择一位成员。").max(100, "一次最多查询 100 位成员。"),
  minimumMinutes: z.number().int().min(0).max(720).optional(),
  startTime: z.string().regex(timePattern, "请选择有效的开始时间。").optional(),
  endTime: z.string().regex(timePattern, "请选择有效的结束时间。").optional(),
}).superRefine((value, context) => {
  if ((value.startTime === undefined) !== (value.endTime === undefined)) {
    context.addIssue({ code: "custom", message: "请同时选择开始时间和结束时间。" });
  } else if (value.startTime !== undefined && value.endTime !== undefined && value.startTime >= value.endTime) {
    context.addIssue({ code: "custom", message: "结束时间必须晚于开始时间。" });
  }
});

export async function POST(request: Request) {
  const viewer = await getCurrentViewer(request.headers);
  if (!viewer) return unauthorized();
  const parsed = availabilitySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_QUERY", message: parsed.error.issues[0]?.message ?? "查询条件无效。" }, { status: 422 });
  try {
    const data = await queryAvailability(parsed.data);
    return Response.json({ data: viewer.kind === "guest" ? { ...data, members: data.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })) } : data });
  } catch (error) {
    if (error instanceof AvailabilityError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "QUERY_FAILED", message: "空闲时间查询失败，请稍后重试。" }, { status: 500 });
  }
}
