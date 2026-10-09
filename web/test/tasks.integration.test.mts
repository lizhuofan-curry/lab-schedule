import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, rmdir, unlink, access } from "node:fs/promises";
import path from "node:path";
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少测试库配置。");
process.env.DATABASE_URL = `postgresql://schedule:${password}@127.0.0.1:5433/schedule_test`;
const origin = "http://localhost:3017";
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_TRUSTED_ORIGINS = origin;
process.env.AUTH_DISABLE_RATE_LIMIT = "1";
const { db, sqlClient } = await import("@/db");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { eq } = await import("drizzle-orm");
const schema = await import("@/db/schema");
const {
  createTask,
  commandTask,
  taskDetail,
  notifications,
  readNotifications,
  TaskError,
  taskOptions,
  unboundFiles,
} = await import("@/lib/task-service");
const { createGroup, addGroupMember, removeGroupMember, deleteGroup } =
  await import("@/lib/group-service");
const { uploadTaskFile, downloadTaskFile, deleteTaskFile } =
  await import("@/lib/task-file-service");
const { auth } = await import("@/lib/auth");
const taskRoute = await import("@/app/api/tasks/route");
const detailRoute = await import("@/app/api/tasks/[id]/route");
const fileRoute = await import("@/app/api/task-files/[id]/route");
const fileUploadRoute = await import("@/app/api/task-files/route");
const notificationRoute = await import("@/app/api/notifications/route");
type Actor = {
  userId: string;
  studentId: number;
  studentNo: string;
  name: string;
};
let a: Actor,
  b: Actor,
  c: Actor,
  cookies: Record<string, string>,
  uploadDir = "";
const input = (overrides: Record<string, unknown> = {}) => ({
  title: "测试任务",
  description: "任务要求",
  kind: "assigned" as const,
  delivery: "individual" as const,
  deadline: null,
  capacity: null,
  directIds: [b.studentId],
  groupIds: [],
  fileIds: [],
  ...overrides,
});

test("小组排除未注册及停用成员：选择预览、发布结果与最新详情提示一致且去重", async () => {
  const g = await createGroup("排除提示组", a);
  const [unregistered] = await db.insert(schema.students).values({ name: "待注册丁", studentNo: "v2-unregistered" }).returning();
  await addGroupMember(g.id, b.studentId, a);
  await addGroupMember(g.id, unregistered.id, a);
  await addGroupMember(g.id, c.studentId, a);
  await db.update(schema.students).set({ enabled: false }).where(eq(schema.students.id, c.studentId));
  try {
    const option = (await taskOptions()).groups.find((item) => item.id === g.id)!;
    assert.deepEqual(new Set(option.members.map((m) => m.id)), new Set([a.studentId, b.studentId]));
    assert.deepEqual(new Set(option.excluded.map((m) => m.reason)), new Set(["未注册", "已停用"]));
    const task = await createTask(input({ directIds: [b.studentId], groupIds: [g.id] }), a);
    assert.equal(task.memberCount, 2);
    assert.equal(task.excluded.length, 2);
    const d = await detail(task.id);
    assert.equal(d.targetExclusions.length, 2);
    assert.equal(d.members.filter((p) => p.active).length, 2);
    assert.deepEqual(d.events.find((e) => e.action === "published")?.detail.excluded, task.excluded);
    const adjusted = await commandTask(task.id, { action: "targets", expectedRevision: d.revision, directIds: [], groupIds: [g.id], capacity: null }, a);
    assert.equal(adjusted.memberCount, 2);
    assert.deepEqual(adjusted.excluded, task.excluded);
    await db.update(schema.students).set({ enabled: true }).where(eq(schema.students.id, c.studentId));
    const latest = await detail(task.id);
    assert.equal(latest.members.filter((p) => p.active).length, 3);
    assert.deepEqual(latest.targetExclusions.map((m) => m.id), [unregistered.id]);
    await commandTask(task.id, { action: "cancel", expectedRevision: latest.revision }, a);
    assert.deepEqual((await detail(task.id)).targetExclusions, []);
  } finally {
    await db.update(schema.students).set({ enabled: true }).where(eq(schema.students.id, c.studentId));
  }
});

