"use client";

import { differenceInCalendarDays, parseISO, startOfDay } from "date-fns";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { CourseDialog } from "@/components/course-dialog";
import { ScheduleBoard } from "@/components/schedule-board";
import { WeekSwitcher } from "@/components/week-switcher";
import type { CourseInput } from "@/lib/course-schema";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";

function getCurrentWeek(startDate: string, weekCount: number) {
  const elapsedDays = differenceInCalendarDays(startOfDay(new Date()), parseISO(startDate));
  return Math.min(weekCount, Math.max(1, Math.floor(elapsedDays / 7) + 1));
}

function normalizeCourse(value: ScheduleCourse): ScheduleCourse {
  return { ...value, weeks: value.weeks.map(Number) };
}

export function MyScheduleEditor({ semester, periods, initialCourses }: { semester: ScheduleSemester; periods: SchedulePeriod[]; initialCourses: ScheduleCourse[] }) {
  const [week, setWeek] = useState(() => getCurrentWeek(semester.startDate, semester.weekCount));
  const [courseItems, setCourseItems] = useState(initialCourses);
  const [editing, setEditing] = useState<ScheduleCourse | null>(null);
  const [slot, setSlot] = useState<{ weekday: number; period: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function openNew(weekday = 1, period = 1) {
    setEditing(null);
    setSlot({ weekday, period });
    setError("");
    setDialogOpen(true);
  }

  function openEdit(course: ScheduleCourse) {
    setEditing(course);
    setSlot(null);
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setError("");
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function saveCourse(input: CourseInput) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editing ? `/api/my/courses/${editing.id}` : "/api/my/courses", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "课程保存失败，请稍后重试。");
      const saved = normalizeCourse(body.data as ScheduleCourse);
      setCourseItems((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]);
      setDialogOpen(false);
      showNotice(editing ? "课程修改已保存" : "新课程已添加");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课程保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCourse() {
    if (!editing || !window.confirm(`确定删除“${editing.name}”吗？`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/my/courses/${editing.id}`, { method: "DELETE" });
      const body = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(body?.message || "课程删除失败，请稍后重试。");
      setCourseItems((items) => items.filter((item) => item.id !== editing.id));
      setDialogOpen(false);
      showNotice("课程已删除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课程删除失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="个人课表" title="我的课表" description="点击空白格添加课程，点击课程卡片进行修改。保存后，其他成员即可看到你的最新课表。" actions={<button className="button primary" onClick={() => openNew()}><Plus size={17} /> 添加课程</button>} />
      {notice && <div className="toast" role="status">✓ {notice}</div>}
      <section className="panel timetable-panel">
        <div className="table-toolbar">
          <WeekSwitcher semesterName={semester.name} week={week} weekCount={semester.weekCount} onChange={setWeek} />
          <div className="legend"><span><i className="legend-dot course" />有课</span><span><i className="legend-dot empty" />点击空白格添加</span></div>
        </div>
        <ScheduleBoard courses={courseItems} week={week} periods={periods} semesterStartDate={semester.startDate} editable onCellClick={openNew} onCourseClick={openEdit} />
      </section>
      <CourseDialog open={dialogOpen} course={editing} initialSlot={slot} semesterId={semester.id} weekCount={semester.weekCount} periods={periods} saving={saving} error={error} onClose={closeDialog} onSave={saveCourse} onDelete={editing ? deleteCourse : undefined} />
    </>
  );
}
