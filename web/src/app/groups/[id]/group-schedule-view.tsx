"use client";

import { addDays, format, parseISO } from "date-fns";
import { BookOpenText, Clock3, MapPin, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WeekSwitcher } from "@/components/week-switcher";
import { getShanghaiClock } from "@/lib/current-course-status";
import { buildGroupLoadCells, summarizeGroupLoad, type GroupLoadCell } from "@/lib/group-schedule";
import type { GroupWeekSchedule } from "@/lib/group-schedule-service";
import { weekdays } from "@/lib/schedule-types";

async function loadWeek(groupId: number, week: number) {
  const response = await fetch(`/api/groups/${groupId}/schedule?week=${week}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "小组课表读取失败，请稍后重试。");
  return payload.data as GroupWeekSchedule;
}

function slotKey(cell: Pick<GroupLoadCell, "weekday" | "periodNo">) {
  return `${cell.weekday}-${cell.periodNo}`;
}

export function GroupScheduleView({ initialData }: { initialData: GroupWeekSchedule }) {
  const [data, setData] = useState(initialData);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayHeaderRef = useRef<HTMLDivElement>(null);
  const members = useMemo(() => data.group.members.map((member) => ({ studentId: member.studentId, name: member.name })), [data.group.members]);
  const cells = useMemo(() => buildGroupLoadCells(members, data.courses, data.periods), [data.courses, data.periods, members]);
  const summary = useMemo(() => summarizeGroupLoad(cells), [cells]);
  const selected = cells.find((cell) => slotKey(cell) === selectedKey) ?? null;
  const displayedDates = useMemo(() => weekdays.map((_, index) => format(addDays(parseISO(data.semester.startDate), (data.week - 1) * 7 + index), "yyyy-MM-dd")), [data.semester.startDate, data.week]);
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
    scrollRef.current.scrollTo({ left: Math.max(0, todayHeaderRef.current.offsetLeft - 76), behavior: reduceMotion ? "auto" : "smooth" });
  }, [todayIndex, data.week]);

  async function changeWeek(week: number) {
    if (week === data.week) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadWeek(data.group.id, week));
      setSelectedKey(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "小组课表读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  const selectedPeriod = selected ? data.periods.find((period) => period.periodNo === selected.periodNo) : null;
  const busyMembers = selected ? data.group.members.filter((member) => selected.busyMemberIds.includes(member.studentId)) : [];
  const freeMembers = selected ? data.group.members.filter((member) => !selected.busyMemberIds.includes(member.studentId)) : [];

  return <div className="group-schedule-page"><section className="panel group-schedule-panel">
    <header className="group-schedule-toolbar">
      <div><span className="eyebrow">第 {data.week} 周 · {data.group.members.length} 位成员</span><h2>整组忙碌强度</h2><p>统计每个节次有课的不同成员数；同一成员的冲突课程只计作一人。</p></div>
      <WeekSwitcher week={data.week} weekCount={data.semester.weekCount} semesterName={data.semester.name} onChange={(week) => void changeWeek(week)} />
    </header>

    <div className="group-load-summary" aria-live="polite">
      <div><UsersRound size={18} /><span><strong>{data.group.members.length}</strong><small>小组成员</small></span></div>
      <div><Clock3 size={18} /><span><strong>{summary.allFreeCount}</strong><small>全员空闲格</small></span></div>
      <div><BookOpenText size={18} /><span><strong>{summary.busiest?.busyCount ?? 0}</strong><small>单节最多有课</small></span></div>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading && <div className="group-schedule-loading" role="status">正在读取课表…</div>}

    <div className="group-overlay-layout">
      <div className="group-load-board">
        <div className="group-load-legend" aria-label="忙碌强度图例"><span>全员空闲</span>{[1, 2, 3, 4].map((level) => <i className={`load-${level}`} key={level} />)}<span>更多人有课</span></div>
        <div ref={scrollRef} className="group-load-scroll"><div className="group-load-grid" style={{ gridTemplateRows: `58px repeat(${data.periods.length}, 68px)` }}>
          <div className="group-load-corner">节次</div>
          {weekdays.map((day, index) => {
            const isToday = index === todayIndex;
            return <div ref={isToday ? todayHeaderRef : undefined} key={day} className={`group-load-day ${isToday ? "today" : ""}`} style={{ gridColumn: index + 2 }} aria-current={isToday ? "date" : undefined}><strong>{day}</strong><small>{isToday ? "今天 · " : ""}{format(parseISO(displayedDates[index]), "MM/dd")}</small></div>;
          })}
          {data.periods.map((period, index) => <div className="group-load-period" key={period.periodNo} style={{ gridRow: index + 2 }}><strong>{period.name}</strong><small>{period.startTime.slice(0, 5)}–{period.endTime.slice(0, 5)}</small></div>)}
          {cells.map((cell) => {
            const row = data.periods.findIndex((period) => period.periodNo === cell.periodNo) + 2;
            const active = selectedKey === slotKey(cell);
            return <button type="button" key={slotKey(cell)} className={`group-load-cell load-${cell.loadLevel} ${cell.weekday - 1 === todayIndex ? "today-column" : ""} ${active ? "selected" : ""}`} style={{ gridColumn: cell.weekday + 1, gridRow: row }} onClick={() => setSelectedKey(slotKey(cell))} aria-pressed={active} aria-label={`${weekdays[cell.weekday - 1]}第${cell.periodNo}节，${cell.busyCount}人有课，点击查看详情`}>
              {cell.busyCount === 0 ? <span>全员空闲</span> : <><strong>{cell.busyCount}<small> / {data.group.members.length}</small></strong><span>人有课</span></>}
            </button>;
          })}
        </div></div>
      </div>

      <aside className="group-slot-detail" aria-live="polite">
        {!selected ? <div className="group-slot-empty"><Clock3 size={24} /><strong>选择一个时间格</strong><p>这里会列出该节有课的成员，以及课程、教师和地点。</p></div> : <>
          <header><span className="eyebrow">{weekdays[selected.weekday - 1]} · 第 {selected.periodNo} 节</span><h3>{selectedPeriod ? `${selectedPeriod.startTime.slice(0, 5)}–${selectedPeriod.endTime.slice(0, 5)}` : "具体时间待补"}</h3><p>{selected.busyCount === 0 ? "全体成员都可以安排活动" : `${selected.busyCount} 人有课，${freeMembers.length} 人空闲`}</p></header>
          {busyMembers.length > 0 ? <div className="group-busy-list">{busyMembers.map((member) => {
            const memberCourses = selected.courses.filter((course) => course.studentId === member.studentId);
            return <article key={member.studentId}><div className="group-busy-member"><span className="avatar">{member.name.slice(-1)}</span><strong>{member.name}</strong></div>{memberCourses.map((course) => <div className="group-busy-course" key={course.id}><strong>{course.name}</strong><span><BookOpenText size={14} /> {course.teacher || "教师未填写"}</span><span><MapPin size={14} /> {course.location || "地点未填写"}</span></div>)}</article>;
          })}</div> : <div className="group-all-free"><strong>这一节没有成员上课</strong><p>适合安排组会、讨论或实验。</p></div>}
          {freeMembers.length > 0 && <div className="group-free-members"><span>空闲成员</span><p>{freeMembers.map((member) => member.name).join("、")}</p></div>}
        </>}
      </aside>
    </div>
  </section></div>;
}
