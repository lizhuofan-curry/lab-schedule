import { z } from "zod";
import type { ImageCourseDraft } from "./image-ocr";
import type { ImportHeader, ImportRecord } from "./schedule-import";

const uncertainFieldSchema = z.enum(["name", "teacher", "location", "weekday", "periods", "weeks"]);

const visionCourseSchema = z.object({
  name: z.string().trim().max(100).default(""),
  teacher: z.string().trim().max(100).default(""),
  location: z.string().trim().max(120).default(""),
  weekday: z.number().int().min(1).max(7).nullable().default(null),
  startPeriod: z.number().int().min(1).max(13).nullable().default(null),
  endPeriod: z.number().int().min(1).max(13).nullable().default(null),
  weeks: z.string().trim().max(100).default(""),
  note: z.string().trim().max(200).default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.string().trim().max(300).default(""),
  uncertainFields: z.array(uncertainFieldSchema).default([]),
});

const visionResponseSchema = z.object({ courses: z.array(visionCourseSchema).max(60) });
export type VisionCourse = z.infer<typeof visionCourseSchema>;

const fieldMap: Record<z.infer<typeof uncertainFieldSchema>, ImportHeader[]> = {
  name: ["课程名称"],
  teacher: ["教师"],
  location: ["地点"],
  weekday: ["星期"],
  periods: ["开始节次", "结束节次"],
  weeks: ["周次"],
};

function unwrapJson(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseVisionSchedule(value: string): VisionCourse[] {
  return visionResponseSchema.parse(JSON.parse(unwrapJson(value))).courses;
}

export function visionCoursesToDrafts(courses: VisionCourse[]): ImageCourseDraft[] {
  return courses.map((course, index) => {
    const reviewFields = new Set<ImportHeader>(course.uncertainFields.flatMap((field) => fieldMap[field]));
    if (!course.name) reviewFields.add("课程名称");
    if (!course.weekday) reviewFields.add("星期");
    if (!course.startPeriod) reviewFields.add("开始节次");
    if (!course.endPeriod) reviewFields.add("结束节次");
    if (!course.weeks) reviewFields.add("周次");
    const record: ImportRecord = {
      "课程名称": course.name,
      "教师": course.teacher,
      "地点": course.location,
      "星期": course.weekday ? `周${"一二三四五六日"[course.weekday - 1]}` : "",
      "开始节次": course.startPeriod?.toString() ?? "",
      "结束节次": course.endPeriod?.toString() ?? "",
      "周次": course.weeks.replace(/周$/u, ""),
      "备注": course.note,
      "颜色": "#dce8e3",
    };
    return {
      id: `vision-${index + 1}-${course.name.slice(0, 12)}`,
      sourceText: course.evidence || "智能识别结果",
      confidence: Math.round(course.confidence * 100),
      reviewFields: [...reviewFields],
      record,
    };
  });
}
