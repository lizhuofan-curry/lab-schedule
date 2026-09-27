import { courseInputSchema } from "@/lib/course-schema";
import { CourseConflictError, DuplicateCourseError, removeCourse, saveCourse } from "@/lib/course-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

function parseId(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const courseId = parseId((await params).id);
  if (!courseId) return Response.json({ code: "INVALID_ID", message: "课程编号无效。" }, { status: 422 });
  const parsed = courseInputSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_COURSE", message: parsed.error.issues[0]?.message ?? "课程信息不完整。" }, { status: 422 });
  try {
    const data = await saveCourse({ input: parsed.data, studentId: member.studentId, actorUserId: member.userId, courseId });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof CourseConflictError) return Response.json({ code: "COURSE_CONFLICT", message: error.message, conflict: error.conflict }, { status: 409 });
    if (error instanceof DuplicateCourseError) return Response.json({ code: "DUPLICATE_COURSE", message: error.message }, { status: 409 });
    if (error instanceof Error && error.message === "FORBIDDEN_OWNER") return Response.json({ code: "FORBIDDEN_OWNER", message: "不能修改其他成员的课程。" }, { status: 403 });
    if (error instanceof Error && error.message === "COURSE_NOT_FOUND") return Response.json({ code: "COURSE_NOT_FOUND", message: "课程不存在。" }, { status: 404 });
    return Response.json({ code: "UPDATE_FAILED", message: "课程修改失败，请检查输入。" }, { status: 422 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const courseId = parseId((await params).id);
  if (!courseId) return Response.json({ code: "INVALID_ID", message: "课程编号无效。" }, { status: 422 });
  try {
    await removeCourse({ courseId, studentId: member.studentId, actorUserId: member.userId });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_OWNER") return Response.json({ code: "FORBIDDEN_OWNER", message: "不能删除其他成员的课程。" }, { status: 403 });
    return Response.json({ code: "COURSE_NOT_FOUND", message: "课程不存在。" }, { status: 404 });
  }
}
