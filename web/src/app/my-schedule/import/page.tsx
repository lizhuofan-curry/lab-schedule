import { redirect } from "next/navigation";
import Link from "next/link";
import { Camera } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getCurrentMember } from "@/lib/server-auth";
import { ScheduleImportView } from "./schedule-import-view";

export const dynamic = "force-dynamic";

export default async function ScheduleImportPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fmy-schedule%2Fimport");
  return <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
    <PageHeader eyebrow="MVP-B · 标准模板" title="批量导入我的课表" description="先生成预览；只有你明确确认，系统才会替换当前课表并保存历史版本。" actions={<Link className="button secondary" href="/my-schedule/import/image"><Camera size={17} /> 图片识别导入</Link>} />
    <ScheduleImportView />
  </AppShell>;
}
