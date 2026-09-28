import postgres from "postgres";
import { loadEnvFile } from "node:process";

// 删除 seed-test-members.mjs 导入的测试成员及其关联数据（课程、审计、账号）。
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少 POSTGRES_PASSWORD，请在 .env 中设置。");

const sql = postgres(`postgresql://schedule:${password}@127.0.0.1:5433/schedule`, { max: 1, prepare: false });

try {
  await sql.begin(async (tx) => {
    const members = await tx`select id, user_id from students where student_no like 'test%'`;
    const memberIds = members.map((member) => member.id);
    const userIds = members.map((member) => member.user_id).filter(Boolean);

    let coursesDeleted = 0;
    let auditsDeleted = 0;
    let versionsDeleted = 0;
    if (memberIds.length > 0) {
      const deleted = await tx`delete from courses where student_id = any(${memberIds}) returning id`;
      coursesDeleted = deleted.length;
    }
    if (userIds.length > 0) {
      const deleted = await tx`delete from audit_logs where actor_user_id = any(${userIds}) returning id`;
      auditsDeleted = deleted.length;
    }
    if (memberIds.length > 0) {
      const deleted = await tx`delete from schedule_versions where student_id = any(${memberIds}) returning id`;
      versionsDeleted = deleted.length;
    }
    if (memberIds.length > 0) {
      await tx`delete from students where id = any(${memberIds})`;
    }
    if (userIds.length > 0) {
      await tx`delete from "user" where id = any(${userIds})`;
    }

    console.log(`已删除：测试成员 ${members.length} 人、测试账号 ${userIds.length} 个、课程 ${coursesDeleted} 门、版本 ${versionsDeleted} 个、审计 ${auditsDeleted} 条。`);
  });
} finally {
  await sql.end();
}
