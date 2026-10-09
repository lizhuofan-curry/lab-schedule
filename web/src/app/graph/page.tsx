import { notFound, redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getCurrentViewer } from "@/lib/server-auth";
import { graphEnabled } from "@/lib/graph-service";
import { GraphView } from "./graph-view";

export const dynamic = "force-dynamic";
export default async function GraphPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Fgraph");
  if (viewer.kind === "guest") redirect("/dashboard");
  if (!graphEnabled()) notFound();
  return <AppShell currentUser={viewer.member}>
    <PageHeader eyebrow="实验室协作" title="工作关系图" description="从成员、任务和工作记录之间的联系，了解彼此的经历与当前工作。" />
    <GraphView />
  </AppShell>;
}
