import { notFound, redirect } from "next/navigation";
import { getCurrentViewer } from "@/lib/server-auth";
import { graphEnabled } from "@/lib/graph-service";
import { GraphView } from "./graph-view";

export const dynamic = "force-dynamic";
export default async function GraphPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Fgraph");
  if (viewer.kind === "guest") redirect("/dashboard");
  if (!graphEnabled()) notFound();
  return <main><GraphView /></main>;
}
