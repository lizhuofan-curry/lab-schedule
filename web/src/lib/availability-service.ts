import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { db } from "@/db";
import { courses, periods, semesters, students } from "@/db/schema";
import { addRangeTimes, calculateAvailability, resolveTeachingDate } from "@/lib/availability-types";
import { resolveMemberGrade } from "@/lib/member-grade";

export class AvailabilityError extends Error {
  constructor(public code: "OUTSIDE_SEMESTER" | "MEMBER_NOT_FOUND" | "NO_MEMBERS" | "DATE_RANGE_TOO_LARGE" | "INVALID_PERIOD_RANGE", message: string) {
    super(message);
  }
}

export type AvailabilityQuery = {
  date: string;
  dateTo?: string;
  studentIds: number[];
  minimumConsecutivePeriods: number;
  minimumMinutes?: number;
  weekdays?: number[];
  startPeriod?: number;
  endPeriod?: number;
};

export async function queryAvailability(input: AvailabilityQuery) {
  const studentIds = [...new Set(input.studentIds)];
  if (studentIds.length === 0) throw new AvailabilityError("NO_MEMBERS", "请至少选择一位成员。");

  const dateTo = input.dateTo ?? input.date;
  const startDate = parseISO(input.date);
  const endDate = parseISO(dateTo);
  if (!isValid(startDate) || !isValid(endDate)) throw new AvailabilityError("DATE_RANGE_TOO_LARGE", "日期格式无效，请重新选择日期。");
  const dayCount = differenceInCalendarDays(endDate, startDate) + 1;
  if (dayCount < 1 || dayCount > 31) throw new AvailabilityError("DATE_RANGE_TOO_LARGE", "日期范围需为 1–31 天，请缩短查询范围。");
  if ((input.startPeriod === undefined) !== (input.endPeriod === undefined) || (input.startPeriod !== undefined && input.endPeriod !== undefined && input.startPeriod > input.endPeriod)) {
    throw new AvailabilityError("INVALID_PERIOD_RANGE", "结束节次不能早于开始节次。");
  }

  const semesterRows = await db.select({
    id: semesters.id, name: semesters.name, startDate: semesters.startDate,
    endDate: semesters.endDate, weekCount: semesters.weekCount,
  }).from(semesters).orderBy(asc(semesters.startDate));
  const semester = semesterRows.find((item) => input.date >= item.startDate && dateTo <= item.endDate);
  if (!semester) throw new AvailabilityError("OUTSIDE_SEMESTER", "所选日期范围不在同一个已配置学期内，请调整日期。");

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
  const dates = Array.from({ length: dayCount }, (_, index) => format(addDays(startDate, index), "yyyy-MM-dd"));
  const minimumMinutes = input.minimumMinutes ?? 0;
  const days = dates.flatMap((date) => {
    const teachingDate = resolveTeachingDate(date, semester);
    if (!teachingDate) throw new AvailabilityError("OUTSIDE_SEMESTER", "所选日期超出该学期的教学周范围，请更换日期。");
    if (input.weekdays?.length && !input.weekdays.includes(teachingDate.weekday)) return [];
    const occupied = courseRows.filter((course) => course.weekday === teachingDate.weekday && course.weeks.map(Number).includes(teachingDate.week));
    const calculated = calculateAvailability(studentIds, periodNos, occupied, input.minimumConsecutivePeriods);
    const ranges = addRangeTimes(calculated.ranges, periodRows).filter((range) => range.durationMinutes >= minimumMinutes);
    const windowPeriods = input.startPeriod === undefined || input.endPeriod === undefined
      ? []
      : periodNos.filter((periodNo) => periodNo >= input.startPeriod! && periodNo <= input.endPeriod!);
    const freeStudentIdsForWindow = windowPeriods.length === 0 ? [] : studentIds.filter((studentId) =>
      windowPeriods.every((periodNo) => calculated.freeStudentIdsByPeriod.find((item) => item.periodNo === periodNo)?.studentIds.includes(studentId)),
    );
    return [{ date, ...teachingDate, ...calculated, ranges, freeStudentIdsForWindow }];
  });

  return {
    semester,
    members: memberRows.map((member) => ({ ...member, grade: resolveMemberGrade(member.studentNo) })),
    periods: periodRows,
    days,
  };
}
