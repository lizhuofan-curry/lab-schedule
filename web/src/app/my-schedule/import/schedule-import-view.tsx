"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, Check, ClipboardPaste, Download, FileSpreadsheet, History, Upload } from "lucide-react";
import type { CourseInput } from "@/lib/course-schema";
import type { ImportPreviewRow } from "@/lib/schedule-import";

type Preview = {
  source: "csv" | "xlsx" | "text";
  fileName: string;
  semester: { id: number; name: string; weekCount: number };
  rows: ImportPreviewRow[];
  validCourses: CourseInput[];
  errorCount: number;
  diff: { added: number; unchanged: number; removed: number };
};

export function ScheduleImportView() {
  const [mode, setMode] = useState<"file" | "text">("file");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ versionNo: number } | null>(null);

  async function previewFile() {
    if (!file) { setError("请先选择 .xlsx 或 .csv 文件。"); return; }
    setLoading(true); setError(""); setPreview(null); setSuccess(null); setAcknowledged(false);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/my/schedule-import/preview", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "文件预览失败。");
      setPreview(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "文件预览失败。"); }
    finally { setLoading(false); }
  }

  async function previewText() {
    if (!pastedText.trim()) { setError("请先从教务系统或 Excel 复制课表，并粘贴到文本框。"); return; }
    setLoading(true); setError(""); setPreview(null); setSuccess(null); setAcknowledged(false);
    try {
      const response = await fetch("/api/my/schedule-import/text-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pastedText }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "粘贴内容预览失败。");
      setPreview(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "粘贴内容预览失败。"); }
    finally { setLoading(false); }
  }

  function changeMode(nextMode: "file" | "text") {
    setMode(nextMode); setPreview(null); setSuccess(null); setError(""); setAcknowledged(false);
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "导入失败，原课表未被修改。");
      setSuccess(payload.data);
      setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，原课表未被修改。"); }
    finally { setLoading(false); }
  }

  return <div className="import-layout">
    <section className="panel import-guide">
      <span className="eyebrow">第 1 步</span><h2>选择课表来源</h2>
      <div className="import-source-switch" role="tablist" aria-label="课表来源">
        <button type="button" role="tab" aria-selected={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => changeMode("file")}><FileSpreadsheet size={20} /><span><strong>上传标准模板</strong><small>适合整理好的 Excel / CSV</small></span></button>
        <button type="button" role="tab" aria-selected={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => changeMode("text")}><ClipboardPaste size={20} /><span><strong>粘贴教务表格</strong><small>从网页或 Excel 直接复制</small></span></button>
      </div>
      {mode === "file" ? <><p>每行填写一门课程。周次可写 <strong>1-18</strong>、<strong>1-18单</strong>、<strong>2,4,6</strong>；星期可写“周一”或数字 1-7。</p>
      <div className="template-actions"><a className="button secondary" href="/api/my/schedule-import/template?format=xlsx"><Download size={17} /> Excel 模板</a><a className="button secondary" href="/api/my/schedule-import/template?format=csv"><Download size={17} /> CSV 模板</a></div></> : <><p>复制时请包含表头。支持“课程、教师、周次、星期、节次、地点”，也支持教务结果中的“上课时间/上课地点”组合列。</p><div className="paste-example"><span>可识别示例</span><code>1-18周 五[3-5] 金明综合楼6101</code></div></>}
      <div className="import-warning"><AlertTriangle size={18} /><span>导入采用<strong>整表替换</strong>。预览会显示将新增、保留和删除多少门课程；有错误或冲突时不能确认。</span></div>
    </section>

    <section className="panel import-workspace">
      <div className="import-step-heading"><div><span className="eyebrow">第 2 步</span><h2>{mode === "file" ? "上传并检查预览" : "粘贴并检查预览"}</h2></div><Link href="/my-schedule/history" className="text-link"><History size={16} /> 查看历史</Link></div>
      {mode === "file" ? <>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(""); }} />
        <button className="file-drop" onClick={() => inputRef.current?.click()}><FileSpreadsheet size={32} /><strong>{file?.name ?? "选择 Excel 或 CSV 文件"}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB` : "最大 2 MB，请使用本页下载的标准模板"}</span></button>
        <button className="button primary preview-button" disabled={!file || loading} onClick={previewFile}><Upload size={17} />{loading ? "正在检查…" : "生成文件预览"}</button>
      </> : <>
        <label className="paste-field"><span>粘贴课表表格</span><textarea value={pastedText} onChange={(event) => { setPastedText(event.target.value); setPreview(null); setError(""); }} placeholder={"课程\t教师\t上课时间/上课地点\n计算机网络\t魏丹\t1-18周 一[1-2] 金明综合楼6204"} /></label>
        <button className="button primary preview-button" disabled={!pastedText.trim() || loading} onClick={previewText}><ClipboardPaste size={17} />{loading ? "正在识别…" : "识别并生成预览"}</button>
      </>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {success && <div className="import-success"><Check size={22} /><div><strong>导入成功，已保存为第 {success.versionNo} 个历史版本</strong><p>课表总览和共同空闲会立即读取新数据。</p><div><Link className="button primary" href="/my-schedule">查看我的课表</Link><Link className="button secondary" href="/my-schedule/history">查看历史版本</Link></div></div></div>}

      {preview && <div className="import-preview">
        <div className="diff-grid"><div><span>新增</span><strong>{preview.diff.added}</strong></div><div><span>保持不变</span><strong>{preview.diff.unchanged}</strong></div><div><span>将被删除</span><strong>{preview.diff.removed}</strong></div><div className={preview.errorCount ? "has-error" : ""}><span>错误行</span><strong>{preview.errorCount}</strong></div></div>
        <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>行</th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>地点</th><th>检查结果</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "invalid" : ""}><td>{row.rowNumber}</td><td>{row.raw["课程名称"] || "—"}</td><td>{row.raw["星期"] || "—"}</td><td>{row.raw["开始节次"]}-{row.raw["结束节次"]}</td><td>{row.raw["周次"] || "—"}</td><td>{row.raw["地点"] || "—"}</td><td>{row.errors.length ? row.errors.join("；") : <span className="row-valid"><Check size={14} /> 可导入</span>}</td></tr>)}</tbody></table></div>
        {preview.errorCount === 0 ? <div className="confirm-import"><label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已核对预览，确认用这 {preview.validCourses.length} 门课程替换当前课表。</span></label><button className="button danger" disabled={!acknowledged || loading} onClick={confirmImport}>{loading ? "正在导入…" : "确认替换并保存版本"}</button></div> : <div className="import-warning"><AlertTriangle size={18} /><span>请根据“检查结果”修改原文件，然后重新上传。当前课表没有发生任何变化。</span></div>}
      </div>}
    </section>
  </div>;
}
