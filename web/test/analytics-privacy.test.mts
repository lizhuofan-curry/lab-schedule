import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("统计仅发送归类路径与固定事件，不发送身份、标题、参数和正文", async () => {
  const window = { location: { origin: "https://schedule.henubci.cn", hostname: "schedule.henubci.cn" }, henuAnalyticsBeforeSend: undefined as unknown as (type: string, payload: unknown) => Record<string, unknown> | false };
  vm.runInNewContext(await readFile("public/analytics-privacy.js", "utf-8"), { window, URL, document: { addEventListener() {} } });
  const payload = { website: "test-site", url: "/tasks/123?name=真实姓名#secret", title: "私有任务标题", referrer: "https://example.com/?token=private", name: "task_create", data: { studentNo: "123456", body: "私有正文" }, id: "user-private", screen: "390x844", language: "zh-CN" };
  const clean = window.henuAnalyticsBeforeSend("event", payload);
  assert.ok(clean);
  assert.equal(clean.url, "/tasks/:id");
  assert.equal(clean.title, "HenuBCI");
  assert.equal(clean.referrer, "");
  assert.equal(clean.name, "task_create");
  assert.doesNotMatch(JSON.stringify(clean), /真实姓名|私有|123456|user-private|token/);
  assert.equal(window.henuAnalyticsBeforeSend("identify", payload), false);
  assert.equal(window.henuAnalyticsBeforeSend("event", { ...payload, name: "真实姓名" }), false);
  const unknown = window.henuAnalyticsBeforeSend("event", { ...payload, url: "/members/真实姓名", name: undefined });
  assert.ok(unknown);
  assert.equal(unknown.url, "/other");
});

test("点击统计在收集接口不响应时不等待或阻止导航", async () => {
  let handler: ((event: unknown) => void) | undefined;
  let calls = 0;
  const window = { location: { origin: "https://schedule.henubci.cn", hostname: "schedule.henubci.cn" }, umami: { track() { calls++; return new Promise(() => {}); } } };
  class Element {
    closest() { return this; }
    getAttribute() { return "nav_groups"; }
  }
  const document = { addEventListener(_name: string, listener: typeof handler) { handler = listener; } };
  vm.runInNewContext(await readFile("public/analytics-privacy.js", "utf-8"), { window, URL, document, Element, Promise });
  assert.ok(handler);
  let prevented = false;
  const result = handler({ target: new Element(), preventDefault() { prevented = true; } });
  assert.equal(result, undefined);
  assert.equal(calls, 1);
  assert.equal(prevented, false);
});
