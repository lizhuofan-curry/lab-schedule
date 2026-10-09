import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
loadEnvFile(".env");
if (!process.env.POSTGRES_PASSWORD) throw new Error("缺少本地测试库配置。");
process.env.DATABASE_URL = `postgresql://schedule:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:5433/schedule_test`;
const origin = "http://localhost:3017";
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_TRUSTED_ORIGINS = origin;
process.env.AUTH_DISABLE_RATE_LIMIT = "1";
const { db, sqlClient } = await import("@/db");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { eq, sql } = await import("drizzle-orm");
const s = await import("@/db/schema");
const { auth } = await import("@/lib/auth");
const {
  createWork,
  updateWork,
  deleteWork,
  getOwnWork,
  listMemberWork,
  listMemberTasks,
} = await import("@/lib/work-service");
const { createTask, commandTask, taskDetail, notifications, TaskError } =
  await import("@/lib/task-service");
const workRoute = await import("@/app/api/my/work/route");
const ownRoute = await import("@/app/api/my/work/[id]/route");
const memberRoute = await import("@/app/api/students/[id]/work/route");
const tasksRoute = await import("@/app/api/students/[id]/work/tasks/route");
const detailRoute = await import("@/app/api/tasks/[id]/route");
type Actor = {
  userId: string;
  studentId: number;
  studentNo: string;
  name: string;
};
let a: Actor, b: Actor, c: Actor;
const cookies = new Map<number, string>();
const body = {
  title: "工作",
  description: "阅读方法和准备实验",
  status: "active" as const,
};
const context = (id: number) => ({
  params: Promise.resolve({ id: String(id) }),
});
const request = (
  url: string,
  actor?: Actor,
  method = "GET",
  value?: unknown,
  guest = false,
) =>
  new Request(`${origin}${url}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(actor
        ? { cookie: cookies.get(actor.studentId)! }
        : guest
          ? { cookie: "bci_guest_access=1" }
          : {}),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
const code = (expected: string) => (e: unknown) =>
  e instanceof TaskError && e.code === expected;
const taskInput = (ids: number[], title = "成员任务") => ({
  title,
  description: "提交成果",
  kind: "assigned" as const,
  delivery: "individual" as const,
  deadline: null,
  capacity: null,
  directIds: ids,
  groupIds: [],
  fileIds: [],
});
async function submit(id: number, actor: Actor, key = randomUUID()) {
  const detail = await taskDetail(id);
  const command = {
    action: "submit" as const,
    roundId: detail.rounds[0].id,
    requestKey: key,
    expectedVersion: 0,
    body: "成果",
    links: [],
    fileIds: [],
  };
  await commandTask(id, command, actor);
  return command;
}
async function approve(id: number) {
  const detail = await taskDetail(id);
  await commandTask(
    id,
    {
      action: "review",
      roundId: detail.rounds[0].id,
      submissionId: detail.submissions[0].id,
      decision: "approve",
      reason: "",
    },
    a,
  );
}
before(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  const actors: Actor[] = [];
  for (const i of [0, 1, 2]) {
    const no = `work-${Date.now()}-${i}`;
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: `工作成员${i}`,
          username: no,
          email: `${no}@members.local`,
          password: "isolated-work-test-password",
        }),
      }),
    );
    assert.equal(response.status, 200);
    const [row] = await db
      .select()
      .from(s.students)
      .where(eq(s.students.studentNo, no));
    const actor = {
      userId: row.userId!,
      studentId: row.id,
      studentNo: no,
      name: row.name,
    };
    cookies.set(row.id, response.headers.get("set-cookie")!.split(";", 1)[0]);
    actors.push(actor);
  }
  [a, b, c] = actors;
});
after(async () => {
  await sqlClient.end();
});

test("个人记录A查看B近期，不能读B旧记录详情及越权增改删", async () => {
  const r = await createWork(body, b);
  assert.ok(
    (await listMemberWork(b.studentId, a)).records.some((x) => x.id === r.id),
  );
  await assert.rejects(getOwnWork(r.id, a), code("FORBIDDEN_OWNER"));
  await assert.rejects(
    updateWork(r.id, { ...body, expectedRevision: 1 }, a),
    code("FORBIDDEN_OWNER"),
  );
  await assert.rejects(deleteWork(r.id, 1, a), code("FORBIDDEN_OWNER"));
  for (const extra of [
    { studentId: b.studentId },
    { completedAt: new Date().toISOString() },
    { fileIds: [] },
  ])
    assert.equal(
      (
        await workRoute.POST(
          request("/api/my/work", a, "POST", { ...body, ...extra }),
        )
      ).status,
      422,
    );
});
test("个人记录7天边界含起点跨周，暂停和旧进行中可见，旧完成及未来被隐藏", async () => {
  const now = new Date("2026-10-08T08:00:00Z"),
    cutoff = now.getTime() - 7 * 86400000;
  const cases = [
    {
      title: "边界",
      status: "completed" as const,
      completedAt: new Date(cutoff),
    },
    {
      title: "更早",
      status: "completed" as const,
      completedAt: new Date(cutoff - 1),
    },
    {
      title: "未来",
      status: "completed" as const,
      completedAt: new Date(now.getTime() + 1),
    },
    { title: "暂停", status: "paused" as const, completedAt: null },
    { title: "旧进行中", status: "active" as const, completedAt: null },
  ];
  const rows = await db
    .insert(s.memberWorkRecords)
    .values(
      cases.map((x) => ({
        ...x,
        studentId: b.studentId,
        description: "说明",
        updatedAt: new Date(cutoff - 30 * 86400000),
      })),
    )
    .returning();
  const visible = new Set(
    (
      await listMemberWork(b.studentId, a, "recent", undefined, now)
    ).records.map((r) => r.id),
  );
  for (const r of rows)
    assert.equal(
      visible.has(r.id),
      ["边界", "暂停", "旧进行中"].includes(r.title),
    );
  await assert.rejects(
    listMemberWork(b.studentId, a, "all"),
    code("FORBIDDEN_OWNER"),
  );
  assert.ok(
    (await listMemberWork(b.studentId, b, "all", undefined, now)).records.some(
      (r) => r.title === "更早",
    ),
  );
});
test("旧完成改字不刷新时间，恢复暂停后再次完成使用新时间", async () => {
  const old = new Date("2026-09-01T08:00:00Z");
  const [r] = await db
    .insert(s.memberWorkRecords)
    .values({
      ...body,
      studentId: b.studentId,
      status: "completed",
      completedAt: old,
    })
    .returning();
  const edited = await updateWork(
    r.id,
    { ...body, status: "completed", title: "改字", expectedRevision: 1 },
    b,
  );
  assert.equal(edited.completedAt?.toISOString(), old.toISOString());
  assert.equal(
    (await listMemberWork(b.studentId, a)).records.some((x) => x.id === r.id),
    false,
  );
  const paused = await updateWork(
    r.id,
    { ...body, status: "paused", expectedRevision: 2 },
    b,
  );
  assert.equal(paused.completedAt, null);
  const start = Date.now();
  const completed = await updateWork(
    r.id,
    { ...body, status: "completed", expectedRevision: 3 },
    b,
  );
  assert.ok(completed.completedAt!.getTime() >= start);
  assert.ok(
    (await listMemberWork(b.studentId, a)).records.some((x) => x.id === r.id),
  );
});
test("记录修改与删除并发仅一个成功，旧修订拒绝覆盖", async () => {
  const r = await createWork(body, a);
  const results = await Promise.allSettled([
    updateWork(r.id, { ...body, title: "新标题", expectedRevision: 1 }, a),
    deleteWork(r.id, 1, a),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const another = await createWork(body, a);
  await updateWork(another.id, { ...body, expectedRevision: 1 }, a);
  await assert.rejects(deleteWork(another.id, 1, a), code("STALE_REVISION"));
});
test("本人可删除旧完成记录，删除实际消失且不改任务或课表", async () => {
  const [r] = await db
    .insert(s.memberWorkRecords)
    .values({
      ...body,
      studentId: a.studentId,
      status: "completed",
      completedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  const counts =
    await sqlClient`select (select count(*) from collab_tasks) as tasks,(select count(*) from courses) as courses`;
  const response = await ownRoute.DELETE(
    request(`/api/my/work/${r.id}`, a, "DELETE", { expectedRevision: 1 }),
    context(r.id),
  );
  assert.equal(response.status, 200);
  assert.equal(
    (
      await db
        .select()
        .from(s.memberWorkRecords)
        .where(eq(s.memberWorkRecords.id, r.id))
    ).length,
    0,
  );
  assert.deepEqual(
    await sqlClient`select (select count(*) from collab_tasks) as tasks,(select count(*) from courses) as courses`,
    counts,
  );
});
test("53条记录相同更新时间游标分页无重复遗漏，伪造游标拒绝", async () => {
  const rows = await db
    .insert(s.memberWorkRecords)
    .values(
      Array.from({ length: 53 }, (_, i) => ({
        ...body,
        title: `分页${i}`,
        studentId: c.studentId,
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      })),
    )
    .returning();
  const first = await listMemberWork(c.studentId, c, "all");
  assert.equal(first.records.length, 50);
  assert.ok(first.nextCursor);
  const second = await listMemberWork(c.studentId, c, "all", first.nextCursor!);
  const ids = [...first.records, ...second.records].map((r) => r.id);
  assert.equal(new Set(ids).size, 53);
  assert.ok(rows.every((r) => ids.includes(r.id)));
  assert.equal(second.nextCursor, null);
  await assert.rejects(
    listMemberWork(c.studentId, a, "recent", "invalid"),
    code("INVALID_CURSOR"),
  );
});
test("匿名游客全部记录接口拒绝，旧范围额外日期重复查询拒绝", async () => {
  const own = await createWork(body, a);
  for (const guest of [false, true]) {
    const status = guest ? 403 : 401;
    assert.equal(
      (
        await memberRoute.GET(
          request(
            `/api/students/${a.studentId}/work`,
            undefined,
            "GET",
            undefined,
            guest,
          ),
          context(a.studentId),
        )
      ).status,
      status,
    );
    assert.equal(
      (
        await tasksRoute.GET(
          request(
            `/api/students/${a.studentId}/work/tasks`,
            undefined,
            "GET",
            undefined,
            guest,
          ),
          context(a.studentId),
        )
      ).status,
      status,
    );
    assert.equal(
      (
        await ownRoute.GET(
          request(`/api/my/work/${own.id}`, undefined, "GET", undefined, guest),
          context(own.id),
        )
      ).status,
      status,
    );
    assert.equal(
      (
        await workRoute.POST(
          request("/api/my/work", undefined, "POST", body, guest),
        )
      ).status,
      status,
    );
  }
  for (const suffix of [
    "?scope=all",
    "?scope=recent&scope=all",
    "?now=2026-01-01",
    "?cursor=bad",
  ])
    assert.ok(
      [403, 422].includes(
        (
          await memberRoute.GET(
            request(`/api/students/${b.studentId}/work${suffix}`, a),
            context(b.studentId),
          )
        ).status,
      ),
    );
});
test("进行中任务按成员展示，个人已通过不算整体完成，移出即退出摘要", async () => {
  const task = await createTask(
    taskInput([b.studentId, c.studentId], "个人已通过整体进行中"),
    a,
  );
  await submit(task.id, b);
  await approve(task.id);
  const entry = (await listMemberTasks(b.studentId, a)).tasks.find(
    (t) => t.id === task.id,
  )!;
  assert.equal(entry.status, "active");
  assert.equal(entry.ownStatus, "approved");
  const d = await taskDetail(task.id);
  await commandTask(
    task.id,
    {
      action: "targets",
      expectedRevision: d.revision,
      directIds: [c.studentId],
      groupIds: [],
      capacity: null,
    },
    a,
  );
  assert.equal(
    (await listMemberTasks(b.studentId, a)).tasks.some((t) => t.id === task.id),
    false,
  );
});
test("完成任务用整体完成时间筛选，公告未领取撤销及旧完成不进入，重开不继承旧成果", async () => {
  const now = new Date();
  const recent = await createTask(taskInput([b.studentId], "刚好7天完成"), a);
  await submit(recent.id, b);
  await approve(recent.id);
  const d = await taskDetail(recent.id);
  await db
    .update(s.taskRounds)
    .set({ endedAt: new Date(now.getTime() - 7 * 86400000) })
    .where(eq(s.taskRounds.id, d.rounds[0].id));
  assert.ok(
    (await listMemberTasks(b.studentId, a, undefined, now)).tasks.some(
      (t) => t.id === recent.id,
    ),
  );
  await db
    .update(s.taskRounds)
    .set({ endedAt: new Date(now.getTime() - 7 * 86400000 - 1) })
    .where(eq(s.taskRounds.id, d.rounds[0].id));
  assert.equal(
    (await listMemberTasks(b.studentId, a, undefined, now)).tasks.some(
      (t) => t.id === recent.id,
    ),
    false,
  );
  await commandTask(
    recent.id,
    {
      action: "reopen",
      expectedRevision: d.revision,
      deadline: null,
      claimsOpen: false,
    },
    a,
  );
  const reopened = (await listMemberTasks(b.studentId, a)).tasks.find(
    (t) => t.id === recent.id,
  )!;
  assert.equal(reopened.round, 2);
  assert.equal(reopened.ownStatus, "not_submitted");
  const announcement = await createTask(
    { ...taskInput([], "未领取公告"), kind: "announcement" },
    a,
  );
  const cancelled = await createTask(taskInput([b.studentId], "撤销任务"), a);
  await commandTask(
    cancelled.id,
    {
      action: "cancel",
      expectedRevision: (await taskDetail(cancelled.id)).revision,
    },
    a,
  );
  const summary = await listMemberTasks(b.studentId, a);
  assert.equal(
    summary.tasks.some((t) => [announcement.id, cancelled.id].includes(t.id)),
    false,
  );
});
test("任务微秒更新时间的53项游标分页不丢失同时间任务", async () => {
  const tasks = await db
    .insert(s.collabTasks)
    .values(
      Array.from({ length: 53 }, () => ({
        publisherId: a.studentId,
        kind: "assigned" as const,
        delivery: "individual" as const,
        updatedAt: sql`'2026-10-08T08:00:00.123456Z'::timestamptz`,
      })),
    )
    .returning();
  const rounds = await db
    .insert(s.taskRounds)
    .values(
      tasks.map((t) => ({
        taskId: t.id,
        number: 1,
        title: "分页任务",
        description: "说明",
        directIds: [c.studentId],
      })),
    )
    .returning();
  await db
    .insert(s.taskParticipants)
    .values(
      rounds.map((r) => ({
        roundId: r.id,
        studentId: c.studentId,
        name: c.name,
      })),
    );
  const seen = new Set<number>();
  let cursor: string | undefined;
  do {
    const page = await listMemberTasks(c.studentId, a, cursor);
    page.tasks.forEach((t) => {
      assert.equal(seen.has(t.id), false);
      seen.add(t.id);
    });
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.ok(tasks.every((t) => seen.has(t.id)));
});
test("重复提交限定原任务；完成后原请求仍安全重试，跨任务真实API拒绝", async () => {
  const one = await createTask(taskInput([b.studentId]), a),
    two = await createTask(taskInput([c.studentId]), a);
  const cmd = await submit(one.id, b);
  await approve(one.id);
  await commandTask(one.id, cmd, b);
  const response = await detailRoute.POST(
    request(`/api/tasks/${two.id}`, b, "POST", cmd),
    context(two.id),
  );
  assert.notEqual(response.status, 200);
  assert.equal((await taskDetail(two.id)).submissions.length, 0);
});
test("指派消息提供正确发布者，停用成员不能读写个人记录", async () => {
  const t = await createTask(taskInput([b.studentId]), a);
  const inbox = await notifications(b);
  assert.equal(
    inbox.assignments.find((m) => m.taskId === t.id)?.publisher,
    a.name,
  );
  await db
    .update(s.students)
    .set({ enabled: false })
    .where(eq(s.students.id, b.studentId));
  try {
    await assert.rejects(createWork(body, b), code("UNAUTHORIZED"));
    assert.equal(
      (
        await memberRoute.GET(
          request(`/api/students/${a.studentId}/work`, b),
          context(a.studentId),
        )
      ).status,
      401,
    );
  } finally {
    await db
      .update(s.students)
      .set({ enabled: true })
      .where(eq(s.students.id, b.studentId));
  }
});
