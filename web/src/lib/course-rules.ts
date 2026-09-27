export type ConflictCourse = {
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
};

// BR-05：同一成员两门课程星期相同、周数组有交集且节次区间重叠时构成冲突。
export function coursesConflict(existing: ConflictCourse, candidate: ConflictCourse) {
  if (existing.weekday !== candidate.weekday) return false;
  if (!existing.weeks.some((week) => candidate.weeks.includes(week))) return false;
  return existing.startPeriod <= candidate.endPeriod && existing.endPeriod >= candidate.startPeriod;
}

// BR-04：周次去重并按升序排列，写入前标准化为具体教学周数组。
export function normalizeWeeks(weeks: number[]) {
  return [...new Set(weeks)].sort((a, b) => a - b);
}

export type DuplicateCourse = ConflictCourse & { name: string };

// BR-06：课程名、星期、节次、周次完全一致视为重复。
export function coursesDuplicate(existing: DuplicateCourse, candidate: DuplicateCourse) {
  return existing.name.trim() === candidate.name.trim()
    && existing.weekday === candidate.weekday
    && existing.startPeriod === candidate.startPeriod
    && existing.endPeriod === candidate.endPeriod
    && existing.weeks.length === candidate.weeks.length
    && existing.weeks.every((week, index) => week === candidate.weeks[index]);
}
