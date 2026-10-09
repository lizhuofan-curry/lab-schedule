import { graphSources, type GraphSnapshot, type GraphEdge, type GraphNode } from "./graph-rules.ts";
import { graphRelationsSchema, type GraphRelation } from "./graph-schema.ts";

export const relationLabels = { similar: "内容相近", method: "共同方法", upstream: "上游 → 下游" };
export const supportsIncomingUpstream = (text: string) => /需要|依赖|读取|输入来自|作为.{0,12}(?:输入|数据)|由.{0,15}提供/.test(text);
export function analysisSources(snapshot: GraphSnapshot) {
  const work = new Set(snapshot.work.filter(w => w.status === "active" || w.status === "paused").map(w => `work:${w.id}`));
  const rounds = new Set(snapshot.rounds.filter(r => snapshot.tasks.some(t => t.id === r.taskId && t.status === "active" && t.currentRound === r.number)).map(r => `round:${r.id}`));
  return graphSources(snapshot, { scope: "all" }).filter(s => work.has(s.key) || rounds.has(s.key));
}
export function relationId(r: GraphRelation) { return `ai/${r.from}/${r.to}/${r.type}`; }
export function validateRelations(raw: unknown, snapshot: GraphSnapshot, redact: (text: string) => string = text => text) {
  const parsed = graphRelationsSchema.parse({ relations: raw }).relations;
  const sources = new Map(analysisSources(snapshot).map(s => [s.key, `${redact(s.title)}\n${redact(s.description)}`]));
  const unique = new Map<string, GraphRelation>();
  for (const r of parsed) {
    if (!sources.get(r.from)?.includes(r.fromEvidence) || !sources.get(r.to)?.includes(r.toEvidence) || [r.reason, r.fromEvidence, r.toEvidence].some(text => redact(text) !== text)) throw new Error("Invalid relation evidence");
    if (r.type === "upstream" && !supportsIncomingUpstream(sources.get(r.to)!)) throw new Error("Unsupported upstream dependency");
    const relation = r.type !== "upstream" && r.from.localeCompare(r.to) > 0 ? { ...r, from: r.to, to: r.from, fromEvidence: r.toEvidence, toEvidence: r.fromEvidence } : r;
    unique.set(relationId(relation), relation);
  }
  return [...unique.values()];
}
export function withRelations(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, relations: GraphRelation[], analyzedAt: string | null) {
  const visible = new Set(graph.nodes.map(n => n.id));
  return { nodes: graph.nodes, edges: [...graph.edges, ...relations.filter(r => visible.has(r.from) && visible.has(r.to)).map(r => ({
    id: relationId(r), from: r.from, to: r.to, kind: "inferred" as const, label: relationLabels[r.type],
    detail: { reason: r.reason, fromEvidence: r.fromEvidence, toEvidence: r.toEvidence, ...(analyzedAt ? { analyzedAt } : {}) },
  }))] };
}
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
export function withCourseRelations(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, snapshot: GraphSnapshot) {
  const ids = new Set(graph.nodes.map(n => n.id));
  const buckets = new Map<string, NonNullable<GraphSnapshot["courses"]>>();
  for (const c of snapshot.courses ?? []) {
    if (!ids.has(`member:${c.studentId}`) || !c.location?.trim() || !normalize(c.name)) continue;
    const key = JSON.stringify([c.semesterId, normalize(c.name), c.weekday, c.startPeriod, c.endPeriod, normalize(c.location)]);
    const list = buckets.get(key) ?? []; list.push(c); buckets.set(key, list);
  }
  const matched = new Map<string, GraphEdge>();
  for (const courses of buckets.values()) for (let i = 0; i < courses.length; i++) for (let j = i + 1; j < courses.length; j++) {
    const a = courses[i], b = courses[j]; if (a.studentId === b.studentId) continue;
    const weeks = [...new Set(a.weeks.filter(w => b.weeks.includes(w)))].sort((a, b) => a - b); if (!weeks.length) continue;
    const [from, to] = [a.studentId, b.studentId].sort((a, b) => a - b).map(id => `member:${id}`), id = `course/${from}/${to}`;
    const edge = matched.get(id) ?? { id, from, to, kind: "fact", label: "课表安排一致", detail: { reason: "课表安排一致，不代表实际共同到课。", courses: [] } };
    const evidence = { name: normalize(a.name), location: normalize(a.location!), weekday: a.weekday, startPeriod: a.startPeriod, endPeriod: a.endPeriod, weeks };
    const previous = edge.detail!.courses!.find(c => c.name === evidence.name && c.location === evidence.location && c.weekday === evidence.weekday && c.startPeriod === evidence.startPeriod && c.endPeriod === evidence.endPeriod);
    if (previous) previous.weeks = [...new Set([...previous.weeks, ...weeks])].sort((a, b) => a - b);
    else edge.detail!.courses!.push(evidence);
    matched.set(id, edge);
  }
  return { nodes: graph.nodes, edges: [...graph.edges, ...matched.values()] };
}

export function modelContext(snapshot: GraphSnapshot, redact: (text: string) => string) {
  const code = new Map(snapshot.members.map((m, i) => [m.id, `M${String(i + 1).padStart(2, "0")}`]));
  const sources = analysisSources(snapshot);
  return {
    sources: sources.map(s => ({ id: s.key, title: redact(s.title), text: redact(s.description), status: s.status, allowIncomingUpstream: supportsIncomingUpstream(`${s.title}\n${s.description}`) })),
    members: [...code.values()],
    groups: snapshot.groups.map((g, i) => ({ id: `G${i + 1}`, members: snapshot.memberships.filter(m => m.groupId === g.id).map(m => code.get(m.studentId)).filter(Boolean) })),
    ownership: snapshot.work.filter(w => sources.some(s => s.key === `work:${w.id}`)).map(w => ({ source: `work:${w.id}`, owner: code.get(w.studentId) })),
    taskRoles: snapshot.rounds.filter(r => sources.some(s => s.key === `round:${r.id}`)).map(r => {
      const task = snapshot.tasks.find(t => t.id === r.taskId)!;
      const members = task.kind === "assigned" ? [...r.directIds, ...snapshot.memberships.filter(m => r.groupIds.includes(m.groupId)).map(m => m.studentId)] : snapshot.participants.filter(p => p.roundId === r.id && p.active).map(p => p.studentId);
      return { source: `round:${r.id}`, publisher: code.get(task.publisherId), participants: [...new Set(members.map(id => code.get(id)).filter(Boolean))] };
    }),
    courses: (snapshot.courses ?? []).map(c => ({ member: code.get(c.studentId), name: redact(c.name), location: c.location ? redact(c.location) : null, weekday: c.weekday, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: c.weeks })),
  };
}
