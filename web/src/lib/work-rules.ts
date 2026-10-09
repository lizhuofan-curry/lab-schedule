export type WorkStatus = "active" | "completed" | "paused";
export const workStatusLabels = {
  active: "进行中",
  completed: "已完成",
  paused: "暂停",
};
export const RECENT_WORK_MS = 7 * 24 * 60 * 60 * 1000;
export function isRecentCompletion(completedAt: Date | null, now: Date) {
  return (
    completedAt !== null &&
    completedAt.getTime() >= now.getTime() - RECENT_WORK_MS &&
    completedAt.getTime() <= now.getTime()
  );
}
export function workCompletionTime(
  previous: { status: WorkStatus; completedAt: Date | null } | null,
  status: WorkStatus,
  now: Date,
) {
  if (status !== "completed") return null;
  return previous?.status === "completed" ? previous.completedAt : now;
}
export type WorkRecord = {
  id: number;
  studentId: number;
  title: string;
  description: string;
  status: WorkStatus;
  revision: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MemberTask = {
  id: number;
  title: string;
  publisher: string;
  status: "active" | "completed";
  deadline: string | null;
  completedAt: string | null;
  round: number;
  delivery: "shared" | "individual";
  ownStatus: "not_submitted" | "pending" | "returned" | "approved";
};
