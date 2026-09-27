import { z } from "zod";
import { HenuSyncError, previewHenuSchedule } from "@/lib/henu-sync-service";
import { ScheduleImportError } from "@/lib/schedule-import-service";
import { forbidden, getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";

const schema = z.object({
  studentId: z.string().trim().min(4, "请输入有效的学号。").max(32),
  password: z.string().min(1, "请输入密码。"),
});

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "输入无效。" }, { status: 422 });

  if (parsed.data.studentId.trim().toLowerCase() !== member.studentNo.trim().toLowerCase()) {
    return forbidden("只能同步当前登录账号本人的河大课表。");
  }

  try {
    return Response.json({ data: await previewHenuSchedule({ member, studentId: parsed.data.studentId, password: parsed.data.password }) });
  } catch (error) {
    if (error instanceof HenuSyncError) {
      const status = error.code === "FORBIDDEN_STUDENT" || error.code === "IDENTITY_MISMATCH" ? 403 : 422;
      return Response.json({ code: error.code, message: error.message }, { status });
    }
    if (error instanceof ScheduleImportError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "HENU_SYNC_FAILED", message: "同步失败，请稍后重试。当前课表没有发生变化。" }, { status: 500 });
  }
}
