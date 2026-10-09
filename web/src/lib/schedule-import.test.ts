import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseWeeks, recordsFromPastedText, recordsFromRows, summarizeImportDiff, validateImportRecords } from "./schedule-import.ts";

test("ExcelJS安全依赖更新后，含扩展条件格式的中文课表仍能写入和读取", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("课表");
  sheet.addRows([["课程名称", "开始节次"], ["机器学习", 1], ["计算机网络", 3]]);
  // Extended data-bar formatting exercises ExcelJS's CommonJS uuid.v4 path.
  sheet.addConditionalFormatting({ ref: "B2:B3", rules: [{ type: "dataBar", priority: 1, gradient: false, cfvo: [{ type: "min" }, { type: "max" }] }] });
  const bytes = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  assert.equal(restored.getWorksheet("课表")?.getCell("A2").value, "机器学习");
  assert.equal(restored.getWorksheet("课表")?.getCell("B3").value, 3);
});

test("周次支持范围、单双周与离散周", () => {
  assert.deepEqual(parseWeeks("1-6单, 8, 10-12双", 18), [1, 3, 5, 8, 10, 12]);
  assert.deepEqual(parseWeeks("1-18周(单)", 18), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(parseWeeks("1-18周（双）", 18), [2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test("非法周次只返回可操作的中文提示", () => {
  const [row] = validateImportRecords([{
    "课程名称": "网络管理与测试", "教师": "", "地点": "", "星期": "周三",
    "开始节次": "3", "结束节次": "4", "周次": "奇数周", "备注": "", "颜色": "#dce8e3",
  }], 1, 18, Array.from({ length: 13 }, (_, index) => index + 1));
  assert.equal(row.errors.length, 1);
  assert.match(row.errors[0], /周次格式错误.*1-18单/);
  assert.doesNotMatch(row.errors[0], /Too small|expected array/i);
});

test("CSV 支持带逗号和双引号的单元格", () => {
  const rows = parseCsv('课程名称,教师,地点,星期,开始节次,结束节次,周次,备注,颜色\r\n"机器学习,实验",张老师,A101,周一,1,2,1-18,"含""引号""",#dce8e3');
  const records = recordsFromRows(rows);
  assert.equal(records[0]["课程名称"], "机器学习,实验");
  assert.equal(records[0]["备注"], '含"引号"');
});

test("可解析从教务结果页复制的组合上课时间表格", () => {
  const records = recordsFromPastedText([
    "课程\t任课教师\t上课时间/上课地点",
    "[04500027]数字通信原理\t蒋磊\t1-18周 四[11-12] 金明综合楼6202(134)",
  ].join("\n"));
  assert.deepEqual(records[0], {
    "课程名称": "数字通信原理", "教师": "蒋磊", "地点": "金明综合楼6202", "星期": "周四",
    "开始节次": "11", "结束节次": "12", "周次": "1-18", "备注": "", "颜色": "",
  });
});

test("一门课程的多个上课安排会拆成多条待导入课程", () => {
  const records = recordsFromPastedText([
    "课程名称\t教师\t上课时间/上课地点",
    "网络管理与测试\t程普\t1-18周 二[1-2] 金明综合楼2103；1-18周 三[3-4] 金明综合楼2103",
  ].join("\n"));
  assert.equal(records.length, 2);
  assert.equal(records[0]["星期"], "周二");
  assert.equal(records[1]["星期"], "周三");
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
