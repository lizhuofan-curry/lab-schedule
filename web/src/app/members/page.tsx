import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getCurrentScheduleConfig, getMemberDirectory, getMemberWeekSchedule } from "@/lib/schedule-service";
import { getCurrentViewer, maskStudentNo } from "@/lib/server-auth";
import { getDefaultScheduleWeek } from "@/lib/current-course-status";
import { MembersView } from "./members-view";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=/members");
  const currentMember = viewer.member;
  const guest = viewer.kind === "guest";

  const [config, members] = await Promise.all([getCurrentScheduleConfig(), getMemberDirectory()]);
  if (!config) {
    return <AppShell guest={guest} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: currentMember!.name, studentNo: currentMember!.studentNo }}><PageHeader eyebrow="实验室成员" title="成员课表" /><EmptyState title="学期尚未初始化" text="学期配置完成后即可查看成员课表。" /></AppShell>;
  }

  const week = getDefaultScheduleWeek(new Date(), config.semester);
  const visibleMembers = guest ? members.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })) : members;
  const selectedId = currentMember && members.some((member) => member.id === currentMember.studentId) ? currentMember.studentId : members[0]?.id;
  const initialSchedule = selectedId ? await getMemberWeekSchedule(selectedId, config.semester.id, week) : null;

  return (
    <AppShell guest={guest} currentUser={guest ? { name: "游客", studentNo: "只读访问" } : { name: currentMember!.name, studentNo: currentMember!.studentNo }}>
      <MembersView
        currentStudentId={currentMember?.studentId ?? null}
        members={visibleMembers}
        guest={guest}
        semester={config.semester}
        periods={config.periods}
        initialWeek={week}
        initialStudentId={selectedId ?? null}
        initialCourses={initialSchedule?.courses ?? []}
      />
    </AppShell>
  );
}
