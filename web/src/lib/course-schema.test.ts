import assert from "node:assert/strict";
import test from "node:test";
import { courseInputSchema } from "./course-schema.ts";

const valid = {
  semesterId: 1,
  name: "高等数学",
  weekday: 1,
  startPeriod: 1,
  endPeriod: 2,
  weeks: [1, 2, 3],
};

test("合法课程输入通过校验，颜色缺省为默认值", () => {
  const parsed = courseInputSchema.safeParse(valid);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.color, "#dce8e3");
});

test("星期超出 1-7 被拒绝", () => {
  assert.equal(courseInputSchema.safeParse({ ...valid, weekday: 0 }).success, false);
  assert.equal(courseInputSchema.safeParse({ ...valid, weekday: 8 }).success, false);
});

test("结束节次早于开始节次被拒绝", () => {
  assert.equal(courseInputSchema.safeParse({ ...valid, startPeriod: 3, endPeriod: 2 }).success, false);
});

test("周次为空或重复被拒绝", () => {
  assert.equal(courseInputSchema.safeParse({ ...valid, weeks: [] }).success, false);
  assert.equal(courseInputSchema.safeParse({ ...valid, weeks: [1, 1, 2] }).success, false);
});

test("课程名为空白被拒绝", () => {
  assert.equal(courseInputSchema.safeParse({ ...valid, name: "   " }).success, false);
});

test("颜色格式非法被拒绝", () => {
  assert.equal(courseInputSchema.safeParse({ ...valid, color: "red" }).success, false);
});
