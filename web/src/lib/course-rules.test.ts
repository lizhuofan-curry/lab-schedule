import assert from "node:assert/strict";
import test from "node:test";
import { coursesConflict, coursesDuplicate, normalizeWeeks } from "./course-rules.ts";

test("同星期、周次相交且节次重叠判为冲突", () => {
  const existing = { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] };
  const candidate = { weekday: 1, startPeriod: 2, endPeriod: 3, weeks: [2, 3, 4] };
  assert.equal(coursesConflict(existing, candidate), true);
});

test("星期不同不冲突", () => {
  const existing = { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] };
  const candidate = { weekday: 2, startPeriod: 1, endPeriod: 2, weeks: [1] };
  assert.equal(coursesConflict(existing, candidate), false);
});

test("周次无交集不冲突（单双周错开）", () => {
  const odd = { weekday: 3, startPeriod: 1, endPeriod: 2, weeks: [1, 3, 5] };
  const even = { weekday: 3, startPeriod: 1, endPeriod: 2, weeks: [2, 4, 6] };
  assert.equal(coursesConflict(odd, even), false);
});

test("节次区间不重叠不冲突", () => {
  const before = { weekday: 5, startPeriod: 1, endPeriod: 2, weeks: [1] };
  const after = { weekday: 5, startPeriod: 3, endPeriod: 4, weeks: [1] };
  assert.equal(coursesConflict(before, after), false);
});

test("节次边界相接视为重叠（冲突）", () => {
  const existing = { weekday: 2, startPeriod: 1, endPeriod: 2, weeks: [1] };
  const candidate = { weekday: 2, startPeriod: 2, endPeriod: 3, weeks: [1] };
  assert.equal(coursesConflict(existing, candidate), true);
});

test("完全相同课程也满足冲突规则", () => {
  const existing = { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] };
  const candidate = { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] };
  assert.equal(coursesConflict(existing, candidate), true);
});

test("normalizeWeeks 去重并升序，且不修改原数组", () => {
  const input = [3, 1, 3, 2, 1];
  const original = [...input];
  assert.deepEqual(normalizeWeeks(input), [1, 2, 3]);
  assert.deepEqual(input, original);
});

test("normalizeWeeks 保持单元素不变", () => {
  assert.deepEqual(normalizeWeeks([5]), [5]);
});

test("课程名、星期、节次、周次完全一致判为重复", () => {
  const a = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] };
  const b = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] };
  assert.equal(coursesDuplicate(a, b), true);
});

test("课程名不同不算重复", () => {
  const a = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] };
  const b = { name: "线代", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] };
  assert.equal(coursesDuplicate(a, b), false);
});

test("周次不同不算重复", () => {
  const a = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3] };
  const b = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [2, 4] };
  assert.equal(coursesDuplicate(a, b), false);
});

test("节次不同不算重复", () => {
  const a = { name: "高数", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] };
  const b = { name: "高数", weekday: 1, startPeriod: 3, endPeriod: 4, weeks: [1] };
  assert.equal(coursesDuplicate(a, b), false);
});
