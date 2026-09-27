import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { loadEnvFile } from "node:process";

// 在导入任何依赖数据库的模块之前，把连接指向独立测试库，避免污染生产数据。
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少 POSTGRES_PASSWORD，无法运行集成测试。");
process.env.DATABASE_URL = `postgresql://schedule:${password}@127.0.0.1:5433/schedule_test`;

const { db, sqlClient } = await import("@/db");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { and, eq } = await import("drizzle-orm");
const { auditLogs, courses, courseSnapshots, periods, scheduleVersions, semesters, students, users } = await import("@/db/schema");
const { saveCourse, removeCourse, DuplicateCourseError } = await import("@/lib/course-service");
const { getMemberWeekSchedule } = await import("@/lib/schedule-service");
const { courseInputSchema } = await import("@/lib/course-schema");
const { confirmScheduleImport } = await import("@/lib/schedule-import-service");

let studentA = 0;
let studentB = 0;
let semesterId = 0;
let courseBId = 0;

before(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await sqlClient`TRUNCATE TABLE courses, audit_logs, students, semesters, periods, "user", "session", "account", "verification" RESTART IDENTITY CASCADE`;

  await db.insert(users).values([
    { id: "ua", name: "甲", email: "10001@members.local", username: "10001" },
    { id: "ub", name: "乙", email: "10002@members.local", username: "10002" },
  ]);

  const [semester] = await db.insert(semesters).values({
    name: "测试学期", startDate: "2026-08-31", endDate: "2027-01-03", weekCount: 18, isCurrent: true,
  }).returning({ id: semesters.id });
  semesterId = semester.id;

  await db.insert(periods).values(
    Array.from({ length: 13 }, (_, index) => ({
      semesterId, periodNo: index + 1, name: `第${index + 1}节`, startTime: "08:00:00", endTime: "08:45:00",
    })),
  );

  const [a] = await db.insert(students).values({ name: "甲", studentNo: "10001", userId: "ua" }).returning({ id: students.id });
  const [b] = await db.insert(students).values({ name: "乙", studentNo: "10002", userId: "ub" }).returning({ id: students.id });
  studentA = a.id;
  studentB = b.id;

  const [courseB] = await db.insert(courses).values({
    studentId: studentB, semesterId, name: "乙的课", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3],
  }).returning({ id: courses.id });
  courseBId = courseB.id;
});

after(async () => {
  await sqlClient.end();
});

test("登录成员可查看任意启用成员课表（A 查看 B）", async () => {
  const schedule = await getMemberWeekSchedule(studentB, semesterId, 1);
  assert.ok(schedule, "应返回 B 的课表");
  assert.equal(schedule.courses.length, 1);
  assert.equal(schedule.courses[0].name, "乙的课");
});

test("成员不能修改他人课程（A 改 B 被拒绝）", async () => {
  const input = courseInputSchema.parse({ semesterId, name: "篡改", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] });
  await assert.rejects(
    () => saveCourse({ input, studentId: studentA, actorUserId: "ua", courseId: courseBId }),
    (error: Error) => error.message === "FORBIDDEN_OWNER",
  );
});

test("成员不能删除他人课程（A 删 B 被拒绝）", async () => {
  await assert.rejects(
    () => removeCourse({ courseId: courseBId, studentId: studentA, actorUserId: "ua" }),
    (error: Error) => error.message === "FORBIDDEN_OWNER",
  );
});

test("成员可修改自己的课程", async () => {
  const [own] = await db.insert(courses).values({
    studentId: studentA, semesterId, name: "甲的课", weekday: 2, startPeriod: 3, endPeriod: 4, weeks: [1],
  }).returning({ id: courses.id });
  const input = courseInputSchema.parse({ semesterId, name: "甲的课（改）", weekday: 2, startPeriod: 3, endPeriod: 4, weeks: [1, 2] });
  const updated = await saveCourse({ input, studentId: studentA, actorUserId: "ua", courseId: own.id });
  assert.equal(updated.name, "甲的课（改）");
});

test("成员保存完全重复课程被拒（BR-06）", async () => {
  const input = courseInputSchema.parse({ semesterId, name: "乙的课", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] });
  await assert.rejects(
    () => saveCourse({ input, studentId: studentB, actorUserId: "ub" }),
    (error: Error) => error instanceof DuplicateCourseError,
  );
});

test("批量导入只替换当前成员课表，并创建完整历史快照", async () => {
  const imported = [courseInputSchema.parse({ semesterId, name: "甲导入的新课", location: "A101", weekday: 3, startPeriod: 7, endPeriod: 8, weeks: [1, 2, 3] })];
  const version = await confirmScheduleImport({
    member: { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" },
    source: "xlsx",
    fileName: "test.xlsx",
    imported,
  });
  assert.equal(version.versionNo, 1);
  const ownCourses = await db.select().from(courses).where(eq(courses.studentId, studentA));
  const otherCourses = await db.select().from(courses).where(eq(courses.studentId, studentB));
  const versions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  const snapshots = await db.select().from(courseSnapshots).where(eq(courseSnapshots.scheduleVersionId, version.id));
  assert.deepEqual(ownCourses.map((course) => course.name), ["甲导入的新课"]);
  assert.equal(otherCourses.some((course) => course.name === "乙的课"), true);
  assert.equal(versions.length, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].location, "A101");
});

test("河大确认导入复用本人整表事务，并且审计中不包含密码", async () => {
  const imported = [courseInputSchema.parse({ semesterId, name: "河大同步课程", location: "综合楼101", weekday: 4, startPeriod: 1, endPeriod: 2, weeks: [1, 3, 5] })];
  const version = await confirmScheduleImport({
    member: { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" },
    source: "henu",
    fileName: "河大教务系统",
    imported,
  });
  assert.equal(version.versionNo, 2);
  const [storedVersion] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.id, version.id));
  const logs = await db.select().from(auditLogs).where(and(
    eq(auditLogs.entityType, "schedule_version"),
    eq(auditLogs.entityId, String(version.id)),
  ));
  const otherCourses = await db.select().from(courses).where(eq(courses.studentId, studentB));
  assert.equal(storedVersion.source, "henu");
  assert.equal(otherCourses.some((course) => course.name === "乙的课"), true);
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).toLowerCase().includes("password"), false);
});
