import { redirect } from "next/navigation";
import { DashboardView } from "@/app/dashboard/dashboard-view";
import { getDashboardData, getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentMember } from "@/lib/server-auth";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const currentMember = await getCurrentMember();
  if (!currentMember) redirect("/login?next=%2Fdashboard");
  const requestedWeek = Number((await searchParams).week);
  const [data, allMembers] = await Promise.all([
    getDashboardData(currentMember.studentId, Number.isInteger(requestedWeek) ? requestedWeek : undefined),
    getMemberDirectory(),
  ]);
  if (!data) return <main className="auth-page"><p>尚未配置当前学期，请联系项目维护者。</p></main>;
  return <DashboardView {...data} totalMembers={allMembers.length} currentUser={{ name: currentMember.name, studentNo: currentMember.studentNo }} />;
}
