"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from "lucide-react";
import type { CourseInput } from "@/lib/course-schema";

type PreviewRow = { rowNumber: number; course: CourseInput | null; errors: string[] };
type SyncPreview = {
  source: "henu";
  fileName: string;
  semester: { id: number; name: string; weekCount: number };
  rows: PreviewRow[];
  validCourses: CourseInput[];
  errorCount: number;
  diff: { added: number; unchanged: number; removed: number };
  context: { academicYear: string; semesterCode: string };
};

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function describeWeeks(weeks: number[]) {
  if (weeks.length === 0) return "";
  const odd = weeks.every((week) => week % 2 === 1);
  const even = weeks.every((week) => week % 2 === 0);
  if (odd) return `单周（${weeks.length} 周）`;
  if (even) return `双周（${weeks.length} 周）`;
  if (weeks.length === weeks[weeks.length - 1] - weeks[0] + 1) return `${weeks[0]}-${weeks[weeks.length - 1]} 周`;
  return weeks.join("、");
}

export function HenuSyncPanel({ defaultStudentId }: { defaultStudentId: string }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [success, setSuccess] = useState<{ versionNo: number } | null>(null);
  const [error, setError] = useState("");

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setPreview(null); setSuccess(null); setAcknowledged(false);
    try {
      const response = await fetch("/api/my/henu-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: defaultStudentId, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "同步预览失败，请稍后重试。");
      setPreview(body.data as SyncPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步预览失败，请稍后重试。");
    } finally {
      setPassword("");
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!preview || preview.errorCount > 0 || !acknowledged) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/my/schedule-import/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: preview.source, fileName: preview.fileName, courses: preview.validCourses }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "导入失败，原课表未被修改。");
      setSuccess(body.data);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败，原课表未被修改。");
    } finally {
      setLoading(false);
    }
  }

  return <section className="panel henu-sync-panel">
    <div className="panel-heading"><div><span className="eyebrow">河大统一认证 · 实验功能</span><h2>同步河大课表</h2><p>先临时登录并生成预览；只有你再次确认后，才会替换本站中的本人课表。</p></div></div>
    <div className="import-warning henu-privacy-note"><ShieldCheck size={18} /><span>教务密码只用于本次请求，不保存到数据库、浏览器存储或日志。学号固定为当前账号 <strong>{defaultStudentId}</strong>。</span></div>
    <form className="henu-sync-form" onSubmit={handlePreview}>
      <label className="field"><span>当前学号</span><input value={defaultStudentId} readOnly aria-readonly="true" /></label>
      <label className="field"><span>统一认证密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="off" placeholder="仅用于本次同步预览" /></label>
      <button className="button primary" type="submit" disabled={loading || !password}><RefreshCw size={16} /> {loading ? "正在读取…" : "读取并生成预览"}</button>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {success && <div className="import-success"><Check size={22} /><div><strong>同步成功，已保存为第 {success.versionNo} 个历史版本</strong><p>数据库中的本人课表、课表总览和共同空闲已同步更新。</p><button className="button primary" onClick={() => window.location.reload()}>刷新并查看新课表</button></div></div>}
    {preview && <div className="henu-sync-result">
      <strong>已读取 {preview.validCourses.length} 门可导入课程，请核对后再确认</strong>
      <p>{preview.semester.name} · 教务学年代码 {preview.context.academicYear || "未知"} · 学期代码 {preview.context.semesterCode || "未知"}</p>
      <div className="diff-grid"><div><span>新增</span><strong>{preview.diff.added}</strong></div><div><span>保持不变</span><strong>{preview.diff.unchanged}</strong></div><div><span>将被删除</span><strong>{preview.diff.removed}</strong></div><div className={preview.errorCount ? "has-error" : ""}><span>错误课程</span><strong>{preview.errorCount}</strong></div></div>
      <div className="preview-table-wrap"><table className="henu-course-table"><thead><tr><th>课程</th><th>教师</th><th>星期</th><th>节次</th><th>周次</th><th>地点</th><th>检查结果</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "invalid" : ""}><td>{row.course?.name || "无法读取"}</td><td>{row.course?.teacher || "—"}</td><td>{row.course ? weekdayNames[row.course.weekday - 1] : "—"}</td><td>{row.course ? `${row.course.startPeriod}-${row.course.endPeriod}` : "—"}</td><td>{row.course ? describeWeeks(row.course.weeks) : "—"}</td><td>{row.course?.location || "—"}</td><td>{row.errors.length ? row.errors.join("；") : <span className="row-valid"><Check size={14} /> 可导入</span>}</td></tr>)}</tbody></table></div>
      {preview.errorCount === 0 ? <div className="confirm-import"><label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已核对课程、星期、节次、周次和地点，确认用这 {preview.validCourses.length} 门课程替换当前课表。</span></label><button className="button danger" disabled={!acknowledged || loading} onClick={confirmImport}>{loading ? "正在写入…" : "确认替换并保存版本"}</button></div> : <div className="import-warning"><AlertTriangle size={18} /><span>解析结果存在错误，当前课表没有发生变化。请继续使用网页或标准模板维护缺失课程。</span></div>}
    </div>}
  </section>;
}
