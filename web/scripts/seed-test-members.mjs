import postgres from "postgres";
import { loadEnvFile } from "node:process";

// 从 .env 读取数据库密码，连本机 loopback 映射（127.0.0.1:5433）访问生产库。
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少 POSTGRES_PASSWORD，请在 .env 中设置。");

const sql = postgres(`postgresql://schedule:${password}@127.0.0.1:5433/schedule`, { max: 1, prepare: false });

const COUNT = 10;

try {
  for (let i = 1; i <= COUNT; i += 1) {
    const name = `测试成员${String(i).padStart(2, "0")}`;
    const studentNo = `test${String(i).padStart(4, "0")}`;
    await sql`
      insert into students (name, student_no, enabled)
      values (${name}, ${studentNo}, true)
      on conflict (student_no) do nothing
    `;
  }
  console.log(`已导入 ${COUNT} 个测试成员（学号 test0001–test${String(COUNT).padStart(4, "0")}）。`);
} finally {
  await sql.end();
}
