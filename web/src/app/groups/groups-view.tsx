"use client";

import Link from "next/link";
import { ArrowRightLeft, Crown, Pencil, Plus, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { GroupDirectoryItem } from "@/lib/group-service";
import type { ScheduleMember } from "@/lib/schedule-service";

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (response.status === 204) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "操作失败，请稍后重试。");
  return payload.data;
}

export function GroupsView({ initialGroups, members, guest, currentStudentId }: {
  initialGroups: GroupDirectoryItem[];
  members: ScheduleMember[];
  guest: boolean;
  currentStudentId: number | null;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [candidateByGroup, setCandidateByGroup] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const groupCountForMe = useMemo(() => currentStudentId ? groups.filter((group) => group.members.some((member) => member.studentId === currentStudentId)).length : 0, [currentStudentId, groups]);

  async function refresh() {
    const data = await requestJson("/api/groups");
    setGroups(data);
  }

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newName.trim()) return setError("请输入小组名称。");
    const created = await perform(() => requestJson("/api/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName }) }));
    if (created) setNewName("");
  }

  return <div className="groups-page">
    <section className="group-summary-grid">
      <article className="panel group-summary"><UsersRound size={22} /><div><strong>{groups.length}</strong><span>个小组</span></div></article>
      <article className="panel group-summary"><Crown size={22} /><div><strong>{guest ? "—" : groupCountForMe}</strong><span>{guest ? "游客只读" : "我加入的小组"}</span></div></article>
      {!guest && <article className="panel group-create"><div><span className="eyebrow">创建新小组</span><p>创建后你将成为组长，可以改名、维护成员或转让组长。</p></div><div><input value={newName} maxLength={40} placeholder="例如：视觉重建组" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} /><button className="button primary" disabled={busy} onClick={() => void create()}><Plus size={17} /> 创建</button></div></article>}
    </section>

    {error && <div className="form-error" role="alert">{error}</div>}
    {groups.length === 0 ? <section className="panel empty-result"><UsersRound size={30} /><strong>还没有小组</strong><p>{guest ? "注册成员创建小组后会显示在这里。" : "输入名称创建第一个项目小组。"}</p></section> : <section className="group-card-grid">
      {groups.map((group) => {
        const candidateMembers = members.filter((member) => !group.members.some((item) => item.studentId === member.id));
        return <article className="panel group-card" key={group.id}>
          <header>
            <div className="group-title-mark"><UsersRound size={20} /></div>
            <div className="group-card-title">
              {editingId === group.id ? <div className="group-rename"><input value={editingName} maxLength={40} onChange={(event) => setEditingName(event.target.value)} /><button className="button small" disabled={busy} onClick={() => void perform(async () => { await requestJson(`/api/groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: editingName }) }); setEditingId(null); })}>保存</button><button className="icon-button" onClick={() => setEditingId(null)} aria-label="取消改名"><X size={16} /></button></div> : <><h2>{group.name}</h2><p>{group.members.length} 位成员 · 组长 {group.leader.name}</p></>}
            </div>
            {group.canManage && editingId !== group.id && <button className="icon-button" onClick={() => { setEditingId(group.id); setEditingName(group.name); }} aria-label="修改小组名称"><Pencil size={16} /></button>}
          </header>

          <div className="group-member-list">
            {group.members.map((member) => <div className="group-member" key={member.studentId}>
              <span className="avatar">{member.name.slice(-1)}</span>
              <span><strong>{member.name}</strong><small>{member.studentNo ?? "学号待补"}</small></span>
              {member.role === "leader" ? <i className="leader-chip"><Crown size={13} /> 组长</i> : group.canManage ? <span className="group-member-actions"><button disabled={busy} title="转让组长" onClick={() => { if (window.confirm(`确认把“${group.name}”的组长转让给 ${member.name}？`)) void perform(() => requestJson(`/api/groups/${group.id}/leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ studentId: member.studentId }) })); }}><ArrowRightLeft size={15} /></button><button disabled={busy} title="移出小组" onClick={() => void perform(() => requestJson(`/api/groups/${group.id}/members/${member.studentId}`, { method: "DELETE" }))}><X size={15} /></button></span> : null}
            </div>)}
          </div>

          {group.canManage && <div className="group-manage-row">
            <select value={candidateByGroup[group.id] ?? ""} onChange={(event) => setCandidateByGroup((current) => ({ ...current, [group.id]: Number(event.target.value) }))}>
              <option value="">选择要添加的成员</option>
              {candidateMembers.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.studentNo}</option>)}
            </select>
            <button className="button secondary small" disabled={busy || !candidateByGroup[group.id]} onClick={() => void perform(() => requestJson(`/api/groups/${group.id}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ studentId: candidateByGroup[group.id] }) }))}><UserPlus size={16} /> 添加</button>
          </div>}

          <footer>
            <Link className="text-link" href={`/availability?group=${group.id}`}>查询小组共同空闲</Link>
            {group.canManage && <button className="danger-link" disabled={busy} onClick={() => { if (window.confirm(`确认解散“${group.name}”？此操作不会删除成员课表。`)) void perform(() => requestJson(`/api/groups/${group.id}`, { method: "DELETE" })); }}><Trash2 size={15} /> 解散小组</button>}
          </footer>
        </article>;
      })}
    </section>}
  </div>;
}

