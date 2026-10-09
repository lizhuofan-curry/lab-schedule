import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { students } from "@/db/schema";
import { auth } from "@/lib/auth";

export const GUEST_COOKIE = "bci_guest_access";

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
  }).from(students).where(and(eq(students.userId, session.user.id), eq(students.enabled, true))).limit(1);

  if (!student?.studentNo) return null;
  return {
    userId: session.user.id,
    studentId: student.studentId,
    studentNo: student.studentNo,
    name: student.name,
  };
}

function hasGuestCookie(headerValue: string | null) {
  return headerValue?.split(";").some((item) => item.trim() === `${GUEST_COOKIE}=1`) ?? false;
}

export async function isGuestViewer(requestHeaders?: Headers) {
  const source = requestHeaders ?? await headers();
  return hasGuestCookie(source.get("cookie"));
}

export async function getCurrentViewer(requestHeaders?: Headers) {
  const member = await getCurrentMember(requestHeaders);
  if (member) return { kind: "member" as const, member };
  if (await isGuestViewer(requestHeaders)) return { kind: "guest" as const, member: null };
  return null;
}

export function maskStudentNo(studentNo: string | null) {
  if (!studentNo) return null;
  if (studentNo.length <= 4) return "****";
  return `${studentNo.slice(0, 2)}${"*".repeat(Math.min(6, studentNo.length - 4))}${studentNo.slice(-2)}`;
}

export function unauthorized(message = "请先登录。") {
  return Response.json({ code: "UNAUTHORIZED", message }, { status: 401 });
}

export function forbidden(message = "你没有执行此操作的权限。") {
  return Response.json({ code: "FORBIDDEN", message }, { status: 403 });
}
