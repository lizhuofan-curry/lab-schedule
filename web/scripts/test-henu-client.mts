import { HenuClient } from "../src/lib/henu-client.ts";
import { parseScheduleGrid } from "../src/lib/henu-schedule-parse.ts";

// 验证河大登录 + 课表抓取：HENU_STUDENT_ID=学号 HENU_PASSWORD=密码 node --import tsx scripts/test-henu-client.mts
const username = process.env.HENU_STUDENT_ID?.trim();
const password = process.env.HENU_PASSWORD;
if (!username || !password) {
  console.error("请设置环境变量：HENU_STUDENT_ID=学号 HENU_PASSWORD=密码");
  process.exit(1);
}

const client = new HenuClient();
try {
  console.log("正在登录统一身份认证…");
  await client.login(username, password);
  console.log("✅ 登录成功\n");

  const schedule = await client.fetchSchedule();
  const courses = parseScheduleGrid(schedule.gridHtml);
  console.log(`✅ 已读取 ${schedule.context.xn || "未知学年"} / 学期代码 ${schedule.context.xq || "未知"}`);
  console.log(`✅ 解析到 ${courses.length} 门课程`);
} catch (error) {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
}
