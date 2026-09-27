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

const { GET } = await import("@/app/api/students/[id]/schedule/route");

test("未登录不能查看成员课表（返回 401）", async () => {
  const request = new Request("http://localhost/api/students/1/schedule?semester=1&week=1");
  const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
  assert.equal(response.status, 401);
});
