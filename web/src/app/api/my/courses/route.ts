import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { courseInputSchema } from "@/lib/course-schema";
import { CourseConflictError, DuplicateCourseError, saveCourse } from "@/lib/course-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export async function GET(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const semesterId = Number(new URL(request.url).searchParams.get("semester"));
  if (!Number.isInteger(semesterId) || semesterId <= 0) return Response.json({ code: "INVALID_SEMESTER", message: "请选择有效学期。" }, { status: 422 });
  const data = await db.select().from(courses).where(and(eq(courses.studentId, member.studentId), eq(courses.semesterId, semesterId)));
  return Response.json({ data });
}

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const parsed = courseInputSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_COURSE", message: parsed.error.issues[0]?.message ?? "课程信息不完整。", issues: parsed.error.flatten() }, { status: 422 });
  try {
    const data = await saveCourse({ input: parsed.data, studentId: member.studentId, actorUserId: member.userId });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof CourseConflictError) return Response.json({ code: "COURSE_CONFLICT", message: error.message, conflict: error.conflict }, { status: 409 });
    if (error instanceof DuplicateCourseError) return Response.json({ code: "DUPLICATE_COURSE", message: error.message }, { status: 409 });
    const message = error instanceof Error ? error.message : "SAVE_FAILED";
    return Response.json({ code: message, message: "课程保存失败，请检查学期、周次和节次配置。" }, { status: 422 });
  }
}
