import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getGroupWeekSchedule, type GroupWeekSchedule } from "@/lib/group-schedule-service";
import { GroupServiceError } from "@/lib/group-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";
import { GroupScheduleView } from "./group-schedule-view";

export const dynamic = "force-dynamic";

export default async function GroupSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentViewer();
  const { id } = await params;
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/groups/${id}`)}`);
  const groupId = Number(id);
  if (!Number.isInteger(groupId) || groupId <= 0) notFound();
  const guest = viewer.kind === "guest";
  const currentUser = guest ? { name: "游客", studentNo: "只读访问" } : { name: viewer.member.name, studentNo: viewer.member.studentNo };
  let schedule: GroupWeekSchedule | null = null;

  try {
    schedule = await getGroupWeekSchedule(groupId, undefined, guest ? null : viewer.member.studentId);
  } catch (error) {
    if (error instanceof GroupServiceError && error.code === "GROUP_NOT_FOUND") notFound();
    if (!(error instanceof GroupServiceError && error.code === "SEMESTER_NOT_FOUND")) throw error;
  }

  if (!schedule) return <AppShell guest={guest} currentUser={currentUser}><PageHeader eyebrow="小组时间密度" title="小组课表" /><EmptyState title="学期尚未初始化" text="学期和节次配置完成后即可查看小组叠加课表。" /></AppShell>;

  const visibleSchedule = guest ? { ...schedule, group: {
    ...schedule.group,
    members: schedule.group.members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })),
    leader: { ...schedule.group.leader, studentNo: maskStudentNo(schedule.group.leader.studentNo) },
    canManage: false,
  } } : schedule;
  return <AppShell guest={guest} currentUser={currentUser}>
    <PageHeader eyebrow="小组时间密度" title={`${schedule.group.name}的课表`} description="颜色越深，表示这一节同时有课的成员越多。点击任意格子即可查看具体成员、课程、教师和地点。" actions={<Link className="button secondary" href="/groups"><ArrowLeft size={17} /> 返回小组</Link>} />
    <GroupScheduleView initialData={visibleSchedule} />
  </AppShell>;
}
