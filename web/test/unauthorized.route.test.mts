import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { loadEnvFile } from "node:process";

// route 会加载 schedule-service（依赖 db 模块），先准备好连接串；本用例不实际查询数据库。
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
process.env.DATABASE_URL = `postgresql://schedule:${password}@127.0.0.1:5433/schedule_test`;

mock.module("@/lib/server-auth", {
  namedExports: {
    getCurrentMember: async () => null,
    unauthorized: () => Response.json({ code: "UNAUTHORIZED", message: "请先登录。" }, { status: 401 }),
    forbidden: () => Response.json({ code: "FORBIDDEN", message: "无权限。" }, { status: 403 }),
  },
});

mock.module("@/lib/schedule-import-service", {
  namedExports: {
    ScheduleImportError: class ScheduleImportError extends Error {},
    previewScheduleImport: async () => { throw new Error("不应执行"); },
    confirmScheduleImport: async () => { throw new Error("不应执行"); },
  },
});

mock.module("@/lib/henu-sync-service", {
  namedExports: {
    HenuSyncError: class HenuSyncError extends Error {},
    previewHenuSchedule: async () => { throw new Error("不应执行"); },
  },
});

const { GET } = await import("@/app/api/students/[id]/schedule/route");
const importPreviewRoute = await import("@/app/api/my/schedule-import/preview/route");
const importConfirmRoute = await import("@/app/api/my/schedule-import/confirm/route");
const henuSyncRoute = await import("@/app/api/my/henu-sync/route");

test("未登录不能查看成员课表（返回 401）", async () => {
  const request = new Request("http://localhost/api/students/1/schedule?semester=1&week=1");
  const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
  assert.equal(response.status, 401);
});

test("未登录不能读取河大课表", async () => {
  const response = await henuSyncRoute.POST(new Request("http://localhost/api/my/henu-sync", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("未登录不能预览或确认课表导入", async () => {
  const preview = await importPreviewRoute.POST(new Request("http://localhost/api/my/schedule-import/preview", { method: "POST" }));
  const confirm = await importConfirmRoute.POST(new Request("http://localhost/api/my/schedule-import/confirm", { method: "POST" }));
  assert.equal(preview.status, 401);
  assert.equal(confirm.status, 401);
});