test("本人未提交附件清理释放额度；失败保留额度、禁止绑定，缺失文件可重试", async () => {
  const originalQuota = process.env.TASK_USER_QUOTA_BYTES;
  const [usage] = await sqlClient`select coalesce(sum(size),0)::int as bytes from task_files where creator_id=${c.studentId}`;
  process.env.TASK_USER_QUOTA_BYTES = String(usage.bytes + 3);
  try {
    const file = await uploadTaskFile(new File(["abc"], "cleanup.txt"), c);
    await assert.rejects(uploadTaskFile(new File(["abc"], "full.txt"), c), errorCode("STORAGE_FULL"));
    await assert.rejects(deleteTaskFile(file.id, b), errorCode("FILE_NOT_FOUND"));
    assert.ok((await unboundFiles(c)).files.some((f) => f.id === file.id));
    assert.ok(!(await unboundFiles(b)).files.some((f) => f.id === file.id));
    // A directory at this isolated file path causes a genuine filesystem failure.
    await unlink(path.join(uploadDir, file.id));
    await mkdir(path.join(uploadDir, file.id));
    await assert.rejects(deleteTaskFile(file.id, c), errorCode("FILE_DELETE_FAILED"));
    assert.ok((await unboundFiles(c)).files.find((f) => f.id === file.id)?.deleting);
    await assert.rejects(downloadTaskFile(file.id, c), errorCode("FILE_NOT_FOUND"));
    await assert.rejects(createTask(input({ fileIds: [file.id] }), c), errorCode("INVALID_FILE"));
    await assert.rejects(uploadTaskFile(new File(["abc"], "still-full.txt"), c), errorCode("STORAGE_FULL"));
    await rmdir(path.join(uploadDir, file.id));
    await deleteTaskFile(file.id, c);
    assert.ok(!(await unboundFiles(c)).files.some((f) => f.id === file.id));
    const replacement = await uploadTaskFile(new File(["abc"], "replacement.txt"), c);
    await deleteTaskFile(replacement.id, c);
    await assert.rejects(access(path.join(uploadDir, replacement.id)));
  } finally {
    if (originalQuota === undefined) delete process.env.TASK_USER_QUOTA_BYTES;
    else process.env.TASK_USER_QUOTA_BYTES = originalQuota;
  }
});

