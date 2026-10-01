import { createGroup, getGroupDirectory, GroupServiceError } from "@/lib/group-service";
import { groupNameSchema } from "@/lib/group-schema";
import { getCurrentMember, getCurrentViewer, maskStudentNo, unauthorized } from "@/lib/server-auth";

function groupError(error: unknown) {
  if (error instanceof GroupServiceError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
  return Response.json({ code: "GROUP_SAVE_FAILED", message: "小组保存失败，请稍后重试。" }, { status: 500 });
}

export async function GET(request: Request) {
  const viewer = await getCurrentViewer(request.headers);
  if (!viewer) return unauthorized();
  const studentId = viewer.kind === "member" ? viewer.member.studentId : null;
  const data = await getGroupDirectory(studentId);
  return Response.json({
    data: viewer.kind === "guest" ? data.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })),
      leader: { ...group.leader, studentNo: maskStudentNo(group.leader.studentNo) },
      canManage: false,
    })) : data,
  });
}

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized("请先以注册成员身份登录后再创建小组。");
  const parsed = groupNameSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_GROUP", message: parsed.error.issues[0]?.message ?? "小组名称无效。" }, { status: 422 });
  try {
    return Response.json({ data: await createGroup(parsed.data.name, member) }, { status: 201 });
  } catch (error) {
    return groupError(error);
  }
}

