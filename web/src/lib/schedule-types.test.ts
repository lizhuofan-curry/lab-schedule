import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeks, describeWeeks } from "./schedule-types.ts";

test("buildWeeks 把每周范围展开成具体周次数组", () => {
  assert.deepEqual(buildWeeks(1, 5, "all"), [1, 2, 3, 4, 5]);
});

test("buildWeeks 正确展开单双周", () => {
  assert.deepEqual(buildWeeks(1, 8, "odd"), [1, 3, 5, 7]);
  assert.deepEqual(buildWeeks(1, 8, "even"), [2, 4, 6, 8]);
});

test("describeWeeks 展示连续周与单双周", () => {
  assert.equal(describeWeeks([1, 2, 3, 4]), "第 1–4 周");
  assert.equal(describeWeeks([1, 3, 5, 7]), "第 1–7 周（单周）");
  assert.equal(describeWeeks([2, 4, 6, 8]), "第 2–8 周（双周）");
});
