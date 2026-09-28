import "server-only";

import { and, arrayContains, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { courses, periods, semesters, students } from "@/db/schema";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import { calculateAvailability, resolveTeachingDate } from "@/lib/availability-types";
import { getShanghaiClock } from "@/lib/current-course-status";
import { resolveMemberGrade, type MemberGrade } from "@/lib/member-grade";

export type PersonalSchedule = {
  semester: ScheduleSemester;
  periods: SchedulePeriod[];
  courses: ScheduleCourse[];
};

export type ScheduleMember = {
  id: number;
  name: string;
  studentNo: string | null;
  registered: boolean;
  grade: MemberGrade;
};

export async function getCurrentScheduleConfig() {
  const [semester] = await db
    .select({ id: semesters.id, name: semesters.name, startDate: semesters.startDate, endDate: semesters.endDate, weekCount: semesters.weekCount })
    .from(semesters)
    .where(eq(semesters.isCurrent, true))
    .limit(1);

  if (!semester) return null;
  const periodRows = await db
    .select({ periodNo: periods.periodNo, name: periods.name, startTime: periods.startTime, endTime: periods.endTime })
    .from(periods)
    .where(eq(periods.semesterId, semester.id))
    .orderBy(asc(periods.periodNo));
  return { semester, periods: periodRows };
}

export async function getMemberDirectory(query = ""): Promise<ScheduleMember[]> {
  const normalizedQuery = query.trim();
  const search = normalizedQuery
    ? and(eq(students.enabled, true), or(ilike(students.name, `%${normalizedQuery}%`), ilike(students.studentNo, `%${normalizedQuery}%`)))
    : eq(students.enabled, true);
  const rows = await db
    .select({ id: students.id, name: students.name, studentNo: students.studentNo, userId: students.userId })
    .from(students)
    .where(search)
    .orderBy(asc(students.name), asc(students.id));
  return rows.map(({ userId, ...student }) => ({
    ...student,
    registered: userId !== null,
    grade: resolveMemberGrade(student.studentNo),
  }));
}

export async function getMemberWeekSchedule(studentId: number, semesterId: number, week: number) {
  const [member] = await db
    .select({ id: students.id, name: students.name, studentNo: students.studentNo })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.enabled, true)))
    .limit(1);
  if (!member) return null;

  const rows = await db
    .select({
      id: courses.id, semesterId: courses.semesterId, name: courses.name, teacher: courses.teacher,
      location: courses.location, weekday: courses.weekday, startPeriod: courses.startPeriod,
      endPeriod: courses.endPeriod, weeks: courses.weeks, note: courses.note, color: courses.color,
    })
    .from(courses)
    .where(and(
      eq(courses.studentId, studentId),
      eq(courses.semesterId, semesterId),
      arrayContains(courses.weeks, [week]),
    ))
    .orderBy(asc(courses.weekday), asc(courses.startPeriod));

  return { member, courses: rows.map((course) => ({ ...course, weeks: course.weeks.map(Number) })) };
}

export async function getPersonalSchedule(studentId: number): Promise<PersonalSchedule | null> {
  const config = await getCurrentScheduleConfig();
  if (!config) return null;
  const { semester, periods: periodRows } = config;

  const courseRows = await db.select({
      id: courses.id, semesterId: courses.semesterId, name: courses.name, teacher: courses.teacher,
      location: courses.location, weekday: courses.weekday, startPeriod: courses.startPeriod,
      endPeriod: courses.endPeriod, weeks: courses.weeks, note: courses.note, color: courses.color,
    }).from(courses)
      .where(and(eq(courses.studentId, studentId), eq(courses.semesterId, semester.id)))
      .orderBy(asc(courses.weekday), asc(courses.startPeriod));

  return {
    semester,
    periods: periodRows,
    courses: courseRows.map((course) => ({ ...course, weeks: course.weeks.map(Number) })),
  };
}

export async function getDashboardData(studentId: number, requestedWeek?: number) {
  const config = await getCurrentScheduleConfig();
  if (!config) return null;
  const members = (await getMemberDirectory()).filter((member) => member.registered);
  const now = new Date();
  const today = getShanghaiClock(now).date;
  const todayInfo = resolveTeachingDate(today, config.semester);
  const fallbackWeek = todayInfo?.week ?? 1;
  const week = requestedWeek && requestedWeek >= 1 && requestedWeek <= config.semester.weekCount ? requestedWeek : fallbackWeek;
  const memberIds = members.map((member) => member.id);
  const courseRows = memberIds.length === 0 ? [] : await db.select({
    id: courses.id, studentId: courses.studentId, semesterId: courses.semesterId, name: courses.name,
    teacher: courses.teacher, location: courses.location, weekday: courses.weekday,
    startPeriod: courses.startPeriod, endPeriod: courses.endPeriod, weeks: courses.weeks,
    note: courses.note, color: courses.color,
  }).from(courses).where(and(
    inArray(courses.studentId, memberIds),
    eq(courses.semesterId, config.semester.id),
    arrayContains(courses.weeks, [week]),
  )).orderBy(asc(courses.weekday), asc(courses.startPeriod));

  const periodNos = config.periods.map((period) => period.periodNo);
  const commonRangeCount = memberIds.length === 0 ? 0 : Array.from({ length: 7 }, (_, index) => index + 1)
    .reduce((total, weekday) => total + calculateAvailability(
      memberIds,
      periodNos,
      courseRows.filter((course) => course.weekday === weekday),
      2,
    ).ranges.length, 0);
  const statusCourseRows = !todayInfo || todayInfo.week === week ? courseRows : await db.select({
    id: courses.id, studentId: courses.studentId, semesterId: courses.semesterId, name: courses.name,
    teacher: courses.teacher, location: courses.location, weekday: courses.weekday,
    startPeriod: courses.startPeriod, endPeriod: courses.endPeriod, weeks: courses.weeks,
    note: courses.note, color: courses.color,
  }).from(courses).where(and(
    inArray(courses.studentId, memberIds),
    eq(courses.semesterId, config.semester.id),
    arrayContains(courses.weeks, [todayInfo.week]),
  )).orderBy(asc(courses.weekday), asc(courses.startPeriod));
  const todayFreeCount = !todayInfo ? 0 : memberIds.filter((id) => !statusCourseRows.some((course) => course.studentId === id && course.weekday === todayInfo.weekday)).length;

  return {
    ...config,
    members,
    courses: courseRows.map((course) => ({ ...course, weeks: course.weeks.map(Number) })),
    statusCourses: statusCourseRows.map((course) => ({ ...course, weeks: course.weeks.map(Number) })),
    statusDate: today,
    currentTimeIso: now.toISOString(),
    week,
    selectedStudentId: members.some((member) => member.id === studentId) ? studentId : members[0]?.id ?? null,
    stats: { registered: members.length, todayFree: todayFreeCount, commonRangeCount, todayInSemester: todayInfo !== null },
  };
}
