"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { taskDate } from "@/lib/task-rules";
import { ConfirmationDialog } from "./form-controls";
type Message = {
  id: number;
  taskId: number;
  roundId: number;
  title: string;
  publisher: string;
  message: string;
  assignment: boolean;
  readAt: string | null;
  createdAt: string;
};
type Inbox = {
  messages: Message[];
  assignments: Message[];
  unread: number;
  nextCursor: number | null;
};
async function request<T>(body?: unknown, before?: number, method = "POST"): Promise<T> {
  const response = await fetch(
    before ? `/api/notifications?before=${before}` : "/api/notifications",
    body
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? "消息暂不可用，请刷新后重试。");
  return result.data;
}
export function TaskNotifications() {
  const path = usePathname();
  const router = useRouter();
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void request<Inbox>()
        .then((d) => {
          if (alive) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError((e as Error).message);
        });
    };
    refresh();
    window.addEventListener("task-notifications-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("task-notifications-changed", refresh);
    };
  }, [path]);
  const popup = data?.assignments.slice(0, 200) ?? [];
  useEffect(() => {
    if (popup.length && ref.current && !ref.current.open)
      ref.current.showModal();
    if (!popup.length) ref.current?.close();
  }, [popup.length]);
  async function read(ids: number[], taskId?: number) {
    setBusy(true);
    try {
      await request({ ids });
      setData((d) =>
        d
          ? {
              ...d,
              assignments: d.assignments.filter((a) => !ids.includes(a.id)),
              messages: d.messages.map((m) =>
                ids.includes(m.id)
                  ? { ...m, readAt: new Date().toISOString() }
                  : m,
              ),
              unread: Math.max(0, d.unread - ids.length),
            }
          : d,
      );
      setError("");
      if (taskId) {
        ref.current?.close();
        router.push(`/tasks/${taskId}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="task-notification-link" href="/notifications">
        <Bell size={18} />
        站内消息{data && data.unread > 0 && <span>{data.unread}</span>}
      </Link>
      {error && (
        <p className="task-message-error" role="status">
          {error}
        </p>
      )}
      <dialog
        className="task-dialog task-assignment-popup"
        ref={ref}
        aria-label="任务指派提醒"
        onCancel={(e) => e.preventDefault()}
      >
        <header>
          <h2>你有新的任务</h2>
          <Bell size={22} />
        </header>
        <p className="task-muted">指派已生效，请查看要求并安排工作。</p>
        {popup.map((m) => (
          <article className="task-popup-item" key={m.id}>
            <div>
              <strong>{m.title}</strong>
              <p className="task-muted">发布者：{m.publisher}</p>
              <p>{m.message}</p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void read([m.id], m.taskId)}
            >
              查看任务
            </button>
          </article>
        ))}
        {error && (
          <p className="task-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void read(popup.map((m) => m.id))}
        >
          知道了
        </button>
      </dialog>
    </>
  );
}
export function NotificationInbox() {
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const [notice, setNotice] = useState("");
  const operation = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const readIds = data?.messages.filter((m) => m.readAt).map((m) => m.id) ?? [];
  const selectedIds = readIds.filter((id) => selected.includes(id));
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selectedIds.length > 0 && selectedIds.length < readIds.length;
  }, [selectedIds.length, readIds.length]);
  async function loadMore() {
    if (!data?.nextCursor || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const more = await request<Inbox>(undefined, data.nextCursor);
      setData((d) =>
        d
          ? {
              ...more,
              messages: [
                ...d.messages,
                ...more.messages.filter(
                  (m) => !d.messages.some((previous) => previous.id === m.id),
                ),
              ],
            }
          : more,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      setData(await request<Inbox>());
      setSelected([]);
      setNotice("");
      setError("");
      window.dispatchEvent(new Event("task-notifications-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void request<Inbox>()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function mark(ids: number[]) {
    if (!ids.length || operation.current) return;
    operation.current = true;
    setBusy(true);
    setNotice("");
    try {
      for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        await request({ ids: batch });
        setData((d) => d ? {
          ...d,
          messages: d.messages.map((m) => batch.includes(m.id) ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m),
          unread: Math.max(0, d.unread - d.messages.filter((m) => !m.readAt && batch.includes(m.id)).length),
        } : d);
      }
      setError("");
      window.dispatchEvent(new Event("task-notifications-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function confirmDelete(ids: number[]) {
    if (!ids.length || operation.current) return;
    if (ids.length > 10000) {
      setError("一次最多清理10000条消息，请通过多选减少数量后重试。");
      return;
    }
    setError("");
    setNotice("");
    setPendingDelete([...ids]);
  }
  async function remove() {
    if (!pendingDelete?.length || operation.current) return;
    const ids = pendingDelete;
    operation.current = true;
    setBusy(true);
    try {
      await request({ ids, confirm: true }, undefined, "DELETE");
      // Preserve the loaded range and cursor: newly arriving/unloaded rows are not targets.
      setData((d) => d ? { ...d, messages: d.messages.filter((m) => !ids.includes(m.id)) } : d);
      setSelected((previous) => previous.filter((id) => !ids.includes(id)));
      setPendingDelete(null);
      setNotice(`已清理所选的${ids.length}条已读消息。`);
      setError("");
      window.dispatchEvent(new Event("task-notifications-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="task-toolbar">
        <span>{data ? `${data.unread}条未读` : "加载消息中…"}</span>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新
        </button>
        {data?.messages.some((m) => !m.readAt) && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void mark(data.messages.filter((m) => !m.readAt).map((m) => m.id))
            }
          >
            将本页消息标为已读
          </button>
        )}
      </div>
      {data && data.messages.length > 0 && (
        <div className="notification-cleanup">
          <label className="notification-select-all">
            <input ref={selectAll} type="checkbox" aria-label="全选已加载的已读消息"
              checked={readIds.length > 0 && selectedIds.length === readIds.length}
              disabled={busy || !readIds.length}
              onChange={(e) => setSelected(e.target.checked ? readIds : [])} />
            全选已读
          </label>
          <span>已选{selectedIds.length}条 · 可清理{readIds.length}条</span>
          <button className="button danger" disabled={busy || !selectedIds.length}
            onClick={() => confirmDelete(selectedIds)}>删除所选</button>
          <button className="button secondary" disabled={busy || !readIds.length}
            onClick={() => confirmDelete(readIds)}>删除已加载的已读消息</button>
          <p className="task-muted">仅清理当前已加载的已读消息；未读和更早未加载的消息会保留。</p>
        </div>
      )}
      {notice && <p className="notification-notice" role="status">{notice}</p>}
      {error && !pendingDelete && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel task-list">
        {data?.messages.map((m) => (
          <article
            className={`task-message ${m.readAt ? "" : "unread"}`}
            key={m.id}
          >
            <label className="notification-select" title={m.readAt ? "选择此条已读消息" : "请先阅读并标为已读"}>
              <input type="checkbox" aria-label={`选择消息：${m.title}（${m.id}）`}
                checked={selectedIds.includes(m.id)} disabled={busy || !m.readAt}
                onChange={(e) => setSelected((previous) => e.target.checked ? [...previous, m.id] : previous.filter((id) => id !== m.id))} />
              <span className="sr-only">{m.readAt ? "选择已读消息" : "未读消息不可删除"}</span>
            </label>
            <div className="notification-content">
              <Link
                href={`/tasks/${m.taskId}`}
                onClick={() => {
                  if (!m.readAt) void mark([m.id]);
                }}
              >
                <strong>{m.title}</strong>
              </Link>
              <p>{m.message}</p>
              <small>
                {taskDate(m.createdAt)} · {m.readAt ? "已读" : "未读"}
              </small>
            </div>
            {!m.readAt && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void mark([m.id])}
              >
                标为已读
              </button>
            )}
          </article>
        ))}
        {data && !data.messages.length && (
          <div className="task-empty">
            <Bell size={30} />
            <h2>{data.nextCursor ? "已加载的消息已清理" : "暂无消息"}</h2>
            <p>{data.nextCursor ? "可继续查看更早消息。" : "指派、成果提交和验收变化会显示在这里。"}</p>
          </div>
        )}
      </section>
      {!!data?.nextCursor && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          查看更早消息
        </button>
      )}
      {pendingDelete && <ConfirmationDialog title="删除已读消息"
        description={`确认删除这${pendingDelete.length}条已读消息？仅删除消息，不影响任务和成果；删除后无法恢复。`}
        confirmLabel="确认删除" busy={busy} error={error}
        onConfirm={() => void remove()} onClose={() => { setPendingDelete(null); setError(""); }} />}
    </>
  );
}
