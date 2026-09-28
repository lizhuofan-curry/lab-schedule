import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少 POSTGRES_PASSWORD，无法运行性能基线。");
process.env.DATABASE_URL = `postgresql://schedule:${password}@127.0.0.1:5433/schedule_test`;

const { db, sqlClient } = await import("@/db");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { courses, periods, semesters, students, users } = await import("@/db/schema");
const { getDashboardData, getMemberDirectory, getMemberWeekSchedule } = await import("@/lib/schedule-service");
const { queryAvailability } = await import("@/lib/availability-service");

const MEMBER_COUNT = 100;
const COURSES_PER_MEMBER = 100;
const MEASURE_RUNS = 3;
const allWeeks = Array.from({ length: 18 }, (_, index) => index + 1);
const periodTimes = [
  ["08:00:00", "08:45:00"], ["08:55:00", "09:40:00"], ["10:00:00", "10:45:00"],
  ["10:55:00", "11:40:00"], ["11:45:00", "12:30:00"], ["14:05:00", "14:50:00"],
  ["15:00:00", "15:45:00"], ["15:55:00", "16:40:00"], ["17:00:00", "17:45:00"],
  ["17:55:00", "18:40:00"], ["19:10:00", "19:55:00"], ["20:05:00", "20:50:00"],
  ["20:55:00", "21:40:00"],
] as const;

type Measurement = { name: string; medianMs: number; samplesMs: number[]; limitMs: number };

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(name: string, limitMs: number, operation: () => Promise<unknown>): Promise<Measurement> {
  await operation();
  const samplesMs: number[] = [];
  for (let index = 0; index < MEASURE_RUNS; index += 1) {
    const startedAt = performance.now();
    await operation();
    samplesMs.push(Number((performance.now() - startedAt).toFixed(1)));
  }
  return { name, medianMs: median(samplesMs), samplesMs, limitMs };
}

async function resetPerformanceData() {
  await sqlClient`TRUNCATE TABLE courses, audit_logs, schedule_versions, students, semesters, periods, "user", "session", "account", "verification" RESTART IDENTITY CASCADE`;
}

async function seedPerformanceData() {
  const [semester] = await db.insert(semesters).values({
    name: "性能基线学期",
    startDate: "2026-08-31",
    endDate: "2027-01-03",
    weekCount: 18,
    isCurrent: true,
  }).returning({ id: semesters.id });

  await db.insert(periods).values(periodTimes.map(([startTime, endTime], index) => ({
    semesterId: semester.id,
    periodNo: index + 1,
    name: `第${index + 1}节`,
    startTime,
    endTime,
  })));

  const userRows = Array.from({ length: MEMBER_COUNT }, (_, index) => ({
    id: `perf-user-${String(index + 1).padStart(3, "0")}`,
    name: `性能成员${String(index + 1).padStart(3, "0")}`,
    email: `perf-${index + 1}@members.local`,
    username: `${index % 2 === 0 ? "25" : "24"}${String(index + 1).padStart(8, "0")}`,
  }));
  await db.insert(users).values(userRows);
  const memberRows = await db.insert(students).values(userRows.map((user) => ({
    name: user.name,
    studentNo: user.username,
    userId: user.id,
  }))).returning({ id: students.id });

  const courseRows = memberRows.flatMap((member, memberIndex) =>
    Array.from({ length: COURSES_PER_MEMBER }, (_, courseIndex) => {
      const periodNo = (Math.floor(courseIndex / 7) % periodTimes.length) + 1;
      return {
        studentId: member.id,
        semesterId: semester.id,
        name: `性能课程-${memberIndex + 1}-${courseIndex + 1}`,
        teacher: `教师${courseIndex % 20}`,
        location: `测试教室${courseIndex % 30}`,
        weekday: (courseIndex % 7) + 1,
        startPeriod: periodNo,
        endPeriod: periodNo,
        weeks: allWeeks,
      };
    }),
  );
  for (let offset = 0; offset < courseRows.length; offset += 500) {
    await db.insert(courses).values(courseRows.slice(offset, offset + 500));
  }
  return { semesterId: semester.id, memberIds: memberRows.map((member) => member.id) };
}

await migrate(db, { migrationsFolder: "drizzle" });
try {
  await resetPerformanceData();
  const { semesterId, memberIds } = await seedPerformanceData();
  const measurements: Measurement[] = [];

  measurements.push(await measure("100 人成员目录", 500, async () => {
    const result = await getMemberDirectory();
    assert.equal(result.length, MEMBER_COUNT);
  }));
  measurements.push(await measure("单人成员周课表（100 门）", 500, async () => {
    const result = await getMemberWeekSchedule(memberIds[0], semesterId, 4);
    assert.equal(result?.courses.length, COURSES_PER_MEMBER);
  }));
  measurements.push(await measure("课表总览（100 人 / 10000 门）", 2_500, async () => {
    const result = await getDashboardData(memberIds[0], 4);
    assert.equal(result?.members.length, MEMBER_COUNT);
    assert.equal(result?.courses.length, MEMBER_COUNT * COURSES_PER_MEMBER);
  }));
  measurements.push(await measure("10 人共同空闲", 800, async () => {
    const result = await queryAvailability({ weekday: 3, week: 4, studentIds: memberIds.slice(0, 10), minimumMinutes: 45 });
    assert.equal(result.members.length, 10);
  }));
  measurements.push(await measure("100 人共同空闲", 2_500, async () => {
    const result = await queryAvailability({ weekday: 3, week: 4, studentIds: memberIds, minimumMinutes: 45 });
    assert.equal(result.members.length, MEMBER_COUNT);
  }));

  console.table(measurements.map((item) => ({
    查询: item.name,
    中位数毫秒: item.medianMs,
    阈值毫秒: item.limitMs,
    样本毫秒: item.samplesMs.join(", "),
    结果: item.medianMs <= item.limitMs ? "通过" : "超出阈值",
  })));
  const failures = measurements.filter((item) => item.medianMs > item.limitMs);
  if (failures.length > 0) throw new Error(`性能基线未通过：${failures.map((item) => item.name).join("、")}`);
  console.log(`性能基线通过：${MEMBER_COUNT} 名成员、${COURSES_PER_MEMBER} 门/人、共 ${MEMBER_COUNT * COURSES_PER_MEMBER} 门课程。`);
} finally {
  await resetPerformanceData();
  await sqlClient.end();
}
