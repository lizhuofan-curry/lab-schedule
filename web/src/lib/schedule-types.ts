export const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

export type SchedulePeriod = {
  periodNo: number;
  name: string;
  startTime: string;
  endTime: string;
};

export type ScheduleSemester = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  weekCount: number;
};

export type ScheduleCourse = {
  id: number;
  semesterId: number;
  name: string;
  teacher: string | null;
  location: string | null;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  note: string | null;
  color: string;
};

export function buildWeeks(startWeek: number, endWeek: number, type: "all" | "odd" | "even") {
  return Array.from({ length: endWeek - startWeek + 1 }, (_, index) => startWeek + index)
    .filter((week) => type === "all" || (type === "odd" ? week % 2 === 1 : week % 2 === 0));
}

export function describeWeeks(weeks: number[]) {
  if (weeks.length === 0) return "未设置周次";
  const sorted = [...weeks].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted.at(-1) ?? first;
  const all = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  if (sorted.length === all.length) return `第 ${first}–${last} 周`;
  if (sorted.every((week) => week % 2 === 1)) return `第 ${first}–${last} 周（单周）`;
  if (sorted.every((week) => week % 2 === 0)) return `第 ${first}–${last} 周（双周）`;
  return `第 ${sorted.join("、")} 周`;
}
