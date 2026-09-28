"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from "react";
import { AlertTriangle, ArrowLeft, Check, History, ImagePlus, Plus, ScanLine, Trash2 } from "lucide-react";
import type { CourseInput } from "@/lib/course-schema";
import { draftsFromOcrLines, type ImageCourseDraft, type OcrTextLine } from "@/lib/image-ocr";
import { importHeaders, type ImportHeader, type ImportPreviewRow, type ImportRecord } from "@/lib/schedule-import";

type Preview = {
  source: "image";
  fileName: string;
  semester: { id: number; name: string; weekCount: number };
  rows: ImportPreviewRow[];
  validCourses: CourseInput[];
  errorCount: number;
  diff: { added: number; unchanged: number; removed: number };
};

type RecognitionMode = "local" | "vision";
const maximumImageBytes = 8 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const imageTypeByExtension: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

type OcrResult = {
  fileName: string;
  confidence: number;
  text: string;
  lines: OcrTextLine[];
  mode: RecognitionMode;
  model?: string;
  drafts?: ImageCourseDraft[];
};
function emptyRecord(): ImportRecord {
  return Object.fromEntries(importHeaders.map((header) => [header, header === "颜色" ? "#dce8e3" : ""])) as ImportRecord;
}

function newDraft(index: number): ImageCourseDraft {
  return { id: `manual-${Date.now()}-${index}`, sourceText: "手动添加", confidence: 100, record: emptyRecord() };
}

