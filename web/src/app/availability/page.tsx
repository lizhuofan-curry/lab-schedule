import { redirect } from "next/navigation";
import { AvailabilityView } from "@/app/availability/availability-view";
import { getCurrentScheduleConfig, getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";

export default async function AvailabilityPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Favailability");
  const [config, directory] = await Promise.all([getCurrentScheduleConfig(), getMemberDirectory()]);
  if (!config) return <main className="auth-page"><p>尚未配置当前学期，请联系项目维护者。</p></main>;
  const guest = viewer.kind === "guest";
  const members = directory.filter((member) => member.registered).map((member) => guest ? { ...member, studentNo: maskStudentNo(member.studentNo) } : member);
  return <AvailabilityView members={members} semester={config.semester} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: viewer.member!.name, studentNo: viewer.member!.studentNo }} guest={guest} />;
}
