export type MemberGrade = "sophomore" | "junior" | "unknown";

export const memberGradeLabels: Record<MemberGrade, string> = {
  sophomore: "大二",
  junior: "大三",
  unknown: "年级待确认",
};

export function resolveMemberGrade(studentNo: string | null | undefined): MemberGrade {
  const normalized = studentNo?.trim() ?? "";
  if (normalized.startsWith("25")) return "sophomore";
  if (normalized.startsWith("24")) return "junior";
  return "unknown";
}
