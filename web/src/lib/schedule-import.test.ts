import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseWeeks, recordsFromRows, summarizeImportDiff, validateImportRecords } from "./schedule-import.ts";

test("周次支持范围、单双周与离散周", () => {
  assert.deepEqual(parseWeeks("1-6单, 8, 10-12双", 18), [1, 3, 5, 8, 10, 12]);
});

test("CSV 支持带逗号和双引号的单元格", () => {
  const rows = parseCsv('课程名称,教师,地点,星期,开始节次,结束节次,周次,备注,颜色\r\n"机器学习,实验",张老师,A101,周一,1,2,1-18,"含""引号""",#dce8e3');
  const records = recordsFromRows(rows);
  assert.equal(records[0]["课程名称"], "机器学习,实验");
  assert.equal(records[0]["备注"], '含"引号"');
});

test("导入预览会同时标记冲突的两行", () => {
  const base = { "教师": "", "地点": "", "星期": "周一", "周次": "1-18", "备注": "", "颜色": "#dce8e3" };
  const rows = validateImportRecords([
    { ...base, "课程名称": "课程 A", "开始节次": "1", "结束节次": "2" },
    { ...base, "课程名称": "课程 B", "开始节次": "2", "结束节次": "3" },
  ], 1, 18, Array.from({ length: 13 }, (_, index) => index + 1));
  assert.match(rows[0].errors.join(""), /冲突/);
  assert.match(rows[1].errors.join(""), /冲突/);
});

test("导入差异区分新增、保留和删除", () => {
  const course = { semesterId: 1, name: "A", teacher: null, location: null, weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1], note: null, color: "#dce8e3" };
  assert.deepEqual(summarizeImportDiff([course, { ...course, name: "B" }], [course, { ...course, name: "C" }]), { added: 1, unchanged: 1, removed: 1 });
});
