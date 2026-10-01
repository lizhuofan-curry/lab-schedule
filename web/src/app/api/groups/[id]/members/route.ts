import { addGroupMember, GroupServiceError } from "@/lib/group-service";
import { groupMemberSchema } from "@/lib/group-schema";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const groupId = parseId((await params).id);
  if (!groupId) return Response.json({ code: "INVALID_GROUP_ID", message: "小组编号无效。" }, { status: 422 });
  const parsed = groupMemberSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_MEMBER", message: parsed.error.issues[0]?.message ?? "成员信息无效。" }, { status: 422 });
  try {
    return Response.json({ data: await addGroupMember(groupId, parsed.data.studentId, member) }, { status: 201 });
  } catch (error) {
    if (error instanceof GroupServiceError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
    return Response.json({ code: "GROUP_MEMBER_SAVE_FAILED", message: "添加组员失败，请稍后重试。" }, { status: 500 });
  }
}

