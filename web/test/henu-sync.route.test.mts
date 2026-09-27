import assert from "node:assert/strict";
import test, { mock } from "node:test";

let serviceCalled = false;
mock.module("@/lib/server-auth", {
  namedExports: {
    getCurrentMember: async () => ({ userId: "ua", studentId: 1, studentNo: "10001", name: "甲" }),
    unauthorized: () => Response.json({ code: "UNAUTHORIZED" }, { status: 401 }),
    forbidden: (message: string) => Response.json({ code: "FORBIDDEN", message }, { status: 403 }),
  },
});
mock.module("@/lib/henu-sync-service", {
  namedExports: {
    HenuSyncError: class HenuSyncError extends Error {},
    previewHenuSchedule: async () => { serviceCalled = true; throw new Error("不应执行"); },
  },
});
mock.module("@/lib/schedule-import-service", {
  namedExports: { ScheduleImportError: class ScheduleImportError extends Error {} },
});

const route = await import("@/app/api/my/henu-sync/route");

test("不能请求同步其他学号的河大课表", async () => {
  const response = await route.POST(new Request("http://localhost/api/my/henu-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ studentId: "10002", password: "temporary-secret" }),
  }));
  assert.equal(response.status, 403);
  assert.equal(serviceCalled, false);
});
