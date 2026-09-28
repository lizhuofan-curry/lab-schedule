"use client";

import { ImagePlus, Plus, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { CourseDialog } from "@/components/course-dialog";
import { ScheduleBoard } from "@/components/schedule-board";
import { WeekSwitcher } from "@/components/week-switcher";
import type { CourseInput } from "@/lib/course-schema";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import { HenuSyncPanel } from "./henu-sync-panel";
import { getDefaultScheduleWeek } from "@/lib/current-course-status";

function normalizeCourse(value: ScheduleCourse): ScheduleCourse {
  return { ...value, weeks: value.weeks.map(Number) };
}

export function MyScheduleEditor({ semester, periods, initialCourses, studentNo }: { semester: ScheduleSemester; periods: SchedulePeriod[]; initialCourses: ScheduleCourse[]; studentNo: string }) {
  const [week, setWeek] = useState(() => getDefaultScheduleWeek(new Date(), semester));
  const [courseItems, setCourseItems] = useState(initialCourses);
  const [editing, setEditing] = useState<ScheduleCourse | null>(null);
  const [slot, setSlot] = useState<{ weekday: number; period: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showHenuSync, setShowHenuSync] = useState(false);

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
      <PageHeader eyebrow="个人课表" title="我的课表" description="点击空白格添加课程，点击课程卡片进行修改。保存后，其他成员即可看到你的最新课表。" actions={<div className="header-action-group"><button className="button secondary" onClick={() => { setShowHenuSync((value) => !value); setError(""); }}><RefreshCw size={17} /> 河大同步</button><Link className="button secondary" href="/my-schedule/import"><Upload size={17} /> 批量导入</Link><Link className="button secondary" href="/my-schedule/import/image"><ImagePlus size={17} /> 图片识别</Link><button className="button primary" onClick={() => openNew()}><Plus size={17} /> 添加课程</button></div>} />
      {notice && <div className="toast" role="status">✓ {notice}</div>}
      {showHenuSync && <HenuSyncPanel defaultStudentId={studentNo} />}
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
