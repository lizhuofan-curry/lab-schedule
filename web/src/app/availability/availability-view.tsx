"use client";

import { differenceInCalendarDays, getISODay, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Search, Users } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { memberGradeLabels, type MemberGrade } from "@/lib/member-grade";
import type { ScheduleMember } from "@/lib/schedule-service";
import type { SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import { weekdays } from "@/lib/schedule-types";

type SearchMode = "person" | "time" | "group";
type GradeFilter = "all" | MemberGrade;

type AvailabilityDay = {
  date: string;
  week: number;
  weekday: number;
  ranges: Array<{
    startPeriod: number;
    endPeriod: number;
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }>;
  freeStudentIdsForWindow: number[];
};

type AvailabilityResult = {
  members: Array<{ id: number; name: string; studentNo: string | null; grade: MemberGrade }>;
  periods: SchedulePeriod[];
  days: AvailabilityDay[];
};

const modeCopy: Record<SearchMode, { label: string; title: string; description: string }> = {
  person: { label: "查一个人", title: "这个人什么时候有空？", description: "选择成员和日期范围，查看每段空闲时间及持续时长。" },
  time: { label: "按时间找人", title: "这段时间谁有空？", description: "指定日期和节次，找出整段时间都没有课的成员。" },
  group: { label: "查共同空闲", title: "大家什么时候都有空？", description: "选择多位成员，寻找适合开会或分配任务的连续空闲。" },
};

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}月${day}日`;
}

export function AvailabilityView({ members, semester, currentUser, guest = false }: {
  members: ScheduleMember[];
  semester: ScheduleSemester;
  currentUser: { name: string; studentNo: string };
  guest?: boolean;
}) {
  const [mode, setMode] = useState<SearchMode>("person");
  const [grade, setGrade] = useState<GradeFilter>("all");
  const [personId, setPersonId] = useState<number | null>(members[0]?.id ?? null);
  const [selected, setSelected] = useState<number[]>(members.map((member) => member.id));
  const [weekday, setWeekday] = useState(() => getISODay(new Date()));
  const [week, setWeek] = useState(() => Math.max(1, Math.min(semester.weekCount, Math.floor(differenceInCalendarDays(new Date(), parseISO(semester.startDate)) / 7) + 1)));
  const [minimumMinutes, setMinimumMinutes] = useState(45);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:30");
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(members.length > 0);

  const visibleMembers = useMemo(
    () => members.filter((member) => grade === "all" || member.grade === grade),
    [grade, members],
  );
  const queryIds = useMemo(() => {
    if (mode === "person") return personId ? [personId] : [];
    if (mode === "time") return visibleMembers.map((member) => member.id);
    return selected;
  }, [mode, personId, selected, visibleMembers]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  useEffect(() => {
    if (queryIds.length === 0) return;
    const controller = new AbortController();
    fetch("/api/availability/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weekday,
        week,
        studentIds: queryIds,
        minimumMinutes: mode === "time" ? 0 : minimumMinutes,
        ...(mode === "time" && !allDay ? { startTime, endTime } : {}),
      }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "查询失败，请稍后重试。");
      setResult(payload.data);
    }).catch((reason: Error) => {
      if (reason.name !== "AbortError") {
        setResult(null);
        setError(reason.message);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [allDay, endTime, minimumMinutes, mode, queryIds, startTime, week, weekday]);

  function toggleMember(id: number) {
    setLoading(true);
    setError("");
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const selectedPerson = personId ? memberById.get(personId) : null;
  const freeWindowCount = result?.days.reduce((total, day) => total + day.freeStudentIdsForWindow.length, 0) ?? 0;

  return <AppShell currentUser={currentUser} guest={guest}>
    <PageHeader eyebrow={guest ? "游客只读访问" : "MVP-B · 灵活检索"} title="查找空闲时间" description="按成员、时间段或参与人群检索数据库中的真实课表。空闲时长只计算上课节次，不把课间休息算进去。" />

    <div className="availability-mode-tabs" role="tablist" aria-label="选择检索方式">
      {(Object.keys(modeCopy) as SearchMode[]).map((item) => <button key={item} role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => { setMode(item); setError(""); setLoading(true); }}>
        {item === "person" ? <Search size={18} /> : item === "time" ? <Clock3 size={18} /> : <Users size={18} />}
        <span>{modeCopy[item].label}</span>
      </button>)}
    </div>

    <div className="availability-layout availability-layout-wide">
      <section className="panel filter-panel">
        <div className="panel-heading"><div><span className="eyebrow">查询条件</span><h2>{modeCopy[mode].title}</h2><p>{modeCopy[mode].description}</p></div></div>

        <div className="grade-filter" aria-label="按年级筛选">
          {(["all", "sophomore", "junior", "unknown"] as GradeFilter[]).map((item) => <button key={item} className={grade === item ? "active" : ""} onClick={() => { setGrade(item); setLoading(true); setError(""); }}>{item === "all" ? "全部" : memberGradeLabels[item]}</button>)}
        </div>

        {mode === "person" && <div className="selection-list compact-selection">{visibleMembers.map((member) => <button key={member.id} className={personId === member.id ? "select-person selected" : "select-person"} onClick={() => { setPersonId(member.id); setLoading(true); setError(""); }}><span className="avatar">{member.name.slice(-1)}</span><span><strong>{member.name}</strong><small>{member.studentNo ?? "学号待补"} · {memberGradeLabels[member.grade]}</small></span><i>{personId === member.id && <Check size={14} />}</i></button>)}</div>}

        {mode === "group" && <>
          <div className="selection-actions"><span>已选 {selected.length} 人</span><button className="text-link" onClick={() => { setSelected(visibleMembers.map((member) => member.id)); setLoading(true); setError(""); }}>选择当前年级全部</button></div>
          <div className="selection-list compact-selection">{visibleMembers.map((member) => <button key={member.id} className={selected.includes(member.id) ? "select-person selected" : "select-person"} onClick={() => toggleMember(member.id)}><span className="avatar">{member.name.slice(-1)}</span><span><strong>{member.name}</strong><small>{member.studentNo ?? "学号待补"} · {memberGradeLabels[member.grade]}</small></span><i>{selected.includes(member.id) && <Check size={14} />}</i></button>)}</div>
        </>}

        {mode === "time" && <div className="filter-note"><Users size={18} /><span>将在当前筛选的 <strong>{visibleMembers.length}</strong> 位成员中查找。</span></div>}

        <div className="filter-fields availability-fields">
          <label className="field"><span>星期</span><select value={weekday} onChange={(event) => { setWeekday(Number(event.target.value)); setLoading(true); setError(""); }}>{weekdays.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
          <label className="field"><span>周次</span><select value={week} onChange={(event) => { setWeek(Number(event.target.value)); setLoading(true); setError(""); }}>{Array.from({ length: semester.weekCount }, (_, index) => index + 1).map((value) => <option key={value} value={value}>第 {value} 周</option>)}</select></label>
          {mode !== "time" && <label className="field"><span>至少空闲</span><select value={minimumMinutes} onChange={(event) => { setMinimumMinutes(Number(event.target.value)); setLoading(true); setError(""); }}>{[45, 90, 135, 180].map((value) => <option key={value} value={value}>{value} 分钟</option>)}</select></label>}
          {mode === "time" && <>
            <label className="field"><span>开始时间</span><input type="time" disabled={allDay} value={startTime} onChange={(event) => { setStartTime(event.target.value); setLoading(true); setError(""); }} /></label>
            <label className="field"><span>结束时间</span><input type="time" disabled={allDay} value={endTime} onChange={(event) => { setEndTime(event.target.value); setLoading(true); setError(""); }} /></label>
            <label className="field full availability-check"><input type="checkbox" checked={allDay} onChange={(event) => { setAllDay(event.target.checked); setLoading(true); setError(""); }} /><span>只查当天 13 节课全部无课的成员</span></label>
          </>}
        </div>
      </section>

      <section className="panel result-panel">
        {queryIds.length === 0 && <div className="form-error" role="alert">请至少选择一位成员。</div>}
        {queryIds.length > 0 && loading && <div className="empty-result"><Clock3 size={28} /><strong>正在读取课表…</strong><p>查询范围较大时可能需要稍等片刻。</p></div>}
        {queryIds.length > 0 && !loading && error && <div className="form-error" role="alert">{error}</div>}
        {queryIds.length > 0 && !loading && result && <>
          <div className="result-summary"><span className="result-icon"><CalendarDays size={24} /></span><div><span className="eyebrow">{weekdays[weekday - 1]} · 第 {week} 周</span><h2>{mode === "time" ? `找到 ${freeWindowCount} 人次空闲` : `找到 ${result.days.reduce((total, day) => total + day.ranges.length, 0)} 个可用时段`}</h2><p>{mode === "person" ? `正在查看 ${selectedPerson?.name ?? "所选成员"} 的空闲时间。` : mode === "time" ? (allDay ? "要求当天全部节次无课。" : `要求 ${startTime}–${endTime} 全程空闲。`) : `${queryIds.length} 位成员必须同时空闲。`}</p></div></div>

          <div className="availability-day-list">{result.days.map((day) => {
            const freeMembers = day.freeStudentIdsForWindow.map((id) => memberById.get(id)).filter(Boolean);
            return <article className="availability-day" key={day.date}>
              <header><div><strong>{formatDate(day.date)} · {weekdays[day.weekday - 1]}</strong><span>第 {day.week} 周</span></div>{mode !== "time" && <span>{day.ranges.length} 段空闲</span>}</header>
              {mode === "time" ? (freeMembers.length ? <div className="free-member-grid">{freeMembers.map((member) => member && <div key={member.id}><span className="avatar small-avatar">{member.name.slice(-1)}</span><span><strong>{member.name}</strong><small>{memberGradeLabels[member.grade]}</small></span></div>)}</div> : <div className="day-empty">这段时间没有符合条件的成员</div>) : (day.ranges.length ? <div className="timeline compact-timeline">{day.ranges.map((range) => <div className="time-result" key={`${range.startPeriod}-${range.endPeriod}`}><div className="time-range"><strong>{range.startTime}</strong><span>至</span><strong>{range.endTime}</strong></div><div><h3>第 {range.startPeriod}{range.startPeriod === range.endPeriod ? "" : `–${range.endPeriod}`} 节</h3><p><Clock3 size={15} /> 共 {range.durationMinutes} 分钟</p></div><span className="available-chip">可安排</span></div>)}</div> : <div className="day-empty">当天没有满足条件的连续空闲</div>)}
            </article>;
          })}</div>
        </>}
      </section>
    </div>
  </AppShell>;
}