export function ImageImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>("local");
  const [visionConsent, setVisionConsent] = useState(false);
  const [drafts, setDrafts] = useState<ImageCourseDraft[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState<"ocr" | "preview" | "confirm" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [success, setSuccess] = useState<{ versionNo: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const selectFile = useCallback((next: File | null) => {
    setIsDragging(false);
    if (next) {
      const extension = next.name.split(".").pop()?.toLowerCase() ?? "";
      const inferredType = next.type || imageTypeByExtension[extension] || "";
      if (!acceptedImageTypes.has(inferredType)) {
        setError("只支持 PNG、JPG 或 WebP 图片。请在微信中打开原图后重新拖入，或先保存图片再选择。");
        return;
      }
      if (next.size > maximumImageBytes) {
        setError("图片不能超过 8 MB。请裁剪课表区域或压缩图片后重试。");
        return;
      }
      if (!next.type) next = new File([next], next.name, { type: inferredType, lastModified: next.lastModified });
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setFile(next); setImageUrl(next ? URL.createObjectURL(next) : "");
    setOcr(null); setDrafts([]); setPreview(null); setError(""); setNotice(""); setSuccess(null);
  }, [imageUrl]);

  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const pastedFile = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile() ?? null;
      if (!pastedFile) return;
      event.preventDefault();
      selectFile(pastedFile);
    }
    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [selectFile]);

  function handleDrop(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const droppedFile = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"))
      ?? Array.from(event.dataTransfer.items).find((item) => item.kind === "file")?.getAsFile()
      ?? null;
    if (!droppedFile) {
      setIsDragging(false);
      setError("没有从拖放内容中读取到图片文件。部分微信版本只提供图片预览，请复制图片后在此按 Ctrl+V，或先把原图保存到电脑。");
      return;
    }
    selectFile(droppedFile);
  }

  function handlePaste(event: ReactClipboardEvent<HTMLButtonElement>) {
    const pastedFile = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile() ?? null;
    if (!pastedFile) return;
    event.preventDefault();
    selectFile(pastedFile);
  }

  async function recognize() {
    if (!file) return setError("请先选择一张课表截图。");
    if (recognitionMode === "vision" && !visionConsent) return setError("请先勾选同意，将本次图片发送给千问模型进行识别。");
    setLoading("ocr"); setError(""); setNotice(""); setPreview(null); setSuccess(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), recognitionMode === "vision" ? 45_000 : 90_000);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", recognitionMode);
      if (recognitionMode === "vision") form.append("visionConsent", "true");
      const response = await fetch("/api/my/schedule-import/image-ocr", { method: "POST", body: form, signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "图片识别失败。");
      const result = payload.data as OcrResult;
      const suggestions = result.drafts?.length ? result.drafts : draftsFromOcrLines(result.lines);
      setOcr(result);
      setDrafts(suggestions.length ? suggestions : [newDraft(0)]);
      setNotice(suggestions.length
        ? `${result.mode === "vision" ? `智能识别（${result.model ?? "千问"}）` : "本地 OCR"}已生成 ${suggestions.length} 条候选。请删除无关行并重点核对标红字段。`
        : "识别到了文字，但没有可靠课程候选。已创建一行空白草稿，请参考左侧图片填写。");
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "识别等待时间过长，已自动停止。请裁剪图片后重试，或切换另一种识别方式。"
        : cause instanceof Error ? cause.message : "图片识别失败。");
    } finally { window.clearTimeout(timeout); setLoading(""); }
  }

  function updateRecord(index: number, field: ImportHeader, value: string) {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index
      ? { ...draft, reviewFields: draft.reviewFields?.filter((item) => item !== field), record: { ...draft.record, [field]: value } }
      : draft));
    setPreview(null); setAcknowledged(false); setSuccess(null);
  }

  async function generatePreview() {
    if (!file || drafts.length === 0) return setError("请至少保留一门课程草稿。");
    setLoading("preview"); setError(""); setPreview(null); setAcknowledged(false);
    try {
      const response = await fetch("/api/my/schedule-import/image-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, records: drafts.map((draft) => draft.record) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "草稿预览失败。");
      setPreview(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "草稿预览失败。"); }
    finally { setLoading(""); }
  }

  async function confirmImport() {
    if (!preview || preview.errorCount > 0 || !acknowledged) return;
    setLoading("confirm"); setError("");
    try {
      const response = await fetch("/api/my/schedule-import/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "image", fileName: preview.fileName, courses: preview.validCourses }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "导入失败，原课表未被修改。");
      setSuccess(payload.data); setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，原课表未被修改。"); }
    finally { setLoading(""); }
  }

  return <div className="image-import-page">
    <div className="image-import-toolbar">
      <Link href="/my-schedule/import" className="text-link"><ArrowLeft size={16} /> 返回其他导入方式</Link>
      <Link href="/my-schedule/history" className="text-link"><History size={16} /> 查看历史版本</Link>
    </div>

    <section className="image-review-board">
      <aside className="panel image-source-panel">
        <div><span className="eyebrow">第 1 步</span><h2>上传并识别</h2><p>建议使用原图，裁掉状态栏和底部导航，只保留完整课表网格。</p></div>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
        <button type="button" className={`image-drop ${imageUrl ? "has-image" : ""} ${isDragging ? "dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsDragging(true); }} onDragLeave={(event) => { const nextTarget = event.relatedTarget; if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setIsDragging(false); }} onDrop={handleDrop} onPaste={handlePaste}>
          {imageUrl ? <Image src={imageUrl} alt="待识别课表预览" width={720} height={960} unoptimized draggable={false} /> : <><ImagePlus size={34} /><strong>{isDragging ? "松开鼠标即可添加" : "拖入或点击选择课表截图"}</strong><span>也可复制图片后按 Ctrl+V</span><span>PNG / JPG / WebP，最大 8 MB</span></>}
        </button>
        {file && <div className="selected-image-meta"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>}
        <div className="recognition-mode" role="radiogroup" aria-label="识别方式">
          <button type="button" role="radio" aria-checked={recognitionMode === "local"} className={recognitionMode === "local" ? "active" : ""} onClick={() => { setRecognitionMode("local"); setError(""); }}><strong>仅本地 OCR</strong><span>图片不离开本机，适合清晰截图</span></button>
          <button type="button" role="radio" aria-checked={recognitionMode === "vision"} className={recognitionMode === "vision" ? "active" : ""} onClick={() => { setRecognitionMode("vision"); setError(""); }}><strong>千问智能识别</strong><span>更擅长理解课表网格和课程位置</span></button>
        </div>
        {recognitionMode === "vision" && <label className="vision-consent"><input type="checkbox" checked={visionConsent} onChange={(event) => setVisionConsent(event.target.checked)} /><span>我同意将本次课表图片临时发送给千问模型处理。图片和识别原文不会由本站保存。</span></label>}
        <button type="button" className="button primary image-recognize-button" disabled={!file || Boolean(loading)} onClick={recognize}><ScanLine size={17} />{loading === "ocr" ? `正在${recognitionMode === "vision" ? "智能" : "本地"}识别，可能需要几十秒…` : `开始${recognitionMode === "vision" ? "智能" : "本地"}识别`}</button>
        {ocr && <div className={`ocr-score ${ocr.confidence < 70 ? "low" : ""}`}><span>整体文字置信度</span><strong>{ocr.confidence}%</strong><small>{ocr.confidence < 70 ? "图片较难识别，请重点核对每一项" : "仍需人工核对星期、节次和周次"}</small></div>}
      </aside>

      <section className="panel image-draft-panel">
        <div className="image-draft-heading"><div><span className="eyebrow">第 2 步</span><h2>校对课程草稿</h2></div>{drafts.length > 0 && <span className="draft-count">{drafts.length} 条</span>}</div>
        {!ocr ? <div className="image-empty-state"><ScanLine size={36} /><strong>识别后在这里逐项校对</strong><p>系统不会直接写入数据库，也不会保存上传的图片。</p></div> : <>
          {notice && <div className="import-warning"><AlertTriangle size={18} /><span>{notice}</span></div>}
          {ocr.mode === "local" && ocr.text && <details className="ocr-raw-text"><summary>查看 OCR 识别原文</summary><pre>{ocr.text}</pre></details>}
          <div className="ocr-draft-list">
            {drafts.map((draft, index) => <article className={`ocr-draft-card ${draft.reviewFields?.length ? "needs-review" : ""}`} key={draft.id}>
              <div className="ocr-draft-card-head"><div><span>候选 {index + 1}</span><small className={draft.confidence < 70 ? "low" : ""}>文字置信度 {draft.confidence}%</small></div><button type="button" aria-label={`删除候选 ${index + 1}`} onClick={() => { setDrafts((items) => items.filter((_, i) => i !== index)); setPreview(null); }}><Trash2 size={16} /></button></div>
              <p className="ocr-source-text" title={draft.sourceText}>{draft.sourceText}</p>
              <div className="ocr-fields">
                <label className={!draft.record["课程名称"].trim() || draft.reviewFields?.includes("课程名称") ? "needs-review" : ""}><span>课程名称 *</span><input value={draft.record["课程名称"]} onChange={(e) => updateRecord(index, "课程名称", e.target.value)} /></label>
                <label className={draft.reviewFields?.includes("教师") ? "needs-review" : ""}><span>教师</span><input value={draft.record["教师"]} onChange={(e) => updateRecord(index, "教师", e.target.value)} /></label>
                <label className={draft.reviewFields?.includes("地点") ? "needs-review" : ""}><span>地点</span><input value={draft.record["地点"]} onChange={(e) => updateRecord(index, "地点", e.target.value)} /></label>
                <label className={!draft.record["星期"].trim() || draft.reviewFields?.includes("星期") ? "needs-review" : ""}><span>星期 *</span><select value={draft.record["星期"]} onChange={(e) => updateRecord(index, "星期", e.target.value)}><option value="">请选择</option>{["一","二","三","四","五","六","日"].map((day) => <option key={day} value={`周${day}`}>周{day}</option>)}</select></label>
                <label className={!draft.record["开始节次"].trim() || draft.reviewFields?.includes("开始节次") ? "needs-review" : ""}><span>开始节次 *</span><select value={draft.record["开始节次"]} onChange={(e) => updateRecord(index, "开始节次", e.target.value)}><option value="">请选择</option>{Array.from({ length: 13 }, (_, i) => i + 1).map((period) => <option key={period}>{period}</option>)}</select></label>
                <label className={!draft.record["结束节次"].trim() || draft.reviewFields?.includes("结束节次") ? "needs-review" : ""}><span>结束节次 *</span><select value={draft.record["结束节次"]} onChange={(e) => updateRecord(index, "结束节次", e.target.value)}><option value="">请选择</option>{Array.from({ length: 13 }, (_, i) => i + 1).map((period) => <option key={period}>{period}</option>)}</select></label>
                <label className={!draft.record["周次"].trim() || draft.reviewFields?.includes("周次") ? "needs-review" : ""}><span>周次 *</span><input placeholder="例如 1-18 或 1-18单" value={draft.record["周次"]} onChange={(e) => updateRecord(index, "周次", e.target.value)} /></label>
                <label><span>备注</span><input value={draft.record["备注"]} onChange={(e) => updateRecord(index, "备注", e.target.value)} /></label>
              </div>
            </article>)}
          </div>
          <div className="image-draft-actions"><button type="button" className="button secondary" onClick={() => setDrafts((items) => [...items, newDraft(items.length)])}><Plus size={17} /> 添加一门课程</button><button type="button" className="button primary" disabled={!drafts.length || Boolean(loading)} onClick={generatePreview}>{loading === "preview" ? "正在检查…" : "生成差异预览"}</button></div>
        </>}
        {error && <div className="form-error" role="alert">{error}</div>}
        {success && <div className="import-success"><Check size={22} /><div><strong>图片课表已导入，保存为第 {success.versionNo} 个历史版本</strong><p>课表总览和共同空闲已经读取新数据。</p><div><Link className="button primary" href="/my-schedule">查看我的课表</Link><Link className="button secondary" href="/my-schedule/history">查看历史版本</Link></div></div></div>}
      </section>
    </section>

    {preview && <section className="panel image-preview-panel">
      <div className="import-step-heading"><div><span className="eyebrow">第 3 步</span><h2>核对差异并确认</h2></div><span className="privacy-chip">图片与 OCR 原文未保存</span></div>
      <div className="diff-grid"><div><span>新增</span><strong>{preview.diff.added}</strong></div><div><span>保持不变</span><strong>{preview.diff.unchanged}</strong></div><div><span>将被删除</span><strong>{preview.diff.removed}</strong></div><div className={preview.errorCount ? "has-error" : ""}><span>错误行</span><strong>{preview.errorCount}</strong></div></div>
      <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>行</th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>地点</th><th>检查结果</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "invalid" : ""}><td>{row.rowNumber}</td><td>{row.raw["课程名称"] || "—"}</td><td>{row.raw["星期"] || "—"}</td><td>{row.raw["开始节次"]}-{row.raw["结束节次"]}</td><td>{row.raw["周次"] || "—"}</td><td>{row.raw["地点"] || "—"}</td><td>{row.errors.length ? row.errors.join("；") : <span className="row-valid"><Check size={14} /> 可导入</span>}</td></tr>)}</tbody></table></div>
      {preview.errorCount === 0 ? <div className="confirm-import"><label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已逐项核对，确认用这 {preview.validCourses.length} 门课程整表替换当前课表。</span></label><button className="button danger" disabled={!acknowledged || Boolean(loading)} onClick={confirmImport}>{loading === "confirm" ? "正在导入…" : "确认替换并保存版本"}</button></div> : <div className="import-warning"><AlertTriangle size={18} /><span>请回到上方标红字段修正后重新生成预览。当前课表没有发生任何变化。</span></div>}
    </section>}
  </div>;
}
