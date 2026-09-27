import { getMemberWeekSchedule } from "@/lib/schedule-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentMember = await getCurrentMember(request.headers);
  if (!currentMember) return unauthorized();

  const studentId = positiveInteger((await params).id);
  const url = new URL(request.url);
  const semesterId = positiveInteger(url.searchParams.get("semester"));
  const week = positiveInteger(url.searchParams.get("week"));
  if (!studentId || !semesterId || !week || week > 30) {
    return Response.json({ code: "INVALID_SCHEDULE_QUERY", message: "成员、学期或教学周参数无效。" }, { status: 422 });
  }

  const data = await getMemberWeekSchedule(studentId, semesterId, week);
  if (!data) return Response.json({ code: "STUDENT_NOT_FOUND", message: "该成员不存在或已停用。" }, { status: 404 });
  return Response.json({ data });
}
