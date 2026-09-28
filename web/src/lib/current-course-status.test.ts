import assert from "node:assert/strict";
import test from "node:test";
import { findCurrentCourse, getDefaultScheduleWeek, getShanghaiClock, type MemberCourse } from "./current-course-status.ts";

const semester = { id: 1, name: "测试学期", startDate: "2026-08-31", endDate: "2027-01-03", weekCount: 18 };
const periods = [
  { periodNo: 1, name: "第1节", startTime: "08:00:00", endTime: "08:45:00" },
  { periodNo: 2, name: "第2节", startTime: "08:55:00", endTime: "09:40:00" },
];
const course: MemberCourse = {
  id: 1, studentId: 24, semesterId: 1, name: "计算机网络", teacher: null, location: null,
  weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [5], note: null, color: "#fff",
};

test("北京时间转换不受运行服务器时区影响", () => {
  assert.deepEqual(getShanghaiClock(new Date("2026-09-28T00:30:00.000Z")), {
    date: "2026-09-28", dateLabel: "2026/09/28", timeLabel: "08:30:00",
    secondsOfDay: 8 * 3600 + 30 * 60, weekday: 1, weekdayLabel: "周一",
  });
});

test("只有当前周次、星期和上课时间同时匹配才显示有课", () => {
  assert.equal(findCurrentCourse({ now: new Date("2026-09-28T00:30:00.000Z"), semester, periods, courses: [course], studentId: 24 })?.name, "计算机网络");
  assert.equal(findCurrentCourse({ now: new Date("2026-09-28T02:00:00.000Z"), semester, periods, courses: [course], studentId: 24 }), null);
  assert.equal(findCurrentCourse({ now: new Date("2026-09-29T00:30:00.000Z"), semester, periods, courses: [course], studentId: 24 }), null);
});

test("课表默认定位当前教学周，学期外定位首周或末周", () => {
  assert.equal(getDefaultScheduleWeek(new Date("2026-09-28T08:00:00.000Z"), semester), 5);
  assert.equal(getDefaultScheduleWeek(new Date("2026-08-01T08:00:00.000Z"), semester), 1);
  assert.equal(getDefaultScheduleWeek(new Date("2027-02-01T08:00:00.000Z"), semester), 18);
});
