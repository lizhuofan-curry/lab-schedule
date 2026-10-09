"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FileText,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ConfirmationDialog, TaskDeadline, SelectControl } from "@/components/form-controls";
import { TaskMarkdown, TaskMarkdownEditor } from "@/components/task-markdown";
import {
  beijingDeadline,
  beijingInput,
  submissionStatusLabels,
  taskDate,
  taskStatusLabels,
  taskSubject,
} from "@/lib/task-rules";
import { MAX_TASK_FILE_BYTES, TASK_FILE_ACCEPT } from "@/lib/task-file-rules";
import type { TaskCreate, TaskCommand } from "@/lib/task-schema";
import type { TaskDetail } from "@/lib/task-service";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
type Json<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
export type Detail = Json<TaskDetail>;
export type Options = {
  members: { id: number; name: string }[];
  groups: { id: number; name: string; members: { id: number; name: string }[]; excluded: { id: number; name: string; reason: string }[] }[];
};
type Person = { name: string; studentNo: string; studentId: number };
type FileInfo = { id: string; name: string; size: number };
type UnboundFile = FileInfo & { deleting: boolean };
export type ListItem = {
  id: number;
  title: string;
  publisher: string;
  deadline: string | null;
  status: keyof typeof taskStatusLabels;
  kind?: string;
  delivery?: string;
  capacity?: number | null;
  claimsOpen?: boolean;
  count?: number;
  mine?: boolean;
  executing?: boolean;
  round?: number;
};
export async function taskRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  let result: { data: T; message?: string };
  try {
    result = await response.json();
  } catch {
    throw new Error("连接暂不可用，请刷新后重试。");
  }
  if (!response.ok)
    throw new Error(result.message ?? "操作未完成，请刷新后重试。");
  return result.data;
}
export function TaskModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      className="task-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Files({ ids, files, preview = false }: { ids: string[]; files: FileInfo[]; preview?: boolean }) {
  const [selected, setSelected] = useState<FileInfo | null>(null);
  return (
    <>
    <div className="task-files">
      {ids.map((id) => {
        const f = files.find((f) => f.id === id);
        return (
          <a key={id} href={`/api/task-files/${id}`} onClick={preview && f ? (e) => { e.preventDefault(); setSelected(f); } : undefined}>
            <FileText size={16} />
            <span>{f?.name ?? "附件"}</span>
            <small>{f ? `${(f.size / 1024).toFixed(1)}KB · ${preview ? "预览" : "下载"}` : "下载"}</small>
          </a>
        );
      })}
    </div>
    {selected && <MaterialPreview file={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
function MaterialPreview({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const [content, setContent] = useState<{ url?: string; text?: string } | null>(null);
  const [error, setError] = useState("");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const supported = ["pdf", "png", "jpg", "jpeg", "txt", "md", "markdown"].includes(ext);
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    let url: string | undefined;
    fetch(`/api/task-files/${file.id}?preview=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.message || "资料暂不可用，请刷新后重试。");
        }
        if (["txt", "md", "markdown"].includes(ext)) return { text: await response.text() };
        url = URL.createObjectURL(await response.blob());
        return { url };
      }).then((value) => { if (!controller.signal.aborted) setContent(value); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file.id, ext, supported]);
  return <TaskModal title={file.name} onClose={onClose}>
    <div className="task-material-preview">
      {!supported ? <p>该格式暂不支持站内预览，请下载后查看。</p> : error ? <p role="alert" className="task-error">{error} 如文件仍可用，可尝试下载；否则请联系发布者。</p> : !content ? <p role="status">正在加载资料…</p> :
        ext === "pdf" ? <PdfPreview url={content.url!} onError={setError} /> :
        ["png", "jpg", "jpeg"].includes(ext) ?
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.url} alt={file.name} onError={() => setError("图片无法展示，请尝试下载查看。")} /> :
        ext === "txt" ? <pre>{content.text}</pre> : <TaskMarkdown text={content.text ?? ""} />}
    </div>
    <div className="task-preview-actions"><a className="button primary" href={`/api/task-files/${file.id}`}>下载资料</a><button type="button" className="button secondary" onClick={onClose}>关闭预览</button></div>
  </TaskModal>;
}
function PdfPreview({ url, onError }: { url: string; onError: (message: string) => void }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let loading: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    import("pdfjs-dist").then((pdf) => {
      if (disposed) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      loading = pdf.getDocument({ url, enableXfa: false, useSystemFonts: true,
        cMapUrl: "/api/pdf-assets/cmaps/", cMapPacked: true,
        standardFontDataUrl: "/api/pdf-assets/standard_fonts/", wasmUrl: "/api/pdf-assets/wasm/" });
      return loading.promise.then((value) => { if (!disposed) setDocument(value); });
    }).catch(() => { if (!disposed) onError("PDF无法预览，可能是加密或格式不完整，请下载后查看。"); });
    return () => { disposed = true; void loading?.destroy().catch(() => {}); };
  }, [url, onError]);
  useEffect(() => {
    const element = canvas.current, parent = container.current;
    if (!document || !element || !parent) return;
    let disposed = false, iteration = 0;
    let render: RenderTask | undefined;
    async function draw() {
      const current = ++iteration;
      const previous = render;
      previous?.cancel();
      await previous?.promise.catch(() => {});
      try {
        const pdfPage = await document!.getPage(page);
        if (disposed || current !== iteration) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(100, parent!.clientWidth - 2);
        const scale = Math.min(width / base.width, Math.sqrt(4_000_000 / (base.width * base.height)) / 2);
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        element!.width = Math.floor(viewport.width * ratio);
        element!.height = Math.floor(viewport.height * ratio);
        element!.style.width = `${viewport.width}px`;
        element!.style.height = `${viewport.height}px`;
        element!.dataset.rendered = "false";
        render = pdfPage.render({ canvas: element!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (!disposed && current === iteration) element!.dataset.rendered = "true";
      } catch (error) {
        if (!disposed && (error as Error).name !== "RenderingCancelledException") onError("PDF页面无法展示，请下载后查看。");
      }
    }
    const observer = new ResizeObserver(() => void draw());
    observer.observe(parent);
    return () => { disposed = true; observer.disconnect(); render?.cancel(); };
  }, [document, page, onError]);
  return <div className="task-pdf-preview">
    {!document && <p role="status">正在读取 PDF…</p>}
    {document && <div className="task-pdf-pages">
      <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
      <span>第 {page} / {document.numPages} 页</span>
      <button type="button" className="button secondary" disabled={page >= document.numPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
    </div>}
    <div ref={container}><canvas ref={canvas} aria-label={`PDF第${page}页`} /></div>
  </div>;
}
function FilePicker({
  files,
  onChange,
  onUploading,
  disabled = false,
}: {
  files: FileInfo[];
  onChange: (files: FileInfo[]) => void;
  onUploading: (value: boolean) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unbound, setUnbound] = useState<UnboundFile[]>([]);
  const temporaryIds = useRef(new Set<string>());
  const [hasMore, setHasMore] = useState(false);
  async function refreshUnbound() {
    const data = await taskRequest<{ files: UnboundFile[]; hasMore: boolean }>("/api/task-files");
    data.files.forEach((f) => temporaryIds.current.add(f.id));
    setUnbound(data.files);
    setHasMore(data.hasMore);
  }
  useEffect(() => {
    let mounted = true;
    void taskRequest<{ files: UnboundFile[]; hasMore: boolean }>("/api/task-files").then((data) => {
      if (mounted) { data.files.forEach((f) => temporaryIds.current.add(f.id)); setUnbound(data.files); setHasMore(data.hasMore); }
    }).catch(() => { if (mounted) setError("未提交附件列表暂不可用，请刷新后重试。"); });
    return () => { mounted = false; };
  }, []);
  async function remove(f: FileInfo, clean = false) {
    if (!clean && !temporaryIds.current.has(f.id)) {
      onChange(files.filter((other) => other.id !== f.id));
      return;
    }
    setLoading(true);
    onUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/task-files/${f.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      if (!response.ok) {
        const result = await response.json();
        if (response.status !== 404 && !(result.code === "FILE_IN_USE" && !clean))
          throw new Error(result.message ?? "文件清理失败，请重试。");
      }
      temporaryIds.current.delete(f.id);
      onChange(files.filter((other) => other.id !== f.id));
      await refreshUnbound();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); onUploading(false); }
  }
  async function upload(list: FileList | null) {
    if (!list) return;
    setError("");
    if (files.length + list.length > 5) {
      setError("最多上传5个附件，请移除部分文件。");
      return;
    }
    setLoading(true);
    onUploading(true);
    const next = [...files];
    try {
      for (const file of Array.from(list)) {
        if (!file.size || file.size > MAX_TASK_FILE_BYTES)
          throw new Error("文件须非空且不超过10MB，请压缩或改用链接。");
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/task-files", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message ?? "文件上传失败，请重试。");
        next.push(result.data);
        temporaryIds.current.add(result.data.id);
        setUnbound((items) => [{ ...result.data, deleting: false }, ...items]);
        onChange([...next]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      onUploading(false);
    }
  }
  return (
    <div className="task-file-picker">
      <label className="button secondary">
        <Upload size={16} />
        {loading ? "上传中…" : "添加附件"}
        <input
          type="file"
          accept={TASK_FILE_ACCEPT}
          multiple
          disabled={disabled || loading || files.length >= 5}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <small>最多5个，每个10MB；支持PDF、文本、图片和Office文档</small>
      <small>移除未提交附件会清理文件；已进入任务历史的附件只移除当前引用。</small>
      {files.map((f) => (
        <div className="task-picked-file" key={f.id}>
          <span>{f.name}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={`移除${f.name}`}
            disabled={disabled || loading}
            onClick={() => void remove(f)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <details>
        <summary>本人未提交附件（可清理释放额度）</summary>
        <small>取消表单后文件仍在此处；清理只删除未提交文件，已进入任务历史的附件保留。</small>
        {unbound.map((f) => (
          <div className="task-unbound-file" key={f.id}>
            <span>{f.name} · {(f.size / 1024).toFixed(1)}KB{f.deleting ? " · 清理待重试" : ""}</span>
            {!f.deleting && !files.some((selected) => selected.id === f.id) && <button type="button" className="button secondary" disabled={disabled || loading || files.length >= 5} onClick={() => onChange([...files, f])}>使用</button>}
            <button type="button" className="button secondary" disabled={disabled || loading} aria-label={`清理${f.name}`} onClick={() => void remove(f, true)}>{f.deleting ? "重试清理" : "清理"}</button>
          </div>
        ))}
        {!unbound.length && <p>暂无未提交附件。</p>}
        {hasMore && <p>仅展示最近50个；清理后刷新可继续处理更早附件。</p>}
        <button type="button" className="button secondary" disabled={disabled || loading} onClick={() => void refreshUnbound().catch(() => setError("刷新失败，请稍后重试。"))}>刷新未提交附件</button>
      </details>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function TargetPicker({
  options,
  directIds,
  groupIds,
  onChange,
  allowGroups,
  disabled = false,
}: {
  options: Options;
  directIds: number[];
  groupIds: number[];
  onChange: (people: number[], groups: number[]) => void;
  allowGroups: boolean;
  disabled?: boolean;
}) {
  const toggle = (ids: number[], id: number) =>
    ids.includes(id) ? ids.filter((n) => n !== id) : [...ids, id];
  const selectedGroups = allowGroups ? options.groups.filter((g) => groupIds.includes(g.id)) : [];
  const count = new Set([...directIds, ...selectedGroups.flatMap((g) => g.members.map((m) => m.id))]).size;
  const excluded = [...new Map(selectedGroups.flatMap((g) => g.excluded).map((m) => [m.id, m])).values()];
  return (
    <div className="task-target-picker">
      <fieldset disabled={disabled}>
        <legend>直接指定成员（{directIds.length}）</legend>
        <div className="task-choice-grid">
          {options.members.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={directIds.includes(m.id)}
                onChange={() => onChange(toggle(directIds, m.id), groupIds)}
              />
              {m.name}
            </label>
          ))}
          {!options.members.length && <p>暂无已注册成员。</p>}
        </div>
      </fieldset>
      {allowGroups && (
        <fieldset disabled={disabled}>
          <legend>指定项目小组（{groupIds.length}）</legend>
          <div className="task-choice-grid">
            {options.groups.map((g) => (
              <label key={g.id}>
                <input
                  type="checkbox"
                  checked={groupIds.includes(g.id)}
                  aria-label={g.name}
                  onChange={() => onChange(directIds, toggle(groupIds, g.id))}
                />
                {g.name}
              </label>
            ))}
          </div>
          <small>
            个人与多个小组合并去重，随小组成员变化；不能在任务内单独排除组员。
          </small>
        </fieldset>
      )}
      <p>合并去重后可执行{count}人，提交时以最新成员状态为准。</p>
      {excluded.length > 0 && <p className="task-overdue" role="status">已排除：{excluded.map((m) => `${m.name}（${m.reason}）`).join("、")}。仅已注册且启用的成员可执行；请核对名单或调整目标小组。</p>}
    </div>
  );
}
function TaskForm({
  options,
  initial,
  initialFiles = [],
  onSave,
  saving,
}: {
  options: Options;
  initial?: TaskCreate;
  initialFiles?: FileInfo[];
  onSave: (data: TaskCreate) => Promise<void>;
  saving: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<TaskCreate["kind"]>(
    initial?.kind ?? "announcement",
  );
  const [delivery, setDelivery] = useState<TaskCreate["delivery"]>(
    initial?.delivery ?? "shared",
  );
  const [deadline, setDeadline] = useState(
    beijingInput(initial?.deadline ?? null),
  );
  const [capacity, setCapacity] = useState(initial?.capacity?.toString() ?? "");
  const [directIds, setDirectIds] = useState(initial?.directIds ?? []);
  const [groupIds, setGroupIds] = useState(initial?.groupIds ?? []);
  const [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (uploading) return;
    setError("");
    try {
      await onSave({
        title,
        description,
        kind,
        delivery,
        deadline: beijingDeadline(deadline),
        capacity: kind === "assigned" || !capacity ? null : Number(capacity),
        directIds,
        groupIds: kind === "assigned" ? groupIds : [],
        fileIds: files.map((f) => f.id),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form className={`task-form${initial ? "" : " task-publish-form"}`} onSubmit={submit}>
      <fieldset disabled={saving}>
        <section className="task-form-section task-content-fields">
          {!initial && <h2>任务内容</h2>}
          <label>
            任务标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              placeholder="例如：完成本周实验结果汇总"
            />
          </label>
          <TaskMarkdownEditor value={description} onChange={setDescription} />
          <div className="task-materials">
            <span className="task-field-label">任务资料</span>
            <small>发布后，成员可在任务详情预览或下载参考资料；Office 文件需下载查看。</small>
            <FilePicker
              files={files}
              onChange={setFiles}
              onUploading={setUploading}
              disabled={saving}
            />
          </div>
        </section>
        <section className="task-form-section task-arrangement-fields">
          {!initial && <h2>执行安排</h2>}
          <div className="task-form-row">
            <div className="task-field">
              <span>任务类型</span>
              <SelectControl
                value={kind}
                label="任务类型"
                disabled={!!initial}
                onChange={(value) => setKind(value as TaskCreate["kind"])}
                options={[{ value: "announcement", label: "公告任务 · 自行领取" }, { value: "assigned", label: "指定任务 · 直接安排" }]}
              />
            </div>
            <div className="task-field">
              <span>交付模式</span>
              <SelectControl
                value={delivery}
                label="交付模式"
                disabled={!!initial}
                onChange={(value) =>
                  setDelivery(value as TaskCreate["delivery"])
                }
                options={[{ value: "shared", label: "共同交付一份成果" }, { value: "individual", label: "每人分别交付" }]}
              />
            </div>
          </div>
          <div className="task-form-row">
            <TaskDeadline label="截止时间（北京时间，可选）" value={deadline} onChange={setDeadline} />
            {kind === "announcement" && (
              <label>
                人数上限（留空不限）
                <input
                  type="number"
                  value={capacity}
                  min={1}
                  max={1000}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="不限人数"
                />
              </label>
            )}
          </div>
          {!initial && (
            <TargetPicker
              options={options}
              directIds={directIds}
              groupIds={groupIds}
              allowGroups={kind === "assigned"}
              onChange={(p, g) => {
                setDirectIds(p);
                setGroupIds(g);
              }}
            />
          )}
        </section>
        <div className="task-form-footer">
          {error && (
            <p className="task-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={saving || uploading}
            type="submit"
          >
            {saving ? "保存中…" : initial ? "保存要求" : "发布任务"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export function TaskListView({
  initial,
  person,
  guest,
}: {
  initial: ListItem[];
  person: Person;
  guest: boolean;
}) {
  const [now] = useState(Date.now);
  const [items, setItems] = useState(initial);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState("");
  const shown = items.filter(
    (t) =>
      (!search || t.title.includes(search) || t.publisher.includes(search)) &&
      t.status === status &&
      (filter === "all" || (filter === "mine" ? t.mine : t.executing)),
  );
  async function refresh() {
    try {
      setItems(await taskRequest<ListItem[]>("/api/tasks"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <AppShell guest={guest} currentUser={person}>
      <PageHeader
        eyebrow={guest ? "游客只读访问" : "实验室协作"}
        title="任务协作"
        description={
          guest
            ? "查看任务标题与进度；登录后可查看要求、成果并参与任务。"
            : "公开招募或直接安排，让每份任务都有明确的交付。"
        }
        actions={
          !guest && (
            <Link className="button primary" href="/tasks/new">
              <Plus size={18} />
              发布任务
            </Link>
          )
        }
      />
      <div className="task-toolbar">
        <label className="task-search">
          <span className="sr-only">搜索任务</span>
          <input
            placeholder="搜索标题或发布者"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!guest && (
          <SelectControl label="任务范围" value={filter} onChange={setFilter} options={[{ value: "all", label: "全部任务" }, { value: "mine", label: "我发布的" }, { value: "executing", label: "我执行的" }]} />
        )}
        <SelectControl label="任务状态" value={status} onChange={setStatus} options={[{ value: "active", label: "进行中" }, { value: "completed", label: "已完成" }, { value: "cancelled", label: "已撤销" }]} />
        <button className="button secondary" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      {(status === "active" ? [{ kind: "announcement", title: "公开任务" }, { kind: "assigned", title: "指定任务" }] : [{ kind: "all", title: taskStatusLabels[status as keyof typeof taskStatusLabels] }]).map((section) => {
        const sectionItems = section.kind === "all" ? shown : shown.filter((t) => t.kind === section.kind);
        return <section className="task-list-section" key={section.kind} aria-label={section.title}>
        <header><h2>{section.title}</h2><span>{sectionItems.length} 个任务</span></header>
        <div className="task-list panel">
        {sectionItems.map((t) => (
          <article className="task-row" key={t.id}>
            <div className={`task-marker ${t.status}`}>
              <ClipboardList size={21} />
            </div>
            <div className="task-row-main">
              <div className="task-row-title">
                {guest ? (
                  <h2>{t.title}</h2>
                ) : (
                  <h2>
                    <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                  </h2>
                )}
                <span className={`task-badge ${t.status}`}>
                  {taskStatusLabels[t.status]}
                </span>
                {status !== "active" && <span className="task-badge">{t.kind === "announcement" ? "公开任务" : "指定任务"}</span>}
              </div>
              <p>
                {t.publisher}发布 <span>·</span> {taskDate(t.deadline)}
                {!guest &&
                  t.status === "active" &&
                  t.deadline &&
                  Date.parse(t.deadline) < now && (
                    <strong className="task-overdue">
                      {" "}
                      · 已逾期，可继续提交
                    </strong>
                  )}
              </p>
              {!guest && (
                <div className="task-row-meta">
                  <span>
                    {t.kind === "announcement" ? "公告领取" : "直接指派"}
                  </span>
                  <span>
                    {t.delivery === "shared" ? "共同交付" : "逐人交付"}
                  </span>
                  <span>
                    第{t.round}轮 · {t.count}人执行
                  </span>
                  {t.kind === "announcement" && (
                    <span>
                      {!t.claimsOpen
                        ? "领取已结束"
                        : t.capacity !== null && t.count! >= t.capacity!
                          ? "名额已满"
                          : "开放领取"}
                    </span>
                  )}
                </div>
              )}
            </div>
            {!guest && (
              <Link
                className="icon-button"
                href={`/tasks/${t.id}`}
                aria-label={`查看${t.title}`}
              >
                <ArrowRight size={20} />
              </Link>
            )}
          </article>
        ))}
        {!sectionItems.length && (
          <div className="task-empty">
            <ClipboardList size={32} />
            <h2>暂无符合条件的任务</h2>
            <p>
              {guest
                ? "可以调整筛选，或稍后再来查看。"
                : "调整筛选，或发布第一项任务。"}
            </p>
          </div>
        )}
      </div></section>;
      })}
    </AppShell>
  );
}
export function NewTaskView({
  person,
  options,
}: {
  person: Person;
  options: Options;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function save(data: TaskCreate) {
    setSaving(true);
    try {
      const t = await taskRequest<{ id: number }>("/api/tasks", data);
      router.push(`/tasks/${t.id}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppShell currentUser={person}>
      <Link className="task-back" href="/tasks">
        <ArrowLeft size={16} />
        任务列表
      </Link>
      <PageHeader
        eyebrow="实验室协作"
        title="发布任务"
        description="选择公开领取或直接指定，并明确成果如何交付。"
      />
      <section className="panel task-form-panel">
        <TaskForm options={options} onSave={save} saving={saving} />
      </section>
    </AppShell>
  );
}
const actionLabels: Record<string, string> = {
  published: "发布任务",
  members: "执行名单变化",
  claimed: "领取任务",
  edited: "修改任务要求",
  targets: "调整执行对象",
  claims_closed: "结束领取",
  submitted: "提交成果",
  approved: "验收通过",
  returned: "打回成果",
  completed: "任务完成",
  cancelled: "撤销任务",
  reopened: "重新开启",
};
export function TaskDetailView({
  initial,
  person,
  options,
}: {
  initial: Detail;
  person: Person;
  options: Options;
}) {
  const [now] = useState(Date.now);
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
    "edit" | "targets" | "reopen" | "cancel" | null
  >(null);
  const [selectedRound, setSelectedRound] = useState(initial.currentRound);
  const r = data.rounds.find((r) => r.number === selectedRound)!;
  const isCurrent = selectedRound === data.currentRound;
  const ongoing = isCurrent && data.status === "active";
  const members = data.members.filter((p) => p.roundId === r.id);
  const active = members.filter((p) => p.active);
  const own = active.find((p) => p.studentId === person.studentId);
  const publisher = data.publisherId === person.studentId;
  const submissions = data.submissions.filter((s) => s.roundId === r.id);
  const latest = submissions.filter(
    (s) =>
      !submissions.some(
        (o) => o.subjectKey === s.subjectKey && o.version > s.version,
      ),
  );
  const subjects = active.map((p) =>
    taskSubject(data.delivery, p.studentId, p.generation),
  );
  const passed =
    data.delivery === "shared"
      ? latest.some((s) => s.subjectKey === "shared" && s.status === "approved")
        ? 1
        : 0
      : subjects.filter((k) =>
          latest.some((s) => s.subjectKey === k && s.status === "approved"),
        ).length;
  const ownLatest = own
    ? latest.find(
        (s) =>
          s.subjectKey ===
          taskSubject(data.delivery, person.studentId, own.generation),
      )
    : undefined;
  async function command(body: TaskCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await taskRequest(`/api/tasks/${data.id}`, body);
      const next = await taskRequest<Detail>(`/api/tasks/${data.id}`);
      setData(next);
      setSelectedRound(next.currentRound);
      setModal(null);
      setNotice("操作已完成。");
      window.dispatchEvent(new Event("task-notifications-changed"));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const run = (body: TaskCommand) => {
    void command(body).catch(() => {});
  };
  const initialForm: TaskCreate = {
    title: r.title,
    description: r.description,
    kind: data.kind,
    delivery: data.delivery,
    deadline: r.deadline,
    capacity: r.capacity,
    directIds: r.directIds,
    groupIds: r.groupIds,
    fileIds: r.fileIds,
  };
  return (
    <AppShell currentUser={person}>
      <Link className="task-back" href="/tasks">
        <ArrowLeft size={16} />
        任务列表
      </Link>
      <PageHeader
        eyebrow={`${data.publisher}发布 · ${data.kind === "announcement" ? "公告任务" : "指定任务"}`}
        title={r.title}
        description={`第${r.number}轮 · ${data.delivery === "shared" ? "共同交付一份成果" : "每人分别交付"} · ${taskDate(r.deadline)}`}
        actions={
          <span className={`task-badge ${data.status}`}>
            {isCurrent
              ? taskStatusLabels[data.status]
              : r.outcome === "cancelled"
                ? "本轮已撤销"
                : "本轮已完成"}
          </span>
        }
      />
      {error && (
        <p className="task-error" role="alert">
          {error}{" "}
          <button
            className="button secondary"
            onClick={async () => {
              try {
                setData(await taskRequest<Detail>(`/api/tasks/${data.id}`));
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            刷新任务
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="task-notice">
          {notice}
        </p>
      )}
      <div className="task-round-toolbar">
        <SelectControl label="查看轮次" value={String(selectedRound)} onChange={(value) => setSelectedRound(Number(value))}
          options={data.rounds.map((r) => ({ value: String(r.number), label: `第${r.number}轮${r.number === data.currentRound ? " · 当前" : " · 历史"}` }))} />
        {publisher && isCurrent && (
          <div className="task-actions">
            {ongoing ? (
              <>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setModal("edit")}
                >
                  修改要求
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setModal("targets")}
                >
                  调整执行对象
                </button>
                {data.kind === "announcement" && r.claimsOpen && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      run({ action: "close", expectedRevision: data.revision })
                    }
                  >
                    结束领取
                  </button>
                )}
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => setModal("cancel")}
                >
                  撤销任务
                </button>
              </>
            ) : (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setModal("reopen")}
              >
                重新开启
              </button>
            )}
          </div>
        )}
      </div>
      <div className="task-detail-grid">
        <section className="panel task-requirements">
          <h2>任务要求</h2>
          <TaskMarkdown text={r.description} />
          <Files ids={r.fileIds} files={data.files} preview />
          {r.deadline && Date.parse(r.deadline) < now && ongoing && (
            <p className="task-overdue">已逾期，仍可提交，由发布者决定验收。</p>
          )}
        </section>
        <aside className="panel task-roster">
          <h2>执行进度</h2>
          {ongoing && data.targetExclusions.length > 0 && <p className="task-overdue" role="status">已排除：{data.targetExclusions.map((m) => `${m.name}（${m.reason}）`).join("、")}。仅已注册且启用的成员可执行，请发布者核对执行名单。</p>}
          <div className="task-progress">
            <strong>
              {passed}
              <small>
                {" "}
                /{" "}
                {data.delivery === "shared"
                  ? active.length
                    ? 1
                    : 0
                  : active.length}
              </small>
            </strong>
            <span>成果已通过</span>
          </div>
          <div className="task-roster-list">
            {active.map((p) => {
              const s = latest.find(
                (v) =>
                  v.subjectKey ===
                  taskSubject(data.delivery, p.studentId, p.generation),
              );
              return (
                <div key={p.id}>
                  <span>{p.name}</span>
                  <small>
                    {s ? submissionStatusLabels[s.status] : "未提交"}
                  </small>
                </div>
              );
            })}
          </div>
          {!active.length && <p>暂无执行成员，发布者需安排人员或撤销。</p>}
          {r.groupIds.length > 0 && (
            <p className="task-muted">
              目标小组：
              {r.groupIds
                .map((id) => r.groupNames[String(id)] ?? "已解散小组")
                .join("、")}
            </p>
          )}
          {members.some((p) => !p.active) && (
            <details>
              <summary>已移出成员</summary>
              <p>
                {members
                  .filter((p) => !p.active)
                  .map((p) => p.name)
                  .join("、")}
              </p>
            </details>
          )}
          {data.kind === "announcement" && (
            <p className="task-muted">
              {r.claimsOpen
                ? `领取开放 · ${r.capacity ?? "不限"}人${r.capacity && active.length >= r.capacity ? " · 名额已满" : ""}`
                : "领取已结束"}
            </p>
          )}
          {ongoing && data.kind === "announcement" && r.claimsOpen && !own && (
            <button
              className="button primary"
              disabled={
                busy || (r.capacity !== null && active.length >= r.capacity)
              }
              onClick={() => run({ action: "claim" })}
            >
              领取任务
            </button>
          )}
          {ongoing && own && (
            <p className="task-muted">已承担本轮任务；退出请联系发布者。</p>
          )}
        </aside>
      </div>
      {ongoing && own && ownLatest?.status !== "approved" && (
        <section className="panel task-section">
          <h2>{ownLatest ? "重新提交成果" : "提交成果"}</h2>
          <p className="task-muted">
            {data.delivery === "shared"
              ? "任意执行成员可提交共同成果，重提会生成新版，请先确认当前版本。"
              : "提交你自己的成果，所有当前执行成员分别验收通过后才能完成。"}
          </p>
          {ownLatest?.feedback && (
            <p className="task-return-reason">打回原因：{ownLatest.feedback}</p>
          )}
          <SubmissionForm
            key={`${r.id}:${ownLatest?.id ?? 0}`}
            current={ownLatest}
            files={data.files}
            busy={busy}
            onSubmit={(v) =>
              command({
                action: "submit",
                roundId: r.id,
                expectedVersion: ownLatest?.version ?? 0,
                requestKey: crypto.randomUUID(),
                ...v,
              })
            }
          />
        </section>
      )}
      <section className="panel task-section">
        <div className="panel-heading">
          <h2>成果与验收</h2>
          <span className="task-muted">{submissions.length}个提交版本</span>
        </div>
        {!submissions.length && (
          <p className="task-muted">
            还没有成果；执行成员可填写汇报、链接或上传文件。
          </p>
        )}
        {submissions.map((s) => {
          const isLatest = latest.some((v) => v.id === s.id);
          const currentSubject =
            data.delivery === "shared" || subjects.includes(s.subjectKey);
          const reviewable =
            publisher &&
            ongoing &&
            isLatest &&
            currentSubject &&
            s.status === "pending";
          return (
            <article className="task-submission" key={s.id}>
              <header>
                <div>
                  <strong>
                    {data.delivery === "shared" ? "共同成果" : s.authorName} ·
                    第{s.version}版
                  </strong>
                  <small>
                    {s.authorName}提交 · {taskDate(s.createdAt)}
                  </small>
                </div>
                <span className={`task-badge ${s.status}`}>
                  {submissionStatusLabels[s.status]}
                  {!isLatest
                    ? " · 历史版"
                    : !currentSubject
                      ? " · 历史成员"
                      : ""}
                </span>
              </header>
              <p className="task-body">{s.body}</p>
              {s.links.map((url) => (
                <a
                  className="task-link"
                  href={url}
                  key={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {url}
                </a>
              ))}
              <Files ids={s.fileIds} files={data.files} />
              {s.feedback && (
                <p className="task-return-reason">验收反馈：{s.feedback}</p>
              )}
              {reviewable && (
                <ReviewForm
                  busy={busy}
                  onReview={(decision, reason) =>
                    command({
                      action: "review",
                      roundId: r.id,
                      submissionId: s.id,
                      decision,
                      reason,
                    })
                  }
                />
              )}
            </article>
          );
        })}
      </section>
      <section className="panel task-section">
        <h2>任务记录</h2>
        <div className="task-timeline">
          {data.events
            .filter((e) => e.roundId === r.id)
            .map((e) => (
              <details key={e.id}>
                <summary>
                  <span>{actionLabels[e.action] ?? e.action}</span>
                  <time>{taskDate(e.createdAt)}</time>
                </summary>
                <EventDetail detail={e.detail} files={data.files} materials={["published", "edited", "reopened"].includes(e.action)} />
              </details>
            ))}
        </div>
      </section>
      {modal === "edit" && (
        <TaskModal title="修改任务要求" onClose={() => setModal(null)}>
          <TaskForm
            options={options}
            initial={initialForm}
            initialFiles={data.files.filter((f) => r.fileIds.includes(f.id))}
            saving={busy}
            onSave={(v) =>
              command({
                action: "edit",
                expectedRevision: data.revision,
                title: v.title,
                description: v.description,
                deadline: v.deadline,
                capacity: v.capacity,
                fileIds: v.fileIds,
              })
            }
          />
        </TaskModal>
      )}
      {modal === "targets" && (
        <TaskModal title="调整执行对象" onClose={() => setModal(null)}>
          <TargetForm
            options={options}
            directIds={
              data.kind === "announcement"
                ? active.map((p) => p.studentId)
                : r.directIds
            }
            groupIds={r.groupIds}
            capacity={r.capacity}
            assigned={data.kind === "assigned"}
            busy={busy}
            onSave={(directIds, groupIds, capacity) =>
              command({
                action: "targets",
                expectedRevision: data.revision,
                directIds,
                groupIds,
                capacity,
              })
            }
          />
        </TaskModal>
      )}
      {modal === "reopen" && (
        <TaskModal title="重新开启任务" onClose={() => setModal(null)}>
          <ReopenForm
            announcement={data.kind === "announcement"}
            deadline={r.deadline}
            busy={busy}
            onSave={(claimsOpen, deadline) =>
              command({
                action: "reopen",
                expectedRevision: data.revision,
                claimsOpen,
                deadline,
              })
            }
          />
        </TaskModal>
      )}
      {modal === "cancel" && (
        <ConfirmationDialog title="撤销任务" description="撤销后停止领取、提交和验收，任务与成果历史保留。之后可以重新开启。"
          confirmLabel="确认撤销" busy={busy} error={error} onClose={() => setModal(null)}
          onConfirm={() => run({ action: "cancel", expectedRevision: data.revision })} />
      )}
    </AppShell>
  );
}
function EventDetail({
  detail,
  files,
  materials = false,
}: {
  detail: Record<string, unknown>;
  files: FileInfo[];
  materials?: boolean;
}) {
  const labels: Record<string, string> = {
    before: "变更前",
    after: "变更后",
    added: "加入",
    removed: "移出",
    title: "标题",
    description: "要求",
    reason: "原因",
    name: "成员",
    version: "版本",
    previousRound: "上一轮",
    members: "执行成员",
    groupNames: "项目小组",
    deadline: "截止时间",
    capacity: "人数上限",
    claimsOpen: "公告领取",
    number: "轮次",
  };
  return (
    <div className="task-event-detail">
      {Object.entries(detail)
        .filter(([key]) => key === "fileIds" || key in labels)
        .map(([key, value]) =>
          key === "fileIds" && Array.isArray(value) ? (
            <Files key={key} ids={value as string[]} files={files} preview={materials} />
          ) : key === "description" && typeof value === "string" ? (
            <div key={key}><strong>{labels[key]}</strong><TaskMarkdown text={value} /></div>
          ) : (
            <div key={key}>
              <strong>{labels[key]}</strong>
              {value !== null &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              key !== "groupNames" ? (
                <EventDetail
                  detail={value as Record<string, unknown>}
                  files={files}
                  materials={materials}
                />
              ) : (
                <p className="task-body">
                  {key === "deadline"
                    ? taskDate(value as string | null)
                    : key === "capacity" && value === null
                      ? "不限人数"
                      : key === "claimsOpen"
                        ? value
                          ? "开放领取"
                          : "停止领取"
                        : key === "groupNames" &&
                            value &&
                            typeof value === "object"
                          ? Object.values(value).join("、") || "无"
                          : Array.isArray(value)
                            ? value
                                .map((v) =>
                                  typeof v === "object" && v && "name" in v
                                    ? v.name
                                    : String(v),
                                )
                                .join("、") || "无"
                            : String(value ?? "无")}
                </p>
              )}
            </div>
          ),
        )}
    </div>
  );
}
function SubmissionForm({
  current,
  files,
  busy,
  onSubmit,
}: {
  current?: Detail["submissions"][number];
  files: FileInfo[];
  busy: boolean;
  onSubmit: (v: {
    body: string;
    links: string[];
    fileIds: string[];
  }) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState(current?.body ?? "");
  const [links, setLinks] = useState(current?.links.join("\n") ?? "");
  const [chosen, setChosen] = useState(
    files.filter((f) => current?.fileIds.includes(f.id)),
  );
  const [error, setError] = useState("");
  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (uploading) return;
        setError("");
        try {
          await onSubmit({
            body,
            links: links
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            fileIds: chosen.map((f) => f.id),
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <fieldset disabled={busy}>
        <label>
          成果说明
          <textarea
            aria-label="成果说明"
            rows={4}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="写明完成内容、结果和需要说明的问题"
          />
        </label>
        <label>
          成果链接（每行一个）
          <textarea
            aria-label="成果链接（每行一个）"
            rows={2}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <FilePicker
          files={chosen}
          onChange={setChosen}
          onUploading={setUploading}
          disabled={busy}
        />
        {error && (
          <p className="task-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || uploading}
          type="submit"
        >
          {busy ? "提交中…" : current ? "提交新版本" : "提交成果"}
        </button>
      </fieldset>
    </form>
  );
}
function ReviewForm({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: (decision: "approve" | "return", reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function review(decision: "approve" | "return") {
    setError("");
    if (decision === "return" && !reason.trim()) {
      setError("请填写打回原因，说明需要补充的内容。");
      return;
    }
    try {
      await onReview(decision, reason);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="task-review">
      <label>
        验收反馈（打回时必填）
        <textarea
          aria-label="验收反馈（打回时必填）"
          rows={2}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="task-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void review("approve")}
        >
          验收通过
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void review("return")}
        >
          打回补充
        </button>
      </div>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function TargetForm({
  options,
  directIds,
  groupIds,
  capacity,
  assigned,
  busy,
  onSave,
}: {
  options: Options;
  directIds: number[];
  groupIds: number[];
  capacity: number | null;
  assigned: boolean;
  busy: boolean;
  onSave: (p: number[], g: number[], c: number | null) => Promise<void>;
}) {
  const [people, setPeople] = useState(directIds);
  const [gs, setGs] = useState(groupIds);
  const [cap, setCap] = useState(capacity?.toString() ?? "");
  const [error, setError] = useState("");
  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSave(people, gs, assigned || !cap ? null : Number(cap));
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <TargetPicker
        options={options}
        directIds={people}
        groupIds={gs}
        allowGroups={assigned}
        disabled={busy}
        onChange={(p, g) => {
          setPeople(p);
          setGs(g);
        }}
      />
      {!assigned && (
        <label>
          人数上限（留空不限）
          <input
            type="number"
            min={1}
            max={1000}
            value={cap}
            disabled={busy}
            onChange={(e) => setCap(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        保存执行对象
      </button>
    </form>
  );
}
function ReopenForm({
  announcement,
  deadline,
  busy,
  onSave,
}: {
  announcement: boolean;
  deadline: string | null;
  busy: boolean;
  onSave: (open: boolean, deadline: string | null) => Promise<void>;
}) {
  const [now] = useState(Date.now);
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState(beijingInput(deadline));
  const [error, setError] = useState("");
  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSave(open, beijingDeadline(date));
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p>
        开启新一轮，历史成果仍可查看；本轮需要重新提交和验收。小组名单按当前成员更新。
      </p>
      <TaskDeadline label="新一轮截止时间（北京时间，可清空）" value={date} onChange={setDate} disabled={busy} />
      {deadline && Date.parse(deadline) < now && (
        <p className="task-overdue">
          原截止时间已过，请修改或清空，也可保留并允许逾期提交。
        </p>
      )}
      {announcement && (
        <label className="task-checkbox">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
            disabled={busy}
          />
          恢复公告领取
        </label>
      )}
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        确认重新开启
      </button>
    </form>
  );
}
