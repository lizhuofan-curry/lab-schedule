import { getGroupWeekSchedule } from "@/lib/group-schedule-service";
import { GroupServiceError } from "@/lib/group-service";
import { getCurrentViewer, maskStudentNo, unauthorized } from "@/lib/server-auth";

function positiveInteger(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function groupScheduleError(error: unknown) {
  if (error instanceof GroupServiceError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
  return Response.json({ code: "GROUP_SCHEDULE_FAILED", message: "小组课表读取失败，请稍后重试。" }, { status: 500 });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentViewer(request.headers);
  if (!viewer) return unauthorized();
  const groupId = positiveInteger((await params).id);
  const rawWeek = new URL(request.url).searchParams.get("week");
  const week = rawWeek === null ? undefined : positiveInteger(rawWeek);
  if (!groupId || (rawWeek !== null && !week)) return Response.json({ code: "INVALID_GROUP_SCHEDULE_QUERY", message: "小组或教学周参数无效。" }, { status: 422 });
  try {
    const data = await getGroupWeekSchedule(groupId, week ?? undefined, viewer.kind === "member" ? viewer.member.studentId : null);
    if (viewer.kind !== "guest") return Response.json({ data });
    return Response.json({ data: { ...data, group: {
      ...data.group,
      members: data.group.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })),
      leader: { ...data.group.leader, studentNo: maskStudentNo(data.group.leader.studentNo) },
      canManage: false,
    } } });
  } catch (error) {
    return groupScheduleError(error);
  }
}
