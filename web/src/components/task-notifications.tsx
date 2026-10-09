"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { taskDate } from "@/lib/task-rules";
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
async function request<T>(body?: unknown, before?: number): Promise<T> {
  const response = await fetch(
    before ? `/api/notifications?before=${before}` : "/api/notifications",
    body
      ? {
          method: "POST",
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
  async function loadMore() {
    if (!data?.nextCursor) return;
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
      setBusy(false);
    }
  }
  async function refresh() {
    try {
      setData(await request<Inbox>());
      setError("");
    } catch (e) {
      setError((e as Error).message);
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
    if (!ids.length) return;
    setBusy(true);
    try {
      for (let offset = 0; offset < ids.length; offset += 200) {
        await request({ ids: ids.slice(offset, offset + 200) });
      }
      await refresh();
      window.dispatchEvent(new Event("task-notifications-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
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
      {error && (
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
            <div>
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
            <h2>暂无消息</h2>
            <p>指派、成果提交和验收变化会显示在这里。</p>
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
    </>
  );
}
