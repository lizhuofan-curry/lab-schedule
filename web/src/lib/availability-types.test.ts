import assert from "node:assert/strict";
import test from "node:test";
import { addRangeTimes, calculateAvailability, resolveTeachingDate } from "./availability-types.ts";

const semester = { id: 1, name: "测试学期", startDate: "2026-08-31", endDate: "2027-01-03", weekCount: 18 };

test("单双周物化后只占用目标周实际传入的课程", () => {
  const oddWeek = calculateAvailability([1], [1, 2, 3], [{ studentId: 1, startPeriod: 2, endPeriod: 2 }], 1);
  const evenWeek = calculateAvailability([1], [1, 2, 3], [], 1);
  assert.deepEqual(oddWeek.commonFreePeriods, [1, 3]);
  assert.deepEqual(evenWeek.commonFreePeriods, [1, 2, 3]);
});

test("被占用节次会切断连续空闲区间", () => {
  const result = calculateAvailability([1], [1, 2, 3, 4, 5], [{ studentId: 1, startPeriod: 3, endPeriod: 3 }], 2);
  assert.deepEqual(result.ranges, [{ startPeriod: 1, endPeriod: 2 }, { startPeriod: 4, endPeriod: 5 }]);
});

test("多人共同空闲取所有成员占用节次的并集补集", () => {
  const result = calculateAvailability([1, 2], [1, 2, 3, 4], [
    { studentId: 1, startPeriod: 1, endPeriod: 1 },
    { studentId: 2, startPeriod: 3, endPeriod: 3 },
  ], 1);
  assert.deepEqual(result.commonFreePeriods, [2, 4]);
  assert.deepEqual(result.allDayFreeStudentIds, []);
});

test("学期外日期不计算，学期内日期解析教学周和星期", () => {
  assert.equal(resolveTeachingDate("2027-01-04", semester), null);
  assert.deepEqual(resolveTeachingDate("2026-09-27", semester), { week: 4, weekday: 7 });
});

test("空闲分钟数按真实课时累加，不把课间计入可用时长", () => {
  const [range] = addRangeTimes([{ startPeriod: 1, endPeriod: 2 }], [
    { periodNo: 1, startTime: "08:00", endTime: "08:45" },
    { periodNo: 2, startTime: "08:55", endTime: "09:40" },
  ]);
  assert.deepEqual(range, { startPeriod: 1, endPeriod: 2, startTime: "08:00", endTime: "09:40", durationMinutes: 90 });
});
