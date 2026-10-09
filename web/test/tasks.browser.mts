import { chromium, expect } from "@playwright/test";
import type { Page, BrowserContext } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少本地测试数据库配置。");
const runId = Date.now().toString();
const database = `schedule_v2_browser_${runId}`;
const origin = "http://127.0.0.1:3017";
const output = path.resolve(process.env.TASK_BROWSER_OUTPUT || "test-results/v2");
await mkdir(output, { recursive: true });
const uploads = path.resolve(`data/browser-${runId}`);
const admin = postgres({
  host: "127.0.0.1",
  port: 5433,
  database: "postgres",
  username: "schedule",
  password,
  max: 1,
  prepare: false,
});
await admin.unsafe(`CREATE DATABASE "${database}"`);
const sql = postgres({
  host: "127.0.0.1",
  port: 5433,
  database,
  username: "schedule",
  password,
  max: 1,
  prepare: false,
});
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
const databaseUrl = `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${database}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_TRUSTED_ORIGINS: origin,
  BETTER_AUTH_SECRET: "isolated-v2-browser-test-secret-20261008",
  AUTH_DISABLE_RATE_LIMIT: "1",
  TASK_UPLOAD_DIR: uploads,
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-v2-prod",
};
const seed = spawn(process.execPath, ["scripts/seed-initial-data.mjs"], {
  env,
  stdio: "ignore",
});
await new Promise<void>((resolve, reject) =>
  seed.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("测试学期初始化失败。")),
  ),
);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    "3017",
    "--hostname",
    "127.0.0.1",
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (b) => {
  logs += String(b).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]");
});
server.stderr.on("data", (b) => {
  logs += String(b).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]");
});
const checks: string[] = [];
const browserErrors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let restoredServer: ReturnType<typeof spawn> | undefined;
async function api(context: BrowserContext, url: string, data?: unknown) {
  const response =
    data === undefined
      ? await context.request.get(`${origin}${url}`)
      : await context.request.post(`${origin}${url}`, {
          data,
          headers: { origin },
        });
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function register(context: BrowserContext, name: string, no: string) {
  const page = await context.newPage();
  page.on("pageerror", (e) => browserErrors.push(e.message));
  await page.goto(`${origin}/register`);
  await page.getByLabel("姓名", { exact: true }).fill(name);
  await page.getByLabel("学号", { exact: true }).fill(no);
  await page
    .getByLabel("设置密码", { exact: true })
    .fill("browser-test-password-123");
  await page
    .getByLabel("确认密码", { exact: true })
    .fill("browser-test-password-123");
  await page.getByRole("button", { name: "完成注册" }).click();
  await page.waitForURL("**/dashboard");
  return page;
}
async function dismiss(page: Page) {
  const popup = page.getByRole("dialog", { name: "任务指派提醒" });
  if (await popup.isVisible()) {
    await popup.getByRole("button", { name: "知道了", exact: true }).click();
    await expect(popup).not.toBeVisible();
  }
}
async function go(page: Page, url: string) {
  await page.goto(`${origin}${url}`);
  await page.waitForLoadState("networkidle");
  await dismiss(page);
}
async function waitTask(page: Page, status: string) {
  await expect(page.locator(".page-actions .task-badge")).toHaveText(status);
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`浏览器测试服务启动失败：${logs}`);
    try {
      const r = await fetch(`${origin}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("浏览器测试服务启动超时。");
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const ca = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    cc = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const a = await register(ca, "发布甲", "v2-browser-a"),
    b = await register(cb, "执行乙", "v2-browser-b"),
    c = await register(cc, "执行丙", "v2-browser-c");
  checks.push("真实浏览器注册3名成员并登录");
  for (const width of [1440, 390]) {
    await a.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await go(a, "/my-schedule");
    await a.getByRole("button", { name: "添加课程", exact: true }).click();
    await a.getByPlaceholder("例如：机器学习").fill(`控件验收课程${width}`);
    await a.getByRole("combobox", { name: "星期", exact: true }).click();
    await a.getByRole("option", { name: "周二", exact: true }).click();
    await a.getByRole("combobox", { name: "周次类型", exact: true }).click();
    await a.getByRole("option", { name: "每周", exact: true }).click();
    await a.getByRole("button", { name: "保存课程", exact: true }).click();
    const course = a.locator(".course-card").filter({ hasText: `控件验收课程${width}` });
    await expect(course).toBeVisible();
    await course.click();
    await a.getByRole("button", { name: "删除课程", exact: true }).click();
    const confirm = a.getByRole("dialog", { name: "删除课程", exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    const box = await confirm.boundingBox();
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(course).toBeVisible();
    await a.getByRole("button", { name: "删除课程", exact: true }).click();
    await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(course).toHaveCount(0);
  }
  await a.setViewportSize({ width: 1440, height: 1000 });
  checks.push("桌面及390px新版课程下拉真实保存，居中删除确认可取消及删除，默认聚焦取消");
  const options = await api(ca, "/api/task-options");
  const bid = options.members.find(
    (m: { name: string }) => m.name === "执行乙",
  ).id;
  await go(a, "/groups");
  const groupName = a.getByRole("textbox", { name: "小组名称", exact: true });
  await groupName.fill("确认窗口验收小组");
  await a.getByRole("button", { name: "创建", exact: true }).click();
  await expect(groupName).toHaveValue("");
  await expect(a.getByRole("heading", { name: "确认窗口验收小组", exact: true })).toBeVisible();
  const transferGroup = (await api(ca, "/api/groups")).find((group: { name: string }) => group.name === "确认窗口验收小组");
  expect(transferGroup).toBeTruthy();
  await ca.request.post(`${origin}/api/groups/${transferGroup.id}/members`, { data: { studentId: bid }, headers: { origin } });
  await go(a, "/groups");
  const groupCard = a.locator(".group-card").filter({ has: a.getByRole("heading", { name: "确认窗口验收小组", exact: true }) });
  await groupCard.getByTitle("转让组长", { exact: true }).click();
  await a.getByRole("dialog", { name: "转让组长" }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(groupCard.getByRole("button", { name: "解散小组" })).toBeVisible();
  await groupCard.getByTitle("转让组长", { exact: true }).click();
  await a.getByRole("dialog", { name: "转让组长" }).getByRole("button", { name: "确认转让", exact: true }).click();
  await expect(groupCard.getByRole("button", { name: "解散小组" })).toHaveCount(0);
  await go(b, "/groups");
  const ownedGroup = b.locator(".group-card").filter({ has: b.getByRole("heading", { name: "确认窗口验收小组", exact: true }) });
  await ownedGroup.getByRole("button", { name: "解散小组" }).click();
  await b.getByRole("dialog", { name: "解散小组" }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(ownedGroup).toBeVisible();
  await ownedGroup.getByRole("button", { name: "解散小组" }).click();
  await b.getByRole("dialog", { name: "解散小组" }).getByRole("button", { name: "确认解散", exact: true }).click();
  await expect(ownedGroup).toHaveCount(0);
  checks.push("小组页直接输入名称并创建，转让和解散确认可取消及执行，权限正确");
  // Cancelled forms remain recoverable through the owner-only pending inventory.
  await go(a, "/tasks/new");
  await a.locator('input[type="file"]').setInputFiles({ name: "临时移除.txt", mimeType: "text/plain", buffer: Buffer.from("temporary") });
  await expect(a.locator(".task-picked-file")).toHaveText(/临时移除.txt/);
  const removed = (await api(ca, "/api/task-files")).files.find((f: { name: string }) => f.name === "临时移除.txt");
  await a.getByRole("button", { name: "移除临时移除.txt", exact: true }).click();
  await expect(a.locator(".task-picked-file")).toHaveCount(0);
  expect((await ca.request.get(`${origin}/api/task-files/${removed.id}`)).status()).toBe(404);
  await a.locator('input[type="file"]').setInputFiles({ name: "取消后清理.txt", mimeType: "text/plain", buffer: Buffer.from("abandoned") });
  await expect(a.locator(".task-picked-file")).toHaveText(/取消后清理.txt/);
  await go(a, "/tasks");
  await go(a, "/tasks/new");
  await a.getByText("本人未提交附件（可清理释放额度）", { exact: true }).click();
  await expect(a.getByRole("button", { name: "清理取消后清理.txt", exact: true })).toBeVisible();
  await a.getByRole("button", { name: "清理取消后清理.txt", exact: true }).click();
  await expect(a.getByRole("button", { name: "清理取消后清理.txt", exact: true })).toHaveCount(0);
  expect((await api(ca, "/api/task-files")).files).toHaveLength(0);
  checks.push("附件移除真实清理，取消发布后本人可清理遗留附件");
  await go(a, "/tasks/new");
  await a.getByLabel("任务标题", { exact: true }).fill("浏览器公告任务");
  await a
    .getByLabel("任务要求", { exact: true })
    .fill("汇总本周实验，提交报告和结果说明。");
  await a.getByLabel("人数上限（留空不限）").fill("2");
  const deadlineField = a.locator(".task-deadline");
  await deadlineField.getByRole("button", { name: "明天", exact: true }).click();
  await deadlineField.getByRole("spinbutton", { name: /小时/ }).fill("9");
  await deadlineField.getByRole("spinbutton", { name: /分钟/ }).fill("5");
  const chosenDate = await deadlineField.locator(".task-date-trigger span").innerText();
  await a.getByRole("button", { name: "发布任务", exact: true }).click();
  await a.waitForURL(/\/tasks\/\d+$/);
  const taskId = Number(a.url().split("/").pop());
  expect((await api(ca, `/api/tasks/${taskId}`)).rounds[0].deadline).toBe(`${chosenDate.replaceAll("/", "-")}T01:05:00.000Z`);
  await a.getByRole("button", { name: "修改要求", exact: true }).click();
  const editDeadline = a.getByRole("dialog", { name: "修改任务要求" }).locator(".task-deadline");
  await expect(editDeadline.getByRole("spinbutton", { name: /小时/ })).toHaveValue("09");
  await expect(editDeadline.getByRole("spinbutton", { name: /分钟/ })).toHaveValue("05");
  await a.getByRole("dialog", { name: "修改任务要求" }).getByRole("button", { name: "关闭", exact: true }).click();
  checks.push("新版日期快捷选择和时分输入真实保存北京时间，编辑回显一致");
  checks.push("桌面发布公告任务");
  await go(b, `/tasks/${taskId}`);
  await b.getByRole("button", { name: "领取任务", exact: true }).click();
  await expect(b.getByText("已承担本轮任务；退出请联系发布者。")).toBeVisible();
  await b.getByLabel("成果说明", { exact: true }).fill("第一版报告");
  await b.locator('input[type="file"]').setInputFiles({
    name: "结果.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("实验结果：通过"),
  });
  await expect(b.locator(".task-picked-file")).toHaveText(/结果.txt/);
  await b.getByRole("button", { name: "提交成果", exact: true }).click();
  await expect(b.locator(".task-submission")).toHaveCount(1);
  checks.push("领取任务并上传TXT提交成果");
  await go(a, `/tasks/${taskId}`);
  await a.getByLabel("验收反馈（打回时必填）").fill("请补充实验结论");
  await a.getByRole("button", { name: "打回补充" }).click();
  await expect(a.locator(".task-submission .task-badge")).toHaveText("被打回");
  await go(b, `/tasks/${taskId}`);
  await b
    .getByLabel("成果说明", { exact: true })
    .fill("第二版报告，已补充结论");
  await b.getByRole("button", { name: "提交新版本" }).click();
  await expect(b.locator(".task-submission")).toHaveCount(2);
  await go(a, `/tasks/${taskId}`);
  await a.getByRole("button", { name: "验收通过", exact: true }).click();
  await waitTask(a, "进行中");
  await a.getByRole("button", { name: "结束领取", exact: true }).click();
  await waitTask(a, "已完成");
  await a.screenshot({
    path: path.join(output, "desktop-completed.png"),
    fullPage: true,
  });
  checks.push("打回、重提保留2版，验收并结束领取后完成");
  await a.getByRole("button", { name: "重新开启", exact: true }).click();
  const reopen = a.getByRole("dialog", { name: "重新开启任务" });
  await reopen.getByRole("button", { name: "清空", exact: true }).click();
  await reopen.getByLabel("恢复公告领取").uncheck();
  await reopen.getByRole("button", { name: "确认重新开启" }).click();
  await waitTask(a, "进行中");
  expect((await api(ca, `/api/tasks/${taskId}`)).rounds.find((round: { number: number }) => round.number === 2).deadline).toBeNull();
  await expect(a.getByRole("combobox", { name: "查看轮次" })).toHaveText("第2轮 · 当前");
  await a.getByRole("button", { name: "撤销任务", exact: true }).click();
  await a
    .getByRole("dialog", { name: "撤销任务" })
    .getByRole("button", { name: "确认撤销" })
    .click();
  await waitTask(a, "已撤销");
  await a.getByRole("button", { name: "重新开启", exact: true }).click();
  await a
    .getByRole("dialog", { name: "重新开启任务" })
    .getByRole("button", { name: "确认重新开启" })
    .click();
  await expect(a.getByRole("combobox", { name: "查看轮次" })).toHaveText("第3轮 · 当前");
  checks.push("完成和撤销均能重新开启为新轮，旧成果只在历史轮显示");
  // Direct task via actual browser form: multi-member individual delivery.
  await go(a, "/tasks/new");
  await a.getByLabel("任务标题", { exact: true }).fill("浏览器逐人任务");
  await a.getByLabel("任务要求", { exact: true }).fill("每人提交个人汇报");
  await a.getByRole("combobox", { name: "任务类型", exact: true }).click();
  await a.getByRole("option", { name: "指定任务 · 直接安排", exact: true }).click();
  await a.getByRole("combobox", { name: "交付模式", exact: true }).click();
  await a.getByRole("option", { name: "每人分别交付", exact: true }).click();
  await a.getByRole("checkbox", { name: "执行乙", exact: true }).check();
  await a.getByRole("checkbox", { name: "执行丙", exact: true }).check();
  await a.getByRole("button", { name: "发布任务", exact: true }).click();
  await a.waitForURL(/\/tasks\/\d+$/);
  const assignedId = Number(a.url().split("/").pop());
  await b.goto(`${origin}/tasks`);
  await expect(b.getByRole("dialog", { name: "任务指派提醒" })).toBeVisible();
  await expect(b.locator(".task-popup-item")).toHaveCount(2);
  await expect(b.locator(".task-popup-item").first()).toContainText(
    "发布者：发布甲",
  );
  await b
    .getByRole("dialog", { name: "任务指派提醒" })
    .getByRole("button", { name: "知道了" })
    .click();
  await b.reload();
  await b.waitForLoadState("networkidle");
  await expect(
    b.getByRole("dialog", { name: "任务指派提醒" }),
  ).not.toBeVisible();
  const anotherDevice = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await anotherDevice.addCookies(await cb.cookies());
  const devicePage = await anotherDevice.newPage();
  await devicePage.goto(`${origin}/tasks`);
  await devicePage.waitForLoadState("networkidle");
  await expect(
    devicePage.getByRole("dialog", { name: "任务指派提醒" }),
  ).not.toBeVisible();
  checks.push("进入网站指派弹窗、知道了已读、刷新不重复");
  await go(b, `/tasks/${assignedId}`);
  await b.getByLabel("成果说明", { exact: true }).fill("乙的成果");
  await b.getByRole("button", { name: "提交成果", exact: true }).click();
  await go(a, `/tasks/${assignedId}`);
  await a.getByRole("button", { name: "验收通过", exact: true }).click();
  await waitTask(a, "进行中");
  await go(c, `/tasks/${assignedId}`);
  await c.getByLabel("成果说明", { exact: true }).fill("丙的成果");
  await c.getByRole("button", { name: "提交成果", exact: true }).click();
  await go(a, `/tasks/${assignedId}`);
  await a.getByRole("button", { name: "验收通过", exact: true }).click();
  await waitTask(a, "已完成");
  checks.push("逐人交付须2人分别通过");
  // Mobile management and submission use a new assignment to exercise all inputs at 390px.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await mobile.addCookies(await ca.cookies());
  const mp = await mobile.newPage();
  mp.on("pageerror", (e) => browserErrors.push(e.message));
  await go(mp, "/tasks/new");
  await mp.getByLabel("任务标题", { exact: true }).fill("手机任务");
  await mp.getByLabel("任务要求", { exact: true }).fill("手机端完成的任务");
  await mp.getByRole("checkbox", { name: "执行乙", exact: true }).check();
  await mp.getByRole("button", { name: "发布任务", exact: true }).click();
  await mp.waitForURL(/\/tasks\/\d+$/);
  const mobileId = Number(mp.url().split("/").pop());
  await mp.getByRole("button", { name: "修改要求" }).click();
  await mp
    .getByRole("dialog")
    .filter({ has: mp.getByRole("heading", { name: "修改任务要求" }) })
    .getByLabel("任务要求", { exact: true })
    .fill("手机修改后的任务要求");
  await mp.getByRole("button", { name: "保存要求" }).click();
  await mp.getByRole("button", { name: "调整执行对象" }).click();
  await mp
    .getByRole("dialog", { name: "调整执行对象" })
    .getByRole("checkbox", { name: "执行丙", exact: true })
    .check();
  await mp.getByRole("button", { name: "保存执行对象" }).click();
  await expect(mp.locator(".task-roster-list > div")).toHaveCount(2);
  await mp.screenshot({
    path: path.join(output, "mobile-task.png"),
    fullPage: true,
  });
  expect(
    await mp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  checks.push("390px发布、修改要求、调整执行对象及无页面溢出");
  const mb = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await mb.addCookies(await cb.cookies());
  const bp = await mb.newPage();
  await go(bp, `/tasks/${mobileId}`);
  await bp.getByLabel("成果说明", { exact: true }).fill("手机提交共同成果");
  await bp.getByRole("button", { name: "提交成果", exact: true }).click();
  await go(mp, `/tasks/${mobileId}`);
  await mp.getByLabel("验收反馈（打回时必填）").fill("手机端补充说明");
  await mp.getByRole("button", { name: "打回补充" }).click();
  await go(bp, `/tasks/${mobileId}`);
  await bp.getByLabel("成果说明", { exact: true }).fill("手机补充后的共同成果");
  await bp.getByRole("button", { name: "提交新版本" }).click();
  await expect(bp.locator(".task-submission")).toHaveCount(2);
  await go(mp, `/tasks/${mobileId}`);
  await mp.getByRole("button", { name: "验收通过", exact: true }).click();
  await mp.getByRole("button", { name: "结束领取" }).click();
  await waitTask(mp, "已完成");
  await mp.getByRole("button", { name: "重新开启", exact: true }).click();
  await mp.getByRole("button", { name: "确认重新开启" }).click();
  await waitTask(mp, "进行中");
  await mp.getByRole("button", { name: "撤销任务", exact: true }).click();
  await mp.getByRole("button", { name: "确认撤销" }).click();
  await waitTask(mp, "已撤销");
  await mp.getByRole("button", { name: "重新开启", exact: true }).click();
  await mp.getByRole("button", { name: "确认重新开启" }).click();
  await expect(mp.getByRole("combobox", { name: "查看轮次" })).toHaveText("第3轮 · 当前");
  await mp.getByRole("button", { name: "领取任务", exact: true }).click();
  await expect(mp.getByLabel("成果说明", { exact: true })).toBeVisible();
  checks.push("390px提交、打回、重提、验收完成、撤销和重开完整流程");
  // Existing group management feeds combined target task at server and UI.
  const g1 = await api(ca, "/api/groups", { name: "浏览器小组一" }),
    g2 = await api(ca, "/api/groups", { name: "浏览器小组二" });
  for (const group of [g1, g2]) {
    const response = await ca.request.post(
      `${origin}/api/groups/${group.id}/members`,
      { data: { studentId: bid }, headers: { origin } },
    );
    expect(response.ok()).toBeTruthy();
  }
  const [excludedMember] = await sql`insert into students(name,student_no) values('待注册丁','v2-browser-unregistered') returning id`;
  await sql`insert into group_members(group_id,student_id,role) values(${g1.id},${excludedMember.id},'member'),(${g2.id},${excludedMember.id},'member')`;
  await go(a, "/tasks/new");
  await a.getByLabel("任务标题", { exact: true }).fill("多个小组共同任务");
  await a
    .getByLabel("任务要求", { exact: true })
    .fill("个人和两个小组一起完成");
  await a.getByRole("combobox", { name: "任务类型", exact: true }).click();
  await a.getByRole("option", { name: "指定任务 · 直接安排", exact: true }).click();
  await a.getByRole("checkbox", { name: "执行丙", exact: true }).check();
  await a.getByRole("checkbox", { name: "浏览器小组一", exact: true }).check();
  await a.getByRole("checkbox", { name: "浏览器小组二", exact: true }).check();
  await expect(a.getByText("合并去重后可执行3人，提交时以最新成员状态为准。", { exact: true })).toBeVisible();
  await expect(a.getByRole("status")).toContainText("待注册丁（未注册）");
  await a.screenshot({ path: path.join(output, "group-exclusions.png"), fullPage: true });
  await a.getByRole("button", { name: "发布任务", exact: true }).click();
  await a.waitForURL(/\/tasks\/\d+$/);
  await a.waitForLoadState("networkidle");
  await dismiss(a);
  await expect(a.locator(".task-roster-list > div")).toHaveCount(3);
  await expect(a.locator(".task-roster").getByRole("status")).toContainText("待注册丁（未注册）");
  checks.push("多组重复未注册成员去重排除，发布前人数及发布后原因明确提示");
  checks.push("浏览器混选个人和两个小组，执行人员去重");
  const groupTaskId = Number(a.url().split("/").pop());
  const groupTask = await api(ca, `/api/tasks/${groupTaskId}`);
  const aid = options.members.find(
    (m: { name: string }) => m.name === "发布甲",
  ).id;
  await sql`insert into task_notifications (recipient_id,task_id,round_id,title,message)
    select ${aid},${groupTaskId},${groupTask.rounds[0].id},'历史消息浏览器验证','历史消息' || n from generate_series(1,205) n`;
  await go(a, "/notifications");
  await expect(a.locator(".task-message")).toHaveCount(200);
  await a.getByRole("button", { name: "查看更早消息" }).click();
  await expect
    .poll(() => a.locator(".task-message").count())
    .toBeGreaterThan(200);
  await a.getByRole("button", { name: "将本页消息标为已读" }).click();
  await expect(a.locator(".task-toolbar > span")).toHaveText("0条未读");
  checks.push("超过200条消息能看更早历史并分批标记已读");
  for (const width of [1440, 390]) {
    await a.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await sql`insert into task_notifications (recipient_id,task_id,round_id,title,message,read_at)
      select ${aid},${groupTaskId},${groupTask.rounds[0].id},${`v22-${width}-`} || n,
        '消息清理验收' || n, case when n <= 410 then now() else null end from generate_series(1,412) n`;
    await go(a, "/notifications");
    await expect(a.locator(".task-message")).toHaveCount(200);
    const firstPage = await api(ca, "/api/notifications");
    const loadedRead = firstPage.messages.filter((m: { readAt: string | null }) => m.readAt);
    await expect(a.locator(".task-message.unread input[type=checkbox]").first()).toBeDisabled();
    const checkbox = a.getByRole("checkbox", { name: `选择消息：${loadedRead[0].title}（${loadedRead[0].id}）`, exact: true });
    await checkbox.focus();
    await a.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await a.getByRole("button", { name: "删除所选", exact: true }).click();
    const modal = a.getByRole("dialog", { name: "删除已读消息", exact: true });
    await expect(modal).toContainText("确认删除这1条已读消息");
    await expect(modal.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    const bounds = await modal.boundingBox();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(3);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - (width === 390 ? 844 : 1000) / 2)).toBeLessThan(3);
    await a.screenshot({ path: path.join(output, `v22-confirm-${width}.png`) });
    await a.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await expect(checkbox).toBeChecked();
    await a.getByRole("button", { name: "删除所选", exact: true }).click();
    // An actual HTTP failure must keep both the confirmation and stored data.
    let failDelete = true;
    await a.route("**/api/notifications", async (route) => {
      if (route.request().method() === "DELETE" && failDelete) {
        failDelete = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "测试连接失败，请重试。" }) });
      } else await route.continue();
    });
    await modal.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("测试连接失败");
    expect((await sql`select id from task_notifications where id=${loadedRead[0].id}`).length).toBe(1);
    await modal.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(a.locator(".task-message")).toHaveCount(199);
    expect((await sql`select id from task_notifications where id=${loadedRead[0].id}`).length).toBe(0);
    await a.unroute("**/api/notifications");
    checks.push(`${width}px单条多选、键盘取消、居中默认取消焦点、失败保留及重试删除`);

    await a.getByRole("button", { name: "删除已加载的已读消息", exact: true }).click();
    await expect(modal).toContainText(`确认删除这${loadedRead.length - 1}条已读消息`);
    const [arrived] = await sql`insert into task_notifications(recipient_id,task_id,round_id,title,message)
      values(${aid},${groupTaskId},${groupTask.rounds[0].id},${`${width}px确认期间新消息`},'保留新未读') returning id`;
    await modal.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(a.locator(".task-message")).toHaveCount(2);
    await expect(a.getByRole("button", { name: "删除已加载的已读消息", exact: true })).toBeDisabled();
    expect((await sql`select id from task_notifications where id=${arrived.id}`).length).toBe(1);
    const [older] = await sql`select count(*)::int as n from task_notifications where recipient_id=${aid} and id < ${firstPage.nextCursor} and read_at is not null`;
    expect(older.n).toBeGreaterThan(200);
    await a.getByRole("button", { name: "查看更早消息", exact: true }).click();
    await expect(a.locator(".task-message")).toHaveCount(202);
    await a.getByRole("button", { name: "查看更早消息", exact: true }).click();
    await expect.poll(() => a.locator(".task-message").count()).toBeGreaterThan(202);
    await a.getByRole("checkbox", { name: "全选已加载的已读消息", exact: true }).check();
    const selectedCount = await a.locator(".task-message input[type=checkbox]:checked").count();
    expect(selectedCount).toBeGreaterThan(200);
    await a.getByRole("button", { name: "删除所选", exact: true }).click();
    // A second device deletes the same fixed set before the first confirms.
    const selected = await a.locator(".task-message input[type=checkbox]:checked").evaluateAll((inputs) => inputs.map((input) => Number(input.getAttribute("aria-label")!.match(/（(\d+)）$/)![1])));
    const otherDevice = await ca.request.delete(`${origin}/api/notifications`, { data: { ids: selected, confirm: true }, headers: { origin } });
    expect(otherDevice.ok()).toBeTruthy();
    await modal.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(a.locator(".task-message input[type=checkbox]:checked")).toHaveCount(0);
    await a.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(a.getByText(`${width}px确认期间新消息`, { exact: true })).toBeVisible();
    const noOverflow = await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noOverflow).toBeTruthy();
    await a.screenshot({ path: path.join(output, `v22-notifications-${width}.png`), fullPage: true });
    checks.push(`${width}px一键仅清理已加载已读，保留新未读及更早历史，删除游标仍可翻页，跨200条多选与多设备幂等`);
  }
  await a.setViewportSize({ width: 1440, height: 1000 });
  // Personal work is independent of task acceptance and uses existing member page.
  await go(a, "/members");
  await expect(
    a.getByRole("heading", { name: "课表 · 第", exact: false }),
  ).toBeVisible();
  await a.getByRole("button", { name: "添加记录", exact: true }).click();
  await a.getByLabel("工作标题", { exact: true }).fill("桌面论文阅读");
  await a
    .getByLabel("工作说明", { exact: true })
    .fill("阅读方法部分，整理实验方案。");
  await a.getByRole("button", { name: "保存记录", exact: true }).click();
  const desktopWork = a
    .locator(".work-record")
    .filter({ hasText: "桌面论文阅读" });
  await expect(desktopWork).toBeVisible();
  await desktopWork.getByRole("button", { name: "编辑", exact: true }).click();
  await a.getByRole("combobox", { name: "工作状态", exact: true }).click();
  await a.getByRole("option", { name: "暂停", exact: true }).click();
  await a.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(desktopWork.locator(".task-badge")).toHaveText("暂停");
  await desktopWork.getByRole("button", { name: "删除", exact: true }).click();
  await a
    .getByRole("dialog", { name: "删除工作记录" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(desktopWork).toBeVisible();
  await a.screenshot({
    path: path.join(output, "desktop-member-work.png"),
    fullPage: true,
  });
  await desktopWork.getByRole("button", { name: "删除", exact: true }).click();
  await a.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(desktopWork).toHaveCount(0);
  checks.push(
    "桌面成员页面保留课表，个人记录添加修改暂停、取消删除及确认删除通过",
  );

  await go(bp, "/members");
  await bp.getByRole("button", { name: "添加记录", exact: true }).click();
  await bp.getByLabel("工作标题", { exact: true }).fill("手机实验记录");
  await bp
    .getByLabel("工作说明", { exact: true })
    .fill("整理实验结果，准备下次组会。\n暂不提交任务成果。");
  await bp.getByRole("button", { name: "保存记录", exact: true }).click();
  const mobileWork = bp
    .locator(".work-record")
    .filter({ hasText: "手机实验记录" });
  await expect(mobileWork).toBeVisible();
  await mobileWork.getByRole("button", { name: "编辑", exact: true }).click();
  await bp.getByRole("combobox", { name: "工作状态", exact: true }).click();
  await bp.getByRole("option", { name: "已完成", exact: true }).click();
  await bp.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(mobileWork.locator(".task-badge")).toHaveText("已完成");
  const mobileRecord = (
    await api(cb, `/api/students/${bid}/work`)
  ).records.find((r: { title: string }) => r.title === "手机实验记录");
  const old = await api(cb, "/api/my/work", {
    title: "旧完成仅本人管理",
    description: "超过7天的历史工作",
    status: "completed",
  });
  await sql`update member_work_records set completed_at=now()-interval '8 days' where id=${old.id}`;
  await bp.getByRole("button", { name: "刷新工作", exact: true }).click();
  await expect(
    bp.locator(".work-record").filter({ hasText: "旧完成仅本人管理" }),
  ).toHaveCount(0);
  await bp.getByRole("button", { name: "管理全部记录", exact: true }).click();
  const oldWork = bp
    .locator(".work-record")
    .filter({ hasText: "旧完成仅本人管理" });
  await expect(oldWork).toBeVisible();
  await oldWork.getByRole("button", { name: "编辑", exact: true }).click();
  await bp
    .getByLabel("工作说明", { exact: true })
    .fill("修改旧说明不刷新完成时间");
  await bp.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(oldWork).toContainText("修改旧说明不刷新完成时间");
  await bp.getByRole("button", { name: "近期工作", exact: true }).click();
  await expect(oldWork).toHaveCount(0);
  await expect(mobileWork).toBeVisible();
  await bp.evaluate(() => window.scrollTo(0, 0));
  await bp.screenshot({
    path: path.join(output, "mobile-member-work.png"),
    fullPage: true,
  });
  expect(
    await bp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await go(a, "/members");
  await a.locator(".member-row").filter({ hasText: "执行乙" }).click();
  await expect(
    a.locator(".work-record").filter({ hasText: "手机实验记录" }),
  ).toBeVisible();
  await expect(
    a.locator(".work-record").filter({ hasText: "旧完成仅本人管理" }),
  ).toHaveCount(0);
  await expect(
    a
      .locator(".member-work")
      .getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0);
  await expect(
    a.locator(".work-task").filter({ hasText: "浏览器逐人任务" }),
  ).toContainText("已完成");
  await expect(
    a.locator(".work-task").filter({ hasText: "手机任务" }),
  ).toContainText("进行中");
  expect(
    (
      await ca.request.get(`${origin}/api/students/${bid}/work?scope=all`)
    ).status(),
  ).toBe(403);
  expect(
    (await ca.request.get(`${origin}/api/my/work/${old.id}`)).status(),
  ).toBe(403);
  expect(
    (
      await ca.request.patch(`${origin}/api/my/work/${mobileRecord.id}`, {
        headers: { origin },
        data: {
          title: "越权",
          description: "不能改",
          status: "active",
          expectedRevision: mobileRecord.revision,
        },
      })
    ).status(),
  ).toBe(403);
  await a.locator(".member-row").filter({ hasText: "执行丙" }).click();
  await expect(
    a.locator(".work-record").filter({ hasText: "手机实验记录" }),
  ).toHaveCount(0);
  await bp.getByRole("button", { name: "管理全部记录", exact: true }).click();
  await oldWork.getByRole("button", { name: "删除", exact: true }).click();
  await bp.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(oldWork).toHaveCount(0);
  checks.push(
    "390px记录完成与旧记录管理、修改不刷新完成时间、本人删除、他人只读近期及成员切换隔离通过",
  );

  await sql`insert into member_work_records(student_id,title,description,status) select ${aid},'分页工作' || n,'分页说明','active' from generate_series(1,53) n`;
  await go(a, "/members");
  await expect(a.locator(".work-record")).toHaveCount(50);
  await a.getByRole("button", { name: "加载更多记录", exact: true }).click();
  await expect(a.locator(".work-record")).toHaveCount(53);
  checks.push("真实浏览器53条个人记录分页，任务展示与个人记录独立");
  // Increment: real Markdown publish and reference preview, then mixed-state lists.
  await a.setViewportSize({ width: 1440, height: 1000 });
  await go(a, "/tasks/new");
  await a.getByLabel("任务标题", { exact: true }).fill("公开资料预览验收");
  await a.getByRole("combobox", { name: "任务类型" }).click();
  await a.getByRole("option", { name: "指定任务 · 直接安排", exact: true }).click();
  const publishOptions = await api(ca, "/api/task-options");
  for (const group of publishOptions.groups) {
    await expect(a.getByRole("checkbox", { name: group.name, exact: true }).locator("..")).toHaveText(group.name);
  }
  await a.getByRole("combobox", { name: "任务类型" }).click();
  await a.getByRole("option", { name: "公告任务 · 自行领取", exact: true }).click();
  const markdown = "## 验收标题\n\n**清晰要求**\n\n- 第一项\n- 第二项\n\n| 项目 | 状态 |\n| --- | --- |\n| 实验 | 待做 |\n\n```txt\n代码内容\n```\n\n<script>window.markdownAttack=1</script>\n\n[危险链接](javascript:alert(1))\n\n![追踪图片](https://example.invalid/track.png)";
  await a.getByLabel("任务要求", { exact: true }).fill(markdown);
  await a.getByRole("button", { name: "预览", exact: true }).click();
  await expect(a.getByLabel("任务要求预览").getByRole("heading", { name: "验收标题" })).toBeVisible();
  await expect(a.getByLabel("任务要求预览").locator("table")).toHaveCount(1);
  await expect(a.getByLabel("任务要求预览").locator('a[href^="javascript:"]')).toHaveCount(0);
  await a.getByRole("button", { name: "编辑", exact: true }).click();
  const pageOne = "BT /F1 16 Tf 30 100 Td (PDF Preview) Tj ET\n";
  const pageTwo = "BT /F1 16 Tf 30 160 Td (Second page) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(pageOne)} >>\nstream\n${pageOne}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(pageTwo)} >>\nstream\n${pageTwo}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await a.locator('input[type="file"]').setInputFiles([
    { name: "参考.md", mimeType: "text/plain", buffer: Buffer.from(markdown) },
    { name: "参考.txt", mimeType: "text/plain", buffer: Buffer.from("参考文字\n<script>window.textAttack=1</script>") },
    { name: "参考.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64") },
    { name: "参考.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) },
    { name: "参考.doc", mimeType: "application/msword", buffer: Buffer.from([208,207,17,224,161,177,26,225]) },
  ]);
  await expect(a.locator(".task-picked-file")).toHaveCount(5);
  await a.getByRole("button", { name: "发布任务", exact: true }).click();
  await a.waitForURL(/\/tasks\/\d+$/);
  const previewTaskId = Number(a.url().split("/").pop());
  await expect(a.locator(".task-requirements .task-markdown").getByRole("heading", { name: "验收标题" })).toBeVisible();
  await a.getByRole("button", { name: "修改要求", exact: true }).click();
  const editor = a.getByRole("dialog", { name: "修改任务要求" });
  await editor.getByLabel("任务要求", { exact: true }).fill(markdown + "\n\n修改已保存");
  await editor.getByRole("button", { name: "预览", exact: true }).click();
  await expect(editor.getByText("修改已保存", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "保存要求", exact: true }).click();
  await expect(editor).not.toBeVisible();
  for (const width of [1440, 390]) {
    await b.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await go(b, `/tasks/${previewTaskId}`);
    for (const name of ["参考.md", "参考.txt", "参考.png", "参考.pdf", "参考.doc"]) {
      await b.locator(".task-requirements > .task-files a").filter({ hasText: name }).click();
      const popup = b.getByRole("dialog", { name, exact: true });
      if (name.endsWith(".md")) await expect(popup.getByRole("heading", { name: "验收标题" })).toBeVisible();
      if (name.endsWith(".txt")) await expect(popup.locator("pre")).toContainText("参考文字");
      if (name.endsWith(".png")) await expect.poll(() => popup.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
      if (name.endsWith(".pdf")) {
        await expect(popup.locator("canvas")).toHaveAttribute("data-rendered", "true");
        const darkPixels = await popup.locator("canvas").evaluate((el) => {
          const canvas = el as HTMLCanvasElement;
          const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150 && pixels[i + 3] > 0) count++;
          return count;
        });
        expect(darkPixels).toBeGreaterThan(100);
        await b.screenshot({ path: path.join(output, `increment-pdf-${width}.png`) });
        await expect(popup.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
        const previousCanvas = await popup.locator("canvas").evaluate((el) => (el as HTMLCanvasElement).toDataURL());
        await popup.getByRole("button", { name: "下一页", exact: true }).click();
        await expect(popup.getByText("第 2 / 2 页", { exact: true })).toBeVisible();
        await expect.poll(() => popup.locator("canvas").evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(previousCanvas);
        await expect(popup.locator("canvas")).toHaveAttribute("data-rendered", "true");
        await expect(popup.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
        await popup.getByRole("button", { name: "上一页", exact: true }).click();
        await expect(popup.getByText("第 1 / 2 页", { exact: true })).toBeVisible();
        await expect(popup.locator("canvas")).toHaveAttribute("data-rendered", "true");
      }
      if (name.endsWith(".doc")) await expect(popup.getByText("该格式暂不支持站内预览，请下载后查看。")).toBeVisible();
      const downloadUrl = await popup.getByRole("link", { name: "下载资料" }).getAttribute("href");
      const response = await cb.request.get(`${origin}${downloadUrl}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-disposition"]).toMatch(/^attachment;/);
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await popup.getByRole("button", { name: "关闭预览", exact: true }).click();
      await expect(popup).not.toBeVisible();
    }
    expect(await b.evaluate(() => "markdownAttack" in window || "textAttack" in window)).toBe(false);
  }
  checks.push("Markdown发布/修改/编辑预览真实保存；桌面及390px资料MD/TXT/PNG、PDF画布实际文字及两页翻页、Office下载回退和脚本拒绝");
  for (const resource of ["cmaps/UniGB-UCS2-H.bcmap", "standard_fonts/LiberationSans-Regular.ttf", "wasm/openjpeg.wasm"]) {
    const response = await ca.request.get(`${origin}/api/pdf-assets/${resource}`);
    expect(response.status(), resource).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(0);
  }
  expect((await ca.request.get(`${origin}/api/pdf-assets/build/pdf.mjs`)).status()).toBe(404);
  expect((await ca.request.get(`${origin}/api/pdf-assets/cmaps/package.json`)).status()).toBe(404);
  checks.push("PDF本地字体、中文CMap和解码资源可读，非白名单路径拒绝");
  await b.route("**/api/task-files/*?preview=1", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "资料暂不可用，请稍后重试。" }) }));
  await b.locator(".task-requirements > .task-files a").filter({ hasText: "参考.txt" }).click();
  await expect(b.getByRole("dialog", { name: "参考.txt", exact: true }).getByRole("alert")).toContainText("资料暂不可用");
  await expect(b.getByRole("dialog", { name: "参考.txt", exact: true }).getByRole("link", { name: "下载资料" })).toBeVisible();
  await b.keyboard.press("Escape");
  await expect(b.getByRole("dialog", { name: "参考.txt", exact: true })).not.toBeVisible();
  await b.unroute("**/api/task-files/*?preview=1");
  checks.push("资料预览失败在窗口内提示、保留下载且Esc关闭可用");
  const assignedResponse = await ca.request.post(`${origin}/api/tasks`, { headers: { origin }, data: { title: "指定分区验收", description: "普通文字\n第二行", kind: "assigned", delivery: "shared", deadline: null, capacity: null, directIds: [bid], groupIds: [], fileIds: [] } });
  expect(assignedResponse.status()).toBe(201);
  const mixedRows = await api(ca, "/api/tasks");
  async function chooseStatus(page: Page, label: string) {
    await page.getByRole("combobox", { name: "任务状态" }).click();
    await expect(page.getByRole("option", { name: "全部状态", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  await go(a, "/tasks");
  await expect(a.getByRole("region", { name: "公开任务", exact: true }).getByText("公开资料预览验收", { exact: true })).toBeVisible();
  await expect(a.getByRole("region", { name: "指定任务", exact: true }).getByText("指定分区验收", { exact: true })).toBeVisible();
  for (const [value, label] of [["active", "进行中"], ["completed", "已完成"], ["cancelled", "已撤销"]]) {
    await chooseStatus(a, label);
    await expect(a.locator(".task-row")).toHaveCount(mixedRows.filter((t: { status: string }) => t.status === value).length);
    await expect(a.locator(".task-row-title > .task-badge").filter({ hasText: label })).toHaveCount(mixedRows.filter((t: { status: string }) => t.status === value).length);
  }
  await chooseStatus(a, "进行中");
  await a.getByPlaceholder("搜索标题或发布者").fill("公开资料预览验收");
  await expect(a.locator(".task-row")).toHaveCount(1);
  await expect(a.getByRole("region", { name: "指定任务", exact: true }).getByText("暂无符合条件的任务")).toBeVisible();
  await a.getByPlaceholder("搜索标题或发布者").fill("");
  for (const [range, label] of [["mine", "我发布的"], ["executing", "我执行的"]]) {
    await a.getByRole("combobox", { name: "任务范围" }).click();
    await a.getByRole("option", { name: label, exact: true }).click();
    await expect(a.locator(".task-row")).toHaveCount(mixedRows.filter((t: { status: string; mine: boolean; executing: boolean }) => t.status === "active" && (range === "mine" ? t.mine : t.executing)).length);
  }
  checks.push("进行中公开/指定上下分区、三个状态独立筛选，无全部状态且历史只在对应入口");
  const guest = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    gp = await guest.newPage();
  await gp.goto(`${origin}/login`);
  await gp.getByRole("button", { name: "游客只读访问" }).click();
  await gp.waitForURL("**/dashboard");
  await go(gp, "/tasks");
  await expect(gp.locator(".task-row")).toHaveCount(mixedRows.filter((t: { status: string }) => t.status === "active").length);
  await expect(gp.getByRole("region", { name: "公开任务", exact: true })).toBeVisible();
  await expect(gp.getByRole("region", { name: "指定任务", exact: true })).toBeVisible();
  await expect(gp.locator('.task-row a[href^="/tasks/"]')).toHaveCount(0);
  await expect(
    gp.getByRole("link", { name: "发布任务", exact: true }),
  ).toHaveCount(0);
  const guestRows = await api(guest, "/api/tasks");
  expect(Object.keys(guestRows[0]).sort()).toEqual(
    ["id", "title", "publisher", "deadline", "status", "kind"].sort(),
  );
  await chooseStatus(gp, "已完成");
  await expect(gp.locator(".task-row")).toHaveCount(guestRows.filter((t: { status: string }) => t.status === "completed").length);
  await chooseStatus(gp, "已撤销");
  await expect(gp.locator(".task-row")).toHaveCount(guestRows.filter((t: { status: string }) => t.status === "cancelled").length);
  await chooseStatus(gp, "进行中");
  expect(
    (await guest.request.get(`${origin}/api/tasks/${taskId}`)).status(),
  ).toBe(403);
  const file = await sql`select id from task_files where name = '结果.txt' limit 1`;
  expect(
    (
      await guest.request.get(`${origin}/api/task-files/${file[0].id}`)
    ).status(),
  ).toBe(403);
  await go(gp, `/tasks/${taskId}`);
  await expect(gp).toHaveURL(`${origin}/dashboard`);
  await go(gp, "/tasks");
  await gp.screenshot({
    path: path.join(output, "mobile-guest-list.png"),
    fullPage: true,
  });
  expect(
    await gp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  checks.push("游客手机列表仅白名单字段，无详情入口，强行详情及附件请求拒绝");
  await go(gp, "/members");
  await expect(gp.locator(".member-work")).toHaveCount(0);
  expect(
    (await guest.request.get(`${origin}/api/students/${bid}/work`)).status(),
  ).toBe(403);
  expect(
    (
      await guest.request.get(`${origin}/api/students/${bid}/work/tasks`)
    ).status(),
  ).toBe(403);
  expect(
    (
      await guest.request.get(`${origin}/api/my/work/${mobileRecord.id}`)
    ).status(),
  ).toBe(403);
  checks.push(
    "游客成员页面仍可看课表但没有工作模块，直接请求个人记录任务摘要及详情全部拒绝",
  );
  expect(browserErrors).toEqual([]);
  // Stop writes, produce and restore a real PostgreSQL dump plus filesystem archive into isolated targets.
  server.kill();
  await new Promise<void>((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", () => resolve()),
  );
  const dumpPath = path.join(output, "isolated.dump"),
    tarPath = path.join(output, "isolated.files.tar");
  const dump = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "pg_dump",
      "--username=schedule",
      `--dbname=${database}`,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const buffers: Buffer[] = [];
  dump.stdout.on("data", (b) => buffers.push(b));
  await new Promise<void>((resolve, reject) =>
    dump.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("隔离数据库备份失败。")),
    ),
  );
  await writeFile(dumpPath, Buffer.concat(buffers));
  const tar = spawn("tar", ["-cf", tarPath, "-C", uploads, "."], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) =>
    tar.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("附件归档失败。")),
    ),
  );
  const restoreDb = `schedule_v2_restore_${runId}`;
  await admin.unsafe(`CREATE DATABASE "${restoreDb}"`);
  const restore = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "pg_restore",
      "--username=schedule",
      `--dbname=${restoreDb}`,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  restore.stdin.end(await readFile(dumpPath));
  await new Promise<void>((resolve, reject) =>
    restore.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("隔离数据库恢复失败。")),
    ),
  );
  const restoredFiles = path.join(output, "restored-files");
  await mkdir(restoredFiles, { recursive: true });
  const untar = spawn("tar", ["-xf", tarPath, "-C", restoredFiles], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) =>
    untar.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("附件恢复失败。")),
    ),
  );
  const verifier = spawn(process.execPath, ["scripts/verify-task-files.mjs"], {
    env: {
      ...env,
      DATABASE_URL: `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${restoreDb}`,
      TASK_UPLOAD_DIR: restoredFiles,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let verified = "";
  verifier.stdout.on("data", (b) => (verified += b));
  await new Promise<void>((resolve, reject) =>
    verifier.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("恢复后的附件关联或完整性校验失败。")),
    ),
  );
  const restored = postgres({
    host: "127.0.0.1",
    port: 5433,
    database: restoreDb,
    username: "schedule",
    password,
    max: 1,
    prepare: false,
  });
  const counts =
    await restored`select (select count(*) from collab_tasks)::int as tasks,(select count(*) from task_rounds)::int as rounds,(select count(*) from task_submissions)::int as submissions,(select count(*) from task_notifications)::int as notifications,(select count(*) from member_work_records)::int as work_records`;
  expect(counts[0].tasks).toBe(6);
  expect(counts[0].rounds).toBe(10);
  expect(counts[0].submissions).toBeGreaterThan(0);
  expect(counts[0].notifications).toBeGreaterThan(0);
  expect(counts[0].work_records).toBe(54);
  await restored.end();
  const restoreOrigin = "http://127.0.0.1:3018";
  restoredServer = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3018",
      "--hostname",
      "127.0.0.1",
    ],
    {
      env: {
        ...env,
        DATABASE_URL: `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${restoreDb}`,
        TASK_UPLOAD_DIR: restoredFiles,
        BETTER_AUTH_URL: restoreOrigin,
        BETTER_AUTH_TRUSTED_ORIGINS: restoreOrigin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [restoredServer.stdout, restoredServer.stderr])
    stream?.on("data", (b) => {
      logs += String(b).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]");
    });
  let restoreReady = false;
  for (let i = 0; i < 60; i++) {
    if (restoredServer.exitCode !== null)
      throw new Error("恢复库应用启动失败。");
    try {
      if ((await fetch(`${restoreOrigin}/api/health`)).ok) {
        restoreReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(restoreReady).toBeTruthy();
  const restoredResponse = await ca.request.get(
    `${restoreOrigin}/api/tasks/${taskId}`,
  );
  expect(restoredResponse.status()).toBe(200);
  const restoredTask = (await restoredResponse.json()).data;
  expect(restoredTask.rounds).toHaveLength(3);
  const download = await ca.request.get(
    `${restoreOrigin}/api/task-files/${file[0].id}`,
  );
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe("实验结果：通过");
  expect(download.headers()["content-disposition"]).toContain("attachment;");
  const restoredMessages = await cb.request.get(
    `${restoreOrigin}/api/notifications`,
  );
  expect(restoredMessages.status()).toBe(200);
  expect((await restoredMessages.json()).data.messages.length).toBeGreaterThan(
    0,
  );
  checks.push("恢复库真实HTTP会话可读历史轮次和个人消息，附件下载内容一致");
  const restoredWorkResponse = await cb.request.get(
    `${restoreOrigin}/api/students/${bid}/work`,
  );
  expect(restoredWorkResponse.status()).toBe(200);
  expect(
    (await restoredWorkResponse.json()).data.records.find(
      (r: { id: number }) => r.id === mobileRecord.id,
    ).title,
  ).toBe("手机实验记录");
  expect(
    (
      await ca.request.get(`${restoreOrigin}/api/my/work/${mobileRecord.id}`)
    ).status(),
  ).toBe(403);
  checks.push("恢复库真实HTTP个人工作记录内容和权限正确，54条记录随数据库恢复");
  checks.push(
    `隔离真实pg_dump/pg_restore＋附件归档恢复，${verified.trim()}，任务/轮次/成果/消息存在`,
  );
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        browserErrors,
        database,
        restoreDb,
        counts: counts[0],
        screenshots: [
          "desktop-completed.png",
          "mobile-task.png",
          "mobile-guest-list.png",
          "desktop-member-work.png",
          "mobile-member-work.png",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (e) {
  if (browser) {
    let i = 0;
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        await page
          .screenshot({
            path: path.join(output, `failure-${i}.png`),
            fullPage: true,
          })
          .catch(() => {});
        await writeFile(
          path.join(output, `failure-${i++}.txt`),
          await page
            .locator("body")
            .innerText()
            .catch(() => ""),
        );
      }
  }
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      { passed: false, checks, error: String(e), browserErrors, database },
      null,
      2,
    ),
  );
  throw e;
} finally {
  server.kill();
  restoredServer?.kill();
  await browser?.close();
  await sql.end();
  await admin.end();
  await writeFile(path.join(output, "server.log"), logs);
}
