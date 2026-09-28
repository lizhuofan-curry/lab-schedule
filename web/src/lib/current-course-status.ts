import { resolveTeachingDate } from "./availability-types.ts";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "./schedule-types.ts";

export type MemberCourse = ScheduleCourse & { studentId: number };

const shanghaiClockFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function timeToSeconds(value: string) {
  const [hour = 0, minute = 0, second = 0] = value.slice(0, 8).split(":").map(Number);
  return hour * 3600 + minute * 60 + second;
}

export function getShanghaiClock(now: Date) {
  const parts = Object.fromEntries(shanghaiClockFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const teachingWeekday = resolveTeachingDate(date, {
    id: 0,
    name: "clock",
    startDate: date,
    endDate: date,
    weekCount: 1,
  })?.weekday ?? 1;
  return {
    date,
    dateLabel: `${parts.year}/${parts.month}/${parts.day}`,
    timeLabel: `${parts.hour}:${parts.minute}:${parts.second}`,
    secondsOfDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    weekday: teachingWeekday,
    weekdayLabel: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][teachingWeekday - 1],
  };
}

export function findCurrentCourse({
  now,
  semester,
  periods,
  courses,
  studentId,
}: {
  now: Date;
  semester: ScheduleSemester;
  periods: SchedulePeriod[];
  courses: MemberCourse[];
  studentId: number;
}) {
  const clock = getShanghaiClock(now);
  const teachingDate = resolveTeachingDate(clock.date, semester);
  if (!teachingDate) return null;
  const periodByNo = new Map(periods.map((period) => [period.periodNo, period]));
  return courses.find((course) => {
    if (course.studentId !== studentId || course.weekday !== teachingDate.weekday || !course.weeks.includes(teachingDate.week)) return false;
    const start = periodByNo.get(course.startPeriod);
    const end = periodByNo.get(course.endPeriod);
    return Boolean(start && end && clock.secondsOfDay >= timeToSeconds(start.startTime) && clock.secondsOfDay <= timeToSeconds(end.endTime));
  }) ?? null;
}
