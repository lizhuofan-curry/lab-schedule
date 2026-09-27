import { and, arrayOverlaps, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, courses, periods, semesters } from "@/db/schema";
import type { CourseInput } from "@/lib/course-schema";
import { coursesConflict, coursesDuplicate, normalizeWeeks } from "@/lib/course-rules";

export class CourseConflictError extends Error {
  constructor(public conflict: { id: number; name: string }) {
    super(`与课程“${conflict.name}”时间冲突`);
  }
}

export class DuplicateCourseError extends Error {
  constructor() {
    super("已存在完全相同的课程");
  }
}

async function validateCourseConfiguration(input: CourseInput) {
  const [semester] = await db.select({ weekCount: semesters.weekCount }).from(semesters).where(eq(semesters.id, input.semesterId)).limit(1);
  if (!semester) throw new Error("SEMESTER_NOT_FOUND");
  if (input.weeks.some((week) => week > semester.weekCount)) throw new Error("WEEK_OUT_OF_RANGE");

  const validPeriods = await db.select({ no: periods.periodNo }).from(periods).where(and(eq(periods.semesterId, input.semesterId), gte(periods.periodNo, input.startPeriod), lte(periods.periodNo, input.endPeriod)));
  if (validPeriods.length !== input.endPeriod - input.startPeriod + 1) throw new Error("PERIOD_NOT_FOUND");
}

export async function saveCourse({ input, studentId, actorUserId, courseId }: { input: CourseInput; studentId: number; actorUserId: string; courseId?: number }) {
  await validateCourseConfiguration(input);
  const normalized = { ...input, weeks: normalizeWeeks(input.weeks) };

  return db.transaction(async (tx) => {
    // 所有权校验：更新前先确认课程存在且属于当前成员（BR-03）。
    let existing: typeof courses.$inferSelect | null = null;
    if (courseId) {
      const [row] = await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!row) throw new Error("COURSE_NOT_FOUND");
      if (row.studentId !== studentId) throw new Error("FORBIDDEN_OWNER");
      existing = row;
    }

    // BR-06：完全一致的课程视为重复，不重复写入。
    const duplicateCandidates = await tx.select({
      name: courses.name,
      weekday: courses.weekday,
      startPeriod: courses.startPeriod,
      endPeriod: courses.endPeriod,
      weeks: courses.weeks,
    }).from(courses).where(and(
      eq(courses.studentId, studentId),
      eq(courses.semesterId, normalized.semesterId),
      eq(courses.weekday, normalized.weekday),
      eq(courses.name, normalized.name),
      ...(courseId ? [ne(courses.id, courseId)] : []),
    ));
    if (duplicateCandidates.some((candidate) => coursesDuplicate(candidate, normalized))) {
      throw new DuplicateCourseError();
    }

    // BR-05：时间冲突检测。
    const candidates = await tx.select({
      id: courses.id,
      name: courses.name,
      weekday: courses.weekday,
      startPeriod: courses.startPeriod,
      endPeriod: courses.endPeriod,
      weeks: courses.weeks,
    }).from(courses).where(and(
      eq(courses.studentId, studentId),
      eq(courses.semesterId, normalized.semesterId),
      eq(courses.weekday, normalized.weekday),
      arrayOverlaps(courses.weeks, normalized.weeks),
      ...(courseId ? [ne(courses.id, courseId)] : []),
    ));

    const conflict = candidates.find((candidate) => coursesConflict(candidate, normalized));
    if (conflict) throw new CourseConflictError({ id: conflict.id, name: conflict.name });

    if (courseId && existing) {
      const [updated] = await tx.update(courses).set({ ...normalized, updatedAt: new Date() }).where(eq(courses.id, courseId)).returning();
      await tx.insert(auditLogs).values({ actorUserId, action: "course.update", entityType: "course", entityId: String(courseId), before: JSON.stringify(existing), after: JSON.stringify(updated) });
      return updated;
    }

    const [created] = await tx.insert(courses).values({ ...normalized, studentId }).returning();
    await tx.insert(auditLogs).values({ actorUserId, action: "course.create", entityType: "course", entityId: String(created.id), after: JSON.stringify(created) });
    return created;
  });
}

export async function removeCourse({ courseId, studentId, actorUserId }: { courseId: number; studentId: number; actorUserId: string }) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!before) throw new Error("COURSE_NOT_FOUND");
    if (before.studentId !== studentId) throw new Error("FORBIDDEN_OWNER");
    await tx.delete(courses).where(eq(courses.id, courseId));
    await tx.insert(auditLogs).values({ actorUserId, action: "course.delete", entityType: "course", entityId: String(courseId), before: JSON.stringify(before) });
  });
}
