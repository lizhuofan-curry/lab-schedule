import assert from "node:assert/strict";
import test from "node:test";
import { draftsFromOcrLines } from "./image-ocr.ts";

test("OCR 候选会提取周次、星期、节次和地点", () => {
  const [draft] = draftsFromOcrLines([{ text: "计算机网络 1-18周 周一 1-2节 金明综合楼6204", confidence: 87.4 }]);
  assert.equal(draft.record["课程名称"], "计算机网络");
  assert.equal(draft.record["周次"], "1-18周");
  assert.equal(draft.record["星期"], "周一");
  assert.equal(draft.record["开始节次"], "1");
  assert.equal(draft.record["结束节次"], "2");
  assert.equal(draft.record["地点"], "金明综合楼6204");
  assert.equal(draft.confidence, 87);
});

test("OCR 候选会忽略时间、星期标题并去重", () => {
  const drafts = draftsFromOcrLines([
    { text: "08:00-08:45", confidence: 99 },
    { text: "周一", confidence: 99 },
    { text: "数据结构", confidence: 80 },
    { text: "数据结构", confidence: 70 },
  ]);
  assert.deepEqual(drafts.map((item) => item.record["课程名称"]), ["数据结构"]);
});
