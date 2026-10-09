import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/server-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { NotificationInbox } from "@/components/task-notifications";
export default async function NotificationsPage() {
  const person = await getCurrentMember();
  if (!person) redirect("/login");
  return (
    <AppShell currentUser={person}>
      <PageHeader
        eyebrow="实验室协作"
        title="站内消息"
        description="查看与你有关的任务指派、成果与验收变化。"
      />
      <NotificationInbox />
    </AppShell>
  );
}
