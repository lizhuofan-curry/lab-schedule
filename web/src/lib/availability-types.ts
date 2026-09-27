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

export type AvailabilityPeriod = {
  periodNo: number;
  startTime: string;
  endTime: string;
};

export type TimedAvailabilityRange = AvailabilityRange & {
  startTime: string;
  endTime: string;
  durationMinutes: number;
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

function minutesOfDay(value: string) {
  const [hour = 0, minute = 0] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export function addRangeTimes(ranges: AvailabilityRange[], periods: AvailabilityPeriod[]): TimedAvailabilityRange[] {
  const periodByNo = new Map(periods.map((period) => [period.periodNo, period]));
  return ranges.flatMap((range) => {
    const included = periods.filter((period) => period.periodNo >= range.startPeriod && period.periodNo <= range.endPeriod);
    const start = periodByNo.get(range.startPeriod);
    const end = periodByNo.get(range.endPeriod);
    if (!start || !end || included.length !== range.endPeriod - range.startPeriod + 1) return [];
    return [{
      ...range,
      startTime: start.startTime.slice(0, 5),
      endTime: end.endTime.slice(0, 5),
      durationMinutes: included.reduce((total, period) => total + minutesOfDay(period.endTime) - minutesOfDay(period.startTime), 0),
    }];
  });
}
