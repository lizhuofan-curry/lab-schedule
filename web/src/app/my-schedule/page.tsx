import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getPersonalSchedule } from "@/lib/schedule-service";
import { getCurrentMember } from "@/lib/server-auth";
import { MyScheduleEditor } from "./my-schedule-editor";

export const dynamic = "force-dynamic";

export default async function MySchedulePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=/my-schedule");
  const schedule = await getPersonalSchedule(member.studentId);

  return (
    <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
      {!schedule ? (
        <>
          <PageHeader eyebrow="个人课表" title="我的课表" description="当前还没有可用学期。" />
          <EmptyState title="学期尚未初始化" text="请稍后刷新；服务器需要先写入本学期与上课时间。" />
        </>
      ) : (
        <MyScheduleEditor semester={schedule.semester} periods={schedule.periods} initialCourses={schedule.courses} />
      )}
    </AppShell>
  );
}
