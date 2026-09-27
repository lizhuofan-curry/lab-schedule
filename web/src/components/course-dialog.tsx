"use client";

import { X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { CourseInput } from "@/lib/course-schema";
import { buildWeeks, type ScheduleCourse, type SchedulePeriod, weekdays } from "@/lib/schedule-types";

type WeekType = "all" | "odd" | "even";
type Draft = Omit<CourseInput, "semesterId" | "weeks"> & { startWeek: number; endWeek: number; weekType: WeekType };

function draftFromCourse(course: ScheduleCourse | null | undefined, slot: { weekday: number; period: number } | null | undefined, weekCount: number): Draft {
  if (course) {
    const sortedWeeks = [...course.weeks].sort((a, b) => a - b);
    const weekType: WeekType = sortedWeeks.every((week) => week % 2 === 1) ? "odd" : sortedWeeks.every((week) => week % 2 === 0) ? "even" : "all";
    return { name: course.name, teacher: course.teacher ?? "", location: course.location ?? "", weekday: course.weekday, startPeriod: course.startPeriod, endPeriod: course.endPeriod, startWeek: sortedWeeks[0] ?? 1, endWeek: sortedWeeks.at(-1) ?? weekCount, weekType, color: course.color, note: course.note ?? "" };
  }
  const period = slot?.period ?? 1;
  return { name: "", teacher: "", location: "", weekday: slot?.weekday ?? 1, startPeriod: period, endPeriod: period, startWeek: 1, endWeek: weekCount, weekType: "all", color: "#DDE9E4", note: "" };
}

type CourseDialogProps = {
  open: boolean;
  course?: ScheduleCourse | null;
  initialSlot?: { weekday: number; period: number } | null;
  semesterId: number;
  weekCount: number;
  periods: SchedulePeriod[];
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (draft: CourseInput) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
};

export function CourseDialog(props: CourseDialogProps) {
  if (!props.open) return null;
  return <CourseDialogForm key={props.course?.id ?? `${props.initialSlot?.weekday}-${props.initialSlot?.period}`} {...props} />;
}

function CourseDialogForm({ course, initialSlot, semesterId, weekCount, periods, saving, error, onClose, onSave, onDelete }: CourseDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromCourse(course, initialSlot, weekCount));

  function submit(event: FormEvent) {
    event.preventDefault();
    const startWeek = Math.min(draft.startWeek, draft.endWeek);
    const endWeek = Math.max(draft.startWeek, draft.endWeek);
    onSave({ semesterId, name: draft.name, teacher: draft.teacher || null, location: draft.location || null, weekday: draft.weekday, startPeriod: Math.min(draft.startPeriod, draft.endPeriod), endPeriod: Math.max(draft.startPeriod, draft.endPeriod), weeks: buildWeeks(startWeek, endWeek, draft.weekType), note: draft.note || null, color: draft.color });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <div className="dialog-header">
          <div><span className="eyebrow">{course ? "修改课程" : "添加课程"}</span><h2>{course ? course.name : "安排新的课程"}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="form-grid">
          <label className="field full"><span>课程名称 *</span><input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：机器学习" autoFocus /></label>
          <label className="field"><span>星期 *</span><select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
          <label className="field"><span>周次类型</span><select value={draft.weekType} onChange={(event) => setDraft({ ...draft, weekType: event.target.value as WeekType })}><option value="all">每周</option><option value="odd">单周</option><option value="even">双周</option></select></label>
          <label className="field"><span>开始节次 *</span><select value={draft.startPeriod} onChange={(event) => setDraft({ ...draft, startPeriod: Number(event.target.value) })}>{periods.map((period) => <option key={period.periodNo} value={period.periodNo}>{period.name}（{period.startTime.slice(0, 5)}）</option>)}</select></label>
          <label className="field"><span>结束节次 *</span><select value={draft.endPeriod} onChange={(event) => setDraft({ ...draft, endPeriod: Number(event.target.value) })}>{periods.map((period) => <option key={period.periodNo} value={period.periodNo}>{period.name}（{period.endTime.slice(0, 5)}结束）</option>)}</select></label>
          <label className="field"><span>开始周 *</span><input type="number" min="1" max={weekCount} value={draft.startWeek} onChange={(event) => setDraft({ ...draft, startWeek: Number(event.target.value) })} /></label>
          <label className="field"><span>结束周 *</span><input type="number" min="1" max={weekCount} value={draft.endWeek} onChange={(event) => setDraft({ ...draft, endWeek: Number(event.target.value) })} /></label>
          <label className="field"><span>任课教师</span><input maxLength={80} value={draft.teacher ?? ""} onChange={(event) => setDraft({ ...draft, teacher: event.target.value })} placeholder="选填" /></label>
          <label className="field"><span>上课地点</span><input maxLength={120} value={draft.location ?? ""} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="选填" /></label>
          <label className="field full"><span>备注</span><textarea rows={3} maxLength={500} value={draft.note ?? ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="选填，仅自己可修改" /></label>
        </div>
        {error && <div className="form-error dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          {course && onDelete && <button type="button" className="button danger" onClick={onDelete} disabled={saving}>删除课程</button>}
          <span className="action-spacer" />
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>取消</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? "正在保存…" : "保存课程"}</button>
        </div>
      </form>
    </div>
  );
}
