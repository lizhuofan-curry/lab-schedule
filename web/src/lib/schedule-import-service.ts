import "server-only";

import ExcelJS from "exceljs";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, courses, courseSnapshots, periods, scheduleVersions, semesters, students } from "@/db/schema";
import { courseInputSchema } from "@/lib/course-schema";
import { coursesConflict, coursesDuplicate } from "@/lib/course-rules";
import { importHeaders, parseCsv, recordsFromRows, summarizeImportDiff, validateImportRecords, type ImportRecord } from "@/lib/schedule-import";
import type { CurrentMember } from "@/lib/server-auth";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 200;

export class ScheduleImportError extends Error {
  constructor(public code: "FILE_INVALID" | "IMPORT_INVALID" | "SEMESTER_NOT_FOUND", message: string) { super(message); }
}

function cellText(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined) return String(value.result);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
  }
  return String(value);
}

async function recordsFromFile(file: File): Promise<{ source: "csv" | "xlsx"; records: ImportRecord[] }> {
  if (file.size === 0) throw new ScheduleImportError("FILE_INVALID", "文件为空，请重新选择模板文件。");
  if (file.size > MAX_FILE_BYTES) throw new ScheduleImportError("FILE_INVALID", "文件不能超过 2 MB，请删除无关工作表或图片后重试。");
  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows: string[][];
  if (extension === "csv") {
    rows = parseCsv(new TextDecoder("utf-8").decode(await file.arrayBuffer()));
  } else if (extension === "xlsx") {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer() as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("NO_WORKSHEET");
      rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? row.values : [];
        rows.push(values.slice(1).map((value) => cellText(value as ExcelJS.CellValue)));
      });
    } catch {
      throw new ScheduleImportError("FILE_INVALID", "Excel 文件无法读取，请确认文件未损坏且扩展名为 .xlsx。");
    }
  } else {
    throw new ScheduleImportError("FILE_INVALID", "仅支持 .xlsx 或 .csv 文件，请先下载标准模板。");
  }
  try {
    const records = recordsFromRows(rows);
    if (records.length === 0) throw new Error("模板中没有课程数据");
    if (records.length > MAX_IMPORT_ROWS) throw new Error(`一次最多导入 ${MAX_IMPORT_ROWS} 门课程`);
    return { source: extension, records } as { source: "csv" | "xlsx"; records: ImportRecord[] };
  } catch (error) {
    throw new ScheduleImportError("FILE_INVALID", error instanceof Error ? error.message : "无法读取模板内容。");
  }
}

async function currentConfiguration() {
  const [semester] = await db.select({ id: semesters.id, name: semesters.name, weekCount: semesters.weekCount })
    .from(semesters).where(eq(semesters.isCurrent, true)).limit(1);
  if (!semester) throw new ScheduleImportError("SEMESTER_NOT_FOUND", "当前学期尚未配置，暂时不能导入。");
  const periodRows = await db.select({ periodNo: periods.periodNo }).from(periods)
    .where(eq(periods.semesterId, semester.id)).orderBy(asc(periods.periodNo));
  return { semester, periodNos: periodRows.map((item) => item.periodNo) };
}

function courseSelection() {
  return {
    semesterId: courses.semesterId, name: courses.name, teacher: courses.teacher,
    location: courses.location, weekday: courses.weekday, startPeriod: courses.startPeriod,
    endPeriod: courses.endPeriod, weeks: courses.weeks, note: courses.note, color: courses.color,
  };
}

export async function previewScheduleImport(file: File, member: CurrentMember) {
  const [{ source, records }, config] = await Promise.all([recordsFromFile(file), currentConfiguration()]);
  const rows = validateImportRecords(records, config.semester.id, config.semester.weekCount, config.periodNos);
  const existing = await db.select(courseSelection()).from(courses)
    .where(and(eq(courses.studentId, member.studentId), eq(courses.semesterId, config.semester.id)));
  const validCourses = rows.filter((row) => row.course && row.errors.length === 0).map((row) => row.course!);
  return {
    source,
    fileName: file.name,
    semester: config.semester,
    rows,
    validCourses,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
    diff: summarizeImportDiff(validCourses, existing),
  };
}