test("绑定与清理并发只有一个成功；已关联或历史附件不能清理", async () => {
  const file = await uploadTaskFile(new File(["race"], "race.txt"), b);
  const attempts = await Promise.allSettled([
    createTask(input({ fileIds: [file.id] }), b),
    deleteTaskFile(file.id, b),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  if (attempts[0].status === "fulfilled") {
    await assert.rejects(deleteTaskFile(file.id, b), errorCode("FILE_IN_USE"));
    const d = await detail(attempts[0].value.id);
    await commandTask(d.id, { action: "cancel", expectedRevision: d.revision }, b);
    await assert.rejects(deleteTaskFile(file.id, b), errorCode("FILE_IN_USE"));
    assert.equal(await (await downloadTaskFile(file.id, a)).text(), "race");
  } else {
    assert.ok(errorCode("INVALID_FILE")(attempts[0].reason));
    await assert.rejects(downloadTaskFile(file.id, b), errorCode("FILE_NOT_FOUND"));
  }
});

test("未提交附件API：游客匿名越权拒绝，删除严格校验Origin和确认对象", async () => {
  const file = await uploadTaskFile(new File(["api"], "delete-api.txt"), a);
  const context = { params: Promise.resolve({ id: file.id }) };
  const request = (cookie?: string, requestOrigin = origin, data: unknown = { confirm: true }) => new Request(`${origin}/api/task-files/${file.id}`, {
    method: "DELETE", headers: { ...(cookie ? { cookie } : {}), origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(data),
  });
  assert.equal((await fileUploadRoute.GET(new Request(`${origin}/api/task-files`))).status, 401);
  assert.equal((await fileUploadRoute.GET(new Request(`${origin}/api/task-files`, { headers: { cookie: "bci_guest_access=1" } }))).status, 403);
  assert.equal((await fileRoute.DELETE(request(), context)).status, 401);
  assert.equal((await fileRoute.DELETE(request("bci_guest_access=1"), context)).status, 403);
  assert.equal((await fileRoute.DELETE(request(cookies[b.studentNo]), context)).status, 404);
  assert.equal((await fileRoute.DELETE(request(cookies[a.studentNo], "https://evil.invalid"), context)).status, 403);
  assert.equal((await fileRoute.DELETE(request(cookies[a.studentNo], origin, { confirm: true, studentId: b.studentId }), context)).status, 422);
  const list = await fileUploadRoute.GET(new Request(`${origin}/api/task-files`, { headers: { cookie: cookies[a.studentNo] } }));
  assert.equal(list.headers.get("cache-control"), "private, no-store");
  assert.ok((await list.json()).data.files.some((f: { id: string }) => f.id === file.id));
  assert.equal((await fileRoute.DELETE(request(cookies[a.studentNo]), context)).status, 204);
});
const errorCode = (code: string) => (error: unknown) =>
  error instanceof TaskError && error.code === code;
async function detail(id: number) {
  return taskDetail(id);
}
async function submit(
  id: number,
  actor: Actor,
  body = "成果",
  expectedVersion = 0,
  requestKey = randomUUID(),
) {
  const d = await detail(id);
  const round = d.rounds[0];
  return commandTask(
    id,
    {
      action: "submit",
      roundId: round.id,
      expectedVersion,
      requestKey,
      body,
      links: [],
      fileIds: [],
    },
    actor,
  );
}
async function approve(id: number, actor = a) {
  const d = await detail(id);
  return commandTask(
    id,
    {
      action: "review",
      roundId: d.rounds[0].id,
      submissionId: d.submissions[0].id,
      decision: "approve",
      reason: "",
    },
    actor,
  );
}
before(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await sqlClient`TRUNCATE TABLE courses, audit_logs, students, semesters, periods, "user", "session", "account", "verification" RESTART IDENTITY CASCADE`;
  cookies = {};
  const actors = [];
  for (const [index, name] of ["发布甲", "执行乙", "执行丙"].entries()) {
    const studentNo = `v2-test-${index}`;
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          name,
          username: studentNo,
          email: `${studentNo}@members.local`,
          password: "v2-test-password-123",
        }),
      }),
    );
    assert.equal(response.status, 200);
    cookies[studentNo] = response.headers.get("set-cookie")!.split(";", 1)[0];
    const [row] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.studentNo, studentNo));
    actors.push({ userId: row.userId!, studentId: row.id, studentNo, name });
  }
  [a, b, c] = actors;
  await mkdir("data", { recursive: true });
  uploadDir = await mkdtemp(path.resolve("data/v2-test-"));
  process.env.TASK_UPLOAD_DIR = uploadDir;
});
after(async () => {
  await sqlClient.end();
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
});

