import assert from "node:assert/strict";
import test from "node:test";
import { resolveMemberGrade } from "./member-grade.ts";

test("25 开头学号归为大二", () => {
  assert.equal(resolveMemberGrade("2510250877"), "sophomore");
});

test("24 开头学号归为大三", () => {
  assert.equal(resolveMemberGrade("2410250973"), "junior");
});

test("未知或待补学号不静默归类", () => {
  assert.equal(resolveMemberGrade(null), "unknown");
  assert.equal(resolveMemberGrade("2310000000"), "unknown");
});
