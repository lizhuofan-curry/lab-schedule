import { GroupServiceError, removeGroupMember } from "@/lib/group-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const values = await params;
  const groupId = parseId(values.id);
  const studentId = parseId(values.studentId);
  if (!groupId || !studentId) return Response.json({ code: "INVALID_MEMBER", message: "小组或成员编号无效。" }, { status: 422 });
  try {
    await removeGroupMember(groupId, studentId, member);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof GroupServiceError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
    return Response.json({ code: "GROUP_MEMBER_REMOVE_FAILED", message: "移除组员失败，请稍后重试。" }, { status: 500 });
  }
}

