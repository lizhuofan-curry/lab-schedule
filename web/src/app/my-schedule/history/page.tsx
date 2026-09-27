import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getScheduleImportHistory } from "@/lib/schedule-import-service";
import { getCurrentMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ScheduleHistoryPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fmy-schedule%2Fhistory");
  const versions = await getScheduleImportHistory(member.studentId);
  return <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
    <PageHeader eyebrow="只读记录" title="课表导入历史" description="每次确认批量导入都会保存完整快照。历史版本只能查看，不会自动覆盖当前课表。" actions={<Link className="button secondary" href="/my-schedule"><ArrowLeft size={17} /> 返回我的课表</Link>} />
    <section className="panel history-panel">{versions.length ? <div className="history-list">{versions.map((version) => <Link key={version.id} href={`/my-schedule/history/${version.id}`} className="history-item"><span className="history-icon"><FileSpreadsheet size={21} /></span><span><strong>版本 {version.versionNo}</strong><small>{version.fileName ?? `${version.source.toUpperCase()} 导入`} · {format(version.createdAt, "yyyy-MM-dd HH:mm")}</small></span><span>{version.courseCount} 门课程</span></Link>)}</div> : <div className="empty-result"><FileSpreadsheet size={28} /><strong>还没有导入历史</strong><p>手动添加和修改课程不会创建版本；确认批量导入后才会出现记录。</p></div>}</section>
  </AppShell>;
}
