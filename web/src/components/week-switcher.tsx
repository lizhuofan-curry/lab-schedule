"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function WeekSwitcher({ week, onChange, semesterName = "2026–2027 第一学期", weekCount = 20 }: { week: number; onChange: (week: number) => void; semesterName?: string; weekCount?: number }) {
  return (
    <div className="week-switcher">
      <button className="icon-button" onClick={() => onChange(Math.max(1, week - 1))} aria-label="上一周"><ChevronLeft size={19} /></button>
      <div><small>{semesterName}</small><strong>第 {week} 周</strong></div>
      <button className="icon-button" onClick={() => onChange(Math.min(weekCount, week + 1))} aria-label="下一周"><ChevronRight size={19} /></button>
    </div>
  );
}
