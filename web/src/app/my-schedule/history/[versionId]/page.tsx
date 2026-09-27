import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getScheduleVersion } from "@/lib/schedule-import-service";
import { getCurrentMember } from "@/lib/server-auth";
import { describeWeeks, weekdays } from "@/lib/schedule-types";

export const dynamic = "force-dynamic";

export default async function ScheduleVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fmy-schedule%2Fhistory");
  const versionId = Number((await params).versionId);
  if (!Number.isInteger(versionId) || versionId < 1) notFound();
  const data = await getScheduleVersion(member.studentId, versionId);
  if (!data) notFound();
  return <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
    <PageHeader eyebrow="只读快照" title={`课表版本 ${data.version.versionNo}`} description={`${data.version.fileName ?? data.version.source.toUpperCase()} · 共 ${data.version.courseCount} 门课程。此页面不会修改当前课表。`} actions={<Link className="button secondary" href="/my-schedule/history"><ArrowLeft size={17} /> 返回历史</Link>} />
    <section className="panel history-panel"><div className="snapshot-table"><div className="snapshot-row header"><span>课程</span><span>时间</span><span>周次</span><span>地点</span></div>{data.snapshots.map((course) => <div className="snapshot-row" key={course.id}><span><strong>{course.name}</strong><small>{course.teacher || "教师未填写"}</small></span><span>{weekdays[course.weekday - 1]} 第 {course.startPeriod}{course.startPeriod === course.endPeriod ? "" : `–${course.endPeriod}`} 节</span><span>{describeWeeks(course.weeks.map(Number))}</span><span>{course.location || "地点未填写"}</span></div>)}</div></section>
  </AppShell>;
}
