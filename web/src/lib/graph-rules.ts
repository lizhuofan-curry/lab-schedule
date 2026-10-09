import type { GraphScope, GraphTheme } from "./graph-schema.ts";
import { forceGraphLayout } from "./graph-layout.ts";

export type GraphSnapshot = {
  members: { id: number; name: string }[];
  groups: { id: number; name: string }[];
  memberships: { groupId: number; studentId: number }[];
  work: { id: number; studentId: number; title: string; description: string; status: string; revision: number; updatedAt: string; completedAt: string | null }[];
  tasks: { id: number; publisherId: number; kind: string; status: string; currentRound: number; revision: number }[];
  rounds: { id: number; taskId: number; number: number; title: string; description: string; directIds: number[]; groupIds: number[]; deadline: string | null; endedAt: string | null; outcome: string | null }[];
  participants: { roundId: number; studentId: number; active: boolean; generation: number }[];
};
export type GraphNode = { id: string; kind: "member" | "group" | "work" | "task" | "theme"; label: string; status: string; currentLoad: boolean; sourceKey?: string };
export type GraphEdge = { id: string; from: string; to: string; kind: "fact" | "inferred"; label: string };
export type GraphSource = { key: string; title: string; description: string; status: string; owner: string; round?: number; currentLoad: boolean; deadline?: string | null };
export type GraphData = {
  nodes: GraphNode[]; edges: GraphEdge[]; version: string; asOf: string; scope: GraphScope;
  options: { members: GraphSnapshot["members"]; groups: GraphSnapshot["groups"] };
  analysis: { status: "disabled" | "pending" | "ready" | "failed"; analyzedAt: string | null; model: string; message: string };
};

export function scopedMembers(snapshot: GraphSnapshot, scope: GraphScope) {
  const valid = new Set(snapshot.members.map((m) => m.id));
  if (scope.scope === "member") return valid.has(scope.id) ? new Set([scope.id]) : new Set<number>();
  if (scope.scope === "group") return new Set(snapshot.memberships.filter((m) => m.groupId === scope.id && valid.has(m.studentId)).map((m) => m.studentId));
  return valid;
}

export function roundMembers(snapshot: GraphSnapshot, round: GraphSnapshot["rounds"][number]) {
  const task = snapshot.tasks.find((t) => t.id === round.taskId)!;
  const valid = new Set(snapshot.members.map((m) => m.id));
  if (task.status === "active" && task.currentRound === round.number && task.kind === "assigned") {
    return new Set([...round.directIds, ...snapshot.memberships.filter((m) => round.groupIds.includes(m.groupId)).map((m) => m.studentId)].filter((id) => valid.has(id)));
  }
  return new Set(snapshot.participants.filter((p) => p.roundId === round.id && p.active && valid.has(p.studentId)).map((p) => p.studentId));
}

export function graphSources(snapshot: GraphSnapshot, scope: GraphScope): GraphSource[] {
  const ids = scopedMembers(snapshot, scope);
  const names = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const sources: GraphSource[] = snapshot.work.filter((w) => ids.has(w.studentId)).map((w) => ({
    key: `work:${w.id}`, title: w.title, description: w.description, status: w.status,
    owner: names.get(w.studentId)!, currentLoad: w.status === "active",
  }));
  for (const round of snapshot.rounds) {
    const task = snapshot.tasks.find((t) => t.id === round.taskId);
    if (!task) continue;
    const related = [...roundMembers(snapshot, round), ...snapshot.participants.filter((p) => p.roundId === round.id).map((p) => p.studentId), task.publisherId];
    if (!related.some((id) => ids.has(id))) continue;
    const current = round.number === task.currentRound;
    sources.push({ key: `round:${round.id}`, title: round.title, description: round.description,
      status: current ? task.status : round.outcome ?? "superseded", owner: names.get(task.publisherId) ?? "历史发布者",
      round: round.number, currentLoad: current && task.status === "active", deadline: round.deadline });
  }
  return sources;
}

export function buildGraph(snapshot: GraphSnapshot, scope: GraphScope) {
  const ids = scopedMembers(snapshot, scope);
  const sources = graphSources(snapshot, scope);
  const sourceIds = new Set(sources.map((s) => s.key));
  const nodes: GraphNode[] = snapshot.members.filter((m) => ids.has(m.id)).map((m) => ({ id: `member:${m.id}`, kind: "member", label: m.name, status: "", currentLoad: false }));
  const edges: GraphEdge[] = [];
  const link = (from: string, to: string, label: string) => edges.push({ id: `${from}/${to}/${label}`, from, to, kind: "fact", label });
  const visibleGroups = new Set(snapshot.memberships.filter((m) => ids.has(m.studentId) && (scope.scope !== "group" || m.groupId === scope.id)).map((m) => m.groupId));
  if (scope.scope === "group") visibleGroups.add(scope.id);
  for (const g of snapshot.groups.filter((g) => visibleGroups.has(g.id))) {
    nodes.push({ id: `group:${g.id}`, kind: "group", label: g.name, status: "当前成员汇总", currentLoad: false });
    for (const m of snapshot.memberships.filter((m) => m.groupId === g.id && ids.has(m.studentId))) link(`group:${g.id}`, `member:${m.studentId}`, "当前组员");
  }
  for (const source of sources) nodes.push({ id: source.key, kind: source.key.startsWith("work:") ? "work" : "task", label: source.round ? `${source.title} · 第${source.round}轮` : source.title, status: source.status, currentLoad: source.currentLoad, sourceKey: source.key });
  for (const w of snapshot.work.filter((w) => sourceIds.has(`work:${w.id}`))) link(`member:${w.studentId}`, `work:${w.id}`, "本人记录");
  for (const r of snapshot.rounds.filter((r) => sourceIds.has(`round:${r.id}`))) {
    const task = snapshot.tasks.find((t) => t.id === r.taskId)!;
    if (ids.has(task.publisherId)) link(`member:${task.publisherId}`, `round:${r.id}`, "发布");
    const current = task.status === "active" && task.currentRound === r.number;
    const members = roundMembers(snapshot, r);
    for (const id of members) if (ids.has(id)) link(`member:${id}`, `round:${r.id}`, current ? "当前承担" : "历史参与");
    for (const p of snapshot.participants.filter((p) => p.roundId === r.id && !members.has(p.studentId) && ids.has(p.studentId))) link(`member:${p.studentId}`, `round:${r.id}`, "曾参与，已退出");
  }
  return { nodes, edges };
}

// Only validated, currently present evidence can support a model theme.
export function withGraphThemes(graph: ReturnType<typeof buildGraph>, themes: GraphTheme[]) {
  const valid = new Set(graph.nodes.filter((n) => n.sourceKey).map((n) => n.id));
  const nodes = [...graph.nodes], edges = [...graph.edges];
  themes.forEach((theme, index) => {
    const sourceIds = [...new Set(theme.sourceIds)].filter((id) => valid.has(id));
    if (!sourceIds.length) return;
    const id = `theme:${index}`;
    nodes.push({ id, kind: "theme", label: theme.label, status: "模型提炼", currentLoad: false });
    for (const source of sourceIds) edges.push({ id: `${id}/${source}`, from: id, to: source, kind: "inferred", label: "模型推断，查看依据" });
  });
  return { nodes, edges };
}

export const graphLayout = forceGraphLayout;
