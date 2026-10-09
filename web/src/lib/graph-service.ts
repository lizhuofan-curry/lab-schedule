import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { students, groups, groupMembers, memberWorkRecords, collabTasks, taskRounds, taskParticipants, semesters, courses, graphRelationFeedback } from "@/db/schema";
import type { CurrentMember } from "./server-auth";
import { TaskError } from "./task-service";
import { buildGraph, graphSources, type GraphData, type GraphSnapshot } from "./graph-rules";
import { withCourseRelations, withRelations } from "./graph-relations";
import { graphSourceKeySchema, graphFeedbackSchema, type GraphScope } from "./graph-schema";

export function graphEnabled() { return process.env.V3_GRAPH_ENABLED === "1"; }
export function requireGraphEnabled() {
  if (!graphEnabled()) throw new TaskError("GRAPH_DISABLED", "关系图尚未开放，请返回成员或任务页面。", 404);
}
export async function graphSnapshot(actor: CurrentMember): Promise<GraphSnapshot> {
  return loadGraphSnapshot(actor);
}
// Background entrypoint has no HTTP exposure and never receives a client actor.
export async function backgroundGraphSnapshot(): Promise<GraphSnapshot> {
  return loadGraphSnapshot();
}
async function loadGraphSnapshot(actor?: CurrentMember): Promise<GraphSnapshot> {
  requireGraphEnabled();
  return db.transaction(async (tx) => {
    const members = await tx.select({ id: students.id, name: students.name, userId: students.userId }).from(students)
      .where(and(eq(students.enabled, true), isNotNull(students.userId))).orderBy(asc(students.id));
    if (actor && !members.some((m) => m.id === actor.studentId && m.userId === actor.userId)) throw new TaskError("UNAUTHORIZED", "账号不可用，请重新登录。", 401);
    const groupRows = await tx.select({ id: groups.id, name: groups.name }).from(groups).orderBy(asc(groups.id));
    const memberships = await tx.select({ groupId: groupMembers.groupId, studentId: groupMembers.studentId }).from(groupMembers).orderBy(asc(groupMembers.groupId), asc(groupMembers.studentId));
    const workRows = await tx.select().from(memberWorkRecords).orderBy(asc(memberWorkRecords.id));
    const taskRows = await tx.select({ id: collabTasks.id, publisherId: collabTasks.publisherId, kind: collabTasks.kind, status: collabTasks.status, currentRound: collabTasks.currentRound, revision: collabTasks.revision }).from(collabTasks).orderBy(asc(collabTasks.id));
    const roundRows = await tx.select({ id: taskRounds.id, taskId: taskRounds.taskId, number: taskRounds.number, title: taskRounds.title, description: taskRounds.description, directIds: taskRounds.directIds, groupIds: taskRounds.groupIds, deadline: taskRounds.deadline, endedAt: taskRounds.endedAt, outcome: taskRounds.outcome }).from(taskRounds).orderBy(asc(taskRounds.id));
    const participants = await tx.select({ roundId: taskParticipants.roundId, studentId: taskParticipants.studentId, active: taskParticipants.active, generation: taskParticipants.generation }).from(taskParticipants).orderBy(asc(taskParticipants.roundId), asc(taskParticipants.studentId));
    const valid = new Set(members.map((m) => m.id));
    const currentCourses = await tx.select({ id: courses.id, studentId: courses.studentId, semesterId: courses.semesterId, name: courses.name, location: courses.location, weekday: courses.weekday, startPeriod: courses.startPeriod, endPeriod: courses.endPeriod, weeks: courses.weeks }).from(courses).innerJoin(semesters, and(eq(courses.semesterId, semesters.id), eq(semesters.isCurrent, true))).orderBy(asc(courses.id));
    return {
      members: members.map(({ id, name }) => ({ id, name })), groups: groupRows,
      memberships: memberships.filter((m) => valid.has(m.studentId)),
      work: workRows.filter((w) => valid.has(w.studentId)).map((w) => ({ id: w.id, studentId: w.studentId, title: w.title, description: w.description, status: w.status, revision: w.revision, updatedAt: w.updatedAt.toISOString(), completedAt: w.completedAt?.toISOString() ?? null })),
      tasks: taskRows, rounds: roundRows.map((r) => ({ ...r, deadline: r.deadline?.toISOString() ?? null, endedAt: r.endedAt?.toISOString() ?? null })), participants,
      courses: currentCourses.filter(c => valid.has(c.studentId)),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function graphVersion(snapshot: GraphSnapshot) {
  return createHash("sha256").update("v3.1-relations/1\n").update(JSON.stringify(snapshot)).digest("hex");
}
export async function getGraph(scope: GraphScope, actor: CurrentMember): Promise<GraphData> {
  const snapshot = await graphSnapshot(actor);
  if (scope.scope === "member" && !snapshot.members.some((m) => m.id === scope.id) || scope.scope === "group" && !snapshot.groups.some((g) => g.id === scope.id))
    throw new TaskError("GRAPH_SCOPE_NOT_FOUND", "所选成员或小组不可用，请重新选择。", 404);
  const version = graphVersion(snapshot);
  const { readGraphAnalysis } = await import("./graph-analysis-service");
  const analysis = await readGraphAnalysis(version, snapshot);
  return { ...withRelations(withCourseRelations(buildGraph(snapshot, scope), snapshot), analysis.relations, analysis.info.analyzedAt), version, scope, asOf: new Date().toISOString(),
    options: { members: snapshot.members, groups: snapshot.groups },
    analysis: analysis.info };
}

export async function submitGraphFeedback(input: unknown, actor: CurrentMember) {
  const parsed = graphFeedbackSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("INVALID_FEEDBACK", "请选择当前AI关联并填写1至1000字的理由。", 422);
  const graph = await getGraph({ scope: "all" }, actor);
  if (graph.version !== parsed.data.version || !graph.edges.some(e => e.id === parsed.data.edgeId && e.kind === "inferred")) throw new TaskError("GRAPH_CHANGED", "该关联已失效，请重新读取关系图后反馈。", 409);
  await db.insert(graphRelationFeedback).values({ studentId: actor.studentId, edgeId: parsed.data.edgeId, inputVersion: parsed.data.version, reason: parsed.data.reason }).onConflictDoNothing();
  return { message: "已记录，不会立即修改公共关系图。" };
}
export async function getGraphSource(key: string, actor: CurrentMember) {
  if (!graphSourceKeySchema.safeParse(key).success) throw new TaskError("INVALID_GRAPH_SOURCE", "来源编号无效，请重新选择节点。", 422);
  const snapshot = await graphSnapshot(actor);
  const source = graphSources(snapshot, { scope: "all" }).find((s) => s.key === key);
  if (!source) throw new TaskError("GRAPH_SOURCE_NOT_FOUND", "来源已删除或不可用，请刷新关系图。", 404);
  return { ...source, version: graphVersion(snapshot) };
}
