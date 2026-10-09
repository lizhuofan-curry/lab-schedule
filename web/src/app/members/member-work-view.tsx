"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { ConfirmationDialog, SelectControl } from "@/components/form-controls";
import { taskDate, taskStatusLabels } from "@/lib/task-rules";
import {
  workStatusLabels,
  type MemberTask,
  type WorkRecord,
  type WorkStatus,
} from "@/lib/work-rules";

type RecordPage = { records: WorkRecord[]; nextCursor: string | null };
type TaskPage = { tasks: MemberTask[]; nextCursor: string | null };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? "暂时无法读取工作情况，请刷新后重试。");
  return result.data;
}
function Dialog({
  title,
  children,
  busy,
  close,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="task-dialog work-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="button secondary"
          aria-label="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Editor({
  record,
  close,
  saved,
}: {
  record: WorkRecord | null;
  close: () => void;
  saved: () => void;
}) {
  const [title, setTitle] = useState(record?.title ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [status, setStatus] = useState<WorkStatus>(record?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(record ? `/api/my/work/${record.id}` : "/api/my/work", {
        method: record ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          ...(record ? { expectedRevision: record.revision } : {}),
        }),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={record ? "编辑工作记录" : "添加工作记录"}
      busy={busy}
      close={close}
    >
      <form className="work-form" onSubmit={save}>
        <label>
          工作标题
          <input
            aria-label="工作标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            disabled={busy}
          />
        </label>
        <label>
          工作说明
          <textarea
            aria-label="工作说明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={20000}
            rows={6}
            disabled={busy}
            placeholder="例如：阅读论文的方法部分，准备下次实验。"
          />
        </label>
        <div className="task-field">
          <span>工作状态</span>
          <SelectControl
            label="工作状态"
            value={status}
            onChange={(value) => setStatus(value as WorkStatus)}
            disabled={busy}
            options={Object.entries(workStatusLabels).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <p className="task-muted">
          这是本人填写的工作记录，任务成果仍需在任务详情提交和验收。
        </p>
        {error && (
          <p className="task-error" role="alert">
            {error}
          </p>
        )}
        <div className="work-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "保存中…" : "保存记录"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function MemberWorkView({
  studentId,
  currentStudentId,
}: {
  studentId: number;
  currentStudentId: number | null;
}) {
  const own = studentId === currentStudentId;
  const [scope, setScope] = useState<"recent" | "all">("recent");
  const [reload, setReload] = useState(0);
  const [records, setRecords] = useState<RecordPage | null>(null);
  const [tasks, setTasks] = useState<TaskPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ record: WorkRecord | null } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<WorkRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const base = `/api/students/${studentId}/work`;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request<RecordPage>(`${base}?scope=${scope}`, {
        signal: controller.signal,
      }),
      request<TaskPage>(`${base}/tasks`, { signal: controller.signal }),
    ])
      .then(([r, t]) => {
        if (!controller.signal.aborted) {
          setRecords(r);
          setTasks(t);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [base, scope, reload]);
  function saved() {
    setEditing(null);
    setDeleting(null);
    setReload((n) => n + 1);
  }
  async function more(kind: "records" | "tasks") {
    const cursor = kind === "records" ? records?.nextCursor : tasks?.nextCursor;
    if (!cursor) return;
    setBusy(true);
    try {
      if (kind === "records") {
        const page = await request<RecordPage>(
          `${base}?scope=${scope}&cursor=${encodeURIComponent(cursor)}`,
        );
        setRecords((old) => ({
          ...page,
          records: [
            ...(old?.records ?? []),
            ...page.records.filter(
              (r) => !old?.records.some((o) => o.id === r.id),
            ),
          ],
        }));
      } else {
        const page = await request<TaskPage>(
          `${base}/tasks?cursor=${encodeURIComponent(cursor)}`,
        );
        setTasks((old) => ({
          ...page,
          tasks: [
            ...(old?.tasks ?? []),
            ...page.tasks.filter((r) => !old?.tasks.some((o) => o.id === r.id)),
          ],
        }));
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError("");
    try {
      await request(`/api/my/work/${deleting.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: deleting.revision }),
      });
      saved();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const submissionLabels = {
    not_submitted: "未提交",
    pending: "待验收",
    returned: "被打回",
    approved: "已通过",
  };
  return (
    <div className="member-work" aria-label="成员工作情况">
      <section className="work-section" aria-label="正在做的事">
        <header className="work-heading">
          <div>
            <span className="eyebrow">本人填写</span>
            <h3>正在做的事</h3>
          </div>
          <div className="work-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setReload((n) => n + 1)}
            >
              刷新工作
            </button>
            {own && (
              <button
                type="button"
                className="button primary"
                onClick={() => setEditing({ record: null })}
              >
                <Plus size={16} />
                添加记录
              </button>
            )}
          </div>
        </header>
        {own && (
          <div className="work-range" aria-label="工作记录范围">
            <button
              type="button"
              disabled={busy}
              aria-pressed={scope === "recent"}
              onClick={() => {
                if (scope !== "recent") {
                  setRecords(null);
                  setScope("recent");
                }
              }}
            >
              近期工作
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={scope === "all"}
              onClick={() => {
                if (scope !== "all") {
                  setRecords(null);
                  setScope("all");
                }
              }}
            >
              管理全部记录
            </button>
          </div>
        )}
        <p className="task-muted">
          {scope === "all"
            ? "仅你可管理完整历史。其他成员只看到进行中、暂停和最近7天完成的记录。"
            : "展示进行中、暂停和最近7天完成的记录。"}
        </p>
        {error && (
          <div className="task-error" role="alert">
            {error}
          </div>
        )}
        {!records && !error && <p role="status">正在读取工作记录…</p>}
        {records?.records.length === 0 && (
          <p className="work-empty">
            {scope === "all"
              ? "暂无工作记录，可添加一条记录。"
              : "暂无近期工作记录"}
          </p>
        )}
        <div className="work-records">
          {records?.records.map((r) => (
            <article className="work-record" key={r.id}>
              <header>
                <h4>{r.title}</h4>
                <span className={`task-badge ${r.status}`}>
                  {workStatusLabels[r.status]}
                </span>
              </header>
              <p className="work-description">{r.description}</p>
              <footer>
                <span className="task-muted">
                  {r.status === "completed"
                    ? `完成于 ${taskDate(r.completedAt)}`
                    : `更新于 ${taskDate(r.updatedAt)}`}
                </span>
                {own && (
                  <div className="work-actions">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing({ record: r })}
                    >
                      编辑
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDeleteError("");
                        setDeleting(r);
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
        {records?.nextCursor && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void more("records")}
          >
            {busy ? "读取中…" : "加载更多记录"}
          </button>
        )}
      </section>
      <section className="work-section" aria-label="承担的任务">
        <header className="work-heading">
          <div>
            <span className="eyebrow">任务协作</span>
            <h3>承担的任务</h3>
          </div>
          <Link className="text-link" href="/tasks">
            查看任务列表
          </Link>
        </header>
        <p className="task-muted">
          进行中的任务和最近7天完成的任务；完成状态由发布者验收确定。
        </p>
        {!tasks && !error && <p role="status">正在读取任务…</p>}
        {tasks?.tasks.length === 0 && (
          <p className="work-empty">暂无符合条件的任务</p>
        )}
        <div className="work-task-list">
          {tasks?.tasks.map((t) => (
            <article className="work-task" key={t.id}>
              <header>
                <Link className="text-link" href={`/tasks/${t.id}`}>
                  {t.title}
                </Link>
                <span className={`task-badge ${t.status}`}>
                  {taskStatusLabels[t.status]}
                </span>
              </header>
              <p className="task-muted">
                {t.publisher}发布 · 第{t.round}轮 ·{" "}
                {t.delivery === "shared" ? "共同成果" : "个人成果"}：
                {submissionLabels[t.ownStatus]}
              </p>
              <p className="task-muted">
                {t.status === "completed"
                  ? `完成于 ${taskDate(t.completedAt)}`
                  : `截止时间：${taskDate(t.deadline)}`}
              </p>
            </article>
          ))}
        </div>
        {tasks?.nextCursor && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void more("tasks")}
          >
            {busy ? "读取中…" : "加载更多任务"}
          </button>
        )}
      </section>
      {editing && (
        <Editor
          record={editing.record}
          close={() => setEditing(null)}
          saved={saved}
        />
      )}
      {deleting && (
        <ConfirmationDialog title="删除工作记录" description={`确认删除“${deleting.title}”？删除后无法恢复。`}
          busy={busy} error={deleteError} confirmLabel="确认删除" onClose={() => setDeleting(null)} onConfirm={() => void remove()} />
      )}
    </div>
  );
}
