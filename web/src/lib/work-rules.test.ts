import test from "node:test";
import assert from "node:assert/strict";
import {
  isRecentCompletion,
  RECENT_WORK_MS,
  workCompletionTime,
} from "./work-rules.ts";
import {
  workCreateSchema,
  workUpdateSchema,
  workQuerySchema,
} from "./work-schema.ts";
const now = new Date("2026-10-08T08:00:00.000Z");
test("近期完成是滚动7天，含起点，跨自然周连续，未来不进入", () => {
  assert.equal(
    isRecentCompletion(new Date(now.getTime() - RECENT_WORK_MS), now),
    true,
  );
  assert.equal(
    isRecentCompletion(new Date(now.getTime() - RECENT_WORK_MS - 1), now),
    false,
  );
  assert.equal(isRecentCompletion(now, now), true);
  assert.equal(isRecentCompletion(new Date(now.getTime() + 1), now), false);
  assert.equal(
    isRecentCompletion(new Date("2026-10-04T23:00:00+08:00"), now),
    true,
  );
  assert.equal(isRecentCompletion(null, now), false);
});
test("完成状态内修改文字保留完成时间，暂停和进行中清除完成时间", () => {
  const completedAt = new Date("2026-09-01T08:00:00Z");
  const previous = { status: "completed" as const, completedAt };
  assert.equal(workCompletionTime(previous, "completed", now), completedAt);
  assert.equal(workCompletionTime(previous, "active", now), null);
  assert.equal(workCompletionTime(previous, "paused", now), null);
});
test("首次完成及再次完成使用新的服务端时间", () => {
  assert.equal(workCompletionTime(null, "completed", now), now);
  assert.equal(
    workCompletionTime(
      { status: "paused", completedAt: null },
      "completed",
      now,
    ),
    now,
  );
  assert.equal(
    workCompletionTime(
      { status: "active", completedAt: null },
      "completed",
      now,
    ),
    now,
  );
});
test("个人输入拒绝伪造所有者、完成时间和附件，默认进行中", () => {
  const input = { title: "  论文阅读  ", description: "阅读方法部分" };
  assert.equal(workCreateSchema.parse(input).status, "active");
  assert.equal(workCreateSchema.parse(input).title, "论文阅读");
  for (const extra of [
    { studentId: 1 },
    { completedAt: now.toISOString() },
    { fileIds: [] },
  ])
    assert.equal(
      workCreateSchema.safeParse({ ...input, ...extra }).success,
      false,
    );
});
test("文字长度、空白状态和过期修订输入均严格校验", () => {
  for (const input of [
    { title: " ", description: "说明" },
    { title: "字".repeat(121), description: "说明" },
    { title: "标题", description: " " },
    { title: "标题", description: "字".repeat(20001) },
    { title: "标题", description: "说明", status: "cancelled" },
  ])
    assert.equal(workCreateSchema.safeParse(input).success, false);
  assert.equal(
    workUpdateSchema.safeParse({
      title: "标题",
      description: "说明",
      status: "active",
      expectedRevision: 0,
    }).success,
    false,
  );
});
test("查询范围和长度受限，不能注入额外所有者或日期", () => {
  assert.equal(workQuerySchema.parse({}).scope, "recent");
  for (const input of [
    { scope: "history" },
    { scope: "all", studentId: 1 },
    { cursor: "x".repeat(241) },
    { now: now.toISOString() },
  ])
    assert.equal(workQuerySchema.safeParse(input).success, false);
});
