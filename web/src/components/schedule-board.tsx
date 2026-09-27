"use client";

import { Plus } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { describeWeeks, type SchedulePeriod, weekdays } from "@/lib/schedule-types";

type ScheduleItem = {
  id: string | number;
  name: string;
  location?: string | null;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  color: string;
  weeks?: number[];
  startWeek?: number;
  endWeek?: number;
  weekType?: "all" | "odd" | "even";
};

type ScheduleBoardProps<T extends ScheduleItem> = {
  courses: T[];
  week: number;
  periods: SchedulePeriod[];
  semesterStartDate?: string;
  editable?: boolean;
  onCellClick?: (weekday: number, period: number) => void;
  onCourseClick?: (course: T) => void;
  compact?: boolean;
};

function isActive(course: ScheduleItem, week: number) {
  if (course.weeks) return course.weeks.includes(week);
  if (week < (course.startWeek ?? 1) || week > (course.endWeek ?? 30)) return false;
  if (course.weekType === "odd" && week % 2 === 0) return false;
  if (course.weekType === "even" && week % 2 !== 0) return false;
  return true;
}

export function ScheduleBoard<T extends ScheduleItem>({ courses, week, periods, semesterStartDate, editable = false, onCellClick, onCourseClick, compact = false }: ScheduleBoardProps<T>) {
  const displayPeriods = periods;
  const activeCourses = courses.filter((course) => isActive(course, week));
  const rowForPeriod = (periodNo: number) => periodNo + 1;
  const rowCount = displayPeriods.length;

  return (
    <div className={`schedule-scroll ${compact ? "compact" : ""}`}>
      <div className="schedule-grid" style={{ gridTemplateRows: `62px repeat(${rowCount}, ${compact ? 56 : 76}px)` }}>
        <div className="schedule-corner"><span>节次</span></div>
        {weekdays.map((day, index) => (
          <div className="schedule-day" key={day} style={{ gridColumn: index + 2 }}>
            <span>{day}</span><small>{semesterStartDate ? format(addDays(parseISO(semesterStartDate), (week - 1) * 7 + index), "MM/dd") : `${21 + index} 日`}</small>
          </div>
        ))}

        {displayPeriods.map((period) => (
          <div className="period-label" key={period.periodNo} style={{ gridRow: rowForPeriod(period.periodNo) }}>
            <strong>{period.name.replace("节", "")}</strong>
            {!compact && <small>{period.startTime.slice(0, 5)}–{period.endTime.slice(0, 5)}</small>}
          </div>
        ))}

        {weekdays.flatMap((_, dayIndex) => displayPeriods.map((period) => {
          const occupied = activeCourses.some((course) => course.weekday === dayIndex + 1 && period.periodNo >= course.startPeriod && period.periodNo <= course.endPeriod);
          return (
            <button
              key={`${dayIndex}-${period.periodNo}`}
              className={`schedule-cell ${editable && !occupied ? "editable" : ""}`}
              style={{ gridColumn: dayIndex + 2, gridRow: rowForPeriod(period.periodNo) }}
              onClick={() => editable && !occupied && onCellClick?.(dayIndex + 1, period.periodNo)}
              aria-label={`${weekdays[dayIndex]}第${period.periodNo}节${occupied ? "有课" : "无课"}`}
            >
              {editable && !occupied && <Plus className="cell-plus" size={16} />}
            </button>
          );
        }))}

        {activeCourses.map((course) => (
          <button
            key={course.id}
            className="course-card"
            style={{
              gridColumn: course.weekday + 1,
              gridRow: `${rowForPeriod(course.startPeriod)} / ${rowForPeriod(course.endPeriod) + 1}`,
              background: course.color,
            }}
            onClick={() => onCourseClick?.(course)}
          >
            <strong>{course.name}</strong>
            <span>{course.location || "地点待定"}</span>
            {!compact && <small>{course.weeks ? describeWeeks(course.weeks) : `第 ${course.startWeek}–${course.endWeek} 周`}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
