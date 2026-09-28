"use client";

import { Plus } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getShanghaiClock } from "@/lib/current-course-status";
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

function courseTone(name: string) {
  const hash = Array.from(name).reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
  return `course-tone-${hash % 5 + 1}`;
}

export function ScheduleBoard<T extends ScheduleItem>({ courses, week, periods, semesterStartDate, editable = false, onCellClick, onCourseClick, compact = false }: ScheduleBoardProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayHeaderRef = useRef<HTMLDivElement>(null);
  const [currentDate, setCurrentDate] = useState("");
  const displayPeriods = periods;
  const activeCourses = courses.filter((course) => isActive(course, week));
  const rowForPeriod = (periodNo: number) => periodNo + 1;
  const rowCount = displayPeriods.length;
  const displayedDates = useMemo(() => weekdays.map((_, index) => semesterStartDate
    ? format(addDays(parseISO(semesterStartDate), (week - 1) * 7 + index), "yyyy-MM-dd")
    : ""), [semesterStartDate, week]);
  const todayIndex = displayedDates.indexOf(currentDate);

  useEffect(() => {
    const updateDate = () => setCurrentDate(getShanghaiClock(new Date()).date);
    updateDate();
    const timer = window.setInterval(updateDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (todayIndex < 0 || !scrollRef.current || !todayHeaderRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current.scrollTo({ left: Math.max(0, todayHeaderRef.current.offsetLeft - 82), behavior: reduceMotion ? "auto" : "smooth" });
  }, [todayIndex, week]);

  return (
    <div ref={scrollRef} className={`schedule-scroll ${compact ? "compact" : ""}`}>
      <div className="schedule-grid" style={{ "--schedule-row-count": rowCount } as CSSProperties}>
        <div className="schedule-corner"><span>节次</span></div>
        {weekdays.map((day, index) => {
          const isToday = index === todayIndex;
          return (
          <div ref={isToday ? todayHeaderRef : undefined} className={`schedule-day ${isToday ? "today" : ""}`} key={day} style={{ gridColumn: index + 2 }} aria-current={isToday ? "date" : undefined}>
            <span>{day}</span><small>{isToday ? "今天 · " : ""}{displayedDates[index] ? format(parseISO(displayedDates[index]), "MM/dd") : `${21 + index} 日`}</small>
          </div>
          );
        })}

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
              className={`schedule-cell ${dayIndex === todayIndex ? "today-column" : ""} ${editable && !occupied ? "editable" : ""}`}
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
            className={`course-card ${courseTone(course.name)} ${course.weekday - 1 === todayIndex ? "today-course" : ""}`}
            style={{
              gridColumn: course.weekday + 1,
              gridRow: `${rowForPeriod(course.startPeriod)} / ${rowForPeriod(course.endPeriod) + 1}`,
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
