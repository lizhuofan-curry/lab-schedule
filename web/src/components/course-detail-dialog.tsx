"use client";

import { BookOpenText, CalendarDays, Clock3, MapPin, UserRound, X } from "lucide-react";
import { useEffect } from "react";
import { describeWeeks, type ScheduleCourse, type SchedulePeriod, weekdays } from "@/lib/schedule-types";

export function CourseDetailDialog({ course, periods, memberName, onClose }: {
  course: ScheduleCourse | null;
  periods: SchedulePeriod[];
  memberName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!course) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [course, onClose]);

  if (!course) return null;
  const start = periods.find((period) => period.periodNo === course.startPeriod);
  const end = periods.find((period) => period.periodNo === course.endPeriod);
  const periodLabel = course.startPeriod === course.endPeriod ? `第 ${course.startPeriod} 节` : `第 ${course.startPeriod}–${course.endPeriod} 节`;
  const timeLabel = start && end ? `${start.startTime.slice(0, 5)}–${end.endTime.slice(0, 5)}` : "时间待补";

  return (
    <div className="dialog-backdrop course-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="course-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="course-detail-title">
        <header className="course-detail-header">
          <div><span className="eyebrow">只读课程详情</span><h2 id="course-detail-title">{course.name}</h2>{memberName && <p>{memberName}的课表</p>}</div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭课程详情"><X size={20} /></button>
        </header>

        <dl className="course-detail-grid">
          <div><dt><UserRound size={16} />任课教师</dt><dd>{course.teacher || "未填写"}</dd></div>
          <div><dt><MapPin size={16} />上课地点</dt><dd>{course.location || "未填写"}</dd></div>
          <div><dt><CalendarDays size={16} />上课安排</dt><dd>{weekdays[course.weekday - 1]} · {periodLabel}</dd></div>
          <div><dt><Clock3 size={16} />具体时间</dt><dd>{timeLabel}</dd></div>
          <div className="full"><dt><CalendarDays size={16} />生效周次</dt><dd>{describeWeeks(course.weeks)}</dd></div>
          <div className="full course-description"><dt><BookOpenText size={16} />课程描述 / 备注</dt><dd>{course.note?.trim() || "暂无描述"}</dd></div>
        </dl>
        <footer className="course-detail-footer"><span>此处仅供查看，课程只能由本人修改。</span><button type="button" className="button primary" onClick={onClose}>知道了</button></footer>
      </article>
    </div>
  );
}
