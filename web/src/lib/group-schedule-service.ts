import "server-only";

import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getDefaultScheduleWeek } from "@/lib/current-course-status";
import { getGroupDirectory, GroupServiceError } from "@/lib/group-service";
import type { GroupScheduleCourse } from "@/lib/group-schedule";
import { getCurrentScheduleConfig } from "@/lib/schedule-service";

export type GroupWeekSchedule = {
  group: Awaited<ReturnType<typeof getGroupDirectory>>[number];
  semester: NonNullable<Awaited<ReturnType<typeof getCurrentScheduleConfig>>>["semester"];
  periods: NonNullable<Awaited<ReturnType<typeof getCurrentScheduleConfig>>>["periods"];
  week: number;
  courses: GroupScheduleCourse[];
};

export async function getGroupWeekSchedule(groupId: number, requestedWeek?: number, viewerStudentId?: number | null): Promise<GroupWeekSchedule> {
  const [config, directory] = await Promise.all([
    getCurrentScheduleConfig(),
    getGroupDirectory(viewerStudentId),
  ]);
  if (!config) throw new GroupServiceError("SEMESTER_NOT_FOUND", "当前学期尚未初始化。", 404);
  const group = directory.find((item) => item.id === groupId);
  if (!group) throw new GroupServiceError("GROUP_NOT_FOUND", "小组不存在、已解散或没有启用成员。", 404);
  const week = requestedWeek ?? getDefaultScheduleWeek(new Date(), config.semester);
  if (!Number.isInteger(week) || week < 1 || week > config.semester.weekCount) {
    throw new GroupServiceError("INVALID_GROUP_WEEK", `周次需在 1–${config.semester.weekCount} 之间。`, 422);
  }

  const memberById = new Map(group.members.map((member) => [member.studentId, member]));
  const memberIds = [...memberById.keys()];
  const rows = memberIds.length === 0 ? [] : await db.select({
    id: courses.id,
    studentId: courses.studentId,
    semesterId: courses.semesterId,
    name: courses.name,
    teacher: courses.teacher,
    location: courses.location,
    weekday: courses.weekday,
    startPeriod: courses.startPeriod,
    endPeriod: courses.endPeriod,
    weeks: courses.weeks,
    note: courses.note,
    color: courses.color,
  }).from(courses).where(and(
    inArray(courses.studentId, memberIds),
    eq(courses.semesterId, config.semester.id),
    arrayContains(courses.weeks, [week]),
  )).orderBy(asc(courses.weekday), asc(courses.startPeriod), asc(courses.studentId));

  return {
    group,
    ...config,
    week,
    courses: rows.map((course) => ({
      ...course,
      weeks: course.weeks.map(Number),
      memberName: memberById.get(course.studentId)?.name ?? "未知成员",
    })),
  };
}
