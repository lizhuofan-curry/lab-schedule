import { differenceInCalendarDays, parseISO, startOfDay } from "date-fns";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getCurrentScheduleConfig, getMemberDirectory, getMemberWeekSchedule } from "@/lib/schedule-service";
import { getCurrentMember } from "@/lib/server-auth";
import { MembersView } from "./members-view";

export const dynamic = "force-dynamic";

function currentWeek(startDate: string, weekCount: number) {
  const elapsedDays = differenceInCalendarDays(startOfDay(new Date()), parseISO(startDate));
  return Math.min(weekCount, Math.max(1, Math.floor(elapsedDays / 7) + 1));
}

export default async function MembersPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) redirect("/login?next=/members");

  const [config, members] = await Promise.all([getCurrentScheduleConfig(), getMemberDirectory()]);
  if (!config) {
    return <AppShell currentUser={{ name: currentMember.name, studentNo: currentMember.studentNo }}><PageHeader eyebrow="实验室成员" title="成员课表" /><EmptyState title="学期尚未初始化" text="学期配置完成后即可查看成员课表。" /></AppShell>;
  }

  const week = currentWeek(config.semester.startDate, config.semester.weekCount);
  const selectedId = members.some((member) => member.id === currentMember.studentId) ? currentMember.studentId : members[0]?.id;
  const initialSchedule = selectedId ? await getMemberWeekSchedule(selectedId, config.semester.id, week) : null;

  return (
    <AppShell currentUser={{ name: currentMember.name, studentNo: currentMember.studentNo }}>
      <MembersView
        currentStudentId={currentMember.studentId}
        members={members}
        semester={config.semester}
        periods={config.periods}
        initialWeek={week}
        initialStudentId={selectedId ?? null}
        initialCourses={initialSchedule?.courses ?? []}
      />
    </AppShell>
  );
}
