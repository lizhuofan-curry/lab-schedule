"use client";

import { Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { ScheduleBoard } from "@/components/schedule-board";
import { WeekSwitcher } from "@/components/week-switcher";
import type { ScheduleMember } from "@/lib/schedule-service";
import type { ScheduleCourse, SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import { memberGradeLabels, type MemberGrade } from "@/lib/member-grade";

const avatarColors = ["#316B5B", "#C96946", "#4D6F95", "#8B6A9A", "#A78038", "#4F7E7A"];

function memberColor(id: number) {
  return avatarColors[(id - 1) % avatarColors.length];
}

export function MembersView({ currentStudentId, members, semester, periods, initialWeek, initialStudentId, initialCourses }: {
  currentStudentId: number;
  members: ScheduleMember[];
  semester: ScheduleSemester;
  periods: SchedulePeriod[];
  initialWeek: number;
  initialStudentId: number | null;
  initialCourses: ScheduleCourse[];
}) {
  const [selectedId, setSelectedId] = useState(initialStudentId);
  const [week, setWeek] = useState(initialWeek);
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<MemberGrade | "all">("all");
  const [courses, setCourses] = useState(initialCourses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const firstLoad = useRef(true);

  const selectedMember = members.find((member) => member.id === selectedId) ?? null;
  const filteredMembers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return members.filter((member) => {
      const matchesGrade = grade === "all" || member.grade === grade;
      const matchesKeyword = !keyword || member.name.toLowerCase().includes(keyword) || member.studentNo?.toLowerCase().includes(keyword);
      return matchesGrade && matchesKeyword;
    });
  }, [grade, members, query]);

  useEffect(() => {
    if (firstLoad.current && selectedId === initialStudentId && week === initialWeek) {
      firstLoad.current = false;
      return;
    }
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/students/${selectedId}/schedule?semester=${semester.id}&week=${week}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "课表加载失败，请刷新后重试。");
        setCourses(body.data.courses as ScheduleCourse[]);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "课表加载失败，请刷新后重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialStudentId, initialWeek, selectedId, semester.id, week]);

  function selectMember(id: number) {
    if (id === selectedId) return;
    setLoading(true);
    setError("");
    setSelectedId(id);
  }

  function changeWeek(nextWeek: number) {
    if (nextWeek === week) return;
    setLoading(true);
    setError("");
    setWeek(nextWeek);
  }

  return (
    <>
      <PageHeader eyebrow="实验室成员" title="查看成员课表" description="所有登录成员都能查看课表；课程内容只有本人可以修改。" actions={<WeekSwitcher semesterName={semester.name} week={week} weekCount={semester.weekCount} onChange={changeWeek} />} />
      <div className="members-page-layout">
        <aside className="panel member-browser">
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或学号" /></label>
          <div className="grade-filter" role="group" aria-label="按年级筛选">
            {(["all", "sophomore", "junior", "unknown"] as const).map((value) => <button key={value} className={grade === value ? "active" : ""} onClick={() => setGrade(value)}>{value === "all" ? "全部" : memberGradeLabels[value]}</button>)}
          </div>
          <div className="member-directory-count">显示 {filteredMembers.length} / {members.length} 位成员</div>
          {filteredMembers.map((member) => (
            <button key={member.id} className={member.id === selectedId ? "member-row selected" : "member-row"} onClick={() => selectMember(member.id)}>
              <span className="avatar" style={{ background: memberColor(member.id) }}>{member.name.slice(-1)}</span>
              <span className="member-copy"><strong>{member.name}{member.id === currentStudentId ? "（我）" : ""}</strong><small>{member.studentNo ?? "学号待补"} · {memberGradeLabels[member.grade]}</small></span>
              {!member.registered && <i className="registration pending">未注册</i>}
            </button>
          ))}
          {filteredMembers.length === 0 && <div className="member-list-empty">没有匹配的成员</div>}
        </aside>
        <section className="panel member-schedule">
          {selectedMember ? (
            <>
              <div className="profile-heading">
                <span className="avatar large" style={{ background: memberColor(selectedMember.id) }}>{selectedMember.name.slice(-1)}</span>
                <div><span className="eyebrow">成员课表 · {memberGradeLabels[selectedMember.grade]}</span><h2>{selectedMember.name}{selectedMember.id === currentStudentId ? "（我）" : ""}</h2><p>{selectedMember.studentNo ?? "学号待补"} · 第 {week} 周</p></div>
              </div>
              {error && <div className="form-error member-schedule-error" role="alert">{error}</div>}
              <div className={loading ? "schedule-loading" : ""} aria-busy={loading}>
                <ScheduleBoard week={week} courses={courses} periods={periods} semesterStartDate={semester.startDate} />
                {!loading && courses.length === 0 && <div className="schedule-empty-note">本周暂无课程</div>}
              </div>
            </>
          ) : (
            <div className="empty-result"><Users size={32} /><strong>暂无成员</strong><p>名册录入后即可在这里查看课表。</p></div>
          )}
        </section>
      </div>
    </>
  );
}
