import { differenceInCalendarDays, getISODay, isValid, parseISO } from "date-fns";
import type { ScheduleSemester } from "@/lib/schedule-types";

export type OccupiedCourse = {
  studentId: number;
  startPeriod: number;
  endPeriod: number;
};

export type AvailabilityRange = {
  startPeriod: number;
  endPeriod: number;
};

export function resolveTeachingDate(date: string, semester: ScheduleSemester) {
  const parsed = parseISO(date);
  if (!isValid(parsed) || date < semester.startDate || date > semester.endDate) return null;
  const week = Math.floor(differenceInCalendarDays(parsed, parseISO(semester.startDate)) / 7) + 1;
  if (week < 1 || week > semester.weekCount) return null;
  return { week, weekday: getISODay(parsed) };
}

export function contiguousRanges(periods: number[], minimum: number): AvailabilityRange[] {
  if (periods.length === 0) return [];
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  const ranges: AvailabilityRange[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    if (previous - start + 1 >= minimum) ranges.push({ startPeriod: start, endPeriod: previous });
    start = current;
    previous = current;
  }
  return ranges;
}

export function calculateAvailability(memberIds: number[], periodNos: number[], occupiedCourses: OccupiedCourse[], minimum: number) {
  const occupiedByMember = new Map(memberIds.map((id) => [id, new Set<number>()]));
  for (const course of occupiedCourses) {
    const occupied = occupiedByMember.get(course.studentId);
    if (!occupied) continue;
    for (let period = course.startPeriod; period <= course.endPeriod; period += 1) occupied.add(period);
  }

  const allDayFreeStudentIds = memberIds.filter((id) => occupiedByMember.get(id)?.size === 0);
  const freeStudentIdsByPeriod = periodNos.map((periodNo) => ({
    periodNo,
    studentIds: memberIds.filter((id) => !occupiedByMember.get(id)?.has(periodNo)),
  }));
  const commonFreePeriods = freeStudentIdsByPeriod
    .filter((item) => item.studentIds.length === memberIds.length)
    .map((item) => item.periodNo);

  return {
    allDayFreeStudentIds,
    freeStudentIdsByPeriod,
    commonFreePeriods,
    ranges: contiguousRanges(commonFreePeriods, minimum),
  };
}
