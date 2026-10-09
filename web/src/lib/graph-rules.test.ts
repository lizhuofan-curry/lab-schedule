import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, graphLayout, graphSources, roundMembers, withGraphThemes, type GraphSnapshot } from "./graph-rules.ts";
import { graphQuerySchema, graphThemesSchema } from "./graph-schema.ts";
import { createGraphSimulation } from "./graph-layout.ts";

const fixture = (): GraphSnapshot => ({
  members: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }], groups: [{ id: 1, name: "算法" }, { id: 2, name: "实验" }],
  memberships: [{ groupId: 1, studentId: 1 }, { groupId: 1, studentId: 2 }, { groupId: 2, studentId: 2 }],
  work: [{ id: 1, studentId: 2, title: "历史记录", description: "既有工作", status: "completed", revision: 1, updatedAt: "2020-01-01", completedAt: "2020-01-01" }],
  tasks: [{ id: 1, publisherId: 1, kind: "assigned", status: "active", currentRound: 2, revision: 2 }],
  rounds: [1, 2].map((n) => ({ id: n, taskId: 1, number: n, title: "同一任务", description: "实验要求", directIds: [2], groupIds: [1, 2], deadline: null, endedAt: n === 1 ? "2020-01-01" : null, outcome: n === 1 ? "completed" : null })),
  participants: [{ roundId: 1, studentId: 3, active: true, generation: 1 }],
});
test("范围严格校验，不接受伪造身份、重复字段或all附带id", () => {
  for (const value of [{ scope: "all", id: 1 }, { scope: "member" }, { scope: "group", id: 0 }, { scope: "member", id: "1.1" }, { scope: "all", studentId: 2 }]) assert.equal(graphQuerySchema.safeParse(value).success, false);
  assert.equal(graphQuerySchema.safeParse({ scope: "member", id: "2" }).success, true);
});
test("个人/小组读全部现存历史，多组重叠不复制来源", () => {
  const s = fixture();
  const graph = buildGraph(s, { scope: "all" });
  assert.equal(graph.nodes.filter((n) => n.id === "work:1").length, 1);
  assert.ok(buildGraph(s, { scope: "group", id: 2 }).nodes.some((n) => n.id === "work:1"));
  assert.ok(graphSources(s, { scope: "member", id: 2 }).some((n) => n.key === "work:1"));
  assert.equal(graph.edges.some((e) => e.from === "group:2" && e.to === "work:1"), false);
});
test("当前轮动态合并去重，旧轮固定名单，不计为新轮当前负担", () => {
  const s = fixture();
  assert.deepEqual([...roundMembers(s, s.rounds[1])].sort(), [1, 2]);
  assert.deepEqual([...roundMembers(s, s.rounds[0])], [3]);
  const sources = graphSources(s, { scope: "all" });
  assert.equal(sources.find((n) => n.key === "round:1")?.currentLoad, false);
  assert.equal(sources.find((n) => n.key === "round:2")?.currentLoad, true);
  s.memberships = [];
  assert.deepEqual([...roundMembers(s, s.rounds[1])], [2]);
  assert.deepEqual([...roundMembers(s, s.rounds[0])], [3]);
});
test("删除来源后，孤立主题移除，多依据主题只保留有效来源", () => {
  const s = fixture(); s.work = [];
  const graph = withGraphThemes(buildGraph(s, { scope: "all" }), [{ label: "孤立", sourceIds: ["work:1"] }, { label: "仍有效", sourceIds: ["work:1", "round:1"] }]);
  assert.equal(graph.nodes.some((n) => n.label === "孤立"), false);
  assert.equal(graph.edges.some((e) => e.to === "work:1"), false);
  assert.ok(graph.edges.some((e) => e.kind === "inferred" && e.to === "round:1"));
});
test("全量图和布局不隐式截断1000条来源", () => {
  const s = fixture(); s.work = Array.from({ length: 1000 }, (_, index) => ({ ...s.work[0], id: index + 1 }));
  const graph = buildGraph(s, { scope: "all" });
  assert.equal(graph.nodes.filter((n) => n.kind === "work").length, 1000);
  const positions = graphLayout(graph.nodes, graph.edges);
  assert.equal(positions.size, graph.nodes.length);
  assert.ok([...positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(new Set([...positions.values()].map((p) => `${p.x},${p.y}`)).size, positions.size);
});
test("危险主题及未知来源格式拒绝", () => {
  for (const label of ["<script>", "https://evil.test", "[恶意](javascript:alert(1))"]) assert.equal(graphThemesSchema.safeParse({ themes: [{ label, sourceIds: ["work:1"] }] }).success, false);
  assert.equal(graphThemesSchema.safeParse({ themes: [{ label: "实验", sourceIds: ["work:9999999999999999999"] }] }).success, false);
});

test("布局按连线靠近，初始视图确定且空图可用", () => {
  const nodes = ["a", "b", "c", "d"].map(id => ({ id, kind: "work" as const, label: id, status: "active", currentLoad: true }));
  const edges = [{ id: "ab", from: "a", to: "b", kind: "fact" as const, label: "关联" }, { id: "cd", from: "c", to: "d", kind: "fact" as const, label: "关联" }];
  const points = graphLayout(nodes, edges);
  const distance = (a: string, b: string) => Math.hypot(points.get(a)!.x - points.get(b)!.x, points.get(a)!.y - points.get(b)!.y);
  assert.ok(distance("a", "b") < distance("a", "c"));
  assert.deepEqual(graphLayout(nodes, edges), points);
  assert.equal(graphLayout([]).size, 0);
});

test("拖动固定节点牵动邻居，松手释放并逐渐停稳", () => {
  const nodes = ["a", "b"].map(id => ({ id, kind: "work" as const, label: id, status: "active", currentLoad: true }));
  const edges = [{ id: "ab", from: "a", to: "b", kind: "fact" as const, label: "关联" }];
  const model = createGraphSimulation(nodes, edges, graphLayout(nodes, edges));
  const old = model.positions().get("b")!;
  model.pin("a", 300, 40);
  for (let i = 0; i < 20; i++) model.tick();
  assert.deepEqual(model.positions().get("a"), { x: 300, y: 40 });
  assert.notDeepEqual(model.positions().get("b"), old);
  model.release("a"); model.tick();
  assert.notDeepEqual(model.positions().get("a"), { x: 300, y: 40 });
  for (let i = 0; i < 160; i++) model.tick();
  assert.equal(model.running, false);
});
