import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "@/db";
import { courses, periods, semesters, students } from "@/db/schema";
import { addRangeTimes, calculateAvailability, resolveDateForWeek, resolveTeachingDate } from "@/lib/availability-types";
import { resolveMemberGrade } from "@/lib/member-grade";

export class AvailabilityError extends Error {
  constructor(public code: "OUTSIDE_SEMESTER" | "MEMBER_NOT_FOUND" | "NO_MEMBERS" | "INVALID_TIME_RANGE", message: string) {
    super(message);
  }
}

export type AvailabilityQuery = {
  weekday: number;
  week?: number;
  studentIds: number[];
  minimumMinutes?: number;
  startTime?: string;
  endTime?: string;
};

function minutesOfDay(value: string) {
  const [hour = 0, minute = 0] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export async function queryAvailability(input: AvailabilityQuery) {
  const studentIds = [...new Set(input.studentIds)];
  if (studentIds.length === 0) throw new AvailabilityError("NO_MEMBERS", "请至少选择一位成员。");

  if ((input.startTime === undefined) !== (input.endTime === undefined)) {
    throw new AvailabilityError("INVALID_TIME_RANGE", "请同时选择开始时间和结束时间。");
  }
  if (input.startTime !== undefined && input.endTime !== undefined && minutesOfDay(input.startTime) >= minutesOfDay(input.endTime)) {
    throw new AvailabilityError("INVALID_TIME_RANGE", "结束时间必须晚于开始时间。");
  }

  const [semester] = await db.select({
    id: semesters.id, name: semesters.name, startDate: semesters.startDate,
    endDate: semesters.endDate, weekCount: semesters.weekCount,
  }).from(semesters).where(eq(semesters.isCurrent, true)).orderBy(asc(semesters.startDate)).limit(1);
  if (!semester) throw new AvailabilityError("OUTSIDE_SEMESTER", "当前学期尚未配置，暂时不能查询。");

  const week = input.week ?? (resolveTeachingDate(format(new Date(), "yyyy-MM-dd"), semester)?.week ?? 1);
  if (week < 1 || week > semester.weekCount) throw new AvailabilityError("OUTSIDE_SEMESTER", `周次需在 1–${semester.weekCount} 之间。`);

  const memberRows = await db.select({ id: students.id, name: students.name, studentNo: students.studentNo })
    .from(students)
    .where(and(inArray(students.id, studentIds), eq(students.enabled, true)))
    .orderBy(asc(students.name));
  if (memberRows.length !== studentIds.length) throw new AvailabilityError("MEMBER_NOT_FOUND", "部分成员不存在或已停用，请刷新页面后重试。");

  const [periodRows, courseRows] = await Promise.all([
    db.select({ periodNo: periods.periodNo, name: periods.name, startTime: periods.startTime, endTime: periods.endTime })
      .from(periods).where(eq(periods.semesterId, semester.id)).orderBy(asc(periods.periodNo)),
    db.select({ studentId: courses.studentId, weekday: courses.weekday, weeks: courses.weeks, startPeriod: courses.startPeriod, endPeriod: courses.endPeriod })
      .from(courses)
      .where(and(inArray(courses.studentId, studentIds), eq(courses.semesterId, semester.id))),
  ]);

  const periodNos = periodRows.map((item) => item.periodNo);
  const occupied = courseRows.filter((course) => course.weekday === input.weekday && course.weeks.map(Number).includes(week));
  const calculated = calculateAvailability(studentIds, periodNos, occupied, 1);
  const minimumMinutes = input.minimumMinutes ?? 0;
  const ranges = addRangeTimes(calculated.ranges, periodRows).filter((range) => range.durationMinutes >= minimumMinutes);

  const windowPeriods = input.startTime === undefined || input.endTime === undefined
    ? periodNos
    : periodRows
        .filter((period) => minutesOfDay(period.startTime) < minutesOfDay(input.endTime!) && minutesOfDay(period.endTime) > minutesOfDay(input.startTime!))
        .map((period) => period.periodNo);
  const freeStudentIdsForWindow = windowPeriods.length === 0 ? [] : studentIds.filter((studentId) =>
    windowPeriods.every((periodNo) => calculated.freeStudentIdsByPeriod.find((item) => item.periodNo === periodNo)?.studentIds.includes(studentId)),
  );

  return {
    semester,
    members: memberRows.map((member) => ({ ...member, grade: resolveMemberGrade(member.studentNo) })),
    periods: periodRows,
    days: [{ date: resolveDateForWeek(week, input.weekday, semester), week, weekday: input.weekday, ranges, freeStudentIdsForWindow }],
  };
}