function validateConfirmedCourses(input: unknown[], semesterId: number, weekCount: number, periodNos: number[]) {
  if (input.length === 0 || input.length > MAX_IMPORT_ROWS) throw new ScheduleImportError("IMPORT_INVALID", `请导入 1-${MAX_IMPORT_ROWS} 门课程。`);
  const parsed = input.map((course, index) => {
    const result = courseInputSchema.safeParse(course);
    if (!result.success) throw new ScheduleImportError("IMPORT_INVALID", `第 ${index + 1} 门课程无效：${result.error.issues[0]?.message ?? "数据错误"}`);
    if (result.data.semesterId !== semesterId) throw new ScheduleImportError("IMPORT_INVALID", "导入数据的学期已变化，请重新预览文件。");
    if (result.data.weeks.some((week) => week > weekCount)) throw new ScheduleImportError("IMPORT_INVALID", "周次超出当前学期范围，请重新预览。");
    if (!periodNos.includes(result.data.startPeriod) || !periodNos.includes(result.data.endPeriod)) throw new ScheduleImportError("IMPORT_INVALID", "节次不存在，请重新预览。");
    return result.data;
  });
  for (let left = 0; left < parsed.length; left += 1) {
    for (let right = left + 1; right < parsed.length; right += 1) {
      if (coursesDuplicate(parsed[left], parsed[right]) || coursesConflict(parsed[left], parsed[right])) {
        throw new ScheduleImportError("IMPORT_INVALID", `第 ${left + 1} 门与第 ${right + 1} 门课程重复或冲突，请修改文件后重新预览。`);
      }
    }
  }
  return parsed;
}

export async function confirmScheduleImport({ member, source, fileName, imported }: {
  member: CurrentMember;
  source: "csv" | "xlsx";
  fileName: string;
  imported: unknown[];
}) {
  const config = await currentConfiguration();
  const normalized = validateConfirmedCourses(imported, config.semester.id, config.semester.weekCount, config.periodNos);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${students.id} from ${students} where ${students.id} = ${member.studentId} for update`);
    const [latest] = await tx.select({ versionNo: scheduleVersions.versionNo }).from(scheduleVersions)
      .where(and(eq(scheduleVersions.studentId, member.studentId), eq(scheduleVersions.semesterId, config.semester.id)))
      .orderBy(desc(scheduleVersions.versionNo)).limit(1);
    const before = await tx.select(courseSelection()).from(courses)
      .where(and(eq(courses.studentId, member.studentId), eq(courses.semesterId, config.semester.id)));
    const [version] = await tx.insert(scheduleVersions).values({
      studentId: member.studentId,
      semesterId: config.semester.id,
      versionNo: (latest?.versionNo ?? 0) + 1,
      source,
      fileName: fileName.slice(0, 255),
      courseCount: normalized.length,
      createdByUserId: member.userId,
    }).returning({ id: scheduleVersions.id, versionNo: scheduleVersions.versionNo, createdAt: scheduleVersions.createdAt });
    await tx.insert(courseSnapshots).values(normalized.map((course) => ({
      scheduleVersionId: version.id,
      name: course.name, teacher: course.teacher, location: course.location, weekday: course.weekday,
      startPeriod: course.startPeriod, endPeriod: course.endPeriod, weeks: course.weeks,
      note: course.note, color: course.color,
    })));
    await tx.delete(courses).where(and(eq(courses.studentId, member.studentId), eq(courses.semesterId, config.semester.id)));
    await tx.insert(courses).values(normalized.map((course) => ({ ...course, studentId: member.studentId })));
    await tx.insert(auditLogs).values({
      actorUserId: member.userId,
      action: "schedule.import.replace",
      entityType: "schedule_version",
      entityId: String(version.id),
      before: JSON.stringify(before),
      after: JSON.stringify({ source, fileName, courseCount: normalized.length, versionNo: version.versionNo }),
    });
    return version;
  });
}

export async function getScheduleImportHistory(studentId: number) {
  const config = await currentConfiguration();
  return db.select({
    id: scheduleVersions.id,
    versionNo: scheduleVersions.versionNo,
    source: scheduleVersions.source,
    fileName: scheduleVersions.fileName,
    courseCount: scheduleVersions.courseCount,
    createdAt: scheduleVersions.createdAt,
  }).from(scheduleVersions)
    .where(and(eq(scheduleVersions.studentId, studentId), eq(scheduleVersions.semesterId, config.semester.id)))
    .orderBy(desc(scheduleVersions.versionNo));
}

export async function getScheduleVersion(studentId: number, versionId: number) {
  const [version] = await db.select().from(scheduleVersions)
    .where(and(eq(scheduleVersions.id, versionId), eq(scheduleVersions.studentId, studentId))).limit(1);
  if (!version) return null;
  const snapshots = await db.select().from(courseSnapshots)
    .where(eq(courseSnapshots.scheduleVersionId, version.id)).orderBy(asc(courseSnapshots.weekday), asc(courseSnapshots.startPeriod));
  return { version, snapshots };
}

export async function createImportTemplate(format: "csv" | "xlsx") {
  const example = ["机器学习", "张老师", "金明综合楼2101", "周一", "1", "2", "1-18", "示例行可删除", "#dce8e3"];
  if (format === "csv") {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    return Buffer.from(`\uFEFF${importHeaders.map(escape).join(",")}\r\n${example.map(escape).join(",")}\r\n`, "utf-8");
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("课表导入模板");
  sheet.addRow([...importHeaders]);
  sheet.addRow(example);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174034" } };
  sheet.columns = [{ width: 22 }, { width: 14 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 24 }, { width: 14 }];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
