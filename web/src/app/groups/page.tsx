import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getGroupDirectory } from "@/lib/group-service";
import { getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";
import { GroupsView } from "./groups-view";

export default async function GroupsPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Fgroups");
  const guest = viewer.kind === "guest";
  const currentStudentId = guest ? null : viewer.member.studentId;
  const [groups, directory] = await Promise.all([
    getGroupDirectory(currentStudentId),
    getMemberDirectory(),
  ]);
  const visibleGroups = guest ? groups.map((group) => ({
    ...group,
    members: group.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })),
    leader: { ...group.leader, studentNo: maskStudentNo(group.leader.studentNo) },
    canManage: false,
  })) : groups;
  const members = directory.filter((member) => member.registered).map((member) => guest ? { ...member, studentNo: maskStudentNo(member.studentNo) } : member);

  return <AppShell guest={guest} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: viewer.member.name, studentNo: viewer.member.studentNo }}>
    <PageHeader eyebrow={guest ? "游客只读访问" : "实验室协作"} title="项目小组" description="查看小组、组长和成员；组长可以维护名称与成员，并把整个小组带入共同空闲查询。" />
    <GroupsView initialGroups={visibleGroups} members={members} guest={guest} currentStudentId={currentStudentId} />
  </AppShell>;
}

