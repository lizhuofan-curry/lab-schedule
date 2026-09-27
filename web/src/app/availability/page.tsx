import { redirect } from "next/navigation";
import { AvailabilityView } from "@/app/availability/availability-view";
import { getCurrentScheduleConfig, getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentMember } from "@/lib/server-auth";

export default async function AvailabilityPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) redirect("/login?next=%2Favailability");
  const [config, directory] = await Promise.all([getCurrentScheduleConfig(), getMemberDirectory()]);
  if (!config) return <main className="auth-page"><p>尚未配置当前学期，请联系项目维护者。</p></main>;
  return <AvailabilityView members={directory.filter((member) => member.registered)} semester={config.semester} currentUser={{ name: currentMember.name, studentNo: currentMember.studentNo }} />;
}
