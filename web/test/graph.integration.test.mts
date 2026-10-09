import test, { before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import postgres from "postgres";
loadEnvFile(".env");
const database = `schedule_v3_test_${Date.now()}`;
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少隔离库配置");
process.env.DATABASE_URL = `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${database}`;
const origin = "http://localhost:3023";
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_TRUSTED_ORIGINS = origin;
process.env.AUTH_DISABLE_RATE_LIMIT = "1";
process.env.V3_GRAPH_ENABLED = "1";
process.env.V3_ANALYSIS_ENABLED = "1";
process.env.DEEPSEEK_API_KEY = "synthetic-test-key";
const admin = postgres({ host: "127.0.0.1", port: 5433, username: "schedule", password, database: "postgres", max: 1 });
const { db, sqlClient } = await import("@/db");
const s = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { auth } = await import("@/lib/auth");
const { getGraph, graphSnapshot, graphVersion, getGraphSource } = await import("@/lib/graph-service");
const { runGraphAnalysisOnce, readGraphAnalysis } = await import("@/lib/graph-analysis-service");
const { redactGraphText } = await import("@/lib/graph-model");
const { createWork, updateWork, deleteWork, listMemberWork } = await import("@/lib/work-service");
const { createGroup, addGroupMember } = await import("@/lib/group-service");
const { TaskError } = await import("@/lib/task-service");
const graphRoute = await import("@/app/api/graph/route");
const sourceRoute = await import("@/app/api/graph/sources/[key]/route");
type Actor = { userId: string; studentId: number; studentNo: string; name: string };
let a: Actor, b: Actor, c: Actor;
const cookies = new Map<number, string>();
const request = (path: string, actor?: Actor, body?: unknown, guest = false) => new Request(origin + path, { method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", ...(actor ? { cookie: cookies.get(actor.studentId)! } : guest ? { cookie: "bci_guest_access=1" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const context = (key: string) => ({ params: Promise.resolve({ key }) });
const code = (value: string) => (error: unknown) => error instanceof TaskError && error.code === value;
const workInput = { title: "EEG实验", description: "合成隔离数据", status: "active" as const };
let created = false;
before(async () => {
  await admin.unsafe(`CREATE DATABASE "${database}"`); created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  const actors: Actor[] = [];
  for (const index of [1, 2, 3]) {
    const no = `graph-${Date.now()}-${index}`;
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: `合成成员${index}`, username: no, email: `${no}@members.local`, password: "isolated-graph-test-password" }) }));
    assert.equal(response.status, 200);
    const [row] = await db.select().from(s.students).where(eq(s.students.studentNo, no));
    const actor = { userId: row.userId!, studentId: row.id, studentNo: no, name: row.name };
    cookies.set(row.id, response.headers.get("set-cookie")!.split(";", 1)[0]); actors.push(actor);
  }
  [a, b, c] = actors;
});
afterEach(() => mock.restoreAll());
after(async () => {
  await sqlClient.end();
  if (created && /^schedule_v3_test_\d+$/.test(database)) await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
});
test("独立历史授权：A读B超7天来源，成员页仍近期，不能改/删B", async () => {
  const w = await createWork({ ...workInput, status: "completed" }, b);
  await db.update(s.memberWorkRecords).set({ completedAt: new Date(Date.now() - 9 * 86400000) }).where(eq(s.memberWorkRecords.id, w.id));
  assert.ok(!(await listMemberWork(b.studentId, a)).records.some((r) => r.id === w.id));
  assert.equal((await getGraphSource(`work:${w.id}`, a)).description, workInput.description);
  const response = await sourceRoute.GET(request(`/api/graph/sources/work:${w.id}`, a), context(`work:${w.id}`));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  await assert.rejects(updateWork(w.id, { ...workInput, expectedRevision: 1 }, a), code("FORBIDDEN_OWNER"));
  await assert.rejects(deleteWork(w.id, 1, a), code("FORBIDDEN_OWNER"));
});
test("匿名/游客拒绝图和来源，开关关闭不扩权，重复查询拒绝", async () => {
  for (const guest of [false, true]) {
    const expected = guest ? 403 : 401;
    assert.equal((await graphRoute.GET(request("/api/graph", undefined, undefined, guest))).status, expected);
    assert.equal((await sourceRoute.GET(request("/api/graph/sources/work:1", undefined, undefined, guest), context("work:1"))).status, expected);
  }
  process.env.V3_GRAPH_ENABLED = "0";
  assert.equal((await graphRoute.GET(request("/api/graph", a))).status, 404);
  process.env.V3_GRAPH_ENABLED = "1";
  for (const query of ["scope=all&id=1", "scope=all&scope=member", "scope=all&studentId=2"])
    assert.equal((await graphRoute.GET(request(`/api/graph?${query}`, a))).status, 422);
});
test("小组当前成员汇总与重叠来源去重", async () => {
  const g1 = await createGroup("合成小组一", a), g2 = await createGroup("合成小组二", b);
  await addGroupMember(g1.id, b.studentId, a);
  const w = await createWork(workInput, b);
  const graph = await getGraph({ scope: "group", id: g1.id }, a);
  assert.equal(graph.nodes.filter((n) => n.id === `work:${w.id}`).length, 1);
  assert.equal((await getGraph({ scope: "group", id: g2.id }, a)).nodes.filter((n) => n.id === `work:${w.id}`).length, 1);
});
test("模型脱敏涵盖正文姓名/账号/邮箱/凭据，未知来源和HTML主题整体拒绝", async () => {
  const identities = [{ name: b.name, identifiers: [b.studentNo, b.userId] }];
  const text = redactGraphText(`${b.name} ${b.studentNo} ${b.userId} x@example.com sk-secret postgres://account:secret@host/db`, identities);
  for (const secret of [b.name, b.studentNo, b.userId, "x@example.com", "sk-secret", "account:secret"]) assert.ok(!text.includes(secret));
  assert.equal(redactGraphText("甲负责分类", [{ name: "甲", identifiers: [] }]), "M01负责分类");
  assert.equal(redactGraphText("备注 arbitrary-key-value", [], ["arbitrary-key-value"]), "备注 [凭据已移除]");
  const { extractGraphThemes } = await import("@/lib/graph-model");
  for (const theme of [{ label: "主题", sourceIds: ["work:99999"] }, { label: "<script>", sourceIds: ["work:1"] }]) {
    mock.method(globalThis, "fetch", async () => Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ themes: [theme] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    await assert.rejects(extractGraphThemes([{ key: "work:1", title: "工作", description: "说明", owner: "甲", status: "active", currentLoad: true }], (s) => s), code("MODEL_INVALID"));
    mock.restoreAll();
  }
});
test("删除即时移除来源/主题，途中模型返回不得复活，后台合并变更", async () => {
  const w = await createWork(workInput, b);
  const snapshot = await graphSnapshot(a), version = graphVersion(snapshot);
  await db.insert(s.graphAnalysisState).values({ id: 1, inputVersion: version, status: "ready", model: "fixture", themes: [{ label: "EEG", sourceIds: [`work:${w.id}`] }], analyzedAt: new Date(), retryAt: new Date() }).onConflictDoUpdate({ target: s.graphAnalysisState.id, set: { inputVersion: version, status: "ready", themes: [{ label: "EEG", sourceIds: [`work:${w.id}`] }] } });
  assert.ok((await getGraph({ scope: "all" }, a)).nodes.some((n) => n.kind === "theme"));
  await deleteWork(w.id, 1, b);
  await assert.rejects(getGraphSource(`work:${w.id}`, a), code("GRAPH_SOURCE_NOT_FOUND"));
  const next = await getGraph({ scope: "all" }, a);
  assert.equal(next.analysis.status, "pending"); assert.ok(!next.nodes.some((n) => n.kind === "theme"));
  const x = await createWork(workInput, b);
  const current = graphVersion(await graphSnapshot(a));
  await db.update(s.graphAnalysisState).set({ inputVersion: current, status: "pending", themes: [], retryAt: new Date(0), leaseToken: null }).where(eq(s.graphAnalysisState.id, 1));
  mock.method(globalThis, "fetch", async () => {
    await deleteWork(x.id, 1, b);
    return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ themes: [{ label: "过期主题", sourceIds: [`work:${x.id}`] }] }) } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
  });
  await runGraphAnalysisOnce();
  assert.ok(!(await getGraph({ scope: "all" }, a)).nodes.some((n) => n.label === "过期主题"));
  const [state] = await db.select().from(s.graphAnalysisState);
  assert.equal(state.status, "pending"); assert.equal(state.themes.length, 0);
});
test("单个分析租约防重复、失败退避，缺凭据保留真实关系，停用账号拒绝", async () => {
  const version = graphVersion(await graphSnapshot(a));
  await db.update(s.graphAnalysisState).set({ inputVersion: version, status: "pending", themes: [], retryAt: new Date(0), attempts: 0, leaseToken: null }).where(eq(s.graphAnalysisState.id, 1));
  let requests = 0;
  mock.method(globalThis, "fetch", async () => { requests++; return Response.json({}, { status: 429 }); });
  await Promise.all([runGraphAnalysisOnce(), runGraphAnalysisOnce()]);
  assert.equal(requests, 1);
  assert.equal((await readGraphAnalysis(version)).info.status, "failed");
  await runGraphAnalysisOnce(); assert.equal(requests, 1);
  const key = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  assert.equal((await getGraph({ scope: "all" }, a)).analysis.status, "disabled"); process.env.DEEPSEEK_API_KEY = key;
  await db.update(s.students).set({ enabled: false }).where(eq(s.students.id, c.studentId));
  await assert.rejects(graphSnapshot(c), code("UNAUTHORIZED"));
  assert.ok(!(await getGraph({ scope: "all" }, a)).nodes.some((n) => n.id === `member:${c.studentId}`));
  await db.update(s.students).set({ enabled: true }).where(eq(s.students.id, c.studentId));
});
