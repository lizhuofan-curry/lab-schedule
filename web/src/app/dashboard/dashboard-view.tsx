"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Clock3, Search, UserCheck, Users } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { CourseDetailDialog } from "@/components/course-detail-dialog";
import { ScheduleBoard } from "@/components/schedule-board";
import { WeekSwitcher } from "@/components/week-switcher";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import type { ScheduleMember } from "@/lib/schedule-service";
import { memberGradeLabels, type MemberGrade } from "@/lib/member-grade";
import { findCurrentCourse, getShanghaiClock } from "@/lib/current-course-status";

type DashboardCourse = ScheduleCourse & { studentId: number };

export function DashboardView({ semester, periods, members, courses, statusCourses, statusDate, currentTimeIso, week, selectedStudentId, stats, totalMembers, currentUser, guest = false }: {
  semester: ScheduleSemester; periods: SchedulePeriod[]; members: ScheduleMember[]; courses: DashboardCourse[]; statusCourses: DashboardCourse[];
  statusDate: string; currentTimeIso: string;
  week: number; selectedStudentId: number | null; totalMembers: number;
  stats: { registered: number; todayFree: number; commonRangeCount: number; todayInSemester: boolean };
  currentUser: { name: string; studentNo: string };
  guest?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<MemberGrade | "all">("all");
  const [selected, setSelected] = useState(selectedStudentId);
  const [now, setNow] = useState(() => new Date(currentTimeIso));
  const [detailCourse, setDetailCourse] = useState<ScheduleCourse | null>(null);
  const refreshedForDate = useRef(statusDate);
  const filtered = members.filter((member) => (grade === "all" || member.grade === grade) && (member.name.includes(query) || (member.studentNo ?? "").includes(query)));
  const selectedMember = members.find((member) => member.id === selected) ?? members[0];
  const selectedCourses = useMemo(() => courses.filter((course) => course.studentId === selectedMember?.id), [courses, selectedMember?.id]);
  const clock = getShanghaiClock(now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (clock.date !== statusDate && refreshedForDate.current !== clock.date) {
      refreshedForDate.current = clock.date;
      router.refresh();
    }
  }, [clock.date, router, statusDate]);

  return <AppShell currentUser={currentUser} guest={guest}>
    <PageHeader eyebrow={guest ? "游客只读访问" : `你好，${currentUser.name}`} title="课表总览" description={guest ? "你可以查看成员课表与空闲时间；注册后才能维护自己的课表。" : "这里显示数据库中的真实成员和课表，新增或修改课程后会同步更新。"} actions={<div className="dashboard-header-actions"><div className="live-clock" role="timer" aria-label={`当前北京时间 ${clock.dateLabel} ${clock.weekdayLabel} ${clock.timeLabel}`}><Clock3 size={18} /><span><small>当前北京时间</small><strong>{clock.dateLabel} {clock.weekdayLabel} {clock.timeLabel}</strong></span></div><WeekSwitcher week={week} weekCount={semester.weekCount} semesterName={semester.name} onChange={(next) => router.push(`/dashboard?week=${next}`)} /></div>} />
    <section className="stat-grid">
      <article className="stat-card"><div className="stat-icon green"><Users size={20} /></div><div><span>实验室成员</span><strong>{totalMembers}</strong><small>{stats.registered} 人已注册</small></div></article>
      <article className="stat-card"><div className="stat-icon rust"><UserCheck size={20} /></div><div><span>今天全天无课</span><strong>{stats.todayInSemester ? stats.todayFree : "—"}</strong><small>{stats.todayInSemester ? "按今天实际生效课程统计" : "当前日期不在本学期"}</small></div></article>
      <article className="stat-card"><div className="stat-icon blue"><CalendarCheck size={20} /></div><div><span>本周共同空闲</span><strong>{stats.commonRangeCount}</strong><small>全体已注册成员，至少连续 2 节</small></div></article>
    </section>
    <div className="dashboard-layout">
      <section className="panel member-panel">
        <div className="panel-heading"><div><span className="eyebrow">真实成员目录</span><h2>选择一位同学</h2></div><span className="count-badge">{filtered.length} 人</span></div>
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或学号" /></label>
        <div className="grade-filter" role="group" aria-label="按年级筛选">
          {(["all", "sophomore", "junior", "postgraduate"] as const).map((value) => <button key={value} type="button" className={grade === value ? "active" : ""} onClick={() => setGrade(value)}>{value === "all" ? "全部" : memberGradeLabels[value]}</button>)}
        </div>
        <div className="member-list">{filtered.map((member) => {
          const currentCourse = findCurrentCourse({ now, semester, periods, courses: statusCourses, studentId: member.id });
          return <button key={member.id} className={selected === member.id ? "member-row selected" : "member-row"} onClick={() => { setSelected(member.id); setDetailCourse(null); }}><span className="avatar">{member.name.slice(-1)}</span><span className="member-copy"><strong>{member.name}</strong><small>{member.studentNo ?? "学号待补"} · {memberGradeLabels[member.grade]}</small></span><span className={currentCourse ? "status-dot busy" : "status-dot free"} title={currentCourse ? `正在上：${currentCourse.name}` : "当前时间没有课程"}>{currentCourse ? "有课" : "空闲"}</span></button>;
        })}</div>
      </section>
      <section className="panel schedule-panel">
        <div className="panel-heading"><div><span className="eyebrow">第 {week} 周课表</span><h2>{selectedMember?.name ?? "暂无成员"}的课表</h2></div><Link className="text-link" href="/members">查看详情 <ArrowRight size={16} /></Link></div>
        <ScheduleBoard courses={selectedCourses} week={week} periods={periods} semesterStartDate={semester.startDate} compact onCourseClick={setDetailCourse} />
      </section>
    </div>
    <section className="callout"><div><span className="eyebrow light">需要安排多人会议？</span><h2>一次找到所有人的共同空闲</h2><p>系统会从数据库读取所选成员在指定日期真正生效的课程。</p></div><Link href="/availability" className="button light">开始查询 <ArrowRight size={17} /></Link></section>
    <CourseDetailDialog course={detailCourse} periods={periods} memberName={selectedMember?.name} onClose={() => setDetailCourse(null)} />
  </AppShell>;
}
