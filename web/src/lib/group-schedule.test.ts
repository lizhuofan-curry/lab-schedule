import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupLoadCells, groupLoadLevel, summarizeGroupLoad, type GroupScheduleCourse } from "./group-schedule.ts";

const members = [{ studentId: 1, name: "甲" }, { studentId: 2, name: "乙" }, { studentId: 3, name: "丙" }];
const periods = [1, 2, 3].map((periodNo) => ({ periodNo, name: `第${periodNo}节`, startTime: "08:00:00", endTime: "08:45:00" }));
const course = (input: Partial<GroupScheduleCourse> & Pick<GroupScheduleCourse, "id" | "studentId" | "memberName">): GroupScheduleCourse => ({
  semesterId: 1,
  name: "测试课程",
  teacher: null,
  location: null,
  weekday: 1,
  startPeriod: 1,
  endPeriod: 2,
  weeks: [1],
  note: null,
  color: "#fff",
  ...input,
});

test("小组忙碌格按成员去重而不是按课程数计数", () => {
  const cells = buildGroupLoadCells(members, [
    course({ id: 1, studentId: 1, memberName: "甲" }),
    course({ id: 2, studentId: 1, memberName: "甲", name: "冲突课程" }),
    course({ id: 3, studentId: 2, memberName: "乙", startPeriod: 2, endPeriod: 3 }),
  ], periods);
  const first = cells.find((cell) => cell.weekday === 1 && cell.periodNo === 1);
  const second = cells.find((cell) => cell.weekday === 1 && cell.periodNo === 2);
  assert.equal(first?.busyCount, 1);
  assert.deepEqual(first?.busyMemberIds, [1]);
  assert.equal(second?.busyCount, 2);
});

test("忙碌强度按小组人数分成四级", () => {
  assert.equal(groupLoadLevel(0, 4), 0);
  assert.equal(groupLoadLevel(1, 4), 1);
  assert.equal(groupLoadLevel(2, 4), 2);
  assert.equal(groupLoadLevel(3, 4), 3);
  assert.equal(groupLoadLevel(4, 4), 4);
});

test("汇总返回全员空闲格数和最繁忙格", () => {
  const cells = buildGroupLoadCells(members, [
    course({ id: 1, studentId: 1, memberName: "甲" }),
    course({ id: 2, studentId: 2, memberName: "乙", startPeriod: 2, endPeriod: 2 }),
  ], periods);
  const summary = summarizeGroupLoad(cells);
  assert.equal(summary.busiest?.weekday, 1);
  assert.equal(summary.busiest?.periodNo, 2);
  assert.equal(summary.busiest?.busyCount, 2);
  assert.equal(summary.allFreeCount, 19);
});
