import assert from "node:assert/strict";
import test from "node:test";
import { parseVisionSchedule, visionCoursesToDrafts } from "./schedule-vision.ts";

test("解析智能识别 JSON 并映射为可编辑课程草稿", () => {
  const courses = parseVisionSchedule(`\`\`\`json
  {"courses":[{"name":"计算机网络","teacher":"魏丹","location":"综合楼6204","weekday":1,"startPeriod":1,"endPeriod":2,"weeks":"1-18周","note":"理论","confidence":0.92,"evidence":"周一第1-2节","uncertainFields":[]}]}
  \`\`\``);
  const [draft] = visionCoursesToDrafts(courses);
  assert.equal(draft.record["课程名称"], "计算机网络");
  assert.equal(draft.record["星期"], "周一");
  assert.equal(draft.record["开始节次"], "1");
  assert.equal(draft.record["结束节次"], "2");
  assert.equal(draft.record["周次"], "1-18");
  assert.equal(draft.confidence, 92);
  assert.deepEqual(draft.reviewFields, []);
});

test("无法确定和低置信度字段会进入人工复核列表", () => {
  const [draft] = visionCoursesToDrafts(parseVisionSchedule(JSON.stringify({
    courses: [{
      name: "数据结构", teacher: "", location: "", weekday: 4,
      startPeriod: null, endPeriod: null, weeks: "", note: "",
      confidence: 0.61, evidence: "数据结构", uncertainFields: ["location", "periods", "weeks"],
    }],
  })));
  assert.equal(draft.record["星期"], "周四");
  assert.deepEqual(new Set(draft.reviewFields), new Set(["地点", "开始节次", "结束节次", "周次"]));
});

test("拒绝超出合法课表范围的模型输出", () => {
  assert.throws(() => parseVisionSchedule('{"courses":[{"name":"错误","weekday":8,"startPeriod":1,"endPeriod":2}]}'));
});
