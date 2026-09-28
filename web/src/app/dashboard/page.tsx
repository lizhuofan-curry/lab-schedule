import { redirect } from "next/navigation";
import { DashboardView } from "@/app/dashboard/dashboard-view";
import { getDashboardData, getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Fdashboard");
  const currentMember = viewer.member;
  const requestedWeek = Number((await searchParams).week);
  const [data, allMembers] = await Promise.all([
    getDashboardData(currentMember?.studentId ?? null, Number.isInteger(requestedWeek) ? requestedWeek : undefined),
    getMemberDirectory(),
  ]);
  if (!data) return <main className="auth-page"><p>尚未配置当前学期，请联系项目维护者。</p></main>;
  const guest = viewer.kind === "guest";
  const visibleData = guest ? { ...data, members: data.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })) } : data;
  return <DashboardView {...visibleData} totalMembers={allMembers.length} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: currentMember!.name, studentNo: currentMember!.studentNo }} guest={guest} />;
}
