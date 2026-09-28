import assert from "node:assert/strict";
import test from "node:test";
import { resolveMemberGrade } from "./member-grade.ts";

test("25 开头学号归为大二", () => {
  assert.equal(resolveMemberGrade("2510250877"), "sophomore");
});

test("24 开头学号归为大三", () => {
  assert.equal(resolveMemberGrade("2410250973"), "junior");
});

test("其他学号或待补学号归入研究生", () => {
  assert.equal(resolveMemberGrade(null), "postgraduate");
  assert.equal(resolveMemberGrade("2310000000"), "postgraduate");
});
