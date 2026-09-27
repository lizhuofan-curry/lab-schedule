import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getCurrentMember } from "@/lib/server-auth";
import { ScheduleImportView } from "./schedule-import-view";

export const dynamic = "force-dynamic";

export default async function ScheduleImportPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fmy-schedule%2Fimport");
  return <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
    <PageHeader eyebrow="MVP-B · 标准模板" title="批量导入我的课表" description="先下载模板并填写，上传后只做预览；只有你明确确认，系统才会替换当前课表并保存历史版本。" />
    <ScheduleImportView />
  </AppShell>;
}
