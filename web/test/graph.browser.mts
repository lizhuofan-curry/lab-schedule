import { chromium, expect, type BrowserContext } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少隔离库配置。");
const database = `schedule_v3_browser_${Date.now()}`;
const origin = "http://127.0.0.1:3023";
const output = process.env.GRAPH_BROWSER_OUTPUT || "test-results/v3/browser";
await mkdir(output, { recursive: true });
const admin = postgres({ host: "127.0.0.1", port: 5433, database: "postgres", username: "schedule", password, max: 1 });
await admin.unsafe(`CREATE DATABASE "${database}"`);
const sql = postgres({ host: "127.0.0.1", port: 5433, database, username: "schedule", password, max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
if (spawnSync(process.execPath, ["scripts/seed-initial-data.mjs"], { env: { ...process.env, DATABASE_URL: `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${database}` }, stdio: "ignore" }).status !== 0) throw new Error("隔离测试学期初始化失败。");
const fixture = process.env.GRAPH_BROWSER_MODEL_FIXTURE === "1";
const server = spawn(process.execPath, [...(fixture ? ["--import", "./test/graph-model.fixture.mjs"] : []), "node_modules/next/dist/bin/next", "start", "-p", "3023", "--hostname", "127.0.0.1"], { env: { ...process.env, DATABASE_URL: `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${database}`, BETTER_AUTH_URL: origin, BETTER_AUTH_TRUSTED_ORIGINS: origin, AUTH_DISABLE_RATE_LIMIT: "1", V3_GRAPH_ENABLED: "1", V3_ANALYSIS_ENABLED: "1", DEEPSEEK_API_KEY: fixture ? "synthetic-browser-key" : "", TYPESAFE_API_KEY: "", NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-v3" }, stdio: "ignore" });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const checks: string[] = [], errors: string[] = [];
async function api(context: BrowserContext, path: string, data?: unknown) {
  const response = data === undefined ? await context.request.get(origin + path) : await context.request.post(origin + path, { headers: { origin }, data });
  expect(response.ok()).toBeTruthy(); return (await response.json()).data;
}
async function openSettings(page: import("@playwright/test").Page) {
  if (!(await page.getByRole("complementary", { name: "关系图设置", exact: true }).isVisible())) await page.getByRole("button", { name: "关系图设置", exact: true }).click();
}
async function register(context: BrowserContext, name: string, no: string) {
  const response = await context.request.post(`${origin}/api/auth/sign-up/email`, { headers: { origin }, data: { name, username: no, email: `${no}@members.local`, password: "graph-browser-synthetic-password" } });
  expect(response.ok()).toBeTruthy();
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("隔离浏览器服务未启动。");
    try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("隔离服务启动超时。");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), b = await browser.newContext();
  await register(a, "合成发布甲", "v3-browser-a"); await register(b, "合成执行乙", "v3-browser-b");
  for (const [context, name, username] of [[a, "合成发布甲", "v3-browser-a"], [b, "合成执行乙", "v3-browser-b"]] as const) {
    const identityPage = await context.newPage();
    for (const width of [1440, 390]) {
      await identityPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const from of ["/dashboard", "/tasks", "/groups"]) {
        await identityPage.goto(origin + from);
        if (width === 390) await identityPage.getByRole("button", { name: "打开账户菜单", exact: true }).click();
        await identityPage.getByRole("navigation", { name: "主要导航", exact: true }).getByRole("link", { name: "注册情况", exact: true }).click();
        await identityPage.waitForURL("**/registration");
        await expect(identityPage.locator(".current-user strong")).toHaveText(name);
        await expect(identityPage.locator(".current-user small")).toHaveText(username);
        expect((await (await context.request.get(origin + "/api/auth/get-session")).json()).user.username).toBe(username);
      }
    }
    await identityPage.close();
  }
  checks.push("A/B独立会话、桌面/手机从总览/任务/小组点击注册情况均保持本人姓名学号和真实会话");
  const options = await api(a, "/api/task-options");
  const bid = options.members.find((m: { name: string }) => m.name === "合成执行乙").id;
  const group = await api(a, "/api/groups", { name: "合成实验小组" });
  await api(a, `/api/groups/${group.id}/members`, { studentId: bid });
  const work = await api(b, "/api/my/work", { title: "历史EEG实验", description: "仅为浏览器验证生成的虚构记录。", status: "completed" });
  await sql`update member_work_records set completed_at = now() - interval '9 days' where id = ${work.id}`;
  const task = await api(a, "/api/tasks", { title: "合成分类任务", description: "核验当前承担及原始来源，使用CSP方法。", kind: "assigned", delivery: "individual", deadline: null, capacity: null, directIds: [bid], groupIds: [group.id], fileIds: [] });
  let currentWork: { id: number } | undefined;
  if (fixture) {
    currentWork = await api(b, "/api/my/work", { title: "当前EEG分类", description: "进行中的CSP分类实验", status: "paused" });
    const aid = options.members.find((m: { name: string }) => m.name === "合成发布甲").id;
    const [semester] = await sql`select id from semesters where is_current = true`;
    for (const member of [aid, bid]) await sql`insert into courses (student_id,semester_id,name,location,weekday,start_period,end_period,weeks) values (${member},${semester.id},'测试信号处理','A楼101',2,1,2,ARRAY[1,3,5]::smallint[])`;
  }
  const page = await a.newPage();
  await page.addInitScript(`
    const trace = [];
    Object.assign(window, { graphGrowthTrace: trace });
    function sample() {
      const layer = document.querySelector(".graph-canvas > g");
      const node = document.querySelector(".graph-node");
      if (layer && node && trace.length < 90) trace.push({ opacity: Number(getComputedStyle(layer).opacity), x: node.getAttribute("transform") ?? "" });
      if (trace.length < 90) requestAnimationFrame(sample);
    }
    new MutationObserver(records => {
      if (trace.length >= 90 || !records.some(record => record.target instanceof SVGSVGElement && record.attributeName === "style")) return;
      const layer = document.querySelector(".graph-canvas > g"), node = document.querySelector(".graph-node");
      if (layer && node) trace.push({ opacity: Number(getComputedStyle(layer).opacity), x: node.getAttribute("transform") ?? "" });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
    requestAnimationFrame(sample);
  `);
  page.on("pageerror", (error) => errors.push(error.message));
  // Suppress assignment overlays so graph gestures can be verified independently.
  const notices = (await api(a, "/api/notifications")).messages;
  if (notices.length) expect((await a.request.post(`${origin}/api/notifications`, { headers: { origin }, data: { ids: notices.map((n: { id: number }) => n.id) } })).ok()).toBeTruthy();
  if (fixture) {
    await expect.poll(async () => (await api(a, "/api/graph")).analysis.status, { timeout: 60000, intervals: [1000] }).toBe("ready");
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(origin + "/graph");
    const popup = page.getByRole("dialog", { name: "任务指派提醒" });
    if (await popup.isVisible()) await popup.getByRole("button", { name: "知道了", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "关系图设置", exact: true })).toBeHidden();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    const bounds = await page.locator(".graph-canvas").boundingBox();
    expect(bounds!.x).toBe(0); expect(bounds!.y).toBe(0); expect(bounds!.width).toBe(width);
    expect(bounds!.height).toBe(width === 390 ? 844 : 1000);
    await page.screenshot({ path: `${output}/immersive-${width}.png`, fullPage: true });
    await openSettings(page);
    const defaultNodeScale = width < 768 ? "0.8" : "1.7";
    await expect(page.getByRole("slider", { name: /节点大小/ })).toHaveValue(defaultNodeScale);
    await expect(page.getByRole("button", { name: "关系图设置", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("slider", { name: /节点大小/ }).fill("1.5");
    await expect(page.locator(".graph-display-controls output").first()).toHaveText("1.5倍");
    await page.getByRole("slider", { name: /节点大小/ }).fill(defaultNodeScale);
    await page.getByRole("slider", { name: /连线透明度/ }).fill("0.8");
    expect(Number(await page.locator(".graph-edge").first().getAttribute("opacity"))).toBe(.8);
    await page.getByRole("slider", { name: /连线透明度/ }).fill("0.5");
    await page.getByRole("slider", { name: /连线粗细/ }).fill("0.9");
    expect(await page.locator(".graph-edge").first().evaluate(el => getComputedStyle(el).strokeWidth)).toBe("0.9px");
    await page.getByRole("slider", { name: /连线粗细/ }).fill("0.6");
    await page.getByLabel("成员颜色", { exact: true }).fill("#42b84d");
    expect(await page.locator(".graph-node.member circle").first().evaluate(el => getComputedStyle(el).fill)).toBe("rgb(66, 184, 77)");
    await page.getByLabel("成员颜色", { exact: true }).fill("#5bd454");
    const beforeForces = await page.locator(".graph-node").first().getAttribute("transform");
    await page.getByRole("slider", { name: /图谱向心力/ }).fill("1.5");
    await expect(page.locator(".graph-node").first()).not.toHaveAttribute("transform", beforeForces!);
    await page.getByRole("slider", { name: /图谱向心力/ }).fill("1");
    await page.getByRole("button", { name: "播放展开动画", exact: true }).click();
    await expect.poll(async () => page.locator(".graph-canvas > g").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    await page.screenshot({ path: `${output}/settings-${width}.png`, fullPage: true });
    checks.push(`${width}px 默认${defaultNodeScale}倍、折叠分区、类型配色、线宽、力度调整及重播动画通过`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "关系图设置", exact: true })).toBeFocused();
    await openSettings(page);
    checks.push(`${width}px 全屏沉浸画布、默认隐藏设置、固定按钮、显示调整及Esc回焦点通过`);
    await expect(page.locator(".graph-meta")).toContainText("当前范围全部节点");
    const graph = await api(a, "/api/graph");
    await expect(page.locator(".graph-node")).toHaveCount(graph.nodes.length);
    await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
    await expect.poll(async () => page.locator(".graph-canvas > g").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    expect(await page.locator(".graph-node.member circle").first().evaluate(el => getComputedStyle(el).fill)).toBe("rgb(91, 212, 84)");
    expect(await page.locator(".graph-edge").first().evaluate(el => getComputedStyle(el).stroke)).toBe("rgb(184, 184, 191)");
    const growth = await page.evaluate(() => (window as unknown as { graphGrowthTrace: { opacity: number; x: string }[] }).graphGrowthTrace);
    await writeFile(`${output}/growth-${width}.json`, JSON.stringify(growth));
    expect(growth.some(frame => frame.opacity < .95)).toBeTruthy();
    expect(new Set(growth.map(frame => frame.x)).size).toBeGreaterThan(1);
    await writeFile(`${output}/growth-${width}.json`, JSON.stringify(growth));
    checks.push(`${width}px 生长展开位置与透明度逐帧变化、自然稳定、绿色成员及中性灰细线通过`);
    const radii = await page.locator(".graph-node").evaluateAll(nodes => nodes.map(node => {
      const circle = node.querySelector("circle")!;
      return { id: node.getAttribute("data-node-id")!, radius: circle.r.baseVal.value * Math.hypot(circle.getScreenCTM()!.a, circle.getScreenCTM()!.b) };
    }));
    const degrees = new Map<string, number>();
    for (const edge of graph.edges) { degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1); degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1); }
    const nodeScale = Number(defaultNodeScale);
    expect(radii.every(node => node.radius >= 3.2 * nodeScale - .01 && node.radius <= 8 * nodeScale + .01)).toBeTruthy();
    const sorted = radii.sort((x, y) => (degrees.get(x.id) ?? 0) - (degrees.get(y.id) ?? 0));
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].radius + .01).toBeGreaterThanOrEqual(sorted[i - 1].radius);
    const started = performance.now();
    await page.getByRole("button", { name: "查看范围", exact: true }).click();
    const scopeSearch = page.getByRole("combobox", { name: "搜索成员或小组" });
    await expect(scopeSearch).toBeFocused();
    await scopeSearch.fill("不存在的范围");
    await expect(page.locator(".searchable-select-panel").getByRole("status")).toContainText("未找到匹配项");
    await scopeSearch.press("Escape");
    await expect(page.getByRole("button", { name: "查看范围", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "查看范围", exact: true }).click();
    await page.getByRole("combobox", { name: "搜索成员或小组" }).fill(group.name);
    await scopeSearch.press("Enter");
    await expect(page.locator(".graph-meta")).toContainText("当前范围全部节点");
    checks.push(`${width}px 小组范围更新耗时 ${Math.round(performance.now() - started)}ms（小规模合成数据）`);
    await page.getByLabel("搜索节点").fill("历史EEG");
    await writeFile(`${output}/search-${width}.json`, JSON.stringify({ errors, value: await page.getByLabel("搜索节点").inputValue(), meta: await page.locator(".graph-meta").innerText(), scope: await page.getByRole("button", { name: "查看范围", exact: true }).innerText(), dialogs: await page.locator("dialog[open]").allTextContents() }, null, 2));
    await page.screenshot({ path: `${output}/search-${width}.png`, fullPage: true, animations: "disabled" });
    await expect(page.locator(".graph-meta")).toContainText("筛选中"); await expect(page.locator(".graph-node")).toHaveCount(1);
    await page.getByText("图例与来源", { exact: true }).click();
    await page.locator(".graph-node-list summary").click();
    await page.getByRole("button", { name: "工作记录 · 历史EEG实验", exact: true }).click();
    await expect(page.locator(".graph-source-text")).toContainText("虚构记录");
    await page.getByRole("button", { name: "关闭节点详情" }).click();
    const border = await page.locator(".graph-node circle").evaluate(circle => ({ stroke: getComputedStyle(circle).stroke, width: getComputedStyle(circle).strokeWidth }));
    await page.locator(".graph-node circle").click();
    expect(await page.locator(".graph-node.selected circle").evaluate(circle => ({ stroke: getComputedStyle(circle).stroke, width: getComputedStyle(circle).strokeWidth }))).toEqual(border);
    await expect(page.locator(".graph-source-text")).toContainText("虚构记录");
    await page.getByRole("button", { name: "关闭节点详情" }).click();
    await openSettings(page);
    await page.getByLabel("搜索节点").fill("");
    await page.getByRole("combobox", { name: "来源状态", exact: true }).click();
    await page.getByRole("option", { name: "已完成", exact: true }).click();
    await expect(page.locator('.graph-node.task')).toHaveCount(0);
    await page.getByRole("combobox", { name: "来源状态", exact: true }).click();
    await page.getByRole("option", { name: "全部状态", exact: true }).click();
    checks.push(`${width}px 统一下拉样式、范围搜索/空结果、Enter选择、Esc返回焦点与状态切换通过`);
    checks.push(`${width}px 默认${defaultNodeScale}倍、按连接数递增、选中不增加或变黑边框`);
    await page.getByRole("button", { name: "关闭关系图设置", exact: true }).click();
    await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
    const box = await page.locator(".graph-canvas").boundingBox();
    await expect(page.getByRole("button", { name: "放大关系图" })).toHaveCount(0);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Number((await page.locator(".graph-canvas > g").getAttribute("transform"))?.match(/scale\(([^)]+)\)/)?.[1])).toBeGreaterThan(1.1);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
    const zoomedTransform = await page.locator(".graph-canvas > g").getAttribute("transform");
    await page.mouse.move(box!.x + 55, box!.y + 140); await page.mouse.down(); await page.mouse.move(box!.x + 95, box!.y + 180, { steps: 3 }); await page.mouse.up();
    await expect(page.locator(".graph-canvas > g")).not.toHaveAttribute("transform", zoomedTransform!);
    await page.goto(origin + "/graph");
    await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
    await page.locator(".graph-canvas").evaluate(element => element.scrollIntoView({ block: "center" }));
    await expect(page.getByRole("button", { name: /恢复初始视图|放大关系图|缩小关系图|居中显示全部节点/ })).toHaveCount(0);
    const node = page.locator(".graph-node circle").first();
    await node.scrollIntoViewIfNeeded();
    const nodeBox = await node.boundingBox();
    const nodeGroup = page.locator(".graph-node").first(); const initialPosition = await nodeGroup.getAttribute("transform");
    const neighbor = page.locator(".graph-node").nth(2), oldNeighbor = await neighbor.getAttribute("transform");
    await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
    await writeFile(`${output}/hover-${width}.json`, JSON.stringify(await page.evaluate(({ x, y }) => ({ x, y, scroll: scrollY, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 600), nodes: document.querySelectorAll('.graph-node').length, edges: document.querySelectorAll('.graph-edge').length, highlights: document.querySelectorAll('.graph-edge.highlighted').length }), { x: nodeBox!.x + nodeBox!.width / 2, y: nodeBox!.y + nodeBox!.height / 2 }), null, 2));
    await page.screenshot({ path: `${output}/hover-${width}.png`, fullPage: true, animations: "disabled" });
    await expect(page.locator(".graph-edge.highlighted").first()).toBeVisible();
    expect(await page.locator(".graph-edge.highlighted").first().evaluate(element => getComputedStyle(element).strokeWidth)).toBe("0.6px");
    expect(await page.locator(".graph-node circle").first().evaluate(element => getComputedStyle(element).stroke)).toBe("none");
    expect(await page.locator(".graph-node text").first().evaluate(element => {
      const edge = [...document.querySelectorAll(".graph-edge")].at(-1)!;
      return { stroke: getComputedStyle(element).stroke, aboveEdges: Boolean(edge.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) };
    })).toEqual({ stroke: "none", aboveEdges: true });
    await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.move(nodeBox!.x + 60, nodeBox!.y + 50, { steps: 6 });
    await expect(nodeGroup).not.toHaveAttribute("transform", initialPosition!);
    await expect(neighbor).not.toHaveAttribute("transform", oldNeighbor!);
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await expect(page.locator(".graph-canvas > g")).toHaveAttribute("transform", "translate(0,0) scale(1)");
    await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
    const canvasBox = await page.locator(".graph-canvas").boundingBox();
    await page.mouse.move(canvasBox!.x + 12, canvasBox!.y + 12);
    await page.mouse.wheel(0, 800);
    await expect.poll(async () => Number(await page.locator(".graph-node text").first().getAttribute("opacity"))).toBeLessThan(.3);
    await page.mouse.wheel(0, -800);
    await expect.poll(async () => Number(await page.locator(".graph-node text").first().getAttribute("opacity"))).toBeGreaterThan(.9);
    if (width === 390) {
      const session = await a.newCDPSession(page);
      const x = canvasBox!.x + canvasBox!.width / 2, y = canvasBox!.y + canvasBox!.height / 2;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 0 }, { x: x + 30, y, id: 1 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 70, y, id: 0 }, { x: x + 70, y, id: 1 }] });
      await expect.poll(async () => Number((await page.locator(".graph-canvas > g").getAttribute("transform"))?.match(/scale\(([^)]+)\)/)?.[1])).toBeGreaterThan(1.5);
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach();
      checks.push("390px 真实双指触控事件缩放通过");
    }
    await page.goto(origin + "/graph");
    await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (fixture) {
      await page.goto(origin + "/graph");
      await page.locator('[data-edge-id^="course/"]').first().focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("complementary", { name: "关联详情" })).toContainText("测试信号处理");
      await expect(page.getByRole("complementary", { name: "关联详情" })).toContainText("共同周次：1、3、5");
      await page.getByRole("button", { name: "关闭关联详情" }).click();
      await page.locator('[data-edge-id^="ai/"]').first().focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("complementary", { name: "关联详情" })).toContainText("两项均明确使用CSP方法");
      await page.getByLabel("关联不准确？请说明理由").fill("测试反馈：不能只因方法名称相同判断内容相关");
      await page.getByRole("button", { name: "提交不准确反馈" }).click();
      await expect(page.getByRole("complementary", { name: "关联详情" })).toContainText("已记录，不会立即修改公共关系图。");
      expect((await api(a, "/api/graph")).edges.some((e: { kind: string }) => e.kind === "inferred")).toBeTruthy();
      await page.screenshot({ path: `${output}/relation-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: "关闭关联详情" }).click();
      checks.push(`${width}px 同课详情、AI线证据、键盘选择及反馈不修改公共图（隔离模拟提供方）`);
    }
    await page.screenshot({ path: `${output}/graph-${width}.png`, fullPage: true });
    checks.push(`${width}px 全量自然布局、范围、搜索、状态、历史来源、滚轮缩放不滚页面、平移、节点牵动邻居、悬停高亮、文字渐隐、无恢复/加减按钮及无横向溢出`);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin + "/graph");
  await expect(page.locator(".graph-canvas")).toHaveAttribute("data-layout-state", "settled");
  await expect.poll(async () => page.locator(".graph-canvas > g").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  checks.push("减少动态效果模式直接显示稳定完整图，不播放展开动画");
  if (fixture && currentWork) {
    await page.goto(origin + "/graph");
    const graph = await api(a, "/api/graph"), edge = graph.edges.find((e: { kind: string }) => e.kind === "inferred");
    await page.locator('[data-edge-id^="ai/"]').first().focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "关联详情" })).toBeVisible();
    expect((await b.request.delete(`${origin}/api/my/work/${currentWork.id}`, { headers: { origin }, data: { expectedRevision: 1 } })).ok()).toBeTruthy();
    await expect(page.getByRole("complementary", { name: "关联详情" })).toHaveCount(0, { timeout: 22000 });
    expect((await a.request.post(origin + "/api/graph/feedback", { headers: { origin }, data: { edgeId: edge.id, version: graph.version, reason: "过期反馈" } })).status()).toBe(409);
    checks.push("删除当前AI依据后，虚线及打开的关联详情自动消失，旧版本反馈409（隔离模拟提供方）");
  }
  await openSettings(page);
  await page.getByRole("button", { name: "查看范围", exact: true }).click();
  await page.getByRole("option", { name: "全体成员", exact: true }).click();
  await expect(page.locator(".graph-meta")).toContainText("当前范围全部节点");
  await page.getByLabel("搜索节点").fill("历史EEG");
  if (!(await page.locator(".graph-node-list summary").isVisible())) await page.getByText("图例与来源", { exact: true }).click();
  if (await page.locator(".graph-node-list").getAttribute("open") === null) await page.locator(".graph-node-list summary").click();
  await page.getByRole("button", { name: "工作记录 · 历史EEG实验", exact: true }).click();
  await expect(page.locator(".graph-source-text")).toBeVisible();
  const deleted = await b.request.delete(`${origin}/api/my/work/${work.id}`, { headers: { origin }, data: { expectedRevision: 1 } }); expect(deleted.ok()).toBeTruthy();
  await expect(page.locator(".graph-source-text")).toHaveCount(0, { timeout: 22000 });
  expect((await a.request.get(`${origin}/api/graph/sources/work:${work.id}`)).status()).toBe(404);
  checks.push("另一成员删除后，打开的旧原文与节点自动失效，来源返回404");
  await page.goto(origin + "/tasks/new");
  await expect(page.getByRole("button", { name: "推荐候选人", exact: true })).toHaveCount(0);
  expect((await a.request.post(origin + "/api/graph/recommendations", { headers: { origin }, data: { title: "演示任务", description: "演示要求" } })).status()).toBe(404);
  checks.push("候选推荐入口和接口已移除，任务继续手动选择");
  // Synthetic scale probe, separate from release performance acceptance.
  await sql`insert into member_work_records (student_id, title, description, status, completed_at)
    select ${bid}, '规模记录' || lpad(n::text, 4, '0'), '仅供全量图规模验证的虚构记录。', 'completed', now() - interval '9 days'
    from generate_series(1, 1000) as n`;
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) { const started = performance.now(); await api(a, "/api/graph"); samples.push(performance.now() - started); }
  const large = await api(a, "/api/graph");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const started = performance.now(); await page.goto(origin + "/graph");
    await expect(page.locator(".graph-node")).toHaveCount(large.nodes.length);
    const layoutMs = Math.round(performance.now() - started);
    await openSettings(page);
    await page.getByLabel("搜索节点").fill("规模记录0007");
    await expect(page.locator(".graph-node")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    checks.push(`${width}px 1000条合成历史全量${large.nodes.length}节点，导航至绘制${layoutMs}ms，搜索无截断/无横向溢出`);
  }
  samples.sort((x, y) => x - y);
  checks.push(`1000条合成历史本机10次顺序API请求P95 ${Math.round(samples[Math.ceil(samples.length * .95) - 1])}ms；非持续负载或正式规模验收`);
  const guest = await browser.newContext(); await guest.request.post(`${origin}/api/guest-session`);
  expect((await guest.request.get(origin + "/api/graph")).status()).toBe(403);
  const gp = await guest.newPage(); await gp.goto(origin + "/graph"); await gp.waitForURL("**/dashboard");
  await gp.goto(origin + "/registration"); await gp.waitForURL("**/dashboard");
  await expect(gp.getByRole("link", { name: "工作关系图", exact: true })).toHaveCount(0);
  const anonymous = await browser.newContext(); expect((await anonymous.request.get(origin + "/api/graph")).status()).toBe(401);
  const anonymousPage = await anonymous.newPage(); await anonymousPage.goto(origin + "/registration"); await anonymousPage.waitForURL(/\/login\?next=/);
  checks.push("游客/匿名不能读取注册情况页面");
  checks.push("游客图/API/导航拒绝，匿名API401");
  expect(errors).toEqual([]);
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, source: "isolated synthetic database; recommendation removed", taskId: task.id }, null, 2));
  process.stdout.write(JSON.stringify({ checks, errors }));
} finally {
  await browser?.close();
  server.kill(); await new Promise((resolve) => { if (server.exitCode !== null) resolve(null); else server.once("exit", resolve); });
  await sql.end();
  if (/^schedule_v3_browser_\d+$/.test(database)) await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
