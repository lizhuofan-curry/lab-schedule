import type { ScheduleCourse, SchedulePeriod } from "./schedule-types.ts";

export type GroupScheduleMember = {
  studentId: number;
  name: string;
};

export type GroupScheduleCourse = ScheduleCourse & {
  studentId: number;
  memberName: string;
};

export type GroupLoadCell = {
  weekday: number;
  periodNo: number;
  courses: GroupScheduleCourse[];
  busyMemberIds: number[];
  busyCount: number;
  loadLevel: 0 | 1 | 2 | 3 | 4;
};

export function groupLoadLevel(busyCount: number, memberCount: number): 0 | 1 | 2 | 3 | 4 {
  if (busyCount <= 0 || memberCount <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((busyCount / memberCount) * 4))) as 1 | 2 | 3 | 4;
}

export function buildGroupLoadCells(
  members: GroupScheduleMember[],
  courses: GroupScheduleCourse[],
  periods: SchedulePeriod[],
) {
  return Array.from({ length: 7 }, (_, weekdayIndex) => weekdayIndex + 1).flatMap((weekday) =>
    periods.map((period): GroupLoadCell => {
      const slotCourses = courses.filter((course) =>
        course.weekday === weekday
        && period.periodNo >= course.startPeriod
        && period.periodNo <= course.endPeriod,
      );
      const busyMemberIds = [...new Set(slotCourses.map((course) => course.studentId))];
      return {
        weekday,
        periodNo: period.periodNo,
        courses: slotCourses,
        busyMemberIds,
        busyCount: busyMemberIds.length,
        loadLevel: groupLoadLevel(busyMemberIds.length, members.length),
      };
    }),
  );
}

export function summarizeGroupLoad(cells: GroupLoadCell[]) {
  const busiest = cells.reduce<GroupLoadCell | null>((current, cell) =>
    !current || cell.busyCount > current.busyCount ? cell : current, null);
  return {
    allFreeCount: cells.filter((cell) => cell.busyCount === 0).length,
    busiest,
  };
}
