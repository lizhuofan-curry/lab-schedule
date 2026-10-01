import { deleteGroup, GroupServiceError, renameGroup } from "@/lib/group-service";
import { groupNameSchema } from "@/lib/group-schema";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function groupError(error: unknown) {
  if (error instanceof GroupServiceError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
  return Response.json({ code: "GROUP_SAVE_FAILED", message: "小组保存失败，请稍后重试。" }, { status: 500 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const groupId = parseId((await params).id);
  if (!groupId) return Response.json({ code: "INVALID_GROUP_ID", message: "小组编号无效。" }, { status: 422 });
  const parsed = groupNameSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_GROUP", message: parsed.error.issues[0]?.message ?? "小组名称无效。" }, { status: 422 });
  try {
    return Response.json({ data: await renameGroup(groupId, parsed.data.name, member) });
  } catch (error) {
    return groupError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const groupId = parseId((await params).id);
  if (!groupId) return Response.json({ code: "INVALID_GROUP_ID", message: "小组编号无效。" }, { status: 422 });
  try {
    await deleteGroup(groupId, member);
    return new Response(null, { status: 204 });
  } catch (error) {
    return groupError(error);
  }
}

