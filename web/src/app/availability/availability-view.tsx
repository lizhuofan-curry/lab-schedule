"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarSearch, Check, Clock3, Users } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import type { ScheduleMember } from "@/lib/schedule-service";
import type { SchedulePeriod, ScheduleSemester } from "@/lib/schedule-types";
import { weekdays } from "@/lib/schedule-types";

type AvailabilityResult = {
  date: string;
  week: number;
  weekday: number;
  members: Array<{ id: number; name: string; studentNo: string | null }>;
  periods: SchedulePeriod[];
  allDayFreeStudentIds: number[];
  freeStudentIdsByPeriod: Array<{ periodNo: number; studentIds: number[] }>;
  commonFreePeriods: number[];
  ranges: Array<{ startPeriod: number; endPeriod: number }>;
};

function displayTime(value: string) { return value.slice(0, 5); }

export function AvailabilityView({ members, defaultDate, semester, currentUser }: {
  members: ScheduleMember[];
  defaultDate: string;
  semester: ScheduleSemester;
  currentUser: { name: string; studentNo: string };
}) {
  const [selected, setSelected] = useState<number[]>(members.map((member) => member.id));
  const [date, setDate] = useState(defaultDate);
  const [minimum, setMinimum] = useState(2);
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(members.length > 0);

  useEffect(() => {
    if (selected.length === 0) return;
    const controller = new AbortController();
    fetch("/api/availability/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, studentIds: selected, minimumConsecutivePeriods: minimum }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "查询失败，请稍后重试。");
      setResult(payload.data);
    }).catch((reason) => {
      if (reason.name !== "AbortError") { setResult(null); setError(reason.message); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, minimum, selected]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  function toggle(id: number) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setSelected(next);
    setResult(next.length === 0 ? null : result);
    setError(next.length === 0 ? "请至少选择一位成员。" : "");
    setLoading(next.length > 0);
  }

  function selectAll() { setSelected(members.map((member) => member.id)); setError(""); setLoading(members.length > 0); }
  function changeDate(value: string) { setDate(value); setError(""); setLoading(true); }
  function changeMinimum(value: number) { setMinimum(value); setError(""); setLoading(true); }

  return <AppShell currentUser={currentUser}>
    <PageHeader eyebrow="数据库实时查询" title="找共同空闲" description="选择日期、参与成员和连续节数，系统会自动读取当前数据库中的有效课程。" />
    <div className="availability-layout">
      <section className="panel filter-panel">
        <div className="panel-heading"><div><span className="eyebrow">查询条件</span><h2>谁需要参加？</h2></div><button className="text-link" onClick={selectAll}>选择全部</button></div>
        <div className="selection-list">{members.map((member) => <button key={member.id} className={selected.includes(member.id) ? "select-person selected" : "select-person"} onClick={() => toggle(member.id)}><span className="avatar">{member.name.slice(-1)}</span><span><strong>{member.name}</strong><small>{member.studentNo ?? "学号待补"}</small></span><i>{selected.includes(member.id) && <Check size={14} />}</i></button>)}</div>
        <div className="filter-fields">
          <label className="field"><span>选择日期</span><input type="date" min={semester.startDate} max={semester.endDate} value={date} onChange={(event) => changeDate(event.target.value)} /></label>
          <label className="field"><span>至少连续</span><select value={minimum} onChange={(event) => changeMinimum(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 节</option>)}</select></label>
        </div>
      </section>
      <section className="panel result-panel">
        {loading && <div className="empty-result"><Clock3 size={28} /><strong>正在读取数据库…</strong></div>}
        {!loading && error && <div className="form-error" role="alert">{error}</div>}
        {!loading && result && <>
          <div className="result-summary"><span className="result-icon"><CalendarSearch size={24} /></span><div><span className="eyebrow">第 {result.week} 周 · {weekdays[result.weekday - 1]}</span><h2>找到 {result.ranges.length} 个合适时段</h2><p>{selected.length} 位成员共同空闲，至少连续 {minimum} 节。</p></div></div>
          <div className="timeline">{result.ranges.length ? result.ranges.map(({ startPeriod, endPeriod }) => {
            const start = result.periods.find((period) => period.periodNo === startPeriod);
            const end = result.periods.find((period) => period.periodNo === endPeriod);
            return <article className="time-result" key={`${startPeriod}-${endPeriod}`}><div className="time-range"><strong>{displayTime(start?.startTime ?? "")}</strong><span>至</span><strong>{displayTime(end?.endTime ?? "")}</strong></div><div><h3>第 {startPeriod}{startPeriod === endPeriod ? "" : `–${endPeriod}`} 节</h3><p><Users size={15} /> {selected.map((id) => memberById.get(id)?.name).filter(Boolean).join("、")}</p></div><span className="available-chip"><Clock3 size={14} /> 可安排</span></article>;
          }) : <div className="empty-result"><Clock3 size={28} /><strong>没有满足条件的连续时间</strong><p>可以减少参与者或降低连续节数后再试。</p></div>}</div>
          <div className="availability-details"><div><span className="eyebrow">全天没课</span><p>{result.allDayFreeStudentIds.length ? result.allDayFreeStudentIds.map((id) => memberById.get(id)?.name).filter(Boolean).join("、") : "所选成员当天都有课程"}</p></div><div><span className="eyebrow">逐节空闲人数</span><p>{result.freeStudentIdsByPeriod.map((item) => `第${item.periodNo}节 ${item.studentIds.length}人`).join(" · ")}</p></div></div>
        </>}
      </section>
    </div>
  </AppShell>;
}