test("任务所有权：A能看B但不能改验收撤销重开B任务", async () => {
  const t = await createTask(input({ directIds: [a.studentId] }), b);
  assert.equal((await detail(t.id)).publisherId, b.studentId);
  for (const action of ["cancel", "close", "reopen"] as const) {
    const d = await detail(t.id);
    await assert.rejects(
      commandTask(
        t.id,
        {
          action,
          expectedRevision: d.revision,
          ...(action === "reopen" ? { claimsOpen: false, deadline: null } : {}),
        } as Parameters<typeof commandTask>[1],
        a,
      ),
      errorCode("FORBIDDEN_OWNER"),
    );
  }
  await assert.rejects(submit(t.id, c), errorCode("FORBIDDEN_EXECUTOR"));
});
test("游客仅六个列表白名单含分类标识，详情附件消息和写入拒绝，匿名无列表", async () => {
  const t = await createTask(input(), a);
  const guestHeaders = { cookie: "bci_guest_access=1", origin };
  const req = (url: string, method = "GET", body?: unknown) =>
    new Request(`${origin}${url}`, {
      method,
      headers: { ...guestHeaders, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const list = await taskRoute.GET(req("/api/tasks"));
  assert.equal(list.status, 200);
  const rows = (await list.json()).data;
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["id", "title", "publisher", "deadline", "status", "kind"].sort(),
  );
  assert.equal(
    (
      await detailRoute.GET(req(`/api/tasks/${t.id}`), {
        params: Promise.resolve({ id: String(t.id) }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await taskRoute.POST(req("/api/tasks", "POST", input()))).status,
    403,
  );
  assert.equal(
    (
      await fileRoute.GET(req(`/api/task-files/${randomUUID()}`), {
        params: Promise.resolve({ id: randomUUID() }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await notificationRoute.GET(req("/api/notifications"))).status,
    403,
  );
  assert.equal(
    (await taskRoute.GET(new Request(`${origin}/api/tasks`))).status,
    401,
  );
});
test("并发领取最后一名额仅一次成功，重复领取不增人数", async () => {
  const t = await createTask(
    input({
      kind: "announcement",
      delivery: "shared",
      directIds: [],
      capacity: 1,
    }),
    a,
  );
  const results = await Promise.allSettled([
    commandTask(t.id, { action: "claim" }, b),
    commandTask(t.id, { action: "claim" }, c),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const d = await detail(t.id);
  const winner = d.members[0].studentId === b.studentId ? b : c;
  await commandTask(t.id, { action: "claim" }, winner);
  assert.equal((await detail(t.id)).members.filter((p) => p.active).length, 1);
});
test("公告全部成果通过仍需结束领取，结束后完成且禁止新领取", async () => {
  const t = await createTask(
    input({ kind: "announcement", delivery: "shared", directIds: [] }),
    a,
  );
  await commandTask(t.id, { action: "claim" }, b);
  await submit(t.id, b);
  await approve(t.id);
  let d = await detail(t.id);
  assert.equal(d.status, "active");
  await commandTask(t.id, { action: "close", expectedRevision: d.revision }, a);
  d = await detail(t.id);
  assert.equal(d.status, "completed");
  await assert.rejects(
    commandTask(t.id, { action: "claim" }, c),
    errorCode("TASK_CLOSED"),
  );
});
test("空名单关闭领取不完成，撤销保持历史", async () => {
  const t = await createTask(input({ kind: "announcement", directIds: [] }), a);
  let d = await detail(t.id);
  await commandTask(t.id, { action: "close", expectedRevision: d.revision }, a);
  d = await detail(t.id);
  assert.equal(d.status, "active");
  await commandTask(
    t.id,
    { action: "cancel", expectedRevision: d.revision },
    a,
  );
  d = await detail(t.id);
  assert.equal(d.status, "cancelled");
  assert.ok(d.events.some((e) => e.action === "cancelled"));
});
test("打回要求原因，重提保留历史，旧版验收被拒绝", async () => {
  const t = await createTask(input(), a);
  await submit(t.id, b);
  let d = await detail(t.id);
  const s = d.submissions[0];
  await assert.rejects(
    commandTask(
      t.id,
      {
        action: "review",
        roundId: s.roundId,
        submissionId: s.id,
        decision: "return",
        reason: "",
      },
      a,
    ),
    errorCode("INVALID_REVIEW"),
  );
  await commandTask(
    t.id,
    {
      action: "review",
      roundId: s.roundId,
      submissionId: s.id,
      decision: "return",
      reason: "补充结果",
    },
    a,
  );
  await submit(t.id, b, "补充成果", 1);
  await assert.rejects(
    commandTask(
      t.id,
      {
        action: "review",
        roundId: s.roundId,
        submissionId: s.id,
        decision: "approve",
        reason: "",
      },
      a,
    ),
    errorCode("STALE_SUBMISSION"),
  );
  d = await detail(t.id);
  assert.equal(d.submissions.length, 2);
  assert.equal(d.submissions[1].feedback, "补充结果");
  await approve(t.id);
  assert.equal((await detail(t.id)).status, "completed");
});
test("共享成果并发重提只接受一个新版本，重复requestKey不增版本", async () => {
  const t = await createTask(
    input({ delivery: "shared", directIds: [b.studentId, c.studentId] }),
    a,
  );
  const d = await detail(t.id);
  const key = randomUUID();
  const cmd = {
    action: "submit" as const,
    roundId: d.rounds[0].id,
    expectedVersion: 0,
    requestKey: key,
    body: "第一版",
    links: [],
    fileIds: [],
  };
  await commandTask(t.id, cmd, b);
  await commandTask(t.id, cmd, b);
  assert.equal((await detail(t.id)).submissions.length, 1);
  const results = await Promise.allSettled([
    submit(t.id, b, "第二版乙", 1),
    submit(t.id, c, "第二版丙", 1),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await detail(t.id)).submissions.length, 2);
});
test("重提与验收并发不会通过旧版，已通过后不允许追加本轮", async () => {
  const t = await createTask(input(), a);
  await submit(t.id, b);
  const d = await detail(t.id);
  const old = d.submissions[0];
  await Promise.allSettled([
    submit(t.id, b, "第二版", 1),
    commandTask(
      t.id,
      {
        action: "review",
        roundId: old.roundId,
        submissionId: old.id,
        decision: "approve",
        reason: "",
      },
      a,
    ),
  ]);
  const next = await detail(t.id);
  if (next.submissions.length === 2) {
    assert.equal(next.submissions[0].status, "pending");
    assert.equal(next.submissions[1].status, "pending");
  } else {
    assert.equal(next.status, "completed");
    assert.equal(next.submissions[0].status, "approved");
  }
});
test("多组与个人合并去重，退出一个来源不退出任务，小组写入即时同步", async () => {
  const g1 = await createGroup("v2组一", a),
    g2 = await createGroup("v2组二", a);
  await addGroupMember(g1.id, b.studentId, a);
  await addGroupMember(g2.id, b.studentId, a);
  const t = await createTask(
    input({ directIds: [c.studentId], groupIds: [g1.id, g2.id] }),
    a,
  );
  assert.equal((await detail(t.id)).members.filter((p) => p.active).length, 3);
  await removeGroupMember(g1.id, b.studentId, a);
  const ps = await db
    .select()
    .from(schema.taskParticipants)
    .where(
      eq(schema.taskParticipants.roundId, (await detail(t.id)).rounds[0].id),
    );
  assert.ok(ps.find((p) => p.studentId === b.studentId)?.active);
  await removeGroupMember(g2.id, b.studentId, a);
  assert.equal(
    (await detail(t.id)).members.find((p) => p.studentId === b.studentId)
      ?.active,
    false,
  );
  await addGroupMember(g1.id, b.studentId, a);
  assert.equal(
    (await detail(t.id)).members.find((p) => p.studentId === b.studentId)
      ?.generation,
    2,
  );
});
test("组内不能单独排除，移除所有目标后的历史保留", async () => {
  const g = await createGroup("v2权限组", a);
  await addGroupMember(g.id, b.studentId, a);
  const t = await createTask(
    input({ directIds: [b.studentId], groupIds: [g.id] }),
    a,
  );
  let d = await detail(t.id);
  await commandTask(
    t.id,
    {
      action: "targets",
      expectedRevision: d.revision,
      directIds: [],
      groupIds: [g.id],
      capacity: null,
    },
    a,
  );
  assert.ok(
    (await detail(t.id)).members.find((p) => p.studentId === b.studentId)
      ?.active,
  );
  await submit(t.id, b);
  d = await detail(t.id);
  await commandTask(
    t.id,
    {
      action: "targets",
      expectedRevision: d.revision,
      directIds: [],
      groupIds: [],
      capacity: null,
    },
    a,
  );
  d = await detail(t.id);
  assert.equal(d.status, "active");
  assert.equal(d.members.filter((p) => p.active).length, 0);
  assert.equal(d.submissions.length, 1);
  await assert.rejects(
    submit(t.id, b, "已移出重提", 1),
    errorCode("FORBIDDEN_EXECUTOR"),
  );
});
test("完成轮次固定，重开按当前小组且成果不继承", async () => {
  const g = await createGroup("v2重开组", a);
  await addGroupMember(g.id, b.studentId, a);
  const t = await createTask(
    input({ delivery: "shared", directIds: [], groupIds: [g.id] }),
    a,
  );
  await submit(t.id, b);
  await approve(t.id);
  let d = await detail(t.id);
  const oldRound = d.rounds[0].id;
  await addGroupMember(g.id, c.studentId, a);
  assert.equal((await detail(t.id)).members.filter((p) => p.active).length, 2);
  await commandTask(
    t.id,
    {
      action: "reopen",
      expectedRevision: d.revision,
      claimsOpen: false,
      deadline: null,
    },
    a,
  );
  d = await detail(t.id);
  assert.equal(d.currentRound, 2);
  assert.equal(d.status, "active");
  assert.equal(
    d.members.filter((p) => p.roundId === d.rounds[0].id && p.active).length,
    3,
  );
  assert.equal(
    d.submissions.filter((s) => s.roundId === d.rounds[0].id).length,
    0,
  );
  assert.equal(d.submissions[0].roundId, oldRound);
  assert.ok(
    (await notifications(b)).assignments.some(
      (m) => m.roundId === d.rounds[0].id,
    ),
  );
});
test("公告撤销后重开选择停止领取，原成员保留并重新验收", async () => {
  const t = await createTask(
    input({ kind: "announcement", directIds: [], delivery: "shared" }),
    a,
  );
  await commandTask(t.id, { action: "claim" }, b);
  await submit(t.id, b);
  let d = await detail(t.id);
  await commandTask(
    t.id,
    { action: "cancel", expectedRevision: d.revision },
    a,
  );
  d = await detail(t.id);
  await commandTask(
    t.id,
    {
      action: "reopen",
      expectedRevision: d.revision,
      claimsOpen: false,
      deadline: null,
    },
    a,
  );
  d = await detail(t.id);
  assert.equal(d.rounds[0].claimsOpen, false);
  assert.ok(
    d.members.find(
      (p) => p.roundId === d.rounds[0].id && p.studentId === b.studentId,
    )?.active,
  );
  assert.equal(d.status, "active");
  await assert.rejects(
    commandTask(t.id, { action: "claim" }, c),
    errorCode("CLAIM_CLOSED"),
  );
});
test("逾期仍提交，要求修改保留历史且旧修订不能覆盖", async () => {
  const t = await createTask(input({ deadline: "2020-01-01T00:00:00Z" }), a);
  let d = await detail(t.id);
  const revision = d.revision;
  await commandTask(
    t.id,
    {
      action: "edit",
      expectedRevision: revision,
      title: "新要求",
      description: "补充要求",
      deadline: null,
      capacity: null,
      fileIds: [],
    },
    a,
  );
  await assert.rejects(
    commandTask(t.id, { action: "cancel", expectedRevision: revision }, a),
    errorCode("STALE_REVISION"),
  );
  d = await detail(t.id);
  assert.ok(d.events.some((e) => e.action === "edited"));
  await submit(t.id, b);
});
test("逐人成果移出后不阻塞，重新加入不能继承旧通过", async () => {
  const t = await createTask(
    input({ directIds: [b.studentId, c.studentId] }),
    a,
  );
  await submit(t.id, b);
  await approve(t.id);
  let d = await detail(t.id);
  assert.equal(d.status, "active");
  await commandTask(
    t.id,
    {
      action: "targets",
      expectedRevision: d.revision,
      directIds: [c.studentId],
      groupIds: [],
      capacity: null,
    },
    a,
  );
  d = await detail(t.id);
  await commandTask(
    t.id,
    {
      action: "targets",
      expectedRevision: d.revision,
      directIds: [b.studentId, c.studentId],
      groupIds: [],
      capacity: null,
    },
    a,
  );
  d = await detail(t.id);
  assert.equal(
    d.members.find((p) => p.studentId === b.studentId)?.generation,
    2,
  );
  await submit(t.id, c);
  await approve(t.id);
  assert.equal((await detail(t.id)).status, "active");
  await submit(t.id, b, "再加入的新成果");
  await approve(t.id);
  assert.equal((await detail(t.id)).status, "completed");
});
test("小组解散不误完成空名单，停用成员不能写", async () => {
  const g = await createGroup("v2解散组", a);
  const t = await createTask(input({ directIds: [], groupIds: [g.id] }), a);
  await deleteGroup(g.id, a);
  assert.equal((await detail(t.id)).members.filter((p) => p.active).length, 0);
  assert.equal((await detail(t.id)).status, "active");
  await db
    .update(schema.students)
    .set({ enabled: false })
    .where(eq(schema.students.id, c.studentId));
  await assert.rejects(createTask(input(), c), errorCode("UNAUTHORIZED"));
  await db
    .update(schema.students)
    .set({ enabled: true })
    .where(eq(schema.students.id, c.studentId));
});
test("超过200条消息仍能翻页看历史，未读数计算全部且不能读取他人", async () => {
  const t = await createTask(input(), a);
  const d = await detail(t.id);
  await db
    .insert(schema.taskNotifications)
    .values(
      Array.from({ length: 205 }, (_, i) => ({
        recipientId: b.studentId,
        taskId: t.id,
        roundId: d.rounds[0].id,
        title: "翻页验证",
        message: `消息${i}`,
      })),
    );
  const first = await notifications(b);
  assert.equal(first.messages.length, 200);
  assert.ok(first.nextCursor);
  assert.ok(first.unread > 200);
  const next = await notifications(b, first.nextCursor!);
  assert.ok(next.messages.length > 0);
  assert.ok(
    next.messages.every(
      (m) => m.id < first.nextCursor! && m.recipientId === b.studentId,
    ),
  );
  const empty = await notificationRoute.GET(
    new Request(`${origin}/api/notifications?before=0`, {
      headers: { cookie: cookies[b.studentNo] },
    }),
  );
  assert.equal(empty.status, 422);
});

test("成员移出再加入只显示新指派，不复活旧提醒", async () => {
  for (const kind of ["announcement", "assigned"] as const) {
    const t = await createTask(input({ kind }), a);
    const original = (await notifications(b)).assignments.find(
      (m) => m.taskId === t.id,
    )!;
    assert.ok(original);
    let d = await detail(t.id);
    await commandTask(
      t.id,
      {
        action: "targets",
        expectedRevision: d.revision,
        directIds: [],
        groupIds: [],
        capacity: null,
      },
      a,
    );
    assert.equal(
      (await notifications(b)).assignments.some((m) => m.taskId === t.id),
      false,
    );
    d = await detail(t.id);
    await commandTask(
      t.id,
      {
        action: "targets",
        expectedRevision: d.revision,
        directIds: [b.studentId],
        groupIds: [],
        capacity: null,
      },
      a,
    );
    const current = (await notifications(b)).assignments.filter(
      (m) => m.taskId === t.id,
    );
    assert.equal(current.length, 1);
    assert.notEqual(current[0].id, original.id);
  }
});

test("个人消息越权拒绝，已读持久化，撤销指派不再弹窗", async () => {
  const t = await createTask(input(), a);
  const inbox = await notifications(b);
  const m = inbox.assignments.find((m) => m.taskId === t.id)!;
  assert.ok(m);
  await assert.rejects(
    readNotifications([m.id], c),
    errorCode("FORBIDDEN_NOTIFICATION"),
  );
  await readNotifications([m.id], b);
  assert.equal(
    (await notifications(b)).assignments.some((n) => n.id === m.id),
    false,
  );
  const d = await detail(t.id);
  await commandTask(
    t.id,
    { action: "cancel", expectedRevision: d.revision },
    a,
  );
  assert.equal(
    (await notifications(b)).assignments.some((n) => n.taskId === t.id),
    false,
  );
});
test("文件上传绑定下载校验与配额；未绑定仅本人，游客全部拒绝", async () => {
  const file = await uploadTaskFile(new File(["# 结果"], "结果.md"), b);
  await assert.rejects(
    downloadTaskFile(file.id, a),
    errorCode("FILE_NOT_FOUND"),
  );
  const t = await createTask(input(), a);
  const d = await detail(t.id);
  await commandTask(
    t.id,
    {
      action: "submit",
      roundId: d.rounds[0].id,
      expectedVersion: 0,
      requestKey: randomUUID(),
      body: "",
      links: [],
      fileIds: [file.id],
    },
    b,
  );
  const response = await downloadTaskFile(file.id, c);
  assert.equal(await response.text(), "# 结果");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const preview = await downloadTaskFile(file.id, c, true);
  assert.equal(await preview.text(), "# 结果");
  assert.equal(preview.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(preview.headers.get("content-disposition")!, /^inline;/);
  assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
  await assert.rejects(
    uploadTaskFile(new File(["fake"], "fake.pdf"), b),
    errorCode("INVALID_FILE"),
  );
  process.env.TASK_USER_QUOTA_BYTES = "1";
  await assert.rejects(
    uploadTaskFile(new File(["quota"], "quota.txt"), b),
    errorCode("STORAGE_FULL"),
  );
  delete process.env.TASK_USER_QUOTA_BYTES;
});

test("预览鉴权不绕过未关联所有权、游客及匿名；长文本和Office下载回退", async () => {
  const file = await uploadTaskFile(new File(["参考资料"], "预览.txt"), a);
  const context = { params: Promise.resolve({ id: file.id }) };
  const request = (cookie?: string) => new Request(`${origin}/api/task-files/${file.id}?preview=1`, { headers: cookie ? { cookie } : {} });
  assert.equal((await fileRoute.GET(request(), context)).status, 401);
  assert.equal((await fileRoute.GET(request("bci_guest_access=1"), context)).status, 403);
  assert.equal((await fileRoute.GET(request(cookies[b.studentNo]), context)).status, 404);
  await createTask(input({ fileIds: [file.id] }), a);
  const response = await fileRoute.GET(request(cookies[b.studentNo]), context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "参考资料");
  assert.match(response.headers.get("content-disposition")!, /^inline;/);
  const long = await uploadTaskFile(new File(["x".repeat(256 * 1024 + 1)], "长资料.txt"), a);
  await assert.rejects(downloadTaskFile(long.id, a, true), errorCode("FILE_PREVIEW_TOO_LARGE"));
  assert.equal((await downloadTaskFile(long.id, a)).status, 200);
  const office = await uploadTaskFile(new File([new Uint8Array([208,207,17,224,161,177,26,225])], "文档.doc"), a);
  await assert.rejects(downloadTaskFile(office.id, a, true), errorCode("FILE_PREVIEW_UNSUPPORTED"));
  assert.equal((await downloadTaskFile(office.id, a)).status, 200);
});
test("真实会话API写操作校验Origin、JSON和成员身份", async () => {
  const headers = {
    cookie: cookies[a.studentNo],
    origin,
    "content-type": "application/json",
  };
  const response = await taskRoute.POST(
    new Request(`${origin}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(input()),
    }),
  );
  assert.equal(response.status, 201);
  const id = (await response.json()).data.id;
  const badOrigin = await detailRoute.POST(
    new Request(`${origin}/api/tasks/${id}`, {
      method: "POST",
      headers: { ...headers, origin: "https://evil.invalid" },
      body: JSON.stringify({ action: "claim" }),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  assert.equal(badOrigin.status, 403);
  const malformed = await taskRoute.POST(
    new Request(`${origin}/api/tasks`, { method: "POST", headers, body: "{" }),
  );
  assert.equal(malformed.status, 422);
  const form = new FormData();
  form.append("file", new File(["file"], "api.txt"));
  const upload = await fileUploadRoute.POST(
    new Request(`${origin}/api/task-files`, {
      method: "POST",
      headers: { cookie: cookies[a.studentNo], origin },
      body: form,
    }),
  );
  assert.equal(upload.status, 201);
});
