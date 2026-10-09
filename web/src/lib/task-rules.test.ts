import assert from "node:assert/strict";
import test from "node:test";
import {
  beijingDeadline,
  beijingInput,
  taskIsComplete,
  taskSubject,
} from "./task-rules.ts";
import { MAX_TASK_FILE_BYTES, validateTaskFile, taskFilePreviewType } from "./task-file-rules.ts";
import { taskCreateSchema, taskCommandSchema, notificationDeleteSchema } from "./task-schema.ts";
test("消息清理确认集合拒绝未确认、伪造接收人、重复及越界ID", () => {
  assert.deepEqual(notificationDeleteSchema.parse({ ids: [1, 2], confirm: true }).ids, [1, 2]);
  for (const body of [
    { ids: [], confirm: true }, { ids: [1] }, { ids: [1], confirm: false },
    { ids: [1], confirm: true, recipientId: 2 }, { ids: [1, 1], confirm: true },
    { ids: [0], confirm: true }, { ids: [1.5], confirm: true },
    { ids: [Number.MAX_SAFE_INTEGER + 1], confirm: true },
    { ids: Array.from({ length: 10001 }, (_, i) => i + 1), confirm: true },
  ]) assert.equal(notificationDeleteSchema.safeParse(body).success, false);
});
test("预览仅允许固定安全MIME，大小写扩展一致且Office和HTML不能内联", () => {
  assert.equal(taskFilePreviewType("论文.PDF"), "application/pdf");
  assert.equal(taskFilePreviewType("图.jpeg"), "image/jpeg");
  assert.equal(taskFilePreviewType("说明.markdown"), "text/plain; charset=utf-8");
  for (const name of ["x.html", "x.svg", "x.docx", "x.exe", "x"])
    assert.equal(taskFilePreviewType(name), null);
});
test("公告需结束领取且空名单不能完成", () => {
  assert.equal(
    taskIsComplete(
      "announcement",
      true,
      "shared",
      ["shared"],
      new Set(["shared"]),
    ),
    false,
  );
  assert.equal(
    taskIsComplete("announcement", false, "shared", [], new Set(["shared"])),
    false,
  );
  assert.equal(
    taskIsComplete(
      "announcement",
      false,
      "shared",
      ["shared"],
      new Set(["shared"]),
    ),
    true,
  );
});
test("逐人完成基于当前人员和重新加入次数", () => {
  const first = taskSubject("individual", 12, 1),
    rejoined = taskSubject("individual", 12, 2);
  assert.equal(
    taskIsComplete(
      "assigned",
      false,
      "individual",
      [rejoined],
      new Set([first]),
    ),
    false,
  );
  assert.equal(
    taskIsComplete(
      "assigned",
      false,
      "individual",
      [first, "other"],
      new Set([first]),
    ),
    false,
  );
  assert.equal(
    taskIsComplete("assigned", false, "individual", [first], new Set([first])),
    true,
  );
});
test("任务截止时间使用北京时间并支持清空", () => {
  assert.equal(beijingDeadline("2026-10-08T08:00"), "2026-10-08T00:00:00.000Z");
  assert.equal(beijingInput("2026-10-08T00:00:00Z"), "2026-10-08T08:00");
  assert.equal(beijingDeadline(""), null);
});
test("附件白名单、签名、非空与10MB边界", () => {
  assert.throws(
    () => validateTaskFile("attack.exe", new Uint8Array([1])),
    /不支持/,
  );
  assert.throws(
    () => validateTaskFile("fake.pdf", new TextEncoder().encode("fake")),
    /内容/,
  );
  assert.throws(
    () => validateTaskFile("null.txt", new Uint8Array([0])),
    /内容/,
  );
  assert.throws(() => validateTaskFile("empty.txt", new Uint8Array()), /非空/);
  validateTaskFile("limit.txt", new Uint8Array(MAX_TASK_FILE_BYTES).fill(65));
  assert.throws(
    () =>
      validateTaskFile("large.txt", new Uint8Array(MAX_TASK_FILE_BYTES + 1)),
    /10MB/,
  );
  validateTaskFile("result.pdf", new TextEncoder().encode("%PDF-1.7\n"));
  validateTaskFile("结果.md", new TextEncoder().encode("# 实验结果"));
});
test("任务输入拒绝伪造发布者、重复目标和无目标指定", () => {
  const input = {
    title: "任务",
    description: "要求",
    kind: "assigned",
    delivery: "individual",
    directIds: [1],
    groupIds: [],
    deadline: null,
    capacity: null,
    fileIds: [],
  };
  assert.equal(taskCreateSchema.safeParse(input).success, true);
  assert.equal(
    taskCreateSchema.safeParse({ ...input, publisherId: 2 }).success,
    false,
  );
  assert.equal(
    taskCreateSchema.safeParse({ ...input, directIds: [1, 1] }).success,
    false,
  );
  assert.equal(
    taskCreateSchema.safeParse({ ...input, directIds: [] }).success,
    false,
  );
});
test("成果输入拒绝替他人提交、脚本链接及超过5个附件", () => {
  const input = {
    action: "submit",
    roundId: 1,
    expectedVersion: 0,
    requestKey: "11111111-1111-4111-8111-111111111111",
    body: "",
    links: ["https://example.com"],
    fileIds: [],
  };
  assert.equal(taskCommandSchema.safeParse(input).success, true);
  assert.equal(
    taskCommandSchema.safeParse({ ...input, studentId: 2 }).success,
    false,
  );
  assert.equal(
    taskCommandSchema.safeParse({ ...input, links: ["javascript:alert(1)"] })
      .success,
    false,
  );
  assert.equal(
    taskCommandSchema.safeParse({
      ...input,
      fileIds: Array.from(
        { length: 6 },
        (_, i) => `11111111-1111-4111-8111-11111111111${i}`,
      ),
    }).success,
    false,
  );
});
