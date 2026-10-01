import { redirect } from "next/navigation";
import { AvailabilityView } from "@/app/availability/availability-view";
import { getCurrentScheduleConfig, getMemberDirectory } from "@/lib/schedule-service";
import { getGroupDirectory } from "@/lib/group-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Favailability");
  const [config, directory, groups, params] = await Promise.all([getCurrentScheduleConfig(), getMemberDirectory(), getGroupDirectory(viewer.kind === "member" ? viewer.member.studentId : null), searchParams]);
  if (!config) return <main className="auth-page"><p>尚未配置当前学期，请联系项目维护者。</p></main>;
  const guest = viewer.kind === "guest";
  const members = directory.filter((member) => member.registered).map((member) => guest ? { ...member, studentNo: maskStudentNo(member.studentNo) } : member);
  const requestedGroupId = Number(params.group);
  return <AvailabilityView members={members} savedGroups={groups.map((group) => ({ id: group.id, name: group.name, studentIds: group.members.map((member) => member.studentId) }))} initialGroupId={Number.isInteger(requestedGroupId) && requestedGroupId > 0 ? requestedGroupId : null} semester={config.semester} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: viewer.member!.name, studentNo: viewer.member!.studentNo }} guest={guest} />;
}
