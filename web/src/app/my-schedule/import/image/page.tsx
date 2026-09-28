import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getCurrentMember } from "@/lib/server-auth";
import { ImageImportView } from "./image-import-view";

export const dynamic = "force-dynamic";

export default async function ImageImportPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=%2Fmy-schedule%2Fimport%2Fimage");
  return <AppShell currentUser={{ name: member.name, studentNo: member.studentNo }}>
    <PageHeader eyebrow="v1 · 图片识别" title="从课表图片生成草稿" description="上传截图后先识别文字，再逐项校对课程。图片和识别原文不会保存，只有最后确认才会替换你的课表。" />
    <ImageImportView />
  </AppShell>;
}
