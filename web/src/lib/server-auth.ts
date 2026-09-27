import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { students } from "@/db/schema";
import { auth } from "@/lib/auth";

export type CurrentMember = {
  userId: string;
  studentId: number;
  studentNo: string;
  name: string;
};

export async function getCurrentMember(requestHeaders?: Headers): Promise<CurrentMember | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? await headers() });
  if (!session) return null;

  const [student] = await db.select({
    studentId: students.id,
    studentNo: students.studentNo,
    name: students.name,
  }).from(students).where(eq(students.userId, session.user.id)).limit(1);

  if (!student?.studentNo) return null;
  return {
    userId: session.user.id,
    studentId: student.studentId,
    studentNo: student.studentNo,
    name: student.name,
  };
}

export function unauthorized(message = "请先登录。") {
  return Response.json({ code: "UNAUTHORIZED", message }, { status: 401 });
}

export function forbidden(message = "你没有执行此操作的权限。") {
  return Response.json({ code: "FORBIDDEN", message }, { status: 403 });
}
