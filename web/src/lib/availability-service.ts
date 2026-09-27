import "server-only";

import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { courses, periods, semesters, students } from "@/db/schema";
import { calculateAvailability, resolveTeachingDate } from "@/lib/availability-types";

export class AvailabilityError extends Error {
  constructor(public code: "OUTSIDE_SEMESTER" | "MEMBER_NOT_FOUND" | "NO_MEMBERS", message: string) {
    super(message);
  }
}

export async function queryAvailability(input: { date: string; studentIds: number[]; minimumConsecutivePeriods: number }) {
  const studentIds = [...new Set(input.studentIds)];
  if (studentIds.length === 0) throw new AvailabilityError("NO_MEMBERS", "请至少选择一位成员。");

  const semesterRows = await db.select({
    id: semesters.id, name: semesters.name, startDate: semesters.startDate,
    endDate: semesters.endDate, weekCount: semesters.weekCount,
  }).from(semesters).orderBy(asc(semesters.startDate));
  const semester = semesterRows.find((item) => input.date >= item.startDate && input.date <= item.endDate);
  if (!semester) throw new AvailabilityError("OUTSIDE_SEMESTER", "所选日期不在已配置的学期内，请更换日期。");
  const teachingDate = resolveTeachingDate(input.date, semester);
  if (!teachingDate) throw new AvailabilityError("OUTSIDE_SEMESTER", "所选日期超出该学期的教学周范围，请更换日期。");

  const memberRows = await db.select({ id: students.id, name: students.name, studentNo: students.studentNo })
    .from(students)
    .where(and(inArray(students.id, studentIds), eq(students.enabled, true)))
    .orderBy(asc(students.name));
  if (memberRows.length !== studentIds.length) throw new AvailabilityError("MEMBER_NOT_FOUND", "部分成员不存在或已停用，请刷新页面后重试。");

  const [periodRows, occupiedRows] = await Promise.all([
    db.select({ periodNo: periods.periodNo, name: periods.name, startTime: periods.startTime, endTime: periods.endTime })
      .from(periods).where(eq(periods.semesterId, semester.id)).orderBy(asc(periods.periodNo)),
    db.select({ studentId: courses.studentId, startPeriod: courses.startPeriod, endPeriod: courses.endPeriod })
      .from(courses)
      .where(and(
        inArray(courses.studentId, studentIds),
        eq(courses.semesterId, semester.id),
        eq(courses.weekday, teachingDate.weekday),
        arrayContains(courses.weeks, [teachingDate.week]),
      )),
  ]);

  const calculated = calculateAvailability(studentIds, periodRows.map((item) => item.periodNo), occupiedRows, input.minimumConsecutivePeriods);
  return { date: input.date, semester, ...teachingDate, members: memberRows, periods: periodRows, ...calculated };
}
