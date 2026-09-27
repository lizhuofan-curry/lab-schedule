import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少 POSTGRES_PASSWORD，无法运行 HTTP 集成测试。");
process.env.DATABASE_URL = `postgresql://schedule:${password}@127.0.0.1:5433/schedule_test`;
process.env.BETTER_AUTH_SECRET = "http-integration-test-secret-at-least-32-characters";

let dispatch: (request: Request) => Promise<Response> = async () => new Response("Test server is starting", { status: 503 });

async function toRequest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${request.headers.host}${request.url}`, {
    method: request.method,
    headers,
    body,
    duplex: body ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });
}

async function sendResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    await sendResponse(await dispatch(await toRequest(request)), response);
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : "UNKNOWN_TEST_SERVER_ERROR");
  }
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${address.port}`;
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_TRUSTED_ORIGINS = origin;

const { db, sqlClient } = await import("@/db");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { courses, periods, semesters, students, users } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { auth } = await import("@/lib/auth");
const scheduleRoute = await import("@/app/api/students/[id]/schedule/route");
const courseRoute = await import("@/app/api/my/courses/[id]/route");

dispatch = async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/auth/")) return auth.handler(request);

  const scheduleMatch = url.pathname.match(/^\/api\/students\/(\d+)\/schedule$/);
  if (scheduleMatch && request.method === "GET") {
    return scheduleRoute.GET(request, { params: Promise.resolve({ id: scheduleMatch[1] }) });
  }

  const courseMatch = url.pathname.match(/^\/api\/my\/courses\/(\d+)$/);
  if (courseMatch && request.method === "PATCH") {
    return courseRoute.PATCH(request, { params: Promise.resolve({ id: courseMatch[1] }) });
  }
  if (courseMatch && request.method === "DELETE") {
    return courseRoute.DELETE(request, { params: Promise.resolve({ id: courseMatch[1] }) });
  }

  return Response.json({ code: "NOT_FOUND" }, { status: 404 });
};

type RegistrationResult = { response: Response; cookie: string | null };

async function register(name: string, studentNo: string, passwordValue: string): Promise<RegistrationResult> {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      name,
      username: studentNo,
      email: `${studentNo}@members.local`,
      password: passwordValue,
    }),
  });
  const setCookie = response.headers.get("set-cookie");
  return { response, cookie: setCookie ? setCookie.split(";", 1)[0] : null };
}

let semesterId = 0;
let studentB = 0;
let courseB = 0;
let cookieA = "";

before(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await sqlClient`TRUNCATE TABLE courses, audit_logs, students, semesters, periods, "user", "session", "account", "verification" RESTART IDENTITY CASCADE`;

  const [semester] = await db.insert(semesters).values({
    name: "HTTP 测试学期", startDate: "2026-08-31", endDate: "2027-01-03", weekCount: 18, isCurrent: true,
  }).returning({ id: semesters.id });
  semesterId = semester.id;
  await db.insert(periods).values(Array.from({ length: 13 }, (_, index) => ({
    semesterId, periodNo: index + 1, name: `第${index + 1}节`, startTime: "08:00:00", endTime: "08:45:00",
  })));
  await db.insert(students).values([
    { name: "甲", studentNo: "20001" },
    { name: "乙", studentNo: "20002" },
    { name: "丙", studentNo: "20003" },
  ]);

  const registrationA = await register("甲", "20001", "password-a-123");
  const registrationB = await register("乙", "20002", "password-b-123");
  assert.equal(registrationA.response.status, 200);
  assert.equal(registrationB.response.status, 200);
  assert.ok(registrationA.cookie, "A 注册后应获得会话 Cookie");
  cookieA = registrationA.cookie;

  const [memberB] = await db.select({ id: students.id }).from(students).where(eq(students.studentNo, "20002")).limit(1);
  studentB = memberB.id;
  const [created] = await db.insert(courses).values({
    studentId: studentB, semesterId, name: "乙的课", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3],
  }).returning({ id: courses.id });
  courseB = created.id;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await sqlClient.end();
});

test("HTTP：A 登录后可查看 B 的课表", async () => {
  const response = await fetch(`${origin}/api/students/${studentB}/schedule?semester=${semesterId}&week=1`, {
    headers: { cookie: cookieA },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { courses: Array<{ name: string }> } };
  assert.equal(body.data.courses[0]?.name, "乙的课");
});

test("HTTP：A 不能修改 B 的课程", async () => {
  const response = await fetch(`${origin}/api/my/courses/${courseB}`, {
    method: "PATCH",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ semesterId, name: "越权修改", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1] }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { code: string }).code, "FORBIDDEN_OWNER");
});

test("HTTP：A 不能删除 B 的课程", async () => {
  const response = await fetch(`${origin}/api/my/courses/${courseB}`, {
    method: "DELETE",
    headers: { cookie: cookieA },
  });
  assert.equal(response.status, 403);
});

test("HTTP：未登录不能查看成员课表", async () => {
  const response = await fetch(`${origin}/api/students/${studentB}/schedule?semester=${semesterId}&week=1`);
  assert.equal(response.status, 401);
});

test("HTTP：同一名册项并发注册只能成功一次", async () => {
  const attempts = await Promise.all([
    register("丙", "20003", "password-c-123"),
    register("丙", "20003", "password-c-456"),
  ]);
  assert.equal(attempts.filter(({ response }) => response.status === 200).length, 1);

  const boundRoster = await db.select({ userId: students.userId }).from(students).where(eq(students.studentNo, "20003"));
  const createdUsers = await db.select({ id: users.id }).from(users).where(eq(users.username, "20003"));
  assert.equal(boundRoster.length, 1);
  assert.ok(boundRoster[0].userId);
  assert.equal(createdUsers.length, 1);
});
