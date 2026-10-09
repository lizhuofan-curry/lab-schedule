import test from "node:test";
import assert from "node:assert/strict";
import { analysisSources, modelContext, validateRelations, withCourseRelations, withRelations } from "./graph-relations.ts";
import type { GraphSnapshot } from "./graph-rules.ts";
import { buildGraph } from "./graph-rules.ts";
import { graphFeedbackSchema } from "./graph-schema.ts";
const fixture = (): GraphSnapshot => ({ members: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }], groups: [{ id: 1, name: "真实组名" }], memberships: [{ groupId: 1, studentId: 1 }], work: ["active", "paused", "completed"].map((status, i) => ({ id: i + 1, studentId: 1, title: "EEG分类", description: "用CSP分类运动想象脑电", status, revision: 1, updatedAt: "2026-10-09", completedAt: null })), tasks: [{ id: 1, publisherId: 1, kind: "assigned", status: "active", currentRound: 2, revision: 1 }], rounds: [1, 2].map(id => ({ id, taskId: 1, number: id, title: "EEG分类", description: "用CSP分类运动想象脑电", directIds: [2], groupIds: [], deadline: null, endedAt: null, outcome: null })), participants: [], courses: [] });
const relation = { from: "work:1", to: "round:2", type: "method" as const, reason: "两项均使用CSP", fromEvidence: "用CSP", toEvidence: "用CSP" };
test("V3.1仅当前/暂停工作和当前进行中轮次参与，角色输入不把发布等同承担", () => {
  const s = fixture(); assert.deepEqual(analysisSources(s).map(s => s.key), ["work:1", "work:2", "round:2"]);
  const context = modelContext(s, x => x); assert.equal(context.taskRoles[0].publisher, "M01"); assert.deepEqual(context.taskRoles[0].participants, ["M02"]);
  assert.ok(!JSON.stringify(context).includes("真实组名"));
  s.tasks[0].status = "completed"; assert.ok(!analysisSources(s).some(s => s.key.startsWith("round:")));
});
test("AI两端原文校验，非法来源/完成来源/虚构引用/危险HTML拒绝，重复对去重", () => {
  const s = fixture(); assert.equal(validateRelations([relation, relation], s).length, 1);
  for (const change of [{ from: "work:999" }, { from: "work:3" }, { fromEvidence: "不存在的证据" }, { reason: "<script>" }, { to: "work:1" }]) assert.throws(() => validateRelations([{ ...relation, ...change }], s));
  assert.throws(() => validateRelations([{ ...relation, type: "upstream" }], s));
  const graph = withRelations(buildGraph(s, { scope: "all" }), validateRelations([relation], s), "2026-10-09");
  assert.ok(graph.edges.some(e => e.kind === "inferred" && e.detail?.fromEvidence));
  assert.ok(!graph.nodes.some(n => n.kind === "theme"));
  s.work[0].status = "completed"; assert.throws(() => validateRelations([relation], s));
});
test("精确同课核验周次、星期、完整节次、非空教室、课程名、学期，多份证据合并", () => {
  const s = fixture(), a = { id: 1, studentId: 1, semesterId: 1, name: "脑电分析", location: "A楼101", weekday: 2, startPeriod: 1, endPeriod: 2, weeks: [1, 3, 5] };
  const b = { ...a, id: 2, studentId: 2, weeks: [3, 5, 7] };
  function courseEdges() { return withCourseRelations(buildGraph(s, { scope: "all" }), s).edges.filter(e => e.id.startsWith("course/")); }
  s.courses = [a, b, { ...b, id: 3 }]; assert.equal(courseEdges().length, 1); assert.deepEqual(courseEdges()[0].detail!.courses![0].weeks, [3, 5]); assert.equal(courseEdges()[0].detail!.courses!.length, 1);
  for (const change of [{ semesterId: 2 }, { weeks: [2, 4] }, { weekday: 3 }, { endPeriod: 3 }, { name: "另一个课程" }, { location: "B楼101" }, { location: "" }, { location: null }]) { s.courses = [a, { ...b, ...change }]; assert.equal(courseEdges().length, 0); }
  s.courses = [a, { ...b, name: " 脑电分析 ", location: " A楼101 " }]; assert.equal(courseEdges().length, 1);
});
test("模型课表输入仅允许必要字段，反馈禁止身份伪造/空理由/非法版本", () => {
  const s = fixture(); s.courses = [{ id: 1, studentId: 1, semesterId: 1, name: "信号处理", location: "101", weekday: 2, startPeriod: 1, endPeriod: 2, weeks: [1] }];
  const c = modelContext(s, text => text).courses[0]; assert.deepEqual(Object.keys(c).sort(), ["member", "name", "location", "weekday", "startPeriod", "endPeriod", "weeks"].sort());
  const input = { edgeId: "ai/work:1/round:2/method", version: "a".repeat(64), reason: "依据不足" };
  assert.ok(graphFeedbackSchema.safeParse(input).success);
  for (const change of [{ studentId: 2 }, { reason: " " }, { version: "old" }, { edgeId: "course/member:1/member:2" }]) assert.ok(!graphFeedbackSchema.safeParse({ ...input, ...change }).success);
});
