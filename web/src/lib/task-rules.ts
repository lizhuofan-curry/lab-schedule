export const taskStatusLabels = {
  active: "进行中",
  completed: "已完成",
  cancelled: "已撤销",
};
export const submissionStatusLabels = {
  pending: "待验收",
  approved: "已通过",
  returned: "被打回",
};
export const taskSubject = (
  delivery: string,
  studentId: number,
  generation: number,
) => (delivery === "shared" ? "shared" : `member:${studentId}:${generation}`);
export function taskIsComplete(
  kind: string,
  claimsOpen: boolean,
  delivery: string,
  subjects: string[],
  approved: Set<string>,
) {
  return (
    subjects.length > 0 &&
    (kind !== "announcement" || !claimsOpen) &&
    (delivery === "shared"
      ? approved.has("shared")
      : subjects.every((s) => approved.has(s)))
  );
}
export function taskDate(value: string | Date | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "无截止时间";
}
export function beijingInput(value: string | Date | null) {
  return value
    ? new Date(new Date(value).getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, 16)
    : "";
}
export const beijingDeadline = (value: string) =>
  value ? new Date(`${value}:00+08:00`).toISOString() : null;
