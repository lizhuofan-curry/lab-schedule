"use client";

import { AppShell, PageHeader } from "@/components/app-shell";
import type { RegistrationOverview } from "@/lib/registration-service";
import { CheckCircle2, Clipboard, Search, UserMinus, Users } from "lucide-react";
import { useState } from "react";

export function RegistrationView({ overview, currentUser }: { overview: RegistrationOverview; currentUser: { name: string; studentNo: string } }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "registered" | "pending">("all");
  const rows = overview.members.filter((member) =>
    (filter === "all" || (filter === "registered" ? member.registered : !member.registered))
      && (member.name.includes(query) || member.studentNo?.includes(query)),
  );
  const pending = overview.members.filter((member) => !member.registered);

  async function copyPending() {
    await navigator.clipboard.writeText(
      pending.map((member) => `${member.name} ${member.studentNo ?? "待补学号"}`).join("\n"),
    );
  }

  return (
    <AppShell currentUser={currentUser}>
      <PageHeader
        eyebrow="实验室成员"
        title="注册情况"
        description="所有成员都可以查看注册进度，方便及时提醒还没有注册的同学。"
        actions={<button className="button secondary" onClick={copyPending} disabled={pending.length === 0}><Clipboard size={16} /> 复制未注册名单</button>}
      />
      <section className="stat-grid admin-stats">
        <article className="stat-card"><div className="stat-icon green"><Users size={20} /></div><div><span>名册总人数</span><strong>{overview.total}</strong><small>实验室成员</small></div></article>
        <article className="stat-card"><div className="stat-icon blue"><CheckCircle2 size={20} /></div><div><span>已注册</span><strong>{overview.registered}</strong><small>{overview.rate}% 已完成</small></div></article>
        <article className="stat-card"><div className="stat-icon rust"><UserMinus size={20} /></div><div><span>未注册</span><strong>{overview.pending}</strong><small>{overview.missingStudentNo > 0 ? `${overview.missingStudentNo} 人待补学号` : "可以相互提醒"}</small></div></article>
      </section>
      <section className="panel roster-panel">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或学号" /></label>
          <div className="segmented">{(["all", "registered", "pending"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "registered" ? "已注册" : "未注册"}</button>)}</div>
        </div>
        <div className="roster-table">
          <div className="roster-row header"><span>成员</span><span>学号</span><span>状态</span></div>
          {rows.map((member) => (
            <div className="roster-row" key={member.id}>
              <span><i className="avatar">{member.name.slice(-1)}</i><strong>{member.name}</strong></span>
              <span>{member.studentNo ?? <em className="missing-value">待补学号</em>}</span>
              <span><i className={member.registered ? "registration registered" : "registration pending"}>{member.registered ? "已注册" : "未注册"}</i></span>
            </div>
          ))}
          {rows.length === 0 && <div className="roster-empty">没有符合条件的成员</div>}
        </div>
      </section>
    </AppShell>
  );
}
