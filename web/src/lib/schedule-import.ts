import { courseInputSchema, type CourseInput } from "./course-schema.ts";
import { coursesConflict, coursesDuplicate, normalizeWeeks } from "./course-rules.ts";

export const importHeaders = ["课程名称", "教师", "地点", "星期", "开始节次", "结束节次", "周次", "备注", "颜色"] as const;
export type ImportHeader = typeof importHeaders[number];
export type ImportRecord = Record<ImportHeader, string>;

export type ImportPreviewRow = {
  rowNumber: number;
  raw: ImportRecord;
  course: CourseInput | null;
  errors: string[];
};

const weekdayNames = new Map([
  ["1", 1], ["周一", 1], ["星期一", 1],
  ["2", 2], ["周二", 2], ["星期二", 2],
  ["3", 3], ["周三", 3], ["星期三", 3],
  ["4", 4], ["周四", 4], ["星期四", 4],
  ["5", 5], ["周五", 5], ["星期五", 5],
  ["6", 6], ["周六", 6], ["星期六", 6],
  ["7", 7], ["周日", 7], ["星期日", 7], ["周天", 7], ["星期天", 7],
]);

export function parseWeekday(value: string) {
  return weekdayNames.get(value.trim());
}

export function parseWeeks(value: string, weekCount: number) {
  const cleaned = value.trim().replace(/^第/, "").replace(/周$/g, "");
  if (!cleaned) throw new Error("请填写周次");
  const result: number[] = [];
  for (const rawPart of cleaned.split(/[，,、;；\s]+/).filter(Boolean)) {
    const part = rawPart.replace(/周/g, "");
    const match = part.match(/^(\d+)(?:-(\d+))?(单|双)?$/);
    if (!match) throw new Error(`无法识别周次“${rawPart}”`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > weekCount) throw new Error(`周次必须在 1-${weekCount} 周内`);
    for (let week = start; week <= end; week += 1) {
      if (match[3] === "单" && week % 2 === 0) continue;
      if (match[3] === "双" && week % 2 === 1) continue;
      result.push(week);
    }
  }
  return normalizeWeeks(result);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (quoted) {
      if (character === '"' && normalized[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

export function recordsFromRows(rows: string[][]): ImportRecord[] {
  const header = rows[0]?.map((value) => value.trim()) ?? [];
  const missing = importHeaders.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`模板缺少列：${missing.join("、")}`);
  return rows.slice(1).map((values) => Object.fromEntries(importHeaders.map((name) => [name, values[header.indexOf(name)]?.trim() ?? ""])) as ImportRecord);
}

const pastedHeaderAliases: Record<ImportHeader, string[]> = {
  "课程名称": ["课程名称", "课程名", "课程"],
  "教师": ["教师", "任课教师", "授课教师"],
  "地点": ["地点", "上课地点", "教室"],
  "星期": ["星期", "周几", "上课星期"],
  "开始节次": ["开始节次", "起始节次"],
  "结束节次": ["结束节次", "终止节次"],
  "周次": ["周次", "上课周次"],
  "备注": ["备注", "说明"],
  "颜色": ["颜色"],
};

function normalizedHeader(value: string) {
  return value.trim().replace(/\s+/g, "").replace(/[：:]/g, "");
}

function headerIndex(header: string[], aliases: string[]) {
  const normalized = header.map(normalizedHeader);
  return aliases.map(normalizedHeader).map((alias) => normalized.indexOf(alias)).find((index) => index >= 0) ?? -1;
}

function cleanCourseName(value: string) {
  return value.trim().replace(/^\[[^\]]+\]\s*/, "");
}

function weekdayText(value: string) {
  const map: Record<string, string> = { 一: "周一", 二: "周二", 三: "周三", 四: "周四", 五: "周五", 六: "周六", 日: "周日", 天: "周日" };
  return map[value] ?? value;
}

/**
 * 解析从 Excel 或教务系统结果表直接复制的文本。
 * 支持制表符表格、CSV，以及“1-18周 五[3-5] 教室”形式的组合上课时间列。
 */
export function recordsFromPastedText(text: string): ImportRecord[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("请先粘贴包含表头和课程数据的表格");
  const rows = trimmed.includes("\t")
    ? trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split("\t").map((cell) => cell.trim()))
    : parseCsv(trimmed);
  const header = rows[0] ?? [];
  const courseIndex = headerIndex(header, pastedHeaderAliases["课程名称"]);
  if (courseIndex < 0) throw new Error("没有找到“课程”或“课程名称”列，请连同表头一起复制");

  const indices = Object.fromEntries(importHeaders.map((name) => [name, headerIndex(header, pastedHeaderAliases[name])])) as Record<ImportHeader, number>;
  const combinedPeriodIndex = headerIndex(header, ["节次", "上课节次"]);
  const combinedScheduleIndex = headerIndex(header, ["上课时间/上课地点", "上课时间与地点", "上课时间地点", "上课安排"]);
  const hasSeparateSchedule = indices["星期"] >= 0 && indices["周次"] >= 0
    && ((indices["开始节次"] >= 0 && indices["结束节次"] >= 0) || combinedPeriodIndex >= 0);
  if (!hasSeparateSchedule && combinedScheduleIndex < 0) {
    throw new Error("缺少上课安排列：请提供星期、周次和节次，或“上课时间/上课地点”列");
  }

  const result: ImportRecord[] = [];
  for (const values of rows.slice(1)) {
    const name = cleanCourseName(values[courseIndex] ?? "");
    if (!name && values.every((value) => !value.trim())) continue;
    const base = Object.fromEntries(importHeaders.map((key) => [key, indices[key] >= 0 ? values[indices[key]]?.trim() ?? "" : ""])) as ImportRecord;
    base["课程名称"] = name;

    if (combinedScheduleIndex >= 0) {
      const scheduleText = values[combinedScheduleIndex] ?? "";
      const pattern = /(\d+)\s*-\s*(\d+)\s*周?\s*(单|双)?\s*[周星期]?\s*([一二三四五六日天1-7])\s*\[\s*(\d+)\s*-\s*(\d+)\s*\]\s*([^;；]*)/g;
      const matches = [...scheduleText.matchAll(pattern)];
      if (matches.length === 0) {
        result.push({ ...base, "周次": scheduleText });
        continue;
      }
      for (const match of matches) {
        result.push({
          ...base,
          "周次": `${match[1]}-${match[2]}${match[3] ?? ""}`,
          "星期": weekdayText(match[4]),
          "开始节次": match[5],
          "结束节次": match[6],
          "地点": (match[7] || base["地点"]).trim().replace(/\s*\(\d+\)\s*$/, ""),
        });
      }
      continue;
    }

    if (combinedPeriodIndex >= 0) {
      const period = (values[combinedPeriodIndex] ?? "").match(/(\d+)\s*[-~至]\s*(\d+)/);
      if (period) { base["开始节次"] = period[1]; base["结束节次"] = period[2]; }
    }
    result.push(base);
  }
  if (result.length === 0) throw new Error("表格中没有课程数据");
  return result;
}

export function validateImportRecords(records: ImportRecord[], semesterId: number, weekCount: number, validPeriodNos: number[]) {
  const rows: ImportPreviewRow[] = records.map((raw, index) => {
    const errors: string[] = [];
    const weekday = parseWeekday(raw["星期"]);
    if (!weekday) errors.push("星期请填写周一至周日或数字 1-7");
    let weeks: number[] = [];
    try { weeks = parseWeeks(raw["周次"], weekCount); } catch (error) { errors.push(error instanceof Error ? error.message : "周次格式错误"); }
    const startPeriod = Number(raw["开始节次"]);
    const endPeriod = Number(raw["结束节次"]);
    if (!Number.isInteger(startPeriod) || !validPeriodNos.includes(startPeriod)) errors.push("开始节次不存在");
    if (!Number.isInteger(endPeriod) || !validPeriodNos.includes(endPeriod)) errors.push("结束节次不存在");
    const candidate = {
      semesterId,
      name: raw["课程名称"],
      teacher: raw["教师"] || null,
      location: raw["地点"] || null,
      weekday: weekday ?? 0,
      startPeriod,
      endPeriod,
      weeks,
      note: raw["备注"] || null,
      color: raw["颜色"] || "#dce8e3",
    };
    const parsed = courseInputSchema.safeParse(candidate);
    if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
    return { rowNumber: index + 2, raw, course: parsed.success ? { ...parsed.data, weeks: normalizeWeeks(parsed.data.weeks) } : null, errors: [...new Set(errors)] };
  });

  for (let left = 0; left < rows.length; left += 1) {
    if (!rows[left].course) continue;
    for (let right = left + 1; right < rows.length; right += 1) {
      if (!rows[right].course) continue;
      const a = rows[left].course!;
      const b = rows[right].course!;
      if (coursesDuplicate(a, b)) {
        rows[left].errors.push(`与第 ${rows[right].rowNumber} 行重复`);
        rows[right].errors.push(`与第 ${rows[left].rowNumber} 行重复`);
      } else if (coursesConflict(a, b)) {
        rows[left].errors.push(`与第 ${rows[right].rowNumber} 行时间冲突`);
        rows[right].errors.push(`与第 ${rows[left].rowNumber} 行时间冲突`);
      }
    }
  }
  return rows;
}

function comparable(course: CourseInput) {
  return JSON.stringify({
    name: course.name.trim(), teacher: course.teacher || null, location: course.location || null,
    weekday: course.weekday, startPeriod: course.startPeriod, endPeriod: course.endPeriod,
    weeks: normalizeWeeks(course.weeks), note: course.note || null, color: course.color,
  });
}

export function summarizeImportDiff(imported: CourseInput[], existing: CourseInput[]) {
  const importedKeys = new Set(imported.map(comparable));
  const existingKeys = new Set(existing.map(comparable));
  return {
    added: imported.filter((course) => !existingKeys.has(comparable(course))).length,
    unchanged: imported.filter((course) => existingKeys.has(comparable(course))).length,
    removed: existing.filter((course) => !importedKeys.has(comparable(course))).length,
  };
}
