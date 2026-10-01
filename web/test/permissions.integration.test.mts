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
const { auditLogs, courses, courseSnapshots, groupMembers, groups, periods, scheduleVersions, semesters, students, users } = await import("@/db/schema");
const { saveCourse, removeCourse, DuplicateCourseError } = await import("@/lib/course-service");
const { getMemberWeekSchedule } = await import("@/lib/schedule-service");
const { courseInputSchema } = await import("@/lib/course-schema");
const { confirmScheduleImport, previewImageScheduleImport, previewPastedScheduleImport, ScheduleImportError } = await import("@/lib/schedule-import-service");
const { addGroupMember, createGroup, getGroupDirectory, GroupServiceError, renameGroup, transferGroupLeader } = await import("@/lib/group-service");
const { getGroupWeekSchedule } = await import("@/lib/group-schedule-service");

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

test("小组对成员公开，但只有当前组长可以改名和维护成员", async () => {
  const actorA = { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" };
  const actorB = { userId: "ub", studentId: studentB, studentNo: "10002", name: "乙" };
  const group = await createGroup("测试项目组", actorA);
  await addGroupMember(group.id, studentB, actorA);

  const viewedByB = await getGroupDirectory(studentB);
  assert.equal(viewedByB[0].name, "测试项目组");
  assert.equal(viewedByB[0].members.length, 2);
  assert.equal(viewedByB[0].canManage, false);

  const schedule = await getGroupWeekSchedule(group.id, 1, studentB);
  assert.equal(schedule.group.members.length, 2);
  assert.equal(schedule.courses.length, 1);
  assert.equal(schedule.courses[0].name, "乙的课");
  assert.equal(schedule.courses[0].memberName, "乙");

  await assert.rejects(
    () => renameGroup(group.id, "乙不能改的名称", actorB),
    (error: Error) => error instanceof GroupServiceError && error.code === "FORBIDDEN_GROUP_LEADER",
  );
  const renamed = await renameGroup(group.id, "甲修改后的项目组", actorA);
  assert.equal(renamed.name, "甲修改后的项目组");

  await transferGroupLeader(group.id, studentB, actorA);
  const memberships = await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id));
  assert.equal(memberships.find((item) => item.studentId === studentB)?.role, "leader");
  assert.equal(memberships.find((item) => item.studentId === studentA)?.role, "member");
  const [storedGroup] = await db.select().from(groups).where(eq(groups.id, group.id));
  assert.equal(storedGroup.name, "甲修改后的项目组");
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

test("复制表格只生成预览时不写课程或版本", async () => {
  const member = { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" };
  const beforeCourses = await db.select().from(courses).where(eq(courses.studentId, studentA));
  const beforeVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  const preview = await previewPastedScheduleImport(
    "课程\t任课教师\t上课时间/上课地点\n预览课程\t张老师\t1-18周 三[7-8] A201",
    member,
  );
  const afterCourses = await db.select().from(courses).where(eq(courses.studentId, studentA));
  const afterVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.validCourses.length, 1);
  assert.deepEqual(afterCourses, beforeCourses);
  assert.deepEqual(afterVersions, beforeVersions);
});

test("复制表格识别失败时不写课程或版本", async () => {
  const member = { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" };
  const beforeCourses = await db.select().from(courses).where(eq(courses.studentId, studentA));
  const beforeVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  await assert.rejects(
    () => previewPastedScheduleImport("这不是带表头的课表", member),
    (error: Error) => error instanceof ScheduleImportError && error.code === "FILE_INVALID",
  );
  const afterCourses = await db.select().from(courses).where(eq(courses.studentId, studentA));
  const afterVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  assert.deepEqual(afterCourses, beforeCourses);
  assert.deepEqual(afterVersions, beforeVersions);
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

test("粘贴表格确认导入创建 text 来源版本且不影响他人", async () => {
  const imported = [courseInputSchema.parse({ semesterId, name: "粘贴导入课程", weekday: 2, startPeriod: 5, endPeriod: 5, weeks: [2, 4, 6] })];
  const version = await confirmScheduleImport({
    member: { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" },
    source: "text",
    fileName: "粘贴的教务课表",
    imported,
  });
  const [storedVersion] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.id, version.id));
  const otherCourses = await db.select().from(courses).where(eq(courses.studentId, studentB));
  assert.equal(version.versionNo, 3);
  assert.equal(storedVersion.source, "text");
  assert.equal(otherCourses.some((course) => course.name === "乙的课"), true);
});

test("图片草稿预览不写库，确认后创建 image 来源版本且不影响他人", async () => {
  const member = { userId: "ua", studentId: studentA, studentNo: "10001", name: "甲" };
  const beforeVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  const preview = await previewImageScheduleImport([{
    "课程名称": "图片识别课程", "教师": "张老师", "地点": "A203", "星期": "周三",
    "开始节次": "3", "结束节次": "4", "周次": "1-18", "备注": "", "颜色": "#dce8e3",
  }], member, "schedule.png");
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.validCourses.length, 1);
  const afterPreviewVersions = await db.select().from(scheduleVersions).where(eq(scheduleVersions.studentId, studentA));
  assert.deepEqual(afterPreviewVersions, beforeVersions);

  const version = await confirmScheduleImport({ member, source: "image", fileName: "schedule.png", imported: preview.validCourses });
  const [storedVersion] = await db.select().from(scheduleVersions).where(eq(scheduleVersions.id, version.id));
  const otherCourses = await db.select().from(courses).where(eq(courses.studentId, studentB));
  assert.equal(storedVersion.source, "image");
  assert.equal(otherCourses.some((course) => course.name === "乙的课"), true);
});
