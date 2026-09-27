import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRegistration } from "./registration-summary.ts";

test("summarizes all registration states", () => {
  const result = summarizeRegistration([
    { id: 1, name: "已注册", studentNo: "2510000001", userId: "user-1" },
    { id: 2, name: "未注册", studentNo: "2510000002", userId: null },
    { id: 3, name: "待补学号", studentNo: null, userId: null },
  ]);

  assert.equal(result.total, 3);
  assert.equal(result.registered, 1);
  assert.equal(result.pending, 2);
  assert.equal(result.missingStudentNo, 1);
  assert.equal(result.rate, 33);
  assert.deepEqual(result.members.map((member) => member.status), [
    "registered",
    "pending",
    "missing_student_no",
  ]);
});

test("returns zero rate for an empty roster", () => {
  const result = summarizeRegistration([]);
  assert.equal(result.rate, 0);
  assert.equal(result.total, 0);
});
